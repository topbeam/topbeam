/**
 * topbeam sync — motor: collect → truth → card → state → pano.
 *
 * Deterministik boru hattı (LLM yok; ağ YALNIZ opsiyonel CI kaynağında):
 *   collectClaude(cwd) + collectGit(cwd) + collectCi(cwd, git)  ← CI opsiyonel,
 *     `--no-ci` / TOPBEAM_NO_CI=1 ile tamamen kapanır (local-first vaadi)
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
 *   satırları. Tekrarlar (ts+source+text) ayıklanır, ardışık tekrarlar "×N".
 * - Pasaport TESLİM SÖZLERİNDEN kurulur (.ocean/goal.md `- [ ]` satırları);
 *   insan kararları aynı id'li sözden taşınır (goal.ts). Oturum eklemek
 *   madde sayısını BÜYÜTMEZ — bar sonlu ve insan tanımlıdır.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectClaude } from './collect/claude.ts';
import { collectGit } from './collect/git.ts';
import { collectCi } from './collect/ci.ts';
import { buildTruth, collapseRepeats } from './truth.ts';
import { buildCard, scriptsFromPackageJson } from './card.ts';
import { buildTeslim } from './goal.ts';
import { buildDefter } from './passport.ts';
import { gozlemClaims, gozlemleriOku } from './gozlem.ts';
import { renderPano } from './pano.ts';
import {
  panoPath,
  readGoal,
  readGoalItems,
  readLedger,
  readNotes,
  readState,
  writePano,
  writeState,
} from './state.ts';
import { claimOnayli, dogrulananSayisi } from './ledger.ts';
import { TOOL_VERSION } from './types.ts';
import type { Claim, LogCounts, LogEntry, OceanState, ScopeNotes } from './types.ts';

export interface SyncResult {
  ok: boolean;
  /** ok=false ise insan-okur Türkçe hata (örn: önce topbeam init). */
  error?: string;
  state?: OceanState;
  /** Dürüst durum notları (toplayıcı + birleşme). */
  notes: string[];
  panoPath?: string;
  /** Kaç secret parçası maskelendi (şeffaflık). */
  redactHits?: number;
  transcriptsFound?: number;
  /**
   * DEFTERLE DESTEKLENEN insan onaylı TESLİM SÖZÜ sayısı (passport.jsonl).
   * Maddenin kendi 'completed' iddiası buraya girmez — CLI ve pano aynı sayıyı
   * gösterir. Barın dolu bölme sayısı budur.
   */
  sozOnayli?: number;
  /** goal.md'deki teslim sözü sayısı = barın bölme sayısı (0 → bar yok). */
  sozToplam?: number;
  /** Defterdeki oturum kaydı sayısı — ARŞİV sayımı, ilerleme ölçüsü DEĞİL. */
  defterKaydi?: number;
  /** Defterde geçerli terminal onayı BULUNAN claim sayısı ("insan onayı" der). */
  onayliClaim?: number;
  /**
   * Kendini 'insan-onayi' sayan ama defterde karşılığı OLMAYAN claim sayısı.
   * Rapor bunu insan onayı diye saymaz; "kanal kaydı yok" diye ayrı yazar.
   */
  kaynaksizClaim?: number;
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

/** ts+source+text üzerinden tekrar ayıkla, sırala, ardışık tekrarları "×N" yap. */
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
  // Birleşme sonrası yan yana gelen tekrarlar da tekilleşir (truth katmanında
  // ayrı ayrı sıkışan satırlar burada komşu olabilir).
  return collapseRepeats(out);
}

export interface SyncOptions {
  now?: Date;
  /**
   * `--no-ci`: opsiyonel CI kaynağı hiç sorulmaz (tek dış çağrı bile yapılmaz).
   * TOPBEAM_NO_CI ortam değişkeni de aynı işi görür (collect/ci.ts okur).
   */
  noCi?: boolean;
}

