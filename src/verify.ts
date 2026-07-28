/**
 * ocean verify <id> — insan onayı akışı. "Çalışıyor"nun tek meşru kapısı.
 *
 * Akış: claim'i göster → kanıtları listele → kullanıcı onayı sor (e/H) →
 * onaylanırsa:
 *   - claim insan-onayi seviyesine yükselir (approveClaim — verify akışının
 *     TEK yükseltme kapısı; motor asla kendisi yükseltmez),
 *   - pasaport maddesi completed + verification olur,
 *   - .ocean/passport.jsonl'e APPEND edilir (değişmez onay logu),
 *   - kart yeniden kurulur, state + pano yazılır,
 *   - pasaport FULL-TİK olduysa BİR KEZ macOS bildirimi:
 *     "Ocean: ürün geliştirildi 🎉" (fullTickNotifiedAt ile tekrarlanmaz).
 *
 * Reddedilirse (H) hiçbir seviye değişmez — dürüstlük: onay zorla alınmaz.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import {
  EVIDENCE_LEVEL_LABELS_TR,
  SCHEMA_VERSION,
  isPassportFull,
  type Claim,
  type ClaimEvidence,
  type OceanState,
  type PassportItem,
  type Verification,
} from './types.ts';
import { buildCard, scriptsFromPackageJson } from './card.ts';
import { renderPano } from './pano.ts';
import { notifyMac } from './notify.ts';
import {
  appendPassportLog,
  panoPath,
  readGoal,
  readState,
  writePano,
  writeState,
} from './state.ts';

/**
 * İnsan onayıyla claim yükseltme — verify akışının TEK kapısı.
 * (truth.ts buildCalisiyorClaim ile birlikte 'insan-onayi'nin iki meşru
 * üretim yolundan biri; ikisi de Verification olmadan çağrılamaz.)
 */
export function approveClaim(claim: Claim, verification: Verification): Claim {
  const humanEvidence: ClaimEvidence = {
    kind: 'human',
    summary: `${verification.by} ${verification.at} tarihinde doğruladı${
      verification.note !== undefined ? `: ${verification.note}` : '.'
    }`,
  };
  return { ...claim, level: 'insan-onayi', evidence: [...claim.evidence, humanEvidence] };
}

export interface VerifyDeps {
  /** Soru sor, cevabı al (CLI: readline; test: sahte). */
  ask: (question: string) => Promise<string>;
  /** Satır yaz (CLI: stdout; test: toplayıcı). */
  out: (line: string) => void;
  /** Bildirim (varsayılan notifyMac — hata yutar). */
  notify?: (title: string, message: string) => Promise<boolean>;
  /** Onaylayan kişi (varsayılan: işletim sistemi kullanıcı adı). */
  by?: string;
  now?: Date;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  approved?: boolean;
  fullTick?: boolean;
  notified?: boolean;
  panoPath?: string;
}

const YES = new Set(['e', 'evet', 'y', 'yes']);

function evidenceLines(claim: Claim): string[] {
  if (claim.evidence.length === 0) return ['  (kanıt kaydı yok)'];
  return claim.evidence.map((e) => `  - [${e.kind}] ${e.summary}`);
}

