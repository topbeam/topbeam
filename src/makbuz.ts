/**
 * MAKBUZ — `.ocean/makbuz.md` (+ isteğe bağlı `.ocean/makbuz.html`).
 *
 * NEDEN VAR: Topbeam'in çıktısı bugüne kadar YALNIZ özel panoydu (`pano.html`) —
 * kendine bakan bir ayna. Parayı getiren teslim ise DIŞARIYA gider: müşteriye,
 * ekibe, işverene. Makbuz o tek sayfadır — yapıştırılabilir, tek başına okunur
 * ve en önemlisi ÜÇÜNCÜ KİŞİ TARAFINDAN YENİDEN DOĞRULANABİLİR.
 *
 * TASARIM İLKESİ: "bana güven" YOK, "kendin bak" VAR. Makbuzdaki her sayı bir
 * ölçüme dayanır ve okuyan kişi o ölçümü kendi makinesinde tekrarlayabilsin
 * diye komutlar (commit SHA'ları · test komutu · defter dosyası) kopyalanabilir
 * biçimde yazılır. Kopyalanamayan bir kanıt, kanıt değil iddiadır.
 *
 * DÜRÜSTLÜK (gevşetilemez):
 * - Bir madde ancak `.ocean/passport.jsonl` defterindeki terminal imzalı onaya
 *   dayanıyorsa ONAYLI görünür (ledger.ts kapısı). Maddenin kendi 'completed'
 *   iddiası makbuzda tik getirmez — getirseydi makbuz lastik damgaya dönerdi.
 * - SHA'lar, komutlar ve sayılar state'ten OKUNUR; hiçbiri üretilmez. Kayıt
 *   yoksa "kayıt yok" yazar (uydurulmuş bir SHA, sahte bir makbuz demektir).
 * - Hiçbir şey onaylı değilse makbuz yine üretilir ama durumunu açıkça söyler —
 *   sahte mühür/rozet yoktur.
 * - Makbuz kendi KAPSAMINI ve SINIRLARINI yazar ("bilmedikleri" + "ne demek
 *   DEĞİL"): neyin elendiği görünmezse, okuyan her şeyin görüldüğünü sanır.
 * - Yüzde-ilerleme, hype ve motivasyon dili yok. LLM yok; makbuz üretimi ağa
 *   ÇIKMAZ (yalnız yerel kayıtları okur — "ağ yok" cümlesi bu komut için
 *   geçerlidir, sync'in opsiyonel CI okuması ayrı bir konudur); aynı girdi →
 *   aynı metin.
 */
import {
  EVIDENCE_LEVEL_LABELS_TR,
  type Claim,
  type EvidenceLevel,
  type LogEntry,
  type OceanState,
  type PassportItem,
  type ScopeNotes,
} from './types.ts';
import {
  ROZETSIZ_NOT,
  claimOnayli,
  dogrulananSayisi,
  maddeOnayli,
  type VerificationLedger,
} from './ledger.ts';
import { esc } from './pano.ts';
import { scriptsFromPackageJson } from './card.ts';
import {
  MAKBUZ_FILE,
  MAKBUZ_HTML_FILE,
  PASSPORT_LOG_FILE,
  makbuzHtmlPath,
  makbuzPath,
  readGoal,
  readGoalItems,
  readLedger,
  readState,
  writeMakbuz,
  writeMakbuzHtml,
} from './state.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Kısa/uzun git nesne kimliği (7–40 hex). Uydurma SHA elenmesin diye tek yerde. */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Makbuzda gösterilen commit sayısı — "tek sayfa" sözü için üst sınır. */
export const COMMIT_MAX = 8;
/** "Kendin doğrula" bloğunda kopyalanabilir `git show` satırı sayısı. */
export const DOGRULAMA_COMMIT_MAX = 5;

const SEVIYE_ADI: Record<EvidenceLevel, string> = {
  'dosya-kaniti': 'dosya-kanıtı',
  'test-kaniti': 'test-kanıtı',
  'insan-onayi': 'insan-onayı',
  dogrulanmadi: 'doğrulanmadı',
};

/** ISO ts → "2026-07-29 14:03" (deterministik dilimleme, locale yok). */
function fmtTs(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(ts);
  return m !== null ? `${m[1]} ${m[2]}` : ts;
}

/** ISO ts → "2026-07-29" (yoksa ham metin). */
function gun(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  return m?.[1] ?? ts;
}

// ── state'ten ölçülmüş gerçekleri çekme (uydurma yok) ────────────────────────

/** Log'dan okunan gerçek commit kaydı. */
export interface CommitKaydi {
  sha: string;
  ozet: string;
  ts: string;
}

/**
 * Log'daki git satırlarından commit kayıtlarını çıkar.
 * KAYNAK: `source:'git'` + `ref` alanı gerçek bir nesne kimliği olan satırlar
 * (truth.ts bunları `git log`tan yazar). Başka hiçbir yerden SHA türetilmez.
 * Sıra: en yeni önce (deterministik: ts, sonra sha).
 */
