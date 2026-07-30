/**
 * TESLİM SÖZLERİ — barın tek kaynağı.
 *
 * NEDEN VAR (SİSİFOS BARI): iş birimi bir Claude Code OTURUMUNA bağlıyken her
 * yeni kodlama oturumu PAYDAYI büyütüyordu — bugün 0/11, yarın çalışırsan
 * 0/12. Çalıştıkça bar senden UZAKLAŞIYORDU. Üstelik "2026-07-11 · 99 dosya ·
 * 40 test koşumu" bir ürün SÖZÜ değil arşiv kaydıdır; 99 dosyalık bir birime
 * onay istemek lastik damga üretir ve insan onayını değersizleştirir.
 *
 * ÇÖZÜM: birim = İNSANIN YAZDIĞI SÖZ. Pasaport maddeleri `.ocean/goal.md`
 * içindeki `- [ ]` satırlarından gelir: sonlu, kilitli, insan tanımlı. Oturum
 * eklemek payda büyütmez; payda ancak insan yeni bir söz YAZARSA büyür.
 *
 * EŞLEME (deterministik, LLM yok): söz satırındaki ipuçları claim'lerle
 * eşleştirilir —
 *   1. yol ipucu   : `src/auth`, `src/cli.ts`, `README.md` → o yola dokunan kayıt
 *   2. `test:` öneki: satır `test:` ile başlıyorsa YALNIZ test koşumu kayıtları
 *   3. `#etiket`    : kaydın metninde ya da yolunda geçen etiket
 * İpucu yoksa ya da hiçbir kayıt eşleşmiyorsa madde "kanıt yok" DURUR.
 * Uydurma yok: Topbeam bir sözün tutulduğunu asla tahmin etmez.
 *
 * DÜRÜSTLÜK SINIRI: bu dosya sözün SEVİYESİNİ hesaplar (eşleşen kayıtların EN
 * YÜKSEK kanıt seviyesi). Barı DOLDURAN şey bu seviye değil, defterle
 * (passport.jsonl, terminal imzalı) desteklenen insan onayıdır — o kapı
 * ledger.ts'te ve gevşetilemez.
 */
import { createHash } from 'node:crypto';
import type { Claim, EvidenceLevel, PassportItem, PassportItemStatus } from './types.ts';

/** Söz id öneki — claim/oturum id'leriyle karışmasın diye ayrı ad alanı. */
export const SOZ_PREFIX = 'soz-';

/** Söz metninin görünen üst sınırı (pasaport başlığı ile aynı ölçü). */
const TITLE_LEN = 120;

/** Bir söz satırından çıkarılan deterministik eşleme ipuçları. */
export interface GoalHints {
  /** Yol/dosya ipuçları (`src/auth`, `README.md`). */
  paths: string[];
  /** `#etiket` ipuçları (baştaki `#` olmadan). */
  tags: string[];
  /** Satır `test:` ile başlıyor → yalnız test koşumu kayıtları eşleşir. */
  testOnly: boolean;
}

/** `.ocean/goal.md` içindeki tek bir `- [ ]` satırı — insanın teslim sözü. */
export interface GoalItem {
  /** Kararlı id: metnin sha256'sından türetilir (metin değişirse söz de değişir). */
  id: string;
  /** Satırın görünen metni (ipuçları dâhil — insanın kendi cümlesi). */
  text: string;
  /** `- [x]` elle işaretlenmiş mi. BEYANDIR: barı doldurmaz. */
  checked: boolean;
  /** goal.md satır numarası (1 tabanlı) — insan dosyada bulabilsin. */
  line: number;
  hints: GoalHints;
}

// ── ayrıştırma ───────────────────────────────────────────────────────────────

