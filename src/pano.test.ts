/**
 * pano.ts testleri — saf render, fs yok.
 * Dürüstlük invaryantları: yüzde-progress yok, kanıt satırı uydurulmaz,
 * escape zorunlu, "Doğrulamayı başlat" kutusu yalnız gerçek claim kartında,
 * VE insan rozeti yalnız passport.jsonl defterine dayanır (fail-closed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOceanState, type Claim, type OceanState, type ScopeNotes } from './types.ts';
import { buildCard } from './card.ts';
import { buildLedger, type VerificationLedger } from './ledger.ts';
import { renderPano, esc } from './pano.ts';

const NOW = new Date('2026-07-28T12:00:00Z');
const ONAY_TS = '2026-07-28T11:30:00Z';

/**
 * GERÇEK passport.jsonl satır şekliyle defter kur — rozetin TEK kaynağı.
 * `over` ile tek alan bozularak "şart sağlanmazsa rozet yok" kilitlenir.
 */
function ledgerFixture(
  claimIds: readonly string[],
  over: Record<string, unknown> = {},
): VerificationLedger {
  return buildLedger(
    claimIds.map((claimId) => ({
      schema_version: 1,
      at: ONAY_TS,
      claimId,
      title: 'onaylanan iş',
      decision: 'approved',
      by: 'ekin',
      source: 'terminal',
      levelBefore: 'test-kaniti',
      levelAfter: 'insan-onayi',
      ...over,
    })),
  );
}

function claimFixture(over: Partial<Claim> = {}): Claim {
  return {
    id: 'dosya-git-abc',
    text: '2 dosya değişti: src/a.ts, src/b.ts',
    level: 'dosya-kaniti',
    kind: 'dosya',
    evidence: [
      { kind: 'transcript-tool-use', summary: 'Transcript: 2 dosyada Edit sonucu hatasız.' },
      { kind: 'git-diff', summary: 'git: 2 dosyanın çalışma ağacında kaydı var.' },
    ],
    createdAt: '2026-07-28T10:00:00Z',
    ...over,
  };
}

function stateFixture(): OceanState {
  const st = newOceanState('Deneme Proje', NOW);
  const c1 = claimFixture();
  const c2 = claimFixture({
    id: 'test-abc-0',
    text: '19 test geçti, 0 başarısız (npm test).',
    level: 'test-kaniti',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: '# pass 19' }],
    createdAt: '2026-07-28T11:00:00Z',
  });
  st.claims = [c1, c2];
  st.log = [
    { ts: '2026-07-28T09:00:00Z', text: 'Commit: iskelet (abc123)', source: 'git' },
    { ts: '2026-07-28T09:30:00Z', text: 'Beyan: Testleri çalıştır', source: 'claude-beyan' },
  ];
  st.passport = [
    { id: c1.id, title: c1.text, status: 'not_verified', claimIds: [c1.id], level: 'dosya-kaniti' },
    {
      id: c2.id,
      title: c2.text,
      status: 'completed',
      claimIds: [c2.id],
      level: 'insan-onayi',
      verification: { by: 'ekin', at: ONAY_TS, decision: 'approved', source: 'terminal' },
    },
  ];
  st.card = buildCard(st.claims, { now: NOW });
  st.lastSyncedAt = NOW.toISOString();
  return st;
}

/** stateFixture'daki onayın GERÇEK dayanağı — defterdeki karşılığı. */
function stateLedger(): VerificationLedger {
  return ledgerFixture(['test-abc-0']);
}

test('kart EN ÜSTTE ve 6 alan + Doğrulamayı başlat kutusu + verify komutu', () => {
  const st = stateFixture();
  const html = renderPano(st);
  // kart, log'dan ÖNCE gelmeli (en baskın öğe)
  const cardPos = html.indexOf('Sıradaki tek hareket');
  const logPos = html.indexOf('Log history');
  assert.ok(cardPos > -1 && logPos > -1 && cardPos < logPos);
  // GPT spec alan başlıkları
  for (const s of ['Git diff', 'Test çıktısı', 'İnsan onayı', 'Eksik / belirsiz', 'Hareket', 'Neden bu?', 'Bitti sayılması için']) {
    assert.ok(html.includes(s), `pano '${s}' içermeli`);
  }
  // ana buton kutusu + kopyalanabilir komut
  assert.ok(html.includes('Doğrulamayı başlat'));
  assert.ok(html.includes(`topbeam verify ${st.card?.id ?? ''}`));
});

