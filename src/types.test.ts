/** types.ts smoke testleri — şema sabitleri + dürüstlük kuralları. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  TOOL_VERSION,
  OCEAN_DIR,
  STATE_FILE,
  EVIDENCE_LEVELS,
  EVIDENCE_LEVEL_LABELS_TR,
  BP_LEVEL_MAP,
  toBpLevel,
  isPassportFull,
  newOceanState,
  CARD_PRIMARY_BUTTON_TR,
  type Card,
  type Claim,
  type LogEntry,
  type OceanState,
  type PassportItem,
} from './types.ts';

test('şema sabitleri', () => {
  // 2: pasaport maddesi = oturum birimi DEĞİL, goal.md teslim sözü (soz-…)
  assert.equal(SCHEMA_VERSION, 2);
  assert.match(TOOL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(OCEAN_DIR, '.ocean');
  assert.equal(STATE_FILE, 'state.json');
});

test('kanıt seviyeleri: 4 seviye, etiket ve BP haritası eksiksiz', () => {
  assert.equal(EVIDENCE_LEVELS.length, 4);
  for (const level of EVIDENCE_LEVELS) {
    assert.ok(EVIDENCE_LEVEL_LABELS_TR[level], `etiket eksik: ${level}`);
    assert.ok(BP_LEVEL_MAP[level], `BP haritası eksik: ${level}`);
  }
});

test('BP seviye haritası — Keşif/BP raporu §2 ile birebir', () => {
  assert.equal(toBpLevel('dosya-kaniti'), 'automatically_checked');
  assert.equal(toBpLevel('test-kaniti'), 'automatically_checked');
  assert.equal(toBpLevel('insan-onayi'), 'human_verified');
  assert.equal(toBpLevel('dogrulanmadi'), 'not_verified');
});

test('dogrulanmadi etiketi dürüstlük cümlesini taşır', () => {
  assert.match(EVIDENCE_LEVEL_LABELS_TR['dogrulanmadi'], /doğrulanmadı/i);
  // "ÇALIŞIYOR" iddiası hiçbir etikette otomatik yer almaz.
  for (const level of EVIDENCE_LEVELS) {
    assert.doesNotMatch(EVIDENCE_LEVEL_LABELS_TR[level], /çalışıyor/i);
  }
});

test('newOceanState boş ve şema-doğru durum üretir', () => {
  const s = newOceanState('demo-proje', new Date('2026-07-28T10:00:00Z'));
  assert.equal(s.schema_version, SCHEMA_VERSION);
  assert.equal(s.tool_version, TOOL_VERSION);
  assert.equal(s.projectName, 'demo-proje');
  assert.equal(s.createdAt, '2026-07-28T10:00:00.000Z');
  assert.deepEqual(s.log, []);
  assert.deepEqual(s.claims, []);
  assert.deepEqual(s.passport, []);
  assert.deepEqual(s.sessionsSeen, []);
  assert.equal(s.card, undefined);
  // JSON round-trip (state.json diske böyle gider)
  const back = JSON.parse(JSON.stringify(s)) as OceanState;
  assert.deepEqual(back, s);
});

test('isPassportFull: boş liste full sayılmaz; yalnız completed+insan-onayi full', () => {
  assert.equal(isPassportFull([]), false);

  const item = (over: Partial<PassportItem>): PassportItem => ({
    id: 'p1',
    title: 'Login formu',
    status: 'completed',
    claimIds: [],
    level: 'insan-onayi',
    ...over,
  });

  assert.equal(isPassportFull([item({})]), true);
  // Araç tahmini "tamamlandı" yetmez — insan onayı şart.
  assert.equal(isPassportFull([item({ level: 'dosya-kaniti' })]), false);
  assert.equal(isPassportFull([item({ status: 'not_verified' })]), false);
  assert.equal(isPassportFull([item({}), item({ id: 'p2', status: 'partial' })]), false);
});

test('Card şekli — GPT spec alanları derlenir ve taşınır', () => {
  const card: Card = {
    id: 'card-1',
    fact: 'Login formu eklendi görünüyor — henüz doğrulanmadı.',
    factLevel: 'dosya-kaniti',
    evidence: {
      gitDiff: '3 dosya değişti · +142/−8',
      testOutput: null,
      humanApproval: null,
    },
    unknown: 'Testler hiç çalıştırılmadı.',
    action: { verb: 'Doğrulamayı başlat.', command: 'topbeam verify gorev-3' },
    why: 'Tek bilinmeyen test sonucu; onu kapatmadan sonraki adım anlamsız.',
    doneWhen: 'Test çıktı kaydında GEÇTİ görünmeli.',
    rule: 'en-yeni',
    updatedAt: new Date().toISOString(),
  };
  assert.equal(card.evidence.testOutput, null); // null = "kayıt yok", sakin gösterim
  assert.equal(CARD_PRIMARY_BUTTON_TR, 'Doğrulamayı başlat');
});

test('Claim ve LogEntry şekilleri — beyan kanıt değildir', () => {
  const claim: Claim = {
    id: 'c1',
    text: '2 dosya değişti: src/a.ts, src/b.ts',
    level: 'dosya-kaniti',
    evidence: [
      { kind: 'transcript-tool-use', summary: 'Edit src/a.ts (+10/−2)', ref: 'toolu_x' },
      { kind: 'git-diff', summary: 'git diff kesişimi doğruladı' },
    ],
    createdAt: new Date().toISOString(),
  };
  assert.equal(claim.evidence.length, 2);

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    text: 'Login formunu ekle', // Bash description — Claude'un beyanı
    source: 'claude-beyan',
  };
  assert.equal(entry.source, 'claude-beyan');
});

/**
 * SÜRÜM NÖBETÇİSİ (2026-07-29) — araç sürümü package.json ile ayrışamaz.
 *
 * Yaşanan: TOOL_VERSION elle yazılıydı; `npm version patch` onu güncellemedi ve
 * yayınlanan 0.1.1 kendini "v0.1.0" diye tanıttı — CLI'da, panoda ve dışarıya
 * gösterilen MAKBUZ'da. Makbuzun üstünde yanlış sürüm yazması bu üründe
 * kabul edilemez bir yanlış beyandır; bu test o kaymayı imkânsız kılar.
 */
test('TOOL_VERSION, package.json.version ile BİREBİR aynı olmalı', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const kok = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(kok, 'package.json'), 'utf8')) as { version: string };
  assert.equal(
    TOOL_VERSION,
    pkg.version,
    'sürüm kaydı: makbuz/pano/CLI yanlış sürüm gösterir — `npm version` sonrası types.ts da güncellenmeli',
  );
});