export function commitKayitlari(log: readonly LogEntry[]): CommitKaydi[] {
  const byId = new Map<string, CommitKaydi>();
  for (const e of log) {
    if (e.source !== 'git') continue;
    const ref = e.ref;
    if (typeof ref !== 'string' || !SHA_RE.test(ref)) continue;
    // "Commit: <özet> (<sha>)" → özet. Biçim tutmazsa ham metin kalır.
    const ozet = e.text
      .replace(/^Commit:\s*/, '')
      .replace(new RegExp(`\\s*\\(${ref}\\)\\s*$`), '')
      .trim();
    if (!byId.has(ref)) byId.set(ref, { sha: ref, ozet, ts: e.ts });
  }
  return [...byId.values()].sort((a, b) =>
    a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : a.sha.localeCompare(b.sha),
  );
}

/**
 * Claim'lerin `git-diff` kanıtlarındaki HEAD kimlikleri — ölçüm ANINDAKİ HEAD.
 * Commit özeti taşımaz; commit listesi boşken tek bağlanma noktası budur.
 */
export function headKimlikleri(claims: readonly Claim[]): string[] {
  const out: string[] = [];
  for (const c of claims) {
    for (const e of c.evidence) {
      if (e.kind !== 'git-diff') continue;
      const ref = e.ref;
      if (typeof ref === 'string' && SHA_RE.test(ref) && !out.includes(ref)) out.push(ref);
    }
  }
  return out.sort();
}

/** Tek bir claim'in git-diff kanıtındaki HEAD kimlikleri (madde satırı için). */
function maddeHeadleri(item: PassportItem, byId: ReadonlyMap<string, Claim>): string[] {
  const claims = item.claimIds.map((cid) => byId.get(cid)).filter((c): c is Claim => c !== undefined);
  return headKimlikleri(claims);
}

/** Kanıt dökümü — DEFTER kapılı: onaylı sayısı passport.jsonl'den gelir. */
export interface KanitOzeti {
  toplam: number;
  dosya: number;
  test: number;
  dogrulanmadi: number;
  /** Defterde terminal imzalı onayı BULUNAN kayıt sayısı. */
  insanOnayi: number;
  /** Kendini 'insan-onayi' sayan ama defterde karşılığı olmayan kayıt sayısı. */
  kaynaksiz: number;
}

/**
 * Kayıtların kanıt dökümü. Her kayıt TEK kovaya girer (toplam = kovaların
 * toplamı): önce defter sorulur — "insan onayı" diyebilmenin tek yolu odur.
 */
export function kanitOzeti(claims: readonly Claim[], ledger: VerificationLedger): KanitOzeti {
  const o: KanitOzeti = { toplam: claims.length, dosya: 0, test: 0, dogrulanmadi: 0, insanOnayi: 0, kaynaksiz: 0 };
  for (const c of claims) {
    if (claimOnayli(ledger, c.id)) o.insanOnayi++;
    else if (c.level === 'insan-onayi') o.kaynaksiz++;
    else if (c.level === 'dosya-kaniti') o.dosya++;
    else if (c.level === 'test-kaniti') o.test++;
    else o.dogrulanmadi++;
  }
  return o;
}

/** Bir maddenin dayandığı kayıtların seviye dökümü: "2 test-kanıtı · 1 dosya-kanıtı". */
function seviyeDokumu(item: PassportItem, byId: ReadonlyMap<string, Claim>): string {
  const sayac = new Map<EvidenceLevel, number>();
  let bilinmeyen = 0;
  for (const cid of item.claimIds) {
    const c = byId.get(cid);
    if (c === undefined) {
      bilinmeyen++;
      continue;
    }
    sayac.set(c.level, (sayac.get(c.level) ?? 0) + 1);
  }
  const parcalar = [...sayac.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lvl, n]) => `${n} ${SEVIYE_ADI[lvl]}`);
  if (bilinmeyen > 0) parcalar.push(`${bilinmeyen} kaydın karşılığı state'te yok`);
  return parcalar.length > 0 ? parcalar.join(' · ') : 'kayıt bulunamadı';
}

/** En son TEST-KANITI kaydı (sayı çıktıdan okunmuş olan) — yoksa null. */
export function sonTestKaydi(claims: readonly Claim[]): Claim | null {
  const testler = claims.filter((c) => c.kind === 'test' && c.level === 'test-kaniti');
  if (testler.length === 0) return null;
  return [...testler].sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id.localeCompare(b.id),
  )[0] as Claim;
}

// ── teslim sözü satırları ────────────────────────────────────────────────────

/** Makbuzda görünen tek teslim sözü satırı — durum DEFTERDEN gelir. */
export interface SozSatiri {
  no: number;
  title: string;
  /** YALNIZ defterle desteklenen insan onayı (ledger.ts kapısı). */
  onayli: boolean;
  /** Tek satır durum cümlesi. */
  durum: string;
  /** Neden bu durumda (motorun ölçtüğü gerekçe) — varsa. */
  gerekce?: string;
  /** "3 kayıt (2 test-kanıtı · 1 dosya-kanıtı)" ya da "kayıt yok". */
  kanit: string;
  /** Ölçüm anındaki HEAD kimlikleri (varsa) — yeniden doğrulamanın bağı. */
  headler: string[];
}

/**
 * Teslim sözlerini makbuz satırlarına çevir.
 *
 * KAPI: `maddeOnayli` — madde ancak defterde terminal imzalı onaya bağlanırsa
 * onaylı görünür. 'completed' yazan ama defterde karşılığı olmayan madde
 * ONAYSIZ gösterilir ve nedeni yazılır (silinmez, gizlenmez).
 */
