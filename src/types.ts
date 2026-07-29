/**
 * Topbeam veri modeli — tek gerçek kaynak.
 *
 * DÜRÜSTLÜK YASALARI (ürün anayasası, ihlal = red):
 * - Kanıtsız claim gösterilmez. "ÇALIŞIYOR" asla otomatik söylenmez — yalnız
 *   test-kanıtı veya insan-onayı ile. Kanıt yoksa etiket:
 *   "uygulandı görünüyor, doğrulanmadı".
 * - Özet üretimi DETERMİNİSTİK (LLM yok): transcript tool-use'ları + git
 *   gerçekleri. Assistant'ın "bitti, çalışıyor!" metni özete ASLA girmez.
 * - Yüzde-ilerleme, motivasyon sözü, kırmızı alarm yok. Sakin, dürüst,
 *   teknik-olmayan Türkçe UI metni.
 *
 * Şema değişirse SCHEMA_VERSION'ı artır (BuildPassport konvansiyonu).
 */

/**
 * 2: pasaport maddesi artık bir OTURUM birimi değil, `.ocean/goal.md`
 * içindeki insan yazımı TESLİM SÖZÜdür (id `soz-…`). Alan şekli aynı kaldı;
 * anlamı değişti — bu yüzden sürüm artırıldı. Eski state.json'lar okunmaya
 * devam eder: eski `birim-…` maddeleri listeden düşer, ama onayları
 * .ocean/passport.jsonl defterinde (append-only) durmaya devam eder.
 */
export const SCHEMA_VERSION = 2;

/**
 * Araç sürümü. `package.json.version` ile BİREBİR aynı olmak ZORUNDA —
 * bir nöbetçi test bunu kilitler (types.test.ts).
 *
 * Neden kilit var (2026-07-29'da yaşandı): burası elle yazıldığı için
 * `npm version patch` sonrası kaydı: paket 0.1.1 yayınlandı ama CLI, pano ve
 * MAKBUZ kendini `v0.1.0` diye tanıttı. Makbuz dışarıya gösterilen belgedir;
 * üstünde yanlış sürüm yazması, bu üründe kabul edilemez bir yanlış beyandır.
 */
export const TOOL_VERSION = '0.1.1';

/**
 * Proje kökünde Topbeam veri dizini ve durum dosyası.
 * NOT: dizin adı `.ocean` KALIR — marka Topbeam olsa da veri göçü riski
 * almamak için bilinçli olarak sabit tutuldu.
 */
export const OCEAN_DIR = '.ocean';
export const STATE_FILE = 'state.json';

// ── Kanıt seviyeleri ─────────────────────────────────────────────────────────

/**
 * Topbeam kanıt seviyesi enum'u (ürün spec'indeki 4 seviye, Türkçe anahtar).
 * - dosya-kaniti  : git diff + transcript uyuşuyor
 * - test-kaniti   : bash çıktısında geçen test sonucu
 * - insan-onayi   : kullanıcı verify etti
 * - dogrulanmadi  : kanıt yok — "uygulandı görünüyor, doğrulanmadı"
 */
export type EvidenceLevel =
  | 'dosya-kaniti'
  | 'test-kaniti'
  | 'insan-onayi'
  | 'dogrulanmadi';

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  'dosya-kaniti',
  'test-kaniti',
  'insan-onayi',
  'dogrulanmadi',
] as const;

/** UI etiketleri — sakin, teknik-olmayan Türkçe. Kırmızı alarm dili yok. */
export const EVIDENCE_LEVEL_LABELS_TR: Record<EvidenceLevel, string> = {
  'dosya-kaniti': 'Dosya kanıtı — git diff ile doğrulandı',
  'test-kaniti': 'Test kanıtı — test çıktısıyla doğrulandı',
  'insan-onayi': 'İnsan onayı — kullanıcı doğruladı',
  dogrulanmadi: 'Uygulandı görünüyor, doğrulanmadı',
};

