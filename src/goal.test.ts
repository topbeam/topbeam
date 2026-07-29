/**
 * goal.ts testleri — TESLİM SÖZLERİ ve barın kaynağı.
 *
 * Kilitlenen invaryantlar:
 *  - birim goal.md'den gelir (oturumdan DEĞİL),
 *  - OTURUM EKLEMEK PAYDAYI BÜYÜTMEZ (Sisifos regresyonu),
 *  - eşleşmeyen madde "kanıt yok" durur (uydurma eşleşme yok),
 *  - bar yalnız insan onayıyla dolar (kanıt seviyesi barı doldurmaz),
 *  - goal boşsa madde yok → bar çizilmez.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim, PassportItem } from './types.ts';
import {
  buildTeslim,
  claimEslesir,
  eslesenClaimler,
  enYuksekSeviye,
  ipuclariCikar,
  parseGoalItems,
  yolUyar,
} from './goal.ts';
import { buildLedger } from './ledger.ts';
import { dogrulananSayisi, maddeOnayli, pasaportTamMi } from './ledger.ts';

const GOAL = `# Proje Hedefi

> yönerge satırı — madde değildir

## Teslim sözleri

- [ ] Giriş akışı çalışıyor src/auth
- [ ] test: testler yeşil
- [ ] Ödeme ekranı bitti #odeme
- [ ] Belgeler hazır
`;

function claim(id: string, over: Partial<Claim> = {}): Claim {
  return {
    id,
    text: `iddia ${id}`,
    level: 'dosya-kaniti',
    kind: 'dosya',
    evidence: [{ kind: 'transcript-tool-use', summary: 't' }],
    createdAt: '2026-07-28T10:00:00Z',
    ...over,
  };
}

/** Gerçek passport.jsonl satır şekliyle defter — insan onayının TEK kaynağı. */
function defter(claimIds: readonly string[]) {
  return buildLedger(
    claimIds.map((claimId) => ({
      schema_version: 2,
      at: '2026-07-28T12:00:00Z',
      claimId,
      title: 'onaylanan iş',
      decision: 'approved',
      by: 'ekin',
      source: 'terminal',
      levelBefore: 'test-kaniti',
      levelAfter: 'insan-onayi',
    })),
  );
}

// ── ayrıştırma ───────────────────────────────────────────────────────────────

test('parseGoalItems: yalnız `- [ ]` satırları madde olur (başlık/alıntı/düz metin değil)', () => {
  const items = parseGoalItems(GOAL);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => i.text),
    ['Giriş akışı çalışıyor src/auth', 'test: testler yeşil', 'Ödeme ekranı bitti #odeme', 'Belgeler hazır'],
  );
  assert.ok(items.every((i) => i.id.startsWith('soz-')));
  assert.equal(items[0]?.line, 7);
});

test('parseGoalItems: `- [x]` de maddedir ama tik BEYANDIR (checked işaretlenir)', () => {
  const items = parseGoalItems('- [x] bitti dedim\n- [ ] bu duruyor\n');
  assert.equal(items.length, 2);
  assert.equal(items[0]?.checked, true);
  assert.equal(items[1]?.checked, false);
});

test('parseGoalItems: id metinden türer — metin değişince söz de değişir', () => {
  const a = parseGoalItems('- [ ] aynı söz')[0];
  const b = parseGoalItems('  * [x]   aynı   söz  ')[0]; // biçim farkı id değiştirmez
  const c = parseGoalItems('- [ ] başka söz')[0];
  assert.equal(a?.id, b?.id);
  assert.notEqual(a?.id, c?.id);
});

test('parseGoalItems: aynı metin iki kez yazılırsa id çakışmaz', () => {
  const items = parseGoalItems('- [ ] tekrar\n- [ ] tekrar\n');
  assert.equal(items.length, 2);
  assert.notEqual(items[0]?.id, items[1]?.id);
  assert.ok(items[1]?.id.endsWith('-2'));
});