test('kanıt satırı uydurulmaz: olmayan tür "kayıt yok" görünür', () => {
  const st = stateFixture();
  // kart = dosya-kaniti claim (insan onayı yok, test çıktısı yok olabilir)
  const html = renderPano(st);
  assert.ok(html.includes('kayıt yok'));
});

test('yüzde-progress-bar YOK; dürüst sayım VAR', () => {
  const html = renderPano(stateFixture(), { ledger: stateLedger() });
  assert.equal(html.includes('<progress'), false);
  assert.equal(/progress-bar|progressbar/i.test(html), false);
  assert.ok(html.includes('1/2 doğrulandı'));
});

test('log: kanıt ÜSTTE ve açık, beyan ALTTA ve katlı (beyan kanıt değildir)', () => {
  const html = renderPano(stateFixture());
  assert.ok(html.includes('>beyan<'));
  assert.ok(html.includes('>git<'));

  // Kanıt satırı, beyan bloğundan ÖNCE gelir — beyan altta.
  const gitPos = html.indexOf('Commit: iskelet');
  const beyanBlokPos = html.indexOf('<details class="beyanlar">');
  const beyanPos = html.indexOf('Beyan: Testleri çalıştır');
  assert.ok(gitPos > -1 && beyanBlokPos > -1 && beyanPos > -1);
  assert.ok(gitPos < beyanBlokPos, 'kanıt satırları beyan bloğunun üstünde olmalı');
  assert.ok(beyanBlokPos < beyanPos, 'beyan satırı katlı bloğun içinde olmalı');

  // Kat VARSAYILAN OLARAK KAPALI: <details> open değil.
  assert.equal(/<details class="beyanlar"[^>]*\sopen/.test(html), false);
  // Ama kayıt silinmiş gibi de yapılmaz: sayısı açıkça yazar.
  assert.ok(html.includes("Claude'un beyanları (1)"));
  assert.ok(html.includes('1 kanıt · 1 beyan'));
});

test('log: satır sayıları dürüst — beyan gizlense de sayılır', () => {
  const st = stateFixture();
  for (let i = 0; i < 5; i++) {
    st.log.push({ ts: `2026-07-28T10:0${i}:00Z`, text: `Beyan: iş ${i}`, source: 'claude-beyan' });
  }
  const html = renderPano(st);
  assert.ok(html.includes('1 kanıt · 6 beyan'));
});

test('full-tik değilse kutlama bandı YOK; full-tik ise VAR', () => {
  const st = stateFixture();
  assert.equal(
    renderPano(st, { ledger: stateLedger() }).includes('Ürün geliştirildi'),
    false,
  );

  for (const p of st.passport) {
    p.status = 'completed';
    p.level = 'insan-onayi';
  }
  // Kutlama da DEFTERE dayanır: iki maddenin de gerçek onay kaydı olmalı.
  const defter = ledgerFixture(['dosya-git-abc', 'test-abc-0']);
  assert.ok(renderPano(st, { ledger: defter }).includes('Ürün geliştirildi 🎉'));
  // Defter olmadan aynı state kutlama BASTIRAMAZ (fail-closed).
  assert.equal(renderPano(st).includes('Ürün geliştirildi'), false);
});