/** BuildPassport EvidenceLevel karşılıkları (BP schema_version 1, core/types.ts). */
export type BpEvidenceLevel =
  | 'declared'
  | 'automatically_checked'
  | 'human_verified'
  | 'not_verified';

/**
 * Topbeam → BP seviye haritası (Keşif/BP raporu §2):
 * dosya-kaniti ≈ automatically_checked (type: git/file_analysis),
 * test-kaniti ≈ automatically_checked (type: command, exitCode'lu),
 * insan-onayi = human_verified, dogrulanmadi = not_verified.
 */
export const BP_LEVEL_MAP: Record<EvidenceLevel, BpEvidenceLevel> = {
  'dosya-kaniti': 'automatically_checked',
  'test-kaniti': 'automatically_checked',
  'insan-onayi': 'human_verified',
  dogrulanmadi: 'not_verified',
};

export function toBpLevel(level: EvidenceLevel): BpEvidenceLevel {
  return BP_LEVEL_MAP[level];
}

// ── Claim (iddia) ────────────────────────────────────────────────────────────

/**
 * Claim türü — kart heuristiği metin ayrıştırmak yerine bunu okur.
 * - dosya : dosya-değişikliği iddiası
 * - test  : test-koşumu iddiası
 * - durum : "çalışıyor" tipi durum iddiası — YALNIZ verify akışı üretir
 */
export type ClaimKind = 'dosya' | 'test' | 'durum';

/**
 * Claim'e bağlı YAPISAL sinyaller — kart heuristiğinin okuduğu tek girdi.
 *
 * Neden ayrı alan: kart, iddia METNİNİ ayrıştırmaz (metin ayrıştırma yanlış
 * pozitif üretir, dürüstlüğü aşındırır). Motor (truth.ts) neyi ölçtüyse onu
 * buraya yazar; kart yalnız buradan karar verir.
 *
 * Hepsi OPSİYONEL ve hepsi ölçülmüş gerçektir. Sinyal yoksa alan da yoktur
 * (0/false varsayımı YOK) — sinyalsiz claim'de zeki kurallar sessizce düşer,
 * kart temel kurala (en-yeni) geri sarar. Eski state.json'lardan okunan
 * claim'ler bu yüzden bozulmadan çalışır.
 */
export interface ClaimSignals {
  /** Claim'in kapsadığı dosya sayısı (dosya claim'leri). */
  fileCount?: number;
  /** Proje köküne göre kısa yollar (uzun listeler kırpılır — fileCount tam kalır). */
  paths?: string[];
  /** true = transcript'te düzenleme var, git kaydında izi YOK (kesin ölçüm). */
  noGitTrace?: boolean;
  /** Test çıktısından OKUNMUŞ başarısız test sayısı (uydurulmaz). */
  failedTests?: number;
  /** Test çıktısından OKUNMUŞ geçen test sayısı. */
  passedTests?: number;
  /** GERÇEK (varsayılmamış) sıfır-dışı exit kodu — komut hata ile bitti. */
  nonZeroExit?: number;
  /**
   * CI koşumu 'failure' ile bitti (GitHub Actions'tan OKUNDU, collect/ci.ts).
   *
   * Neden ayrı alan: CI sonucunda ne exit kodu ne de geçti/kaldı sayısı vardır.
   * Onu `nonZeroExit: 1` ya da `failedTests: 1` diye yazmak ölçülmemiş bir sayı
   * uydurmak olurdu — bu üründe kırmızı çizgi. Yalnız true yazılır; false ya da
   * "CI yeşil" diye bir sinyal YOKTUR (yeşil CI, lokal kırık koşumu temizlemez).
   */
  ciFailed?: boolean;
}

/** Bir iddiayı destekleyen tekil kanıt parçası. */
export interface ClaimEvidence {
  /** Kanıtın türü — nereden geldiği. */
  kind: 'git-diff' | 'transcript-tool-use' | 'test-output' | 'human';
  /** Tek satır insan-okur özet (maskeleme sonrası). */
  summary: string;
  /** Opsiyonel referans: commit hash, tool_use id, dosya yolu, komut metni. */
  ref?: string;
}

