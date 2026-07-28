/**
 * Sıradaki-tek-hareket kartı üreticisi (GPT spec 6 alan — ürünün kalbi).
 *
 * KART ZEKÂSI. Kart yalnız DOĞRU olmakla yetinmez; doğrulanmamış işler
 * arasından RİSKİ EN YÜKSEK olanı seçer ve "Neden bu?" cümlesinde seçim
 * gerekçesini açık açık söyler. Kural değişirse gerekçe cümlesi de değişir —
 * kullanıcı zekâyı orada hisseder.
 *
 * ÖNCELİK SIRASI (RULE_ORDER, ilk eşleşen kazanır):
 *  1. kirik-test   — test çıktısında başarısız/hata kaydı. Kırık test dururken
 *                    üstüne konan her iş şüphelidir → her şeyin önünde. AMA
 *                    AYNI DİZİNDE sonradan yeşil bir koşum varsa manşete çıkmaz
 *                    (aşağı bak); bayat kayıt ise TARİHİYLE birlikte yazılır.
 *  2. kritik-dosya — doğrulanmamış iş ödeme/kimlik/şema/yapılandırma dosyasına
 *                    dokunmuş: sessiz hatanın en pahalı olduğu yer.
 *  3. kayip-riski  — çok dosyalı küme, git kaydında izi yok: en çok emek, en az kanıt.
 *  4. bayat        — doğrulanmamış işlerin HEPSİ eski (taze iş yok) → en uzun bekleyen.
 *  5. kume         — aynı oturumdaki doğrulanmamış kümenin en kapsamlısı
 *                    (tek dosyalık ufak dokunuş yerine kümenin merkezi).
 *  6. en-yeni      — temel kural: en son dokunulan doğrulanmamış iş.
 * Doğrulanmamış iş kalmadıysa: insan-onayi-bekliyor → tamam / kayit-yok.
 *
 * DETERMİNİZM: LLM yok, ağ yok, rastgelelik yok. Her kural yalnız ölçülmüş
 * yapısal sinyallerden (Claim.signals) ve zaman damgalarından karar verir;
 * iddia METNİ ayrıştırılmaz (metin eşleştirme yanlış pozitif üretir). Eşitlik
 * her yerde sabit anahtarla çözülür (createdAt, sonra id) → aynı girdi, aynı kart.
 *
 * DÜRÜSTLÜK (ihlal = red):
 * - fact ve factLevel seçilen claim'den AYNEN gelir. HİÇBİR kural kanıt
 *   seviyesini yükseltmez: doğrulanmadı → doğrulanmadı kalır. Kurallar yalnız
 *   SIRALAMA ve GEREKÇE değiştirir, gerçeği değiştirmez.
 * - Kanıt satırları yalnız claim'de o türde kanıt VARSA dolar; yoksa null
 *   (UI "kayıt yok" gösterir, alarm değil).
 * - Gerekçe cümlesi yalnız kayıttan okunan sayılarla konuşur (dosya sayısı,
 *   başarısız test sayısı, gün farkı). Tahmin, yüzde, motivasyon yok.
 * - Sinyal yoksa kural sessizce düşer (0/false varsayılmaz) → kart temel
 *   kurala geri sarar. Sinyalsiz (eski) state.json'lar bu yüzden bozulmaz.
 * - Çalışmayacak komut ÖNERİLMEZ: git deposu olmayan dizinde 'git status'
 *   göstermek sahte affordance'tır (kullanıcıyı hata mesajına yollar) →
 *   o dalda hareket insan onayına döner (CardOptions.isGitRepo === false).
 * - KART KENDİ LOG'UYLA ÇELİŞMEZ: aynı DİZİNDE daha SONRA yeşil bir test
 *   koşumu kaydedildiyse, eski kırık koşum manşete çıkarılmaz. Kayıt silinmez
 *   (log'da durur) — yalnız "sıradaki hareket" olmaktan düşer.
 * - TAZELİK YALAN SÖYLEMEZ: kart bugün üretilir ama gösterdiği gerçek eski
 *   olabilir. Bu yüzden kartta gerçeğin kendi TARİHİ (factDate) durur ve bayat
 *   bir kırık koşum manşete çıkarken tarihini + yaşını AÇIKÇA yazar — "kart
 *   güncellendi" damgası eski bir hatayı bugünün ölçümü gibi göstermez.
 * - Gerekçe cümlesinde bir test sayısı geçiyorsa HANGİ KOMUTA ait olduğu da
 *   yazar (yanlış atıf şüphesinin panzehiri); komut kayıttan gelir, uydurulmaz.
 */
import { commandSegments, isTestLikeCommand } from './collect/claude.ts';
import type { Card, CardRule, Claim, ClaimSignals, CardEvidence, NextAction } from './types.ts';

// ── dış tipler ───────────────────────────────────────────────────────────────

export interface CardOptions {
  /** Projenin package.json scripts alanı (komut önerisi için; fs okuma sync katmanında). */
  scripts?: Readonly<Record<string, string>>;
  /**
   * Dizin git deposu mu (collectGit.isGit). undefined = BİLİNMİYOR — bu durumda
   * kart eski davranışını sürdürür (varsayım yapılmaz). Yalnız KESİN false
   * bilgisi git komutu önermeyi kapatır: çalıştırılınca hata veren komut
   * sahte affordance'tır ("hiçbir yere gitmeyen çizgi").
   */
  isGitRepo?: boolean;
  /** updatedAt ve "bayat" hesabı için sabit zaman (test determinizmi). */
  now?: Date;
}

/** Kart montajının komut önerirken bildiği proje gerçekleri. */
interface Cevre {
  scripts: Readonly<Record<string, string>>;
  isGitRepo?: boolean;
}

/** Kart ana butonunun göstereceği CLI komutu (pano statik — kullanıcı kopyalar). */
export function verifyCommand(claimId: string): string {
  return `topbeam verify ${claimId}`;
}

