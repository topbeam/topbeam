/**
 * passport.ts testleri — iş birimi gruplaması.
 * Dürüstlük invaryantları: birim seviyesi EN ZAYIF claim'den gelir, 'completed'
 * yalnız hepsi insan onaylıysa, insan kararı asla kaybolmaz, id kararlıdır.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim, PassportItem } from './types.ts';
import { buildPassport, groupIntoUnits, unitLevel, workUnitId } from './passport.ts';

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

test('278 → makul: her oturum TEK pasaport maddesi olur', () => {
  const claims = Array.from({ length: 20 }, (_, i) => oturum(`s${i}`, 3)).flat();
  assert.equal(claims.length, 80);
  const passport = buildPassport([], claims);
  assert.equal(passport.length, 20, 'madde sayısı oturum sayısı kadar olmalı');
  assert.ok(passport.every((p) => p.claimIds.length === 4));
});

test('birim id kararlı: yeniden kurulumda ve claim eklenince DEĞİŞMEZ', () => {
  const s = oturum('sess-x', 2);
  const bir = buildPassport([], s);
  const iki = buildPassport(bir, [...s, claim('test-sess-x-3', { sessionId: 'sess-x', kind: 'test' })]);
  assert.equal(bir[0]?.id, 'birim-sess-x');
  assert.equal(iki[0]?.id, 'birim-sess-x');
  assert.equal(iki.length, 1);
  assert.equal(iki[0]?.claimIds.length, 5);
});

test('oturumsuz claim kendi id\'siyle tek başına birim olur', () => {
  assert.equal(workUnitId(claim('calisiyor-2026')), 'calisiyor-2026');
  assert.equal(workUnitId(claim('x', { sessionId: 'abc' })), 'birim-abc');
  const p = buildPassport([], [claim('calisiyor-2026')]);
  assert.equal(p[0]?.id, 'calisiyor-2026');
});

test('İNVARYANT: birim seviyesi EN ZAYIF claim — gruplama kanıt yükseltmez', () => {
  const sid = 'sz';
  const karisik = [
    claim(`a-${sid}`, { sessionId: sid, level: 'insan-onayi' }),
    claim(`b-${sid}`, { sessionId: sid, level: 'test-kaniti' }),
    claim(`c-${sid}`, { sessionId: sid, level: 'dogrulanmadi' }),
  ];
  assert.equal(unitLevel(karisik), 'dogrulanmadi');
  const p = buildPassport([], karisik);
  assert.equal(p[0]?.level, 'dogrulanmadi');
  assert.equal(p[0]?.status, 'partial'); // completed DEĞİL
  assert.ok(p[0]?.reason?.includes('1/3'), 'kaç kayıt onaylı DÜRÜSTÇE yazılmalı');

  // hiç onay yoksa varsayılan not_verified (araç "tamam" tahmin etmez)
  const hic = buildPassport([], [claim('z', { sessionId: 'sz2' })]);
  assert.equal(hic[0]?.status, 'not_verified');

  // hepsi kanıtlı ama insan onayı yok → yine completed DEĞİL
  assert.equal(unitLevel([claim('x', { level: 'dosya-kaniti' }), claim('y', { level: 'test-kaniti' })]), 'dosya-kaniti');
  assert.equal(unitLevel([claim('x', { level: 'test-kaniti' })]), 'test-kaniti');
});

test('completed YALNIZ hepsi insan onaylıyken (FULL-TİK erişilebilir ama bedava değil)', () => {
  const sid = 'sf';
  const hepsi = [
    claim(`a-${sid}`, { sessionId: sid, level: 'insan-onayi' }),
    claim(`b-${sid}`, { sessionId: sid, level: 'insan-onayi' }),
  ];
  const p = buildPassport([], hepsi);
  assert.equal(p[0]?.status, 'completed');
  assert.equal(p[0]?.level, 'insan-onayi');
});

test('onaydan SONRA birime yeni kayıt düşerse madde partial olur (sessiz "tamam" yok)', () => {
  const sid = 'sp';
  const onayli = claim(`a-${sid}`, { sessionId: sid, level: 'insan-onayi' });
  const once = buildPassport([], [onayli]).map(
    (p): PassportItem => ({
      ...p,
      verification: { by: 'ekin', at: '2026-07-28T12:00:00Z', decision: 'approved' },
    }),
  );
  assert.equal(once[0]?.status, 'completed');

  const sonra = buildPassport(once, [onayli, claim(`b-${sid}`, { sessionId: sid, level: 'dogrulanmadi' })]);
  assert.equal(sonra.length, 1);
  assert.equal(sonra[0]?.status, 'partial');
  assert.equal(sonra[0]?.level, 'dogrulanmadi');
  assert.ok(sonra[0]?.reason?.includes('yeni kayıt'));
  assert.equal(sonra[0]?.verification?.by, 'ekin'); // insan kararı kaydı durur
});

test('eski claim-başına maddedeki insan kararı BİRİME taşınır (kaybolmaz)', () => {
  const sid = 'st';
  const c = claim(`dosya-git-${sid}`, { sessionId: sid, level: 'insan-onayi' });
  const eski: PassportItem[] = [
    {
      id: c.id, // eski şema: madde id = claim id
      title: 'eski başlık',
      status: 'completed',
      claimIds: [c.id],
      level: 'insan-onayi',
      verification: { by: 'ekin', at: '2026-07-27T09:00:00Z', decision: 'approved' },
      clientText: 'müşteri cümlesi',
    },
  ];
  const yeni = buildPassport(eski, [c]);
  assert.equal(yeni.length, 1, 'eski madde çiftlenmemeli');
  assert.equal(yeni[0]?.id, `birim-${sid}`);
  assert.equal(yeni[0]?.verification?.by, 'ekin');
  assert.equal(yeni[0]?.clientText, 'müşteri cümlesi');
  assert.equal(yeni[0]?.status, 'completed');
});

test('claim\'i düşen onaylı eski madde İZ olarak korunur; onaysız eski madde tazelenir', () => {
  const iz: PassportItem = {
    id: 'eski-onayli',
    title: 'artık claim\'i olmayan onaylı iş',
    status: 'completed',
    claimIds: ['yok-olmus-claim'],
    level: 'insan-onayi',
    verification: { by: 'ekin', at: '2026-07-20T09:00:00Z', decision: 'approved' },
  };
  const cop: PassportItem = {
    id: 'eski-onaysiz',
    title: 'otomatik üretilmiş eski madde',
    status: 'not_verified',
    claimIds: ['yok-olmus-2'],
    level: 'dogrulanmadi',
  };
  const out = buildPassport([iz, cop], [claim('a', { sessionId: 's1' })]);
  assert.ok(out.some((p) => p.id === 'eski-onayli'), 'insan kararı iz olarak kalmalı');
  assert.equal(out.some((p) => p.id === 'eski-onaysiz'), false, 'onaysız eski madde birikmemeli');
});

test('başlık ÖLÇÜLMÜŞ sayılardan kurulur: tarih · dosya · test koşumu (+örnek dosya)', () => {
  const p = buildPassport([], oturum('sb', 7));
  const t = p[0]?.title ?? '';
  assert.ok(t.startsWith('2026-07-28 · '), `başlık tarihle başlamalı: ${t}`);
  assert.ok(t.includes('7 dosya'));
  assert.ok(t.includes('3 test koşumu'));
  assert.ok(t.includes('src/a.ts'));
  // uydurma yok: sayılar claim sinyallerinden gelir
  assert.equal(t.includes('%'), false);
});

test('başlık: dosya/test kaydı olmayan birimde claim metni kullanılır', () => {
  const p = buildPassport([], [claim('calisiyor-x', { kind: 'durum', text: 'Giriş akışı çalışıyor — kullanıcı doğruladı.' })]);
  assert.equal(p[0]?.title, 'Giriş akışı çalışıyor — kullanıcı doğruladı.');
});

test('determinizm: aynı girdi → aynı pasaport (sıra dâhil)', () => {
  const claims = [...oturum('s2', 1), ...oturum('s1', 4)];
  assert.deepEqual(buildPassport([], claims), buildPassport([], claims));
  // sıra: en erken kayıt, eşitlikte id — girdi sırasına bağlı DEĞİL
  assert.deepEqual(groupIntoUnits(claims).map((u) => u.id), ['birim-s1', 'birim-s2']);
});
