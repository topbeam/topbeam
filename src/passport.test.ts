/**
 * passport.ts testleri — DEFTER (oturum kayıtları arşivi).
 * Dürüstlük invaryantları: birim seviyesi EN ZAYIF claim'den gelir, birim id'si
 * kararlıdır, başlık ÖLÇÜLMÜŞ sayılardan kurulur, sıra deterministiktir.
 *
 * NOT: defter bir ilerleme listesi DEĞİLDİR — 'status'/'verification' taşımaz.
 * Bar ve insan onayı teslim sözlerinde ölçülür (goal.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim } from './types.ts';
import { buildDefter, groupIntoUnits, unitLevel, workUnitId } from './passport.ts';

function claim(id: string, over: Partial<Claim> = {}): Claim {
  return {
    id,
    text: `iddia ${id}`,
    level: 'dogrulanmadi',
    kind: 'dosya',
    evidence: [{ kind: 'transcript-tool-use', summary: 't' }],
    createdAt: '2026-07-28T10:00:00Z',
    ...over,
  };
}

/** Bir oturumun tipik kaydı: 1 dosya + 3 test koşumu. */
function oturum(sid: string, n: number): Claim[] {
  const out: Claim[] = [
    claim(`dosya-git-${sid}`, {
      sessionId: sid,
      kind: 'dosya',
      level: 'dosya-kaniti',
      text: `${n} dosya değişti: src/a.ts`,
      signals: { fileCount: n, paths: ['src/a.ts'] },
      createdAt: '2026-07-28T10:00:00Z',
    }),
  ];
  for (let i = 0; i < 3; i++) {
    out.push(
      claim(`test-${sid}-${i}`, {
        sessionId: sid,
        kind: 'test',
        level: 'test-kaniti',
        text: `${i + 1} test geçti (npm test).`,
        createdAt: `2026-07-28T11:0${i}:00Z`,
      }),
    );
  }
  return out;
}

test('defter: her oturum TEK kayıt satırı olur', () => {
  const claims = Array.from({ length: 20 }, (_, i) => oturum(`s${i}`, 3)).flat();
  assert.equal(claims.length, 80);
  const defter = buildDefter(claims);
  assert.equal(defter.length, 20, 'satır sayısı oturum sayısı kadar olmalı');
  assert.ok(defter.every((d) => d.claimIds.length === 4));
});

test('defter satırı ilerleme taşımaz: status/verification alanı YOK', () => {
  const d = buildDefter(oturum('s1', 2))[0];
  assert.ok(d);
  assert.equal('status' in d, false, 'defter bir tik listesi değildir');
  assert.equal('verification' in d, false, 'onay defterde değil, teslim sözünde ölçülür');
  assert.deepEqual(Object.keys(d).sort(), ['claimIds', 'id', 'level', 'title']);
});

test('birim id kararlı: yeniden kurulumda ve claim eklenince DEĞİŞMEZ', () => {
  const s = oturum('sess-x', 2);
  const bir = buildDefter(s);
  const iki = buildDefter([...s, claim('test-sess-x-3', { sessionId: 'sess-x', kind: 'test' })]);
  assert.equal(bir[0]?.id, 'birim-sess-x');
  assert.equal(iki[0]?.id, 'birim-sess-x');
  assert.equal(iki.length, 1);
  assert.equal(iki[0]?.claimIds.length, 5);
});

test("oturumsuz claim kendi id'siyle tek başına birim olur", () => {
  assert.equal(workUnitId(claim('calisiyor-2026')), 'calisiyor-2026');
  assert.equal(workUnitId(claim('x', { sessionId: 'abc' })), 'birim-abc');
  const d = buildDefter([claim('calisiyor-2026')]);
  assert.equal(d[0]?.id, 'calisiyor-2026');
});

test('İNVARYANT: birim seviyesi EN ZAYIF claim — gruplama kanıt yükseltmez', () => {
  const sid = 'sz';
  const karisik = [
    claim(`a-${sid}`, { sessionId: sid, level: 'insan-onayi' }),
    claim(`b-${sid}`, { sessionId: sid, level: 'test-kaniti' }),
    claim(`c-${sid}`, { sessionId: sid, level: 'dogrulanmadi' }),
  ];
  assert.equal(unitLevel(karisik), 'dogrulanmadi');
  assert.equal(buildDefter(karisik)[0]?.level, 'dogrulanmadi');

  assert.equal(
    unitLevel([claim('x', { level: 'dosya-kaniti' }), claim('y', { level: 'test-kaniti' })]),
    'dosya-kaniti',
  );
  assert.equal(unitLevel([claim('x', { level: 'test-kaniti' })]), 'test-kaniti');
  assert.equal(
    unitLevel([claim('x', { level: 'insan-onayi' }), claim('y', { level: 'insan-onayi' })]),
    'insan-onayi',
  );
  assert.equal(unitLevel([]), 'dogrulanmadi');
});

test('başlık ÖLÇÜLMÜŞ sayılardan kurulur: tarih · dosya · test koşumu (+örnek dosya)', () => {
  const t = buildDefter(oturum('sb', 7))[0]?.title ?? '';
  assert.ok(t.startsWith('2026-07-28 · '), `başlık tarihle başlamalı: ${t}`);
  assert.ok(t.includes('7 dosya'));
  assert.ok(t.includes('3 test koşumu'));
  assert.ok(t.includes('src/a.ts'));
  // uydurma yok: sayılar claim sinyallerinden gelir
  assert.equal(t.includes('%'), false);
});

test('başlık: dosya/test kaydı olmayan birimde claim metni kullanılır', () => {
  const d = buildDefter([
    claim('calisiyor-x', { kind: 'durum', text: 'Giriş akışı çalışıyor — kullanıcı doğruladı.' }),
  ]);
  assert.equal(d[0]?.title, 'Giriş akışı çalışıyor — kullanıcı doğruladı.');
});

test('determinizm: aynı girdi → aynı defter (sıra dâhil)', () => {
  const claims = [...oturum('s2', 1), ...oturum('s1', 4)];
  assert.deepEqual(buildDefter(claims), buildDefter(claims));
  // sıra: en erken kayıt, eşitlikte id — girdi sırasına bağlı DEĞİL
  assert.deepEqual(
    groupIntoUnits(claims).map((u) => u.id),
    ['birim-s1', 'birim-s2'],
  );
});
