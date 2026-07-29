/** state.ts testleri — mkdtemp izolasyonu; gerçek projeye sıfır dokunuş. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newOceanState } from './types.ts';
import { claimOnayli } from './ledger.ts';
import {
  appendPassportLog,
  goalPath,
  GuvenliYazmaHatasi,
  panoPath,
  writePano,
  oceanDir,
  parseNotes,
  passportLogPath,
  readGoal,
  readGoalItems,
  readLedger,
  readNotes,
  readPassportLog,
  readState,
  statePath,
  writeState,
} from './state.ts';

async function tmpProj(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'topbeam-state-'));
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
    '# Topbeam Notları',
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

  await writeFile(goalPath(dir), '# Proje Hedefi\n\nTopbeam MVP dikey dilimini bitir.\n', 'utf8');
  assert.equal(await readGoal(dir), 'Topbeam MVP dikey dilimini bitir.');

  const yok = await mkdtemp(join(tmpdir(), 'topbeam-goal-yok-'));
  assert.equal(await readGoal(yok), null);
});

test('readGoal: TESLİM SÖZÜ satırı hedef cümlesi sanılmaz (liste ve alıntı atlanır)', async () => {
  const dir = await tmpProj();
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(
    goalPath(dir),
    '# Proje Hedefi\n\n> yönerge\n\n- [ ] Kurulum tek komutla çalışıyor\n* [x] başka söz\n',
    'utf8',
  );
  assert.equal(await readGoal(dir), null, 'hedef paragrafı yoksa uydurulmaz');

  await writeFile(
    goalPath(dir),
    '# Proje Hedefi\n\nGerçek hedef cümlesi.\n\n- [ ] Kurulum çalışıyor\n',
    'utf8',
  );
  assert.equal(await readGoal(dir), 'Gerçek hedef cümlesi.');
});

test('readGoalItems: `- [ ]` satırlarını verir; dosya yoksa boş liste (bar yok)', async () => {
  const dir = await tmpProj();
  assert.deepEqual(await readGoalItems(dir), [], 'dosya yoksa sayı uydurulmaz');

  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(goalPath(dir), '# Hedef\n\nParagraf.\n\n- [ ] bir\n- [x] iki\n', 'utf8');
  const items = await readGoalItems(dir);
  assert.deepEqual(items.map((i) => i.text), ['bir', 'iki']);
  assert.equal(items[1]?.checked, true);
});

test('readNotes: dosya yoksa boş liste', async () => {
  const dir = await tmpProj();
  assert.deepEqual(await readNotes(dir, '2026-07-28T00:00:00Z'), []);
});

// ── doğrulama defteri (diskten) ─────────────────────────────────────────────

test('readLedger: dosya yoksa BOŞ defter — "bilinmiyor" değil, "onay yok" (fail-closed)', async () => {
  const dir = await tmpProj();
  const d = await readLedger(dir);
  assert.equal(d.dosyaVar, false);
  assert.equal(d.gecerli.size, 0);
  assert.equal(claimOnayli(d, 'her-hangi'), false);
});

test('readLedger: gerçek satırlar rozet verir, kanalsız/bozuk satırlar VERMEZ (silinmeden)', async () => {
  const dir = await tmpProj();
  const base = { schema_version: 1, decision: 'approved' as const, by: 'ekin', levelBefore: 'test-kaniti', levelAfter: 'insan-onayi' };
  // 1) gerçek terminal onayı
  await appendPassportLog(dir, { ...base, at: '2026-07-28T10:00:00Z', claimId: 'gercek-1', title: 'A', source: 'terminal' });
  // 2) kanal kaydı olmayan eski satır (kapı kodlanmadan önce yazılmış)
  await appendPassportLog(dir, { ...base, at: '2026-07-28T10:05:00Z', claimId: 'kanalsiz-1', title: 'B' });
  // 3) elle eklenmiş bozuk satır
  await appendFile(passportLogPath(dir), 'bu json degil\n', 'utf8');

  const d = await readLedger(dir);
  assert.equal(d.dosyaVar, true);
  assert.equal(claimOnayli(d, 'gercek-1'), true);
  assert.equal(claimOnayli(d, 'kanalsiz-1'), false);
  assert.ok(d.gecersiz.get('kanalsiz-1')?.includes('kanal'), 'dürüst gerekçe kalmalı');
  assert.equal(d.reddedilenSatir, 1, 'bozuk satır sayılır (sessizce yok sayılmaz)');
  assert.equal(d.okunanSatir, 2, 'ayrıştırılabilen satır sayısı');
});

test('readPassportLog: şekil VARSAYILMAZ — bozuk satır atlanır ve sayılır', async () => {
  const dir = await tmpProj();
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(passportLogPath(dir), '{"claimId":"a"}\n{bozuk\n\n[1,2]\n', 'utf8');
  const { records, dosyaVar, atlanan } = await readPassportLog(dir);
  assert.equal(dosyaVar, true);
  assert.equal(atlanan, 1);
  assert.equal(records.length, 2); // nesne + dizi (şekil DOĞRULAMASI ledger'ın işi)
});

// ── SYMLINK KORUMASI (2026-07-29 sertleştirme saldırısı) ────────────────────
//
// Ölçülmüş sömürü: `.ocean/pano.html` symlink olduğunda sync hedefteki dosyayı
// EZİYORDU (kurban.txt 33 → 14205 bayt). Symlink'ler git'te taşındığı için
// "depoyu klonla + topbeam çalıştır" yetiyordu. O_NOFOLLOW ile kapatıldı.

test('GÜVENLİK: symlink üzerinden YAZILMAZ — hedef dosya dokunulmaz', async () => {
  const { symlink, writeFile: wf, readFile: rf, mkdir: mk } = await import('node:fs/promises');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const kok = await mkdtemp(j(tmpdir(), 'topbeam-symlink-'));
  const proj = j(kok, 'proj');
  await mk(j(proj, '.ocean'), { recursive: true });
  const kurban = j(kok, 'kurban.txt');
  await wf(kurban, 'DEĞERLİ VERİ', 'utf8');

  await symlink(kurban, panoPath(proj));

  await assert.rejects(
    () => writePano(proj, '<html>ezmeye çalışıyorum</html>'),
    (e: unknown) => e instanceof GuvenliYazmaHatasi && e.sebep === 'symlink',
    'symlink üzerinden yazma REDDEDİLMELİ',
  );
  assert.equal(await rf(kurban, 'utf8'), 'DEĞERLİ VERİ', 'kurban dosyası bozulmamalı');
});

test('GÜVENLİK: .ocean DİZİNİ proje dışına symlink ise hiçbir şey yazılmaz', async () => {
  const { symlink, mkdir: mk, readdir, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const kok = await mkdtemp(j(tmpdir(), 'topbeam-dirlink-'));
  const proj = j(kok, 'proj');
  const disari = j(kok, 'disari');
  await mk(proj, { recursive: true });
  await mk(disari, { recursive: true });
  await symlink(disari, j(proj, '.ocean'));

  await assert.rejects(
    () => writePano(proj, '<html>dışarı sızıyorum</html>'),
    (e: unknown) => e instanceof GuvenliYazmaHatasi && e.sebep === 'disari-cikiyor',
    'proje kökü dışına yazma REDDEDİLMELİ',
  );
  assert.deepEqual(await readdir(disari), [], 'dışarıya hiçbir dosya yazılmamalı');
});
