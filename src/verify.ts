/**
 * topbeam verify <id> — insan onayı akışı. "Çalışıyor"nun tek meşru kapısı.
 *
 * İNSAN KAPISI (ürünün EN kutsal kuralı: insan onayı = GERÇEK insan).
 * Dogfood'da bir ajan `topbeam verify <id> <<< "e"` koşturup passport.jsonl'e
 * `by:"dogfood-ajan"` diye "insan onayı" yazdı. Bu, ürünün tek moat'ını
 * (dürüstlük) delen bir olaydı. Kapı artık KODDA:
 *
 *  1. TTY ŞARTI — cevap kanalı (stdin) gerçek bir terminale bağlı değilse
 *     (pipe, dosya, otomasyon, CI) seviye YÜKSELTİLMEZ, passport.jsonl'e
 *     hiçbir satır yazılmaz. Soru bile sorulmaz.
 *  2. KİMLİK ŞARTI — onaylayan, işletim sistemi kullanıcısıdır (os.userInfo).
 *     Kimlik okunamıyorsa onay YOK ("bilinmiyor" imzayla onay olmaz).
 *  3. Kayıt kanalı taşır: Verification.source='terminal'.
 *
 * NEDEN BAYPAS BAYRAĞI YOK: `--etkilesimsiz-onay` gibi bir kaçış kapısını bir
 * bot da geçebilir — o zaman kapı kapı olmaktan çıkar, süse döner.
 *
 * ⚠️ BU KAPININ SINIRI — ÖLÇÜLDÜ, GİZLENMİYOR (2026-07-29):
 * `process.stdin.isTTY` bir ajanın taklit EDEMEYECEĞİ sinyal DEĞİLDİR.
 * macOS'ta hazır gelen `script(1)` sahte bir pty açar ve isTTY'yi `true` yapar:
 *     printf 'e\n' | script -q /dev/null node dist/cli.js verify <id>
 * → onay YAZILIR. Aynısını `expect`, python `pty`, node-pty de yapar.
 * Ölçüm: `printf 'e\n' | script -q /dev/null node -e "…isTTY"` → `true`.
 *
 * Yani bu bir DUVAR DEĞİL, KASİS. Kurulabilecek en güçlü DOĞRU cümle şudur:
 *   "Düz pipe/yönlendirme ile onay geçmez; onay vermek için kasıtlı olarak
 *    sahte terminal kurmak gerekir — yani kaza ile değil, ancak bile isteye."
 * "Yapısal olarak imkânsız", "ajan taklit edemez", "bot onay veremez" cümleleri
 * YANLIŞTIR ve bu üründe kullanılamaz. Yanlış etiketli bir dürüstlük rozeti,
 * hiç rozet olmamasından kötüdür — ürünün tek sermayesi bu.
 *
 * Bedeli bilinçli: `topbeam verify` düz betikten koşturulamaz. Doğru bedel — bu komut
 * zaten "bir insan kendi gözüyle gördü" demek için var.
 *
 * <id> ya tek bir CLAIM ya da bir TESLİM SÖZÜ (goal.md maddesi, `soz-…`)
 * olabilir. Söz verilirse o söze eşleşen TÜM doğrulanmamış kayıtlar ekrana
 * dökülür ve TEK soruyla birlikte onaylanır. Kör onay yok: onaylanan her kayıt
 * (iddia + kanıtları) soru sorulmadan ÖNCE gösterilir. Sözler insanın kendi
 * cümleleridir (sonlu ve kilitli) — bu yüzden onay lastik damgaya dönüşmez.
 *
 * Akış: claim'leri göster → kanıtları listele → kullanıcı onayı sor (e/H) →
 * onaylanırsa:
 *   - claim insan-onayi seviyesine yükselir (approveClaim — verify akışının
 *     TEK yükseltme kapısı; motor asla kendisi yükseltmez),
 *   - teslim sözü completed + verification olur,
 *   - .ocean/passport.jsonl'e APPEND edilir (değişmez onay logu),
 *   - kart yeniden kurulur, state + pano yazılır,
 *   - BAR DOLDUYSA (her söz defterle desteklenen insan onaylı) bir kez
 *     .ocean/muhur.md yazılır + macOS bildirimi verilir
 *     ("Topbeam: ürün geliştirildi 🎉"; fullTickNotifiedAt ile tekrarlanmaz).
 *
 * Reddedilirse (H) hiçbir seviye değişmez — dürüstlük: onay zorla alınmaz.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import {
  EVIDENCE_LEVEL_LABELS_TR,
  SCHEMA_VERSION,
  type Claim,
  type ClaimEvidence,
  type OceanState,
  type PassportItem,
  type Verification,
} from './types.ts';
import { buildCard, scriptsFromPackageJson } from './card.ts';
import { buildTeslim } from './goal.ts';
import { claimTitle } from './passport.ts';
import { muhurMetni } from './muhur.ts';
import { renderPano } from './pano.ts';
import { notifyMac } from './notify.ts';
import {
  ROZETSIZ_ETIKET,
  ROZETSIZ_NOT,
  claimOnayli,
  dogrulananSayisi,
  kimlikGecerliMi,
  pasaportTamMi,
} from './ledger.ts';
import {
  appendPassportLog,
  muhurPath,
  panoPath,
  readGoal,
  readGoalItems,
  readLedger,
  readState,
  writeMuhur,
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
    summary: `${verification.by} verified this on ${verification.at}${
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
  /**
   * Cevap kanalı GERÇEK bir terminal mi (CLI: process.stdin.isTTY).
   * Verilmezse false sayılır — bu bir GÜVENLİK KAPISI: "bilinmiyor" insan
   * sayılmaz. (Ürünün geri kalanında 'bilinmiyor ≠ yok'tur; ama onay
   * vermek için kanıt gerekir, kanıtsız kapı açılmaz.)
   */
  interactive?: boolean;
  /**
   * Onaylayan kişi. CLI bunu ÇAĞIRANDAN ALMAZ — işletim sistemi kullanıcı
   * adını kullanır. Enjeksiyon yalnız testler içindir; imza uydurulamasın
   * diye `--by` bayrağı bilerek kaldırıldı.
   */
  by?: string;
  now?: Date;
}