/**
 * Claim — deterministik motorun ürettiği tek iddia cümlesi.
 * Metin şablondan üretilir (LLM yok); level kanıttan türetilir, elle
 * yükseltilemez (insan-onayi yalnız verify akışından gelir).
 */
export interface Claim {
  id: string;
  /** Şablon-üretimi iddia cümlesi (TR). Örn: "3 dosya değişti: ..." */
  text: string;
  level: EvidenceLevel;
  evidence: ClaimEvidence[];
  /** Claim türü (kart heuristiği için yapısal sinyal). */
  kind?: ClaimKind;
  /** Ölçülmüş yapısal sinyaller (kart heuristiği bunları okur — metni değil). */
  signals?: ClaimSignals;
  /** Kaynak Claude Code oturumu (transcript dosya adı = sessionId). */
  sessionId?: string;
  createdAt: string; // ISO-8601
}

// ── Log history ──────────────────────────────────────────────────────────────

/**
 * Log satırının kaynağı:
 * - claude-beyan : Bash tool_use description alanı — Claude'un kendi niyet
 *   cümlesi. KANIT DEĞİL, beyan; UI'da "beyan" etiketiyle gösterilir.
 * - git          : git gerçekleri (commit/diff/status)
 * - test         : test komutu çıktısından çekilen sonuç satırı
 * - insan        : kullanıcının kendi notu / onayı
 * - ocean        : Topbeam'in kendi olayları (sync koştu, pasaport güncellendi).
 *   DEĞER 'ocean' kalır (şema uyumu); panoda etiketi "topbeam" gösterilir.
 */
export type LogSource = 'claude-beyan' | 'git' | 'test' | 'insan' | 'ocean';

/** Proje-özel LOG HISTORY satırı — kısa not + zaman + kaynak. */
export interface LogEntry {
  ts: string; // ISO-8601
  /** Kısa not (tek satır, maskeleme sonrası). */
  text: string;
  source: LogSource;
  sessionId?: string;
  /** Opsiyonel referans (commit hash, dosya yolu, komut). */
  ref?: string;
}

// ── Sıradaki-tek-hareket kartı (GPT spec — ürünün kalbi) ─────────────────────

/**
 * Kanıt bloğu — kartta ÜÇ AYRI satır olarak gösterilir.
 * null = "kayıt yok" (sakin gösterilir, alarm değil).
 */
export interface CardEvidence {
  /** Örn: "3 dosya değişti · +142/−8" */
  gitDiff: string | null;
  /** Örn: "12/12 test geçti (npm test, exit 0)" */
  testOutput: string | null;
  /** Örn: "Ekin doğruladı, 2026-07-28" */
  humanApproval: string | null;
}

/**
 * Kartı HANGİ kuralın seçtiği. "Neden bu?" cümlesinin makine karşılığı:
 * kural değişince gerekçe cümlesi de değişir (zekâ orada hissedilir).
 * Öncelik sırası card.ts → RULE_ORDER; her kuralın kendi fixture testi var.
 *
 * - kirik-test  : test çıktısında başarısız/hata kaydı — her şeyin önünde
 * - kritik-dosya: doğrulanmamış iş kimlik/ödeme/şema/yapılandırma dosyasına dokunmuş
 * - kayip-riski : büyük değişiklik kümesi, git kaydında izi yok
 * - bayat       : doğrulanmamış işlerin hepsi eski — en uzun bekleyen
 * - kume        : aynı oturumdaki doğrulanmamış kümenin en kapsamlısı
 * - en-yeni     : en son dokunulan doğrulanmamış iş (temel kural / geri sarma)
 * - insan-onayi-bekliyor : doğrulanmamış iş kalmadı, kanıtlı iş onay bekliyor
 * - kayit-yok / tamam    : boş ve tam kartlar
 */