/** package.json metninden scripts alanını güvenle çıkar (bozuk JSON → {}). */
export function scriptsFromPackageJson(jsonText: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ── eşikler (tek yerde, gerekçeleriyle) ──────────────────────────────────────

export const HEURISTIC = {
  /** Bu sayıda ve daha çok dosyalı, git izi olmayan küme = kaybolma riski. */
  kayipRiskiDosya: 4,
  /** Doğrulanmamış işlerin HEPSİ bu kadar gün eskiyse "bayat" (taze iş yok). */
  bayatGun: 3,
  /**
   * Kırık test kaydı bu yaştan (gün) eskiyse manşet cümlesi kaydın TARİHİNİ ve
   * YAŞINI açıkça yazar.
   *
   * NEDEN 7: bir çalışma haftası. Aynı test bir hafta boyunca bir daha
   * koşmadıysa o sonuç artık "bugünün ölçümü" değildir; kartın taze damgasıyla
   * yan yana durunca kullanıcıya bugün kırılmış gibi okunur (üye jürisinin
   * yakaladığı yanılgı: 17 gün önceki hata, bugünün tarihiyle).
   *
   * NEDEN MANŞETTEN DÜŞÜRMÜYORUZ (bilinçli karar): yeşile döndüğü kayıtlarda
   * GÖRÜNMEYEN bir kırık koşumu sırf eskidiği için gizlemek, dürüstlük yasasını
   * yaşlandırma ile delmek olurdu — kayıt hâlâ bilinen tek sonuç. Yanıltıcı olan
   * kaydın kendisi değil, TARİHSİZ gösterilmesiydi → etiketliyoruz, saklamıyoruz.
   * (Yeşillenen kayıt zaten bir üst mekanizmayla manşetten düşer.)
   */
  bayatKirikGun: 7,
  /** Küme kuralının tetiklenmesi için aynı oturumda gereken doğrulanmamış kayıt. */
  kumeEnAz: 2,
  /** Gerekçe cümlesinde ad ad sayılan kritik dosya sayısı. */
  kritikAdMax: 2,
  /**
   * 128+N = süreç SİNYAL ile öldü (143=SIGTERM/zaman aşımı, 130=Ctrl-C,
   * 137=SIGKILL). Bu bir test başarısızlığı değil, KESİNTİdir → kırık sayılmaz.
   * Dogfood dersi: exit 143'ü "kırık test" diye kartın tepesine koymak yanlış alarmdı.
   */
  sinyalExitTabani: 128,
  /**
   * Karta konabilecek komutun üst sınırı. Uzun/çok satırlı kabuk zinciri
   * kopyalanabilir buton olmaz — kırpılmış komut SAHTE AFFORDANCE'tır
   * (çalıştırılınca başka şey yapar). Sınırı aşarsa komut hiç verilmez.
   */
  komutMax: 120,
  /**
   * Gerekçe cümlesine ATIF olarak konabilecek komutun üst sınırı. Cümlenin
   * içine giren komut kısa olmalı — uzun kabuk zinciri gerekçeyi okunmaz yapar,
   * o durumda atıf hiç verilmez (komut zaten claim metninde ve kanıt satırında).
   */
  komutEtiketMax: 48,
} as const;

/** Kural öncelik sırası — testler bu sırayı kilitler. */
export const RULE_ORDER: readonly CardRule[] = [
  'kirik-test',
  'kritik-dosya',
  'kayip-riski',
  'bayat',
  'kume',
  'en-yeni',
] as const;

// ── kritik dosya sınıflandırması ─────────────────────────────────────────────

/** Kritik dosya türü — ağırdan hafife (KRITIK dizisindeki sıra = önem sırası). */
export type KritikTur = 'odeme' | 'kimlik' | 'sema' | 'yapilandirma';

interface KritikKural {
  tur: KritikTur;
  /** Gerekçe cümlesinde geçen insan-okur etiket. */
  label: string;
  tokens: ReadonlySet<string>;
}

/**
 * Sıra = önem sırası (ödeme > kimlik > şema > yapılandırma). Ürün kararı:
 * para ve kimlik doğrudan zarar; şema geri alınamaz; yapılandırma yayılımı geniş.
 *
 * Eşleşme TOKEN TAMLIĞI ile yapılır (yolun parçaları + camelCase sınırları),
 * alt-dizge ile değil: 'author.ts' auth sayılmaz, 'tokens.css' kimlik sayılmaz.
 * Bilinçli tercih: kaçırmak (false negative) yanlış suçlamaktan (false positive)
 * iyidir — yanlış "kritik" etiketi kartın güvenilirliğini yer.
 */
const KRITIK: readonly KritikKural[] = [
  {
    tur: 'odeme',
    label: 'ödeme',
    tokens: new Set([
      'payment', 'payments', 'odeme', 'billing', 'invoice', 'invoices', 'checkout',
      'stripe', 'paddle', 'subscription', 'subscriptions', 'purchase', 'purchases',
      'iap', 'refund', 'refunds', 'payout', 'payouts', 'pricing',
    ]),
  },
  {
    tur: 'kimlik',
    label: 'kimlik/oturum',
    tokens: new Set([
      'auth', 'authentication', 'authorization', 'login', 'logout', 'signin', 'signup',
      'session', 'sessions', 'password', 'passwords', 'oauth', 'jwt', 'credential',
      'credentials', 'permission', 'permissions', 'rbac',
    ]),
  },
  {
    tur: 'sema',
    label: 'veri şeması',
    tokens: new Set(['migration', 'migrations', 'migrate', 'schema', 'schemas', 'prisma', 'ddl']),
  },
  {
    tur: 'yapilandirma',
    label: 'yapılandırma',
    tokens: new Set([
      'env', 'dotenv', 'config', 'configs', 'configuration', 'settings', 'secrets',
      'dockerfile', 'nginx', 'entrypoint',
    ]),
  },
];

/**
 * Yolu token'lara ayır: yol/nokta/tire ayraçları + camelCase sınırları.
 * "src/authService.ts" → ['src','auth','service','ts'] · ".env.local" → ['env','local']
 */
export function pathTokens(path: string): string[] {
  return path
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());
}

