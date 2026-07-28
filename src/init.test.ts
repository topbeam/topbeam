/** init.ts testleri — mkdtemp izole proje dizinlerinde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, CLAUDE_MD_MARKER } from './init.ts';
import { readState } from './state.ts';

async function tmpProj(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'topbeam-init-'));
}

test('sıfırdan init: state + goal + notes + CLAUDE.md bölümü kurulur', async () => {
  const dir = await tmpProj();
  const res = await runInit(dir, { now: new Date('2026-07-28T10:00:00Z') });

  assert.ok(res.created.includes('.ocean/state.json'));
  assert.ok(res.created.includes('.ocean/goal.md'));
  assert.ok(res.created.includes('.ocean/notes.md'));
  assert.equal(res.claudeMdUpdated, true);

  const state = await readState(dir);
  assert.ok(state);
  assert.equal(state.projectName, res.projectName);
  assert.equal(state.claims.length, 0);
  assert.equal(state.log[0]?.source, 'ocean'); // init izi log'da

  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.includes(CLAUDE_MD_MARKER));
  assert.ok(claudeMd.includes('.ocean/goal.md'));
  assert.ok(claudeMd.includes('.ocean/notes.md'));
  assert.ok(claudeMd.includes('doğrulanmadı')); // dürüstlük talimatı
  // Sözler İNSANINDIR: Claude'a açıkça "ekleme, silme" denir (moat koruması)
  assert.ok(claudeMd.includes('teslim\n   sözleri kullanıcınındır'));
});

test('goal.md şablonu: 7 evrensel teslim kapısı + yönerge; hedef satırı sızmaz', async () => {
  const { parseGoalItems } = await import('./goal.ts');
  const { readGoal } = await import('./state.ts');
  const dir = await tmpProj();
  await runInit(dir);

  const goal = await readFile(join(dir, '.ocean', 'goal.md'), 'utf8');
  const items = parseGoalItems(goal);
  assert.equal(items.length, 7, 'şablon 5-7 evrensel teslim kapısı kurmalı');
  assert.ok(items.every((i) => !i.checked), 'şablon hiçbir sözü onaylı göstermez');
  assert.ok(items.some((i) => i.hints.testOnly), '`test:` öneki örneği olmalı');
  assert.ok(items.some((i) => i.hints.paths.length > 0), 'yol ipucu örneği olmalı');
  assert.ok(goal.includes('kendi sözlerini yaz'), 'kullanıcıya sözün ONUN olduğu söylenir');

  // Yönerge satırları panonun HEDEF cümlesi yerine geçmez (alıntı ile yazılı).
  assert.equal(await readGoal(dir), null);
});

test('idempotent: ikinci init hiçbir şeyi ezmez, bölümü çiftlemez', async () => {
  const dir = await tmpProj();
  await runInit(dir);

  // kullanıcı verisi simülasyonu: goal düzenlendi
  await writeFile(join(dir, '.ocean', 'goal.md'), '# Hedef\n\nGerçek hedefim.\n', 'utf8');

  const res2 = await runInit(dir);
  assert.equal(res2.created.length, 0);
  assert.equal(res2.claudeMdUpdated, false);
  assert.ok(res2.skipped.some((s) => s.includes('state.json')));

  const goal = await readFile(join(dir, '.ocean', 'goal.md'), 'utf8');
  assert.ok(goal.includes('Gerçek hedefim.'), 'goal.md ezilmemeli');

  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  const occurrences = claudeMd.split(CLAUDE_MD_MARKER).length - 1;
  assert.equal(occurrences, 1, '## Topbeam bölümü tek olmalı');
});

test('mevcut CLAUDE.md korunur, bölüm SONUNA eklenir', async () => {
  const dir = await tmpProj();
  const mevcut = '# Benim Projem\n\nÖnemli kurallarım var.\n';
  await writeFile(join(dir, 'CLAUDE.md'), mevcut, 'utf8');

  await runInit(dir);
  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.startsWith('# Benim Projem'));
  assert.ok(claudeMd.includes('Önemli kurallarım var.'));
  assert.ok(claudeMd.includes(CLAUDE_MD_MARKER));
  assert.ok(claudeMd.indexOf(CLAUDE_MD_MARKER) > claudeMd.indexOf('Önemli kurallarım'));
});