test('pasaport: doğrulanmamış birimde verify komutu + kayıt sayısı görünür', () => {
  const st = stateFixture();
  st.passport[0] = {
    id: 'birim-s1',
    title: 'oturum işi',
    status: 'not_verified',
    claimIds: ['a', 'b', 'c'],
    level: 'dogrulanmadi',
    reason: '1/3 kayıt insan onaylı — birim henüz tamam değil.',
  };
  const html = renderPano(st, { ledger: stateLedger() });
  assert.ok(html.includes('topbeam verify birim-s1'));
  assert.ok(html.includes('3 kayıt'));
  assert.ok(html.includes('1/3 kayıt insan onaylı'));
  // onaylanmış maddede tekrar "verify" çağrısı GÖSTERİLMEZ (yapılacak iş yok):
  // pasaportta iki madde var, yalnız biri komut taşır.
  assert.equal(html.match(/class="cmdrow pcmd"/g)?.length, 1);
});

test('pasaport: her açık madde KOPYALANABİLİR — çıplak id elle seçilmez', () => {
  const st = stateFixture();
  st.passport = ['birim-04e1b826', 'birim-9c31aa07', 'birim-77d0be14'].map((id) => ({
    id,
    title: `2026-07-28 · 3 dosya · 1 test koşumu (${id})`,
    status: 'not_verified' as const,
    claimIds: [`${id}-a`, `${id}-b`],
    level: 'dogrulanmadi' as const,
  }));
  const html = renderPano(st);

  // Kartla AYNI desen: her satırda kopyalanabilir komut + Kopyala butonu.
  assert.equal(html.match(/class="cmdrow pcmd"/g)?.length, 3);
  for (const id of ['birim-04e1b826', 'birim-9c31aa07', 'birim-77d0be14']) {
    assert.ok(html.includes(`data-cmd="topbeam verify ${id}"`), `${id}: kopyalanabilir komut yok`);
  }
  // Erişilebilirlik: her satırın butonu var ve adı AYIRT EDİCİ
  // (11 satırda 11 aynı "Kopyala" ekran okuyucuda kullanılamaz).
  const etiketler = html.match(/aria-label="Doğrulama komutunu kopyala — [^"]+"/g) ?? [];
  assert.equal(etiketler.length, 3);
  assert.equal(new Set(etiketler).size, 3, 'aria-label satır satır ayırt edici olmalı');
  assert.equal((html.match(/onclick="oceanKopyala\(this\)"/g) ?? []).length >= 3, true);
});

