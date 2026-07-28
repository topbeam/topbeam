/**
 * card.ts testleri — kart claim'i AYNEN taşır, seviye yükseltmez,
 * kanıt satırı uydurmaz (dürüstlük invaryantları kilitli).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim } from './types.ts';
import { CARD_PRIMARY_BUTTON_TR } from './types.ts';
import { buildCard, scriptsFromPackageJson, verifyCommand } from './card.ts';
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

// ── boş / tam durumlar ───────────────────────────────────────────────────────

test('hiç claim yok → sakin boş kart, aksiyon ocean sync', () => {
  const card = buildCard([], { now: NOW });
  assert.equal(card.id, 'kart-bos');
  assert.equal(card.factLevel, 'dogrulanmadi');
  assert.deepEqual(card.evidence, { gitDiff: null, testOutput: null, humanApproval: null });
  assert.equal(card.action.command, 'ocean sync');
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

test('doğrulanmamış yoksa: kanıtlı-ama-onaysız en yenisi → ocean verify aksiyonu', () => {
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
  assert.ok(card.doneWhen.includes('ocean verify test-s1-0'));
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
  assert.ok(card.doneWhen.includes(`ocean verify ${card.id}`)); // buton komutla uyumlu
  assert.equal(CARD_PRIMARY_BUTTON_TR, 'Doğrulamayı başlat');
});

// ── yardımcılar ──────────────────────────────────────────────────────────────

test('verifyCommand + scriptsFromPackageJson', () => {
  assert.equal(verifyCommand('gorev-3'), 'ocean verify gorev-3');
  assert.deepEqual(scriptsFromPackageJson('{"scripts":{"test":"node --test","x":3}}'), { test: 'node --test' });
  assert.deepEqual(scriptsFromPackageJson('bozuk json'), {});
  assert.deepEqual(scriptsFromPackageJson('{"scripts":[]}'), {});
  assert.deepEqual(scriptsFromPackageJson('null'), {});
});
