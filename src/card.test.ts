/**
 * card.ts testleri — kart claim'i AYNEN taşır, seviye yükseltmez,
 * kanıt satırı uydurmaz (dürüstlük invaryantları kilitli).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Claim } from './types.ts';
import { CARD_PRIMARY_BUTTON_TR } from './types.ts';
import {
  HEURISTIC,
  RULE_ORDER,
  buildCard,
  claimKritik,
  kritikTur,
  normalizeCommand,
  parseKosum,
  pathTokens,
  sameTestRun,
  scriptsFromPackageJson,
  verifyCommand,
} from './card.ts';
import { buildCalisiyorClaim } from './truth.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function claim(id: string, over: Partial<Claim> = {}): Claim {
  return {
    id,
    text: `1 dosya için düzenleme kaydı var ama git'te izi yok — uygulandı görünüyor, doğrulanmadı: x.ts`,
    level: 'dogrulanmadi',
    kind: 'dosya',
    evidence: [{ kind: 'transcript-tool-use', summary: 'Transcript: 1 dosyada Edit görüldü.', ref: 's1' }],
    sessionId: 's1',
    createdAt: '2026-07-28T10:00:00.000Z',
    ...over,
  };
}

/** Doğrulanmamış dosya claim'i + ölçülmüş sinyaller (git izi YOK varsayılan). */
function dosyaClaim(id: string, paths: string[], over: Partial<Claim> = {}): Claim {
  return claim(id, {
    text:
      `${paths.length} dosya için düzenleme kaydı var ama git'te izi yok ` +
      `(commit'lenmiş ya da geri alınmış olabilir) — uygulandı görünüyor, doğrulanmadı: ${paths.join(', ')}`,
    signals: { fileCount: paths.length, paths, noGitTrace: true },
    ...over,
  });
}

/** Test claim'i (kanıtlı ya da değil; sinyalleri çağıran verir). */
function testClaim(id: string, over: Partial<Claim> = {}): Claim {
  return claim(id, {
    kind: 'test',
    level: 'test-kaniti',
    text: 'Test koşumunda 2 test başarısız, 17 test geçti (npm test).',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'npm test' }],
    signals: { failedTests: 2, passedTests: 17 },
    ...over,
  });
}

// ── boş / tam durumlar ───────────────────────────────────────────────────────

test('hiç claim yok → sakin boş kart, aksiyon topbeam sync', () => {
  const card = buildCard([], { now: NOW });
  assert.equal(card.id, 'kart-bos');
  assert.equal(card.factLevel, 'dogrulanmadi');
  assert.deepEqual(card.evidence, { gitDiff: null, testOutput: null, humanApproval: null });
  assert.equal(card.action.command, 'topbeam sync');
  assert.equal(card.updatedAt, NOW.toISOString());
  // Sakin dil: alarm/motivasyon/yüzde yok.
  const all = `${card.fact} ${card.unknown} ${card.why} ${card.doneWhen}`;
  assert.ok(!/[!%]|ACİL|hemen/i.test(all));
});

test('her şey insan onaylı → tam kart, bekleyen iş yok', () => {
  const c = buildCalisiyorClaim('Giriş akışı', { by: 'Ekin', at: '2026-07-28T11:00:00.000Z', decision: 'approved' });
  const card = buildCard([c], { now: NOW });
  assert.equal(card.id, 'kart-tam');
  assert.equal(card.factLevel, 'insan-onayi');
  assert.equal(card.evidence.humanApproval, c.evidence[0]?.summary);
  assert.equal(card.action.command, undefined);
});

// ── seçim heuristiği ─────────────────────────────────────────────────────────

test('en son dokunulan doğrulanmamış claim seçilir (createdAt desc)', () => {
  const eski = claim('dosya-transcript-s1', { createdAt: '2026-07-28T09:00:00.000Z' });
  const yeni = claim('dosya-transcript-s2', { createdAt: '2026-07-28T11:00:00.000Z', sessionId: 's2' });
  const kanitli = claim('dosya-git-s1', {
    level: 'dosya-kaniti',
    text: '2 dosya değişti: a.ts, b.ts',
    createdAt: '2026-07-28T11:30:00.000Z', // daha yeni ama doğrulanmamış öncelikli
    evidence: [
      { kind: 'transcript-tool-use', summary: 't' },
      { kind: 'git-diff', summary: 'g' },
    ],
  });
  const card = buildCard([eski, kanitli, yeni], { now: NOW });
  assert.equal(card.id, 'dosya-transcript-s2');
  assert.equal(card.fact, yeni.text);
  assert.equal(card.factLevel, 'dogrulanmadi');
  assert.equal(card.why, 'En son dokunulan ve henüz doğrulanmamış iş bu.');
});

test('eşit createdAt → id sırası (deterministik seçim)', () => {
  const a = claim('dosya-transcript-a');
  const b = claim('dosya-transcript-b');
  const c1 = buildCard([b, a], { now: NOW });
  const c2 = buildCard([a, b], { now: NOW });
  assert.equal(c1.id, 'dosya-transcript-a');
  assert.deepEqual(c1, c2);
});

test('doğrulanmamış yoksa: kanıtlı-ama-onaysız en yenisi → topbeam verify aksiyonu', () => {
  const kanitli = claim('test-s1-0', {
    level: 'test-kaniti',
    kind: 'test',
    text: '19 test geçti, 0 başarısız (npm test).',
    evidence: [{ kind: 'test-output', summary: '# pass 19', ref: 'npm test' }],
  });
  const card = buildCard([kanitli], { now: NOW });
  assert.equal(card.id, 'test-s1-0');
  assert.equal(card.factLevel, 'test-kaniti'); // seviye AYNEN — yükseltme yok
  assert.equal(card.action.command, verifyCommand('test-s1-0'));
  assert.ok(card.doneWhen.includes('topbeam verify test-s1-0'));
  assert.ok(card.doneWhen.includes('insan-onayı'));
});

// ── komut önerisi (package.json scripts) ─────────────────────────────────────

test('scripts.test varsa dosya claim\'i için npm test önerilir', () => {
  const card = buildCard([claim('dosya-transcript-s1')], { now: NOW, scripts: { test: 'node --test' } });
  assert.equal(card.action.command, 'npm test');
  assert.ok(card.action.verb.length > 0);
});