export function sozSatirlari(
  items: readonly PassportItem[],
  claims: readonly Claim[],
  ledger: VerificationLedger,
): SozSatiri[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  return items.map((item, i) => {
    const onayli = maddeOnayli(ledger, item);
    const imzalar = item.claimIds
      .map((cid) => ledger.gecerli.get(cid))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    const enSon = imzalar.reduce<string | null>((acc, e) => (acc === null || e.at > acc ? e.at : acc), null);
    const kimler = [...new Set(imzalar.map((e) => e.by))].sort().join(', ');

    let durum: string;
    if (onayli) {
      durum =
        `İNSAN ONAYLI — ${kimler === '' ? 'imza kaydı yok' : kimler}` +
        `${enSon !== null ? ` · ${fmtTs(enSon)}` : ''} (terminal imzası · .ocean/${PASSPORT_LOG_FILE})`;
    } else if (item.level === 'insan-onayi') {
      // En tehlikeli hâl: kayıt kendini onaylı sanıyor. Makbuz tik VERMEZ.
      durum = `insan onayı DOĞRULANAMADI — ${ROZETSIZ_NOT} (.ocean/${PASSPORT_LOG_FILE} içinde terminal imzalı kayıt yok)`;
    } else {
      const seviye = EVIDENCE_LEVEL_LABELS_TR[item.level].split(' — ')[0] ?? SEVIYE_ADI[item.level];
      durum = `insan onayı YOK — en yüksek kanıt: ${seviye.toLocaleLowerCase('tr-TR')}`;
    }

    const kanit =
      item.claimIds.length === 0
        ? 'kayıt yok'
        : `${item.claimIds.length} kayıt (${seviyeDokumu(item, byId)})`;

    return {
      no: i + 1,
      title: item.title,
      onayli,
      durum,
      ...(item.reason !== undefined ? { gerekce: item.reason } : {}),
      kanit,
      headler: maddeHeadleri(item, byId),
    };
  });
}

// ── makbuz girdisi ───────────────────────────────────────────────────────────

/** Ölçülmüş bir CI koşumu BAĞLANTISI. Ölçülmediyse liste BOŞTUR — uydurulmaz. */
export interface CiKosum {
  ad: string;
  url: string;
  durum?: string;
}

/**
 * CI kayıtları — CI gerçekleri bu üründe ayrı bir alan değil, sıradan CLAIM
 * olarak gelir (collect/ci.ts → buildCiClaims, id öneki `ci-`). Makbuz bu
 * yüzden özel bir veri yoluna değil, kayıtların kendisine bakar.
 *
 * DÜRÜSTLÜK: bulamazsa "CI kaydı YOK" demez, "BU MAKBUZDA CI kaydı yok" der —
 * makbuz yalnız kendi gördüğü hakkında konuşur (bilinmiyor ≠ yok).
 */
export function ciKayitlari(claims: readonly Claim[]): Claim[] {
  return claims.filter((c) => c.id.startsWith('ci-'));
}

export interface MakbuzGirdi {
  projectName: string;
  /** Makbuzun üretildiği an (ISO-8601). */
  at: string;
  items: readonly PassportItem[];
  claims: readonly Claim[];
  log: readonly LogEntry[];
  ledger: VerificationLedger;
  scope?: ScopeNotes;
  toolVersion: string;
  /** goal.md'deki hedef cümlesi (varsa) — beyandır, kanıt değil. */
  goalText?: string | null;
  /** package.json'daki test script'i (varsa): kopyalanabilir doğrulama adımı. */
  testKomutu?: string | null;
  /**
   * `.ocean/goal.md` dosyasında YAZILI teslim sözü sayısı. Pasaport boşken iki
   * ayrı gerçeği ayırmak için: söz hiç yazılmamış mı, yoksa yazılmış ama durum
   * kaydına henüz işlenmemiş mi (sync koşmamış). İkisine aynı cümleyi kurmak,
   * insanın yazdığı sözü "yok" saymak olurdu.
   */
  goalSozSayisi?: number;
  /** Ölçülmüş CI koşumları. Boşsa makbuz "CI kaydı yok" der. */
  ci?: readonly CiKosum[];
}

// ── markdown ─────────────────────────────────────────────────────────────────

/**
 * Pasaport boşken yazılacak dürüst cümle. İki ayrı gerçek, iki ayrı cümle:
 * söz yazılmamış olabilir ya da yazılmış ama henüz senkronlanmamıştır.
 */
function sozsuzMetin(goalSozSayisi: number | undefined): string {
  if (goalSozSayisi !== undefined && goalSozSayisi > 0) {
    return (
      `\`.ocean/goal.md\` dosyasında ${goalSozSayisi} teslim sözü yazılı, ama bu makbuzun dayandığı ` +
      'durum kaydında (`state.json`) henüz yok — büyük olasılıkla `topbeam sync` koşulmadı. ' +
      'Makbuz sözleri uydurmaz: aşağıda yalnız ölçülmüş kayıtlar var.'
    );
  }
  return (
    'Bu projede teslim sözü yazılmamış (`.ocean/goal.md` içinde `- [ ]` satırı yok) — ' +
    'onaylanacak madde olmadığı için bu makbuz bir teslim beyanı değil, yalnız bir kanıt dökümüdür.'
  );
}

