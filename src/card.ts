/**
 * Sıradaki-tek-hareket kartı üreticisi (GPT spec 6 alan — ürünün kalbi).
 *
 * Heuristik (deterministik, LLM yok):
 * 1) 'dogrulanmadi' claim'ler içinden EN SON dokunulanı seç (createdAt desc,
 *    eşitlikte id — sabit sıra) → kanıt-yükseltme hareketi öner.
 * 2) Hiç doğrulanmamış yoksa: kanıtlı ama insan onayı olmayan en yenisi →
 *    hareket = insan doğrulaması (ocean verify <id>).
 * 3) Her şey insan onaylıysa ya da hiç claim yoksa → sakin boş/tam kart.
 *
 * DÜRÜSTLÜK: kart claim'in metnini ve seviyesini AYNEN taşır — yükseltme yok,
 * süsleme yok. Kanıt satırları yalnız claim'de o türde kanıt VARSA dolar;
 * yoksa null (UI "kayıt yok" gösterir, alarm değil).
 */
import type { Card, CardEvidence, Claim, NextAction } from './types.ts';

// ── dış tipler ───────────────────────────────────────────────────────────────

export interface CardOptions {
  /** Projenin package.json scripts alanı (komut önerisi için; fs okuma sync katmanında). */
  scripts?: Readonly<Record<string, string>>;
  /** updatedAt için sabit zaman (test determinizmi). */
  now?: Date;
}

/** Kart ana butonunun göstereceği CLI komutu (pano statik — kullanıcı kopyalar). */
export function verifyCommand(claimId: string): string {
  return `ocean verify ${claimId}`;
}

