/**
 * truth.ts testleri — elle kurulmuş toplayıcı-çıktısı fixture'ları
 * (gerçek dosya sistemi / gerçek git YOK; tam determinizm).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BashRun, ChangedFile, ClaudeCollectResult, SessionSummary, TestSignal } from './collect/claude.ts';
import type { GitFacts } from './collect/git.ts';
import type { CiFacts } from './collect/ci.ts';
import type { LogEntry } from './types.ts';
import { buildCalisiyorClaim, buildTruth, collapseRepeats, isInsideProject, kisaltYollar } from './truth.ts';

function bash(command: string, description: string | null, over: Partial<BashRun> = {}): BashRun {
  return {
    command,
    description,
    ts: '2026-07-28T10:15:00.000Z',
    exitCode: 0,
    exitAssumed: true,
    resultKind: 'ok',
    timedOut: false,
    isTestLike: false,
    isCheckLike: false,
    fromSubagent: false,
    ...over,
  };
}

const CWD = '/proj/ornek';
const NOW = new Date('2026-07-28T12:00:00.000Z');

function file(path: string, over: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    tools: ['Edit'],
    edits: 1,
    failedEdits: 0,
    unknownEdits: 0,
    addedLines: 3,
    removedLines: 1,
    userModified: false,
    fromSubagent: false,
    lastTs: '2026-07-28T10:00:00.000Z',
    ...over,
  };
}

function signal(command: string, over: Partial<TestSignal> = {}): TestSignal {
  return {
    command,
    ts: '2026-07-28T10:30:00.000Z',
    exitCode: null,
    passed: null,
    failed: null,
    summaryLine: null,
    fromSubagent: false,
    ...over,
  };
}

function session(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: id,
    transcriptPath: `/tmp/${id}.jsonl`,
    firstTs: '2026-07-28T09:00:00.000Z',
    lastTs: '2026-07-28T11:00:00.000Z',
    cwd: CWD,
    lastCwd: CWD,
    gitBranch: 'main',
    title: null,
    userGoals: [],
    userPromptCount: 0,
    changedFiles: [],
    fileHistoryPaths: [],
    bashRuns: [],
    bashRunCount: 0,
    testSignals: [],
    errorCount: 0,
    lastErrors: [],
    interruptedCount: 0,
    compacted: false,
    parseErrors: 0,
    readErrors: 0,
    subagentFiles: 0,
    cwdMismatch: false,
    fromAncestor: false,
    ...over,
  };
}

function collect(sessions: SessionSummary[]): ClaudeCollectResult {
  return {
    projectCwd: CWD,
    claudeProjectsDir: '/tmp/.claude/projects',
    slug: '-proj-ornek',
    matchedDirs: ['-proj-ornek'],
    transcriptsFound: sessions.length,
    sessions,
    notes: [],
  };
}

function gitFacts(over: Partial<GitFacts> = {}): GitFacts {
  return {
    gitAvailable: true,
    isGit: true,
    root: CWD,
    branch: 'main',
    headHash: 'a'.repeat(40),
    headShort: 'abc1234',
    headDate: '2026-07-28T08:00:00.000Z',
    headSubject: 'ilk commit',
    dirtyFiles: [],
    recentCommits: [
      { hash: 'abc1234', full: 'a'.repeat(40), date: '2026-07-28T08:00:00.000Z', subject: 'ilk commit', files: [] },
    ],
    diffStat: null,
    notes: [],
    ...over,
  };
}

// ── dosya claim'leri ─────────────────────────────────────────────────────────

test('transcript ∩ git kesişimi → dosya-kaniti; salt-transcript → dogrulanmadi', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`), file(`${CWD}/src/b.ts`), file(`${CWD}/hayalet.ts`)],
    }),
  ]);
  const git = gitFacts({
    diffStat: {
      filesChanged: 2,
      insertions: 6,
      deletions: 2,
      files: [
        { path: 'src/a.ts', added: 3, removed: 1 },
        { path: 'src/b.ts', added: 3, removed: 1 },
      ],
    },
  });

  const { claims } = buildTruth(claude, git, { now: NOW });

  const verified = claims.find((c) => c.id === 'dosya-git-s1');
  assert.ok(verified);
  assert.equal(verified.level, 'dosya-kaniti');
  assert.equal(verified.kind, 'dosya');
  assert.equal(verified.text, '2 dosya değişti: src/a.ts, src/b.ts');
  // İKİ kanıt: transcript + git — dosya-kaniti tanımı gereği.
  assert.ok(verified.evidence.some((e) => e.kind === 'transcript-tool-use'));
  assert.ok(verified.evidence.some((e) => e.kind === 'git-diff'));

  const unverified = claims.find((c) => c.id === 'dosya-transcript-s1');
  assert.ok(unverified);
  assert.equal(unverified.level, 'dogrulanmadi');
  assert.ok(unverified.text.includes('uygulandı görünüyor, doğrulanmadı'));
  assert.ok(unverified.text.includes('hayalet.ts'));
  assert.ok(unverified.evidence.every((e) => e.kind === 'transcript-tool-use'));
});

test('git kaydı hiç yoksa dosya claim\'i dosya-kaniti OLAMAZ', () => {
  const claude = collect([session('s1', { changedFiles: [file(`${CWD}/x.ts`)] })]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  assert.ok(claims.every((c) => c.level !== 'dosya-kaniti'));
  const only = claims.find((c) => c.kind === 'dosya');
  assert.ok(only);
  assert.equal(only.level, 'dogrulanmadi');
});

test('dirtyFiles kesişimi de dosya-kaniti sayılır (diff yerine status kaydı)', () => {
  const claude = collect([session('s1', { changedFiles: [file(`${CWD}/yeni.ts`, { tools: ['Write'] })] })]);
  const git = gitFacts({ dirtyFiles: [{ status: '??', path: 'yeni.ts' }] });
  const { claims } = buildTruth(claude, git, { now: NOW });
  const verified = claims.find((c) => c.id === 'dosya-git-s1');
  assert.ok(verified);
  assert.equal(verified.level, 'dosya-kaniti');
});

test('sonucu görülmeyen denemeler ayrı claim — başarıya katılmaz', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/belirsiz.ts`, { edits: 0, unknownEdits: 2, addedLines: 0, removedLines: 0 })],
    }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const c = claims.find((x) => x.id === 'dosya-belirsiz-s1');
  assert.ok(c);
  assert.equal(c.level, 'dogrulanmadi');
  assert.ok(c.text.includes("sonucu transcript'te görünmüyor"));
  assert.equal(claims.filter((x) => x.kind === 'dosya').length, 1); // değişti-claim'i YOK
});

// ── test claim'leri ──────────────────────────────────────────────────────────

test('çıktıdan okunan geçti sayısı → test-kaniti', () => {
  const claude = collect([
    session('s1', {
      testSignals: [signal('npm test', { passed: 19, failed: 0, summaryLine: '# pass 19', exitCode: 0 })],
    }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const t = claims.find((c) => c.kind === 'test');
  assert.ok(t);
  assert.equal(t.level, 'test-kaniti');
  assert.equal(t.text, '19 test geçti, 0 başarısız (npm test).');
  assert.equal(t.evidence[0]?.kind, 'test-output');
  assert.equal(t.evidence[0]?.summary, '# pass 19');
  // exit 0 varsayım olabilir → metinde exit iddiası YOK.
  assert.ok(!t.text.includes('exit'));
});

test('başarısız test sayısı da test-kaniti (kanıtlı gerçek, süslenmez)', () => {
  const claude = collect([
    session('s1', {
      testSignals: [signal('npm test', { passed: 17, failed: 2, summaryLine: '# fail 2', exitCode: 1 })],
    }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const t = claims.find((c) => c.kind === 'test');
  assert.ok(t);
  assert.equal(t.level, 'test-kaniti');
  assert.ok(t.text.includes('2 test başarısız'));
  assert.ok(t.text.includes('17 test geçti'));
});

test('sayı okunamayan test koşumu → dogrulanmadi, sayı uydurulmaz', () => {
  const claude = collect([session('s1', { testSignals: [signal('npx vitest run')] })]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const t = claims.find((c) => c.kind === 'test');
  assert.ok(t);
  assert.equal(t.level, 'dogrulanmadi');
  assert.ok(t.text.includes('sonuç çıktıdan okunamadı — doğrulanmadı'));
  assert.ok(!/\d+ test geçti/.test(t.text));
});

test('aynı komutun tekrar koşumları → yalnız SON koşum claim olur', () => {
  const claude = collect([
    session('s1', {
      testSignals: [
        signal('npm test', { ts: '2026-07-28T10:00:00.000Z', passed: 3, failed: 5, summaryLine: '# fail 5' }),
        signal('npm test', { ts: '2026-07-28T10:45:00.000Z', passed: 8, failed: 0, summaryLine: '# pass 8' }),
      ],
    }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const tests = claims.filter((c) => c.kind === 'test');
  assert.equal(tests.length, 1);
  assert.ok(tests[0]?.text.includes('8 test geçti'));
  assert.equal(tests[0]?.createdAt, '2026-07-28T10:45:00.000Z');
});

// ── kart sinyalleri (motor → kart sözleşmesi) ────────────────────────────────

test('sinyaller: dosya claim\'lerinde fileCount/paths ölçülür, noGitTrace yalnız BİLİNİYORSA yazılır', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [
        file(`${CWD}/src/a.ts`),
        file(`${CWD}/salt.ts`),
        file(`${CWD}/belirsiz.ts`, { edits: 0, unknownEdits: 1 }),
      ],
    }),
  ]);
  const git = gitFacts({
    diffStat: { filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: 'src/a.ts', added: 3, removed: 1 }] },
  });
  const { claims } = buildTruth(claude, git, { now: NOW });

  const kanitli = claims.find((c) => c.id === 'dosya-git-s1');
  assert.deepEqual(kanitli?.signals, { fileCount: 1, paths: ['src/a.ts'], noGitTrace: false });

  const saltTranscript = claims.find((c) => c.id === 'dosya-transcript-s1');
  assert.deepEqual(saltTranscript?.signals, { fileCount: 1, paths: ['salt.ts'], noGitTrace: true });

  // Belirsiz kovada git kesişimi hiç sorulmadı → noGitTrace YAZILMAZ (bilinmiyor ≠ yok).
  const belirsiz = claims.find((c) => c.id === 'dosya-belirsiz-s1');
  assert.equal(belirsiz?.signals?.noGitTrace, undefined);
  assert.deepEqual(belirsiz?.signals, { fileCount: 1, paths: ['belirsiz.ts'] });
});

test('sinyaller: test claim\'inde OKUNAN sayılar + GERÇEK sıfır-dışı exit', () => {
  const claude = collect([
    session('s1', {
      testSignals: [signal('npm test', { passed: 17, failed: 2, summaryLine: '# fail 2', exitCode: 1 })],
    }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const t = claims.find((c) => c.kind === 'test');
  assert.deepEqual(t?.signals, { passedTests: 17, failedTests: 2, nonZeroExit: 1 });
});

test('sinyaller: VARSAYILAN exit 0 sinyal üretmez, okunamayan sayı uydurulmaz', () => {
  const claude = collect([
    session('s1', { testSignals: [signal('npx vitest run', { exitCode: 0 })] }), // exitAssumed olabilir
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  const t = claims.find((c) => c.kind === 'test');
  assert.equal(t?.level, 'dogrulanmadi');
  assert.deepEqual(t?.signals, {}); // hiçbir sinyal yok — kart zeki kuralları susar
});

// ── DÜRÜSTLÜK İNVARYANTLARI ──────────────────────────────────────────────────

test('İNVARYANT: kanıtsız claim yok — her seviyenin kanıt türü yerinde', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [
        file(`${CWD}/src/a.ts`),
        file(`${CWD}/salt.ts`),
        file(`${CWD}/belirsiz.ts`, { edits: 0, unknownEdits: 1 }),
      ],
      testSignals: [
        signal('npm test', { passed: 5, failed: 0, summaryLine: '# pass 5' }),
        signal('npx tsc --noEmit'),
      ],
      bashRuns: [],
    }),
    session('s2', { changedFiles: [file(`${CWD}/b.ts`)] }),
  ]);
  const git = gitFacts({
    diffStat: { filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: 'src/a.ts', added: 3, removed: 1 }] },
  });

  const { claims } = buildTruth(claude, git, { now: NOW });
  assert.ok(claims.length >= 5);

  for (const c of claims) {
    // 1) Kanıtsız claim GÖSTERİLMEZ: her claim'de en az bir kanıt kaydı var.
    assert.ok(c.evidence.length > 0, `kanıtsız claim: ${c.id}`);
    // 2) Motor ASLA insan-onayi üretmez.
    assert.notEqual(c.level, 'insan-onayi', `motor insan-onayi üretti: ${c.id}`);
    // 3) "çalışıyor" ifadesi motor çıktısında YASAK.
    assert.ok(!c.text.toLowerCase().includes('çalışıyor'), `motor 'çalışıyor' dedi: ${c.id}`);
    // 4) Seviye ↔ kanıt türü tutarlılığı.
    if (c.level === 'dosya-kaniti') {
      assert.ok(c.evidence.some((e) => e.kind === 'git-diff'), `dosya-kaniti git kanıtı yok: ${c.id}`);
      assert.ok(c.evidence.some((e) => e.kind === 'transcript-tool-use'), `dosya-kaniti transcript kanıtı yok: ${c.id}`);
    }
    if (c.level === 'test-kaniti') {
      assert.ok(c.evidence.some((e) => e.kind === 'test-output'), `test-kaniti çıktı kanıtı yok: ${c.id}`);
    }
    if (c.level === 'dogrulanmadi') {
      assert.ok(c.text.includes('doğrulanmadı') || c.text.includes('görünmüyor'), `dogrulanmadi etiketi eksik: ${c.id}`);
    }
  }
});

test('İNVARYANT: determinizm — aynı girdi + aynı now → birebir aynı çıktı', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`), file(`${CWD}/z.ts`)],
      testSignals: [signal('npm test', { passed: 2, failed: 1, summaryLine: '# fail 1' })],
    }),
  ]);
  const git = gitFacts({
    diffStat: { filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: 'src/a.ts', added: 3, removed: 1 }] },
  });
  const r1 = buildTruth(claude, git, { now: NOW });
  const r2 = buildTruth(claude, git, { now: NOW });
  assert.deepEqual(r1, r2);
});

// ── log ──────────────────────────────────────────────────────────────────────

test('log varsayılanı SADECE kanıtlı gerçekler — beyan girmez', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`)],
      bashRuns: [bash('npm test', 'Testleri çalıştır', { isTestLike: true })],
      testSignals: [signal('npm test', { passed: 4, failed: 0, summaryLine: '# pass 4' })],
    }),
  ]);
  const git = gitFacts({
    diffStat: { filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: 'src/a.ts', added: 3, removed: 1 }] },
  });

  const { log } = buildTruth(claude, git, { now: NOW });
  assert.ok(log.length > 0);
  assert.ok(log.every((l) => l.source !== 'claude-beyan'));
  assert.ok(log.some((l) => l.source === 'git' && l.text.startsWith('Commit: ilk commit')));
  assert.ok(log.some((l) => l.source === 'git' && l.text === '1 dosya değişti: src/a.ts'));
  assert.ok(log.some((l) => l.source === 'test' && l.text.includes('4 test geçti')));
  // dogrulanmadi claim'ler log'a girmez (bu fixture'da yok ama kural kilitli).
  const ts = log.map((l) => l.ts);
  assert.deepEqual(ts, [...ts].sort()); // kronolojik
});

test('includeBeyan=true → "Beyan:" öneki + claude-beyan kaynağı + komut ref\'i YOK', () => {
  const claude = collect([
    session('s1', {
      // npm = anlamlı araç → beyan tutulur (komut metni yine log'a girmez)
      bashRuns: [bash('npm install jsonwebtoken', 'Bağımlılığı indir', { ts: '2026-07-28T10:20:00.000Z' })],
    }),
  ]);
  const { log } = buildTruth(claude, gitFacts(), { now: NOW, includeBeyan: true });
  const beyan = log.find((l) => l.source === 'claude-beyan');
  assert.ok(beyan);
  assert.equal(beyan.text, 'Beyan: Bağımlılığı indir');
  assert.equal(beyan.ref, undefined); // komut metni (secret riski) log'a sızmaz
});

// ── GÜRÜLTÜ KESME ────────────────────────────────────────────────────────────

test('proje DIŞI dosyalar claim/log dışında kalır + sayısı not olarak söylenir', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [
        file(`${CWD}/src/a.ts`),
        file('/Users/biri/.claude/CLAUDE.md'),
        file('/Users/biri/Desktop/baska-proje/src/x.ts'),
      ],
    }),
  ]);
  const { claims, notes } = buildTruth(claude, gitFacts(), { now: NOW });

  const metin = claims.map((c) => c.text).join('\n');
  assert.equal(metin.includes('CLAUDE.md'), false, 'proje dışı yol claim metnine sızmamalı');
  assert.equal(metin.includes('baska-proje'), false);
  // Kalan tek dosya iddiası proje içindeki dosyayı anlatır.
  const dosya = claims.find((c) => c.kind === 'dosya');
  assert.ok(dosya);
  assert.equal(dosya.signals?.fileCount, 1);
  assert.deepEqual(dosya.signals?.paths, ['src/a.ts']);
  // Kapsam daralması SESSİZ olamaz.
  assert.ok(notes.some((n) => n.includes('proje kökü dışındaki')));
});

test('proje dışı yol signals.paths\'e de girmez (kart kritik-dosya taraması temiz kalır)', () => {
  const claude = collect([
    session('s1', { changedFiles: [file('/baska/yer/config/auth.ts'), file(`${CWD}/src/ui.ts`)] }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  for (const c of claims) {
    for (const p of c.signals?.paths ?? []) {
      assert.equal(p.startsWith('/'), false, `mutlak (proje dışı) yol sızdı: ${p}`);
      assert.equal(p.includes('..'), false);
    }
  }
});

test('isInsideProject: kök altı true, dışı/kökün kendisi false', () => {
  assert.equal(isInsideProject(`${CWD}/src/a.ts`, CWD), true);
  assert.equal(isInsideProject('src/a.ts', CWD), true); // göreli yol köke bağlanır
  assert.equal(isInsideProject('/Users/x/.claude/CLAUDE.md', CWD), false);
  assert.equal(isInsideProject(CWD, CWD), false); // kökün kendisi dosya değil
  assert.equal(isInsideProject('/proj/ornek-yedek/a.ts', CWD), false); // önek benzerliği yetmez
});

test('kontrol komutu (tsc/eslint) claim ÜRETMEZ; gerçek test claim\'i durur', () => {
  const claude = collect([
    session('s1', {
      testSignals: [
        signal('npx tsc --noEmit'),
        signal('eslint src'),
        signal('npm test', { passed: 12, failed: 0, summaryLine: '# pass 12' }),
      ],
    }),
  ]);
  const { claims, notes } = buildTruth(claude, gitFacts(), { now: NOW });
  const testler = claims.filter((c) => c.kind === 'test');
  assert.equal(testler.length, 1, 'yalnız gerçek test koşumu claim üretmeli');
  assert.equal(testler[0]?.level, 'test-kaniti');
  assert.ok(notes.some((n) => n.includes('kontrol komutu')));
});

test('beyan seyreltme: projeyle ilişkisiz beyan düşer, ilişkili olan durur', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/login.ts`)],
      bashRuns: [
        bash('osascript -e \'tell application "Chrome" to activate\'', 'Click ChatGPT send button'),
        bash('say bitti', 'Sesli bildirim ver'),
        bash('git add -A && git commit -m "x"', "Değişiklikleri commit'le"),
        bash(`cat ${CWD}/src/login.ts`, 'Login dosyasını oku'),
      ],
    }),
  ]);
  const { log, notes } = buildTruth(claude, gitFacts(), { now: NOW, includeBeyan: true });
  const beyanlar = log.filter((l) => l.source === 'claude-beyan').map((l) => l.text);
  assert.equal(beyanlar.some((t) => t.includes('ChatGPT')), false, 'projeyle ilgisiz beyan log\'u boğmamalı');
  assert.equal(beyanlar.some((t) => t.includes('Sesli bildirim')), false);
  assert.ok(beyanlar.some((t) => t.includes("commit'le")));
  assert.ok(beyanlar.some((t) => t.includes('Login dosyasını oku')));
  assert.ok(notes.some((n) => n.includes('beyan satırı projeyle ilişkilendirilemedi')));
});

test('ardışık aynı beyan tek satıra iner: ×N', () => {
  const claude = collect([
    session('s1', {
      bashRuns: [
        bash('git status', 'Durumu kontrol et', { ts: '2026-07-28T10:00:00.000Z' }),
        bash('git status', 'Durumu kontrol et', { ts: '2026-07-28T10:00:01.000Z' }),
        bash('git status', 'Durumu kontrol et', { ts: '2026-07-28T10:00:02.000Z' }),
      ],
    }),
  ]);
  const { log } = buildTruth(claude, gitFacts(), { now: NOW, includeBeyan: true });
  const beyanlar = log.filter((l) => l.source === 'claude-beyan');
  assert.equal(beyanlar.length, 1);
  assert.equal(beyanlar[0]?.text, 'Beyan: Durumu kontrol et ×3');
  assert.equal(beyanlar[0]?.ts, '2026-07-28T10:00:00.000Z'); // ilk görülme zamanı
});

test('collapseRepeats: sayaç toplanır (idempotent), ayrık tekrarlar birleşmez', () => {
  const e = (ts: string, text: string, source: 'claude-beyan' | 'git' = 'claude-beyan'): LogEntry => ({
    ts,
    text,
    source,
  });
  const bir = collapseRepeats([e('1', 'Beyan: X'), e('2', 'Beyan: x'), e('3', 'Beyan: X')]);
  assert.equal(bir.length, 1);
  assert.equal(bir[0]?.text, 'Beyan: X ×3');
  // ikinci geçiş sayıyı BOZMAZ (×3 ×2 olmaz)
  assert.deepEqual(collapseRepeats(bir), bir);
  // araya kanıt satırı girerse ayrı olaylardır → birleşmez
  const ayrik = collapseRepeats([e('1', 'Beyan: X'), e('2', 'Commit: y', 'git'), e('3', 'Beyan: X')]);
  assert.equal(ayrik.length, 3);
});

test('log sınırı KANIT ÖNCELİKLİ: beyanlar düşer, kanıt satırları kalır', () => {
  const commits = Array.from({ length: 520 }, (_, i) => ({
    hash: `h${i}`,
    full: String(i).padStart(40, '0'),
    date: `2026-07-28T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    subject: `commit ${i}`,
    files: [],
  }));
  const bashRuns = Array.from({ length: 200 }, (_, i) =>
    bash(`npm run build -- ${i}`, `Build ${i}`, { ts: '2026-07-28T23:59:00.000Z' }),
  );
  const claude = collect([session('s1', { bashRuns })]);
  const { log, notes } = buildTruth(claude, gitFacts({ recentCommits: commits }), {
    now: NOW,
    includeBeyan: true,
  });
  assert.equal(log.length, 500);
  assert.equal(log.filter((l) => l.source === 'claude-beyan').length, 0, 'sınırda önce beyan düşer');
  assert.ok(notes.some((n) => n.includes('kanıt taşıyan satırlar önce tutuldu')));
});

// ── git-yok senaryosu ────────────────────────────────────────────────────────

test('git deposu olmayan dizin: "git\'te izi yok" DEMEZ, noGitTrace sinyali YAZMAZ', () => {
  const claude = collect([session('s1', { changedFiles: [file(`${CWD}/src/a.ts`)] })]);
  const git = gitFacts({
    isGit: false,
    root: null,
    headHash: null,
    headShort: null,
    recentCommits: [],
    notes: ['Bu dizin bir git çalışma ağacı değil — git kanıtı yok.'],
  });
  const { claims } = buildTruth(claude, git, { now: NOW });
  const c = claims.find((x) => x.kind === 'dosya');
  assert.ok(c);
  assert.equal(c.level, 'dogrulanmadi');
  assert.ok(c.text.includes('git deposu değil'));
  assert.equal(c.text.includes("git'te izi yok"), false); // ölçüm yapılmadı ≠ ölçüm başarısız
  assert.equal(c.signals?.noGitTrace, undefined); // bilinmiyor → sinyal yazılmaz
});

// ── oturum filtreleri ────────────────────────────────────────────────────────

test('baştan sona farklı cwd\'li oturum atlanır + dürüst not düşülür', () => {
  const claude = collect([
    session('s1', {
      cwd: '/baska/proje',
      lastCwd: '/baska/proje',
      cwdMismatch: true,
      changedFiles: [file('/baska/proje/x.ts')],
    }),
  ]);
  const { claims, notes } = buildTruth(claude, gitFacts(), { now: NOW });
  assert.equal(claims.length, 0);
  assert.ok(notes.some((n) => n.includes('farklı bir cwd')));
});

test('toplayıcı notları sonuca taşınır (kapsam sessiz daralmaz)', () => {
  const claude = collect([]);
  claude.notes.push('Bu proje için transcript dizini yok — (doğrulanamadı).');
  const git = gitFacts({ isGit: false, headHash: null, recentCommits: [], notes: ['Bu dizin bir git çalışma ağacı değil — git kanıtı yok.'] });
  const { notes } = buildTruth(claude, git, { now: NOW });
  assert.ok(notes.some((n) => n.includes('transcript dizini yok')));
  assert.ok(notes.some((n) => n.includes('git kanıtı yok')));
});

// ── çalışıyor claim'i (tek meşru yol) ────────────────────────────────────────

test('buildCalisiyorClaim: yalnız Verification ile, insan-onayi + human kanıtı', () => {
  const c = buildCalisiyorClaim('Giriş akışı', {
    by: 'Ekin',
    at: '2026-07-28T12:34:56.000Z',
    decision: 'approved',
    note: 'Elle denedim',
  });
  assert.equal(c.level, 'insan-onayi');
  assert.equal(c.kind, 'durum');
  assert.ok(c.text.includes('çalışıyor'));
  assert.ok(c.text.includes('kullanıcı doğruladı'));
  assert.equal(c.evidence[0]?.kind, 'human');
  assert.ok(c.evidence[0]?.summary.includes('Ekin'));
});

// ── kapsam sızıntısı: komut metnindeki mutlak yollar ─────────────────────────

const EV = '/Users/deneme';

test('kisaltYollar: proje kökü proje-göreli olur (komut ÇALIŞIR kalır)', () => {
  const r = kisaltYollar(`cd "${CWD}/alt" && npm test`, CWD, EV, { disariKirp: true });
  assert.equal(r.text, 'cd "./alt" && npm test');
  assert.equal(r.disari, 0); // proje içi: kapsam dışına çıkmadı
});

test('kisaltYollar: proje DIŞI ev yolu "~/…" diye kısalır, sayılır', () => {
  const r = kisaltYollar(`cat ${EV}/Desktop/BaskaProje/gizli.ts`, CWD, EV, { disariKirp: true });
  assert.equal(r.text, 'cat ~/…');
  assert.equal(r.disari, 1);

  // not modunda kuyruk korunur (teşhis bilgisi kaybolmasın), kullanıcı adı gitmiş olur
  const not = kisaltYollar(`Dizin okunamadı: ${EV}/.claude/projects/x`, CWD, EV);
  assert.equal(not.text, 'Dizin okunamadı: ~/.claude/projects/x');
});

test('kisaltYollar: sınır kontrolü — /proj/ornek deseni /proj/ornekler yolunu yemez', () => {
  const r = kisaltYollar('/proj/ornekler/a.ts', CWD, EV);
  assert.equal(r.text, '/proj/ornekler/a.ts');
  assert.equal(r.hits, 0);
});

test('claim metni ve ref proje dışı mutlak yol GÖSTERMEZ (kart manşeti temiz)', () => {
  const komut = `cd "${EV}/Desktop/BaskaProje" && npm test`;
  const claude = collect([
    session('s1', { testSignals: [signal(komut, { passed: 12, failed: 0, summaryLine: '# pass 12' })] }),
  ]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW, homeDir: EV });
  const c = claims[0];
  assert.ok(c);
  assert.equal(c.text.includes(EV), false, 'manşette mutlak ev yolu olmamalı');
  assert.ok(c.text.includes('~/…'));
  assert.equal(c.evidence.some((e) => e.ref?.includes(EV) === true), false, 'ref de sızmamalı');
});

test('kısaltılan yol sayısı kapsam ölçümüne düşer (sessiz maskeleme yok)', () => {
  const claude = collect([
    session('s1', {
      testSignals: [signal(`node ${EV}/tools/x.js`, { passed: 1, failed: 0 })],
      bashRuns: [bash(`npm test --prefix ${EV}/baska`, `Testi ${EV}/baska içinde koş`)],
    }),
  ]);
  const { scope, log } = buildTruth(claude, gitFacts(), { now: NOW, homeDir: EV, includeBeyan: true });
  assert.ok(scope.kisaltilanYol >= 2);
  assert.equal(log.some((e) => e.text.includes(EV)), false);
});

// ── sayı zinciri (ham → tutulan) ─────────────────────────────────────────────

test('sayı zinciri: ham beyan elenenle birlikte sayılır (süzülmüş sayı ham diye satılmaz)', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`)],
      bashRuns: [
        bash('npm test', 'Testleri çalıştır'), // ilişkili → log'a girer
        bash('osascript -e beep', 'Sesi çal'), // ilişkisiz → elenir
        bash('open https://x.dev', 'Tarayıcıyı aç'), // ilişkisiz → elenir
      ],
    }),
  ]);
  const { counts, log } = buildTruth(claude, gitFacts(), { now: NOW, includeBeyan: true });
  assert.equal(counts.hamBeyan, 3, 'ham beyan = elenen dâhil');
  assert.equal(counts.ilgisizBeyan, 2);
  assert.equal(log.filter((e) => e.source === 'claude-beyan').length, 1);
  // kimlik: ham = ilgisiz + tekilleşen + kırpılan + tutulan
  assert.equal(
    counts.hamKanit + counts.hamBeyan,
    counts.ilgisizBeyan + counts.tekillestirilen + counts.kirpilan + counts.tutulan,
  );
});

test('sayı zinciri: kırpma ve tekilleştirme ayrı ayrı sayılır', () => {
  const runs = Array.from({ length: 700 }, () => bash('npm test', 'Testleri çalıştır'));
  const claude = collect([session('s1', { bashRuns: runs })]);
  const { counts, log } = buildTruth(claude, gitFacts(), { now: NOW, includeBeyan: true });
  assert.equal(counts.hamBeyan, 700);
  assert.ok(counts.tekillestirilen > 0, 'aynı beyanın tekrarı tekilleşmeli');
  assert.equal(counts.tutulan, log.length);
  assert.equal(
    counts.hamKanit + counts.hamBeyan,
    counts.ilgisizBeyan + counts.tekillestirilen + counts.kirpilan + counts.tutulan,
  );
});

test('kapsam ölçümü: proje dışı düzenleme, kontrol komutu, atlanan oturum, git-yok', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`), file(`${EV}/baska/b.ts`), file(`${EV}/baska/c.ts`)],
      testSignals: [signal('tsc --noEmit'), signal('eslint .')],
    }),
    session('s2', { cwd: '/baska/proje', lastCwd: '/baska/proje', cwdMismatch: true }),
  ]);
  const { scope } = buildTruth(claude, gitFacts({ isGit: false }), { now: NOW, homeDir: EV });
  assert.equal(scope.disKapsamDuzenleme, 2);
  assert.equal(scope.kontrolKomutu, 2);
  assert.equal(scope.atlananOturum, 1);
  assert.equal(scope.gitYok, true);
});

// ── opsiyonel CI kaynağı (collect/ci.ts) ─────────────────────────────────────

/** Test için CiFacts kurucusu — gerçek gh/ağ YOK. */
function ciFacts(over: Partial<CiFacts> = {}): CiFacts {
  return { kapali: false, okundu: true, eslesme: [], eslesmeyen: 0, notes: [], ...over };
}

