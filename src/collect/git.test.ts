/**
 * git.ts toplayıcı testleri — geçici dizinlerde gerçek (ama izole) git
 * repoları kurar; kullanıcının hiçbir gerçek reposuna dokunmaz.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { collectGit } from './git.ts';

function gitDo(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=test@ocean.local', '-c', 'user.name=Ocean Test', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

test('collectGit: git olmayan dizin → isGit=false, zarif boş', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-git-yok-'));
  const res = await collectGit(dir);
  assert.equal(res.gitAvailable, true);
  assert.equal(res.isGit, false);
  assert.equal(res.headHash, null);
  assert.equal(res.dirtyFiles.length, 0);
  assert.equal(res.recentCommits.length, 0);
  assert.equal(res.diffStat, null);
  assert.ok(res.notes.some((n) => n.includes('git çalışma ağacı değil')));
});

test('collectGit: commit + kirli dosyalar + numstat diff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-git-repo-'));
  gitDo(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'a.txt'), 'bir\n');
  gitDo(dir, 'add', 'a.txt');
  gitDo(dir, 'commit', '-q', '-m', 'ilk commit');
  await writeFile(join(dir, 'a.txt'), 'bir\niki\n'); // izlenen dosyada değişiklik
  await writeFile(join(dir, 'b.txt'), 'yeni\n'); // izlenmeyen dosya

  const res = await collectGit(dir);
  assert.equal(res.isGit, true);
  assert.equal(res.branch, 'main');
  assert.equal(res.headHash?.length, 40);
  assert.ok(res.headShort);
  assert.equal(res.headSubject, 'ilk commit');
  assert.ok(res.headDate); // ISO committer date
  assert.ok(res.root?.endsWith(basename(dir)));

  assert.equal(res.recentCommits.length, 1);
  assert.equal(res.recentCommits[0]?.subject, 'ilk commit');

  const modified = res.dirtyFiles.find((f) => f.path === 'a.txt');
  assert.ok(modified);
  assert.equal(modified.status, ' M');
  const untracked = res.dirtyFiles.find((f) => f.path === 'b.txt');
  assert.ok(untracked);
  assert.equal(untracked.status, '??');

  assert.ok(res.diffStat);
  assert.equal(res.diffStat.filesChanged, 1); // untracked dosya diff'e girmez (status'ta görünür)
  assert.equal(res.diffStat.insertions, 1);
  assert.equal(res.diffStat.deletions, 0);
  assert.equal(res.diffStat.files[0]?.path, 'a.txt');
  assert.equal(res.diffStat.files[0]?.added, 1);
});

test('collectGit: commit\'siz taze repo → dürüst notlar, diff null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-git-bos-'));
  gitDo(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'c.txt'), 'içerik\n');

  const res = await collectGit(dir);
  assert.equal(res.isGit, true);
  assert.equal(res.branch, 'main'); // symbolic-ref unborn branch'te de çalışır
  assert.equal(res.headHash, null);
  assert.equal(res.diffStat, null);
  assert.ok(res.notes.some((n) => n.includes('commit')));
  const untracked = res.dirtyFiles.find((f) => f.path === 'c.txt');
  assert.ok(untracked);
  assert.equal(untracked.status, '??');
});

test('collectGit: git binary\'si yoksa gitAvailable=false, fırlatmaz', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-git-binsiz-'));
  const res = await collectGit(dir, { gitBin: 'ocean-olmayan-git-binari-xyz' });
  assert.equal(res.gitAvailable, false);
  assert.equal(res.isGit, false);
  assert.ok(res.notes.some((n) => n.includes('git bulunamadı')));
});

test('collectGit: binary dosya numstat\'ta null added/removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-git-bin-'));
  gitDo(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'veri.bin'), Buffer.from([0, 1, 2, 255, 0, 7]));
  gitDo(dir, 'add', 'veri.bin');
  gitDo(dir, 'commit', '-q', '-m', 'binary ekle');
  await writeFile(join(dir, 'veri.bin'), Buffer.from([9, 8, 0, 255, 3]));

  const res = await collectGit(dir);
  assert.ok(res.diffStat);
  const bin = res.diffStat.files.find((f) => f.path === 'veri.bin');
  assert.ok(bin);
  assert.equal(bin.added, null); // '-' → null, sayı uydurulmaz
  assert.equal(bin.removed, null);
});
