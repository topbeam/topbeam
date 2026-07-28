/**
 * cli.ts duman testleri — gerçek subprocess ile (Node 24 TS type-stripping).
 * Gerçek dosya sistemine yazmaz; stub komutlar yalnız stdout üretir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), 'cli.ts');

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('--version sürümü yazdırır, exit 0', () => {
  const r = run(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^ocean v\d+\.\d+\.\d+/);
});

test('help komutları listeler, exit 0', () => {
  const r = run(['help']);
  assert.equal(r.code, 0);
  for (const cmd of ['init', 'sync', 'verify', 'open']) {
    assert.ok(r.stdout.includes(cmd), `help '${cmd}' içermeli`);
  }
});

test('stub komutlar dürüst "henüz yok" der, exit 0', () => {
  for (const cmd of ['init', 'sync', 'open']) {
    const r = run([cmd]);
    assert.equal(r.code, 0, `${cmd} exit 0 olmalı`);
    assert.match(r.stdout, /henüz yok/, `${cmd} 'henüz yok' demeli`);
  }
});

test('verify id ister: idsiz exit 1, idli stub exit 0', () => {
  const noId = run(['verify']);
  assert.equal(noId.code, 1);
  assert.match(noId.stderr, /Kullanım: ocean verify/);

  const withId = run(['verify', 'gorev-3']);
  assert.equal(withId.code, 0);
  assert.match(withId.stdout, /gorev-3.*henüz yok/);
});

test('bilinmeyen komut exit 1 + yardım', () => {
  const r = run(['floo']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Bilinmeyen komut: floo/);
});