test('CI kaynağı verilmezse motor tümüyle lokal kalır (CI claim yok)', () => {
  const claude = collect([session('s1', { testSignals: [signal('npm test', { passed: 5, failed: 0 })] })]);
  const { claims } = buildTruth(claude, gitFacts(), { now: NOW });
  assert.equal(claims.filter((c) => c.id.startsWith('ci-')).length, 0);
});

test('CI eşleşmesi claim + kanıtlı log satırı üretir; notu kapsama düşer', () => {
  const claude = collect([session('s1')]);
  const ci = ciFacts({
    eslesme: [
      {
        sha: 'a'.repeat(40),
        behind: 0,
        runs: [
          {
            headSha: 'a'.repeat(40),
            workflowName: 'CI',
            conclusion: 'success',
            status: 'completed',
            createdAt: '2026-07-28T09:00:00.000Z',
          },
        ],
      },
    ],
    notes: ['1 CI koşumu bu projenin bilinen commit’lerine bağlanamadı ve kapsam dışı bırakıldı (uydurma eşleşme yok).'],
  });
  const { claims, log, notes } = buildTruth(claude, gitFacts(), { now: NOW, ci });
  const ciClaim = claims.find((c) => c.id.startsWith('ci-'));
  assert.ok(ciClaim);
  assert.equal(ciClaim.level, 'test-kaniti');
  // test-kanıtı → log'a 'test' kaynağıyla girer (kanıtlı gerçek).
  assert.ok(log.some((l) => l.source === 'test' && l.text.includes('CI yeşil')));
  assert.ok(notes.some((n) => n.includes('kapsam dışı bırakıldı')));
});