test('scripts.test yok + scripts.build var → npm run build; ikisi de yoksa git status', () => {
  const c = claim('dosya-transcript-s1');
  assert.equal(buildCard([c], { now: NOW, scripts: { build: 'node scripts/build.mjs' } }).action.command, 'npm run build');
  assert.equal(buildCard([c], { now: NOW }).action.command, 'git status');
  // git BİLİNİYORSA da davranış aynı — varsayım değil, bilgi değiştirir.
  assert.equal(buildCard([c], { now: NOW, isGitRepo: true }).action.command, 'git status');
});

test('GİT YOK: "git status" ÖNERİLMEZ — hareket insan onayına döner (sahte affordance yok)', () => {
  const c = claim('dosya-transcript-s1');
  const card = buildCard([c], { now: NOW, isGitRepo: false });
  assert.notEqual(card.action.command, 'git status');
  assert.equal(card.action.command, verifyCommand('dosya-transcript-s1'));
  assert.ok(card.action.verb.includes('git deposu değil'));
  // Bitiş koşulu da ERİŞİLEBİLİR olmalı: kapalı yol (dosya-kanıtı) vaat edilmez.
  assert.equal(card.doneWhen.includes('git kaydında göründüğünde'), false);
  assert.ok(card.doneWhen.includes('insan-onayı'));
  // Kanıt seviyesi GEVŞEMEZ: git yok diye iddia yükselmez.
  assert.equal(card.factLevel, 'dogrulanmadi');
});

test('GİT YOK ama test scripti VAR → hâlâ en güçlü kanıt yolu önerilir (testler)', () => {
  const card = buildCard([claim('dosya-transcript-s1')], {
    now: NOW,
    isGitRepo: false,
    scripts: { test: 'node --test' },
  });
  assert.equal(card.action.command, 'npm test');
});

test('doğrulanmamış test claim\'i → komut evidence ref\'inden gelir (scripts yoksa)', () => {
  const t = claim('test-s1-0', {
    kind: 'test',
    text: 'Test komutu koşuldu (npx vitest run) ama sonuç çıktıdan okunamadı — doğrulanmadı.',
    evidence: [{ kind: 'transcript-tool-use', summary: 'koştu', ref: 'npx vitest run' }],
  });
  assert.equal(buildCard([t], { now: NOW }).action.command, 'npx vitest run');
  assert.equal(buildCard([t], { now: NOW, scripts: { test: 'vitest' } }).action.command, 'npm test');
});

// ── GPT spec alan bütünlüğü + dürüstlük invaryantları ────────────────────────

test('İNVARYANT: kart kanıt satırı uydurmaz — claim\'de olmayan tür null', () => {
  const yalnizTranscript = claim('dosya-transcript-s1');
  const card = buildCard([yalnizTranscript], { now: NOW });
  assert.equal(card.evidence.gitDiff, null);
  assert.equal(card.evidence.testOutput, null);
  assert.equal(card.evidence.humanApproval, null);

  const karisik = claim('dosya-git-s1', {
    level: 'dosya-kaniti',
    evidence: [
      { kind: 'transcript-tool-use', summary: 't' },
      { kind: 'git-diff', summary: 'git: 2 dosyanın kaydı var.' },
    ],
  });
  const card2 = buildCard([karisik], { now: NOW });
  assert.equal(card2.evidence.gitDiff, 'git: 2 dosyanın kaydı var.');
  assert.equal(card2.evidence.testOutput, null);
  assert.equal(card2.evidence.humanApproval, null);
});

test('İNVARYANT: fact/factLevel claim\'den AYNEN — kart asla seviye yükseltmez', () => {
  const c = claim('dosya-transcript-s1');
  const card = buildCard([c], { now: NOW });
  assert.equal(card.fact, c.text);
  assert.equal(card.factLevel, c.level);
  assert.ok(card.fact.includes('doğrulanmadı')); // dürüst etiket kartta korunur
});

test('GPT spec: 6 alan dolu + tek bilinmeyen + açık bitiş koşulu', () => {
  const card = buildCard([claim('dosya-transcript-s1')], { now: NOW, scripts: { test: 'node --test' } });
  assert.ok(card.fact.length > 0); // (a)
  assert.ok(card.factLevel); // (a) kesinlik açık
  assert.ok('gitDiff' in card.evidence && 'testOutput' in card.evidence && 'humanApproval' in card.evidence); // (b) üç ayrı satır
  assert.ok(card.unknown.length > 0 && !card.unknown.includes('\n')); // (c) TEK bilinmeyen
  assert.ok(card.action.verb.length > 0); // (d)
  assert.ok(card.why.length > 0 && !card.why.includes('\n')); // (e) tek cümle
  assert.ok(card.doneWhen.includes('kanıt') || card.doneWhen.includes('onay')); // (f) kanıt-yükseltme koşulu
  assert.ok(card.doneWhen.includes(`topbeam verify ${card.id}`)); // buton komutla uyumlu
  assert.equal(CARD_PRIMARY_BUTTON_TR, 'Doğrulamayı başlat');
});

// ═══════════════════════════════════════════════════════════════════════════
// KART ZEKÂSI — kural kural fixture'lar (her kuralın kendi kanıtı)
// ═══════════════════════════════════════════════════════════════════════════

// ── 1) kirik-test ────────────────────────────────────────────────────────────

test('kural kirik-test: başarısız test, DAHA YENİ doğrulanmamış işin önüne geçer', () => {
  const kirik = testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' });
  const yeni = claim('dosya-transcript-s2', { createdAt: '2026-07-28T11:00:00.000Z', sessionId: 's2' });

  const card = buildCard([yeni, kirik], { now: NOW, scripts: { test: 'node --test' } });

  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.id, 'test-s1-0');
  assert.equal(card.factLevel, 'test-kaniti'); // seviye AYNEN — kural yükseltmez/düşürmez
  assert.equal(card.fact, kirik.text);
  assert.ok(card.why.includes('2 başarısız'));
  assert.equal(card.action.command, 'npm test'); // kayıtlı komutla AYNI koşum
  assert.equal(card.evidence.testOutput, 'ℹ fail 2');
  assert.ok(card.doneWhen.includes('test-kanıtı'));
});

test('kural kirik-test: sıfır-dışı exit de kırık sayılır — seviye doğrulanmadı KALIR', () => {
  const t = claim('test-s1-1', {
    kind: 'test',
    text: 'Test komutu koşuldu (npx vitest run) ama sonuç çıktıdan okunamadı — doğrulanmadı. Komut exit 1 ile bitti.',
    evidence: [{ kind: 'transcript-tool-use', summary: 'koştu', ref: 'npx vitest run' }],
    signals: { nonZeroExit: 1 },
  });
  const card = buildCard([t], { now: NOW });

  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.factLevel, 'dogrulanmadi'); // kanıt seviyesi ASLA yükseltilmez
  assert.ok(card.why.includes('exit 1'));
  assert.equal(card.action.command, 'npx vitest run');
  assert.equal(card.evidence.testOutput, null); // kanıt uydurulmaz
});

