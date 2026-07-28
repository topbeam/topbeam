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
 * bot da geçebilir — o zaman kapı kapı olmaktan çıkar, süse döner. Bir ajanın
 * taklit EDEMEYECEĞİ tek sinyal, onay kanalının işletim sistemi düzeyinde bir
 * terminale bağlı olmasıdır. Bu yüzden tek ölçüt odur.
 * Bedeli bilinçli: `topbeam verify` betikten koşturulamaz. Doğru bedel — bu komut
 * zaten "bir insan kendi gözüyle gördü" demek için var.
 *
 * <id> ya tek bir CLAIM ya da bir İŞ BİRİMİ (pasaport maddesi, `birim-…`)
 * olabilir. Birim verilirse birimdeki TÜM doğrulanmamış kayıtlar ekrana
 * dökülür ve TEK soruyla birlikte onaylanır — 278 kere "evet" demek zorunda
 * kalmadan FULL-TİK'e erişilebilsin diye. Kör onay yok: onaylanan her kayıt
 * (iddia + kanıtları) soru sorulmadan ÖNCE gösterilir.
 *
 * Akış: claim'leri göster → kanıtları listele → kullanıcı onayı sor (e/H) →
 * onaylanırsa:
 *   - claim insan-onayi seviyesine yükselir (approveClaim — verify akışının
 *     TEK yükseltme kapısı; motor asla kendisi yükseltmez),
 *   - pasaport maddesi completed + verification olur,
 *   - .ocean/passport.jsonl'e APPEND edilir (değişmez onay logu),
 *   - kart yeniden kurulur, state + pano yazılır,
 *   - pasaport FULL-TİK olduysa BİR KEZ macOS bildirimi:
 *     "Topbeam: ürün geliştirildi 🎉" (fullTickNotifiedAt ile tekrarlanmaz).
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
import { buildPassport, claimTitle } from './passport.ts';
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
  panoPath,
  readGoal,
  readLedger,
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
        'Onay kaydedilmedi: cevap bir terminalden gelmedi (pipe/otomasyon girdisi).\n' +
        'İnsan onayı bu üründe GERÇEK insan demektir — bir betik ya da ajan onay veremez.\n' +
        'Bu komutu kendi terminalinde, elinle çalıştır: topbeam verify <id>',
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
        'Onay kaydedilmedi: onaylayan kullanıcı adı okunamadı.\n' +
        'İmzası bilinmeyen bir onay, onay değildir — kayıt yazılmadı.',
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
  if (claim.evidence.length === 0) return ['  (kanıt kaydı yok)'];
  return claim.evidence.map((e) => `  - [${e.kind}] ${e.summary}`);
}

export async function runVerify(cwd: string, id: string, deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? notifyMac;

  const state = await readState(cwd);
  if (state === null) {
    return { ok: false, error: "Bu proje Topbeam'e bağlı değil. Önce: topbeam init" };
  }

  // ── hedefi çöz: tek claim mi, iş birimi mi? ──
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

  if (hedefIdx.length === 0) {
    const birimler = state.passport.slice(-3).map((p) => `  - ${p.id}  (${p.claimIds.length} kayıt)`);
    const known = state.claims.slice(-5).map((c) => `  - ${c.id}`);
    return {
      ok: false,
      error:
        `Kayıt bulunamadı: ${id}\n` +
        (known.length > 0
          ? `Kayıtlı son claim id'leri:\n${known.join('\n')}` +
            (birimler.length > 0 ? `\nPasaport iş birimleri (hepsini tek onayla):\n${birimler.join('\n')}` : '')
          : "Henüz hiç claim yok — önce: topbeam sync"),
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
    deps.out(`İş birimi: ${hedefAdi}`);
    deps.out(`Kayıt    : ${hedefler.length} adet — hepsi aşağıda`);
  }
  for (const c of hedefler) {
    deps.out('');
    deps.out(`İddia   : ${c.text}`);
    // Seviye satırı defterle kesişir: dayanaksız "insan onayı" olduğu gibi yazılmaz.
    const kaynaksiz = c.level === 'insan-onayi' && !onayliMi(c);
    deps.out(
      `Seviye  : ${EVIDENCE_LEVEL_LABELS_TR[c.level]}${
        kaynaksiz ? ` — ${ROZETSIZ_ETIKET} (${ROZETSIZ_NOT}: passport.jsonl)` : ''
      }`,
    );
    deps.out('Kanıtlar:');
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
        ? 'Bu birimdeki tüm kayıtlar zaten insan onaylı — yeniden onay gerekmiyor.'
        : 'Bu iddia zaten insan onaylı — yeniden onay gerekmiyor.',
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

  const soru =
    bekleyenIdx.length > 1
      ? `Bu ${bekleyenIdx.length} kaydın hepsini kendi gözünle doğruladın mı? [e/H] `
      : 'Bu işi kendi gözünle doğruladın mı? [e/H] ';
  const answer = (await deps.ask(soru)).trim().toLowerCase();
  if (!YES.has(answer)) {
    deps.out('Onay kaydedilmedi — seviye değişmedi. (Doğrulamadan onay yok: dürüstlük böyle çalışır.)');
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

  // Pasaport iş birimleri claim'lerden yeniden kurulur; bu onay ilgili birime yazılır.
  const onayliIds = new Set(claims.filter((c) => c.level === 'insan-onayi').map((c) => c.id));
  const onaylananIds = new Set(onaylananlar.map((c) => c.id));
  const passport: PassportItem[] = buildPassport(state.passport, claims).map((p) =>
    p.verification === undefined &&
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
          ? `Doğrulandı: ${title} — ${onaylananlar.length} kayıt (${by})`
          : `Doğrulandı: ${title} (${by})`,
      source: 'insan' as const,
    },
  ];

  /**
   * ── full-tik kontrolü (bildirim BİR KEZ) ──
   * Defter DİSKTEN taze okunur: az önce yazılan satırlar dâhil, her maddenin
   * onayı passport.jsonl'de gerçekten duruyor mu? Kutlama da rozet gibi
   * kanıta dayanır — state'in kendi "completed" iddiasına değil.
   */
  const ledger = await readLedger(cwd);
  const fullTick = pasaportTamMi(passport, ledger);
  let notified = false;
  let fullTickNotifiedAt = state.fullTickNotifiedAt;
  if (fullTick && fullTickNotifiedAt === undefined) {
    notified = await notify('Topbeam', 'Ürün geliştirildi 🎉 — pasaporttaki tüm maddeler insan onaylı.');
    fullTickNotifiedAt = verification.at;
    log.push({
      ts: verification.at,
      text: 'Pasaport FULL-TİK: tüm maddeler insan onaylı — ürün geliştirildi 🎉',
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
      ? `Onay kaydedildi: ${onaylananlar.length} kayıt → insan-onayı (${by}).`
      : `Onay kaydedildi: ${(onaylananlar[0] as Claim).id} → insan-onayı (${by}).`,
  );
  // Rapor da panoyla aynı kapıdan: sayı defterden gelir (passport.jsonl).
  deps.out(`Pasaport: ${dogrulananSayisi(passport, ledger)}/${passport.length} doğrulandı.`);
  if (fullTick) deps.out('Pasaport FULL-TİK — ürün geliştirildi 🎉');

  return { ok: true, approved: true, fullTick, notified, panoPath: panoPath(cwd) };
}