/** Tek yolun kritik türü (en ağır eşleşme) — yoksa null. */
export function kritikTur(path: string): KritikTur | null {
  const tokens = new Set(pathTokens(path));
  for (const kural of KRITIK) {
    for (const t of tokens) {
      if (kural.tokens.has(t)) return kural.tur;
    }
  }
  return null;
}

interface KritikBulgu {
  tur: KritikTur;
  label: string;
  /** Önem sırası indeksi (küçük = daha kritik). */
  agirlik: number;
  /** Eşleşen yollar (kayıttan, uydurulmaz). */
  paths: string[];
}

/** Claim'in kapsadığı yollarda en ağır kritik türü + eşleşen dosyalar. */
export function claimKritik(claim: Claim): KritikBulgu | null {
  const paths = claim.signals?.paths;
  if (paths === undefined || paths.length === 0) return null;
  let best: KritikBulgu | null = null;
  for (const p of paths) {
    const tur = kritikTur(p);
    if (tur === null) continue;
    const agirlik = KRITIK.findIndex((k) => k.tur === tur);
    if (best === null || agirlik < best.agirlik) {
      const kural = KRITIK[agirlik];
      best = { tur, label: kural === undefined ? tur : kural.label, agirlik, paths: [p] };
    } else if (agirlik === best.agirlik) {
      best.paths.push(p);
    }
  }
  return best;
}

/** Gerekçe cümlesinde dosya adları: en çok kritikAdMax tane, kalanı sayıyla. */
function adListesi(paths: readonly string[]): string {
  const shown = paths.slice(0, HEURISTIC.kritikAdMax).join(', ');
  const kalan = paths.length - HEURISTIC.kritikAdMax;
  return kalan > 0 ? `${shown} +${kalan}` : shown;
}

// ── küçük yardımcılar ────────────────────────────────────────────────────────

function sig(claim: Claim): ClaimSignals {
  return claim.signals ?? {};
}

/** createdAt desc, eşitlikte id asc — deterministik "en son dokunulan". */
function newestFirst(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((x, y) =>
    x.createdAt > y.createdAt ? -1 : x.createdAt < y.createdAt ? 1 : x.id.localeCompare(y.id),
  );
}

/** createdAt asc, eşitlikte id asc — "en uzun bekleyen". */
function oldestFirst(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((x, y) =>
    x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id.localeCompare(y.id),
  );
}

/** İki zaman damgası arasındaki TAM gün farkı; ts okunamazsa null (uydurma yok). */
function gunFarki(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0; // gelecekten gelen kayıt: yaş 0, "bayat" sayılmaz
  return Math.floor(ms / 86_400_000);
}

/**
 * ISO damgasının GÜN kısmı (YYYY-AA-GG) — cümlede geçen tarih. Yerel saat
 * dilimine çevrilmez (deterministik: aynı kayıt her makinede aynı tarihi verir);
 * biçim okunamıyorsa null döner ve cümle tarihsiz kurulur (uydurma yok).
 */
function tarihKisa(iso: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return m === null ? null : (m[1] ?? null);
}

/** Claim kanıtlarını kartın ÜÇ AYRI satırına eşle — olmayan tür null kalır. */
function evidenceLines(claim: Claim): CardEvidence {
  let gitDiff: string | null = null;
  let testOutput: string | null = null;
  let humanApproval: string | null = null;
  for (const e of claim.evidence) {
    if (e.kind === 'git-diff' && gitDiff === null) gitDiff = e.summary;
    else if (e.kind === 'test-output' && testOutput === null) testOutput = e.summary;
    else if (e.kind === 'human' && humanApproval === null) humanApproval = e.summary;
  }
  return { gitDiff, testOutput, humanApproval };
}

// ── varsayılan hareket / bilinmeyen / bitiş koşulu ───────────────────────────

/**
 * Karta konulabilir komut mu? Boş, çok satırlı ya da sınırı aşan kabuk
 * zincirleri elenir — kırpılmış/uygunsuz komut butonu sahte affordance olur.
 *
 * '…' TAŞIYAN KOMUT DA ELENİR: bu işaret metnin kırpıldığını ya da proje dışı
 * bir yolun maskelendiğini ('~/…') söyler. Kopyalanınca çalışmayacak bir komutu
 * butona koymak, kullanıcıyı hata mesajına yollamaktır.
 */
function kopyalanabilirKomut(cmd: string | undefined): string | undefined {
  if (cmd === undefined) return undefined;
  const c = cmd.trim();
  if (c === '' || c.length > HEURISTIC.komutMax || c.includes('\n') || c.includes('…')) return undefined;
  return c;
}

/** Doğrulanmamış claim için kanıt-yükseltme hareketi (package.json scriptlerinden). */
function upgradeAction(claim: Claim, cevre: Cevre): NextAction {
  const scripts = cevre.scripts;
  if (claim.kind === 'test') {
    // Test sonucu okunamamıştı → testi yeniden koş, okunur sonuç al.
    if (typeof scripts.test === 'string') {
      return { verb: 'Testleri yeniden çalıştır ve sonucu kaydet.', command: 'npm test' };
    }
    const ref = kopyalanabilirKomut(claim.evidence.find((e) => e.ref !== undefined)?.ref);
    return ref !== undefined
      ? { verb: 'Test komutunu yeniden çalıştır ve sonucu kaydet.', command: ref }
      : { verb: 'Testleri yeniden çalıştır ve sonucu kaydet.' };
  }
  // Dosya claim'i: en güçlü yükseltme yolu = projenin kendi test kapısı.
  if (typeof scripts.test === 'string') {
    return { verb: 'Testleri çalıştır.', command: 'npm test' };
  }
  if (typeof scripts.build === 'string') {
    return { verb: "Build alıp değişikliğin derlendiğini gör.", command: 'npm run build' };
  }
  /**
   * GİT-YOK DALI. Git deposu olmayan dizinde 'git status' önermek kullanıcıyı
   * hata mesajına yollar — çalışmayan komut, kartın güvenilirliğini yer.
   * O durumda tek dürüst yükseltme yolu insan gözüdür.
   */
  if (cevre.isGitRepo === false) {
    return {
      verb: 'Bu dizin git deposu değil — değişikliği kendi gözünle aç, kontrol et ve onayla.',
      command: verifyCommand(claim.id),
    };
  }
  return { verb: "Değişikliğin git'te göründüğünü kontrol et.", command: 'git status' };
}

