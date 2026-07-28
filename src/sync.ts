/**
 * ocean sync — motor: collect → truth → card → state → pano.
 *
 * Deterministik boru hattı (LLM yok, network yok):
 *   collectClaude(cwd) + collectGit(cwd)
 *     → buildTruth (kanıt-kurallı claim + log)
 *     → notes.md satırları (Claude'un 1-satır beyan notları — "beyan" rozeti)
 *     → eski state ile birleşme (insan onayları ASLA kaybolmaz)
 *     → buildCard (sıradaki-tek-hareket)
 *     → state.json (redact'li) + pano.html
 *
 * Birleşme kuralları (dürüstlük):
 * - insan-onayi seviyeli eski claim'ler korunur (onay geri alınamaz — verify
 *   akışının tek yönlü kapısı).
 * - Yeniden üretilmeyen kanıtsız eski claim'ler düşer (kanıtı transcript'ti;
 *   transcript değiştiyse iddia da düşer — pasaport maddesi iz olarak kalır).
 * - Log yeniden kurulur: kanıtlı gerçekler + beyanlar + korunan insan/ocean
 *   satırları. Tekrarlar (ts+source+text) ayıklanır.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectClaude } from './collect/claude.ts';
import { collectGit } from './collect/git.ts';
import { buildTruth } from './truth.ts';
import { buildCard, scriptsFromPackageJson } from './card.ts';
import { renderPano } from './pano.ts';
import {
  panoPath,
  readGoal,
  readNotes,
  readState,
  writePano,
  writeState,
} from './state.ts';
import type { Claim, LogEntry, OceanState, PassportItem } from './types.ts';

export interface SyncResult {
  ok: boolean;
  /** ok=false ise insan-okur Türkçe hata (örn: önce ocean init). */
  error?: string;
  state?: OceanState;
  /** Dürüst durum notları (toplayıcı + birleşme). */
  notes: string[];
  panoPath?: string;
  /** Kaç secret parçası maskelendi (şeffaflık). */
  redactHits?: number;
  transcriptsFound?: number;
}

const TITLE_LEN = 90;

function claimTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_LEN ? `${t.slice(0, TITLE_LEN)}…` : t;
}

/** Eski + taze claim birleşimi: onaylı eskiler kazanır, kalanlar tazeden gelir. */
export function mergeClaims(
  oldClaims: readonly Claim[],
  fresh: readonly Claim[],
): { merged: Claim[]; droppedStale: number } {
  const byId = new Map<string, Claim>(fresh.map((c) => [c.id, c]));
  let droppedStale = 0;
  for (const old of oldClaims) {
    if (old.level === 'insan-onayi') {
      byId.set(old.id, old); // onay tek yönlü — sync geri alamaz
    } else if (!byId.has(old.id)) {
      droppedStale++; // kanıtı yeniden üretilemedi → iddia düşer (dürüst)
    }
  }
  const merged = [...byId.values()].sort((x, y) =>
    x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id.localeCompare(y.id),
  );
  return { merged, droppedStale };
}

/** Pasaport upsert: doğrulanmış maddeye DOKUNMA; diğerlerini claim'den tazele. */
export function upsertPassport(
  existing: readonly PassportItem[],
  claims: readonly Claim[],
): PassportItem[] {
  const out: PassportItem[] = [...existing];
  const idx = new Map<string, number>(out.map((p, i) => [p.id, i]));
  for (const c of claims) {
    const i = idx.get(c.id);
    const fresh: PassportItem = {
      id: c.id,
      title: claimTitle(c.text),
      status: c.level === 'insan-onayi' ? 'completed' : 'not_verified',
      claimIds: [c.id],
      level: c.level,
    };
    if (i === undefined) {
      idx.set(c.id, out.length);
      out.push(fresh);
    } else {
      const cur = out[i];
      if (cur !== undefined && cur.verification === undefined) {
        out[i] = { ...fresh, ...(cur.clientText !== undefined ? { clientText: cur.clientText } : {}) };
      }
      // verification'lı madde = insan kararı — sync dokunmaz.
    }
  }
  return out;
}

/** ts+source+text üzerinden tekrar ayıkla, sırala. */
function dedupeSortLog(entries: readonly LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of entries) {
    const key = `${e.ts}|${e.source}|${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : x.text.localeCompare(y.text)));
  return out;
}

export async function runSync(cwd: string, opts: { now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const state = await readState(cwd);
  if (state === null) {
    return {
      ok: false,
      error: "Bu proje Ocean'a bağlı değil (ya da .ocean/state.json okunamadı). Önce: ocean init",
      notes: [],
    };
  }

  // 1) Topla (salt-okunur gerçekler).
  const claude = await collectClaude(cwd);
  const git = await collectGit(cwd);

  // 2) Gerçek motoru — beyanlar log'a "Beyan:" önekiyle girer (rozet: beyan).
  const truth = buildTruth(claude, git, { includeBeyan: true, now });
  const notes = [...truth.notes];

  // 3) notes.md — Claude'un 1-satır notları (beyan; kanıt değil).
  const parsedNotes = await readNotes(cwd, nowIso);
  const noteEntries: LogEntry[] = parsedNotes.map((n) => ({
    ts: n.ts,
    text: n.text,
    source: 'claude-beyan',
  }));

  // 4) Birleştir.
  const { merged, droppedStale } = mergeClaims(state.claims, truth.claims);
  if (droppedStale > 0) {
    notes.push(
      `${droppedStale} eski doğrulanmamış claim bu senkronda yeniden üretilmedi ve düşürüldü (transcript değişmiş olabilir); pasaport maddeleri iz olarak korunur.`,
    );
  }
  const keptHuman = state.log.filter((e) => e.source === 'insan' || e.source === 'ocean');
  const log = dedupeSortLog([...truth.log, ...noteEntries, ...keptHuman]);

  const passport = upsertPassport(state.passport, merged);

  // 5) Kart — package.json scripts önerisi (fs okuma burada; card.ts saf).
  let scripts: Record<string, string> = {};
  try {
    scripts = scriptsFromPackageJson(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch {
    // package.json yoksa öneri git status'a düşer — sorun değil.
  }
  const card = buildCard(merged, { scripts, now });

  // 6) State + pano yaz.
  const sessionsSeen = [...new Set([...state.sessionsSeen, ...claude.sessions.map((s) => s.sessionId)])];
  const next: OceanState = {
    ...state,
    updatedAt: nowIso,
    lastSyncedAt: nowIso,
    log,
    claims: merged,
    passport,
    card,
    sessionsSeen,
  };
  const { hits } = await writeState(cwd, next);
  const goalText = await readGoal(cwd);
  await writePano(cwd, renderPano(next, { goalText }));

  if (hits > 0) notes.push(`${hits} parça olası gizli bilgi maskelendi (state/pano).`);

  return {
    ok: true,
    state: next,
    notes,
    panoPath: panoPath(cwd),
    redactHits: hits,
    transcriptsFound: claude.transcriptsFound,
  };
}
