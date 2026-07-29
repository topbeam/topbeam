/**
 * claude.ts toplayıcı testleri — gerçek ~/.claude'a DOKUNMADAN:
 * geçici dizinde sahte claudeDir + keşif raporundaki gerçek satır şemasıyla
 * üretilmiş fixture JSONL'ler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectClaude,
  extractTestStats,
  isCheckLikeCommand,
  isTestLikeCommand,
  slugifyCwd,
  summarizeTranscript,
} from './claude.ts';

// ── fixture kurulumu (bir kez) ───────────────────────────────────────────────

const PROJ = '/Users/test/Fixture Proj'; // boşluklu yol — slug kuralını da sınar
const OTHER_CWD = '/Users/test/Baska Proje';
const S1 = 'aaaa-1111-bbbb';
const S2 = 'cccc-2222-dddd';

const j = (o: unknown): string => JSON.stringify(o);

const claudeDir = await mkdtemp(join(tmpdir(), 'topbeam-claude-fix-'));
const slugDir = join(claudeDir, 'projects', slugifyCwd(PROJ));
await mkdir(slugDir, { recursive: true });

// S1: zengin oturum — edit/write/bash/test/hata/compact/title/kesinti/bozuk satır
const s1Lines = [
  j({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-07-28T09:59:00.000Z', sessionId: S1 }),
  j({
    type: 'user', userType: 'external', cwd: PROJ, sessionId: S1, gitBranch: 'main',
    uuid: 'u1', timestamp: '2026-07-28T10:00:00.000Z',
    message: { role: 'user', content: 'Login formu ekle ve testleri koş' },
  }),
  j({
    type: 'user', isMeta: true, cwd: PROJ, sessionId: S1, uuid: 'um', timestamp: '2026-07-28T10:00:01.000Z',
    message: { role: 'user', content: '<local-command-caveat>Caveat: yerel komut' },
  }),
  // Edit tool_use (+ assistant serbest metni — özete asla girmemeli)
  j({
    type: 'assistant', cwd: PROJ, sessionId: S1, gitBranch: 'main', uuid: 'a1',
    timestamp: '2026-07-28T10:01:00.000Z', requestId: 'req_1',
    message: {
      id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: 'Bitti, çalışıyor! Harika oldu.' },
        { type: 'tool_use', id: 'toolu_edit1', name: 'Edit', input: { file_path: `${PROJ}/src/login.ts`, old_string: 'eski', new_string: 'yeni' } },
      ],
    },
  }),
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u2', timestamp: '2026-07-28T10:01:05.000Z',
    sourceToolAssistantUUID: 'a1',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit1', is_error: false, content: 'ok' }] },
    toolUseResult: {
      filePath: `${PROJ}/src/login.ts`, oldString: 'eski', newString: 'yeni',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-eski', '+yeni', '+ek satır'] }],
      userModified: false,
    },
  }),
  // Write — başarısız (is_error:true)
  j({
    type: 'assistant', cwd: PROJ, sessionId: S1, uuid: 'a2', timestamp: '2026-07-28T10:02:00.000Z',
    message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_w1', name: 'Write', input: { file_path: `${PROJ}/src/broken.ts`, content: 'x' } }] },
  }),
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u3', timestamp: '2026-07-28T10:02:05.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_w1', is_error: true, content: 'Error: dosya yazılamadı' }] },
    toolUseResult: 'Error: dosya yazılamadı',
  }),
  // Bash — npm test, obje sonuç (başarı, exit yazmaz → 0 varsayım)
  j({
    type: 'assistant', cwd: PROJ, sessionId: S1, uuid: 'a3', timestamp: '2026-07-28T10:03:00.000Z',
    message: { id: 'm3', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_b1', name: 'Bash', input: { command: 'npm test', description: 'Testleri çalıştır' } }] },
  }),
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u4', timestamp: '2026-07-28T10:03:20.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b1', is_error: false, content: 'tap' }] },
    toolUseResult: { stdout: 'TAP version 13\n# tests 19\n# pass 19\n# fail 0\n', stderr: '', interrupted: false, isImage: false },
  }),
  // Bash — build, string hata sonucu (exit code 1)
  j({
    type: 'assistant', cwd: PROJ, sessionId: S1, uuid: 'a4', timestamp: '2026-07-28T10:04:00.000Z',
    message: { id: 'm4', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_b2', name: 'Bash', input: { command: 'npm run build', description: 'Build al' } }] },
  }),
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u5', timestamp: '2026-07-28T10:04:10.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b2', is_error: true, content: 'Error: Exit code 1' }] },
    toolUseResult: 'Error: Exit code 1\nesbuild patladı',
  }),
  // kullanıcı kesintisi
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u6', timestamp: '2026-07-28T10:05:00.000Z',
    message: { role: 'user', content: '[Request interrupted by user]' },
  }),
  // ikinci gerçek prompt (dizi içerikli)
  j({
    type: 'user', cwd: PROJ, sessionId: S1, uuid: 'u7', timestamp: '2026-07-28T10:06:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Şimdi build hatasını düzelt' }] },
  }),
  // compact sınırı
  j({
    type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted',
    cwd: PROJ, sessionId: S1, uuid: 'sy1', timestamp: '2026-07-28T10:07:00.000Z',
  }),
  // başlıklar (timestamp'siz metadata satırları)
  j({ type: 'ai-title', aiTitle: 'Login işi', sessionId: S1 }),
  j({ type: 'custom-title', customTitle: 'MU PROJE', sessionId: S1 }),
  j({ type: 'last-prompt', lastPrompt: 'Şimdi build hatasını düzelt', sessionId: S1 }),
  // file-history ikincil sinyali
  j({ type: 'file-history-delta', messageId: 'm1', trackingPath: 'src/login.ts', timestamp: '2026-07-28T10:07:30.000Z' }),
  // bozuk JSON satırı — atlanıp sayılmalı
  '{bozuk json satiri',
  // son timestamp'li satır
  j({ type: 'attachment', attachment: { type: 'todo_reminder' }, cwd: PROJ, sessionId: S1, timestamp: '2026-07-28T10:10:00.000Z' }),
];
await writeFile(join(slugDir, `${S1}.jsonl`), `${s1Lines.join('\n')}\n`);

// S1 subagent'ı: başarılı Write (değişen dosyalara karışmalı, fromSubagent=true)
const subDir = join(slugDir, S1, 'subagents');
await mkdir(subDir, { recursive: true });
const subLines = [
  j({
    type: 'assistant', isSidechain: true, agentId: 'agent-x', cwd: PROJ, sessionId: S1, uuid: 'sa1',
    timestamp: '2026-07-28T10:08:00.000Z',
    message: { id: 'sm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_s1', name: 'Write', input: { file_path: `${PROJ}/src/agent-added.ts`, content: 'yeni' } }] },
  }),
  j({
    type: 'user', isSidechain: true, agentId: 'agent-x', cwd: PROJ, sessionId: S1, uuid: 'su1',
    timestamp: '2026-07-28T10:08:05.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_s1', is_error: false, content: 'ok' }] },
    toolUseResult: { type: 'create', filePath: `${PROJ}/src/agent-added.ts`, structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+yeni dosya'] }], userModified: false },
  }),
];
await writeFile(join(subDir, 'agent-abc123.jsonl'), `${subLines.join('\n')}\n`);

// S2: erken tarihli, farklı cwd (mismatch) + sonucu hiç görülmeyen Edit
const s2Lines = [
  j({
    type: 'user', userType: 'external', cwd: OTHER_CWD, sessionId: S2, gitBranch: 'HEAD',
    uuid: 'x1', timestamp: '2026-07-27T09:00:00.000Z',
    message: { role: 'user', content: 'Eski oturum hedefi' },
  }),
  j({
    type: 'assistant', cwd: OTHER_CWD, sessionId: S2, uuid: 'xa1', timestamp: '2026-07-27T09:01:00.000Z',
    message: { id: 'xm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_yalniz', name: 'Edit', input: { file_path: `${OTHER_CWD}/x.ts`, old_string: 'a', new_string: 'b' } }] },
  }),
];
await writeFile(join(slugDir, `${S2}.jsonl`), `${s2Lines.join('\n')}\n`);

// Boş slug dizinli ikinci proje (retention senaryosu)
const EMPTY_PROJ = '/Users/test/Bos Proje';
await mkdir(join(claudeDir, 'projects', slugifyCwd(EMPTY_PROJ)), { recursive: true });

// ── birim testler ────────────────────────────────────────────────────────────

test('slugifyCwd: / ve boşluk - olur (keşif kuralı)', () => {
  assert.equal(slugifyCwd('/Users/test/Fixture Proj'), '-Users-test-Fixture-Proj');
  assert.equal(slugifyCwd('/Users/dev/Desktop/Benim Proje'), '-Users-dev-Desktop-Benim-Proje');
});

test('isTestLikeCommand: test komutlarını tanır, sıradan komutu tanımaz', () => {
  assert.equal(isTestLikeCommand('npm test'), true);
  assert.equal(isTestLikeCommand('npm run test:unit -- --watch=false'), true);
  assert.equal(isTestLikeCommand('npx vitest run'), true);
  assert.equal(isTestLikeCommand('pytest -q tests/'), true);
  assert.equal(isTestLikeCommand('node --test "src/**/*.test.ts"'), true);
  assert.equal(isTestLikeCommand('ls -la && cat dosya.txt'), false);
  assert.equal(isTestLikeCommand('npm run build'), false);
  // Yol/argüman içinde geçen ad test koşumu DEĞİL (dogfood'da çıkan gerçek
  // yanlış pozitifler — ikisi de kartın tepesine "kırık test" diye çıkmıştı).
  assert.equal(isTestLikeCommand('CHROME="$HOME/Library/Caches/ms-playwright/chromium/chrome" "$CHROME" --headless'), false);
  assert.equal(isTestLikeCommand('ls /Applications/ | grep -iE "chrome|chromium|edge|brave"'), false);
  assert.equal(isTestLikeCommand('cat notes/jest-notlari.md'), false);
  assert.equal(isTestLikeCommand('rm -rf node_modules/.vitest-cache'), false);
  // Gerçek çağrılar tanınmaya devam eder: zincir, env, çalıştırıcı, yol öneki.
  assert.equal(isTestLikeCommand('./node_modules/.bin/jest --ci'), true);
  assert.equal(isTestLikeCommand('cd ~/proje && npm test 2>&1 | tail -3'), true);
  assert.equal(isTestLikeCommand('CI=1 npx vitest run'), true);
  assert.equal(isTestLikeCommand('python -m pytest tests/'), true);
});

