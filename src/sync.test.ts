/**
 * sync.ts entegrasyon testleri — mkdtemp'te sahte claudeDir (OCEAN_CLAUDE_DIR)
 * + gerçek izole git repo. Gerçek ~/.claude'a ve bu repoya sıfır dokunuş.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugifyCwd } from './collect/claude.ts';
import { runInit } from './init.ts';
import { runSync, mergeClaims } from './sync.ts';
import { buildTeslim, parseGoalItems } from './goal.ts';
import { appendPassportLog, goalPath, readState, writeState } from './state.ts';
import type { Claim } from './types.ts';

/**
 * Teslim sözleri — barın kaynağı. makeProject'in ürettiği iki kaydı kapsar:
 *   söz 1 → src/login.ts yoluna dokunan dosya kaydı,
 *   söz 2 → `test:` öneki ile test koşumu kayıtları,
 *   söz 3 → ipucusuz (kanıt yok olarak DURMALI).
 */
const GOAL = `# Proje Hedefi

## Teslim sözleri

- [ ] Giriş formu çalışıyor src/login.ts
- [ ] test: testler yeşil
- [ ] Teslim paketi hazır
`;

/** goal.md yaz — init'in şablonunu ezerek testin sözlerini kur. */
async function goalYaz(proj: string, icerik = GOAL): Promise<void> {
  await writeFile(goalPath(proj), icerik, 'utf8');
}

/** goal.md'deki n. sözün id'si. */
function sozId(n: number, icerik = GOAL): string {
  return parseGoalItems(icerik)[n]?.id ?? '';
}

const NOW = new Date('2026-07-28T12:00:00.000Z');
const S1 = 'sess-sync-1';
const j = (o: unknown): string => JSON.stringify(o);

/** İzole proje: git repo + sahte transcript (Edit ok + npm test TAP 19 pass). */
async function makeProject(): Promise<{ proj: string; claudeDir: string }> {
  // realpath ŞART: macOS'ta /var → /private/var; git root gerçek yolu döner,
  // transcript yollarıyla kesişim ancak aynı gerçek yolla kurulunca oluşur.
  const proj = await realpath(await mkdtemp(join(tmpdir(), 'topbeam-sync-proj-')));
  const claudeDir = await mkdtemp(join(tmpdir(), 'topbeam-sync-claude-'));

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
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-sync-bos-'));
  const res = await runSync(dir);
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('topbeam init'));
});

test('tam boru hattı: collect → truth → card → state + pano', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await goalYaz(proj);

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

  // pasaport = TESLİM SÖZLERİ (goal.md): madde sayısı satır sayısıdır, oturum
  // sayısı DEĞİL. Kayıtlar ipuçlarıyla eşleşir; eşleşmeyen söz "kanıt yok" durur.
  assert.equal(st.passport.length, 3);
  assert.deepEqual(st.passport.map((p) => p.id), [sozId(0), sozId(1), sozId(2)]);
  assert.deepEqual(st.passport[0]?.claimIds, [`dosya-git-${S1}`]);
  assert.deepEqual(st.passport[1]?.claimIds, [`test-${S1}-0`]);
  assert.deepEqual(st.passport[2]?.claimIds, [], 'ipucusuz söz kanıt yok kalmalı');
  assert.ok(st.passport[2]?.reason?.startsWith('Kanıt yok'));
  assert.ok(st.passport.every((p) => p.status === 'not_verified'));

  // kart: doğrulanmamış yok → kanıtlı-en-yeni için insan onayı istenir
  assert.ok(st.card);
  assert.ok([`dosya-git-${S1}`, `test-${S1}-0`].includes(st.card.id));
  assert.equal(st.card.action.command, `topbeam verify ${st.card.id}`);

  // log: kanıtlı gerçekler + beyan (rozetli) — init izi de korunur
  assert.ok(st.log.some((e) => e.source === 'claude-beyan' && e.text.startsWith('Beyan:')));
  assert.ok(st.log.some((e) => e.source === 'ocean' && e.text.includes('init')));

  // pano dosyası yazıldı ve kartı içeriyor
  assert.ok(res.panoPath);
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(res.panoPath, 'utf8');
  assert.ok(html.includes('Sıradaki tek hareket'));
  assert.ok(html.includes(`topbeam verify ${st.card.id}`));
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

test('buildTeslim: insan kararı korunur ama seviye claim\'in GERÇEĞİNİ söyler', () => {
  const items = parseGoalItems('- [ ] test: testler yeşil\n');
  const soz = items[0]?.id ?? '';
  const verified = {
    id: soz, title: 'test: testler yeşil', status: 'completed' as const, claimIds: ['a'],
    level: 'insan-onayi' as const,
    verification: { by: 'ekin', at: '2026-07-28T10:00:00Z', decision: 'approved' as const },
  };
  // Aynı id'li claim artık doğrulanmamış seviyede (transcript değişti):
  // eski onay kaydı DURUR, ama söz "tamam" gibi gösterilmez.
  const freshClaim: Claim = {
    id: 'a', text: 'A yeni metin', level: 'dogrulanmadi', kind: 'test',
    evidence: [{ kind: 'transcript-tool-use', summary: 't' }], createdAt: '2026-07-28T11:00:00Z',
  };
  const out = buildTeslim([verified], [freshClaim], items);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.verification?.by, 'ekin'); // insan kararı kaybolmadı
  assert.equal(out[0]?.status, 'partial'); // ama completed diye yalan söylenmiyor
  assert.equal(out[0]?.level, 'dogrulanmadi');
});