const NE_DEMEK_DEGIL = [
  '"Ürün hatasız" demek değildir — makbuz yalnız yukarıdaki sözlerin ve ölçülen kayıtların kapsamı kadardır.',
  'Kanıt seviyesi kalite ölçüsü değildir: testin geçmesi, testin doğru şeyi ölçtüğünü göstermez.',
  'İnsan onayı, onaylayan kişinin kendi gözüyle gördüğü kadardır — Topbeam yalnız kaydı tutar.',
  'Kapsam dışında kalan iş burada görünmez: makbuz, ölçülmemiş bir şeyi "yok" saymaz, "bilmiyorum" der.',
  'Bu bir kayıttır, reklam değildir: sayılar ölçülmüştür, yüzde ve ilerleme iddiası yoktur.',
];

/** "Kendin doğrula" adımları — kopyalanabilir, salt-okunur, sıralı. */
interface DogrulamaBlogu {
  /** Kod bloğuna giren satırlar (yorum + komut). */
  satirlar: string[];
  /** Blok dışına düşen dürüst notlar. */
  notlar: string[];
}

function dogrulamaBlogu(g: MakbuzGirdi, commitler: readonly CommitKaydi[]): DogrulamaBlogu {
  const satirlar: string[] = [];
  const notlar: string[] = [];

  satirlar.push('# 1) Commit\'leri kendi gözünle gör — SHA\'lar bu depodan okundu');
  if (commitler.length > 0) {
    for (const c of commitler.slice(0, DOGRULAMA_COMMIT_MAX)) satirlar.push(`git show ${c.sha} --stat`);
  } else {
    const headler = headKimlikleri(g.claims);
    if (headler.length > 0) {
      for (const sha of headler.slice(0, DOGRULAMA_COMMIT_MAX)) satirlar.push(`git show ${sha} --stat`);
      notlar.push(
        'Commit özeti kaydı yok; yukarıdaki kimlikler kayıtların ölçüldüğü andaki HEAD\'dir (state.json).',
      );
    } else {
      satirlar.push('# (bu makbuzda commit kaydı yok — aşağıdaki "bilmedikleri" bölümüne bak)');
    }
  }

  satirlar.push('');
  satirlar.push('# 2) Testleri kendin koş — sayıyı makbuz değil, komut söyler');
  if (g.testKomutu !== undefined && g.testKomutu !== null && g.testKomutu !== '') {
    satirlar.push(g.testKomutu);
  } else {
    satirlar.push('# (test komutu kaydı yok: package.json içinde "test" script\'i tanımlı değil)');
  }

  satirlar.push('');
  satirlar.push('# 3) İnsan onaylarının değişmez kaydını oku (append-only defter)');
  satirlar.push(`cat .ocean/${PASSPORT_LOG_FILE}`);

  satirlar.push('');
  satirlar.push('# 4) Bu makbuzu sıfırdan yeniden üret — aynı girdi, aynı çıktı');
  satirlar.push('topbeam sync && topbeam makbuz');

  const ciClaims = ciKayitlari(g.claims);
  if (ciClaims.length > 0) {
    notlar.push(
      'CI kayıtları GitHub Actions\'tan okundu; koşum bağlantısı saklanmadığı için depodaki Actions sekmesinden kendin bakabilirsin.',
    );
  } else if ((g.ci ?? []).length === 0) {
    notlar.push('Bu makbuzda CI kaydı yok — doğrulama yalnız yerel kanıtlar üzerinden yapılır.');
  }
  return { satirlar, notlar };
}

/** Kapsam ("bilmedikleri") satırları — ölçülmüş sayılar; yoksa uydurulmaz. */
function kapsamSatirlari(scope: ScopeNotes | undefined): string[] {
  if (scope === undefined) {
    return [
      'Kapsam kaydı yok — bu makbuz, kapsam ölçümü eklenmeden önce yazılmış bir durumdan üretildi. `topbeam sync` koşunca neyin elendiği buraya yazılır.',
    ];
  }
  const c = scope.log;
  const rows: string[] = [];
  if (scope.disKapsamDuzenleme > 0) {
    rows.push(
      `Proje dışı düzenleme: ${scope.disKapsamDuzenleme} düzenleme bu proje kökünün dışındaydı — kayıtlara alınmadı.`,
    );
  }
  if (c.ilgisizBeyan > 0) {
    rows.push(`İlişkilendirilemeyen beyan: ${c.ilgisizBeyan} satır bu projeye bağlanamadı — log'a alınmadı.`);
  }
  if (scope.kontrolKomutu > 0) {
    rows.push(
      `Kayıt üretmeyen kontrol komutu: ${scope.kontrolKomutu} komut (tsc/eslint gibi) geçti/kaldı sayısı üretmez — sonuç uydurulmadı.`,
    );
  }
  if (scope.atlananOturum > 0) {
    rows.push(`Atlanan oturum: ${scope.atlananOturum} Claude Code oturumu başka bir dizinde kaydedilmiş.`);
  }
  if (scope.kisaltilanYol > 0) {
    rows.push(`Kısaltılan yol: ${scope.kisaltilanYol} yerde proje dışı mutlak yol "~/…" diye kısaltıldı.`);
  }
  if (scope.gitYok) {
    rows.push(
      'Git: bu dizin bir git deposu değil — commit kanıtı ve `git show` doğrulaması bu projede kapalı.',
    );
  }
  rows.push(
    `Log satır zinciri: ham ${c.hamToplam} satır (${c.hamKanit} kanıt · ${c.hamBeyan} beyan) → ` +
      `${c.ilgisizBeyan} ilişkisiz beyan elendi → ${c.tekillestirilen} tekrar tekilleşti → ` +
      `${c.kirpilan} satır sınırda kırpıldı → kayıtta ${c.tutulan} satır.`,
  );
  return rows;
}

