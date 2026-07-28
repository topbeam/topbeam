/**
 * pano.ts testleri — saf render, fs yok.
 * Dürüstlük invaryantları: yüzde-progress yok, kanıt satırı uydurulmaz,
 * escape zorunlu, "Doğrulamayı başlat" kutusu yalnız gerçek claim kartında.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOceanState, type Claim, type OceanState } from './types.ts';
import { buildCard } from './card.ts';
import { renderPano, esc } from './pano.ts';

const NOW = new Date('2026-07-28T12:00:00Z');

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
      verification: { by: 'ekin', at: '2026-07-28T11:30:00Z', decision: 'approved' },
    },
  ];
  st.card = buildCard(st.claims, { now: NOW });
  st.lastSyncedAt = NOW.toISOString();
  return st;
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
  assert.ok(html.includes(`ocean verify ${st.card?.id ?? ''}`));
});

test('kanıt satırı uydurulmaz: olmayan tür "kayıt yok" görünür', () => {
  const st = stateFixture();
  // kart = dosya-kaniti claim (insan onayı yok, test çıktısı yok olabilir)
  const html = renderPano(st);
  assert.ok(html.includes('kayıt yok'));
});

test('yüzde-progress-bar YOK; dürüst sayım VAR', () => {
  const html = renderPano(stateFixture());
  assert.equal(html.includes('<progress'), false);
  assert.equal(/progress-bar|progressbar/i.test(html), false);
  assert.ok(html.includes('1/2 doğrulandı'));
});

test('log: beyan rozeti + kaynak rozetleri + en yeni üstte', () => {
  const html = renderPano(stateFixture());
  assert.ok(html.includes('>beyan<'));
  assert.ok(html.includes('>git<'));
  // en yeni (09:30 beyan) git satırından (09:00) önce render edilir
  const beyanPos = html.indexOf('Beyan: Testleri çalıştır');
  const gitPos = html.indexOf('Commit: iskelet');
  assert.ok(beyanPos > -1 && gitPos > -1 && beyanPos < gitPos);
});

test('full-tik değilse kutlama bandı YOK; full-tik ise VAR', () => {
  const st = stateFixture();
  assert.equal(renderPano(st).includes('Ürün geliştirildi'), false);

  for (const p of st.passport) {
    p.status = 'completed';
    p.level = 'insan-onayi';
  }
  assert.ok(renderPano(st).includes('Ürün geliştirildi 🎉'));
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

test('kart-bos: Doğrulamayı başlat kutusu yok, ocean sync önerilir', () => {
  const st = newOceanState('Bos Proje', NOW);
  st.card = buildCard([], { now: NOW });
  const html = renderPano(st);
  assert.equal(html.includes('Doğrulamayı başlat'), false);
  assert.ok(html.includes('ocean sync'));
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