export type CardRule =
  | 'kirik-test'
  | 'kritik-dosya'
  | 'kayip-riski'
  | 'bayat'
  | 'kume'
  | 'en-yeni'
  | 'insan-onayi-bekliyor'
  | 'kayit-yok'
  | 'tamam';

/** (d) Sıradaki tek hareket — tek fiil + mümkünse çalıştırılabilir komut. */
export interface NextAction {
  /** Tek fiil cümlesi. Örn: "Testleri çalıştır." */
  verb: string;
  /** Çalıştırılabilir komut (pano statik — kullanıcı kopyalar). Örn: "topbeam verify gorev-3" */
  command?: string;
}

/**
 * Card — ekranın EN BASKIN öğesi. Alanlar GPT spec'iyle birebir:
 * (a) fact + factLevel · (b) evidence (3 ayrı satır) · (c) unknown (TEK bilinmeyen)
 * (d) action · (e) why · (f) doneWhen.
 * Ana buton metni UI sabiti: "Doğrulamayı başlat".
 */
export interface Card {
  id: string;
  /** (a) Şu anki gerçek — tek cümle. */
  fact: string;
  /** (a) Kesinlik seviyesi — açık, gizlenmez. */
  factLevel: EvidenceLevel;
  /**
   * (a) Gerçeğin KENDİ tarihi = dayandığı claim'in createdAt'i. updatedAt ile
   * karıştırılmasın: kart bugün üretilir, gösterdiği koşum 17 gün önceki
   * olabilir. Kaydı olmayan kartta (kayit-yok) yoktur — uydurulmaz.
   */
  factDate?: string; // ISO-8601
  /** (b) Kanıt — git diff / test çıktısı / insan onayı, üç ayrı satır. */
  evidence: CardEvidence;
  /** (c) Eksik/belirsiz — EN önemli TEK bilinmeyen. */
  unknown: string;
  /** (d) Sıradaki tek hareket. */
  action: NextAction;
  /** (e) Neden bu? — tek cümle. */
  why: string;
  /** (f) Bitti sayılması için — açık doğrulama koşulu. */
  doneWhen: string;
  /** Kartı seçen kural (why cümlesinin makine karşılığı; UI göstermek zorunda değil). */
  rule: CardRule;
  /** Bağlı pasaport maddesi (varsa). */
  passportItemId?: string;
  updatedAt: string; // ISO-8601
}

/** Kart ana buton metni — UI sabiti (pano statik: komutu gösterir). */
export const CARD_PRIMARY_BUTTON_TR = 'Doğrulamayı başlat';

// ── Pasaport (BuildPassport-uyumlu) ──────────────────────────────────────────

/** BP BriefItemStatus ile birebir aynı değerler (schema_version 1). */
export type PassportItemStatus =
  | 'completed'
  | 'partial'
  | 'out_of_scope'
  | 'missing'
  | 'not_verified'
  | 'deferred';

/**
 * Onayın geldiği KANAL. Tek meşru değer: 'terminal' — cevap gerçek bir TTY'den
 * (insanın klavyesinden) geldi. Etkileşimsiz girdide (pipe/otomasyon) onay hiç
 * kaydedilmez, bu yüzden başka bir değer ÜRETİLMEZ.
 *
 * Alan OPSİYONELDİR: bu kapı kodlanmadan önce yazılmış kayıtlarda yoktur.
 * "Kanal kaydı yok" ile "terminaldi" karıştırılmaz — eski kayda sonradan
 * 'terminal' yazmak, ölçülmemiş bir şeyi ölçülmüş göstermek olurdu.
 */
export type VerificationSource = 'terminal';

/** BP Verification ile birebir uyumlu — insan kararı kaydı. */
export interface Verification {
  by: string;
  at: string; // ISO-8601
  decision: 'approved' | 'corrected';
  note?: string;
  /** Onayın geldiği kanal (yalnız yeni kayıtlarda). */
  source?: VerificationSource;
}