test('kirik-test: SİNYALLE ölen koşum (exit 143/130) kırık sayılmaz — yanlış alarm yok', () => {
  // Dogfood dersi: exit 143 = SIGTERM (zaman aşımı/kill), test başarısızlığı değil.
  const kesinti = claim('test-s1-0', {
    kind: 'test',
    text: 'Test komutu koşuldu (npx playwright test) ama sonuç çıktıdan okunamadı — doğrulanmadı. Komut exit 143 ile bitti.',
    signals: { nonZeroExit: 143 },
    createdAt: '2026-07-28T08:00:00.000Z',
  });
  const yeni = claim('dosya-transcript-s2', { createdAt: '2026-07-28T11:00:00.000Z', sessionId: 's2' });

  const card = buildCard([kesinti, yeni], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-s2');

  assert.equal(buildCard([claim('t', { kind: 'test', signals: { nonZeroExit: 130 } })], { now: NOW }).rule, 'en-yeni');
  // Sınır: 127 gerçek hata çıkışıdır, kırık sayılır.
  assert.equal(buildCard([claim('t', { kind: 'test', signals: { nonZeroExit: 127 } })], { now: NOW }).rule, 'kirik-test');
});

test('kirik-test: kayıtlı sayı varsa exit koduna bakılmaz (143 olsa da kırık)', () => {
  const c = testClaim('test-s1-0', { signals: { failedTests: 3, passedTests: 10, nonZeroExit: 143 } });
  const card = buildCard([c], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.ok(card.why.includes('3 başarısız'));
});

test('hareket komutu SAHTE AFFORDANCE olamaz: uzun kabuk zinciri butona konmaz', () => {
  const uzun = `cd ~/proje && CHROME="$HOME/Library/Caches/chromium/chrome" "$CHROME" --headless --print-to-pdf="rapor.pdf" "file://$PWD/rapor.html" 2>&1 | tail -3`;
  assert.ok(uzun.length > 120);
  const c = claim('test-s1-0', {
    kind: 'test',
    text: 'Test komutu koşuldu ama sonuç çıktıdan okunamadı — doğrulanmadı.',
    evidence: [{ kind: 'test-output', summary: 'çıktı okunamadı', ref: uzun }],
    signals: { nonZeroExit: 1 },
  });

  // scripts yoksa: komut YOK (kırpılmış komut verilmez), fiil tek başına durur.
  const card = buildCard([c], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.action.command, undefined);
  assert.ok(card.action.verb.length > 0);

  // scripts.test varsa gerçekten çalıştırılabilir komuta düşer.
  assert.equal(buildCard([c], { now: NOW, scripts: { test: 'node --test' } }).action.command, 'npm test');
});

test('kirik-test: geçen test kırık sayılmaz + varsayılan exit 0 sinyali yok', () => {
  const yesil = testClaim('test-s1-0', {
    text: '19 test geçti, 0 başarısız (npm test).',
    signals: { passedTests: 19, failedTests: 0 },
  });
  const card = buildCard([yesil], { now: NOW });
  assert.notEqual(card.rule, 'kirik-test');
  assert.equal(card.rule, 'insan-onayi-bekliyor'); // kanıtlı, onay bekliyor
});

// ── kırık testin ömrü: sonradan yeşillendi mi? (kart kendi log'uyla çelişmez) ──

/** Aynı komutun temiz geçen SONRAKİ koşumu. */
function yesilClaim(id: string, over: Partial<Claim> = {}): Claim {
  return claim(id, {
    kind: 'test',
    level: 'test-kaniti',
    text: '19 test geçti, 0 başarısız (npm test).',
    evidence: [{ kind: 'test-output', summary: 'ℹ pass 19', ref: 'npm test' }],
    signals: { failedTests: 0, passedTests: 19 },
    createdAt: '2026-07-28T11:00:00.000Z',
    ...over,
  });
}

test('(a) kırık test SONRADAN yeşillendi → manşetten düşer, sıradaki kurala geçilir', () => {
  const kirik = testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' });
  const yesil = yesilClaim('test-s1-1'); // aynı komut (npm test), 3 saat sonra
  const acik = claim('dosya-transcript-s2', { createdAt: '2026-07-28T09:00:00.000Z', sessionId: 's2' });

  const card = buildCard([kirik, yesil, acik], { now: NOW });

  assert.notEqual(card.rule, 'kirik-test'); // kart kendi log'uyla çelişmez
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-s2');
  // Kayıt SİLİNMEZ — yalnız manşetten düşer (claim listede duruyor).
  assert.ok([kirik, yesil, acik].some((c) => c.id === 'test-s1-0'));
});

test('(b) FARKLI DİZİNDE yeşil koşum → kırık test manşette KALIR', () => {
  const kirik = testClaim('test-s1-0', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'cd kok/paket-a && npm test' }],
  });
  const baskaDizin = yesilClaim('test-s1-1', {
    text: '4 test geçti, 0 başarısız (npx vitest run).',
    evidence: [{ kind: 'test-output', summary: 'ℹ pass 4', ref: 'cd kok/paket-b && npx vitest run' }],
    signals: { failedTests: 0, passedTests: 4 },
  });

  const card = buildCard([kirik, baskaDizin], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.id, 'test-s1-0');
});

test('(b2) AYNI DİZİNDE başka komut yeşillendi → kırık test manşetten düşer', () => {
  // Kırık kayıt tek dosyalık koşum; sonradan aynı dizinde tüm paket yeşil geçti.
  // Eski davranış komut ÇEKİRDEĞİNE bakıp bunu kaçırıyordu (kart log'uyla çelişiyordu).
  const kirik = testClaim('test-s1-0', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'node --test src/card.test.ts' }],
  });
  const yesil = yesilClaim('test-s1-1'); // npm test — aynı dizin (proje kökü), 3 saat sonra
  const acik = claim('dosya-transcript-s2', { createdAt: '2026-07-28T09:00:00.000Z', sessionId: 's2' });

  const card = buildCard([kirik, yesil, acik], { now: NOW });
  assert.notEqual(card.rule, 'kirik-test');
  assert.equal(card.id, 'dosya-transcript-s2');

  // Açık `cd` hedefi iki tarafta da aynıysa da düşer (dizin = kapsam).
  const kirikCd = testClaim('test-s2-0', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'cd kok/proje && node --test src/a.test.ts' }],
  });
  const yesilCd = yesilClaim('test-s2-1', {
    evidence: [{ kind: 'test-output', summary: 'ℹ pass 19', ref: 'cd kok/proje && npm test' }],
  });
  assert.notEqual(buildCard([kirikCd, yesilCd], { now: NOW }).rule, 'kirik-test');
});