export async function runVerify(cwd: string, id: string, deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? notifyMac;

  const state = await readState(cwd);
  if (state === null) {
    return { ok: false, error: "Bu proje Ocean'a bağlı değil. Önce: ocean init" };
  }

  const idx = state.claims.findIndex((c) => c.id === id);
  const claim = idx >= 0 ? state.claims[idx] : undefined;
  if (claim === undefined) {
    const known = state.claims.slice(-5).map((c) => `  - ${c.id}`);
    return {
      ok: false,
      error:
        `Claim bulunamadı: ${id}\n` +
        (known.length > 0
          ? `Kayıtlı son claim id'leri:\n${known.join('\n')}`
          : "Henüz hiç claim yok — önce: ocean sync"),
    };
  }

  // ── göster: iddia + seviye + kanıtlar (karar insanın) ──
  deps.out('');
  deps.out(`İddia   : ${claim.text}`);
  deps.out(`Seviye  : ${EVIDENCE_LEVEL_LABELS_TR[claim.level]}`);
  deps.out('Kanıtlar:');
  for (const line of evidenceLines(claim)) deps.out(line);
  deps.out('');

  if (claim.level === 'insan-onayi') {
    deps.out('Bu iddia zaten insan onaylı — yeniden onay gerekmiyor.');
    return { ok: true, approved: false };
  }

  const answer = (await deps.ask('Bu işi kendi gözünle doğruladın mı? [e/H] ')).trim().toLowerCase();
  if (!YES.has(answer)) {
    deps.out('Onay kaydedilmedi — seviye değişmedi. (Doğrulamadan onay yok: dürüstlük böyle çalışır.)');
    return { ok: true, approved: false };
  }

  // ── onay: tek yönlü yükseltme + değişmez log ──
  const by = deps.by ?? userInfo().username;
  const verification: Verification = { by, at: now.toISOString(), decision: 'approved' };
  const approved = approveClaim(claim, verification);
  const claims = [...state.claims];
  claims[idx] = approved;

  const title = claim.text.replace(/\s+/g, ' ').trim().slice(0, 90);
  const passport: PassportItem[] = [...state.passport];
  const pIdx = passport.findIndex((p) => p.id === claim.id);
  const item: PassportItem = {
    id: claim.id,
    title,
    status: 'completed',
    claimIds: [claim.id],
    verification,
    level: 'insan-onayi',
  };
  const existingItem = pIdx >= 0 ? passport[pIdx] : undefined;
  if (existingItem !== undefined) passport[pIdx] = { ...existingItem, ...item };
  else passport.push(item);

  await appendPassportLog(cwd, {
    schema_version: SCHEMA_VERSION,
    at: verification.at,
    claimId: claim.id,
    title,
    decision: verification.decision,
    by,
    levelBefore: claim.level,
    levelAfter: 'insan-onayi',
  });

  const log = [
    ...state.log,
    { ts: verification.at, text: `Doğrulandı: ${title} (${by})`, source: 'insan' as const },
  ];

  // ── full-tik kontrolü (bildirim BİR KEZ) ──
  const fullTick = isPassportFull(passport);
  let notified = false;
  let fullTickNotifiedAt = state.fullTickNotifiedAt;
  if (fullTick && fullTickNotifiedAt === undefined) {
    notified = await notify('Ocean', 'Ürün geliştirildi 🎉 — pasaporttaki tüm maddeler insan onaylı.');
    fullTickNotifiedAt = verification.at;
    log.push({
      ts: verification.at,
      text: 'Pasaport FULL-TİK: tüm maddeler insan onaylı — ürün geliştirildi 🎉',
      source: 'ocean' as const,
    });
  }

  // ── kart + state + pano tazele ──
  let scripts: Record<string, string> = {};
  try {
    scripts = scriptsFromPackageJson(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch {
    /* package.json yok — öneri git status'a düşer */
  }
  const card = buildCard(claims, { scripts, now });

  const next: OceanState = {
    ...state,
    updatedAt: verification.at,
    claims,
    passport,
    log,
    card,
    ...(fullTickNotifiedAt !== undefined ? { fullTickNotifiedAt } : {}),
  };
  await writeState(cwd, next);
  const goalText = await readGoal(cwd);
  await writePano(cwd, renderPano(next, { goalText }));

  deps.out('');
  deps.out(`Onay kaydedildi: ${claim.id} → insan-onayı (${by}).`);
  deps.out(`Pasaport: ${passport.filter((p) => p.status === 'completed' && p.level === 'insan-onayi').length}/${passport.length} doğrulandı.`);
  if (fullTick) deps.out('Pasaport FULL-TİK — ürün geliştirildi 🎉');

  return { ok: true, approved: true, fullTick, notified, panoPath: panoPath(cwd) };
}