/**
 * PassportItem — BP BriefItem şemasına uyumlu TESLİM SÖZÜ maddesi.
 *
 * Kaynağı `.ocean/goal.md` içindeki `- [ ]` satırlarıdır (goal.ts): sonlu,
 * kilitli, İNSANIN YAZDIĞI söz. Oturum eklemek madde sayısını büyütmez —
 * barın Sisifos'a dönmemesinin yapısal sebebi budur.
 * Kural (BP konvansiyonu): status varsayılanı 'not_verified' — araç ASLA
 * "tamamlandı" tahmin etmez; 'completed' yalnız insan kararıyla gelir.
 */
export interface PassportItem {
  id: string;
  /** Sözün kendi metni (insanın cümlesi) — normalize edilmiş kısa başlık. */
  title: string;
  /** Kullanıcının kendi cümlesi (varsa). */
  clientText?: string;
  status: PassportItemStatus;
  /** Durum gerekçesi — tek cümle, teknik-olmayan dil. */
  reason?: string;
  /** Bağlı claim id'leri (Topbeam tarafı) — BP'ye aktarımda evidence'a çevrilir. */
  claimIds: string[];
  /** İnsan doğrulaması (varsa). */
  verification?: Verification;
  level: EvidenceLevel;
}

/**
 * Pasaport FULL-TİK kontrolü — YALNIZ state'in kendi iddiasına bakar.
 *
 * DİKKAT (dürüstlük sınırı): bu fonksiyon "state böyle diyor" der, "kanıtlı"
 * demez. Panoya/rapora çıkan FULL-TİK ve "insan" rozeti passport.jsonl
 * defteriyle desteklenmek ZORUNDA — onun için `pasaportTamMi(items, ledger)`
 * kullanılır (ledger.ts). Burası şema-içi tutarlılık kontrolüdür.
 */
export function isPassportFull(items: readonly PassportItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => i.status === 'completed' && i.level === 'insan-onayi')
  );
}

// ── passport.jsonl (append-only onay defteri) ────────────────────────────────

/**
 * Tek onay kaydı — değişmez log satırı ve İNSAN ROZETİNİN TEK KAYNAĞI.
 * (Veri modeli burada durur ki saf `ledger.ts` fs katmanına bağlanmasın;
 * dosyaya yazma tarafı state.ts'te.)
 */
export interface PassportLogRecord {
  schema_version: number;
  at: string; // ISO-8601
  claimId: string;
  title: string;
  decision: Verification['decision'];
  by: string;
  note?: string;
  /**
   * Onayın geldiği kanal ('terminal' = gerçek TTY). Bu alan olmayan satırlar
   * insan kapısı koda girmeden ÖNCE yazılmıştır — denetçi ikisini ayırabilsin
   * diye sonradan doldurulmaz VE rozet hakkı vermez (ledger.ts kayitGecerliMi).
   */
  source?: Verification['source'];
  levelBefore: string;
  levelAfter: string;
}

// ── Kapsam: neyin dışarıda bırakıldığı (gürültü kesme İZ BIRAKARAK) ──────────

/**
 * Log satır sayıları ZİNCİRİ — panodaki her sayının nereden geldiği.
 *
 * NEDEN VAR: gürültüyü kesmek doğru, ama İZ BIRAKMADAN kesmek gizlemektir.
 * Pano "toplam 454" derken 454 zaten süzülmüş+kırpılmış bir sayıydı; ham
 * kayıt çok daha büyüktü. Bu yapı ham sayıyı da, her eleme adımını da taşır.
 *
 * KİMLİK (her sync'te sağlanır, testle kilitli):
 *   hamToplam = ilgisizBeyan + tekillestirilen + kirpilan + tutulan
 */