/**
 * Makbuz metni — SAF ve deterministik (aynı girdi → aynı metin).
 * Tek sayfa, Markdown, tek başına okunur: pano.html'e ya da başka bir dosyaya
 * bağımlı değildir (yapıştırıldığı yerde anlamını korur).
 */
export function makbuzMetni(g: MakbuzGirdi): string {
  const s: string[] = [];
  const onayli = dogrulananSayisi(g.items, g.ledger);
  const toplam = g.items.length;
  const ozet = kanitOzeti(g.claims, g.ledger);
  const commitler = commitKayitlari(g.log);
  const sonTest = sonTestKaydi(g.claims);

  // ── başlık ──
  s.push(`# Teslim Makbuzu — ${g.projectName}`);
  s.push('');
  s.push(`Tarih : ${fmtTs(g.at)}  (${g.at})`);
  s.push(
    `Araç  : topbeam v${g.toolVersion} — deterministik özet: LLM yok; bu makbuz üretilirken ağa çıkılmadı (yalnız yerel kayıtlar okundu).`,
  );
  s.push(`Kaynak: .ocean/state.json (Claude Code transcript + git gerçekleri) · onaylar: .ocean/${PASSPORT_LOG_FILE}`);
  if (g.goalText !== undefined && g.goalText !== null && g.goalText.trim() !== '') {
    s.push(`Hedef : ${g.goalText.trim()}  (beyan — kanıt değil)`);
  }
  s.push('');
  s.push(
    'Bu makbuz kanıtları özetler, sonuç iddia etmez. Hiçbir satırına güvenmek zorunda değilsin: ' +
      '"Kendin doğrula" bölümündeki komutlar salt-okunurdur, kendi makinende çalıştır.',
  );
  s.push('');

  // ── teslim sözleri ──
  s.push(
    toplam > 0
      ? `## Teslim sözleri — ${onayli} / ${toplam} madde insan onaylı`
      : '## Teslim sözleri',
  );
  s.push('');
  if (toplam === 0) {
    s.push(sozsuzMetin(g.goalSozSayisi));
  } else {
    if (onayli === 0) {
      s.push(
        '**Hiçbir madde henüz insan onaylı değil.** Bu makbuz bir teslim onayı DEĞİLDİR; ' +
          'aşağıdaki kayıtların ne olduğunu ve nasıl doğrulanacağını gösterir.',
      );
      s.push('');
    }
    s.push('Tik yalnız terminal imzalı insan onayıyla gelir — kaydın kendi iddiası tik getirmez.');
    s.push('');
    for (const r of sozSatirlari(g.items, g.claims, g.ledger)) {
      s.push(`- [${r.onayli ? 'x' : ' '}] **${r.no}. ${r.title}**`);
      s.push(`      Durum  : ${r.durum}`);
      if (r.gerekce !== undefined) s.push(`      Gerekçe: ${r.gerekce}`);
      s.push(
        `      Kanıt  : ${r.kanit}${r.headler.length > 0 ? ` · ölçüm HEAD: ${r.headler.join(', ')}` : ''}`,
      );
    }
  }
  s.push('');

  // ── kanıt özeti ──
  s.push('## Kanıt özeti');
  s.push('');
  s.push(`- Kayıt (claim): ${ozet.toplam} toplam`);
  s.push(`  - dosya-kanıtı : ${ozet.dosya} — git diff ile transcript uyuşuyor`);
  s.push(`  - test-kanıtı  : ${ozet.test} — sayı test çıktısından okundu`);
  s.push(`  - insan onayı  : ${ozet.insanOnayi} — .ocean/${PASSPORT_LOG_FILE} defterinde terminal imzalı`);
  s.push(`  - doğrulanmadı : ${ozet.dogrulanmadi} — uygulandı görünüyor, doğrulanmadı`);
  if (ozet.kaynaksiz > 0) {
    s.push(
      `  - kanal kaydı yok: ${ozet.kaynaksiz} — kendini insan onaylı sayıyor ama defterde karşılığı yok (onay sayılmadı, kayıt silinmedi)`,
    );
  }
  s.push(
    g.ledger.dosyaVar
      ? `- Onay defteri: ${g.ledger.okunanSatir} satır okundu · ${g.ledger.gecerli.size} geçerli onay · ${g.ledger.reddedilenSatir} satır rozet hakkı vermedi`
      : `- Onay defteri: .ocean/${PASSPORT_LOG_FILE} yok — hiçbir kayıt insan onaylı sayılmadı`,
  );
  s.push(
    sonTest !== null
      ? `- Son test ölçümü: ${sonTest.text} — ${fmtTs(sonTest.createdAt)}`
      : '- Son test ölçümü: kayıt yok — bu makbuzda sayı okunmuş bir test koşumu bulunmuyor',
  );
  if (commitler.length > 0) {
    s.push(
      `- Commit: ${Math.min(commitler.length, COMMIT_MAX)} kayıt gösteriliyor (state'te ${commitler.length})`,
    );
    for (const c of commitler.slice(0, COMMIT_MAX)) {
      s.push(`  - \`${c.sha}\`  ${gun(c.ts)}  ${c.ozet}`);
    }
  } else {
    const headler = headKimlikleri(g.claims);
    s.push(
      headler.length > 0
        ? `- Commit: özet kaydı yok; kayıtların ölçüldüğü HEAD kimlikleri: ${headler.map((h) => `\`${h}\``).join(', ')}`
        : '- Commit: kayıt yok — bu makbuzda hiçbir commit kimliği ölçülmedi (SHA uydurulmaz)',
    );
  }
  const ci = g.ci ?? [];
  const ciClaims = ciKayitlari(g.claims);
  if (ci.length > 0) {
    s.push('- CI koşumu:');
    for (const k of ci) s.push(`  - ${k.ad}${k.durum !== undefined ? ` (${k.durum})` : ''}: ${k.url}`);
  } else if (ciClaims.length > 0) {
    s.push(`- CI koşumu: ${ciClaims.length} kayıt (koşum bağlantısı saklanmaz — depodaki Actions sekmesinden bak)`);
    for (const c of ciClaims) s.push(`  - ${c.text}`);
  } else {
    s.push('- CI koşumu: bu makbuzda CI kaydı yok — makbuz yalnız yerel kanıtlara dayanıyor');
  }
  s.push('');

  // ── kendin doğrula ──
  const d = dogrulamaBlogu(g, commitler);
  s.push('## Kendin doğrula (üçüncü kişi için)');
  s.push('');
  s.push('```sh');
  for (const l of d.satirlar) s.push(l);
  s.push('```');
  if (d.notlar.length > 0) {
    s.push('');
    for (const n of d.notlar) s.push(`- ${n}`);
  }
  s.push('');

  // ── bilmedikleri ──
  s.push('## Bu makbuzun bilmedikleri (kapsam)');
  s.push('');
  s.push('Gürültü kesildi, ama iz bırakılarak — aşağıdakiler bilerek kapsam dışında tutuldu:');
  s.push('');
  for (const r of kapsamSatirlari(g.scope)) s.push(`- ${r}`);
  s.push('');

  // ── ne demek DEĞİL ──
  s.push('## Bu makbuz ne demek DEĞİL');
  s.push('');
  for (const r of NE_DEMEK_DEGIL) s.push(`- ${r}`);
  s.push('');
  s.push(`_Topbeam v${g.toolVersion} · ${MAKBUZ_FILE} · deterministik · LLM yok · üretimi ağa çıkmaz._`);
  s.push('');

  return s.join('\n');
}

