/** args.ts testleri — arg parsing gerçek, saf fonksiyon. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './args.ts';

test('boş argv → help komutu', () => {
  const a = parseArgs([]);
  assert.equal(a.cmd, 'help');
  assert.deepEqual(a.positional, []);
  assert.deepEqual(a.flags, {});
});

test('komut + positional', () => {
  const a = parseArgs(['verify', 'gorev-3']);
  assert.equal(a.cmd, 'verify');
  assert.deepEqual(a.positional, ['gorev-3']);
});

test('değerli flag ve boolean flag', () => {
  const a = parseArgs(['init', '--name', 'Demo Proje', '--yes']);
  assert.equal(a.cmd, 'init');
  assert.equal(a.flags.name, 'Demo Proje');
  assert.equal(a.flags.yes, true);
});

test('ardışık iki flag: ilki boolean kalır', () => {
  const a = parseArgs(['sync', '--dry-run', '--limit', '5']);
  assert.equal(a.flags['dry-run'], true);
  assert.equal(a.flags.limit, '5');
});

test('ilk öğe flag ise komut sayılmaz (topbeam --version)', () => {
  const a = parseArgs(['--version']);
  assert.equal(a.cmd, 'help');
  assert.equal(a.flags.version, true);
  assert.deepEqual(a.positional, []);
});

test('flag sonrası positional karışık sırada toplanır', () => {
  const a = parseArgs(['verify', '--by', 'ekin', 'gorev-7']);
  assert.deepEqual(a.positional, ['gorev-7']);
  assert.equal(a.flags.by, 'ekin');
});
