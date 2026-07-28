/**
 * Pasaport İŞ BİRİMİ katmanı — claim'leri insanın onaylayabileceği birimlere toplar.
 *
 * NEDEN VAR: her claim'in ayrı pasaport maddesi olduğu sürüm dogfood'da 278
 * madde üretti; her test koşumu ayrı satırdı, FULL-TİK pratikte erişilemezdi.
 * Kimse 278 kere "evet gördüm" demez — erişilemeyen bir tik, tik değildir.
 * Birim = bir Claude Code OTURUMU: insanın kafasında da tek bir iş öbeğidir
 * ("dün akşam login ekranını yaptığımız oturum").
 *
 * DETERMİNİZM: birim id'si `birim-<sessionId>` — oturum kimliği transcript
 * dosya adıdır, yeniden sync'te değişmez. Oturumsuz claim (örn. verify'ın
 * ürettiği "çalışıyor" kaydı) kendi id'siyle tek başına birim olur.
 *
 * DÜRÜSTLÜK (ihlal = red):
 * - Birimin seviyesi EN ZAYIF claim'in seviyesidir. Bir kayıt doğrulanmamışsa
 *   birim doğrulanmamıştır — gruplama kanıt yükseltmez, kanıtı SEYRELTMEZ.
 * - 'completed' yalnız birimdeki TÜM claim'ler insan-onaylıysa. Araç asla
 *   "tamam" tahmin etmez.
 * - Onaydan sonra birime yeni kayıt düşerse madde 'partial' olur ve bunu
 *   açıkça söyler — eski onay yeni işi kapsıyormuş gibi gösterilmez.
 * - İnsan kararı KAYBOLMAZ: verification taşınır; taşınamayan eski madde
 *   (claim'i düşmüş) iz olarak listede kalır.
 */
import type { Claim, EvidenceLevel, PassportItem, PassportItemStatus } from './types.ts';

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
 * Kayıt metnini kopyalamak yerine sayı vermek pasaportu okunur kılar; iddia
 * metinlerinin tamamı claim'lerde durur (birim onaylanırken hepsi gösterilir).
 * Dosya kaydı olmayan birimde (örn. yalnız "çalışıyor" kaydı) temsilci
 * claim'in kendi metni kullanılır.
 */
function unitTitle(claims: readonly Claim[], firstTs: string): string {
  const { dosya, test, ornek } = unitOlcum(claims);
  const tarih = gun(firstTs);
  const on = tarih !== null ? `${tarih} · ` : '';

  if (dosya === 0 && test === 0) {
    const rep = [...claims].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id),
    )[0];
    return rep === undefined ? '(kayıtsız birim)' : claimTitle(rep.text);
  }

  const parcalar: string[] = [];
  if (dosya > 0) parcalar.push(`${dosya} dosya`);
  if (test > 0) parcalar.push(`${test} test koşumu`);
  const kuyruk =
    ornek.length > 0
      ? ` (${ornek.join(', ')}${dosya > ornek.length ? ` +${dosya - ornek.length}` : ''})`
      : '';
  return claimTitle(`${on}${parcalar.join(' · ')}${kuyruk}`);
}

interface Unit {
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

/**
 * Claim listesinden pasaportu (yeniden) kur.
 *
 * existing: önceki pasaport — insan kararları (verification, clientText)
 * buradan taşınır; otomatik üretilmiş eski maddeler tazelenir.
 */
export function buildPassport(
  existing: readonly PassportItem[],
  claims: readonly Claim[],
): PassportItem[] {
  const units = groupIntoUnits(claims);
  const unitIds = new Set(units.map((u) => u.id));

  // Eski maddelerin insan kararlarını birimlere taşı: aynı id'li madde ya da
  // claim'leri tamamen bu birimin içinde kalan (eski, claim-başına) madde.
  const carried = new Map<string, PassportItem>();
  const attached = new Set<string>();
  const claimToUnit = new Map<string, string>();
  for (const u of units) for (const c of u.claims) claimToUnit.set(c.id, u.id);
  for (const prev of existing) {
    let hedef: string | undefined;
    if (unitIds.has(prev.id)) hedef = prev.id;
    else if (prev.claimIds.length > 0) {
      const hedefler = new Set(prev.claimIds.map((cid) => claimToUnit.get(cid)));
      const tek = [...hedefler];
      if (tek.length === 1 && tek[0] !== undefined) hedef = tek[0];
    }
    if (hedef === undefined) continue;
    attached.add(prev.id);
    const onceki = carried.get(hedef);
    // Birden çok aday varsa EN SON insan kararı kazanır (deterministik: at, sonra id).
    if (
      onceki === undefined ||
      (prev.verification !== undefined &&
        (onceki.verification === undefined ||
          prev.verification.at > onceki.verification.at ||
          (prev.verification.at === onceki.verification.at && prev.id.localeCompare(onceki.id) > 0)))
    ) {
      carried.set(hedef, prev);
    }
  }

  const out: PassportItem[] = [];
  for (const u of units) {
    const prev = carried.get(u.id);
    const level = unitLevel(u.claims);
    const humanCount = u.claims.filter((c) => c.level === 'insan-onayi').length;
    const n = u.claims.length;
    const verification = prev?.verification;

    /**
     * Durum sözlüğü (yuvarlama YOK):
     *  completed    = birimdeki HER kayıt insan onaylı,
     *  partial      = bir kısmı onaylı (ya da onaydan sonra yeni kayıt düştü),
     *  not_verified = hiçbir kayıt insan onaylı değil (varsayılan).
     */
    let status: PassportItemStatus;
    let reason: string | undefined;
    if (level === 'insan-onayi') {
      status = 'completed';
      reason = n > 1 ? `${n} kaydın hepsi insan onaylı.` : undefined;
    } else if (verification !== undefined) {
      // Onay vardı ama birim artık tam onaylı değil → sessizce "tamam" gösterilmez.
      status = 'partial';
      reason = `Onaydan sonra bu birime yeni kayıt eklendi — ${humanCount}/${n} kayıt insan onaylı.`;
    } else if (humanCount > 0) {
      status = 'partial';
      reason = `${humanCount}/${n} kayıt insan onaylı — birim henüz tamam değil.`;
    } else {
      status = 'not_verified';
    }

    out.push({
      id: u.id,
      title: unitTitle(u.claims, u.firstTs),
      status,
      claimIds: u.claims.map((c) => c.id),
      level,
      ...(reason !== undefined ? { reason } : {}),
      ...(prev?.clientText !== undefined ? { clientText: prev.clientText } : {}),
      ...(verification !== undefined ? { verification } : {}),
    });
  }

  // Birime taşınamayan ESKİ İNSAN KARARLARI iz olarak korunur (onay kaybolmaz).
  // Taşınanlar burada tekrar edilmez; taşınamayan (claim'i düşmüş) madde kalır.
  const orphans = existing
    .filter((p) => p.verification !== undefined && !attached.has(p.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return [...out, ...orphans];
}
