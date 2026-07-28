/**
 * Release build — src/cli.ts → dist/cli.js (tek dosya, ESM, Node >= 20).
 * Runtime bağımlılık yok; node: builtinleri dışarıda kalır.
 * (BuildPassport toolchain deseni — scripts/build.mjs birebir.)
 */
import { build } from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'info',
});

chmodSync('dist/cli.js', 0o755);
console.log('build tamam: dist/cli.js');