test('parseGoalItems: boş madde ve maddesiz dosya → boş liste (bar yok)', () => {
  assert.deepEqual(parseGoalItems('- [ ]   \n'), []);
  assert.deepEqual(parseGoalItems('# Hedef\n\nDüz paragraf.\n'), []);
  assert.deepEqual(parseGoalItems(''), []);
});

// ── ipuçları ─────────────────────────────────────────────────────────────────

test('ipuçları: yol · test: öneki · #etiket ayrı ayrı okunur', () => {
  const h = ipuclariCikar('test: giriş `src/auth` ve README.md dosyası #odeme');
  assert.equal(h.testOnly, true);
  assert.deepEqual(h.paths, ['src/auth', 'README.md']);
  assert.deepEqual(h.tags, ['odeme']);
});

test('ipuçları: Türkçe "giriş/çıkış" YOL SANILMAZ (ASCII-only yol kuralı)', () => {
  const h = ipuclariCikar('kullanıcı giriş/çıkış yapabiliyor');
  assert.deepEqual(h.paths, []);
  assert.deepEqual(h.tags, []);
  assert.equal(h.testOnly, false);
});

test('ipuçları: sürüm/sayı (v0.1.0, 3.5) dosya sanılmaz; cümle sonu noktası kırpılır', () => {
  assert.deepEqual(ipuclariCikar('sürüm v0.1.0 ve oran 3.5 tamam').paths, []);
  assert.deepEqual(ipuclariCikar('src/cli.ts bitti.').paths, ['src/cli.ts']);
  assert.deepEqual(ipuclariCikar('şunu oku: package.json.').paths, ['package.json']);
});

test('yolUyar: tam eşleşme ve dizin öneki (yanlış önek eşleşmez)', () => {
  assert.equal(yolUyar('src/auth', 'src/auth/login.ts'), true);
  assert.equal(yolUyar('src/auth', 'src/auth'), true);
  assert.equal(yolUyar('src/auth', 'src/authentication.ts'), false, 'yarım önek yol değildir');
  assert.equal(yolUyar('src/cli.ts', 'src/cli.ts'), true);
  assert.equal(yolUyar('src/auth', 'src/pano.ts'), false);
});

// ── eşleme ───────────────────────────────────────────────────────────────────

test('eşleme: yol ipucu yalnız o yola dokunan kaydı bağlar', () => {
  const item = parseGoalItems('- [ ] Giriş akışı src/auth')[0];
  assert.ok(item);
  const auth = claim('c1', { signals: { fileCount: 1, paths: ['src/auth/login.ts'] } });
  const pano = claim('c2', { signals: { fileCount: 1, paths: ['src/pano.ts'] } });
  assert.equal(claimEslesir(item, auth), true);
  assert.equal(claimEslesir(item, pano), false);
});

test('eşleme: `test:` öneki YALNIZ test koşumu kayıtlarını bağlar', () => {
  const item = parseGoalItems('- [ ] test: testler yeşil')[0];
  assert.ok(item);
  const testC = claim('t1', { kind: 'test', level: 'test-kaniti' });
  const dosyaC = claim('d1', { kind: 'dosya', signals: { fileCount: 9, paths: ['src/a.ts'] } });
  assert.equal(claimEslesir(item, testC), true);
  assert.equal(claimEslesir(item, dosyaC), false);
});

test('eşleme: `test:` + yol ipucu birlikte — test OLMAYAN kayıt yine eşleşmez', () => {
  const item = parseGoalItems('- [ ] test: src/auth testleri')[0];
  assert.ok(item);
  const authTest = claim('t1', { kind: 'test', signals: { paths: ['src/auth/login.test.ts'] } });
  const authDosya = claim('d1', { kind: 'dosya', signals: { paths: ['src/auth/login.ts'] } });
  const baskaTest = claim('t2', { kind: 'test', signals: { paths: ['src/pano.test.ts'] } });
  assert.equal(claimEslesir(item, authTest), true);
  assert.equal(claimEslesir(item, authDosya), false);
  assert.equal(claimEslesir(item, baskaTest), false);
});

