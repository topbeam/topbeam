/**
 * cli.ts duman testleri — gerçek subprocess (Node 24 TS type-stripping).
 * TÜM komutlar mkdtemp izole dizinlerde koşar: gerçek repoya/.claude'a/
 * bildirimlere sıfır dokunuş (OCEAN_CLAUDE_DIR sahte + OCEAN_NO_NOTIFY=1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), 'cli.ts');

interface RunOpts {
  cwd?: string;
  input?: string;
}

function run(args: string[], opts: RunOpts = {}): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      cwd: opts.cwd,
      input: opts.input,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        OCEAN_CLAUDE_DIR: join(tmpdir(), 'ocean-cli-test-bos-claude'),
        OCEAN_NO_NOTIFY: '1',
      },
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

test('help komutları ve dürüstlük ilkesini listeler, exit 0', () => {
  const r = run(['help']);
  assert.equal(r.code, 0);
  for (const cmd of ['init', 'sync', 'verify', 'open']) {
    assert.ok(r.stdout.includes(cmd), `help '${cmd}' içermeli`);
  }
  assert.ok(r.stdout.includes('kanıtsız hiçbir iddia'), 'ilke help içinde olmalı');
});

test('bilinmeyen komut exit 1 + yardım', () => {
  const r = run(['floo']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Bilinmeyen komut: floo/);
});

test('verify id ister: idsiz exit 1', () => {
  const r = run(['verify']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Kullanım: ocean verify/);
});

test('sync init olmadan dürüstçe reddeder, exit 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-nosync-'));
  const r = run(['sync'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ocean init/);
});

test('open pano yokken dürüstçe reddeder, exit 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-noopen-'));
  const r = run(['open'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ocean sync/);
});

test('tam akış: init → sync → open (izole dizin, transcript yok senaryosu)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-akis-'));

  const init = run(['init'], { cwd: dir });
  assert.equal(init.code, 0, init.stderr);
  assert.ok(init.stdout.includes('Ocean bağlandı'));
  assert.ok(init.stdout.includes('.ocean/state.json'));
  await access(join(dir, '.ocean', 'state.json'));
  await access(join(dir, '.ocean', 'goal.md'));
  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.includes('## Ocean'));

  // ikinci init: idempotent
  const init2 = run(['init'], { cwd: dir });
  assert.equal(init2.code, 0);
  assert.ok(init2.stdout.includes('dokunulmadı'));

  const sync = run(['sync'], { cwd: dir });
  assert.equal(sync.code, 0, sync.stderr);
  assert.ok(sync.stdout.includes('Ocean senkron tamam'));
  assert.ok(sync.stdout.includes('Pano'));
  await access(join(dir, '.ocean', 'pano.html'));

  const open = run(['open'], { cwd: dir });
  assert.equal(open.code, 0);
  assert.ok(open.stdout.includes('pano.html'));
  assert.ok(open.stdout.includes('otomatik açmaz') || open.stdout.includes('otomatik AÇMAZ'));

  // pano dürüst boş kart göstermeli (transcript yok — iddia uydurulmadı)
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('Henüz kanıtlı iş kaydı yok'));
});

test('verify: olmayan id ile exit 1 + dürüst mesaj (subprocess)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-verify-'));
  run(['init'], { cwd: dir });
  const r = run(['verify', 'gorev-3'], { cwd: dir, input: 'h\n' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Claim bulunamadı: gorev-3/);
});

test('verify subprocess: piped onay (e) çalışır — readline pipe bug kilidi', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-verify-e-'));
  const { newOceanState } = await import('./types.ts');
  const { writeState, readState } = await import('./state.ts');
  const st = newOceanState('CliVerify', new Date('2026-07-28T10:00:00Z'));
  st.claims = [
    {
      id: 'dosya-git-s9',
      text: '1 dosya değişti: src/x.ts',
      level: 'dosya-kaniti',
      evidence: [{ kind: 'git-diff', summary: 'git kaydı var.' }],
      createdAt: '2026-07-28T09:00:00Z',
    },
  ];
  await writeState(dir, st);

  const r = run(['verify', 'dosya-git-s9', '--by', 'test-kullanici'], { cwd: dir, input: 'e\n' });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('Onay kaydedildi'));

  const back = await readState(dir);
  assert.equal(back?.claims[0]?.level, 'insan-onayi');
});

test('verify subprocess: girdi kapalıysa (cevapsız) onay YOK — dürüst varsayılan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-cli-verify-h-'));
  const { newOceanState } = await import('./types.ts');
  const { writeState, readState } = await import('./state.ts');
  const st = newOceanState('CliVerify2', new Date('2026-07-28T10:00:00Z'));
  st.claims = [
    {
      id: 'test-s9-0',
      text: '3 test geçti.',
      level: 'test-kaniti',
      evidence: [{ kind: 'test-output', summary: '# pass 3' }],
      createdAt: '2026-07-28T09:00:00Z',
    },
  ];
  await writeState(dir, st);

  const r = run(['verify', 'test-s9-0'], { cwd: dir, input: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('Onay kaydedilmedi'));
  const back = await readState(dir);
  assert.equal(back?.claims[0]?.level, 'test-kaniti'); // seviye değişmedi
});