test('(c) kırık testten SONRA hiçbir şey yok → manşette kalır', () => {
  const kirik = testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' });
  assert.equal(buildCard([kirik], { now: NOW }).rule, 'kirik-test');

  // Yeşil koşum kırıktan ÖNCE ise de düşürmez (sıra önemli).
  const oncekiYesil = yesilClaim('test-s1-1', { createdAt: '2026-07-28T07:00:00.000Z' });
  assert.equal(buildCard([kirik, oncekiYesil], { now: NOW }).rule, 'kirik-test');
});

test('yeşillenme eşleşmesi boşluk/yol/yazım farklarına dayanıklı (normalizeCommand)', () => {
  // Aynı koşumun farklı yazımları TEK anahtara iner.
  assert.equal(normalizeCommand('  npm   run   test '), 'npm test');
  assert.equal(normalizeCommand('npm t'), 'npm test');
  assert.equal(
    normalizeCommand('cd "/Users/dev/Desktop/Benim Proje/ocean-cli" && node --test src/card.test.ts'),
    normalizeCommand('node --test /Users/dev/proje/src/card.test.ts'),
  );
  assert.equal(normalizeCommand('pnpm run test'), 'pnpm test');
  // Farklı koşum farklı anahtar kalır (yanlış eşleşme yok).
  assert.notEqual(normalizeCommand('npm test'), normalizeCommand('npm run build'));
  assert.notEqual(normalizeCommand('node --test src/a.test.ts'), normalizeCommand('node --test src/b.test.ts'));
  // Aynı ADLI ama farklı dizindeki dosya çakışmaz (son iki parça korunur).
  assert.notEqual(normalizeCommand('node --test src/a.test.ts'), normalizeCommand('node --test test/a.test.ts'));

  // Uçtan uca: proje kökü farklı yazılmış aynı komut yeşillenmeyi kapatır.
  const kirik = testClaim('test-s1-0', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'node --test src/card.test.ts' }],
  });
  const yesil = yesilClaim('test-s1-1', {
    evidence: [
      { kind: 'test-output', summary: 'ℹ pass 19', ref: 'cd /Users/dev/proje && node --test "src/card.test.ts"' },
    ],
  });
  assert.notEqual(buildCard([kirik, yesil], { now: NOW }).rule, 'kirik-test');
});

test('koşum kimliği: çıktı filtresi koşumu değiştirmez, dizin ve satır sonu ayracı korunur', () => {
  // Aynı test, başka grep/head süzgeci → AYNI koşum (kimliğe filtre girmez).
  assert.ok(
    sameTestRun(
      'cd "/Users/dev/Desktop/Benim Proje/proje" && npm test 2>&1 | grep -A20 "✖" | head -40',
      'perl -0pi -e "s/a/b/" x.test.ts && npm test 2>&1 | grep -E "tests |pass |fail"',
    ),
  );
  // Aynı dizin, iki ayrı yazım (tırnak parça parça) → yine aynı koşum.
  assert.ok(
    sameTestRun(
      'cd ~/Desktop/"Benim Proje"/proje && npm test',
      'cd "/Users/dev/Desktop/Benim Proje/proje" && npm test 2>&1 | tail -3',
    ),
  );
  // AÇIKÇA farklı alt-projede koşulan aynı komut → ayrı koşum (yanlış temizleme yok).
  assert.equal(sameTestRun('cd kok/buildpassport && npm test', 'cd kok/ocean-cli && npm test'), false);
  // Çok satırlı blokta satır sonu komut ayracıdır (tek dev komut sanılmaz).
  assert.equal(parseKosum('cd kok/proje\nnode --test scripts/test.mjs 2>&1 | tail -5')?.core, 'node --test scripts/test.mjs');
  assert.equal(parseKosum('cd kok/proje\nnode --test scripts/test.mjs')?.scope, 'kok/proje');
  // Test parçası yoksa kimlik komutun tamamıdır (geri sarma).
  assert.equal(parseKosum('node scripts/build.mjs')?.core, 'node scripts/build.mjs');
});

test('yeşillenme kanıtı SIKI: hata çıkışlı ya da sayısız koşum kırığı temizlemez', () => {
  const kirik = testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' });

  // 0 başarısız ama komut exit 1 ile bitmiş → temiz koşum sayılmaz.
  const supheli = yesilClaim('test-s1-1', { signals: { failedTests: 0, passedTests: 19, nonZeroExit: 1 } });
  assert.equal(buildCard([kirik, supheli], { now: NOW }).rule, 'kirik-test');

  // Sayı okunamamış koşum (passedTests yok) → temiz koşum sayılmaz.
  const sayisiz = yesilClaim('test-s1-2', { signals: { failedTests: 0 } });
  assert.equal(buildCard([kirik, sayisiz], { now: NOW }).rule, 'kirik-test');

  // Komut kaydı olmayan kırık claim eşleştirilemez → muhafazakâr: kırık kalır.
  const komutsuz = testClaim('test-s1-3', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2' }],
  });
  assert.equal(buildCard([komutsuz, yesilClaim('test-s1-4')], { now: NOW }).rule, 'kirik-test');
});

test('yeşillenme kontrolü DETERMİNİSTİK: girdi sırası kartı değiştirmez', () => {
  const claims = [
    testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' }),
    yesilClaim('test-s1-1'),
    claim('dosya-transcript-s2', { createdAt: '2026-07-28T09:00:00.000Z', sessionId: 's2' }),
  ];
  const a = buildCard(claims, { now: NOW });
  const b = buildCard([...claims].reverse(), { now: NOW });
  assert.deepEqual(a, b);
  assert.deepEqual(buildCard(claims, { now: NOW }), a); // aynı girdi → aynı kart
});