/**
 * SİSİFOS REGRESYONU (uçtan uca) — ürünün en kritik kusurunun testi.
 * Eskiden birim = oturumdu: ikinci oturum paydayı 1 → 2 yapıyor, çalıştıkça
 * bar uzuyordu. Artık payda goal.md'den gelir ve YERİNDE KALIR.
 */
test('SİSİFOS: ikinci oturum PAYDAYI BÜYÜTMEZ (defter büyür, bar büyümez)', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await goalYaz(proj);

  const ilk = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(ilk.sozToplam, 3);
  assert.equal(ilk.defterKaydi, 1);

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
  assert.equal(res.sozToplam, 3, 'yeni oturum barı UZATMAMALI');
  assert.deepEqual(res.state?.passport.map((p) => p.id), [sozId(0), sozId(1), sozId(2)]);
  assert.equal(res.defterKaydi, 2, 'defter (arşiv) büyür — ama ilerleme sayılmaz');
  // kayıt sayısı arttı ama madde sayısı sabit — barın uzamamasının kanıtı
  assert.ok((res.state?.claims.length ?? 0) >= (ilk.state?.claims.length ?? 0));

  // Payda yalnız insan yeni bir SÖZ yazınca büyür.
  await goalYaz(proj, `${GOAL}- [ ] Bir söz daha\n`);
  const sonra = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(sonra.sozToplam, 4);
});

test('goal.md\'de teslim sözü YOKSA: pasaport boş + dürüst yönerge (bar yok)', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await goalYaz(proj, '# Proje Hedefi\n\nMVP dikey dilimini bitir.\n');

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.sozToplam, 0);
  assert.equal(res.state?.passport.length, 0);
  assert.ok(res.notes.some((n) => n.includes('bar orada dolsun')));

  const html = await readFile(join(proj, '.ocean', 'pano.html'), 'utf8');
  assert.equal(html.includes('<div class="bar"'), false, 'boş bar çizilmemeli');
  assert.ok(html.includes('bar orada dolsun'));
  // hedef satırı hâlâ okunur (liste satırı değil, düz paragraf)
  assert.ok(html.includes('MVP dikey dilimini bitir.'));
});

test('init şablonu SÖZ YAZMAZ: bar çizilmez, dürüst yönerge çıkar', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW }); // goal.md ŞABLONU ile kurulur, elle yazılmaz
  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));

  // DÜRÜSTLÜK: araç insanın adına söz vermez → şablonda sıfır madde.
  assert.equal(res.sozToplam, 0, 'şablon hiç söz kurmaz — söz kullanıcınındır');
  assert.equal(res.sozOnayli, 0);
  assert.equal(res.state?.passport.length ?? 0, 0, 'söz yoksa bar bölmesi de yok');

  // şablonun yönerge satırları hedef cümlesi sanılmaz
  const html = await readFile(join(proj, '.ocean', 'pano.html'), 'utf8');
  assert.equal(html.includes('Her `- [ ]` satırı'), false);
});

