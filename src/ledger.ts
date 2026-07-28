/**
 * DOĞRULAMA DEFTERİ — "insan" rozetinin TEK GERÇEK KAYNAĞI.
 *
 * NEDEN VAR (dogfood'da yaşanan sızıntı):
 * Pano, bir kaydın KENDİ İDDİASINA bakarak insan rozeti veriyordu — bir log
 * satırı `source:'insan'`, bir claim `level:'insan-onayi'` yazdığı için insan
 * onaylı görünüyordu. Bir ajanın yazdığı `by:"dogfood-ajan"` satırı bu yüzden
 * canlı panoda "insan" rozetiyle durdu. İddia ile kanıt aynı yerden gelirse
 * kanıt kanıt olmaktan çıkar.
 *
 * KURAL (yapısal, gevşetilemez): insan rozeti YALNIZ .ocean/passport.jsonl'deki
 * GEÇERLİ bir doğrulama kaydına dayanır. Geçerli olmanın üç şartı:
 *   1. imza  — `by` okunabilir bir kimlik ("bilinmiyor" imzayla onay olmaz),
 *   2. kanal — `source === 'terminal'` (gerçek TTY; ajan taklit edemez),
 *   3. karar — `decision === 'approved'` ve `levelAfter === 'insan-onayi'`.
 * Bu üçünden biri eksikse rozet YOK. Kaydın kendi metni ne derse desin.
 *
 * FAIL-CLOSED: defter okunamadıysa/verilmediyse rozet verilmez. Onay vermek
 * için kanıt gerekir; "bilinmiyor" insan sayılmaz (verify.ts insanKapisi ile
 * aynı ilke — orada onay YAZILMAZ, burada GÖSTERİLMEZ).
 *
 * SESSİZ SİLME YOK: kaynağı olmayan kayıt yok edilmez; rozet yerine
 * "kanal kaydı yok" işaretiyle durur (bkz. ROZETSIZ_ETIKET). Denetçi neyin
 * dayanaksız olduğunu görebilsin.
 */
import type { PassportItem, PassportLogRecord } from './types.ts';

// ── kimlik ───────────────────────────────────────────────────────────────────

/**
 * Kimlik sayılmayan imzalar — bunlarla yazılmış kayıt onay saymaz.
 * (verify.ts insan kapısı da bu listeyi kullanır: tek liste, tek doğruluk.)
 */
export const KIMLIKSIZ: ReadonlySet<string> = new Set([
  '',
  'unknown',
  'bilinmiyor',
  'nobody',
  'none',
  'null',
  'undefined',
]);

/** İmza okunabilir bir kimlik mi? (Ad heuristiği YOK — kapı kanaldır.) */
export function kimlikGecerliMi(by: string): boolean {
  const t = by.trim();
  return !KIMLIKSIZ.has(t.toLocaleLowerCase('en-US'));
}

// ── defter kaydı doğrulama ───────────────────────────────────────────────────

/** Panoya rozet hakkı veren, doğrulanmış tek onay kaydı. */
export interface LedgerEntry {
  claimId: string;
  /** ISO-8601 — log satırını bu onaya bağlayan bağ. */
  at: string;
  by: string;
}

export type LedgerCheck =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; claimId: string | null; neden: string };

/**
 * Tek bir passport.jsonl satırının rozet hakkı verip vermediği — SAF fonksiyon.
 * Girdi `unknown`: disk dosyası dış dünyadır, şekli varsayılmaz.
 */
export function kayitGecerliMi(raw: unknown): LedgerCheck {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, claimId: null, neden: 'satır bir kayıt nesnesi değil' };
  }
  const r = raw as Partial<PassportLogRecord>;
  const claimId = typeof r.claimId === 'string' && r.claimId !== '' ? r.claimId : null;
  if (claimId === null) return { ok: false, claimId: null, neden: 'claimId yok' };
  if (typeof r.at !== 'string' || r.at === '') {
    return { ok: false, claimId, neden: 'zaman damgası yok' };
  }
  if (typeof r.by !== 'string' || !kimlikGecerliMi(r.by)) {
    return { ok: false, claimId, neden: 'imza okunamıyor — imzası bilinmeyen onay, onay değildir' };
  }
  if (r.source !== 'terminal') {
    // En ağır şart: kanal. Ajan bir metin alanını yazabilir, TTY'yi taklit edemez.
    return {
      ok: false,
      claimId,
      neden: 'kanal kaydı yok — onayın gerçek bir terminalden geldiği kayıtlı değil',
    };
  }
  if (r.decision !== 'approved') {
    return { ok: false, claimId, neden: `karar 'approved' değil (${String(r.decision)})` };
  }
  if (r.levelAfter !== 'insan-onayi') {
    return { ok: false, claimId, neden: `kayıt insan-onayı seviyesine yükseltmemiş` };
  }
  return { ok: true, entry: { claimId, at: r.at, by: r.by.trim() } };
}

// ── defter ───────────────────────────────────────────────────────────────────