test('eşleme: #etiket kaydın metninde ya da yolunda aranır', () => {
  const item = parseGoalItems('- [ ] Ödeme ekranı #odeme')[0];
  assert.ok(item);
  const metinde = claim('c1', { text: '2 dosya değişti: odeme akışı' });
  const yolda = claim('c2', { text: '1 dosya değişti', signals: { paths: ['src/Odeme/ekran.ts'] } });
  const alakasiz = claim('c3', { text: '1 dosya değişti', signals: { paths: ['src/pano.ts'] } });
  assert.equal(claimEslesir(item, metinde), true);
  assert.equal(claimEslesir(item, yolda), true, 'büyük/küçük harf farkı eşleşmeyi bozmamalı');
  assert.equal(claimEslesir(item, alakasiz), false);
});

test('eşleme: ipucusuz madde HİÇBİR kaydı bağlamaz (uydurma eşleşme yok)', () => {
  const item = parseGoalItems('- [ ] Belgeler hazır')[0];
  assert.ok(item);
  for (const c of [claim('a'), claim('b', { kind: 'test' })]) {
    assert.equal(claimEslesir(item, c), false);
  }
});

test('eslesenClaimler: sıra deterministik (zaman, sonra id)', () => {
  const item = parseGoalItems('- [ ] test: hepsi')[0];
  assert.ok(item);
  const claims = [
    claim('z', { kind: 'test', createdAt: '2026-07-28T11:00:00Z' }),
    claim('b', { kind: 'test', createdAt: '2026-07-28T10:00:00Z' }),
    claim('a', { kind: 'test', createdAt: '2026-07-28T10:00:00Z' }),
  ];
  assert.deepEqual(eslesenClaimler(item, claims).map((c) => c.id), ['a', 'b', 'z']);
});

test('enYuksekSeviye: sözün seviyesi EN YÜKSEK eşleşen kayıttır', () => {
  assert.equal(enYuksekSeviye([]), 'dogrulanmadi');
  assert.equal(
    enYuksekSeviye([claim('a', { level: 'dogrulanmadi' }), claim('b', { level: 'test-kaniti' })]),
    'test-kaniti',
  );
  assert.equal(
    enYuksekSeviye([claim('a', { level: 'insan-onayi' }), claim('b', { level: 'dosya-kaniti' })]),
    'insan-onayi',
  );
});

// ── buildTeslim ──────────────────────────────────────────────────────────────

test('BİRİM = İNSANIN SÖZÜ: madde sayısı goal.md satır sayısıdır', () => {
  const items = parseGoalItems(GOAL);
  const p = buildTeslim([], [claim('a', { kind: 'test' })], items);
  assert.equal(p.length, 4);
  assert.deepEqual(p.map((x) => x.id), items.map((x) => x.id));
  assert.equal(p[0]?.title, 'Giriş akışı çalışıyor src/auth', 'başlık insanın kendi cümlesidir');
});

