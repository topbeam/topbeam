/** state.ts testleri — mkdtemp izolasyonu; gerçek projeye sıfır dokunuş. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newOceanState } from './types.ts';
import {
  appendPassportLog,
  goalPath,
  oceanDir,
  parseNotes,
  passportLogPath,
  readGoal,
  readNotes,
  readState,
  statePath,
  writeState,
} from './state.ts';

async function tmpProj(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ocean-state-'));
}

test('readState: dosya yoksa null (fırlatmaz)', async () => {
  const dir = await tmpProj();
  assert.equal(await readState(dir), null);
});

test('readState: bozuk JSON → null (uydurma kurtarma yok)', async () => {
  const dir = await tmpProj();
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(statePath(dir), '{bozuk', 'utf8');
  assert.equal(await readState(dir), null);
});

test('writeState/readState gidiş-dönüş + secret diske MASKELİ yazılır', async () => {
  const dir = await tmpProj();
  const state = newOceanState('Deneme', new Date('2026-07-28T10:00:00Z'));
  state.claims.push({
    id: 'test-abc-0',
    text: '19 test geçti, 0 başarısız (npm test).',
    level: 'test-kaniti',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: 'ok', ref: 'API_TOKEN=gizli12345 npm test' }],
    createdAt: '2026-07-28T10:00:00Z',
  });
  const { hits } = await writeState(dir, state);
  assert.ok(hits >= 1, 'secret maskelenmeliydi');

  const raw = await readFile(statePath(dir), 'utf8');
  assert.equal(raw.includes('gizli12345'), false, 'ham secret diskte olmamalı');
  assert.ok(raw.includes('MASKED'));

  const back = await readState(dir);
  assert.ok(back);
  assert.equal(back.projectName, 'Deneme');
  assert.equal(back.claims[0]?.id, 'test-abc-0');
  assert.equal(back.claims[0]?.level, 'test-kaniti');
});

test('appendPassportLog: append-only JSONL, iki kayıt iki satır', async () => {
  const dir = await tmpProj();
  const base = {
    schema_version: 1,
    decision: 'approved' as const,
    by: 'ekin',
    levelBefore: 'dosya-kaniti',
    levelAfter: 'insan-onayi',
  };
  await appendPassportLog(dir, { ...base, at: '2026-07-28T10:00:00Z', claimId: 'a', title: 'A işi' });
  await appendPassportLog(dir, { ...base, at: '2026-07-28T11:00:00Z', claimId: 'b', title: 'B işi' });
  const raw = await readFile(passportLogPath(dir), 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0] ?? '') as { claimId: string };
  const second = JSON.parse(lines[1] ?? '') as { claimId: string };
  assert.equal(first.claimId, 'a');
  assert.equal(second.claimId, 'b');
});

test('parseNotes: tarihli + tarihsiz satırlar; başlık ve yönerge atlanır', () => {
  const raw = [
    '# Ocean Notları',
    '(Claude: yönerge satırı)',
    '',
    '- 2026-07-28 14:05 — login formu eklendi',
    '- 2026-07-28T09:30 - kısa tire de olur',
    '- tarihsiz not satırı',
    'düz metin satırı (not değil)',
  ].join('\n');
  const notes = parseNotes(raw, '2026-07-28T16:00:00Z');
  assert.equal(notes.length, 3);
  assert.equal(notes[0]?.ts, '2026-07-28T14:05:00');
  assert.equal(notes[0]?.text, 'login formu eklendi');
  assert.equal(notes[1]?.text, 'kısa tire de olur');
  assert.equal(notes[2]?.ts, '2026-07-28T16:00:00Z'); // fallback — uydurma tarih yok
});

test('readGoal: şablon (başlık+yönerge) → null; gerçek hedef satırı → döner', async () => {
  const dir = await tmpProj();
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(goalPath(dir), '# Proje Hedefi\n\n(Claude: bu dosyayı güncel tut.)\n', 'utf8');
  assert.equal(await readGoal(dir), null);

  await writeFile(goalPath(dir), '# Proje Hedefi\n\nOcean MVP dikey dilimini bitir.\n', 'utf8');
  assert.equal(await readGoal(dir), 'Ocean MVP dikey dilimini bitir.');

  const yok = await mkdtemp(join(tmpdir(), 'ocean-goal-yok-'));
  assert.equal(await readGoal(yok), null);
});

test('readNotes: dosya yoksa boş liste', async () => {
  const dir = await tmpProj();
  assert.deepEqual(await readNotes(dir, '2026-07-28T00:00:00Z'), []);
});
