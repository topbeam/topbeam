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
  'dosya-kaniti': 'file evidence',
  'test-kaniti': 'test evidence',
  'insan-onayi': 'human approval',
  dogrulanmadi: 'not verified',
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
  return parcalar.length > 0 ? parcalar.join(' · ') : 'no records found';
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

  satirlar.push(`# Seal — ${g.projectName}`);
  satirlar.push('');
  satirlar.push(`Locked   : ${fmtTs(g.at)}  (${g.at})`);
  satirlar.push(`Scope    : ${g.items.length} delivery promises — every one human-approved.`);
  satirlar.push(`Signed by: ${g.by} (terminal approval, .ocean/passport.jsonl)`);
  // "ağ yok" KOŞULSUZ yazılamaz: sync varsayılanda `gh run list` çağırabilir.
  // Koşulu söylemek, koşulu yutmaktan iyidir (2026-07-29 düzeltmesi).
  satirlar.push(
    `Tool     : topbeam v${g.toolVersion} — deterministic, no LLM; the one outbound call is the optional CI read (off with --no-ci).`,
  );
  satirlar.push('');
  satirlar.push('## The promises, and what they rest on');
  satirlar.push('');

  for (const item of g.items) {
    satirlar.push(`- ${item.title}`);
    const imzalar = item.claimIds
      .map((cid) => g.ledger.gecerli.get(cid))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    const enSon = imzalar.reduce<string | null>((acc, e) => (acc === null || e.at > acc ? e.at : acc), null);
    const kimler = [...new Set(imzalar.map((e) => e.by))].sort().join(', ');
    satirlar.push(
      `  - approved by: ${kimler === '' ? 'no signature on record' : kimler}` +
        `${enSon !== null ? ` — ${fmtTs(enSon)}` : ''}`,
    );
    satirlar.push(`  - rests on: ${item.claimIds.length} records (${kanitDokumu(item, byId)})`);
  }

  satirlar.push('');
  satirlar.push('## What this seal does NOT mean');
  satirlar.push('');
  satirlar.push('- It does not say the product is free of defects: it reaches exactly as far as the promises above.');
  satirlar.push('- A person wrote the promises and a person approved them; Topbeam only kept the record.');
  satirlar.push('- Work outside that scope is not in this seal — it covers what goal.md says, nothing more.');
  satirlar.push('- This is a record, not an advertisement: the numbers were measured, none were guessed.');
  satirlar.push('');

  return `${satirlar.join('\n')}`;
}
