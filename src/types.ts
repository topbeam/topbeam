/**
 * Ocean veri modeli — tek gerçek kaynak.
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

export const SCHEMA_VERSION = 1;

/** Araç sürümü — TEK kaynak. UI/altbilgi/CLI buradan okur. */
export const TOOL_VERSION = '0.1.0';

/** Proje kökünde Ocean veri dizini ve durum dosyası. */
export const OCEAN_DIR = '.ocean';
export const STATE_FILE = 'state.json';

// ── Kanıt seviyeleri ─────────────────────────────────────────────────────────

/**
 * Ocean kanıt seviyesi enum'u (ürün spec'indeki 4 seviye, Türkçe anahtar).
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
 * Ocean → BP seviye haritası (Keşif/BP raporu §2):
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
 * - ocean        : Ocean'ın kendi olayları (sync koştu, pasaport güncellendi)
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

/** (d) Sıradaki tek hareket — tek fiil + mümkünse çalıştırılabilir komut. */
export interface NextAction {
  /** Tek fiil cümlesi. Örn: "Testleri çalıştır." */
  verb: string;
  /** Çalıştırılabilir komut (pano statik — kullanıcı kopyalar). Örn: "ocean verify gorev-3" */
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

/** BP Verification ile birebir uyumlu — insan kararı kaydı. */
export interface Verification {
  by: string;
  at: string; // ISO-8601
  decision: 'approved' | 'corrected';
  note?: string;
}

/**
 * PassportItem — BP BriefItem şemasına uyumlu pasaport maddesi.
 * "İşler sırasıyla BuildPassport'a dolar" akışının veri birimi.
 * Kural (BP konvansiyonu): status varsayılanı 'not_verified' — araç ASLA
 * "tamamlandı" tahmin etmez; 'completed' yalnız insan kararıyla gelir.
 */
export interface PassportItem {
  id: string;
  /** Normalize kısa başlık. */
  title: string;
  /** Kullanıcının kendi cümlesi (varsa). */
  clientText?: string;
  status: PassportItemStatus;
  /** Durum gerekçesi — tek cümle, teknik-olmayan dil. */
  reason?: string;
  /** Bağlı claim id'leri (Ocean tarafı) — BP'ye aktarımda evidence'a çevrilir. */
  claimIds: string[];
  /** İnsan doğrulaması (varsa). */
  verification?: Verification;
  level: EvidenceLevel;
}

/** Pasaport FULL-TİK kontrolü: her madde completed + insan-onayı seviyesinde mi? */
export function isPassportFull(items: readonly PassportItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => i.status === 'completed' && i.level === 'insan-onayi')
  );
}

// ── Ocean durumu (.ocean/state.json) ─────────────────────────────────────────

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
  /** BP-uyumlu pasaport maddeleri. */
  passport: PassportItem[];
  /** Güncel sıradaki-tek-hareket kartı (yoksa henüz sync koşmadı). */
  card?: Card;
  /** İşlenmiş Claude Code oturum id'leri (tekrar-işleme koruması). */
  sessionsSeen: string[];
  /** Son sync zamanı (varsa). */
  lastSyncedAt?: string;
  /** Pasaport FULL-TİK olduğunda "ürün geliştirildi" bildirimi verildi mi. */
  fullTickNotifiedAt?: string;
}

/** Boş başlangıç durumu üretici — `ocean init` bunu yazar. */
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