/** Kırık/şüpheli test koşumunu tekrarlama hareketi — mümkünse AYNI komutla. */
function testTekrarAksiyonu(claim: Claim, scripts: Readonly<Record<string, string>>): NextAction {
  const ref = kopyalanabilirKomut(
    claim.evidence.find((e) => e.kind === 'test-output' && e.ref !== undefined)?.ref ??
      claim.evidence.find((e) => e.ref !== undefined)?.ref,
  );
  if (ref !== undefined) return { verb: 'Aynı test komutunu yeniden çalıştır.', command: ref };
  if (typeof scripts.test === 'string') {
    return { verb: 'Testleri yeniden çalıştır.', command: 'npm test' };
  }
  return { verb: 'Testleri yeniden çalıştır.' };
}

function upgradeUnknown(claim: Claim): string {
  if (claim.kind === 'test') return "Test koşumunun gerçek sonucu (geçti/kaldı sayısı) bilinmiyor.";
  return "Bu değişikliklerin git'te karşılığı görünmüyor — gerçekten uygulandı mı belirsiz.";
}

function upgradeDoneWhen(claim: Claim, cevre: Cevre): string {
  if (claim.kind === 'test') {
    return `Test çıktısından okunur bir geçti/kaldı sonucu alındığında (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır.`;
  }
  // Git yoksa "git kaydında göründüğünde" koşulu ERİŞİLEMEZ bir koşuldur → söylenmez.
  if (cevre.isGitRepo === false) {
    return `Test yeşil sonuç verdiğinde (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır — bu dizin git deposu olmadığı için dosya-kanıtı yolu kapalı.`;
  }
  return `Değişiklik git kaydında göründüğünde (dosya-kanıtı), test yeşil sonuç verdiğinde (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır.`;
}

// ── kural motoru ─────────────────────────────────────────────────────────────

/** Bir kuralın kararı: hangi claim, hangi gerekçe, (varsa) kurala özel metinler. */
interface Secim {
  claim: Claim;
  rule: CardRule;
  why: string;
  unknown?: string;
  action?: NextAction;
  doneWhen?: string;
}

interface Ctx extends Cevre {
  /** Tüm claim'ler (insan-onaylı dâhil). */
  all: readonly Claim[];
  /** Doğrulanmamışlar — en yeni önce. */
  unverified: readonly Claim[];
  now: Date;
}

/**
 * Kırık test sinyali: OKUNMUŞ başarısız sayısı ya da GERÇEK hata çıkışı.
 * Sinyalle ölen süreç (exit ≥ 128: zaman aşımı, Ctrl-C, kill) kırık SAYILMAZ —
 * o bir kesintidir; kesintiyi "test kırık" diye manşete çıkarmak yanlış alarmdır.
 */
function kirikTestSinyali(claim: Claim): { failed?: number; exit?: number } | null {
  const s = sig(claim);
  if (s.failedTests !== undefined && s.failedTests > 0) {
    return s.nonZeroExit !== undefined ? { failed: s.failedTests, exit: s.nonZeroExit } : { failed: s.failedTests };
  }
  if (s.nonZeroExit !== undefined && s.nonZeroExit > 0 && s.nonZeroExit < HEURISTIC.sinyalExitTabani) {
    return { exit: s.nonZeroExit };
  }
  return null;
}

// ── kırık testin ömrü: sonradan yeşillendi mi? ───────────────────────────────

/**
 * Claim'in kayıtlı KOMUT metni (test-output kanıtı öncelikli; yoksa ilk ref).
 * truth.ts test claim'lerine komutu ref olarak yazar — burada uydurulmaz.
 */
function komutRef(claim: Claim): string | undefined {
  return (
    claim.evidence.find((e) => e.kind === 'test-output' && e.ref !== undefined)?.ref ??
    claim.evidence.find((e) => e.ref !== undefined)?.ref
  );
}

/**
 * Tek argümanı karşılaştırma biçimine indirger: tırnak düşer, yol içeren
 * argüman SON İKİ parçasına iner. Böylece aynı koşumun mutlak/göreli/başka
 * kökten yazımları eşleşir ('/Users/x/proj/src/a.test.ts' ≡ 'src/a.test.ts')
 * ama farklı dosyalar ayrı kalır ('test/a.test.ts' ≢ 'src/a.test.ts') —
 * yalnız son parçaya inseydi aynı adlı iki dosya çakışırdı.
 * 'key=değer' biçiminde yalnız değer tarafı sadeleşir (bayrak adı korunur).
 */
const YOL_KUYRUK = 2;

