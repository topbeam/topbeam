/**
 * Kalıcılık katmanı — .ocean/ dizini altındaki tüm okuma/yazma BURADAN geçer.
 * (Dizin adı Topbeam'de de `.ocean` kalır — veri göçü riski yok.)
 *
 * Kurallar:
 * - Diske giden her metin redactDeep'ten geçer (secret maskeleme, bypass yok).
 * - state.json şema-sürümlü; parse edilemeyen durum dürüstçe null döner
 *   (uydurma kurtarma yok — CLI "state okunamadı" der).
 * - passport.jsonl APPEND-ONLY (değişmez onay logu) — asla yeniden yazılmaz.
 */
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { OCEAN_DIR, STATE_FILE, type OceanState, type PassportLogRecord } from './types.ts';
import { buildLedger, BOS_LEDGER, type VerificationLedger } from './ledger.ts';
import { parseGoalItems, type GoalItem } from './goal.ts';
import { MUHUR_FILE } from './muhur.ts';
import { redactDeep } from './redact.ts';

export type { PassportLogRecord } from './types.ts';

// ── SYMLINK KORUMASI (2026-07-29 — sertleştirme saldırısının en ağır bulgusu) ──
//
// ÖLÇÜLDÜ, teorik değil: `.ocean/pano.html` bir symlink olduğunda `sync`
// hedefteki dosyayı EZİYORDU. Yeniden üretim:
//     ln -s ~/kurban.txt .ocean/pano.html && topbeam sync
//     kurban.txt: 33 bayt  →  14205 bayt (kullanıcı verisi geri dönüşsüz gitti)
// Symlink'ler git'te taşınır (mod 120000) → saldırganın önceden yazma yetkisine
// İHTİYACI YOK: "depoyu klonla + topbeam çalıştır" yetiyor.
//
// Çözüm `lstat` DEĞİL — lstat ile yazma arasında TOCTOU yarışı kalır.
// `O_NOFOLLOW` çekirdek seviyesinde atomiktir: son bileşen symlink ise
// açma ELOOP ile başarısız olur, yazma hiç gerçekleşmez.
//
// İkinci kapı: `.ocean` DİZİNİNİN kendisi symlink olabilir (o zaman dosya
// bileşeni symlink değildir, O_NOFOLLOW yakalamaz). Bu yüzden realpath(.ocean)
// proje kökünün altında mı diye ayrıca bakılır.

/** Yazma reddedildiğinde atılan hata — CLI bunu dürüst tek satıra çevirir. */
export class GuvenliYazmaHatasi extends Error {
  // NOT: parametre-özelliği (`readonly yol: string`) KULLANILMAZ — tsconfig
  // `erasableSyntaxOnly` açık (node --experimental-strip-types uyumu için).
  yol: string;
  sebep: 'symlink' | 'disari-cikiyor';

  constructor(yol: string, sebep: 'symlink' | 'disari-cikiyor', mesaj: string) {
    super(mesaj);
    this.name = 'GuvenliYazmaHatasi';
    this.yol = yol;
    this.sebep = sebep;
  }
}

/** `.ocean` gerçekte proje kökünün altında mı? (dizin symlink'i ile kaçış kapısı) */
async function oceanDiziniGuvenliMi(cwd: string): Promise<void> {
  const kok = await realpath(resolve(cwd)).catch(() => resolve(cwd));
  const dizin = await realpath(oceanDir(cwd)).catch(() => null);
  if (dizin === null) return; // henüz yok — mkdir kuracak, sorun değil
  if (dizin !== kok && !dizin.startsWith(kok + sep)) {
    throw new GuvenliYazmaHatasi(
      dizin,
      'disari-cikiyor',
      `Güvenlik: .ocean dizini proje kökünün DIŞINA çıkıyor (${dizin}). ` +
        'Topbeam proje kökü dışına yazmaz. Symlink ise kaldır, sonra tekrar dene.',
    );
  }
}

/**
 * Symlink takip ETMEYEN yazma. `yontem`:
 *   'yaz'  → varsa üzerine yaz (O_TRUNC)
 *   'ekle' → sonuna ekle (O_APPEND) — passport.jsonl append-only defteri
 */