test('isCheckLikeCommand: tsc/eslint TEST DEĞİL, kontrol komutu (sayı üretmez)', () => {
  // Dogfood gürültüsünün kaynağı: bunlar "test" sayılıp her koşumda
  // "sonuç okunamadı — doğrulanmadı" claim'i doğuruyordu (200+ satır).
  assert.equal(isTestLikeCommand('npx tsc --noEmit'), false);
  assert.equal(isCheckLikeCommand('npx tsc --noEmit'), true);
  assert.equal(isTestLikeCommand('eslint src --max-warnings 0'), false);
  assert.equal(isCheckLikeCommand('eslint src --max-warnings 0'), true);
  assert.equal(isCheckLikeCommand('npm run typecheck'), true);
  assert.equal(isCheckLikeCommand('npm run lint'), true);
  assert.equal(isCheckLikeCommand('prettier --write .'), true);
  // Kontrol DEĞİL: gerçek test koşumu ve sıradan komutlar
  assert.equal(isCheckLikeCommand('npm test'), false);
  assert.equal(isCheckLikeCommand('cat tsconfig.json'), false);
  assert.equal(isCheckLikeCommand('git status'), false);
  // Zincirde ikisi birden: test sınıfı kaybolmaz
  assert.equal(isTestLikeCommand('npm test && npx tsc --noEmit'), true);
});