export interface LogCounts {
  /** Hiçbir eleme yapılmadan önce görülen TÜM satır (kanıt + beyan). */
  hamToplam: number;
  /** Ham kanıt satırı (git olayları + kanıtlı claim satırları + korunan insan/ocean). */
  hamKanit: number;
  /** Ham beyan satırı (Claude'un niyet cümleleri + notes.md satırları). */
  hamBeyan: number;
  /** Projeyle ilişkilendirilemediği için log'a HİÇ alınmayan beyan. */
  ilgisizBeyan: number;
  /** Aynı satırın tekrarı olduğu için birleşen/atılan satır. */
  tekillestirilen: number;
  /** Satır sınırı dolduğu için listeden düşen satır. */
  kirpilan: number;
  /** Sonuçta state'te duran satır. */
  tutulan: number;
}

/**
 * ScopeNotes — "bu panonun kapsamı ve bilmedikleri". state.json'a KALICI yazılır
 * ve panoda kartın hemen altında gösterilir.
 *
 * Dürüstlük gerekçesi: Topbeam gürültüyü keser (proje dışı düzenleme, ilişkisiz
 * beyan, sayı üretmeyen kontrol komutu). Kesilen şey görünmezse kullanıcı
 * panonun her şeyi gördüğünü sanır — bu, sessiz bir yalandır. Sayılar burada
 * durur; hepsi ÖLÇÜLMÜŞ, hiçbiri tahmin değildir.
 */
export interface ScopeNotes {
  /** Proje kökü DIŞINDAKİ dosyalarda yapılan ve claim'e girmeyen düzenleme. */
  disKapsamDuzenleme: number;
  /** Farklı cwd ile kaydedildiği için claim üretilmeyen oturum. */
  atlananOturum: number;
  /** Sayı üretmediği için claim doğurmayan kontrol komutu (tsc/eslint…). */
  kontrolKomutu: number;
  /** Metinde proje dışına çıktığı için '~/…' diye kısaltılan mutlak yol. */
  kisaltilanYol: number;
  /** Dizin git deposu değil → dosya-kanıtı yolu bu projede kapalı. */
  gitYok: boolean;
  /** Log satır sayıları zinciri (ham → tutulan). */
  log: LogCounts;
  /** Toplayıcı/motor notları (insan-okur; yollar kısaltılmış). */
  notlar: string[];
}

// ── Topbeam durumu (.ocean/state.json) ─────────────────────────────────────────

/**
 * OceanState — `.ocean/state.json` şeması. Proje köküne yazılır (gitignored).
 * Mutlak yol İÇERMEZ (BP bilgi-diyeti kuralı: repoPath dışarı sızmaz);
 * proje kimliği dizinin kendisidir.
 */
export interface OceanState {
  schema_version: number;
  tool_version: string;
  /** Proje adı (dizin adından türetilir, insan düzeltebilir). */
  projectName: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  /** Proje-özel log history (kronolojik). */
  log: LogEntry[];
  /** Deterministik motorun ürettiği iddialar. */
  claims: Claim[];
  /** BP-uyumlu teslim sözü maddeleri (kaynak: .ocean/goal.md `- [ ]`). */
  passport: PassportItem[];
  /** Güncel sıradaki-tek-hareket kartı (yoksa henüz sync koşmadı). */
  card?: Card;
  /**
   * Panonun kapsamı: neyin elendiği + log sayı zinciri. Yoksa (eski state ya da
   * henüz sync koşmamış) UYDURULMAZ — pano "kapsam kaydı yok" der.
   */
  scope?: ScopeNotes;
  /** İşlenmiş Claude Code oturum id'leri (tekrar-işleme koruması). */
  sessionsSeen: string[];
  /** Son sync zamanı (varsa). */
  lastSyncedAt?: string;
  /** Bar dolduğunda (mühür yazıldığında) "ürün geliştirildi" bildirimi verildi mi. */
  fullTickNotifiedAt?: string;
}

/** Boş başlangıç durumu üretici — `topbeam init` bunu yazar. */
export function newOceanState(projectName: string, now = new Date()): OceanState {
  const ts = now.toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    projectName,
    createdAt: ts,
    updatedAt: ts,
    log: [],
    claims: [],
    passport: [],
    sessionsSeen: [],
  };
}