test('birden çok kırık kayıt: yalnız AYNI DİZİNDE yeşillenen düşer, öteki manşete geçer', () => {
  const kirikA = testClaim('test-s1-0', {
    createdAt: '2026-07-28T08:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'cd kok/paket-a && npx vitest run' }],
    signals: { failedTests: 2, passedTests: 5 },
  });
  const kirikB = testClaim('test-s1-1', { createdAt: '2026-07-28T09:00:00.000Z' }); // npm test, proje kökü
  const yesilB = yesilClaim('test-s1-2'); // npm test, proje kökü → yalnız kirikB'yi düşürür

  const card = buildCard([kirikA, kirikB, yesilB], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.id, 'test-s1-0'); // başka dizindeki kırık manşete geçti
});

// ── bayat kırık kayıt: tazelik damgası yanıltmaz ─────────────────────────────

test('BAYAT kırık kayıt manşette KALIR ama tarihini + yaşını AÇIKÇA yazar', () => {
  const eski = testClaim('test-s1-0', { createdAt: '2026-07-11T09:00:00.000Z' }); // 17 gün önce
  const card = buildCard([eski], { now: NOW });

  // Yeşile döndüğü kayıt YOK → gizlenmez (yaşlandırarak susmak dürüstlüğü deler).
  assert.equal(card.rule, 'kirik-test');
  assert.ok(card.why.includes('2026-07-11'), 'gerekçe kaydın tarihini yazmalı');
  assert.ok(card.why.includes('17 gün'), 'gerekçe kaydın yaşını yazmalı');
  assert.ok(card.why.includes('bugünün ölçümü değil'));
  assert.ok(card.unknown.includes('2026-07-11'), 'bilinmeyen satırı da tarihi taşımalı');
  assert.ok(!card.why.includes('\n') && !card.unknown.includes('\n')); // tek cümle korunur
});

