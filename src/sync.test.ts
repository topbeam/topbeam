/**
 * sync.ts entegrasyon testleri — mkdtemp'te sahte claudeDir (OCEAN_CLAUDE_DIR)
 * + gerçek izole git repo. Gerçek ~/.claude'a ve bu repoya sıfır dokunuş.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugifyCwd } from './collect/claude.ts';
import { runInit } from './init.ts';
import { runSync, mergeClaims } from './sync.ts';
import { buildPassport } from './passport.ts';
import { readState } from './state.ts';
import type { Claim } from './types.ts';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const S1 = 'sess-sync-1';
const j = (o: unknown): string => JSON.stringify(o);

/** İzole proje: git repo + sahte transcript (Edit ok + npm test TAP 19 pass). */
async function makeProject(): Promise<{ proj: string; claudeDir: string }> {
  // realpath ŞART: macOS'ta /var → /private/var; git root gerçek yolu döner,
  // transcript yollarıyla kesişim ancak aynı gerçek yolla kurulunca oluşur.
  const proj = await realpath(await mkdtemp(join(tmpdir(), 'ocean-sync-proj-')));
  const claudeDir = await mkdtemp(join(tmpdir(), 'ocean-sync-claude-'));

  execFileSync('git', ['init', '-q'], { cwd: proj });
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(join(proj, 'src', 'login.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(
    join(proj, 'package.json'),
    j({ name: 'deneme', scripts: { test: 'node --test' } }),
    'utf8',
  );
  // stage: `status --porcelain` untracked DİZİNİ tek satıra indirger (`?? src/`);
  // dosya-düzeyi kesişim için dosyaların status'ta tek tek görünmesi gerekir.
  execFileSync('git', ['add', '-A'], { cwd: proj });

  const slugDir = join(claudeDir, 'projects', slugifyCwd(proj));
  await mkdir(slugDir, { recursive: true });
  const lines = [
    j({
      type: 'user', userType: 'external', cwd: proj, sessionId: S1, uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: 'Login formu ekle' },
    }),
    j({
      type: 'assistant', cwd: proj, sessionId: S1, uuid: 'a1', timestamp: '2026-07-28T10:01:00.000Z',
      message: {
        id: 'm1', role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: join(proj, 'src', 'login.ts'), old_string: 'a', new_string: 'b' } }],
      },
    }),
    j({
      type: 'user', cwd: proj, sessionId: S1, uuid: 'u2', timestamp: '2026-07-28T10:01:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
      toolUseResult: {
        filePath: join(proj, 'src', 'login.ts'),
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
        userModified: false,
      },
    }),
    j({
      type: 'assistant', cwd: proj, sessionId: S1, uuid: 'a2', timestamp: '2026-07-28T10:02:00.000Z',
      message: {
        id: 'm2', role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Testleri çalıştır' } }],
      },
    }),
    j({
      type: 'user', cwd: proj, sessionId: S1, uuid: 'u3', timestamp: '2026-07-28T10:02:30.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: false, content: 'tap' }] },
      toolUseResult: { stdout: 'TAP version 13\n# tests 19\n# pass 19\n# fail 0\n', stderr: '', interrupted: false },
    }),
  ];
  await writeFile(join(slugDir, `${S1}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
  return { proj, claudeDir };
}

function withClaudeDir<T>(claudeDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OCEAN_CLAUDE_DIR;
  process.env.OCEAN_CLAUDE_DIR = claudeDir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.OCEAN_CLAUDE_DIR;
    else process.env.OCEAN_CLAUDE_DIR = prev;
  });
}

test('sync init olmadan dürüstçe reddeder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-sync-bos-'));
  const res = await runSync(dir);
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('ocean init'));
});

test('tam boru hattı: collect → truth → card → state + pano', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.ok, true);
  assert.ok(res.state);
  const st = res.state;

  // claim'ler: dosya-kaniti (transcript ∩ git untracked) + test-kaniti (TAP okundu)
  const dosya = st.claims.find((c) => c.id === `dosya-git-${S1}`);
  assert.ok(dosya, 'dosya-kaniti claim üretilmeli');
  assert.equal(dosya.level, 'dosya-kaniti');
  const testC = st.claims.find((c) => c.id === `test-${S1}-0`);
  assert.ok(testC, 'test-kaniti claim üretilmeli');
  assert.equal(testC.level, 'test-kaniti');

  // pasaport: iki claim TEK iş biriminde (oturum) toplanır; doğrulanmamış
  // (araç "tamam" TAHMİN ETMEZ) ve id oturumdan gelir → kararlı.
  assert.equal(st.passport.length, 1);
  assert.equal(st.passport[0]?.id, `birim-${S1}`);
  assert.deepEqual([...(st.passport[0]?.claimIds ?? [])].sort(), [`dosya-git-${S1}`, `test-${S1}-0`]);
  assert.ok(st.passport.every((p) => p.status === 'not_verified'));

  // kart: doğrulanmamış yok → kanıtlı-en-yeni için insan onayı istenir
  assert.ok(st.card);
  assert.ok([`dosya-git-${S1}`, `test-${S1}-0`].includes(st.card.id));
  assert.equal(st.card.action.command, `ocean verify ${st.card.id}`);

  // log: kanıtlı gerçekler + beyan (rozetli) — init izi de korunur
  assert.ok(st.log.some((e) => e.source === 'claude-beyan' && e.text.startsWith('Beyan:')));
  assert.ok(st.log.some((e) => e.source === 'ocean' && e.text.includes('init')));

  // pano dosyası yazıldı ve kartı içeriyor
  assert.ok(res.panoPath);
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(res.panoPath, 'utf8');
  assert.ok(html.includes('Sıradaki tek hareket'));
  assert.ok(html.includes(`ocean verify ${st.card.id}`));
});

test('notes.md satırları log\'a beyan olarak girer', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await writeFile(
    join(proj, '.ocean', 'notes.md'),
    '# Ocean Notları\n\n- 2026-07-28 10:05 — login formu iskeleti kuruldu\n',
    'utf8',
  );
  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.ok(res.state?.log.some((e) => e.text === 'login formu iskeleti kuruldu' && e.source === 'claude-beyan'));
});

test('ikinci sync deterministik ve tekrarsız (log şişmez, claim çiftlenmez)', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  const r1 = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  const r2 = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(r1.state?.claims.length, r2.state?.claims.length);
  assert.equal(r1.state?.log.length, r2.state?.log.length);
  assert.deepEqual(r1.state?.claims, r2.state?.claims);
});

test('mergeClaims: insan onayı sync ile ASLA geri alınmaz', () => {
  const approved: Claim = {
    id: 'dosya-git-s', text: 'x', level: 'insan-onayi',
    evidence: [{ kind: 'human', summary: 'ekin doğruladı' }], createdAt: '2026-07-28T10:00:00Z',
  };
  const fresh: Claim = {
    id: 'dosya-git-s', text: 'x', level: 'dosya-kaniti',
    evidence: [{ kind: 'git-diff', summary: 'git kaydı' }], createdAt: '2026-07-28T11:00:00Z',
  };
  const { merged } = mergeClaims([approved], [fresh]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.level, 'insan-onayi');
});

test('mergeClaims: yeniden üretilmeyen kanıtsız eski claim düşer (sayılır)', () => {
  const stale: Claim = {
    id: 'dosya-transcript-eski', text: 'y', level: 'dogrulanmadi',
    evidence: [{ kind: 'transcript-tool-use', summary: 't' }], createdAt: '2026-07-01T10:00:00Z',
  };
  const { merged, droppedStale } = mergeClaims([stale], []);
  assert.equal(merged.length, 0);
  assert.equal(droppedStale, 1);
});

test('buildPassport: insan kararı korunur ama seviye claim\'in GERÇEĞİNİ söyler', () => {
  const verified = {
    id: 'a', title: 'A', status: 'completed' as const, claimIds: ['a'],
    level: 'insan-onayi' as const,
    verification: { by: 'ekin', at: '2026-07-28T10:00:00Z', decision: 'approved' as const },
  };
  // Aynı id'li claim artık doğrulanmamış seviyede (transcript değişti):
  // eski onay kaydı DURUR, ama madde "tamam" gibi gösterilmez.
  const freshClaim: Claim = {
    id: 'a', text: 'A yeni metin', level: 'dogrulanmadi',
    evidence: [{ kind: 'transcript-tool-use', summary: 't' }], createdAt: '2026-07-28T11:00:00Z',
  };
  const out = buildPassport([verified], [freshClaim]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.verification?.by, 'ekin'); // insan kararı kaybolmadı
  assert.equal(out[0]?.status, 'partial'); // ama completed diye yalan söylenmiyor
  assert.equal(out[0]?.level, 'dogrulanmadi');
});

test('sync: pasaport claim başına DEĞİL oturum başına dolar (iki oturum → iki madde)', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  // ikinci oturum: aynı projede ayrı transcript
  const S2 = 'sess-sync-2';
  const slugDir = join(claudeDir, 'projects', slugifyCwd(proj));
  const lines = [
    j({
      type: 'user', cwd: proj, sessionId: S2, uuid: 'v1', timestamp: '2026-07-28T13:00:00.000Z',
      message: { role: 'user', content: 'Bir şey daha yap' },
    }),
    j({
      type: 'assistant', cwd: proj, sessionId: S2, uuid: 'b1', timestamp: '2026-07-28T13:01:00.000Z',
      message: {
        id: 'm3', role: 'assistant',
        content: [{ type: 'tool_use', id: 't9', name: 'Write', input: { file_path: join(proj, 'src', 'yeni.ts') } }],
      },
    }),
    j({
      type: 'user', cwd: proj, sessionId: S2, uuid: 'v2', timestamp: '2026-07-28T13:01:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', is_error: false, content: 'ok' }] },
      toolUseResult: { filePath: join(proj, 'src', 'yeni.ts'), structuredPatch: [], userModified: false },
    }),
  ];
  await writeFile(join(slugDir, `${S2}.jsonl`), `${lines.join('\n')}\n`, 'utf8');

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  const ids = res.state?.passport.map((p) => p.id) ?? [];
  assert.deepEqual([...ids].sort(), [`birim-${S1}`, `birim-${S2}`]);
  assert.ok((res.state?.claims.length ?? 0) > ids.length, 'claim sayısı madde sayısından fazla olmalı');
});

test('git deposu OLMAYAN proje: kart "git status" ÖNERMEZ', async () => {
  const proj = await realpath(await mkdtemp(join(tmpdir(), 'ocean-nogit-')));
  const claudeDir = await mkdtemp(join(tmpdir(), 'ocean-nogit-claude-'));
  await mkdir(join(proj, 'src'), { recursive: true });
  await writeFile(join(proj, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8'); // package.json YOK

  const slugDir = join(claudeDir, 'projects', slugifyCwd(proj));
  await mkdir(slugDir, { recursive: true });
  const sid = 'sess-nogit';
  const lines = [
    j({
      type: 'user', cwd: proj, sessionId: sid, uuid: 'u1', timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: 'dosyayı yaz' },
    }),
    j({
      type: 'assistant', cwd: proj, sessionId: sid, uuid: 'a1', timestamp: '2026-07-28T10:01:00.000Z',
      message: {
        id: 'm1', role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(proj, 'src', 'a.ts') } }],
      },
    }),
    j({
      type: 'user', cwd: proj, sessionId: sid, uuid: 'u2', timestamp: '2026-07-28T10:01:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
      toolUseResult: { filePath: join(proj, 'src', 'a.ts'), structuredPatch: [], userModified: false },
    }),
  ];
  await writeFile(join(slugDir, `${sid}.jsonl`), `${lines.join('\n')}\n`, 'utf8');

  await runInit(proj, { now: NOW });
  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  const card = res.state?.card;
  assert.ok(card);
  assert.notEqual(card.action.command, 'git status', 'çalışmayacak komut önerilemez');
  assert.equal(card.action.command, `ocean verify ${card.id}`);
  assert.ok(card.action.verb.includes('git deposu değil'));
  assert.ok(card.fact.includes('git deposu değil'));
});