async function guvenliYaz(
  cwd: string,
  yol: string,
  icerik: string,
  yontem: 'yaz' | 'ekle' = 'yaz',
): Promise<void> {
  await oceanDiziniGuvenliMi(cwd);
  const bayraklar =
    FS.O_WRONLY |
    FS.O_CREAT |
    FS.O_NOFOLLOW |
    (yontem === 'ekle' ? FS.O_APPEND : FS.O_TRUNC);
  let fh;
  try {
    fh = await open(yol, bayraklar, 0o644);
  } catch (e) {
    const kod = (e as NodeJS.ErrnoException).code;
    // ELOOP (Linux/macOS) / EMLINK (bazı BSD'ler) = son bileşen symlink.
    if (kod === 'ELOOP' || kod === 'EMLINK') {
      throw new GuvenliYazmaHatasi(
        yol,
        'symlink',
        `Güvenlik: ${yol} bir symlink — Topbeam symlink üzerinden YAZMAZ ` +
          '(hedefteki dosyayı ezerdi). Bağlantıyı kaldır, sonra tekrar dene.',
      );
    }
    throw e;
  }
  try {
    await fh.writeFile(icerik, 'utf8');
  } finally {
    await fh.close();
  }
}

/**
 * init.ts gibi .ocean DIŞINA da yazan çağrılar için dışa açık kapı
 * (goal.md/notes.md .ocean içinde, CLAUDE.md proje kökünde).
 * Aynı O_NOFOLLOW korumasını uygular.
 */
export async function guvenliYazDisa(
  cwd: string,
  yol: string,
  icerik: string,
  yontem: 'yaz' | 'ekle' = 'yaz',
): Promise<void> {
  return guvenliYaz(cwd, yol, icerik, yontem);
}

export const GOAL_FILE = 'goal.md';
export const NOTES_FILE = 'notes.md';
export const PANO_FILE = 'pano.html';
export const PASSPORT_LOG_FILE = 'passport.jsonl';
/**
 * Makbuz — pano'dan farkı: pano İÇERİ bakar (kendi ekranın), makbuz DIŞARI
 * gider (müşteri/ekip/işveren). Ad burada durur ki makbuz.ts saf tarafı
 * state.ts'e bağlanmadan da okunabilsin (tek yönlü bağımlılık: makbuz → state).
 */
export const MAKBUZ_FILE = 'makbuz.md';
export const MAKBUZ_HTML_FILE = 'makbuz.html';

export function oceanDir(cwd: string): string {
  return join(cwd, OCEAN_DIR);
}
export function statePath(cwd: string): string {
  return join(oceanDir(cwd), STATE_FILE);
}
export function goalPath(cwd: string): string {
  return join(oceanDir(cwd), GOAL_FILE);
}
export function notesPath(cwd: string): string {
  return join(oceanDir(cwd), NOTES_FILE);
}
export function panoPath(cwd: string): string {
  return join(oceanDir(cwd), PANO_FILE);
}
export function passportLogPath(cwd: string): string {
  return join(oceanDir(cwd), PASSPORT_LOG_FILE);
}
export function muhurPath(cwd: string): string {
  return join(oceanDir(cwd), MUHUR_FILE);
}
export function makbuzPath(cwd: string): string {
  return join(oceanDir(cwd), MAKBUZ_FILE);
}
export function makbuzHtmlPath(cwd: string): string {
  return join(oceanDir(cwd), MAKBUZ_HTML_FILE);
}

/** .ocean/state.json oku. Yoksa ya da parse edilemiyorsa null (dürüst). */
export async function readState(cwd: string): Promise<OceanState | null> {
  let raw: string;
  try {
    raw = await readFile(statePath(cwd), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const s = parsed as OceanState;
    if (typeof s.schema_version !== 'number' || !Array.isArray(s.claims)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * .ocean/state.json yaz — redactDeep zorunlu geçit.
 * Dönen hits: kaç secret parçası maskelendi (şeffaflık için stdout'a yazılabilir).
 */
export async function writeState(cwd: string, state: OceanState): Promise<{ hits: number }> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value, hits } = redactDeep(state);
  await guvenliYaz(cwd, statePath(cwd), `${JSON.stringify(value, null, 2)}\n`);
  return { hits };
}

/** Pano HTML'ini yaz (metin state'ten gelir; state zaten maskeli yazılır ama
 *  pano render'ı bellek-içi state'ten beslenir → burada da maskele). */
export async function writePano(cwd: string, html: string): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(html);
  await guvenliYaz(cwd, panoPath(cwd), value);
}

// ── passport.jsonl (append-only onay defteri) ────────────────────────────────
// Kayıt şeması types.ts'te (PassportLogRecord); rozet kuralı ledger.ts'te.

export async function appendPassportLog(cwd: string, record: PassportLogRecord): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(record);
  await guvenliYaz(cwd, passportLogPath(cwd), `${JSON.stringify(value)}\n`, 'ekle');
}

/**
 * passport.jsonl satırlarını oku — ŞEKİL VARSAYILMAZ (unknown döner).
 * Bozuk satır sessizce atlanır ama sayılır: `atlanan`. Dosya yoksa
 * `dosyaVar:false` (bu "onay yok" demektir, "bilinmiyor" değil — rozet
 * verilmesi için kanıt gerekir).
 */
export async function readPassportLog(
  cwd: string,
): Promise<{ records: unknown[]; dosyaVar: boolean; atlanan: number }> {
  let raw: string;
  try {
    raw = await readFile(passportLogPath(cwd), 'utf8');
  } catch {
    return { records: [], dosyaVar: false, atlanan: 0 };
  }
  const records: unknown[] = [];
  let atlanan = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      atlanan++; // bozuk satır kanıt sayılmaz (ve uydurulmaz)
    }
  }
  return { records, dosyaVar: true, atlanan };
}