test('CI kapalıysa (--no-ci) claim üretilmez, kapsam notu yine yazılır', () => {
  const claude = collect([session('s1')]);
  const ci = ciFacts({
    kapali: true,
    okundu: false,
    notes: ['CI kaydı okunmadı: CI okuması kapalı (--no-ci / TOPBEAM_NO_CI) — bu pano yalnız lokal gerçekleri anlatıyor.'],
  });
  const { claims, notes } = buildTruth(claude, gitFacts(), { now: NOW, ci });
  assert.equal(claims.filter((c) => c.id.startsWith('ci-')).length, 0);
  assert.ok(notes.some((n) => n.includes('CI okuması kapalı')));
});

// ── COMMIT KANITI: "işini commit'lemek barını boşaltıyordu" kusuru ───────────
//
// 2026-07-29 lansman konseyi ölçtü: dosya commit'lenip ağaç temizlenince
// diff HEAD ∪ status kümesinde kaybolduğu için aynı düzenleme "git'te izi yok —
// doğrulanmadı" diye YENİ bir iddia doğuruyor, o iddia aynı teslim sözüne
// eşleşiyor ve söz completed → partial düşüyordu. Canlı sonuç: bar 2/2 → 1/2.
// Ürünün vaadinin tam tersi. Aşağıdaki üç test o davranışı kilitler.