/** package.json metninden scripts alanını güvenle çıkar (bozuk JSON → {}). */
export function scriptsFromPackageJson(jsonText: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ── yardımcılar ──────────────────────────────────────────────────────────────

/** createdAt desc, eşitlikte id asc — deterministik "en son dokunulan". */
function newestFirst(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((x, y) =>
    x.createdAt > y.createdAt ? -1 : x.createdAt < y.createdAt ? 1 : x.id.localeCompare(y.id),
  );
}

/** Claim kanıtlarını kartın ÜÇ AYRI satırına eşle — olmayan tür null kalır. */
function evidenceLines(claim: Claim): CardEvidence {
  let gitDiff: string | null = null;
  let testOutput: string | null = null;
  let humanApproval: string | null = null;
  for (const e of claim.evidence) {
    if (e.kind === 'git-diff' && gitDiff === null) gitDiff = e.summary;
    else if (e.kind === 'test-output' && testOutput === null) testOutput = e.summary;
    else if (e.kind === 'human' && humanApproval === null) humanApproval = e.summary;
  }
  return { gitDiff, testOutput, humanApproval };
}

/** Doğrulanmamış claim için kanıt-yükseltme hareketi (package.json scriptlerinden). */
function upgradeAction(claim: Claim, scripts: Readonly<Record<string, string>>): NextAction {
  if (claim.kind === 'test') {
    // Test sonucu okunamamıştı → testi yeniden koş, okunur sonuç al.
    if (typeof scripts.test === 'string') {
      return { verb: 'Testleri yeniden çalıştır ve sonucu kaydet.', command: 'npm test' };
    }
    const ref = claim.evidence.find((e) => e.ref !== undefined)?.ref;
    return ref !== undefined
      ? { verb: 'Test komutunu yeniden çalıştır ve sonucu kaydet.', command: ref }
      : { verb: 'Testleri yeniden çalıştır ve sonucu kaydet.' };
  }
  // Dosya claim'i: en güçlü yükseltme yolu = projenin kendi test kapısı.
  if (typeof scripts.test === 'string') {
    return { verb: 'Testleri çalıştır.', command: 'npm test' };
  }
  if (typeof scripts.build === 'string') {
    return { verb: "Build alıp değişikliğin derlendiğini gör.", command: 'npm run build' };
  }
  return { verb: "Değişikliğin git'te göründüğünü kontrol et.", command: 'git status' };
}

function upgradeUnknown(claim: Claim): string {
  if (claim.kind === 'test') return "Test koşumunun gerçek sonucu (geçti/kaldı sayısı) bilinmiyor.";
  return "Bu değişikliklerin git'te karşılığı görünmüyor — gerçekten uygulandı mı belirsiz.";
}

function upgradeDoneWhen(claim: Claim): string {
  if (claim.kind === 'test') {
    return `Test çıktısından okunur bir geçti/kaldı sonucu alındığında (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır.`;
  }
  return `Değişiklik git kaydında göründüğünde (dosya-kanıtı), test yeşil sonuç verdiğinde (test-kanıtı) ya da '${verifyCommand(claim.id)}' ile sen onayladığında (insan-onayı) bitti sayılır.`;
}

// ── dış API ──────────────────────────────────────────────────────────────────

/**
 * Claim listesinden sıradaki-tek-hareket kartını üret.
 * fact/factLevel seçilen claim'den AYNEN gelir — kart seviye yükseltmez.
 */
export function buildCard(claims: readonly Claim[], opts: CardOptions = {}): Card {
  const updatedAt = (opts.now ?? new Date()).toISOString();
  const scripts = opts.scripts ?? {};

  // Durum 3a: hiç kayıt yok — sakin boş kart.
  if (claims.length === 0) {
    return {
      id: 'kart-bos',
      fact: 'Henüz kanıtlı iş kaydı yok.',
      factLevel: 'dogrulanmadi',
      evidence: { gitDiff: null, testOutput: null, humanApproval: null },
      unknown: 'Claude Code bu projede henüz iz bırakmadı ya da senkron hiç koşmadı.',
      action: { verb: 'Senkronu çalıştır.', command: 'ocean sync' },
      why: 'Kart yalnız gerçek kayıtlardan üretilir; önce kayıtları toplamak gerekir.',
      doneWhen: 'İlk claim üretildiğinde kart gerçek işe geçer.',
      updatedAt,
    };
  }

  // Durum 1: en son dokunulan doğrulanmamış iş.
  const unverified = newestFirst(claims.filter((c) => c.level === 'dogrulanmadi'));
  const pickUnverified = unverified[0];
  if (pickUnverified !== undefined) {
    return {
      id: pickUnverified.id,
      fact: pickUnverified.text,
      factLevel: pickUnverified.level,
      evidence: evidenceLines(pickUnverified),
      unknown: upgradeUnknown(pickUnverified),
      action: upgradeAction(pickUnverified, scripts),
      why: 'En son dokunulan ve henüz doğrulanmamış iş bu.',
      doneWhen: upgradeDoneWhen(pickUnverified),
      updatedAt,
    };
  }

  // Durum 2: kanıtlı ama insan onayı yok → insan doğrulaması iste.
  const evidenced = newestFirst(
    claims.filter((c) => c.level === 'dosya-kaniti' || c.level === 'test-kaniti'),
  );
  const pickEvidenced = evidenced[0];
  if (pickEvidenced !== undefined) {
    return {
      id: pickEvidenced.id,
      fact: pickEvidenced.text,
      factLevel: pickEvidenced.level,
      evidence: evidenceLines(pickEvidenced),
      unknown: 'Ürünün senin gözünle istenen davranışı verdiği henüz doğrulanmadı.',
      action: { verb: 'Sonucu kendin doğrula.', command: verifyCommand(pickEvidenced.id) },
      why: 'Kanıtlı işler arasında insan onayı olmayan en yenisi bu.',
      doneWhen: `'${verifyCommand(pickEvidenced.id)}' ile insan onayı kaydedildiğinde (insan-onayı) bitti sayılır.`,
      updatedAt,
    };
  }

  // Durum 3b: her şey insan onaylı — sakin tam kart.
  const latest = newestFirst(claims)[0] as Claim; // claims.length > 0 garanti
  return {
    id: 'kart-tam',
    fact: latest.text,
    factLevel: latest.level,
    evidence: evidenceLines(latest),
    unknown: 'Şu an bekleyen doğrulanmamış iş görünmüyor.',
    action: { verb: 'Claude ile sıradaki işi başlat.' },
    why: 'Kayıtlı tüm işler insan onaylı.',
    doneWhen: 'Yeni iş kaydı düştüğünde kart güncellenir.',
    updatedAt,
  };
}