// ── tek dosya HTML (0 dış istek, JS yok) ─────────────────────────────────────

const HTML_CSS = `
:root{
  --bg:#04060d; --s1:#070a12; --s2:#0a0f18; --line:rgba(255,255,255,.055); --line2:rgba(255,255,255,.105);
  --tx:rgba(235,241,240,.93); --dim:rgba(205,217,217,.75); --muted:rgba(183,198,198,.63);
  --teal:#2dd4bf; --ok:#34d399; --cold:#5b6675;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 var(--sans);
  -webkit-font-smoothing:antialiased}
main{max-width:820px;margin:0 auto;padding:40px 20px 64px}
.eyebrow{font:600 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--teal)}
h1{font:600 26px/1.25 var(--sans);margin:12px 0 6px}
h2{font:600 15px/1.3 var(--sans);margin:34px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line2)}
.meta{color:var(--muted);font:12px/1.7 var(--mono);margin:0 0 4px;word-break:break-word}
.lead{color:var(--dim);margin:18px 0 0}
.panel{background:var(--s1);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}
ul{margin:8px 0;padding-left:20px}
li{margin:4px 0;color:var(--dim)}
.soz{list-style:none;padding:0;margin:12px 0}
.soz>li{background:var(--s2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:8px 0}
.tick{font:600 13px/1 var(--mono);margin-right:8px;color:var(--cold)}
.tick.on{color:var(--ok)}
.stitle{font-weight:600;color:var(--tx)}
.srow{display:block;color:var(--muted);font:12px/1.7 var(--mono);margin-top:4px;word-break:break-word}
.srow b{color:var(--dim);font-weight:600}
.on .srow.durum b{color:var(--ok)}
pre{background:#05080f;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;overflow-x:auto;
  font:12px/1.7 var(--mono);color:var(--dim);margin:10px 0}
code{font-family:var(--mono)}
.mono{font-family:var(--mono)}
a{color:var(--teal)}
footer{margin-top:38px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);
  font:11px/1.8 var(--mono)}
`;