/**
 * Doğrulama defteri — "insan" rozetinin TEK GERÇEK KAYNAĞI.
 * Pano/rapor yazan her yol panoyu render etmeden ÖNCE bunu okur.
 */
export async function readLedger(cwd: string): Promise<VerificationLedger> {
  const { records, dosyaVar } = await readPassportLog(cwd);
  if (!dosyaVar) return BOS_LEDGER;
  return buildLedger(records, { dosyaVar });
}

// ── goal.md / notes.md okuma ─────────────────────────────────────────────────

/**
 * goal.md'nin ilk anlamlı HEDEF satırı — panonun başlığındaki tek cümle.
 * Atlananlar: başlık (`#`), parantez/HTML yönergesi, alıntı (`>`) ve LİSTE
 * satırları (`- …`, `* …`). Liste satırları teslim SÖZLERİDİR (goal.ts) —
 * biri hedef cümlesi yerine geçemez.
 */
export async function readGoal(cwd: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(goalPath(cwd), 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (
      t === '' ||
      t.startsWith('#') ||
      t.startsWith('(') ||
      t.startsWith('<!--') ||
      t.startsWith('>') ||
      t.startsWith('- ') ||
      t.startsWith('* ')
    ) {
      continue;
    }
    return t;
  }
  return null;
}

/**
 * goal.md'deki teslim sözleri (`- [ ]` satırları) — BARIN TEK KAYNAĞI.
 * Dosya yoksa boş liste: bar gösterilmez (boş bar sahte affordance olurdu).
 */
export async function readGoalItems(cwd: string): Promise<GoalItem[]> {
  let raw: string;
  try {
    raw = await readFile(goalPath(cwd), 'utf8');
  } catch {
    return [];
  }
  return parseGoalItems(raw);
}

/** Mührü yaz — redactDeep zorunlu geçit (mühür de diske giden metindir). */
export async function writeMuhur(cwd: string, text: string): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(text);
  await guvenliYaz(cwd, muhurPath(cwd), value);
}

/**
 * Makbuzu yaz — redactDeep zorunlu geçit. Bu dosya DIŞARIYA gösterilmek için
 * üretilir; maskeleme burada başka her yerden daha kritiktir (bir sır sızarsa
 * müşteriye/işverene giden sayfada sızar).
 */
export async function writeMakbuz(cwd: string, text: string): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(text);
  await guvenliYaz(cwd, makbuzPath(cwd), value);
}

/** Makbuzun tek dosya HTML hâli — aynı maskeleme kapısı. */
export async function writeMakbuzHtml(cwd: string, html: string): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(html);
  await guvenliYaz(cwd, makbuzHtmlPath(cwd), value);
}

export interface ParsedNote {
  /** ISO-benzeri ts (satırda tarih varsa ondan; yoksa fallback). */
  ts: string;
  text: string;
}

/**
 * notes.md satırlarını ayrıştır. Beklenen biçim (CLAUDE.md yönergesi):
 *   `- 2026-07-28 14:05 — kısa Türkçe not`
 * Tarihsiz `- not` satırı da kabul edilir → ts = fallbackTs (dürüst yaklaşıklık).
 */
export function parseNotes(raw: string, fallbackTs: string): ParsedNote[] {
  const out: ParsedNote[] = [];
  const re = /^-\s+(?:(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?\s*[—–-]\s*)?(.+)$/;
  for (const line of raw.split('\n')) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const text = (m[4] ?? '').trim();
    if (text === '') continue;
    const ts = m[1] !== undefined && m[2] !== undefined ? `${m[1]}T${m[2]}:${m[3] ?? '00'}` : fallbackTs;
    out.push({ ts, text });
  }
  return out;
}

export async function readNotes(cwd: string, fallbackTs: string): Promise<ParsedNote[]> {
  let raw: string;
  try {
    raw = await readFile(notesPath(cwd), 'utf8');
  } catch {
    return [];
  }
  return parseNotes(raw, fallbackTs);
}
