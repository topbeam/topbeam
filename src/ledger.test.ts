/**
 * ledger.ts testleri — İNSAN ROZETİNİN TEK KAYNAĞI burada kilitlenir.
 *
 * Ürünün en ağır dürüstlük invaryantı üç cümledir:
 *   1. Doğrulama kaydı YOKSA insan rozeti YOK (kayıt kendi kendine iddia edemez).
 *   2. Kanal 'terminal' DEĞİLSE insan rozeti YOK (ajan metni yazar, TTY'yi yazamaz).
 *   3. Geçerli kayıt VARSA rozet VAR (dürüstlük onayı gizlemek değildir).
 * Bu dosya üçünü de saf fonksiyon düzeyinde sabitler; pano tarafı pano.test.ts'te.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PassportItem } from './types.ts';
import {
  BOS_LEDGER,
  birimOnayli,
  buildLedger,
  claimOnayli,
  dogrulananSayisi,
  kayitGecerliMi,
  kimlikGecerliMi,
  logSatiriOnayli,
  maddeOnayli,
  pasaportTamMi,
} from './ledger.ts';

const AT = '2026-07-28T11:30:00Z';

/** Gerçek passport.jsonl satırı (verify.ts ne yazıyorsa birebir o şekil). */
function kayit(over: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    at: AT,
    claimId: 'test-abc-0',
    title: '19 test geçti',
    decision: 'approved',
    by: 'ekin',
    source: 'terminal',
    levelBefore: 'test-kaniti',
    levelAfter: 'insan-onayi',
    ...over,
  };
}

function madde(over: Partial<PassportItem> = {}): PassportItem {
  return {
    id: 'birim-s1',
    title: 'oturum işi',
    status: 'completed',
    claimIds: ['test-abc-0'],
    level: 'insan-onayi',
    ...over,
  };
}

// ── INVARYANT 1: kayıt yoksa rozet yok ──────────────────────────────────────

test('INVARYANT: doğrulama kaydı OLMADAN insan rozeti YOK', () => {
  const bos = buildLedger([], { dosyaVar: true });
  assert.equal(claimOnayli(bos, 'test-abc-0'), false);
  assert.equal(birimOnayli(bos, ['test-abc-0']), false);
  assert.equal(maddeOnayli(bos, madde()), false, 'state "completed+insan-onayi" dese bile');
  assert.equal(pasaportTamMi([madde()], bos), false);
  assert.equal(dogrulananSayisi([madde()], bos), 0);
});

test('INVARYANT: defter hiç okunamadıysa da rozet YOK (fail-closed)', () => {
  assert.equal(BOS_LEDGER.dosyaVar, false);
  assert.equal(claimOnayli(BOS_LEDGER, 'test-abc-0'), false);
  assert.equal(pasaportTamMi([madde()], BOS_LEDGER), false);
  assert.equal(logSatiriOnayli(BOS_LEDGER, AT), false);
});

test('boş birim (claimIds yok) onaylı SAYILMAZ — boşluk onay değildir', () => {
  const d = buildLedger([kayit()]);
  assert.equal(birimOnayli(d, []), false);
  assert.equal(maddeOnayli(d, madde({ claimIds: [] })), false);
  assert.equal(pasaportTamMi([], d), false, 'madde yoksa FULL-TİK de yok');
});

// ── INVARYANT 2: kanal terminal değilse rozet yok ───────────────────────────

test('INVARYANT: source "terminal" DEĞİLSE insan rozeti YOK', () => {
  for (const source of [undefined, 'pipe', 'ajan', 'TERMINAL', 'api', '']) {
    const d = buildLedger([kayit({ source })]);
    assert.equal(
      claimOnayli(d, 'test-abc-0'),
      false,
      `source=${String(source)} rozet kazanmamalı`,
    );
    assert.ok(
      (d.gecersiz.get('test-abc-0') ?? '').includes('no ledger entry'),
      'gerekçe kanal eksikliğini söylemeli',
    );
  }
});

test('bot senaryosu: log satırı gibi kendi kendini "insan" ilan eden kayıt REDDEDİLİR', () => {
  // Dogfood sızıntısının birebir şekli: ajan imzalı, kanalsız "onay".
  const d = buildLedger([kayit({ by: 'dogfood-ajan', source: undefined })]);
  assert.equal(claimOnayli(d, 'test-abc-0'), false);
  assert.equal(d.reddedilenSatir, 1);
});

// ── INVARYANT 3: geçerli kayıt varsa rozet var ──────────────────────────────

test('INVARYANT: GEÇERLİ doğrulama kaydı varsa rozet VAR', () => {
  const d = buildLedger([kayit()]);
  assert.equal(claimOnayli(d, 'test-abc-0'), true);
  assert.equal(birimOnayli(d, ['test-abc-0']), true);
  assert.equal(maddeOnayli(d, madde()), true);
  assert.equal(pasaportTamMi([madde()], d), true);
  assert.equal(dogrulananSayisi([madde()], d), 1);
  assert.equal(d.gecersiz.has('test-abc-0'), false);
  assert.equal(logSatiriOnayli(d, AT), true, 'log satırı onayla aynı damgadan bağlanır');
});