test('COMMIT KANITI: ağaç temiz ama iş commit\'lenmiş → dosya-kanıtı KORUNUR (bar gerilemez)', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`, { lastTs: '2026-07-28T10:00:00.000Z' })],
    }),
  ]);
  // Ağaç TERTEMİZ: ne diff ne status kaydı var — eskiden burada kanıt ölüyordu.
  const git = gitFacts({
    dirtyFiles: [],
    diffStat: null,
    recentCommits: [
      {
        hash: 'def5678',
        full: 'd'.repeat(40),
        date: '2026-07-28T10:05:00.000Z', // düzenlemeden SONRA
        subject: 'a.ts düzeltmesi',
        files: ['src/a.ts'],
      },
    ],
  });
  const { claims } = buildTruth(claude, git, { now: NOW });

  const dosya = claims.find((c) => c.id === 'dosya-git-s1');
  assert.ok(dosya, 'commit kanıtı dosya-kanıtı claim\'i üretmeli');
  assert.equal(dosya?.level, 'dosya-kaniti');
  assert.equal(
    claims.some((c) => c.id === 'dosya-transcript-s1'),
    false,
    'commit\'lenmiş iş için "git\'te izi yok" iddiası ÜRETİLMEMELİ — barı geriletir',
  );
  // Kanıt satırı SHA'yı taşımalı: üçüncü kişi `git show` ile bakabilsin.
  const gitKanit = dosya?.evidence.find((e) => e.kind === 'git-diff');
  assert.match(String(gitKanit?.summary), /commit'lenmiş/);
  assert.equal(gitKanit?.ref, 'def5678');
});

test('COMMIT KANITI ZAMAN DİSİPLİNİ: düzenlemeden ÖNCEKİ commit kanıt SAYILMAZ', () => {
  const claude = collect([
    session('s1', {
      changedFiles: [file(`${CWD}/src/a.ts`, { lastTs: '2026-07-28T10:00:00.000Z' })],
    }),
  ]);
  const git = gitFacts({
    dirtyFiles: [],
    diffStat: null,
    recentCommits: [
      {
        hash: 'old1111',
        full: 'o'.repeat(40),
        date: '2026-07-28T09:00:00.000Z', // düzenlemeden ÖNCE — bu düzenlemeyi kaydedemez
        subject: 'eski commit',
        files: ['src/a.ts'],
      },
    ],
  });
  const { claims } = buildTruth(claude, git, { now: NOW });
  assert.equal(
    claims.some((c) => c.id === 'dosya-git-s1'),
    false,
    'geçmişteki bir commit, sonraki bir düzenlemenin kanıtı olamaz',
  );
  assert.ok(claims.find((c) => c.id === 'dosya-transcript-s1'), 'dürüst hâli: doğrulanmadı');
});

test('COMMIT KANITI: zaman okunamıyorsa kanıt kurulmaz (kaçırmak > yanlış suçlamak)', () => {
  const claude = collect([
    session('s1', { changedFiles: [file(`${CWD}/src/a.ts`, { lastTs: null })] }),
  ]);
  const git = gitFacts({
    dirtyFiles: [],
    diffStat: null,
    recentCommits: [
      { hash: 'def5678', full: 'd'.repeat(40), date: '2026-07-28T10:05:00.000Z', subject: 'x', files: ['src/a.ts'] },
    ],
  });
  const { claims } = buildTruth(claude, git, { now: NOW });
  assert.equal(claims.some((c) => c.id === 'dosya-git-s1'), false);
});