test('kullanıcı KENDİ sözünü yazınca bar kurulur ve `test:` eşleşmesi çalışır', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  // İnsan kendi sözlerini yazar — barın tek meşru kaynağı budur.
  const goalPath = join(proj, '.ocean', 'goal.md');
  const goal = await readFile(goalPath, 'utf8');
  await writeFile(goalPath, `${goal}\n- [ ] test: testler yeşil\n- [ ] Kurulum tek komutla çalışıyor\n`, 'utf8');

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.sozToplam, 2, 'bar bölmesi = insanın yazdığı söz sayısı');
  const eslesen = res.state?.passport.filter((p) => p.claimIds.length > 0) ?? [];
  assert.equal(eslesen.length, 1, 'yalnız `test:` satırı bu projede kayıt bulmalı');
  assert.ok(eslesen[0]?.title.startsWith('test:'));
  assert.equal(res.sozOnayli, 0, 'kanıt insan onayı değildir — bar boş kalır');
});

test('git deposu OLMAYAN proje: kart "git status" ÖNERMEZ', async () => {
  const proj = await realpath(await mkdtemp(join(tmpdir(), 'topbeam-nogit-')));
  const claudeDir = await mkdtemp(join(tmpdir(), 'topbeam-nogit-claude-'));
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
  assert.equal(card.action.command, `topbeam verify ${card.id}`);
  assert.ok(card.action.verb.includes('git deposu değil'));
  assert.ok(card.fact.includes('git deposu değil'));
});

test('kapsam state\'e KALICI yazılır: sayı zinciri kimliği + panoda blok', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));

  const scope = res.state?.scope;
  assert.ok(scope, 'scope state.json\'a yazılmalı');
  const c = scope.log;
  // KİMLİK: ham = ilişkisiz + tekilleşen + kırpılan + tutulan (sayı uydurulmaz)
  assert.equal(c.hamToplam, c.hamKanit + c.hamBeyan);
  assert.equal(c.hamToplam, c.ilgisizBeyan + c.tekillestirilen + c.kirpilan + c.tutulan);
  assert.equal(c.tutulan, res.state?.log.length);
  assert.ok(c.hamToplam >= c.tutulan, 'ham sayı tutulan sayıdan küçük olamaz');

  // diskten geri okununca da duruyor (kalıcı)
  const back = await readState(proj);
  assert.deepEqual(back?.scope?.log, c);

  const html = await readFile(join(proj, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('Bu panonun kapsamı'));
  assert.ok(html.includes(`panoda ${c.tutulan} satır.`));
});

test('kapsam: proje DIŞI düzenleme sayılır ve panoda görünür (iz bırakarak eleme)', async () => {
  const { proj, claudeDir } = await makeProject();
  const slugDir = join(claudeDir, 'projects', slugifyCwd(proj));
  const sid = 'sess-dis';
  const disari = join(tmpdir(), 'topbeam-baska-proje', 'gizli.ts');
  const lines = [
    j({
      type: 'assistant', cwd: proj, sessionId: sid, uuid: 'a1', timestamp: '2026-07-28T10:01:00.000Z',
      message: {
        id: 'm1', role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: disari } }],
      },
    }),
    j({
      type: 'user', cwd: proj, sessionId: sid, uuid: 'u2', timestamp: '2026-07-28T10:01:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
      toolUseResult: { filePath: disari, structuredPatch: [], userModified: false },
    }),
  ];
  await writeFile(join(slugDir, `${sid}.jsonl`), `${lines.join('\n')}\n`, 'utf8');

  await runInit(proj, { now: NOW });
  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.state?.scope?.disKapsamDuzenleme, 1);

  const html = await readFile(join(proj, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('1 düzenleme bu proje kökünün dışındaki'));
  assert.equal(html.includes('gizli.ts'), false, 'proje dışı dosya adı panoya girmez');
});

// ── İNSAN ROZETİ = DEFTER (uçtan uca) ───────────────────────────────────────

/** state'i "her şey insan onaylı" diye işaretle — DEFTERE hiçbir şey yazmadan. */
async function botIddiasiYaz(proj: string): Promise<void> {
  const st = await readState(proj);
  assert.ok(st);
  st.claims = st.claims.map((c) => ({ ...c, level: 'insan-onayi' as const }));
  st.passport = st.passport.map((p) => ({
    ...p,
    status: 'completed' as const,
    level: 'insan-onayi' as const,
  }));
  st.log.push({
    ts: '2026-07-28T11:30:00.000Z',
    text: 'Doğrulandı: her şey çalışıyor (dogfood-ajan)',
    source: 'insan',
  });
  await writeState(proj, st);
}