test('BAYAT etiketi sıfır-dışı exit dalında da çalışır', () => {
  const eskiExit = claim('test-s1-1', {
    kind: 'test',
    text: 'Test komutu koşuldu (npx vitest run) ama sonuç çıktıdan okunamadı — doğrulanmadı. Komut exit 1 ile bitti.',
    evidence: [{ kind: 'test-output', summary: 'koştu', ref: 'npx vitest run' }],
    signals: { nonZeroExit: 1 },
    createdAt: '2026-07-11T09:00:00.000Z',
  });
  const card = buildCard([eskiExit], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.ok(card.why.includes('exit 1'));
  assert.ok(card.why.includes('2026-07-11') && card.why.includes('17 gün'));
});

test('TAZE kırık kayıt tarih etiketi ALMAZ (gereksiz gürültü yok)', () => {
  const taze = testClaim('test-s1-0', { createdAt: '2026-07-26T09:00:00.000Z' }); // 2 gün
  const card = buildCard([taze], { now: NOW });
  assert.equal(card.rule, 'kirik-test');
  assert.equal(card.why.includes('2026-07-26'), false);
  assert.ok(card.why.includes('her şeyin önünde'));
});

test('BAYAT eşiği: HEURISTIC.bayatKirikGun sınırı kilitli (6 gün etiketsiz, 7 gün etiketli)', () => {
  assert.equal(HEURISTIC.bayatKirikGun, 7);
  const alti = testClaim('test-a', { createdAt: '2026-07-22T11:00:00.000Z' }); // 6 gün 1 saat
  const yedi = testClaim('test-b', { createdAt: '2026-07-21T11:00:00.000Z' }); // 7 gün 1 saat
  assert.equal(buildCard([alti], { now: NOW }).why.includes('gün önceki koşum'), false);
  assert.ok(buildCard([yedi], { now: NOW }).why.includes('7 gün önceki koşum'));
});

test('BAYAT: komut kaydı yoksa "yeşile dönmedi" İDDİA EDİLMEZ (kanıtsız cümle yok)', () => {
  const komutsuz = testClaim('test-s1-0', {
    createdAt: '2026-07-11T09:00:00.000Z',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2' }], // ref YOK → eşleştirilemez
  });
  const why = buildCard([komutsuz], { now: NOW }).why;
  assert.ok(why.includes('2026-07-11')); // tarih yine yazılır
  assert.equal(why.includes('yeşile döndüğü'), false); // ama kanıtsız iddia edilmez
});

// ── kartın gösterdiği gerçeğin TARİHİ ────────────────────────────────────────

test('factDate = gerçeğin kendi tarihi (kartın üretim tarihiyle karışmaz)', () => {
  const eski = testClaim('test-s1-0', { createdAt: '2026-07-11T09:00:00.000Z' });
  const card = buildCard([eski], { now: NOW });
  assert.equal(card.factDate, eski.createdAt);
  assert.equal(card.updatedAt, NOW.toISOString());
  assert.notEqual(card.factDate, card.updatedAt); // 17 günlük fark kartta görünür

  // Kanıtlı-ama-onaysız kartta da gerçeğin tarihi taşınır.
  const kanitli = claim('dosya-git-s1', {
    level: 'dosya-kaniti',
    createdAt: '2026-07-27T10:00:00.000Z',
    evidence: [{ kind: 'git-diff', summary: 'git: 1 dosya' }],
  });
  const onayKarti = buildCard([kanitli], { now: NOW });
  assert.equal(onayKarti.rule, 'insan-onayi-bekliyor');
  assert.equal(onayKarti.factDate, kanitli.createdAt);

  // Tam kartta (her şey insan onaylı) da.
  const onayli = buildCalisiyorClaim('Giriş akışı', {
    by: 'Ekin',
    at: '2026-07-28T11:00:00.000Z',
    decision: 'approved',
  });
  assert.equal(buildCard([onayli], { now: NOW }).factDate, onayli.createdAt);

  // Kaydı olmayan boş kartta UYDURULMAZ.
  assert.equal(buildCard([], { now: NOW }).factDate, undefined);
});

test('test sayısı ATIFLI: gerekçe hangi komutun sonucu olduğunu söyler', () => {
  const kirik = testClaim('test-s1-0');
  const why = buildCard([kirik], { now: NOW }).why;
  assert.ok(why.includes('npm test'), 'gerekçe komutu adıyla anmalı');
  assert.ok(why.includes('2 başarısız'));

  // Mutlak yol taşıyan komut atıf olarak VERİLMEZ (kapsam sızıntısı yok).
  const yolsuz = testClaim('test-s1-1', {
    evidence: [
      { kind: 'test-output', summary: 'ℹ fail 2', ref: 'node --test /Users/dev/Desktop/proje/src/a.test.ts' },
    ],
  });
  const why2 = buildCard([yolsuz], { now: NOW }).why;
  assert.equal(why2.includes('/Users/'), false);
  assert.ok(why2.includes('2 başarısız'));
});

test('kirik-test: insan onaylı kırık test kartı ele geçirmez (karar verilmiş iş)', () => {
  const onayli = testClaim('test-s1-0', {
    level: 'insan-onayi',
    evidence: [
      { kind: 'test-output', summary: 'ℹ fail 2', ref: 'npm test' },
      { kind: 'human', summary: 'Ekin doğruladı.' },
    ],
  });
  const acik = claim('dosya-transcript-s2', { sessionId: 's2' });
  const card = buildCard([onayli, acik], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-s2');
});

// ── 2) kritik-dosya ──────────────────────────────────────────────────────────

test('kural kritik-dosya: kimlik dosyası, daha yeni sıradan işin önüne geçer', () => {
  const kimlik = dosyaClaim('dosya-transcript-s1', ['src/auth/login.ts', 'src/ui/x.ts'], {
    createdAt: '2026-07-28T09:00:00.000Z',
  });
  const yeni = dosyaClaim('dosya-transcript-s2', ['src/ui/button.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's2',
  });

  const card = buildCard([yeni, kimlik], { now: NOW });

  assert.equal(card.rule, 'kritik-dosya');
  assert.equal(card.id, 'dosya-transcript-s1');
  assert.ok(card.why.includes('kimlik/oturum'));
  assert.ok(card.why.includes('src/auth/login.ts')); // gerekçe kayıttaki dosyayı ADIYLA söyler
  assert.equal(card.factLevel, 'dogrulanmadi');
});

test('kritik-dosya önem sırası: ödeme, kimliğin önünde', () => {
  const odeme = dosyaClaim('dosya-transcript-s2', ['src/checkout/stripeClient.ts'], {
    createdAt: '2026-07-28T09:00:00.000Z',
    sessionId: 's2',
  });
  const kimlik = dosyaClaim('dosya-transcript-s1', ['src/auth/session.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
  });
  const card = buildCard([kimlik, odeme], { now: NOW });
  assert.equal(card.id, 'dosya-transcript-s2');
  assert.ok(card.why.includes('ödeme'));
});

test('kritik-dosya: şema ve yapılandırma da yakalanır (migration, .env)', () => {
  const sema = buildCard([dosyaClaim('c1', ['db/migrations/003_add_users.sql'])], { now: NOW });
  assert.equal(sema.rule, 'kritik-dosya');
  assert.ok(sema.why.includes('veri şeması'));

  const conf = buildCard([dosyaClaim('c2', ['.env.local'])], { now: NOW });
  assert.equal(conf.rule, 'kritik-dosya');
  assert.ok(conf.why.includes('yapılandırma'));
});

test('kritik-dosya YANLIŞ POZİTİF üretmez: author.ts / tokens.css kritik değil', () => {
  const sahte = dosyaClaim('dosya-transcript-s1', ['src/author.ts', 'styles/tokens.css', 'src/composer.ts'], {
    createdAt: '2026-07-28T09:00:00.000Z',
  });
  const yeni = dosyaClaim('dosya-transcript-s2', ['src/ui/x.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's2',
  });
  const card = buildCard([sahte, yeni], { now: NOW });
  assert.equal(card.rule, 'en-yeni'); // kritik-dosya TETİKLENMEZ
  assert.equal(card.id, 'dosya-transcript-s2');
});

test('kritik-dosya: sinyalsiz (eski) claim sessizce düşer — metin ayrıştırılmaz', () => {
  // Metinde "auth" geçiyor ama ölçülmüş yol sinyali yok → kural susar.
  const metinde = claim('dosya-transcript-s1', {
    text: "1 dosya için düzenleme kaydı var: src/auth/login.ts — doğrulanmadı",
    createdAt: '2026-07-28T09:00:00.000Z',
  });
  const yeni = claim('dosya-transcript-s2', { createdAt: '2026-07-28T11:00:00.000Z', sessionId: 's2' });
  const card = buildCard([metinde, yeni], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
});

// ── 3) kayip-riski ───────────────────────────────────────────────────────────

test('kural kayip-riski: git izi olmayan büyük küme + hareket = commit kontrolü', () => {
  const buyuk = dosyaClaim(
    'dosya-transcript-s1',
    ['src/ui/a.ts', 'src/ui/b.ts', 'src/ui/c.ts', 'src/ui/d.ts', 'src/ui/e.ts'],
    { createdAt: '2026-07-28T09:00:00.000Z' },
  );
  const kucuk = dosyaClaim('dosya-transcript-s2', ['src/ui/z.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's2',
  });

  const card = buildCard([kucuk, buyuk], { now: NOW, scripts: { test: 'node --test' } });

  assert.equal(card.rule, 'kayip-riski');
  assert.equal(card.id, 'dosya-transcript-s1');
  assert.ok(card.why.includes('5 dosya'));
  // git status bu kümeyi zaten göstermez (tanımı bu) → asıl soru commit'lendi mi.
  assert.equal(card.action.command, 'git log --oneline -5');
});

test('kayip-riski: git izi VARSA tetiklenmez (eşik tek başına yetmez)', () => {
  const izli = dosyaClaim('dosya-transcript-s1', ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'], {
    signals: { fileCount: 6, paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'], noGitTrace: false },
  });
  const card = buildCard([izli], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
});

test('kayip-riski eşiği: 3 dosya küme sayılmaz, 4 dosya sayılır', () => {
  const uc = dosyaClaim('c3', ['a.ts', 'b.ts', 'c.ts']);
  const dort = dosyaClaim('c4', ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  assert.equal(buildCard([uc], { now: NOW }).rule, 'en-yeni');
  assert.equal(buildCard([dort], { now: NOW }).rule, 'kayip-riski');
});

// ── 4) bayat ─────────────────────────────────────────────────────────────────

test('kural bayat: doğrulanmamış işlerin HEPSİ eskiyse en uzun bekleyen seçilir', () => {
  const enEski = claim('dosya-transcript-s1', { createdAt: '2026-07-20T10:00:00.000Z' });
  const eski = claim('dosya-transcript-s2', { createdAt: '2026-07-24T10:00:00.000Z', sessionId: 's2' });

  const card = buildCard([eski, enEski], { now: NOW });

  assert.equal(card.rule, 'bayat');
  assert.equal(card.id, 'dosya-transcript-s1'); // en yeni DEĞİL, en uzun bekleyen
  assert.ok(card.why.includes('8 gün'));
  assert.ok(card.why.includes('4 gün'));
});

test('bayat: tek taze iş varsa kural kapanır (aktif çalışma bölünmez)', () => {
  const eski = claim('dosya-transcript-s1', { createdAt: '2026-07-20T10:00:00.000Z' });
  const taze = claim('dosya-transcript-s2', { createdAt: '2026-07-28T11:00:00.000Z', sessionId: 's2' });
  const card = buildCard([eski, taze], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-s2');
});

test('bayat: okunamayan zaman damgası bayat SAYILMAZ (uydurma yaş yok)', () => {
  const bozuk = claim('dosya-transcript-s1', { createdAt: 'bilinmiyor' });
  const card = buildCard([bozuk], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
});

// ── 5) kume ──────────────────────────────────────────────────────────────────

test('kural kume: aynı oturumun en kapsamlı kaydı, daha yeni tek-dosyalık dokunuşu geçer', () => {
  const buyukKayit = dosyaClaim('dosya-transcript-s1', ['src/ui/a.ts', 'src/ui/b.ts', 'src/ui/c.ts'], {
    createdAt: '2026-07-28T10:00:00.000Z',
  });
  const ufakKayit = dosyaClaim('dosya-belirsiz-s1', ['src/ui/d.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
  });

  const card = buildCard([buyukKayit, ufakKayit], { now: NOW });

  assert.equal(card.rule, 'kume');
  assert.equal(card.id, 'dosya-transcript-s1');
  assert.ok(card.why.includes('2 doğrulanmamış kayıt'));
  assert.ok(card.why.includes('3 dosya'));
});

test('kume: dosya sayısı ölçülmemişse kural susar (en kapsamlısı denemez)', () => {
  const a = claim('dosya-transcript-a', { createdAt: '2026-07-28T10:00:00.000Z' });
  const b = claim('dosya-transcript-b', { createdAt: '2026-07-28T11:00:00.000Z' }); // aynı oturum
  const card = buildCard([a, b], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-b');
});

test('kume: farklı oturumlardaki kayıtlar küme değildir', () => {
  const a = dosyaClaim('dosya-transcript-s1', ['a.ts', 'b.ts'], { createdAt: '2026-07-28T10:00:00.000Z' });
  const b = dosyaClaim('dosya-transcript-s2', ['c.ts'], {
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's2',
  });
  const card = buildCard([a, b], { now: NOW });
  assert.equal(card.rule, 'en-yeni');
  assert.equal(card.id, 'dosya-transcript-s2');
});

// ── öncelik merdiveni (RULE_ORDER kilidi) ────────────────────────────────────

test('RULE_ORDER merdiveni: kirik-test > kritik-dosya > kayip-riski > kume > en-yeni', () => {
  const kirik = testClaim('test-s1-0', { createdAt: '2026-07-28T08:00:00.000Z' });
  const kritik = dosyaClaim('dosya-transcript-s2', ['src/payments/checkout.ts'], {
    createdAt: '2026-07-28T08:30:00.000Z',
    sessionId: 's2',
  });
  const buyuk = dosyaClaim(
    'dosya-transcript-s3',
    ['src/ui/a.ts', 'src/ui/b.ts', 'src/ui/c.ts', 'src/ui/d.ts', 'src/ui/e.ts'],
    { createdAt: '2026-07-28T09:00:00.000Z', sessionId: 's3' },
  );
  const kume1 = dosyaClaim('dosya-transcript-s4', ['src/ui/f.ts', 'src/ui/g.ts'], {
    createdAt: '2026-07-28T09:30:00.000Z',
    sessionId: 's4',
  });
  const kume2 = dosyaClaim('dosya-belirsiz-s4', ['src/ui/h.ts'], {
    createdAt: '2026-07-28T10:00:00.000Z',
    sessionId: 's4',
  });
  const sade = claim('dosya-transcript-s5', {
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's5',
  });

  const hepsi = [kirik, kritik, buyuk, kume1, kume2, sade];
  assert.equal(buildCard(hepsi, { now: NOW }).rule, 'kirik-test');
  assert.equal(buildCard(hepsi.slice(1), { now: NOW }).rule, 'kritik-dosya');
  assert.equal(buildCard(hepsi.slice(2), { now: NOW }).rule, 'kayip-riski');
  assert.equal(buildCard(hepsi.slice(3), { now: NOW }).rule, 'kume');
  assert.equal(buildCard([sade], { now: NOW }).rule, 'en-yeni');

  // Merdiven ile ilan edilen sıra aynı olmalı (belge ile kod ayrışmasın).
  assert.deepEqual([...RULE_ORDER], [
    'kirik-test',
    'kritik-dosya',
    'kayip-riski',
    'bayat',
    'kume',
    'en-yeni',
  ]);
});

// ── kanıtlı-onay-bekleyen dalı ───────────────────────────────────────────────

test('onay bekleyenler arasında da risk sırası: kritik dosya öne geçer', () => {
  const sade = claim('dosya-git-s2', {
    level: 'dosya-kaniti',
    text: '1 dosya değişti: src/ui/x.ts',
    signals: { fileCount: 1, paths: ['src/ui/x.ts'], noGitTrace: false },
    createdAt: '2026-07-28T11:00:00.000Z',
    sessionId: 's2',
    evidence: [
      { kind: 'transcript-tool-use', summary: 't' },
      { kind: 'git-diff', summary: 'g' },
    ],
  });
  const kritik = claim('dosya-git-s1', {
    level: 'dosya-kaniti',
    text: '1 dosya değişti: src/billing/invoice.ts',
    signals: { fileCount: 1, paths: ['src/billing/invoice.ts'], noGitTrace: false },
    createdAt: '2026-07-28T09:00:00.000Z',
    evidence: [
      { kind: 'transcript-tool-use', summary: 't' },
      { kind: 'git-diff', summary: 'g' },
    ],
  });

  const card = buildCard([sade, kritik], { now: NOW });

  assert.equal(card.rule, 'insan-onayi-bekliyor');
  assert.equal(card.id, 'dosya-git-s1');
  assert.equal(card.factLevel, 'dosya-kaniti'); // AYNEN
  assert.ok(card.why.includes('ödeme'));
  assert.equal(card.action.command, verifyCommand('dosya-git-s1'));
});

// ── dürüstlük invaryantları: TÜM kurallar için ───────────────────────────────

/** Her kuralı tetikleyen bir senaryo — invaryant testleri hepsini gezer. */
const SENARYOLAR: ReadonlyArray<{ ad: string; claims: Claim[] }> = [
  { ad: 'kirik-test', claims: [testClaim('test-s1-0')] },
  { ad: 'kritik-dosya', claims: [dosyaClaim('dosya-transcript-s1', ['src/auth/login.ts'])] },
  {
    ad: 'kayip-riski',
    claims: [dosyaClaim('dosya-transcript-s1', ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])],
  },
  { ad: 'bayat', claims: [claim('dosya-transcript-s1', { createdAt: '2026-07-10T10:00:00.000Z' })] },
  {
    ad: 'kume',
    claims: [
      dosyaClaim('dosya-transcript-s1', ['x.ts', 'y.ts']),
      dosyaClaim('dosya-belirsiz-s1', ['z.ts'], { createdAt: '2026-07-28T11:00:00.000Z' }),
    ],
  },
  { ad: 'en-yeni', claims: [claim('dosya-transcript-s1')] },
  {
    ad: 'insan-onayi-bekliyor',
    claims: [
      claim('dosya-git-s1', {
        level: 'dosya-kaniti',
        text: '2 dosya değişti: a.ts, b.ts',
        evidence: [
          { kind: 'transcript-tool-use', summary: 't' },
          { kind: 'git-diff', summary: 'g' },
        ],
      }),
    ],
  },
];

test('İNVARYANT: hiçbir kural gerçeği ya da kanıt seviyesini değiştirmez', () => {
  for (const senaryo of SENARYOLAR) {
    const card = buildCard(senaryo.claims, { now: NOW, scripts: { test: 'node --test' } });
    const secilen = senaryo.claims.find((c) => c.id === card.id);
    assert.ok(secilen !== undefined, `${senaryo.ad}: kart var olmayan claim'i işaret etti`);
    assert.equal(card.fact, secilen.text, `${senaryo.ad}: metin AYNEN taşınmalı`);
    assert.equal(card.factLevel, secilen.level, `${senaryo.ad}: seviye AYNEN taşınmalı`);
    // Kanıt satırları uydurulmaz: yalnız claim'de o türde kanıt varsa dolar.
    const has = (k: string): boolean => secilen.evidence.some((e) => e.kind === k);
    assert.equal(card.evidence.gitDiff === null, !has('git-diff'), `${senaryo.ad}: git satırı`);
    assert.equal(card.evidence.testOutput === null, !has('test-output'), `${senaryo.ad}: test satırı`);
    assert.equal(card.evidence.humanApproval === null, !has('human'), `${senaryo.ad}: insan satırı`);
  }
});

test('İNVARYANT: her kuralın gerekçesi AYRI ve sakin (alarm/yüzde/motivasyon yok)', () => {
  const gerekceler = new Set<string>();
  for (const senaryo of SENARYOLAR) {
    const card: Card = buildCard(senaryo.claims, { now: NOW });
    assert.equal(card.rule, senaryo.ad, `${senaryo.ad}: beklenen kural tetiklenmedi`);
    assert.ok(!gerekceler.has(card.why), `${senaryo.ad}: gerekçe cümlesi başka kuralla aynı`);
    gerekceler.add(card.why);

    const metin = `${card.why} ${card.unknown} ${card.action.verb} ${card.doneWhen}`;
    assert.ok(!/[!%]/.test(metin), `${senaryo.ad}: alarm/yüzde dili`);
    assert.ok(!/ACİL|hemen|harika|tebrikler|başardın/i.test(metin), `${senaryo.ad}: motivasyon dili`);
    assert.ok(!card.why.includes('\n') && !card.unknown.includes('\n'), `${senaryo.ad}: tek cümle`);
  }
  assert.equal(gerekceler.size, SENARYOLAR.length);
});

test('İNVARYANT: girdi sırası kartı değiştirmez (tam determinizm)', () => {
  const hepsi = SENARYOLAR.flatMap((s) => s.claims);
  const ters = [...hepsi].reverse();
  assert.deepEqual(buildCard(hepsi, { now: NOW }), buildCard(ters, { now: NOW }));
  for (const senaryo of SENARYOLAR) {
    assert.deepEqual(
      buildCard(senaryo.claims, { now: NOW }),
      buildCard([...senaryo.claims].reverse(), { now: NOW }),
    );
  }
});

// ── kritik-dosya sınıflandırıcısı (birim) ────────────────────────────────────

test('pathTokens: yol + camelCase sınırlarından token çıkarır', () => {
  assert.deepEqual(pathTokens('src/authService.ts'), ['src', 'auth', 'service', 'ts']);
  assert.deepEqual(pathTokens('.env.local'), ['env', 'local']);
  assert.deepEqual(pathTokens('db/migrations/003_add_users.sql'), [
    'db', 'migrations', '003', 'add', 'users', 'sql',
  ]);
});

test('kritikTur: token TAMLIĞI — alt-dizge yanlış pozitifi yok', () => {
  assert.equal(kritikTur('src/auth/login.ts'), 'kimlik');
  assert.equal(kritikTur('src/payments/stripe.ts'), 'odeme');
  assert.equal(kritikTur('prisma/schema.prisma'), 'sema');
  assert.equal(kritikTur('config/settings.json'), 'yapilandirma');
  // Yanlış pozitif tuzakları:
  assert.equal(kritikTur('src/author.ts'), null);
  assert.equal(kritikTur('styles/tokens.css'), null);
  assert.equal(kritikTur('src/authors/list.tsx'), null);
  assert.equal(kritikTur('src/ui/button.ts'), null);
});

test('claimKritik: en ağır tür kazanır, eşleşen dosyalar kayıttan gelir', () => {
  const c = dosyaClaim('c1', ['src/auth/login.ts', 'src/billing/invoice.ts', 'src/ui/x.ts']);
  const bulgu = claimKritik(c);
  assert.ok(bulgu);
  assert.equal(bulgu.tur, 'odeme'); // ödeme > kimlik
  assert.deepEqual(bulgu.paths, ['src/billing/invoice.ts']);
  assert.equal(claimKritik(claim('c2')), null); // sinyalsiz → null
});

// ── yardımcılar ──────────────────────────────────────────────────────────────

test('verifyCommand + scriptsFromPackageJson', () => {
  assert.equal(verifyCommand('gorev-3'), 'topbeam verify gorev-3');
  assert.deepEqual(scriptsFromPackageJson('{"scripts":{"test":"node --test","x":3}}'), { test: 'node --test' });
  assert.deepEqual(scriptsFromPackageJson('bozuk json'), {});
  assert.deepEqual(scriptsFromPackageJson('{"scripts":[]}'), {});
  assert.deepEqual(scriptsFromPackageJson('null'), {});
});