test('SİSİFOS REGRESYONU: oturum eklemek PAYDAYI BÜYÜTMEZ', () => {
  const items = parseGoalItems(GOAL);
  const gun1 = [
    claim('dosya-s1', { sessionId: 's1', signals: { fileCount: 3, paths: ['src/auth/a.ts'] } }),
    claim('test-s1-0', { sessionId: 's1', kind: 'test', level: 'test-kaniti' }),
  ];
  const ilk = buildTeslim([], gun1, items);
  assert.equal(ilk.length, 4);

  // Ertesi gün 5 oturum daha çalışıldı — eski dünyada payda 1 → 6 olurdu.
  const gun2 = [...gun1];
  for (let i = 2; i <= 6; i++) {
    gun2.push(claim(`dosya-s${i}`, { sessionId: `s${i}`, signals: { fileCount: 9, paths: ['src/x.ts'] } }));
    gun2.push(claim(`test-s${i}-0`, { sessionId: `s${i}`, kind: 'test', level: 'test-kaniti' }));
  }
  const sonra = buildTeslim(ilk, gun2, items);
  assert.equal(sonra.length, 4, 'çalışmak barı UZATMAMALI — payda insanın sözlerinden gelir');
  assert.deepEqual(sonra.map((p) => p.id), ilk.map((p) => p.id));

  // Payda yalnız insan yeni bir söz YAZINCA büyür.
  const yeniSozler = parseGoalItems(`${GOAL}- [ ] Bir söz daha\n`);
  assert.equal(buildTeslim(sonra, gun2, yeniSozler).length, 5);
});

test('EŞLEŞMEYEN MADDE "kanıt yok" DURUR: seviye doğrulanmadı, kayıt yok, komut yok', () => {
  const items = parseGoalItems('- [ ] Belgeler hazır\n- [ ] Ödeme #odeme\n');
  const p = buildTeslim([], [claim('a', { text: '1 dosya değişti: src/pano.ts' })], items);
  for (const madde of p) {
    assert.equal(madde.claimIds.length, 0);
    assert.equal(madde.level, 'dogrulanmadi');
    assert.equal(madde.status, 'not_verified');
    assert.ok(madde.reason?.startsWith('Kanıt yok'), `dürüst gerekçe: ${madde.reason ?? ''}`);
  }
  // ipucusuz madde, ipucu YAZILMADIĞINI söyler (kullanıcı ne yapacağını bilsin)
  assert.ok(p[0]?.reason?.includes('ipucu yazılmamış'));
  assert.ok(p[1]?.reason?.includes('eşleşen kayıt bulunamadı'));
});

test('BAR YALNIZ İNSAN ONAYIYLA DOLAR: test/dosya kanıtı bölmeyi doldurmaz', () => {
  const items = parseGoalItems('- [ ] test: testler yeşil\n');
  const testC = claim('t1', { kind: 'test', level: 'test-kaniti' });
  const p = buildTeslim([], [testC], items);
  assert.equal(p[0]?.level, 'test-kaniti', 'seviye en yüksek kanıttır');
  assert.equal(p[0]?.status, 'not_verified');
  assert.equal(dogrulananSayisi(p, defter([])), 0, 'test kanıtı barı DOLDURMAZ');

  // aynı kayıt insan onaylı + defterde kaydı var → bölme dolar
  const onayli = buildTeslim([], [{ ...testC, level: 'insan-onayi' }], items);
  assert.equal(onayli[0]?.status, 'completed');
  assert.equal(dogrulananSayisi(onayli, defter(['t1'])), 1);
  assert.equal(pasaportTamMi(onayli, defter(['t1'])), true);

  // DEFTER OLMADAN aynı state bölmeyi doldurmaz (fail-closed)
  assert.equal(dogrulananSayisi(onayli, defter([])), 0);
  assert.equal(pasaportTamMi(onayli, defter([])), false);
});

test('kısmi onay "tamam" göstermez: 1/2 kayıt onaylıysa madde partial', () => {
  const items = parseGoalItems('- [ ] test: testler yeşil\n');
  const p = buildTeslim(
    [],
    [
      claim('t1', { kind: 'test', level: 'insan-onayi' }),
      claim('t2', { kind: 'test', level: 'test-kaniti' }),
    ],
    items,
  );
  assert.equal(p[0]?.status, 'partial');
  assert.ok(p[0]?.reason?.includes('1/2'));
  assert.equal(maddeOnayli(defter(['t1']), p[0] as PassportItem), false);
});

