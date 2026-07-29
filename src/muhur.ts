/**
 * MÜHÜR — `.ocean/muhur.md`. Bar dolduğunda (her teslim sözü defterle
 * desteklenen insan onayına kavuştuğunda) yazılan kapanış kaydı.
 *
 * Marka: "topping out" — inşaatta son kirişin tepeye çakılması, bitiş töreni.
 * Barın dolması budur. Ama tören BİR ŞEY İDDİA ETMEZ: mühür yalnız kapsamı
 * yazar — kaç söz, ne zaman kilitlendi, hangi kanıtlara dayanıyor.
 *
 * DÜRÜSTLÜK:
 * - Mühür yalnız son ONAY anında yazılır (verify.ts). Söz SİLEREK mühür
 *   alınamaz: sync barı doldursa bile mühür yazmaz.
 * - Metin ölçülmüş verilerden kurulur (LLM yok): söz metni + eşleşen kayıt
 *   sayısı + defterdeki imza/zaman. "Ürün çalışıyor" gibi bir cümle YOKTUR.
 * - Mührün NE DEMEK OLMADIĞI da yazılır — kapsamı okuyan yanılmasın.
 */
import type { Claim, EvidenceLevel, PassportItem } from './types.ts';
import type { VerificationLedger } from './ledger.ts';

export const MUHUR_FILE = 'muhur.md';

const SEVIYE_ADI: Record<EvidenceLevel, string> = {
  'dosya-kaniti': 'dosya-kanıtı',
  'test-kaniti': 'test-kanıtı',
  'insan-onayi': 'insan-onayı',
  dogrulanmadi: 'doğrulanmadı',
};

export interface MuhurGirdi {
  projectName: string;
  /** Mührün kilitlendiği an (ISO-8601) — son onayın zamanı. */
  at: string;
  /** Son onayı veren imza (işletim sistemi kullanıcısı). */
  by: string;
  items: readonly PassportItem[];
  claims: readonly Claim[];
  ledger: VerificationLedger;
  toolVersion: string;
}

/** Bir sözün dayandığı kayıtların seviye dökümü: "2 test-kanıtı · 1 dosya-kanıtı". */
function kanitDokumu(item: PassportItem, byId: ReadonlyMap<string, Claim>): string {
  const sayac = new Map<EvidenceLevel, number>();
  for (const cid of item.claimIds) {
    const c = byId.get(cid);
    if (c === undefined) continue;
    sayac.set(c.level, (sayac.get(c.level) ?? 0) + 1);
  }
  const parcalar = [...sayac.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lvl, n]) => `${n} ${SEVIYE_ADI[lvl]}`);
  return parcalar.length > 0 ? parcalar.join(' · ') : 'kayıt bulunamadı';
}

/** ISO ts → "2026-07-29 14:03" (deterministik dilimleme, locale yok). */
function fmtTs(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(ts);
  return m !== null ? `${m[1]} ${m[2]}` : ts;
}

/** Mühür metni — saf ve deterministik (aynı girdi → aynı metin). */
export function muhurMetni(g: MuhurGirdi): string {
  const byId = new Map(g.claims.map((c) => [c.id, c]));
  const satirlar: string[] = [];

  satirlar.push(`# Mühür — ${g.projectName}`);
  satirlar.push('');
  satirlar.push(`Kilitlendi: ${fmtTs(g.at)}  (${g.at})`);
  satirlar.push(`Kapsam    : ${g.items.length} teslim sözü — hepsi insan onaylı.`);
  satirlar.push(`Son imza  : ${g.by} (terminal onayı, .ocean/passport.jsonl)`);
  // "ağ yok" KOŞULSUZ yazılamaz: sync varsayılanda `gh run list` çağırabilir.
  // Koşulu söylemek, koşulu yutmaktan iyidir (2026-07-29 düzeltmesi).
  satirlar.push(
    `Araç      : topbeam v${g.toolVersion} — deterministik, LLM yok; tek dış çağrı opsiyonel CI okuması (--no-ci ile kapalı).`,
  );
  satirlar.push('');
  satirlar.push('## Sözler ve dayanakları');
  satirlar.push('');

  for (const item of g.items) {
    satirlar.push(`- ${item.title}`);
    const imzalar = item.claimIds
      .map((cid) => g.ledger.gecerli.get(cid))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    const enSon = imzalar.reduce<string | null>((acc, e) => (acc === null || e.at > acc ? e.at : acc), null);
    const kimler = [...new Set(imzalar.map((e) => e.by))].sort().join(', ');
    satirlar.push(
      `  - onay: ${kimler === '' ? 'imza kaydı yok' : kimler}` +
        `${enSon !== null ? ` — ${fmtTs(enSon)}` : ''}`,
    );
    satirlar.push(`  - dayanak: ${item.claimIds.length} kayıt (${kanitDokumu(item, byId)})`);
  }

  satirlar.push('');
  satirlar.push('## Bu mühür ne demek DEĞİL');
  satirlar.push('');
  satirlar.push('- "Ürün hatasız" demek değildir: yalnız yukarıdaki sözlerin kapsamı kadardır.');
  satirlar.push('- Sözleri insan yazdı, onayı insan verdi; Topbeam yalnız kaydı tuttu.');
  satirlar.push('- Kapsam dışında kalan iş bu mühre girmez — goal.md neyi yazdıysa o.');
  satirlar.push('- Bu dosya bir kayıttır, bir reklam değildir; sayılar ölçülmüştür, tahmin yoktur.');
  satirlar.push('');

  return `${satirlar.join('\n')}`;
}
