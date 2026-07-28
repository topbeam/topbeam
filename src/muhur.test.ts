/**
 * muhur.ts testleri — saf metin üretimi (fs yok).
 * Dürüstlük invaryantları: kapsam AÇIKÇA yazılır, "ne demek DEĞİL" bölümü
 * kalkmaz, sayı uydurulmaz, imza defterden gelir, çıktı deterministiktir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim, PassportItem } from './types.ts';
import { buildLedger } from './ledger.ts';
import { muhurMetni, MUHUR_FILE } from './muhur.ts';

const AT = '2026-07-29T14:03:00.000Z';

function defter(claimIds: readonly string[], by = 'ekin') {
  return buildLedger(
    claimIds.map((claimId) => ({
      schema_version: 2,
      at: AT,
      claimId,
      title: 'onaylanan iş',
      decision: 'approved',
      by,
      source: 'terminal',
      levelBefore: 'test-kaniti',
      levelAfter: 'insan-onayi',
    })),
  );
}

const claims: Claim[] = [
  {
    id: 'c1',
    text: '3 dosya değişti: src/auth/login.ts',
    level: 'insan-onayi',
    kind: 'dosya',
    evidence: [{ kind: 'git-diff', summary: 'git kaydı var' }],
    createdAt: '2026-07-28T10:00:00Z',
  },
  {
    id: 'c2',
    text: '19 test geçti (npm test).',
    level: 'insan-onayi',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: '# pass 19' }],
    createdAt: '2026-07-28T11:00:00Z',
  },
];

const items: PassportItem[] = [
  { id: 'soz-a', title: 'Giriş akışı çalışıyor src/auth', status: 'completed', claimIds: ['c1'], level: 'insan-onayi' },
  { id: 'soz-b', title: 'test: testler yeşil', status: 'completed', claimIds: ['c2'], level: 'insan-onayi' },
];

function metin(): string {
  return muhurMetni({
    projectName: 'Deneme Proje',
    at: AT,
    by: 'ekin',
    items,
    claims,
    ledger: defter(['c1', 'c2']),
    toolVersion: '0.1.0',
  });
}

test('mühür KAPSAMI dürüstçe yazar: kaç söz, ne zaman, kim imzaladı', () => {
  const m = metin();
  assert.ok(m.startsWith('# Mühür — Deneme Proje'));
  assert.ok(m.includes('Kapsam    : 2 teslim sözü — hepsi insan onaylı.'));
  assert.ok(m.includes('2026-07-29 14:03'));
  assert.ok(m.includes(AT), 'makine-okur ISO damgası da kalmalı');
  assert.ok(m.includes('Son imza  : ekin (terminal onayı, .ocean/passport.jsonl)'));
  assert.ok(m.includes('topbeam v0.1.0'));
});

test('mühür her sözü ve DAYANAĞINI listeler (ölçülmüş kayıt sayısı + seviye)', () => {
  const m = metin();
  assert.ok(m.includes('- Giriş akışı çalışıyor src/auth'));
  assert.ok(m.includes('- test: testler yeşil'));
  assert.ok(m.includes('dayanak: 1 kayıt (1 insan-onayı)'));
  assert.ok(m.includes('onay: ekin — 2026-07-29 14:03'));
});

test('"ne demek DEĞİL" bölümü mühürde her zaman durur (aşırı iddia kapısı)', () => {
  const m = metin();
  assert.ok(m.includes('## Bu mühür ne demek DEĞİL'));
  assert.ok(m.includes('"Ürün hatasız" demek değildir'));
  // hype/yüzde dili yok
  assert.equal(/%\d/.test(m), false);
  for (const yasak of ['Tebrikler', 'Harika', 'başarıyla', 'mükemmel']) {
    assert.equal(m.includes(yasak), false, `mühür '${yasak}' içermemeli`);
  }
});

test('defterde imza yoksa UYDURULMAZ: "imza kaydı yok" yazar', () => {
  const m = muhurMetni({
    projectName: 'P',
    at: AT,
    by: 'ekin',
    items,
    claims,
    ledger: defter([]), // hiçbir kaydın terminal onayı yok
    toolVersion: '0.1.0',
  });
  assert.ok(m.includes('onay: imza kaydı yok'));
  assert.equal(m.includes('onay: ekin —'), false);
});

test('kaydı bilinmeyen söz için seviye dökümü uydurulmaz', () => {
  const m = muhurMetni({
    projectName: 'P',
    at: AT,
    by: 'ekin',
    items: [{ id: 'soz-x', title: 'kayıtsız söz', status: 'completed', claimIds: ['yok'], level: 'insan-onayi' }],
    claims,
    ledger: defter([]),
    toolVersion: '0.1.0',
  });
  assert.ok(m.includes('dayanak: 1 kayıt (kayıt bulunamadı)'));
});

test('deterministik: aynı girdi → aynı metin; dosya adı sabit', () => {
  assert.equal(metin(), metin());
  assert.equal(MUHUR_FILE, 'muhur.md');
});