test('ONAY GERİ ALINMAZ: onaydan sonra yeni kayıt gelse de madde completed KALIR (ama yeni iş söylenir)', () => {
  const items = parseGoalItems('- [ ] test: testler yeşil\n');
  const once = buildTeslim([], [claim('t1', { kind: 'test', level: 'insan-onayi' })], items).map(
    (p): PassportItem => ({
      ...p,
      verification: { by: 'ekin', at: '2026-07-28T12:00:00Z', decision: 'approved', source: 'terminal' },
    }),
  );
  assert.equal(once[0]?.status, 'completed');

  const sonra = buildTeslim(
    once,
    [claim('t1', { kind: 'test', level: 'insan-onayi' }), claim('t2', { kind: 'test', level: 'test-kaniti' })],
    items,
  );
  // Ölçülen kusur (2026-07-30): burası 'partial'a düşüyordu ve BAR GERİLİYORDU
  // (1/5 → 0/5), hem de insan imzası defterde dururken. Sisifos'un ikinci yüzü:
  // paydayı sabitlemiştik, bu kez pay eriyordu. Onay, insanın o an gördüğü şey
  // hakkında bir olgudur; sonraki iş onu geçersizleştirmez.
  assert.equal(sonra[0]?.status, 'completed', 'onay geri alınamaz');
  assert.equal(sonra[0]?.verification?.by, 'ekin', 'insan kararı kaydı durur');
  // ...ama yeni iş SESSİZ DE KALMAZ — gerekçe onu söylemeli.
  assert.ok(
    sonra[0]?.reason?.includes('Onaydan SONRA'),
    `yeni kayıt gerekçede görünmeli: ${sonra[0]?.reason}`,
  );
  assert.ok(sonra[0]?.reason?.includes('1 yeni'), 'kaç yeni kayıt olduğu sayıyla yazılmalı');
});

test('elle atılan `[x]` tik BEYANDIR: barı doldurmaz, sessizce de yutulmaz', () => {
  const items = parseGoalItems('- [x] test: testler yeşil\n');
  const p = buildTeslim([], [claim('t1', { kind: 'test', level: 'test-kaniti' })], items);
  assert.equal(p[0]?.status, 'not_verified');
  assert.ok(p[0]?.reason?.includes('beyandır, kanıt değil'));
  assert.equal(dogrulananSayisi(p, defter(['t1'])), 0, 'defterde kaydı olsa da onay claim başınadır');
});

test('insan kararı AYNI id\'li sözde taşınır; söz metni değişirse taşınmaz (yeni söz)', () => {
  const items = parseGoalItems('- [ ] test: testler yeşil\n');
  const claims = [claim('t1', { kind: 'test', level: 'insan-onayi' })];
  const once = buildTeslim([], claims, items).map(
    (p): PassportItem => ({
      ...p,
      verification: { by: 'ekin', at: '2026-07-28T12:00:00Z', decision: 'approved', source: 'terminal' },
      clientText: 'müşteri cümlesi',
    }),
  );
  const ayni = buildTeslim(once, claims, items);
  assert.equal(ayni[0]?.verification?.by, 'ekin');
  assert.equal(ayni[0]?.clientText, 'müşteri cümlesi');

  const degisti = buildTeslim(once, claims, parseGoalItems('- [ ] test: testler yeşil ve hızlı\n'));
  assert.equal(degisti[0]?.verification, undefined, 'değişen söz eski onayı devralamaz');
});

test('goal boşsa madde yok: bar çizilecek bir şey kalmaz', () => {
  assert.deepEqual(buildTeslim([], [claim('a')], []), []);
  assert.equal(pasaportTamMi([], defter([])), false, 'boş pasaport FULL sayılmaz');
});

test('determinizm: aynı girdi → aynı pasaport', () => {
  const items = parseGoalItems(GOAL);
  const claims = [claim('a', { kind: 'test' }), claim('b', { signals: { paths: ['src/auth/x.ts'] } })];
  assert.deepEqual(buildTeslim([], claims, items), buildTeslim([], claims, items));
});
