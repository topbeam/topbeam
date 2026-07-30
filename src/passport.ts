/**
 * DEFTER — oturum kayıtları. Bir ARŞİVDİR, bir ilerleme ölçüsü DEĞİLDİR.
 *
 * NEDEN BURASI ARTIK BAR DEĞİL (Sisifos barı): birim bir Claude Code
 * OTURUMUNA bağlıyken her yeni kodlama oturumu paydayı büyütüyordu — bugün
 * 0/11, yarın çalışırsan 0/12: çalıştıkça bar senden uzaklaşıyordu. Üstelik
 * "2026-07-11 · 99 dosya · 40 test koşumu" bir ürün SÖZÜ değil arşiv kaydıdır;
 * 99 dosyalık bir birime onay istemek lastik damga üretirdi.
 *
 * Bar artık `.ocean/goal.md`'deki insan sözlerinden kurulur (goal.ts). Burası
 * yalnız "hangi oturumda ne ölçüldü" kaydını verir: sayılır, gösterilir, ama
 * ilerleme diye SUNULMAZ ve satırlarında `topbeam verify` öne çıkarılmaz.
 *
 * DETERMİNİZM: birim id'si `birim-<sessionId>` — oturum kimliği transcript
 * dosya adıdır, yeniden sync'te değişmez. Oturumsuz claim (örn. verify'ın
 * ürettiği "çalışıyor" kaydı) kendi id'siyle tek başına birim olur.
 *
 * DÜRÜSTLÜK: birimin seviyesi EN ZAYIF claim'in seviyesidir — gruplama kanıt
 * yükseltmez, kanıtı seyreltmez.
 */
import type { Claim, EvidenceLevel } from './types.ts';

/** Birim id öneki — claim id'leriyle karışmasın diye ayrı ad alanı. */
export const UNIT_PREFIX = 'birim-';

/** Pasaport başlığı üst sınırı. */
const TITLE_LEN = 90;

export function claimTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_LEN ? `${t.slice(0, TITLE_LEN)}…` : t;
}

/**
 * Claim'in ait olduğu iş birimi id'si. Oturum varsa oturum birimi; yoksa
 * claim'in kendi id'si (tek kayıtlık birim — id kararlılığı korunur).
 */
export function workUnitId(claim: Claim): string {
  const s = claim.sessionId;
  return s !== undefined && s !== '' ? `${UNIT_PREFIX}${s}` : claim.id;
}

/** Birimin seviyesi = EN ZAYIF claim seviyesi (gruplama kanıt yükseltmez). */
export function unitLevel(claims: readonly Claim[]): EvidenceLevel {
  if (claims.length === 0) return 'dogrulanmadi';
  if (claims.every((c) => c.level === 'insan-onayi')) return 'insan-onayi';
  if (claims.some((c) => c.level === 'dogrulanmadi')) return 'dogrulanmadi';
  return claims.every((c) => c.level === 'test-kaniti') ? 'test-kaniti' : 'dosya-kaniti';
}

/** Başlıkta örnek olarak anılan dosya adı sayısı. */
const TITLE_NAMES = 2;

/** ISO ts → "2026-07-28" (deterministik dilimleme, locale yok). */
function gun(iso: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m?.[1] ?? null;
}

/** Birimin dosya kayıtlarını (kovalar ayrık olduğundan) toplayarak ölç. */
function unitOlcum(claims: readonly Claim[]): { dosya: number; test: number; ornek: string[] } {
  let dosya = 0;
  let test = 0;
  let enGenis: Claim | null = null;
  for (const c of claims) {
    if (c.kind === 'test') test++;
    else if (c.kind === 'dosya') {
      dosya += c.signals?.fileCount ?? 0;
      if (enGenis === null || (c.signals?.fileCount ?? 0) > (enGenis.signals?.fileCount ?? 0)) enGenis = c;
    }
  }
  return { dosya, test, ornek: (enGenis?.signals?.paths ?? []).slice(0, TITLE_NAMES) };
}

/**
 * Birim başlığı — ÖLÇÜLMÜŞ sayılardan kurulur (uydurma özet yok, LLM yok):
 *   "2026-07-28 · 16 dosya · 4 test koşumu (src/a.ts, src/b.ts +14)"
 * Bu bir ARŞİV SATIRIDIR, bir ürün sözü değildir — defterde öyle sunulur.
 * Dosya kaydı olmayan birimde (örn. yalnız "çalışıyor" kaydı) temsilci
 * claim'in kendi metni kullanılır.
 */
export function unitTitle(claims: readonly Claim[], firstTs: string): string {
  const { dosya, test, ornek } = unitOlcum(claims);
  const tarih = gun(firstTs);
  const on = tarih !== null ? `${tarih} · ` : '';

  if (dosya === 0 && test === 0) {
    const rep = [...claims].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id),
    )[0];
    return rep === undefined ? '(unit with no records)' : claimTitle(rep.text);
  }

  const parcalar: string[] = [];
  if (dosya > 0) parcalar.push(`${dosya} ${dosya === 1 ? 'file' : 'files'}`);
  if (test > 0) parcalar.push(`${test} test ${test === 1 ? 'run' : 'runs'}`);
  const kuyruk =
    ornek.length > 0
      ? ` (${ornek.join(', ')}${dosya > ornek.length ? ` +${dosya - ornek.length}` : ''})`
      : '';
  return claimTitle(`${on}${parcalar.join(' · ')}${kuyruk}`);
}

export interface Unit {
  id: string;
  claims: Claim[];
  /** Birimdeki en erken kayıt zamanı — deterministik sıralama anahtarı. */
  firstTs: string;
}

/** Claim'leri iş birimlerine ayır (deterministik sıra: en erken kayıt, sonra id). */
export function groupIntoUnits(claims: readonly Claim[]): Unit[] {
  const byId = new Map<string, Unit>();
  for (const c of claims) {
    const id = workUnitId(c);
    const u = byId.get(id);
    if (u === undefined) byId.set(id, { id, claims: [c], firstTs: c.createdAt });
    else {
      u.claims.push(c);
      if (c.createdAt < u.firstTs) u.firstTs = c.createdAt;
    }
  }
  const units = [...byId.values()];
  for (const u of units) {
    u.claims.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id),
    );
  }
  units.sort((a, b) => (a.firstTs < b.firstTs ? -1 : a.firstTs > b.firstTs ? 1 : a.id.localeCompare(b.id)));
  return units;
}

/** Defterde gösterilen tek oturum kaydı — salt gösterim, onay hedefi DEĞİL. */
export interface DefterKaydi {
  id: string;
  /** Ölçülmüş başlık: "2026-07-28 · 16 dosya · 4 test koşumu (…)". */
  title: string;
  /** Birimin EN ZAYIF kanıt seviyesi. */
  level: EvidenceLevel;
  claimIds: string[];
}

/**
 * Claim'lerden defteri kur — oturum başına bir satır, deterministik sırayla.
 *
 * Burada 'status'/'verification' YOKTUR: defter bir ilerleme listesi değildir.
 * İnsan onayı ve bar goal.md sözlerinde ölçülür (goal.ts).
 */
export function buildDefter(claims: readonly Claim[]): DefterKaydi[] {
  return groupIntoUnits(claims).map((u) => ({
    id: u.id,
    title: unitTitle(u.claims, u.firstTs),
    level: unitLevel(u.claims),
    claimIds: u.claims.map((c) => c.id),
  }));
}