test('extractTestStats: TAP / jest / pytest desenleri; bulunamazsa null (uydurma yok)', () => {
  const tap = extractTestStats('TAP version 13\n# tests 19\n# pass 19\n# fail 0\n');
  assert.equal(tap.passed, 19);
  assert.equal(tap.failed, 0);
  assert.ok(tap.summaryLine !== null);

  const jest = extractTestStats('Tests:       2 failed, 5 passed, 7 total\nTime: 3s\n');
  assert.equal(jest.passed, 5);
  assert.equal(jest.failed, 2);

  const py = extractTestStats('==================== 3 passed in 0.12s ====================\n');
  assert.equal(py.passed, 3);
  assert.equal(py.failed, null);

  const none = extractTestStats('sadece derleme çıktısı, sonuç satırı yok');
  assert.equal(none.passed, null);
  assert.equal(none.failed, null);
  assert.equal(none.summaryLine, null);
});

test('extractTestStats: node:test spec reporter (ℹ pass N) — gerçek transcript formatı', () => {
  // Dogfood 2026-07-28: gerçek ~/.claude transcript'lerinde node:test çıktısı TAP değil
  // spec reporter formatında yakalanıyor ("ℹ pass 113"); bu desen okunmazsa
  // GERÇEK yeşil koşumlar haksız yere 'dogrulanmadi'ye düşüyordu.
  const spec = extractTestStats(
    '✔ onay (e): insan-onayı + pasaport completed (5.08ms)\nℹ tests 113\nℹ suites 0\nℹ pass 113\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 3827.58\n',
  );
  assert.equal(spec.passed, 113);
  assert.equal(spec.failed, 0);
  assert.ok(spec.summaryLine !== null && /ℹ (pass|fail)/.test(spec.summaryLine));

  const specFail = extractTestStats('✖ test (29.9ms)\nℹ tests 1\nℹ suites 0\nℹ pass 0\nℹ fail 1\n');
  assert.equal(specFail.passed, 0);
  assert.equal(specFail.failed, 1);

  // "ℹ tests 113" satırındaki sayı pass sayısı DEĞİL — karışmamalı.
  const onlyTests = extractTestStats('ℹ tests 5\nℹ duration_ms 12\n');
  assert.equal(onlyTests.passed, null);
  assert.equal(onlyTests.failed, null);
});