/** Aynı verinin HTML hâli — tek dosya, gömülü stil, dış istek ve JS YOK. */
export function makbuzHtml(g: MakbuzGirdi): string {
  const onayli = dogrulananSayisi(g.items, g.ledger);
  const toplam = g.items.length;
  const ozet = kanitOzeti(g.claims, g.ledger);
  const commitler = commitKayitlari(g.log);
  const sonTest = sonTestKaydi(g.claims);
  const d = dogrulamaBlogu(g, commitler);

  const hedef =
    g.goalText !== undefined && g.goalText !== null && g.goalText.trim() !== ''
      ? `<p class="meta">Hedef : ${esc(g.goalText.trim())} (beyan — kanıt değil)</p>`
      : '';

  const sozBlok =
    toplam === 0
      ? `<p class="lead">${esc(sozsuzMetin(g.goalSozSayisi))}</p>`
      : `${
          onayli === 0
            ? '<p class="lead"><strong>Hiçbir madde henüz insan onaylı değil.</strong> Bu makbuz bir teslim onayı DEĞİLDİR; aşağıdaki kayıtların ne olduğunu ve nasıl doğrulanacağını gösterir.</p>'
            : ''
        }
      <p class="lead">Tik yalnız terminal imzalı insan onayıyla gelir — kaydın kendi iddiası tik getirmez.</p>
      <ul class="soz">${sozSatirlari(g.items, g.claims, g.ledger)
        .map(
          (r) => `<li class="${r.onayli ? 'on' : ''}"><span class="tick${r.onayli ? ' on' : ''}">${
            r.onayli ? '[x]' : '[ ]'
          }</span><span class="stitle">${r.no}. ${esc(r.title)}</span>
        <span class="srow durum"><b>Durum</b> · ${esc(r.durum)}</span>
        ${r.gerekce !== undefined ? `<span class="srow"><b>Gerekçe</b> · ${esc(r.gerekce)}</span>` : ''}
        <span class="srow"><b>Kanıt</b> · ${esc(r.kanit)}${
          r.headler.length > 0 ? ` · ölçüm HEAD: ${esc(r.headler.join(', '))}` : ''
        }</span></li>`,
        )
        .join('\n')}</ul>`;

  const commitBlok =
    commitler.length > 0
      ? `<li>Commit: ${Math.min(commitler.length, COMMIT_MAX)} kayıt gösteriliyor (state'te ${commitler.length})
        <ul>${commitler
          .slice(0, COMMIT_MAX)
          .map((c) => `<li><span class="mono">${esc(c.sha)}</span> · ${esc(gun(c.ts))} · ${esc(c.ozet)}</li>`)
          .join('\n')}</ul></li>`
      : (() => {
          const h = headKimlikleri(g.claims);
          return h.length > 0
            ? `<li>Commit: özet kaydı yok; kayıtların ölçüldüğü HEAD kimlikleri: <span class="mono">${esc(
                h.join(', '),
              )}</span></li>`
            : '<li>Commit: kayıt yok — bu makbuzda hiçbir commit kimliği ölçülmedi (SHA uydurulmaz)</li>';
        })();

  const ci = g.ci ?? [];
  const ciClaims = ciKayitlari(g.claims);
  const ciBlok =
    ci.length > 0
      ? `<li>CI koşumu:<ul>${ci
          .map(
            (k) =>
              `<li>${esc(k.ad)}${k.durum !== undefined ? ` (${esc(k.durum)})` : ''}: <a href="${esc(
                k.url,
              )}">${esc(k.url)}</a></li>`,
          )
          .join('\n')}</ul></li>`
      : ciClaims.length > 0
        ? `<li>CI koşumu: ${ciClaims.length} kayıt (koşum bağlantısı saklanmaz — depodaki Actions sekmesinden bak)<ul>${ciClaims
            .map((c) => `<li>${esc(c.text)}</li>`)
            .join('\n')}</ul></li>`
        : '<li>CI koşumu: bu makbuzda CI kaydı yok — makbuz yalnız yerel kanıtlara dayanıyor</li>';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#04060d">
<title>Teslim Makbuzu — ${esc(g.projectName)}</title>
<style>${HTML_CSS}</style>
</head>
<body>
<main>
  <header>
    <span class="eyebrow">Topbeam — teslim makbuzu</span>
    <h1>${esc(g.projectName)}</h1>
    <p class="meta">Tarih : ${esc(fmtTs(g.at))} (${esc(g.at)})</p>
    <p class="meta">Araç  : topbeam v${esc(g.toolVersion)} — deterministik özet: LLM yok; bu makbuz üretilirken ağa çıkılmadı (yalnız yerel kayıtlar okundu).</p>
    <p class="meta">Kaynak: .ocean/state.json (Claude Code transcript + git gerçekleri) · onaylar: .ocean/${esc(
      PASSPORT_LOG_FILE,
    )}</p>
    ${hedef}
    <p class="lead">Bu makbuz kanıtları özetler, sonuç iddia etmez. Hiçbir satırına güvenmek zorunda değilsin: aşağıdaki doğrulama komutları salt-okunurdur, kendi makinende çalıştır.</p>
  </header>

  <section class="panel">
    <h2>Teslim sözleri${toplam > 0 ? ` — ${onayli} / ${toplam} madde insan onaylı` : ''}</h2>
    ${sozBlok}
  </section>

  <section class="panel">
    <h2>Kanıt özeti</h2>
    <ul>
      <li>Kayıt (claim): ${ozet.toplam} toplam
        <ul>
          <li>dosya-kanıtı : ${ozet.dosya} — git diff ile transcript uyuşuyor</li>
          <li>test-kanıtı  : ${ozet.test} — sayı test çıktısından okundu</li>
          <li>insan onayı  : ${ozet.insanOnayi} — .ocean/${esc(PASSPORT_LOG_FILE)} defterinde terminal imzalı</li>
          <li>doğrulanmadı : ${ozet.dogrulanmadi} — uygulandı görünüyor, doğrulanmadı</li>
          ${
            ozet.kaynaksiz > 0
              ? `<li>kanal kaydı yok: ${ozet.kaynaksiz} — kendini insan onaylı sayıyor ama defterde karşılığı yok (onay sayılmadı, kayıt silinmedi)</li>`
              : ''
          }
        </ul>
      </li>
      <li>${
        g.ledger.dosyaVar
          ? `Onay defteri: ${g.ledger.okunanSatir} satır okundu · ${g.ledger.gecerli.size} geçerli onay · ${g.ledger.reddedilenSatir} satır rozet hakkı vermedi`
          : `Onay defteri: .ocean/${esc(PASSPORT_LOG_FILE)} yok — hiçbir kayıt insan onaylı sayılmadı`
      }</li>
      <li>${
        sonTest !== null
          ? `Son test ölçümü: ${esc(sonTest.text)} — ${esc(fmtTs(sonTest.createdAt))}`
          : 'Son test ölçümü: kayıt yok — bu makbuzda sayı okunmuş bir test koşumu bulunmuyor'
      }</li>
      ${commitBlok}
      ${ciBlok}
    </ul>
  </section>

  <section class="panel">
    <h2>Kendin doğrula (üçüncü kişi için)</h2>
    <pre><code>${esc(d.satirlar.join('\n'))}</code></pre>
    ${d.notlar.length > 0 ? `<ul>${d.notlar.map((n) => `<li>${esc(n)}</li>`).join('\n')}</ul>` : ''}
  </section>

  <section class="panel">
    <h2>Bu makbuzun bilmedikleri (kapsam)</h2>
    <p class="lead">Gürültü kesildi, ama iz bırakılarak — aşağıdakiler bilerek kapsam dışında tutuldu:</p>
    <ul>${kapsamSatirlari(g.scope)
      .map((r) => `<li>${esc(r)}</li>`)
      .join('\n')}</ul>
  </section>

  <section class="panel">
    <h2>Bu makbuz ne demek DEĞİL</h2>
    <ul>${NE_DEMEK_DEGIL.map((r) => `<li>${esc(r)}</li>`).join('\n')}</ul>
  </section>

  <footer>Topbeam v${esc(g.toolVersion)} · ${esc(MAKBUZ_HTML_FILE)} · deterministik · LLM yok · üretimi ağa çıkmaz<br>
  insan onayı yalnız .ocean/${esc(PASSPORT_LOG_FILE)} defterindeki terminal imzalı kayda dayanır</footer>
</main>
</body>
</html>
`;
}