/** Onay kapısının kapanma nedeni (dürüst raporlama için makine karşılığı). */
export type VerifyGate = 'etkilesimsiz' | 'kimlik-yok';

export interface VerifyResult {
  ok: boolean;
  error?: string;
  approved?: boolean;
  /** İnsan kapısı kapandıysa nedeni (onay istenmedi, hiçbir şey yazılmadı). */
  gate?: VerifyGate;
  fullTick?: boolean;
  notified?: boolean;
  panoPath?: string;
}

const YES = new Set(['e', 'evet', 'y', 'yes']);

/**
 * Tek soruda onaylanması "gözle görüldü" sayılabilecek makul kayıt sayısı.
 * Üstüne çıkınca soru sorulmadan ÖNCE uyarılır: geniş bir söz, tek "e" ile
 * lastik damgaya döner ve insan onayını değersizleştirir (ürünün moat'ı budur).
 * Kapı DEĞİL, uyarıdır — söz insanın kendi sözü, kararı da onun.
 */
export const KALABALIK_ESIK = 10;

/**
 * İnsan kapısı — SAF fonksiyon (testle kilitlenir).
 * Geçerse onaylayanın kimliğini döner; geçmezse nedeni + insan-okur açıklama.
 */
export function insanKapisi(deps: {
  interactive?: boolean;
  by?: string;
}): { ok: true; by: string } | { ok: false; gate: VerifyGate; message: string } {
  if (deps.interactive !== true) {
    return {
      ok: false,
      gate: 'etkilesimsiz',
      message:
        'No approval recorded: the answer did not come from a terminal (piped or automated input).\n' +
        'This gate stops plain pipes and redirection — an approval cannot be given by accident.\n' +
        'It is not a wall, though: someone who sets up a fake terminal (a pty) can pass it deliberately.\n' +
        'Run this command in your own terminal, by hand: topbeam verify <id>',
    };
  }
  // Kimlik listesi ledger.ts'te: onayı YAZAN kapı ile onayı GÖSTEREN kapı
  // aynı ölçütü kullanmalı, yoksa biri diğerinin geçirdiğini reddeder.
  const by = (deps.by ?? osKullanici() ?? '').trim();
  if (!kimlikGecerliMi(by)) {
    return {
      ok: false,
      gate: 'kimlik-yok',
      message:
        'No approval recorded: the username of the approver could not be read.\n' +
        'An approval with an unknown signature is not an approval — nothing was written.',
    };
  }
  return { ok: true, by };
}