// ── entegrasyon: collectClaude fixture'ları ──────────────────────────────────

test('collectClaude: oturumları bulur, kronolojik sıralar, cwd uyuşmazlığını işaretler', async () => {
  const res = await collectClaude(PROJ, { claudeDir });
  assert.equal(res.transcriptsFound, 2);
  assert.equal(res.sessions.length, 2);
  assert.deepEqual(res.matchedDirs, [slugifyCwd(PROJ)]);
  // S2 daha erken → önce gelir
  assert.equal(res.sessions[0]?.sessionId, S2);
  assert.equal(res.sessions[1]?.sessionId, S1);
  // S2 farklı cwd → dürüst bayrak
  assert.equal(res.sessions[0]?.cwdMismatch, true);
  assert.equal(res.sessions[1]?.cwdMismatch, false);
});

test('collectClaude S1: zaman aralığı, başlık, hedefler, kesinti, compact, parse hatası', async () => {
  const res = await collectClaude(PROJ, { claudeDir });
  const s1 = res.sessions.find((s) => s.sessionId === S1);
  assert.ok(s1);
  assert.equal(s1.firstTs, '2026-07-28T09:59:00.000Z'); // queue-operation dahil
  assert.equal(s1.lastTs, '2026-07-28T10:10:00.000Z'); // attachment dahil
  assert.equal(s1.title, 'MU PROJE'); // custom-title > ai-title
  assert.equal(s1.cwd, PROJ);
  assert.equal(s1.gitBranch, 'main');
  assert.equal(s1.userPromptCount, 2); // meta + kesinti + tool_result taşıyıcıları SAYILMAZ
  assert.equal(s1.userGoals[0], 'Login formu ekle ve testleri koş');
  assert.equal(s1.userGoals[1], 'Şimdi build hatasını düzelt');
  assert.equal(s1.interruptedCount, 1);
  assert.equal(s1.compacted, true);
  assert.equal(s1.parseErrors, 1); // bozuk JSON satırı sayıldı, çökmedi
  assert.equal(s1.subagentFiles, 1);
  assert.ok(s1.fileHistoryPaths.includes('src/login.ts'));
});

test('collectClaude S1: değişen dosyalar — başarı/başarısız/subagent ayrımı + satır sayıları', async () => {
  const res = await collectClaude(PROJ, { claudeDir });
  const s1 = res.sessions.find((s) => s.sessionId === S1);
  assert.ok(s1);

  const login = s1.changedFiles.find((f) => f.path === `${PROJ}/src/login.ts`);
  assert.ok(login);
  assert.equal(login.edits, 1);
  assert.equal(login.failedEdits, 0);
  assert.equal(login.addedLines, 2);
  assert.equal(login.removedLines, 1);
  assert.equal(login.fromSubagent, false);
  assert.deepEqual(login.tools, ['Edit']);

  const broken = s1.changedFiles.find((f) => f.path === `${PROJ}/src/broken.ts`);
  assert.ok(broken);
  assert.equal(broken.edits, 0); // is_error → başarı sayılmaz
  assert.equal(broken.failedEdits, 1);

  const agentFile = s1.changedFiles.find((f) => f.path === `${PROJ}/src/agent-added.ts`);
  assert.ok(agentFile); // subagent işi kaybolmaz
  assert.equal(agentFile.fromSubagent, true);
  assert.equal(agentFile.edits, 1);
  assert.equal(agentFile.addedLines, 1);
});