test('pasaport: onaylı maddede komut yok (yapılacak iş yok) + reduced-motion saygılı', () => {
  const st = stateFixture();
  for (const p of st.passport) {
    p.status = 'completed';
    p.level = 'insan-onayi';
  }
  // "Onaylı" sayılmak DEFTERE bağlı: iki maddenin de gerçek kaydı olmalı,
  // yoksa iş bitmemiştir ve komut satırı görünmeye DEVAM eder (fail-closed).
  const html = renderPano(st, { ledger: ledgerFixture(['dosya-git-abc', 'test-abc-0']) });
  assert.equal(html.includes('class="cmdrow pcmd"'), false);
  assert.ok(html.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(html.includes(':focus-visible'), 'klavye odağı görünür olmalı');
});

test('escape: kötü niyetli claim metni HTML/JS enjekte edemez', () => {
  const st = stateFixture();
  const kotu = '<script>alert(1)</script> "tırnak" & <img>';
  st.claims[0] = claimFixture({ text: kotu, createdAt: '2026-07-28T11:59:00Z' });
  st.passport[0] = { id: 'x', title: kotu, status: 'not_verified', claimIds: ['x'], level: 'dogrulanmadi' };
  st.log.push({ ts: '2026-07-28T11:59:30Z', text: kotu, source: 'insan' });
  st.card = buildCard(st.claims, { now: NOW });
  const html = renderPano(st);
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('kart-bos: Doğrulamayı başlat kutusu yok, topbeam sync önerilir', () => {
  const st = newOceanState('Bos Proje', NOW);
  st.card = buildCard([], { now: NOW });
  const html = renderPano(st);
  assert.equal(html.includes('Doğrulamayı başlat'), false);
  assert.ok(html.includes('topbeam sync'));
  assert.ok(html.includes('0/0 doğrulandı'));
});

test('hedef satırı yalnız verilirse görünür; kart yoksa dürüst boş kart', () => {
  const st = newOceanState('Proje', NOW);
  const yok = renderPano(st);
  assert.ok(yok.includes('Henüz kart üretilmedi'));
  assert.ok(yok.includes('henüz senkron koşmadı'));
  assert.equal(yok.includes('Hedef'), false);

  const var_ = renderPano(st, { goalText: 'MVP dikey dilimi bitir.' });
  assert.ok(var_.includes('MVP dikey dilimi bitir.'));
});

test('deterministik: aynı state → aynı HTML', () => {
  const a = renderPano(stateFixture());
  const b = renderPano(stateFixture());
  assert.equal(a, b);
});

test('sakin dil: motivasyon/alarm sözleri yok', () => {
  const html = renderPano(stateFixture());
  for (const yasak of ['Harika', 'Tebrikler', 'ALARM', 'ACİL', 'başarıyla']) {
    assert.equal(html.includes(yasak), false, `pano '${yasak}' içermemeli`);
  }
});

test('esc: beş temel karakteri çevirir', () => {
  assert.equal(esc(`<a href="x" & 'y'>`), '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;');
});

// ── kapsam bloğu + dürüst sayılar ────────────────────────────────────────────

function scopeFixture(over: Partial<ScopeNotes> = {}): ScopeNotes {
  return {
    disKapsamDuzenleme: 1139,
    atlananOturum: 0,
    kontrolKomutu: 37,
    kisaltilanYol: 4,
    gitYok: false,
    log: {
      hamToplam: 2507,
      hamKanit: 70,
      hamBeyan: 2437,
      ilgisizBeyan: 1900,
      tekillestirilen: 53,
      kirpilan: 100,
      tutulan: 454,
    },
    notlar: ['Log 500 satırla sınırlandı (bu adıma 554 satır girmişti).'],
    ...over,
  };
}

test('capNote "toplam N" DEMEZ: tutulan ve ham ayrı ayrı, doğru adla yazılır', () => {
  const st = stateFixture();
  st.scope = scopeFixture();
  for (let i = 0; i < 130; i++) {
    st.log.push({ ts: `2026-07-28T10:00:${String(i % 60).padStart(2, '0')}Z`, text: `Beyan: iş ${i}`, source: 'claude-beyan' });
  }
  const html = renderPano(st);
  // eski yalan biçim ortadan kalktı
  assert.equal(/\(toplam \d+\)/.test(html), false, '"(toplam N)" ifadesi kalmamalı');
  assert.ok(html.includes('panoda tutulan 131 satırdan'));
  assert.ok(html.includes('Ham kayıtta 2437 beyan satırı vardı'));
});

test('kapsam bloğu KARTIN HEMEN ALTINDA ve log\'dan ÖNCE', () => {
  const st = stateFixture();
  st.scope = scopeFixture();
  const html = renderPano(st);
  const kart = html.indexOf('Sıradaki tek hareket');
  const kapsam = html.indexOf('Bu panonun kapsamı');
  const log = html.indexOf('Log history');
  assert.ok(kart > -1 && kapsam > -1 && log > -1);
  assert.ok(kart < kapsam, 'kapsam bloğu kartın altında olmalı');
  assert.ok(kapsam < log, 'kapsam bloğu log\'dan önce olmalı');
});

test('kapsam bloğu GERÇEK sayıları ve zinciri gösterir (gizleme yok)', () => {
  const st = stateFixture();
  st.scope = scopeFixture();
  const html = renderPano(st);
  assert.ok(html.includes('1139 düzenleme'), 'elenen proje dışı düzenleme sayısı');
  assert.ok(html.includes('1900 beyan satırı'), 'ilişkilendirilemeyen beyan sayısı');
  assert.ok(html.includes('37 kontrol komutu'), 'claim üretmeyen kontrol komutu sayısı');
  assert.ok(html.includes('4 yerde'), 'kısaltılan yol sayısı');
  assert.ok(
    html.includes('Ham 2507 satır (70 kanıt · 2437 beyan) → 1900 ilişkisiz beyan elendi → 53 tekrar tekilleşti → 100 satır sınırda kırpıldı → panoda 454 satır.'),
  );
  assert.ok(html.includes('Motor notları (1)'));
});

test('kapsam bloğu: git yoksa bunu açıkça söyler', () => {
  const st = stateFixture();
  st.scope = scopeFixture({ gitYok: true });
  assert.ok(renderPano(st).includes('git deposu değil'));
});

test('kapsam kaydı YOKSA sayı UYDURULMAZ', () => {
  const html = renderPano(stateFixture()); // scope undefined
  assert.ok(html.includes('Kapsam kaydı yok'));
  assert.equal(html.includes('Ham '), false, 'ölçülmemiş ham sayı iddia edilmemeli');
});

test('eleme yoksa dürüst "elenen kayıt yok" cümlesi', () => {
  const st = stateFixture();
  st.scope = scopeFixture({
    disKapsamDuzenleme: 0,
    kontrolKomutu: 0,
    kisaltilanYol: 0,
    gitYok: false,
    log: { hamToplam: 3, hamKanit: 2, hamBeyan: 1, ilgisizBeyan: 0, tekillestirilen: 0, kirpilan: 0, tutulan: 3 },
    notlar: [],
  });
  const html = renderPano(st);
  assert.ok(html.includes('elenen kayıt yok'));
});

test('kart gerçeğinin KENDİ tarihi panoda görünür (tazelik damgası yanıltmaz)', () => {
  const st = stateFixture();
  const eskiKirik = claimFixture({
    id: 'test-eski-0',
    text: 'Test koşumunda 2 test başarısız, 17 test geçti (npm test).',
    level: 'test-kaniti',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: 'ℹ fail 2', ref: 'npm test' }],
    signals: { failedTests: 2, passedTests: 17 },
    createdAt: '2026-07-11T09:00:00Z',
  });
  st.claims = [eskiKirik];
  st.card = buildCard(st.claims, { now: NOW });

  const html = renderPano(st);
  assert.ok(html.includes('Bu gerçek'), 'gerçeğin tarihi kartta ayrı satırda durmalı');
  assert.ok(html.includes('2026-07-11 09:00'), 'gösterilen tarih kaydın kendi tarihi olmalı');
  assert.ok(html.includes('Kart güncellendi'), 'kartın üretim damgası ayrı kalır');
});

// ── İNSAN ROZETİ = DEFTER (ürünün en ağır dürüstlük invaryantı) ─────────────
//
// Sızıntının şekli: bir LOG SATIRI `source:'insan'` yazdığı için, bir CLAIM
// `level:'insan-onayi'` yazdığı için panoda "insan" rozeti alıyordu. Aşağıdaki
// üç invaryant bunu yapısal olarak imkânsız kılar. Rozetin kaynağı tek yerdir:
// .ocean/passport.jsonl'deki terminal imzalı doğrulama kaydı.

/** Kendini insan onaylı SAYAN state — dayanağı ayrı verilir (ya da hiç verilmez). */
function iddiaEdenState(): OceanState {
  const st = newOceanState('İddia Proje', NOW);
  const c = claimFixture({
    id: 'test-abc-0',
    level: 'insan-onayi',
    kind: 'test',
    // Uydurulmuş "insan kanıtı" cümlesi — bir ajan bunu yazabilir.
    evidence: [{ kind: 'human', summary: 'dogfood-ajan 2026-07-28 tarihinde doğruladı.' }],
    createdAt: '2026-07-28T11:00:00Z',
  });
  st.claims = [c];
  st.log = [
    { ts: ONAY_TS, text: 'Doğrulandı: 19 test geçti (dogfood-ajan)', source: 'insan' },
    { ts: '2026-07-28T09:00:00Z', text: 'Commit: iskelet (abc123)', source: 'git' },
  ];
  st.passport = [
    { id: 'birim-s1', title: 'oturum işi', status: 'completed', claimIds: [c.id], level: 'insan-onayi' },
  ];
  // Kart doğrudan kurulur: kural motoruna (card.ts) bağlanmadan render kilitlensin.
  st.card = {
    id: c.id,
    fact: '19 test geçti (npm test).',
    factLevel: 'insan-onayi',
    evidence: { gitDiff: null, testOutput: '19/19 test geçti', humanApproval: 'dogfood-ajan doğruladı, 2026-07-28' },
    unknown: 'Bilinmeyen yok.',
    action: { verb: 'Doğrulamayı gözden geçir.' },
    why: 'Kayıt insan onayı iddia ediyor.',
    doneWhen: 'Terminal onayı defterde görünürse.',
    rule: 'insan-onayi-bekliyor',
    updatedAt: NOW.toISOString(),
  };
  st.lastSyncedAt = NOW.toISOString();
  return st;
}

test('INVARYANT: verification OLMADAN insan rozeti YOK (log · kart · pasaport)', () => {
  const html = renderPano(iddiaEdenState()); // defter verilmedi = fail-closed

  // hiçbir yerde "insan" rozeti yok — ne log satırında ne seviye pilinde
  assert.equal(html.includes('>insan<'), false, 'log satırı kendi iddiasıyla insan rozeti alamaz');
  assert.equal(html.includes('>insan-onayı<'), false, 'seviye pili dayanaksız verilemez');
  // yerine dürüst işaret
  assert.ok(html.includes('kanal kaydı yok'));
  assert.ok(html.includes('doğrulama kaydı bulunamadı'));
  // SESSİZ SİLME YOK: satırın kendisi hâlâ panoda
  assert.ok(html.includes('Doğrulandı: 19 test geçti'));
  // sayı da dürüst: defterle desteklenmeyen madde "doğrulandı" sayılmaz
  assert.ok(html.includes('0/1 doğrulandı'));
  assert.ok(html.includes('1 satır kendini insan onayı sayıyor'));
  // kartın uydurulmuş insan-kanıtı cümlesi ekrana ÇIKMAZ
  assert.equal(html.includes('dogfood-ajan doğruladı'), false);
});

test('INVARYANT: kayıt "terminal" kanalı taşımıyorsa insan rozeti YOK', () => {
  for (const bozuk of [
    { source: undefined },
    { source: 'ajan' },
    { by: 'bilinmiyor' },
    { decision: 'corrected' },
    { levelAfter: 'test-kaniti' },
  ]) {
    const defter = ledgerFixture(['test-abc-0'], bozuk);
    const html = renderPano(iddiaEdenState(), { ledger: defter });
    const ad = JSON.stringify(bozuk);
    assert.equal(html.includes('>insan<'), false, `${ad}: log rozeti düşmeliydi`);
    assert.equal(html.includes('>insan-onayı<'), false, `${ad}: seviye rozeti düşmeliydi`);
    assert.ok(html.includes('kanal kaydı yok'), `${ad}: dürüst işaret olmalı`);
    assert.ok(html.includes('0/1 doğrulandı'), `${ad}: sayı yükselmemeli`);
  }
});

test('INVARYANT: GEÇERLİ verification varsa rozet VAR ve metin DEFTERDEN gelir', () => {
  const html = renderPano(iddiaEdenState(), { ledger: ledgerFixture(['test-abc-0']) });
  assert.ok(html.includes('>insan<'), 'defterle bağlanan log satırı rozetini alır');
  assert.ok(html.includes('>insan-onayı<'), 'seviye pili artık dayanaklı');
  assert.equal(html.includes('kanal kaydı yok'), false);
  assert.equal(html.includes('doğrulama kaydı bulunamadı'), false);
  assert.ok(html.includes('1/1 doğrulandı'));
  // İnsan onayı satırı defterden yazılır — claim'in uydurma cümlesinden değil
  assert.ok(html.includes('ekin doğruladı — 2026-07-28 11:30 (terminal onayı, passport.jsonl)'));
  assert.equal(html.includes('dogfood-ajan doğruladı'), false);
});

test('rozet kayıt BAŞINA verilir: başka claim\'in onayı bu satıra rozet kazandırmaz', () => {
  const html = renderPano(iddiaEdenState(), { ledger: ledgerFixture(['baska-claim']) });
  assert.equal(html.includes('>insan-onayı<'), false);
  assert.ok(html.includes('kanal kaydı yok'));
  assert.ok(html.includes('0/1 doğrulandı'));
});

test('log satırı bağı ZAMAN DAMGASIDIR: onayla eşleşmeyen satır rozetsiz kalır', () => {
  const st = iddiaEdenState();
  // Aynı claim onaylı, ama bu log satırı başka bir anın satırı → bağ yok.
  st.log = [{ ts: '2026-07-27T08:00:00Z', text: 'Doğrulandı: eski bir iş (birisi)', source: 'insan' }];
  const html = renderPano(st, { ledger: ledgerFixture(['test-abc-0']) });
  assert.equal(html.includes('>insan<'), false, 'zamanı bağlanamayan satır rozet alamaz');
  assert.ok(html.includes('Doğrulandı: eski bir iş'), 'satır silinmez');
  assert.ok(html.includes('kanal kaydı yok'));
});

test('altbilgi rozetin tek kaynağını AÇIKÇA yazar (denetçi nereye bakacağını bilir)', () => {
  const html = renderPano(stateFixture(), { ledger: stateLedger() });
  assert.ok(html.includes('passport.jsonl'));
  assert.ok(html.includes('insan onayı rozeti yalnız'));
});

/** Yalnız kart (hero) bloğu — rozet iddiaları pasaport satırıyla karışmasın. */
function heroBlok(html: string): string {
  const bas = html.indexOf('<section class="panel hero"');
  return html.slice(bas, html.indexOf('</section>', bas));
}

/** Kimliksiz (sentetik) kart kurar — card.ts "her şey onaylı" dalının şekli. */
function tamKart(st: OceanState, c: Claim): OceanState {
  st.card = {
    ...(st.card as NonNullable<OceanState['card']>),
    id: 'kart-tam',
    fact: c.text,
    factDate: c.createdAt,
    rule: 'tamam',
  };
  return st;
}

test('sentetik kart (kart-tam) rozeti de DEFTERDEN: gerçek onay haksız yere düşmez', () => {
  const st = iddiaEdenState();
  const c = st.claims[0] as Claim;
  // card.ts "her şey onaylı" durumunda kimliksiz kart üretir (id: 'kart-tam');
  // gerçek yine bir claim'den gelir → rozet o claim'in defter kaydına bakar.
  tamKart(st, c);

  const hero = heroBlok(renderPano(st, { ledger: ledgerFixture([c.id]) }));
  assert.ok(hero.includes('>insan-onayı<'), 'defterde kaydı olan gerçek rozetini almalı');
  assert.ok(hero.includes('ekin doğruladı — 2026-07-28 11:30 (terminal onayı, passport.jsonl)'));

  // Defter yoksa aynı kart rozetsiz — kimliksiz kart fail-open olmaz.
  const defterisiz = heroBlok(renderPano(st));
  assert.equal(defterisiz.includes('>insan-onayı<'), false);
  assert.ok(defterisiz.includes('kanal kaydı yok'));
});

test('sentetik kartta gerçek TEK adaya bağlanamıyorsa rozet YOK (belirsizlikte fail-closed)', () => {
  const st = iddiaEdenState();
  const c = st.claims[0] as Claim;
  // aynı metin + aynı tarihte iki claim → hangi kaydın onayı olduğu belirsiz
  st.claims = [c, { ...c, id: 'ikiz-claim' }];
  tamKart(st, c);
  const hero = heroBlok(renderPano(st, { ledger: ledgerFixture([c.id, 'ikiz-claim']) }));
  assert.equal(hero.includes('>insan-onayı<'), false, 'belirsiz kimlikte rozet verilmez');
  assert.ok(hero.includes('kanal kaydı yok'));
});