/** İşletim sistemi kullanıcı adı; okunamazsa null (uydurulmaz). */
function osKullanici(): string | null {
  try {
    const u = userInfo().username;
    return typeof u === 'string' && u !== '' ? u : null;
  } catch {
    return null;
  }
}

function evidenceLines(claim: Claim): string[] {
  if (claim.evidence.length === 0) return ['  (no evidence on record)'];
  return claim.evidence.map((e) => `  - [${e.kind}] ${e.summary}`);
}

export async function runVerify(cwd: string, id: string, deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? notifyMac;

  const state = await readState(cwd);
  if (state === null) {
    return { ok: false, error: "This project is not connected to Topbeam. First run: topbeam init" };
  }

  // ── hedefi çöz: tek claim mi, teslim sözü mü? ──
  const byIdx = new Map<string, number>(state.claims.map((c, i) => [c.id, i]));
  const unit = state.passport.find((p) => p.id === id);
  let hedefIdx: number[];
  let hedefAdi: string;
  if (byIdx.has(id)) {
    hedefIdx = [byIdx.get(id) as number];
    hedefAdi = id;
  } else if (unit !== undefined) {
    hedefIdx = unit.claimIds.map((cid) => byIdx.get(cid)).filter((i): i is number => i !== undefined);
    hedefAdi = unit.title;
  } else {
    hedefIdx = [];
    hedefAdi = id;
  }

  // Sözün kendisi var ama bağlanacak kaydı yok: bu bir "bulunamadı" değil,
  // "kanıt yok" durumudur — dürüst ayrım (onay burada kör damga olurdu).
  if (hedefIdx.length === 0 && unit !== undefined) {
    return {
      ok: false,
      error:
        `No record is bound to this delivery promise: ${unit.title}\n` +
        'An approval verifies a RECORD; with no record there is nothing to approve.\n' +
        'Add a hint to the promise (a path: `src/auth` · a `test:` prefix · a #tag), then run: topbeam sync',
    };
  }

  if (hedefIdx.length === 0) {
    const sozler = state.passport.slice(0, 3).map((p) => `  - ${p.id}  (${p.claimIds.length} records)  ${p.title}`);
    const known = state.claims.slice(-5).map((c) => `  - ${c.id}`);
    return {
      ok: false,
      error:
        `No record found: ${id}\n` +
        (known.length > 0
          ? `Last claim ids on record:\n${known.join('\n')}` +
            (sozler.length > 0
              ? `\nDelivery promises (one approval covers every record of a promise):\n${sozler.join('\n')}`
              : '')
          : 'No claims yet — first run: topbeam sync'),
    };
  }

  /**
   * İNSAN ROZETİ = DEFTER — raporda da. Bir claim'in kendi `level:'insan-onayi'`
   * yazması onu onaylı YAPMAZ: dayanak .ocean/passport.jsonl'deki terminal
   * imzalı kayıttır (ledger.ts). Kaydı olmayan kayıt silinmez — "kanal kaydı
   * yok" diye işaretlenir ve yeniden doğrulanabilir kalır (onarım yolu açık).
   */
  const defter = await readLedger(cwd);
  const onayliMi = (c: Claim): boolean => claimOnayli(defter, c.id);

  // ── göster: her iddia + seviye + kanıtlar (karar insanın, kör onay yok) ──
  const hedefler = hedefIdx.map((i) => state.claims[i] as Claim);
  if (unit !== undefined && hedefler.length > 1) {
    deps.out('');
    deps.out(`Promise : ${hedefAdi}`);
    deps.out(`Records : ${hedefler.length} — all of them listed below`);
  }
  for (const c of hedefler) {
    deps.out('');
    deps.out(`Claim   : ${c.text}`);
    // Seviye satırı defterle kesişir: dayanaksız "insan onayı" olduğu gibi yazılmaz.
    const kaynaksiz = c.level === 'insan-onayi' && !onayliMi(c);
    deps.out(
      `Level   : ${EVIDENCE_LEVEL_LABELS_TR[c.level]}${
        kaynaksiz ? ` — ${ROZETSIZ_ETIKET} (${ROZETSIZ_NOT}: passport.jsonl)` : ''
      }`,
    );
    deps.out('Evidence:');
    for (const line of evidenceLines(c)) deps.out(line);
  }
  deps.out('');

  /**
   * "Bekleyen" ölçütü SEVİYE değil DEFTERDİR: state'te 'insan-onayi' yazan ama
   * defterde karşılığı olmayan kayıt onaylı sayılmaz, yeniden sorulur.
   * (Aksi hâlde dayanaksız bir seviye, doğrulamayı sonsuza dek kilitlerdi.)
   */
  const bekleyenIdx = hedefIdx.filter((i) => !onayliMi(state.claims[i] as Claim));
  if (bekleyenIdx.length === 0) {
    deps.out(
      hedefler.length > 1
        ? 'Every record here is already human-approved — nothing left to approve.'
        : 'This claim is already human-approved — nothing left to approve.',
    );
    return { ok: true, approved: false };
  }

  /**
   * İNSAN KAPISI — soru SORULMADAN önce. Kapı kapalıysa soru bile sorulmaz:
   * bir otomasyona "onaylıyor musun?" diye sormanın anlamı yok, ve sorulmuş
   * bir sorunun cevabı log'a "insan onayı" diye sızabilir.
   */
  const kapi = insanKapisi(deps);
  if (!kapi.ok) {
    deps.out(kapi.message);
    return { ok: true, approved: false, gate: kapi.gate };
  }
  const by = kapi.by;

  // Geniş söz uyarısı — tek "e" ile lastik damga vurulmasın diye.
  if (bekleyenIdx.length > KALABALIK_ESIK) {
    deps.out(
      `Careful: this promise covers ${bekleyenIdx.length} records. If you have not really seen all of\n` +
        'them with your own eyes, answer N — then add a hint to narrow the promise (path · `test:` · #tag).\n' +
        'A broad approval passed with a single "yes" stops being an approval.',
    );
  }

  const soru =
    bekleyenIdx.length > 1
      ? `Have you checked all ${bekleyenIdx.length} of these records with your own eyes? [y/N] `
      : 'Have you checked this work with your own eyes? [y/N] ';
  const answer = (await deps.ask(soru)).trim().toLowerCase();
  if (!YES.has(answer)) {
    deps.out('Nothing recorded — the level did not change. (No approval without checking: that is how honesty works.)');
    return { ok: true, approved: false };
  }

  // ── onay: tek yönlü yükseltme + değişmez log ──
  // source='terminal': kayıt kendi kanalını taşır (denetçi eski kayıttan ayırsın).
  const verification: Verification = {
    by,
    at: now.toISOString(),
    decision: 'approved',
    source: 'terminal',
  };
  const claims = [...state.claims];
  const onaylananlar: Claim[] = [];
  for (const i of bekleyenIdx) {
    const c = state.claims[i] as Claim;
    claims[i] = approveClaim(c, verification);
    onaylananlar.push(c);
  }

  const title = claimTitle(hedefler.length > 1 ? hedefAdi : (hedefler[0] as Claim).text);
  // passport.jsonl KAYIT BAŞINA satır: değişmez log tek tek izlenebilir kalır.
  for (const c of onaylananlar) {
    await appendPassportLog(cwd, {
      schema_version: SCHEMA_VERSION,
      at: verification.at,
      claimId: c.id,
      title: claimTitle(c.text),
      decision: verification.decision,
      by,
      source: 'terminal',
      levelBefore: c.level,
      levelAfter: 'insan-onayi',
    });
  }

  // Pasaport = teslim sözleri (goal.md); bu onay, tamamlanan söze yazılır.
  const goalItems = await readGoalItems(cwd);
  const onayliIds = new Set(claims.filter((c) => c.level === 'insan-onayi').map((c) => c.id));
  const onaylananIds = new Set(onaylananlar.map((c) => c.id));
  const passport: PassportItem[] = buildTeslim(state.passport, claims, goalItems).map((p) =>
    p.verification === undefined &&
    p.claimIds.length > 0 &&
    p.claimIds.some((cid) => onaylananIds.has(cid)) &&
    p.claimIds.every((cid) => onayliIds.has(cid))
      ? { ...p, verification }
      : p,
  );

  const log = [
    ...state.log,
    {
      ts: verification.at,
      text:
        onaylananlar.length > 1
          ? `Verified: ${title} — ${onaylananlar.length} records (${by})`
          : `Verified: ${title} (${by})`,
      source: 'insan' as const,
    },
  ];

  /**
   * ── bar doldu mu (MÜHÜR + bildirim BİR KEZ) ──
   * Defter DİSKTEN taze okunur: az önce yazılan satırlar dâhil, her teslim
   * sözünün onayı passport.jsonl'de gerçekten duruyor mu? Tören de rozet gibi
   * kanıta dayanır — maddenin kendi "completed" iddiasına değil.
   *
   * Mühür YALNIZ BURADA yazılır (son onay anında). Sözleri silerek barı
   * doldurmak mühür getirmez: sync mühür yazmaz.
   */
  const ledger = await readLedger(cwd);
  const fullTick = pasaportTamMi(passport, ledger);
  let notified = false;
  let fullTickNotifiedAt = state.fullTickNotifiedAt;
  if (fullTick && fullTickNotifiedAt === undefined) {
    await writeMuhur(
      cwd,
      muhurMetni({
        projectName: state.projectName,
        at: verification.at,
        by,
        items: passport,
        claims,
        ledger,
        toolVersion: state.tool_version,
      }),
    );
    notified = await notify('Topbeam', 'Every delivery promise is now human-approved 🎉');
    fullTickNotifiedAt = verification.at;
    log.push({
      ts: verification.at,
      text: `The bar is full: all ${passport.length} delivery promises are human-approved — the seal was written (.ocean/muhur.md).`,
      // 'ocean' = LogSource enum DEĞERİ (şema uyumu; panoda etiket "topbeam").
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
  await writePano(cwd, renderPano(next, { goalText, ledger }));

  deps.out('');
  deps.out(
    onaylananlar.length > 1
      ? `Approval recorded: ${onaylananlar.length} records → human approval (${by}).`
      : `Approval recorded: ${(onaylananlar[0] as Claim).id} → human approval (${by}).`,
  );
  // Rapor da panoyla aynı kapıdan: sayı defterden gelir (passport.jsonl).
  if (passport.length > 0) {
    deps.out(`Delivery promises: ${dogrulananSayisi(passport, ledger)} / ${passport.length} approved.`);
  }
  if (fullTick) {
    deps.out('The bar is full — every promise is kept 🎉');
    deps.out(`Seal written: ${muhurPath(cwd)}`);
  }

  return { ok: true, approved: true, fullTick, notified, panoPath: panoPath(cwd) };
}