test('DEFTERSİZ "insan onayı" iddiası: sync sonrası panoda rozet YOK, sayıyla söylenir', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await goalYaz(proj);
  await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  await botIddiasiYaz(proj); // bot imzalı "onay" — passport.jsonl'e hiçbir satır yazılmadı

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.ok, true);
  assert.equal(res.sozOnayli, 0, 'defter desteklemeyen madde onaylandı sayılmaz');
  assert.equal(res.kaynaksizClaim, 2, 'dayanaksız iddia sayısı dürüstçe raporlanır');
  assert.equal(res.onayliClaim, 0);
  assert.ok(res.notes.some((n) => n.includes('kanal kaydı yok')));

  assert.ok(res.panoPath);
  const html = await readFile(res.panoPath, 'utf8');
  assert.equal(html.includes('>insan<'), false, 'bot imzalı log satırı insan rozeti alamaz');
  assert.equal(html.includes('>insan-onayı<'), false, 'dayanaksız seviye rozeti çıkamaz');
  assert.ok(html.includes('kanal kaydı yok'));
  assert.ok(html.includes('0 / 3 madde onaylandı'));
  // sessiz silme yok: satır panoda duruyor
  assert.ok(html.includes('Doğrulandı: her şey çalışıyor'));
  // state'in kendi iddiası korunur (veri yok edilmez) — yalnız gösterim gerçeğe bağlı
  const st = await readState(proj);
  assert.ok(st?.claims.every((c) => c.level === 'insan-onayi'));
});

test('GERÇEK terminal kaydı defterdeyse aynı state rozeti ALIR (kapı çift yönlü)', async () => {
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });
  await goalYaz(proj);
  await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  await botIddiasiYaz(proj);

  // Aynı iddialar, bu kez gerçek (terminal imzalı) doğrulama kayıtlarıyla.
  for (const claimId of [`dosya-git-${S1}`, `test-${S1}-0`]) {
    await appendPassportLog(proj, {
      schema_version: 1,
      at: '2026-07-28T11:30:00.000Z',
      claimId,
      title: 'onaylanan iş',
      decision: 'approved',
      by: 'ekin',
      source: 'terminal',
      levelBefore: 'test-kaniti',
      levelAfter: 'insan-onayi',
    });
  }

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.sozOnayli, 2, 'iki sözün kayıtları defterde onaylı');
  assert.equal(res.kaynaksizClaim, 0);
  assert.equal(res.onayliClaim, 2);
  const html = await readFile(res.panoPath ?? '', 'utf8');
  assert.ok(html.includes('>insan-onayı<'));
  assert.ok(html.includes('2 / 3 madde onaylandı'));
  assert.equal(html.includes('kanal kaydı yok'), false);
});

/**
 * SÜRÜM KÜNYESİ (2026-07-29): `tool_version` = özeti ÜRETEN sürüm.
 * `...state` yayılımı onu init anındaki değerde donduruyordu; makbuz bu alanı
 * dışarıya "Araç: topbeam vX" diye yazdığı için güncellenmiş bir kurulum eski
 * sürümü beyan ediyordu. Künye yanlışsa makbuz da yanlıştır.
 */
test('sync, state.tool_version alanını ÇALIŞAN sürüme tazeler (eski künye donmaz)', async () => {
  const { TOOL_VERSION } = await import('./types.ts');
  const { proj, claudeDir } = await makeProject();
  await runInit(proj, { now: NOW });

  // Eski bir sürümle kurulmuş gibi yap (yükseltme senaryosu)
  const s0 = await readState(proj);
  assert.ok(s0);
  await writeState(proj, { ...s0, tool_version: '0.0.1-eski' });

  const res = await withClaudeDir(claudeDir, () => runSync(proj, { now: NOW }));
  assert.equal(res.ok, true);

  const s1 = await readState(proj);
  assert.equal(s1?.tool_version, TOOL_VERSION, 'sync künyeyi tazelemeli — makbuz bunu dışarıya yazar');
});