test('collectClaude S1: bash koşumları + test sinyali + exit varsayımı dürüstlüğü', async () => {
  const res = await collectClaude(PROJ, { claudeDir });
  const s1 = res.sessions.find((s) => s.sessionId === S1);
  assert.ok(s1);
  assert.equal(s1.bashRunCount, 2);

  const testRun = s1.bashRuns.find((b) => b.command === 'npm test');
  assert.ok(testRun);
  assert.equal(testRun.resultKind, 'ok');
  assert.equal(testRun.exitCode, 0);
  assert.equal(testRun.exitAssumed, true); // exit yazmıyordu — 0 VARSAYILDI, işaretli
  assert.equal(testRun.isTestLike, true);
  assert.equal(testRun.description, 'Testleri çalıştır'); // beyan — kanıt değil

  const buildRun = s1.bashRuns.find((b) => b.command === 'npm run build');
  assert.ok(buildRun);
  assert.equal(buildRun.resultKind, 'error');
  assert.equal(buildRun.exitCode, 1); // "Error: Exit code 1" string'inden
  assert.equal(buildRun.exitAssumed, false);
  assert.equal(buildRun.isTestLike, false);

  assert.equal(s1.testSignals.length, 1);
  const sig = s1.testSignals[0];
  assert.ok(sig);
  assert.equal(sig.passed, 19);
  assert.equal(sig.failed, 0);
  assert.equal(sig.exitCode, 0);

  assert.equal(s1.errorCount, 2); // Write hatası + Bash hatası
  assert.ok(s1.lastErrors.length >= 1);
});

test('halüsinasyon imkânsızlığı: assistant serbest metni özete asla girmez', async () => {
  const res = await collectClaude(PROJ, { claudeDir });
  const s1 = res.sessions.find((s) => s.sessionId === S1);
  assert.ok(s1);
  assert.equal(JSON.stringify(s1).includes('Bitti, çalışıyor'), false);
});

test('summarizeTranscript S2: sonucu görülmeyen tool_use başarı sayılmaz (unknownEdits)', async () => {
  const summary = await summarizeTranscript(join(slugDir, `${S2}.jsonl`));
  const x = summary.changedFiles.find((f) => f.path === `${OTHER_CWD}/x.ts`);
  assert.ok(x);
  assert.equal(x.edits, 0);
  assert.equal(x.unknownEdits, 1);
  assert.equal(summary.userGoals[0], 'Eski oturum hedefi');
});

test('collectClaude: hiç kaydı olmayan proje → 0 transcript + dürüst not', async () => {
  const res = await collectClaude('/Users/test/Hic Yok Proje', { claudeDir });
  assert.equal(res.transcriptsFound, 0);
  assert.equal(res.sessions.length, 0);
  assert.ok(res.notes.length >= 1);
  assert.ok(res.notes[0]?.includes('doğrulanamadı'));
});

test('collectClaude: slug dizini var ama .jsonl yok → retention notu', async () => {
  const res = await collectClaude(EMPTY_PROJ, { claudeDir });
  assert.equal(res.transcriptsFound, 0);
  assert.ok(res.notes.some((n) => n.includes('retention')));
});

test('collectClaude: claudeDir tümden yoksa zarif boş sonuç', async () => {
  const res = await collectClaude(PROJ, { claudeDir: join(claudeDir, 'boyle-bir-dizin-yok') });
  assert.equal(res.transcriptsFound, 0);
  assert.equal(res.sessions.length, 0);
  assert.ok(res.notes.length >= 1);
});

// ── ATA-OTURUM SINIRLARI (2026-07-29 sertleştirme saldırısı) ────────────────
//
// İlk hâli kök dizine kadar yürüyor ve `/` slug'ıyla eşleşiyordu: boş bir
// klasörde sync koşunca makinedeki 5 yabancı oturum taranıyordu — sessiz
// kapsam genişlemesi. Sınırlar: ≤2 seviye · $HOME üstü kapalı · konak dizinler
// deny-list · .git sınırında dur.