function argSadelestir(tok: string): string {
  const eq = tok.indexOf('=');
  if (eq > 0) return `${tok.slice(0, eq)}=${argSadelestir(tok.slice(eq + 1))}`;
  const t = tok.replace(/^["']+/, '').replace(/["']+$/, '');
  if (!t.includes('/')) return t;
  const parts = t.split('/').filter((p) => p !== '' && p !== '.' && p !== '..' && p !== '~');
  if (parts.length === 0) return t;
  return parts.slice(-YOL_KUYRUK).join('/');
}

/**
 * Komut metnini KARŞILAŞTIRMA anahtarına indirger — yalnız "aynı koşum mu?"
 * sorusu için; gösterimde komut AYNEN kalır (dürüstlük: kullanıcıya değiştirilmiş
 * komut gösterilmez).
 * - boşluk farkları tekilleşir, küçük harfe iner
 * - baştaki 'cd <yol> &&' zinciri düşer (aynı komut, başka dizinden koşulmuş)
 * - yol argümanları son parçalarına iner (proje kökü farkı eşleşmeyi bozmaz)
 * - 'npm run test' ≡ 'npm test' ≡ 'npm t' (aynı kapı, üç yazım)
 * Deterministik: aynı metin → aynı anahtar, ağ/LLM yok.
 */
export function normalizeCommand(cmd: string): string {
  let c = cmd.trim().replace(/\s+/g, ' ');
  let onceki = '';
  while (c !== onceki) {
    onceki = c;
    c = c.replace(/^(?:cd|pushd)\s+(?:"[^"]*"|'[^']*'|[^\s"'])+\s*(?:&&|;)\s*/i, '');
  }
  c = c
    .split(' ')
    .map(argSadelestir)
    .filter((t) => t !== '')
    .join(' ')
    .toLowerCase();
  c = c.replace(/^(npm|pnpm|yarn|bun) run /, '$1 ');
  c = c.replace(/^npm t$/, 'npm test');
  return c;
}

/**
 * Bir koşumun kimliği: NEREDE (varsa açık `cd` hedefi) + NE (zincirdeki gerçek
 * test parçaları). Çıktı filtreleri (| grep, | head, 2>&1) kimliğe girmez —
 * aynı testi başka bir grep'le süzmek başka bir koşum yapmaz.
 */
interface Kosum {
  /** Açık `cd` hedefi (son iki parça). Yoksa null = dizin bilinmiyor. */
  scope: string | null;
  /** Test çekirdeği — test parçası yoksa komutun tamamının normali. */
  core: string;
}

/**
 * Zincirdeki SON `cd/pushd` hedefi — komutun gerçekten koştuğu dizin.
 * Hedef parça parça tırnaklı olabilir (`cd ~/Desktop/"Ekin Nasip"/proje`);
 * tırnaklar hedefin İÇİNDEN de düşer, yoksa aynı dizinin iki yazımı iki ayrı
 * kapsam sanılırdı.
 */
function cdHedefi(cmd: string): string | null {
  const re = /(?:^|&&|\|\||;|\||\n)\s*(?:cd|pushd)\s+((?:"[^"]*"|'[^']*'|[^\s"'])+)/g;
  let son: string | null = null;
  let m = re.exec(cmd);
  while (m !== null) {
    const t = (m[1] ?? '').replace(/["']/g, '');
    if (t !== '' && t !== '-') son = argSadelestir(t).toLowerCase();
    m = re.exec(cmd);
  }
  return son;
}

/** Yönlendirmeleri (2>&1, >/dev/null, < girdi) düşür — kimliğin parçası değiller. */
function yonlendirmeSil(seg: string): string {
  return seg.replace(/\d?>>?\s*&?\d?\S*/g, ' ').replace(/<\s*\S+/g, ' ');
}

/**
 * Komuttan koşum kimliği çıkar.
 *
 * commandSegments/isTestLikeCommand collect katmanından gelir — "test komutu
 * nedir" sorusunun TEK gerçek kaynağı orası; burada ikinci bir liste tutmak
 * iki tanımın ayrışmasına yol açardı.
 *
 * DİKKAT: bölme HAM metin üzerinde yapılır — çok satırlı kabuk bloklarında
 * SATIR SONU bir komut ayracıdır; önce boşlukları tekilleştirseydik ayraç
 * silinir, koca blok tek "komut" sanılırdı (dogfood'da görülen hata).
 */
export function parseKosum(cmd: string): Kosum | null {
  const ham = cmd.trim();
  if (ham === '') return null;
  const testParcalari = commandSegments(ham)
    .filter((seg) => isTestLikeCommand(seg))
    .map((seg) => normalizeCommand(yonlendirmeSil(seg)))
    .filter((seg) => seg !== '');
  const core = testParcalari.length > 0 ? testParcalari.join(' && ') : normalizeCommand(ham);
  if (core === '') return null;
  return { scope: cdHedefi(ham), core };
}

/**
 * İki komut AYNI koşum mu? Çekirdek aynı olmalı; dizin ise yalnız İKİ tarafta
 * da açıkça yazılmışsa karşılaştırılır (biri yazmamışsa dizin bilinmiyordur —
 * uydurulmaz). Farklı alt-projelerde açıkça koşulan aynı komut eşleşmez.
 */
export function sameTestRun(a: string, b: string): boolean {
  const ka = parseKosum(a);
  const kb = parseKosum(b);
  if (ka === null || kb === null) return false;
  if (ka.core !== kb.core) return false;
  return ka.scope === null || kb.scope === null || ka.scope === kb.scope;
}

/** Claim'in koşum kimliği — komut kaydı yoksa yok (eşleştirme yapılamaz). */
function kosumAnahtari(claim: Claim): Kosum | null {
  const ref = komutRef(claim);
  return ref === undefined ? null : parseKosum(ref);
}

/** a zamanı b'den KESİN sonra mı? Okunamazsa metin sırasına düşer (deterministik). */
function sonraMi(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta > tb;
  return a > b;
}

/** Claim, "aynı komut sonradan temiz geçti" kanıtı mı? (0 başarısız + geçen test var, hata çıkışı yok) */
function yesilKosum(claim: Claim): boolean {
  const s = sig(claim);
  return (
    s.failedTests === 0 &&
    s.passedTests !== undefined &&
    s.passedTests > 0 &&
    !(s.nonZeroExit !== undefined && s.nonZeroExit > 0)
  );
}

/**
 * Açık `cd` hedefi yazılmamış koşumun dizini = PROJE KÖKÜ.
 *
 * Topbeam tek projeye bağlıdır (.ocean o projenin içindedir), dolayısıyla dizin
 * belirtmeden koşulan bir komut o projenin kökünde koşmuştur. Sentinel gerçek
 * bir yol olamayacak bir karakterle başlar ki 'kok' adlı bir dizinle karışmasın.
 */
const PROJE_KOKU = '\u0000proje-koku';

/** Koşumun proje-göreli dizini (açık `cd` hedefi ya da proje kökü). */
function dizin(k: Kosum): string {
  return k.scope ?? PROJE_KOKU;
}

/**
 * Yeşil koşum, kırık koşumu manşetten düşürür mü?
 *
 * BİRİNCİL ÖLÇÜT DİZİN: aynı dizinde daha sonra yeşil bir test koşumu
 * kaydedildiyse düşürür — komut metni birebir aynı olmasa bile. Eski davranış
 * komut ÇEKİRDEĞİNE bağlıydı; o yüzden 'node --test src/a.test.ts' kırığı,
 * aynı dizinde sonradan yeşil geçen 'npm test' kaydına rağmen manşette kalıyordu
 * (kart kendi log'uyla çelişiyordu — üye jürisinin maddesi).
 *
 * ÇEKİRDEK EŞLEŞMESİ EK SİNYAL olarak durur: dizin bilgisi iki taraftan birinde
 * yoksa (biri açıkça `cd` yazmış, öteki yazmamış) aynı çekirdek yine de aynı
 * koşumdur. Böylece "proje kökü farklı yazılmış aynı komut" eşleşmesi korunur.
 *
 * BİLİNEN SINIR (dürüstçe): dizin bazlı eşleşme, aynı dizinde koşan DAR bir
 * yeşil koşumun (tek test dosyası) GENİŞ bir kırık koşumu da manşetten
 * düşürmesine izin verir — koşumun kapsam genişliği ölçülemez, karşılaştırma
 * uydurma olurdu. Bu düşürme "test düzeldi" demek DEĞİLDİR: kayıt log'da aynen
 * durur, kart yalnız onu "sıradaki hareket" olarak öne çıkarmaz.
 */
function yesilDusururMu(kirik: Kosum, yesil: Kosum): boolean {
  if (dizin(kirik) === dizin(yesil)) return true; // aynı dizin → düşer
  if (kirik.core !== yesil.core) return false;
  // Çekirdek aynı: dizin yalnız İKİ tarafta da açıkça yazılmışsa ayırır.
  return kirik.scope === null || yesil.scope === null;
}

/**
 * Kırık test kaydı SONRADAN yeşillendi mi?
 *
 * Kural: kırık kaydın dizininde (yukarı bak) DAHA SONRA 0 başarısız + >0 geçen
 * bir koşum kaydedildiyse bu kırık kayıt geçmiştir, manşetten düşer.
 *
 * Muhafazakâr taraf: komut kaydı yoksa DÜŞMEZ (kırık kalır) — yanlış
 * "temizlendi" demektense fazladan uyarmak yeğdir.
 */
function sonradanYesillendi(claim: Claim, all: readonly Claim[]): boolean {
  const key = kosumAnahtari(claim);
  if (key === null) return false;
  for (const c of all) {
    if (c.id === claim.id) continue;
    if (!sonraMi(c.createdAt, claim.createdAt)) continue;
    if (!yesilKosum(c)) continue;
    const other = kosumAnahtari(c);
    if (other === null) continue;
    if (yesilDusururMu(key, other)) return true;
  }
  return false;
}

/**
 * Gerekçe cümlesine konabilecek komut ATFI: kısa, tek satır ve MUTLAK YOL
 * içermeyen komut. Sayının hangi koşuma ait olduğu böyle görünür; uzun ya da
 * yol sızdıran komutlarda atıf verilmez (kart manşeti dizin ağacı göstermez).
 */
function komutAtfi(claim: Claim): string | undefined {
  const raw = komutRef(claim);
  if (raw === undefined) return undefined;
  const c = raw.trim().replace(/\s+/g, ' ');
  if (c === '' || c.length > HEURISTIC.komutEtiketMax) return undefined;
  if (/(^|\s)[~/]/.test(c)) return undefined; // mutlak yol / ev dizini → sızıntı
  // Cümle içinde '%' yüzde-ilerleme, '!' alarm gibi okunur → o komut atıf olarak
  // verilmez (komut zaten claim metninde ve kanıt satırında aynen duruyor).
  if (/[%!]/.test(c)) return undefined;
  return c;
}

/** 1. KIRIK TEST — seviyeden bağımsız, insan onaylı olmayan her claim aday. */
function kuralKirikTest(ctx: Ctx): Secim | null {
  const adaylar = newestFirst(
    ctx.all.filter(
      (c) =>
        c.level !== 'insan-onayi' &&
        kirikTestSinyali(c) !== null &&
        !sonradanYesillendi(c, ctx.all),
    ),
  );
  const claim = adaylar[0];
  if (claim === undefined) return null;
  const s = kirikTestSinyali(claim);
  const failed = s?.failed;
  const atif = komutAtfi(claim);
  const atifOn = atif !== undefined ? `${atif}: ` : '';

  /**
   * BAYAT KAYIT ETİKETİ. Kayıt bayatKirikGun'den eskiyse cümle tarihi ve yaşı
   * söyler; kartın "bugün güncellendi" damgası eski hatayı taze göstermesin.
   * "Yeşile döndüğü görünmüyor" ancak komut kaydı VARSA söylenir — komutsuz
   * kayıtta eşleştirme yapılamadığı için o iddia kanıtsız olurdu.
   */
  const yas = gunFarki(claim.createdAt, ctx.now);
  const tarih = tarihKisa(claim.createdAt);
  const bayat = yas !== null && tarih !== null && yas >= HEURISTIC.bayatKirikGun;
  const yesilKaydiAranabilir = kosumAnahtari(claim) !== null;
  const bayatKuyruk = bayat
    ? ` ama kayıt ${tarih} tarihli — ${yas} gün önceki koşum, bugünün ölçümü değil${
        yesilKaydiAranabilir ? '; yeşile döndüğü kayıtlarda görünmediği için hâlâ önde' : ''
      }.`
    : null;

  const bas =
    failed !== undefined
      ? `Kayıtlarda kırık test var (${atifOn}${failed} başarısız)`
      : `Test komutu sıfır-dışı çıkışla bitti (${atifOn}exit ${s?.exit})`;
  const tazeKuyruk =
    failed !== undefined
      ? ' — kırık test dururken üstüne konan iş de şüpheli, o yüzden bu her şeyin önünde.'
      : ' — kırık koşum sinyali, doğrulanmamış işlerin önüne geçer.';
  const why = `${bas}${bayatKuyruk ?? tazeKuyruk}`;

  const bayatNot = bayat ? ` — bu sonuç ${tarih} tarihli koşumdan, ${yas} gün önce` : '';
  const unknown =
    failed !== undefined
      ? bayat
        ? `Testin şu an hâlâ kırık olup olmadığı bilinmiyor${bayatNot}.`
        : 'Testin şu an hâlâ kırık olup olmadığı bilinmiyor — bu sonuç son kayıtlı koşumdan.'
      : `Komutun neden hata koduyla bittiği ve şu an hâlâ hata verip vermediği bilinmiyor${bayatNot}.`;

  return {
    claim,
    rule: 'kirik-test',
    why,
    unknown,
    action: testTekrarAksiyonu(claim, ctx.scripts),
    doneWhen: `Aynı test komutu başarısız test kalmadan geçtiğinde (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır.`,
  };
}

/** 2. KRİTİK DOSYA — doğrulanmamış işler içinde en ağır dosya türü. */
function kuralKritikDosya(ctx: Ctx): Secim | null {
  const adaylar = ctx.unverified
    .map((claim) => ({ claim, k: claimKritik(claim) }))
    .filter((x): x is { claim: Claim; k: KritikBulgu } => x.k !== null)
    .sort((a, b) => {
      if (a.k.agirlik !== b.k.agirlik) return a.k.agirlik - b.k.agirlik;
      if (a.claim.createdAt !== b.claim.createdAt) return a.claim.createdAt > b.claim.createdAt ? -1 : 1;
      return a.claim.id.localeCompare(b.claim.id);
    });
  const pick = adaylar[0];
  if (pick === undefined) return null;
  return {
    claim: pick.claim,
    rule: 'kritik-dosya',
    why: `Doğrulanmamış işler içinde en riskli dosya burada (${pick.k.label}: ${adListesi(pick.k.paths)}) — sessiz bir hata en pahalıya burada patlar.`,
    unknown: `${pick.k.label} tarafına dokunan bu değişikliğin doğru çalıştığına dair hiçbir kayıt yok.`,
  };
}

/** 3. KAYIP RİSKİ — çok dosyalı küme, git kaydında izi yok. */
function kuralKayipRiski(ctx: Ctx): Secim | null {
  const adaylar = ctx.unverified
    .filter((c) => {
      const s = sig(c);
      return s.noGitTrace === true && s.fileCount !== undefined && s.fileCount >= HEURISTIC.kayipRiskiDosya;
    })
    .sort((a, b) => {
      const fa = sig(a).fileCount ?? 0;
      const fb = sig(b).fileCount ?? 0;
      if (fa !== fb) return fb - fa;
      if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  const claim = adaylar[0];
  if (claim === undefined) return null;
  const n = sig(claim).fileCount;
  return {
    claim,
    rule: 'kayip-riski',
    why: `Bu küme ${n} dosya — doğrulanmamış işlerin en büyüğü ve git kaydında hiç izi yok; en çok emek, en az kanıt burada.`,
    // git status bu kümeyi zaten göstermiyor (tanımı bu) → asıl soru commit'lendi mi.
    action: { verb: "Bu kümenin commit'lenip commit'lenmediğine bak.", command: 'git log --oneline -5' },
  };
}

/** 4. BAYAT — doğrulanmamış işlerin HEPSİ eski; taze iş yok → en uzun bekleyen. */
function kuralBayat(ctx: Ctx): Secim | null {
  if (ctx.unverified.length === 0) return null;
  const yaslar: number[] = [];
  for (const c of ctx.unverified) {
    const g = gunFarki(c.createdAt, ctx.now);
    if (g === null || g < HEURISTIC.bayatGun) return null; // taze (ya da okunamayan) iş var
    yaslar.push(g);
  }
  const claim = oldestFirst(ctx.unverified)[0];
  if (claim === undefined) return null;
  const gun = gunFarki(claim.createdAt, ctx.now) ?? 0;
  const enTaze = Math.min(...yaslar);
  const why =
    ctx.unverified.length === 1
      ? `Doğrulanmamış tek iş ${gun} gündür bekliyor — taze iş yok, sırada duran bu.`
      : `Doğrulanmamış işlerin en tazesi bile ${enTaze} gün önceden; ${gun} günle en uzun bekleyeni bu — hafızadan ilk düşecek olan.`;
  return { claim, rule: 'bayat', why };
}

/** 5. KÜME — aynı oturumdaki doğrulanmamış kayıtların en kapsamlısı. */
function kuralKume(ctx: Ctx): Secim | null {
  const bySession = new Map<string, Claim[]>();
  for (const c of ctx.unverified) {
    if (c.sessionId === undefined) continue;
    const list = bySession.get(c.sessionId);
    if (list === undefined) bySession.set(c.sessionId, [c]);
    else list.push(c);
  }

  let best: { claim: Claim; adet: number; dosya: number; sessionId: string } | null = null;
  for (const [sessionId, list] of [...bySession.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < HEURISTIC.kumeEnAz) continue;
    // Kümenin temsilcisi: en çok dosya kapsayan kayıt. Dosya sayısı ÖLÇÜLMÜŞ
    // değilse "en kapsamlısı" denemez → o oturum kümesi atlanır (dürüstlük).
    const olculen = list.filter((c) => sig(c).fileCount !== undefined);
    const temsilci = olculen.sort((a, b) => {
      const fa = sig(a).fileCount ?? 0;
      const fb = sig(b).fileCount ?? 0;
      if (fa !== fb) return fb - fa;
      if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
      return a.id.localeCompare(b.id);
    })[0];
    if (temsilci === undefined) continue;
    const dosya = sig(temsilci).fileCount ?? 0;
    if (
      best === null ||
      dosya > best.dosya ||
      (dosya === best.dosya && temsilci.createdAt > best.claim.createdAt)
    ) {
      best = { claim: temsilci, adet: list.length, dosya, sessionId };
    }
  }
  if (best === null) return null;
  return {
    claim: best.claim,
    rule: 'kume',
    why: `Aynı oturumdaki ${best.adet} doğrulanmamış kayıttan en kapsamlısı bu (${best.dosya} dosya) — bu küme tek tek değil, birlikte doğrulanır.`,
  };
}

/** 6. EN YENİ — temel kural (sinyal yoksa kart buraya geri sarar). */
function kuralEnYeni(ctx: Ctx): Secim | null {
  const claim = ctx.unverified[0];
  if (claim === undefined) return null;
  return { claim, rule: 'en-yeni', why: 'En son dokunulan ve henüz doğrulanmamış iş bu.' };
}

const KURALLAR: Readonly<Record<string, (ctx: Ctx) => Secim | null>> = {
  'kirik-test': kuralKirikTest,
  'kritik-dosya': kuralKritikDosya,
  'kayip-riski': kuralKayipRiski,
  bayat: kuralBayat,
  kume: kuralKume,
  'en-yeni': kuralEnYeni,
};

/** RULE_ORDER boyunca ilk eşleşen kural (deterministik). */
function secimYap(ctx: Ctx): Secim | null {
  for (const rule of RULE_ORDER) {
    const fn = KURALLAR[rule];
    if (fn === undefined) continue;
    const secim = fn(ctx);
    if (secim !== null) return secim;
  }
  return null;
}

/**
 * Seçimi karta çevir — TEK montaj noktası.
 * fact/factLevel/evidence buradan geçtiği için hiçbir kural seviye yükseltemez
 * ya da olmayan kanıt satırı uyduramaz.
 */
function kartYap(secim: Secim, cevre: Cevre, updatedAt: string): Card {
  return {
    id: secim.claim.id,
    fact: secim.claim.text, // AYNEN
    factLevel: secim.claim.level, // AYNEN — yükseltme yok
    factDate: secim.claim.createdAt, // gerçeğin kendi tarihi (kart tarihi DEĞİL)
    evidence: evidenceLines(secim.claim),
    unknown: secim.unknown ?? upgradeUnknown(secim.claim),
    action: secim.action ?? upgradeAction(secim.claim, cevre),
    why: secim.why,
    doneWhen: secim.doneWhen ?? upgradeDoneWhen(secim.claim, cevre),
    rule: secim.rule,
    updatedAt,
  };
}

// ── dış API ──────────────────────────────────────────────────────────────────

/**
 * Claim listesinden sıradaki-tek-hareket kartını üret.
 * fact/factLevel seçilen claim'den AYNEN gelir — kart seviye yükseltmez.
 */
export function buildCard(claims: readonly Claim[], opts: CardOptions = {}): Card {
  const now = opts.now ?? new Date();
  const updatedAt = now.toISOString();
  const scripts = opts.scripts ?? {};
  const cevre: Cevre = { scripts, ...(opts.isGitRepo !== undefined ? { isGitRepo: opts.isGitRepo } : {}) };

  // Durum 3a: hiç kayıt yok — sakin boş kart.
  if (claims.length === 0) {
    return {
      id: 'kart-bos',
      fact: 'Henüz kanıtlı iş kaydı yok.',
      factLevel: 'dogrulanmadi',
      evidence: { gitDiff: null, testOutput: null, humanApproval: null },
      unknown: 'Claude Code bu projede henüz iz bırakmadı ya da senkron hiç koşmadı.',
      action: { verb: 'Senkronu çalıştır.', command: 'topbeam sync' },
      why: 'Kart yalnız gerçek kayıtlardan üretilir; önce kayıtları toplamak gerekir.',
      doneWhen: 'İlk claim üretildiğinde kart gerçek işe geçer.',
      rule: 'kayit-yok',
      updatedAt,
    };
  }

  // Durum 1: doğrulanmamış iş — kural motoru riske göre seçer.
  const ctx: Ctx = {
    ...cevre,
    all: claims,
    unverified: newestFirst(claims.filter((c) => c.level === 'dogrulanmadi')),
    now,
  };
  const secim = secimYap(ctx);
  if (secim !== null) return kartYap(secim, cevre, updatedAt);

  // Durum 2: kanıtlı ama insan onayı yok → insan doğrulaması iste.
  // Burada da risk sırası geçerli: kritik dosyaya dokunan kanıtlı iş öne geçer.
  const evidenced = newestFirst(
    claims.filter((c) => c.level === 'dosya-kaniti' || c.level === 'test-kaniti'),
  );
  const kritikAdaylar = evidenced
    .map((claim) => ({ claim, k: claimKritik(claim) }))
    .filter((x): x is { claim: Claim; k: KritikBulgu } => x.k !== null)
    .sort((a, b) => a.k.agirlik - b.k.agirlik);
  const kritik = kritikAdaylar[0];
  const pickEvidenced = kritik?.claim ?? evidenced[0];
  if (pickEvidenced !== undefined) {
    return {
      id: pickEvidenced.id,
      fact: pickEvidenced.text,
      factLevel: pickEvidenced.level,
      factDate: pickEvidenced.createdAt,
      evidence: evidenceLines(pickEvidenced),
      unknown: 'Ürünün senin gözünle istenen davranışı verdiği henüz doğrulanmadı.',
      action: { verb: 'Sonucu kendin doğrula.', command: verifyCommand(pickEvidenced.id) },
      why:
        kritik !== undefined
          ? `Kanıtlı ama onay bekleyen işler içinde en riskli dosya bunda (${kritik.k.label}: ${adListesi(kritik.k.paths)}) — insan gözü en çok burada gerekiyor.`
          : 'Kanıtlı işler arasında insan onayı olmayan en yenisi bu.',
      doneWhen: `'${verifyCommand(pickEvidenced.id)}' ile insan onayı kaydedildiğinde (insan-onayı) bitti sayılır.`,
      rule: 'insan-onayi-bekliyor',
      updatedAt,
    };
  }

  // Durum 3b: her şey insan onaylı — sakin tam kart.
  const latest = newestFirst(claims)[0] as Claim; // claims.length > 0 garanti
  return {
    id: 'kart-tam',
    fact: latest.text,
    factLevel: latest.level,
    factDate: latest.createdAt,
    evidence: evidenceLines(latest),
    unknown: 'Şu an bekleyen doğrulanmamış iş görünmüyor.',
    action: { verb: 'Claude ile sıradaki işi başlat.' },
    why: 'Kayıtlı tüm işler insan onaylı.',
    doneWhen: 'Yeni iş kaydı düştüğünde kart güncellenir.',
    rule: 'tamam',
    updatedAt,
  };
}