/** `- [ ] metin` / `* [x] metin` (girinti serbest). */
const MADDE_RE = /^[-*]\s+\[([ xX])\]\s*(.*)$/;
/** `#etiket` — Türkçe harfler dâhil (\p{L}). */
const ETIKET_RE = /(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu;
/** `test:` öneki (büyük/küçük fark etmez). */
const TEST_ONEK_RE = /^test\s*:/i;
/** Bölü işareti taşıyan ASCII yol: `src/auth`, `src/collect/git.ts`. */
const YOL_RE = /^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?$/;
/** Uzantılı tek dosya: `README.md`, `package.json` (sayı-uzantı DEĞİL: `3.5` hariç). */
const DOSYA_RE = /^[A-Za-z0-9_@-]+\.[A-Za-z][A-Za-z0-9]{0,5}$/;

/** Token'ı sarmalayan tırnak/backtick/parantez ve kuyruk noktalamasını at. */
function tokenTemizle(raw: string): string {
  let t = raw.replace(/^[`'"“”‘’(\[]+/, '').replace(/[`'"“”‘’)\]]+$/, '');
  t = t.replace(/[,;:!?]+$/, '');
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t;
}

/**
 * Satır metninden yol ipuçlarını çıkar. ASCII-only charset bilinçli:
 * "giriş/çıkış" gibi Türkçe ifadeler yol sanılmasın diye.
 */
export function yolIpuclari(text: string): string[] {
  const out: string[] = [];
  for (const parca of text.split(/\s+/)) {
    const t = tokenTemizle(parca);
    if (t === '') continue;
    if (YOL_RE.test(t) || DOSYA_RE.test(t)) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function etiketIpuclari(text: string): string[] {
  const out: string[] = [];
  ETIKET_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ETIKET_RE.exec(text);
  while (m !== null) {
    const t = m[1] ?? '';
    if (t !== '' && !out.includes(t)) out.push(t);
    m = ETIKET_RE.exec(text);
  }
  return out;
}

export function ipuclariCikar(text: string): GoalHints {
  return {
    paths: yolIpuclari(text),
    tags: etiketIpuclari(text),
    testOnly: TEST_ONEK_RE.test(text.trim()),
  };
}

/** Deterministik kısa id — metin değişirse söz DEĞİŞİR (yeni söz, yeni onay). */
function sozId(text: string, tekrar: number): string {
  const norm = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
  const h = createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 8);
  return tekrar === 0 ? `${SOZ_PREFIX}${h}` : `${SOZ_PREFIX}${h}-${tekrar + 1}`;
}

function kisalt(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_LEN ? `${t.slice(0, TITLE_LEN)}…` : t;
}

/**
 * goal.md metnini teslim sözlerine ayrıştır.
 * `- [ ]` ve `- [x]` AYNI şekilde madde sayılır: elle atılan tik bir BEYANDIR,
 * barı doldurmaz — ama kullanıcı tikleyince maddesi listeden düşmez.
 */
export function parseGoalItems(raw: string): GoalItem[] {
  const out: GoalItem[] = [];
  const gorulen = new Map<string, number>();
  const satirlar = raw.split('\n');
  for (let i = 0; i < satirlar.length; i++) {
    const m = MADDE_RE.exec((satirlar[i] ?? '').trim());
    if (m === null) continue;
    const text = kisalt(m[2] ?? '');
    if (text === '') continue; // boş söz, söz değildir
    const anahtar = text.toLocaleLowerCase('en-US');
    const tekrar = gorulen.get(anahtar) ?? 0;
    gorulen.set(anahtar, tekrar + 1);
    out.push({
      id: sozId(text, tekrar),
      text,
      checked: (m[1] ?? ' ') !== ' ',
      line: i + 1,
      hints: ipuclariCikar(text),
    });
  }
  return out;
}

// ── eşleme ───────────────────────────────────────────────────────────────────

function yolNormal(p: string): string {
  return p.replace(/^\.\//, '').replace(/\/+$/, '').toLocaleLowerCase('en-US');
}

/** Yol ipucu bir claim yoluna uyuyor mu (tam eşit ya da dizin öneki). */
export function yolUyar(ipucu: string, yol: string): boolean {
  const i = yolNormal(ipucu);
  const y = yolNormal(yol);
  return i !== '' && (y === i || y.startsWith(`${i}/`));
}

/**
 * Bu claim bu söze bağlanır mı — SAF ve deterministik.
 *
 * NOT (dürüstlük): claim.signals.paths uzun listelerde KIRPILIR (fileCount tam
 * kalır). Eşleme yalnız kırpma sonrası duran yollara bakar; görünmeyen yol
 * eşleşme üretmez. Eksik eşleşme "kanıt yok" der — asla uydurulmuş eşleşme.
 */
export function claimEslesir(item: GoalItem, claim: Claim): boolean {
  const { paths, tags, testOnly } = item.hints;
  if (testOnly && claim.kind !== 'test') return false;

  const claimYollari = claim.signals?.paths ?? [];
  for (const ipucu of paths) {
    for (const y of claimYollari) if (yolUyar(ipucu, y)) return true;
  }
  if (tags.length > 0) {
    const saman = `${claim.text} ${claimYollari.join(' ')}`.toLocaleLowerCase('en-US');
    for (const t of tags) if (saman.includes(t.toLocaleLowerCase('en-US'))) return true;
  }
  // İpucusuz `test:` satırı: bütün test koşumu kayıtları bu söze bağlanır.
  return testOnly && paths.length === 0 && tags.length === 0;
}

/** Bir söze bağlanan claim'ler — deterministik sıra (zaman, sonra id). */
export function eslesenClaimler(item: GoalItem, claims: readonly Claim[]): Claim[] {
  return claims
    .filter((c) => claimEslesir(item, c))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
}

// ── madde kurulumu ───────────────────────────────────────────────────────────

/** Kanıt seviyesi güç sırası — sözün seviyesi EN YÜKSEK eşleşen kayıttır. */
const SEVIYE_GUC: Record<EvidenceLevel, number> = {
  dogrulanmadi: 0,
  'dosya-kaniti': 1,
  'test-kaniti': 2,
  'insan-onayi': 3,
};

export function enYuksekSeviye(claims: readonly Claim[]): EvidenceLevel {
  let en: EvidenceLevel = 'dogrulanmadi';
  for (const c of claims) if (SEVIYE_GUC[c.level] > SEVIYE_GUC[en]) en = c.level;
  return en;
}

/**
 * Teslim sözlerinden pasaportu kur.
 *
 * existing: önceki pasaport — insan kararı (verification) ve müşteri cümlesi
 * AYNI id'li sözden taşınır. Söz metni değişirse id de değişir: eski onay yeni
 * cümleyi kapsıyormuş gibi gösterilmez (kayıt passport.jsonl'de durmaya devam
 * eder — append-only defter hiçbir şey kaybetmez).
 *
 * Silinen söz listeden düşer. Sözü silerek bar doldurulamaz: mühür yalnız son
 * ONAY anında yazılır (verify.ts).
 */
export function buildTeslim(
  existing: readonly PassportItem[],
  claims: readonly Claim[],
  items: readonly GoalItem[],
): PassportItem[] {
  const oncekiler = new Map(existing.map((p) => [p.id, p]));
  const out: PassportItem[] = [];

  for (const item of items) {
    const eslesen = eslesenClaimler(item, claims);
    const n = eslesen.length;
    const onayliSayi = eslesen.filter((c) => c.level === 'insan-onayi').length;
    const level = enYuksekSeviye(eslesen);
    const prev = oncekiler.get(item.id);
    const verification = prev?.verification;

    let status: PassportItemStatus;
    let reason: string;
    if (n === 0) {
      status = 'not_verified';
      reason =
        item.hints.paths.length === 0 && item.hints.tags.length === 0 && !item.hints.testOnly
          ? 'No evidence — this promise carries no hint to bind records to it (a path, a `test:` prefix or a #tag).'
          : 'No evidence — no record matched the hint.';
    } else if (onayliSayi === n) {
      status = 'completed';
      reason = n > 1 ? `All ${n} records are human-approved.` : '1 record is human-approved.';
    } else if (verification !== undefined) {
      /**
       * ⚠️ ONAY GERİ ALINMAZ (2026-07-30, canlı ölçümle bulundu).
       *
       * Eskiden burada status 'partial'a düşüyordu: sözü onayladıktan SONRA aynı
       * alanda yeni iş yapınca yeni bir doğrulanmamış kayıt aynı söze eşleşiyor
       * ve BAR GERİLİYORDU. Ölçüldü: 1/5 → 0/5, hem de insan imzası defterde
       * dururken.
       *
       * Bu, Sisifos barının İKİNCİ yüzüydü: paydayı sabitlemiştik, bu kez PAY
       * eriyordu. Sonuç aynı — çalıştıkça bitiş uzaklaşıyor, yani ürünün çözmek
       * için var olduğu şeyin ta kendisi.
       *
       * Doğru model: **onay, insanın o an gördüğü şey hakkında bir olgudur.**
       * Sonradan yapılan iş onu geçersizleştirmez; ancak YENİ, ayrı bir iştir.
       * Söz `completed` kalır — ama yeni kayıt SESSİZ DE KALMAZ: gerekçede
       * kaç yeni kaydın onaydan sonra geldiği yazılır.
       */
      /**
       * İNCE AYRIM: "onay geri alınmaz" ≠ "dayanağı buharlaşsa da onaylı kalır".
       *   - En az BİR onaylı kayıt duruyorsa → completed (yeni iş onu bozmaz)
       *   - HİÇ onaylı kayıt kalmadıysa → completed DEMEK YALAN olur.
       *     (Onaylanan kaydın kendisi düşmüş demektir: transcript değişmiş ya da
       *     30 günlük saklama silmiş olabilir. İmza defterde durur, ama söz
       *     "tamam" diye gösterilemez.)
       */
      const yeni = n - onayliSayi;
      if (onayliSayi > 0) {
        status = 'completed';
        reason =
          yeni > 0
            ? `Human-approved (${verification.at.slice(0, 10)}). Since that approval, ${yeni} new ` +
              'unverified records appeared in this area — an approval is not taken back, but new work is separate work.'
            : `${onayliSayi}/${n} records human-approved.`;
      } else {
        status = 'partial';
        reason =
          `The signature is still in the ledger (${verification.at.slice(0, 10)}) but the record you ` +
          'approved can no longer be reproduced (the transcript may have changed, or retention may have ' +
          'deleted it) — the promise cannot be shown as kept.';
      }
    } else if (onayliSayi > 0) {
      status = 'partial';
      reason = `${onayliSayi}/${n} records human-approved — the promise is not kept yet.`;
    } else {
      status = 'not_verified';
      reason = `${n} records matched — no human approval.`;
    }

    // Elle atılan `[x]` tik BEYANDIR: sayıya girmez, ama sessizce de yutulmaz.
    if (item.checked && status !== 'completed') {
      reason = `Ticked by hand in goal.md — that is a statement, not evidence. ${reason}`;
    }

    out.push({
      id: item.id,
      title: item.text,
      status,
      claimIds: eslesen.map((c) => c.id),
      level,
      reason,
      ...(prev?.clientText !== undefined ? { clientText: prev.clientText } : {}),
      ...(verification !== undefined ? { verification } : {}),
    });
  }

  return out;
}
