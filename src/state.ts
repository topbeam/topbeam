/**
 * Kalıcılık katmanı — .ocean/ dizini altındaki tüm okuma/yazma BURADAN geçer.
 *
 * Kurallar:
 * - Diske giden her metin redactDeep'ten geçer (secret maskeleme, bypass yok).
 * - state.json şema-sürümlü; parse edilemeyen durum dürüstçe null döner
 *   (uydurma kurtarma yok — CLI "state okunamadı" der).
 * - passport.jsonl APPEND-ONLY (değişmez onay logu) — asla yeniden yazılmaz.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OCEAN_DIR, STATE_FILE, type OceanState, type Verification } from './types.ts';
import { redactDeep } from './redact.ts';

export const GOAL_FILE = 'goal.md';
export const NOTES_FILE = 'notes.md';
export const PANO_FILE = 'pano.html';
export const PASSPORT_LOG_FILE = 'passport.jsonl';

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
  await writeFile(statePath(cwd), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { hits };
}

/** Pano HTML'ini yaz (metin state'ten gelir; state zaten maskeli yazılır ama
 *  pano render'ı bellek-içi state'ten beslenir → burada da maskele). */
export async function writePano(cwd: string, html: string): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(html);
  await writeFile(panoPath(cwd), value, 'utf8');
}

// ── passport.jsonl (append-only onay logu) ───────────────────────────────────

/** Tek onay kaydı — değişmez log satırı. */
export interface PassportLogRecord {
  schema_version: number;
  at: string; // ISO-8601
  claimId: string;
  title: string;
  decision: Verification['decision'];
  by: string;
  note?: string;
  levelBefore: string;
  levelAfter: string;
}

export async function appendPassportLog(cwd: string, record: PassportLogRecord): Promise<void> {
  await mkdir(oceanDir(cwd), { recursive: true });
  const { value } = redactDeep(record);
  await appendFile(passportLogPath(cwd), `${JSON.stringify(value)}\n`, 'utf8');
}

// ── goal.md / notes.md okuma ─────────────────────────────────────────────────

/** goal.md'nin ilk anlamlı satırı (başlık/parantez-yönerge/boş satır atlanır). */
export async function readGoal(cwd: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(goalPath(cwd), 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#') || t.startsWith('(') || t.startsWith('<!--')) continue;
    return t;
  }
  return null;
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