test('ATA SINIRI: $HOME üstüne çıkılmaz, konak dizin oturumu okunmaz', async () => {
  const { mkdtemp, mkdir: mk, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const sahteEv = await mkdtemp(j(tmpdir(), 'topbeam-ev-'));
  const claudeDir = j(sahteEv, '.claude');
  const projects = j(claudeDir, 'projects');
  await mk(projects, { recursive: true });

  // Ev dizininin KENDİSİ için bir oturum kaydı bırak — bu OKUNMAMALI.
  const evSlug = slugifyCwd(sahteEv);
  await mk(j(projects, evSlug), { recursive: true });
  await wf(j(projects, evSlug, 'yabanci.jsonl'), '{"type":"user","cwd":"/x"}\n', 'utf8');

  const proj = j(sahteEv, 'a', 'b', 'proje');
  await mk(proj, { recursive: true });

  const res = await collectClaude(proj, { claudeDir });
  assert.equal(res.transcriptsFound, 0, '$HOME oturumu ata olarak okunmamalı');
});

test('ATA SINIRI: 2 seviyeden fazla yukarı çıkılmaz', async () => {
  const { mkdtemp, mkdir: mk, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const ev = await mkdtemp(j(tmpdir(), 'topbeam-derin-'));
  const claudeDir = j(ev, '.claude');
  const projects = j(claudeDir, 'projects');
  await mk(projects, { recursive: true });

  const calisma = j(ev, 'calisma');           // 3 seviye yukarıda
  const proj = j(calisma, 'x', 'y', 'proje');
  await mk(proj, { recursive: true });

  const slug = slugifyCwd(calisma);
  await mk(j(projects, slug), { recursive: true });
  await wf(j(projects, slug, 's.jsonl'), '{"type":"user","cwd":"/x"}\n', 'utf8');

  const res = await collectClaude(proj, { claudeDir });
  assert.equal(res.transcriptsFound, 0, '3 seviye yukarıdaki oturum okunmamalı');
});

test('SAKLAMA UYARISI: 25 günden eski transcript varsa kullanıcı uyarılır', async () => {
  // Claude Code kayıtları 30 günde siliyor (cleanupPeriodDays). Silinince
  // dosya/test kanıtı YENİDEN ÜRETİLEMEZ; kalıcı olan tek şey passport.jsonl.
  // Kullanıcı kanıtını kaybetmeden ÖNCE haber almalı.
  const { mkdtemp, mkdir: mk, writeFile: wf, utimes } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const ev = await mkdtemp(j(tmpdir(), 'topbeam-retention-'));
  const claudeDir = j(ev, '.claude');
  const proj = j(ev, 'proje');
  await mk(proj, { recursive: true });
  const slug = slugifyCwd(proj);
  const dir = j(claudeDir, 'projects', slug);
  await mk(dir, { recursive: true });

  const dosya = j(dir, 's1.jsonl');
  await wf(dosya, `{"type":"user","cwd":"${proj}","sessionId":"s1"}\n`, 'utf8');
  // 27 gün öncesine yaşlandır
  const eski = new Date(Date.now() - 27 * 86_400_000);
  await utimes(dosya, eski, eski);

  const res = await collectClaude(proj, { claudeDir });
  assert.ok(
    res.notes.some((n) => n.includes('cleanupPeriodDays')),
    `saklama uyarısı verilmeli — notlar: ${JSON.stringify(res.notes)}`,
  );
  assert.ok(res.notes.some((n) => n.includes('27 günlük')), 'gerçek yaş yazılmalı');
});

test('SAKLAMA UYARISI: taze kayıtta uyarı VERİLMEZ (gereksiz korku yok)', async () => {
  const { mkdtemp, mkdir: mk, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const ev = await mkdtemp(j(tmpdir(), 'topbeam-taze-'));
  const claudeDir = j(ev, '.claude');
  const proj = j(ev, 'proje');
  await mk(proj, { recursive: true });
  const dir = j(claudeDir, 'projects', slugifyCwd(proj));
  await mk(dir, { recursive: true });
  await wf(j(dir, 's1.jsonl'), `{"type":"user","cwd":"${proj}","sessionId":"s1"}\n`, 'utf8');

  const res = await collectClaude(proj, { claudeDir });
  assert.equal(res.notes.some((n) => n.includes('cleanupPeriodDays')), false);
});