// ── komut: topbeam makbuz ────────────────────────────────────────────────────

export interface MakbuzResult {
  ok: boolean;
  error?: string;
  mdPath?: string;
  htmlPath?: string;
  /** Defterle desteklenen insan onaylı madde sayısı. */
  sozOnayli?: number;
  sozToplam?: number;
}

/**
 * `topbeam makbuz` — state + defterden makbuzu üretir ve diske yazar.
 * Tarayıcı AÇMAZ, ağa çıkmaz, hiçbir şeyi göndermez: yalnız dosya yolu verir.
 */
export async function runMakbuz(
  cwd: string,
  opts: { now?: Date; html?: boolean } = {},
): Promise<MakbuzResult> {
  const now = opts.now ?? new Date();
  const state: OceanState | null = await readState(cwd);
  if (state === null) {
    return {
      ok: false,
      error:
        "Bu proje Topbeam'e bağlı değil (ya da .ocean/state.json okunamadı). Önce: topbeam init, sonra: topbeam sync",
    };
  }
  const ledger = await readLedger(cwd);
  const goalText = await readGoal(cwd);
  // Sözler goal.md'den de sayılır: pasaport boşsa "yazılmamış" ile "senkronlanmamış"
  // birbirine karıştırılmasın (insanın yazdığı söz "yok" sayılamaz).
  const goalSozSayisi = (await readGoalItems(cwd)).length;

  // Test komutu PROJEDEN okunur (package.json). Yoksa uydurulmaz.
  let testKomutu: string | null = null;
  try {
    const scripts = scriptsFromPackageJson(await readFile(join(cwd, 'package.json'), 'utf8'));
    if (typeof scripts.test === 'string' && scripts.test !== '') testKomutu = 'npm test';
  } catch {
    // package.json yok — doğrulama adımı dürüstçe "kayıt yok" der.
  }

  const girdi: MakbuzGirdi = {
    projectName: state.projectName,
    at: now.toISOString(),
    items: state.passport,
    claims: state.claims,
    log: state.log,
    ledger,
    ...(state.scope !== undefined ? { scope: state.scope } : {}),
    toolVersion: state.tool_version,
    goalText,
    testKomutu,
    goalSozSayisi,
    // CI toplayıcısı bu sürümde yok: ölçülmemiş koşum uydurulmaz, liste boş kalır.
    ci: [],
  };

  await writeMakbuz(cwd, makbuzMetni(girdi));
  const htmlIstendi = opts.html === true;
  if (htmlIstendi) await writeMakbuzHtml(cwd, makbuzHtml(girdi));

  return {
    ok: true,
    mdPath: makbuzPath(cwd),
    ...(htmlIstendi ? { htmlPath: makbuzHtmlPath(cwd) } : {}),
    sozOnayli: dogrulananSayisi(state.passport, ledger),
    sozToplam: state.passport.length,
  };
}