test('rozet birim BÜTÜNÜNE bakar: bir kaydı eksik birim onaylı DEĞİL', () => {
  const d = buildLedger([kayit()]);
  assert.equal(birimOnayli(d, ['test-abc-0', 'dosya-git-abc']), false);
  assert.equal(maddeOnayli(d, madde({ claimIds: ['test-abc-0', 'dosya-git-abc'] })), false);
});

test('madde durumu da şart: status/level tutmuyorsa defter tek başına tik vermez', () => {
  const d = buildLedger([kayit()]);
  assert.equal(maddeOnayli(d, madde({ status: 'partial' })), false);
  assert.equal(maddeOnayli(d, madde({ level: 'test-kaniti' })), false);
});

// ── kayıt geçerliliği: tek tek şartlar ──────────────────────────────────────

test('kayitGecerliMi: her şart ayrı ayrı kapıdır', () => {
  assert.equal(kayitGecerliMi(kayit()).ok, true);

  const red = (over: Record<string, unknown>): string => {
    const c = kayitGecerliMi(kayit(over));
    assert.equal(c.ok, false, `${JSON.stringify(over)} geçmemeliydi`);
    return c.ok === false ? c.neden : '';
  };
  assert.ok(red({ claimId: undefined }).includes('claimId'));
  assert.ok(red({ at: '' }).includes('timestamp'));
  assert.ok(red({ by: 'bilinmiyor' }).includes('signature'));
  assert.ok(red({ by: '   ' }).includes('signature'));
  assert.ok(red({ source: undefined }).includes('no ledger entry'));
  assert.ok(red({ decision: 'corrected' }).includes('approved'));
  assert.ok(red({ levelAfter: 'test-kaniti' }).includes('human approval'));
});

test('kayitGecerliMi: dosyadan gelen ŞEKİL varsayılmaz (çöp satır patlatmaz)', () => {
  for (const cop of [null, 42, 'metin', [], undefined]) {
    const c = kayitGecerliMi(cop);
    assert.equal(c.ok, false);
    assert.equal(c.ok === false && c.claimId, null);
  }
});

test('kimlikGecerliMi: "bilinmiyor" imzayla onay olmaz (yazan kapıyla aynı liste)', () => {
  for (const yok of ['', '   ', 'unknown', 'BİLİNMİYOR'.toLocaleLowerCase('tr-TR'), 'none', 'null']) {
    assert.equal(kimlikGecerliMi(yok), false, `'${yok}' kimlik sayılmamalı`);
  }
  assert.equal(kimlikGecerliMi('dev'), true);
  assert.equal(kimlikGecerliMi(' ada.lovelace '), true);
});

// ── defter davranışı: sessiz silme yok, gölgeleme yok ───────────────────────

test('SESSİZ SİLME YOK: geçersiz kayıt gerekçesiyle sayılır ve işaretlenir', () => {
  const d = buildLedger([kayit({ claimId: 'kanalsiz-1', source: undefined }), 'bozuk-satir']);
  assert.equal(d.okunanSatir, 2);
  assert.equal(d.reddedilenSatir, 2);
  assert.equal(d.gecerli.size, 0);
  assert.ok(d.gecersiz.get('kanalsiz-1')?.includes('no ledger entry'), 'gerekçe insan-okur olmalı');
});

test('bozuk satır, AYNI claim için var olan gerçek onayı GÖLGELEMEZ', () => {
  const d = buildLedger([kayit(), kayit({ source: 'ajan' })]);
  assert.equal(claimOnayli(d, 'test-abc-0'), true);
  assert.equal(d.gecersiz.has('test-abc-0'), false, 'geçerli onay varken gerekçe düşmeli');
  assert.equal(d.reddedilenSatir, 1);
});

test('aynı claim iki kez onaylanmışsa EN SON onay kazanır (append-only defter)', () => {
  const d = buildLedger([
    kayit({ at: '2026-07-20T09:00:00Z', by: 'eski' }),
    kayit({ at: '2026-07-28T09:00:00Z', by: 'yeni' }),
  ]);
  assert.equal(d.gecerli.get('test-abc-0')?.by, 'yeni');
  // Her iki damga da log bağı için durur (eski satır rozetini kaybetmez).
  assert.equal(logSatiriOnayli(d, '2026-07-20T09:00:00Z'), true);
  assert.equal(logSatiriOnayli(d, '2026-07-28T09:00:00Z'), true);
});

test('logSatiriOnayli: bağlanamayan zaman damgası rozet ALMAZ', () => {
  const d = buildLedger([kayit()]);
  assert.equal(logSatiriOnayli(d, '2026-07-28T11:30:01Z'), false);
});