export interface VerificationLedger {
  /** Geçerli onayı olan claim id → kayıt (en son onay kazanır). */
  gecerli: ReadonlyMap<string, LedgerEntry>;
  /** Kaydı VAR ama şartı sağlamayanlar: claim id → dürüst gerekçe. */
  gecersiz: ReadonlyMap<string, string>;
  /** Geçerli onayların zaman damgaları — log satırını onaya bağlayan bağ. */
  zamanlar: ReadonlySet<string>;
  /** passport.jsonl okunabildi mi (yoksa sayı uydurulmaz). */
  dosyaVar: boolean;
  /** Okunan satır sayısı (şeffaflık). */
  okunanSatir: number;
  /** Geçersiz sayıldığı için rozet hakkı vermeyen satır sayısı. */
  reddedilenSatir: number;
}

/** Defter yoksa: hiçbir şey insan onaylı DEĞİLDİR (fail-closed varsayılan). */
export const BOS_LEDGER: VerificationLedger = {
  gecerli: new Map(),
  gecersiz: new Map(),
  zamanlar: new Set(),
  dosyaVar: false,
  okunanSatir: 0,
  reddedilenSatir: 0,
};

/** Ayrıştırılmış passport.jsonl satırlarından defteri kur (saf, fs yok). */
export function buildLedger(
  records: readonly unknown[],
  opts: { dosyaVar: boolean } = { dosyaVar: true },
): VerificationLedger {
  const gecerli = new Map<string, LedgerEntry>();
  const gecersiz = new Map<string, string>();
  const zamanlar = new Set<string>();
  let reddedilen = 0;
  for (const raw of records) {
    const c = kayitGecerliMi(raw);
    if (c.ok) {
      const onceki = gecerli.get(c.entry.claimId);
      if (onceki === undefined || c.entry.at > onceki.at) gecerli.set(c.entry.claimId, c.entry);
      zamanlar.add(c.entry.at);
      continue;
    }
    reddedilen++;
    // Geçerli bir onay varsa gerekçe onu GÖLGELEMEZ (bir satır bozuksa
    // diğerinin gerçek onayı düşmez); yalnız kaydı olmayan claim işaretlenir.
    if (c.claimId !== null && !gecerli.has(c.claimId)) gecersiz.set(c.claimId, c.neden);
  }
  for (const id of gecerli.keys()) gecersiz.delete(id);
  return {
    gecerli,
    gecersiz,
    zamanlar,
    dosyaVar: opts.dosyaVar,
    okunanSatir: records.length,
    reddedilenSatir: reddedilen,
  };
}

// ── rozet kapıları (pano ve raporlar YALNIZ bunları kullanır) ────────────────

/** Rozet verilmeyen kaydın YERİNE geçen dürüst işaret. */
export const ROZETSIZ_ETIKET = 'kanal kaydı yok';
export const ROZETSIZ_NOT = 'doğrulama kaydı bulunamadı';
export const ROZETSIZ_BASLIK =
  'Bu kayıt kendini insan onaylı sayıyor, ama .ocean/passport.jsonl dosyasında ' +
  'terminal imzalı bir doğrulama kaydına bağlanamadı. Kayıt silinmedi — yalnız rozeti yok.';

/** Tek claim insan onaylı sayılabilir mi? */
export function claimOnayli(ledger: VerificationLedger, claimId: string): boolean {
  return ledger.gecerli.has(claimId);
}

/** Bir iş biriminin (pasaport maddesi) TÜM kayıtları onaylı mı? Boş birim: hayır. */
export function birimOnayli(ledger: VerificationLedger, claimIds: readonly string[]): boolean {
  return claimIds.length > 0 && claimIds.every((id) => ledger.gecerli.has(id));
}

/**
 * 'insan' kaynaklı log satırı rozet alabilir mi?
 * Bağ: verify akışı log satırını onayla AYNI zaman damgasıyla yazar
 * (LogEntry.ts === Verification.at). Bu bağ kurulamıyorsa rozet yok.
 */
export function logSatiriOnayli(ledger: VerificationLedger, ts: string): boolean {
  return ledger.zamanlar.has(ts);
}

/** Pasaport maddesi "doğrulandı" sayılır mı — defterle desteklenen tik. */
export function maddeOnayli(ledger: VerificationLedger, item: PassportItem): boolean {
  return (
    item.status === 'completed' && item.level === 'insan-onayi' && birimOnayli(ledger, item.claimIds)
  );
}

/** Defterle desteklenen "doğrulandı" sayısı (pano ve CLI aynı sayıyı verir). */
export function dogrulananSayisi(
  items: readonly PassportItem[],
  ledger: VerificationLedger,
): number {
  return items.filter((i) => maddeOnayli(ledger, i)).length;
}

/** FULL-TİK: her madde defterle desteklenen insan onayına sahip mi? */
export function pasaportTamMi(
  items: readonly PassportItem[],
  ledger: VerificationLedger,
): boolean {
  return items.length > 0 && items.every((i) => maddeOnayli(ledger, i));
}