export async function runSync(cwd: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const state = await readState(cwd);
  if (state === null) {
    return {
      ok: false,
      error: "This project is not connected to Topbeam (or .ocean/state.json could not be read). First run: topbeam init",
      notes: [],
    };
  }

  // 1) Topla (salt-okunur gerçekler).
  const claude = await collectClaude(cwd);
  const git = await collectGit(cwd);
  /**
   * CI = TEK dış kaynak ve OPSİYONEL. gh yoksa/giriş yoksa/ağ yoksa zarif boş
   * döner; --no-ci ya da TOPBEAM_NO_CI=1 ile hiç sorulmaz. Neden okunamadığı
   * kapsam notuna düşer — Topbeam kurulum/token İSTEMEZ.
   */
  const ci = await collectCi(cwd, git, { ...(opts.noCi === true ? { noCi: true } : {}) });

  // 2) Gerçek motoru — beyanlar log'a "Beyan:" önekiyle girer (rozet: beyan).
  /**
   * BEYAN KAPISI (2026-07-29 sertleştirme bulgusu): Claude'un serbest metin
   * `description` beyanları kapsam filtresinden GEÇMİYORDU. Ata-dizin
   * oturumunda bu, başka bir işin — ölçülen vakada bir MÜŞTERİ ADININ —
   * panoya ve state.json'a düşmesi demekti:
   *     "Beyan: MUSTERI-X teklifini depoya kopyala ve test et"
   * Beyan zaten KANIT DEĞİL; ata oturumda ise sadece gürültü + risk.
   * Bu yüzden ata oturumu varsa beyan satırları hiç üretilmez.
   */
  const ataOturumVar = claude.sessions.some((s) => s.fromAncestor);
  const truth = buildTruth(claude, git, { includeBeyan: !ataOturumVar, now, ci });
  const notes = [...truth.notes];

  // 3) notes.md — Claude'un 1-satır notları (beyan; kanıt değil).
  const parsedNotes = await readNotes(cwd, nowIso);
  const noteEntries: LogEntry[] = parsedNotes.map((n) => ({
    ts: n.ts,
    text: n.text,
    source: 'claude-beyan',
  }));

  // 4) Birleştir.
  /**
   * İNSAN GÖZLEMLERİ — makine kanıtının yanına, ONA KARIŞMADAN eklenir.
   * Seviyeleri gozlem.ts'te 'dogrulanmadi' olarak kilitli; buradan yükseltilemez.
   * Motor bunları yeniden üretemez (transcript'te yoklar), o yüzden HER sync'te
   * defterden tazelenir — yoksa mergeClaims onları "kanıtı üretilemedi" diye düşürürdü.
   */
  const { kayitlar: gozlemler, atlanan: bozukGozlem } = await gozlemleriOku(cwd);
  if (bozukGozlem > 0) {
    notes.push(`${bozukGozlem} observation lines could not be read and were skipped (broken JSON) — nothing is deleted silently.`);
  }
  const tazeClaims = [...truth.claims, ...gozlemClaims(gozlemler)];
  const { merged, droppedStale } = mergeClaims(state.claims, tazeClaims);
  if (droppedStale > 0) {
    notes.push(
      `${droppedStale} older unverified claims were not reproduced by this sync and were dropped (the transcript may have changed); the passport items are kept as a trace.`,
    );
  }
  const keptHuman = state.log.filter((e) => e.source === 'insan' || e.source === 'ocean');
  const birlesikOncesi = truth.log.length + noteEntries.length + keptHuman.length;
  const log = dedupeSortLog([...truth.log, ...noteEntries, ...keptHuman]);

  /**
   * SAYI ZİNCİRİ — panodaki her sayının kaynağı (ham → tutulan).
   * Motor kendi kırpmasını yaptıktan sonra burada notes.md + korunan insan/ocean
   * satırları eklenir ve bir tekilleştirme daha koşar; iki adımın kaybı toplanır.
   * Kimlik (testle kilitli):
   *   hamToplam = ilgisizBeyan + tekillestirilen + kirpilan + tutulan
   */
  const hamKanit = truth.counts.hamKanit + keptHuman.length;
  const hamBeyan = truth.counts.hamBeyan + noteEntries.length;
  const logCounts: LogCounts = {
    hamToplam: hamKanit + hamBeyan,
    hamKanit,
    hamBeyan,
    ilgisizBeyan: truth.counts.ilgisizBeyan,
    tekillestirilen: truth.counts.tekillestirilen + (birlesikOncesi - log.length),
    kirpilan: truth.counts.kirpilan,
    tutulan: log.length,
  };

  /**
   * PASAPORT = TESLİM SÖZLERİ (goal.md). Oturum başına DEĞİL: yeni bir kodlama
   * oturumu paydayı büyütmez — Sisifos barının yapısal panzehiri. İnsan
   * kararları aynı id'li sözden taşınır (goal.ts).
   */
  const goalItems = await readGoalItems(cwd);
  const passport = buildTeslim(state.passport, merged, goalItems);

  // 5) Kart — package.json scripts önerisi (fs okuma burada; card.ts saf).
  let scripts: Record<string, string> = {};
  try {
    scripts = scriptsFromPackageJson(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch {
    // package.json yoksa öneri git status'a düşer — sorun değil.
  }
  // isGitRepo: kart, çalışmayacak git komutu önermesin (git yoksa insan onayı).
  const card = buildCard(merged, { scripts, now, isGitRepo: git.isGit });

  // 6) State + pano yaz.
  // Kapsam KALICI yazılır: gürültüyü kesmek tamam, ama İZ BIRAKMADAN kesmek
  // gizlemektir. Panoda kartın hemen altında bu blok görünür.
  const scope: ScopeNotes = {
    disKapsamDuzenleme: truth.scope.disKapsamDuzenleme,
    atlananOturum: truth.scope.atlananOturum,
    kontrolKomutu: truth.scope.kontrolKomutu,
    kisaltilanYol: truth.scope.kisaltilanYol,
    gitYok: truth.scope.gitYok,
    log: logCounts,
    notlar: [...notes],
  };

  const sessionsSeen = [...new Set([...state.sessionsSeen, ...claude.sessions.map((s) => s.sessionId)])];
  const next: OceanState = {
    ...state,
    /**
     * SÜRÜM KÜNYESİ: `tool_version` = bu özeti ÜRETEN sürüm, projeyi kuran sürüm
     * DEĞİL. `...state` yayılımı onu init anındaki değerde donduruyordu; makbuz
     * bu alanı "Araç: topbeam vX" diye dışarıya yazdığı için, güncellenmiş bir
     * kurulum eski sürümü beyan ediyordu (2026-07-29'da 0.1.1, kendini v0.1.0
     * diye tanıttı). Künye yanlışsa makbuz da yanlıştır.
     */
    tool_version: TOOL_VERSION,
    updatedAt: nowIso,
    lastSyncedAt: nowIso,
    log,
    claims: merged,
    passport,
    card,
    scope,
    sessionsSeen,
  };
  const { hits } = await writeState(cwd, next);
  const goalText = await readGoal(cwd);
  /**
   * İNSAN ROZETİ = DEFTER. Pano, state'in kendi "insan onaylı" iddiasına değil
   * .ocean/passport.jsonl'deki terminal imzalı kayda bakar; defter burada
   * (diskten, her sync'te taze) okunur ve render'a verilir.
   */
  const ledger = await readLedger(cwd);
  await writePano(cwd, renderPano(next, { goalText, ledger }));

  if (hits > 0) notes.push(`${hits} pieces of possible secret data were masked (state/board).`);
  if (goalItems.length === 0) {
    notes.push(
      'No `- [ ]` delivery promise in goal.md — the bar is not shown (an empty bar would be a false ' +
        'affordance). Write your delivery promises in .ocean/goal.md and the bar fills from there.',
    );
  }
  // Dayanağı düşmüş onay iddiası SESSİZ kalmaz — sayıyla söylenir.
  const kaynaksizMadde = passport.filter(
    (p) => p.level === 'insan-onayi' && !p.claimIds.every((cid) => ledger.gecerli.has(cid)),
  ).length;
  if (kaynaksizMadde > 0) {
    notes.push(
      `${kaynaksizMadde} delivery promises call themselves human-approved but could not be bound to a ` +
        'terminal-signed verification entry in the passport.jsonl ledger — marked "no ledger entry" on the ' +
        'board (nothing was deleted).',
    );
  }

  // Claim seviyesinde de aynı kapı: "insan onayı" diyen sayı deftere dayanır.
  const onayliClaim = merged.filter((c) => claimOnayli(ledger, c.id)).length;
  const kaynaksizClaim = merged.filter(
    (c) => c.level === 'insan-onayi' && !claimOnayli(ledger, c.id),
  ).length;

  return {
    ok: true,
    state: next,
    notes,
    panoPath: panoPath(cwd),
    redactHits: hits,
    transcriptsFound: claude.transcriptsFound,
    sozOnayli: dogrulananSayisi(passport, ledger),
    sozToplam: passport.length,
    defterKaydi: buildDefter(merged).length,
    onayliClaim,
    kaynaksizClaim,
  };
}
