/**
 * ci.ts toplayıcı testleri.
 *
 * GERÇEK AĞA ÇIKILMAZ: her testte gh çağrısı `run` enjeksiyonuyla MOCK'lanır.
 * Tek istisna "gh kurulu değil" testi — orada var olmayan bir binary çalıştırılır
 * (ENOENT), yine ağ yok.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCiClaims,
  ciKapaliMi,
  collectCi,
  ghHataSebebi,
  parseCiRuns,
  type CiCmd,
} from './ci.ts';
import type { GitFacts } from './git.ts';
import { buildCard } from '../card.ts';

const SHA_HEAD = 'a'.repeat(40);
const SHA_ONCEKI = 'b'.repeat(40);
const SHA_YABANCI = 'c'.repeat(40);

function gitFacts(over: Partial<GitFacts> = {}): GitFacts {
  return {
    gitAvailable: true,
    isGit: true,
    root: '/proje',
    branch: 'main',
    headHash: SHA_HEAD,
    headShort: SHA_HEAD.slice(0, 7),
    headDate: '2026-07-29T10:00:00.000Z',
    headSubject: 'son commit',
    dirtyFiles: [],
    recentCommits: [
      { hash: SHA_HEAD.slice(0, 7), full: SHA_HEAD, date: '2026-07-29T10:00:00.000Z', subject: 'son commit', files: [] },
      { hash: SHA_ONCEKI.slice(0, 7), full: SHA_ONCEKI, date: '2026-07-28T10:00:00.000Z', subject: 'önceki', files: [] },
    ],
    diffStat: null,
    notes: [],
    ...over,
  };
}

function cmd(over: Partial<CiCmd> = {}): CiCmd {
  return { ok: true, stdout: '[]', stderr: '', enoent: false, timedOut: false, ...over };
}

/** gh mock'u: verilen JSON'u döndürür ve hangi argümanlarla çağrıldığını kaydeder. */
function mockGh(stdout: string, kayit?: { args?: string[]; cagri: number }) {
  return (args: string[]): Promise<CiCmd> => {
    if (kayit !== undefined) {
      kayit.args = args;
      kayit.cagri++;
    }
    return Promise.resolve(cmd({ stdout }));
  };
}

function ciJson(
  runs: readonly { sha: string; wf: string; conclusion: string | null; at: string; status?: string }[],
): string {
  return JSON.stringify(
    runs.map((r) => ({
      headSha: r.sha,
      workflowName: r.wf,
      conclusion: r.conclusion,
      status: r.status ?? 'completed',
      createdAt: r.at,
    })),
  );
}

// ── zarif boş dönüşler ───────────────────────────────────────────────────────

test('collectCi: gh kurulu DEĞİLSE zarif boş + dürüst kapsam notu (kurulum istenmez)', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    ghBin: 'topbeam-olmayan-gh-binari-xyz',
    env: {},
  });
  assert.equal(res.okundu, false);
  assert.equal(res.kapali, false);
  assert.deepEqual(res.eslesme, []);
  assert.equal(res.notes.length, 1);
  assert.match(res.notes[0] ?? '', /CI could not be read/);
  assert.match(res.notes[0] ?? '', /`gh` command is not installed/);
  /**
   * NÖBETÇİ (yasak-kelime listesi) — kurulum/token isteme dili YOK.
   *
   * Türkçe hâli /kur\b|yükle|token al|giriş yap\b/i idi: imperatif "kur"u
   * yakalar, bildirim kipindeki "kurulu/kurulum"u yakalamazdı (Türkçe ekleri
   * \b sınırını kaldırıyordu). İngilizcede aynı ayrım kelime sınırıyla
   * kurulamıyor ("install" hem "install it" hem "does not ask you to install
   * anything" içinde geçiyor) → aynı sayıda (4) ve aynı türde (imperatif
   * İSTEK) karşılık kuruldu: install it/gh/the · download · get a token · log in.
   * Kaynaktaki bildirim kipi ("is not installed", "does not ask you to install
   * anything") istek değildir, bilerek dışarıda.
   */
  assert.doesNotMatch(
    res.notes[0] ?? '',
    /\binstall (?:it|gh|the)\b|\bdownload\b|\bget a token\b|\blog in\b/i,
  );
  assert.deepEqual(buildCiClaims(res, gitFacts()), []);
});

test('collectCi: gh hata verirse (uzak depo yok) zarif boş + sebep notu', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    env: {},
    run: () =>
      Promise.resolve(cmd({ ok: false, stdout: '', stderr: 'failed to determine base repo: no git remotes found\n' })),
  });
  assert.equal(res.okundu, false);
  assert.deepEqual(res.eslesme, []);
  assert.match(
    res.notes[0] ?? '',
    /CI could not be read: this repository is not connected to a GitHub remote/,
  );
});

test('collectCi: yetki yoksa zarif boş — giriş İSTENMEZ, sebep yazılır', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    env: {},
    run: () =>
      Promise.resolve(cmd({ ok: false, stdout: '', stderr: 'gh auth login required\nHTTP 401' })),
  });
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /no GitHub session/);
  assert.match(res.notes[0] ?? '', /Topbeam does not ask you to log in/);
});

test('collectCi: ağ hatası → zarif boş + "the network could not be reached"', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    env: {},
    run: () =>
      Promise.resolve(cmd({ ok: false, stdout: '', stderr: 'dial tcp: lookup api.github.com: no such host' })),
  });
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /the network could not be reached/);
});

test('collectCi: zaman aşımı → zarif boş, fırlatmaz', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    env: {},
    run: () => Promise.resolve(cmd({ ok: false, timedOut: true, stdout: '', stderr: '' })),
  });
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /CI could not be read: gh timed out/);
});

test('collectCi: git deposu değilse gh HİÇ çağrılmaz (boşuna dış çağrı yok)', async () => {
  const kayit = { cagri: 0 };
  const res = await collectCi(
    '/proje',
    gitFacts({ isGit: false, headHash: null, recentCommits: [] }),
    { env: {}, run: mockGh('[]', kayit) },
  );
  assert.equal(kayit.cagri, 0);
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /this directory is not a git repository/);
});

test('collectCi: JSON bozuksa zarif boş + dürüst not', async () => {
  const res = await collectCi('/proje', gitFacts(), {
    env: {},
    run: () => Promise.resolve(cmd({ stdout: 'bu JSON değil' })),
  });
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /was not in the expected JSON shape/);
});

// ── OFFLINE MODU (--no-ci / TOPBEAM_NO_CI) ───────────────────────────────────

test('OFFLINE: --no-ci bayrağı → gh HİÇ çağrılmaz, kapsam notu yazılır', async () => {
  const kayit = { cagri: 0 };
  const res = await collectCi('/proje', gitFacts(), { noCi: true, env: {}, run: mockGh('[]', kayit) });
  assert.equal(kayit.cagri, 0);
  assert.equal(res.kapali, true);
  assert.equal(res.okundu, false);
  assert.match(res.notes[0] ?? '', /CI reading is switched off \(--no-ci \/ TOPBEAM_NO_CI\)/);
  assert.deepEqual(buildCiClaims(res, gitFacts()), []);
});

test('OFFLINE: TOPBEAM_NO_CI=1 → gh HİÇ çağrılmaz', async () => {
  const kayit = { cagri: 0 };
  const res = await collectCi('/proje', gitFacts(), {
    env: { TOPBEAM_NO_CI: '1' },
    run: mockGh(ciJson([{ sha: SHA_HEAD, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' }]), kayit),
  });
  assert.equal(kayit.cagri, 0);
  assert.equal(res.kapali, true);
  assert.deepEqual(res.eslesme, []);
});

test('ciKapaliMi: yalnız açık kapatma değeri kapatır (0/false/boş kapatmaz)', () => {
  assert.equal(ciKapaliMi({}), false);
  assert.equal(ciKapaliMi({ TOPBEAM_NO_CI: '' }), false);
  assert.equal(ciKapaliMi({ TOPBEAM_NO_CI: '0' }), false);
  assert.equal(ciKapaliMi({ TOPBEAM_NO_CI: 'false' }), false);
  assert.equal(ciKapaliMi({ TOPBEAM_NO_CI: '1' }), true);
  assert.equal(ciKapaliMi({ TOPBEAM_NO_CI: 'evet' }), true);
});

// ── SHA eşleşmesi ────────────────────────────────────────────────────────────

test('SHA EŞLEŞMEZSE YÜKSELTME YOK: yabancı commit’in yeşil koşumu claim üretmez', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_YABANCI, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' }])),
  });
  assert.equal(res.okundu, true);
  assert.equal(res.eslesmeyen, 1);
  assert.deepEqual(res.eslesme, []);
  assert.deepEqual(buildCiClaims(res, git), []); // hiçbir seviye yükselmez
  assert.ok(
    res.notes.some((n) =>
      /could not be tied to a known commit of this project and was left out of scope/.test(n),
    ),
  );
});

test('SHA ÖNEK eşleşmesi de YETMEZ: kısa hash’le başlayan başka SHA eşleşme saymaz', async () => {
  const git = gitFacts();
  // İlk 7 hane HEAD ile aynı, kalanı farklı → birebir DEĞİL → eşleşmez.
  const yakinAmaBaska = `${SHA_HEAD.slice(0, 7)}${'d'.repeat(33)}`;
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: yakinAmaBaska, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' }])),
  });
  assert.equal(res.eslesmeyen, 1);
  assert.deepEqual(buildCiClaims(res, git), []);
});

test('SHA büyük harfle gelse de birebir eşleşir (normalize), uydurma yok', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_HEAD.toUpperCase(), wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' }])),
  });
  assert.equal(res.eslesme.length, 1);
  assert.equal(res.eslesme[0]?.sha, SHA_HEAD);
  assert.equal(res.eslesme[0]?.behind, 0);
});

test('collectCi: yalnız MEVCUT repo sorgulanır — komut salt-okunur run list', async () => {
  const kayit: { args?: string[]; cagri: number } = { cagri: 0 };
  await collectCi('/proje', gitFacts(), { env: {}, run: mockGh('[]', kayit) });
  assert.equal(kayit.cagri, 1);
  const args = kayit.args ?? [];
  assert.equal(args[0], 'run');
  assert.equal(args[1], 'list');
  assert.ok(args.includes('--json'));
  // --repo YOK: mevcut dizinin deposu kullanılır, başka depo sorgulanmaz.
  assert.ok(!args.includes('--repo'));
  // Yazan/tetikleyen alt komut yok — toplayıcı SALT-OKUNUR.
  assert.ok(args.every((a) => !/^(delete|rerun|cancel|watch|download)$/.test(a)));
});

// ── claim üretimi ────────────────────────────────────────────────────────────

test('SUCCESS → test-kanıtı seviyesinde claim (SHA birebir eşleşti)', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(
      ciJson([
        { sha: SHA_HEAD, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' },
        { sha: SHA_HEAD, wf: 'lint', conclusion: 'success', at: '2026-07-29T11:01:00Z' },
      ]),
    ),
  });
  const claims = buildCiClaims(res, git);
  assert.equal(claims.length, 1);
  const c = claims[0];
  assert.ok(c);
  assert.equal(c.level, 'test-kaniti');
  assert.equal(c.kind, 'test');
  assert.match(c.text, /CI green: 2 workflows/);
  assert.match(c.text, new RegExp(SHA_HEAD.slice(0, 7)));
  assert.match(c.text, /the HEAD commit/);
  assert.equal(c.createdAt, '2026-07-29T11:01:00Z'); // en yeni koşumun kendi zamanı
  // Yeşil CI sayı sinyali yazmaz — "kaç test geçti" uydurulmaz.
  assert.equal(c.signals?.passedTests, undefined);
  assert.equal(c.signals?.ciFailed, undefined);
});

test('FAILURE → kırık sinyali (ciFailed) + kart bunu manşete alır', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(
      ciJson([
        { sha: SHA_HEAD, wf: 'CI', conclusion: 'failure', at: '2026-07-29T11:00:00Z' },
        { sha: SHA_HEAD, wf: 'lint', conclusion: 'success', at: '2026-07-29T11:00:00Z' },
      ]),
    ),
  });
  const claims = buildCiClaims(res, git);
  assert.equal(claims.length, 1);
  const c = claims[0];
  assert.ok(c);
  assert.equal(c.level, 'test-kaniti');
  assert.equal(c.signals?.ciFailed, true);
  assert.match(c.text, /CI red: the CI workflow/);
  assert.match(c.text, /1 workflow green/);
  // Sayı uydurulmaz: CI'da geçti/kaldı sayısı ve exit kodu yoktur.
  assert.equal(c.signals?.failedTests, undefined);
  assert.equal(c.signals?.nonZeroExit, undefined);

  const kart = buildCard(claims, { now: new Date('2026-07-29T12:00:00Z'), isGitRepo: true });
  assert.equal(kart.rule, 'kirik-test');
  assert.match(kart.why, /The CI run finished red/);
  assert.match(kart.doneWhen, /a passing local test does not turn CI green/);
});

test('KIRIK CI, lokal yeşil koşumla manşetten DÜŞMEZ (farklı ölçüm, farklı ağaç)', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_HEAD, wf: 'CI', conclusion: 'failure', at: '2026-07-29T11:00:00Z' }])),
  });
  const ciClaim = buildCiClaims(res, git);
  const lokalYesil = {
    id: 'test-oturum-0',
    text: '299 tests passed, 0 failed (npm test).',
    level: 'test-kaniti' as const,
    kind: 'test' as const,
    signals: { passedTests: 299, failedTests: 0 },
    evidence: [{ kind: 'test-output' as const, summary: 'pass 299', ref: 'npm test' }],
    createdAt: '2026-07-29T11:30:00Z', // CI kırığından SONRA
  };
  const kart = buildCard([...ciClaim, lokalYesil], {
    now: new Date('2026-07-29T12:00:00Z'),
    isGitRepo: true,
  });
  assert.equal(kart.rule, 'kirik-test');
  assert.match(kart.fact, /CI red/);
});

test('CI yeşili, LOKAL kırık koşumu temizlemez (kart hâlâ kırığı gösterir)', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_HEAD, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:30:00Z' }])),
  });
  const lokalKirik = {
    id: 'test-oturum-0',
    text: 'The test run reported 3 failing tests (npm test).',
    level: 'test-kaniti' as const,
    kind: 'test' as const,
    signals: { failedTests: 3 },
    evidence: [{ kind: 'test-output' as const, summary: 'fail 3', ref: 'npm test' }],
    createdAt: '2026-07-29T11:00:00Z',
  };
  const kart = buildCard([...buildCiClaims(res, git), lokalKirik], {
    now: new Date('2026-07-29T12:00:00Z'),
    isGitRepo: true,
  });
  assert.equal(kart.rule, 'kirik-test');
  assert.match(kart.fact, /3 failing tests/);
});

test('HEAD DEĞİL, geride bir commit eşleşirse mesafe AÇIKÇA yazılır', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_ONCEKI, wf: 'CI', conclusion: 'success', at: '2026-07-28T11:00:00Z' }])),
  });
  assert.equal(res.eslesme[0]?.behind, 1);
  const c = buildCiClaims(res, git)[0];
  assert.ok(c);
  assert.match(c.text, /1 commit behind HEAD/);
});

test('Çalışma ağacı kirliyse CI’ın diski görmediği claim metnine yazılır', async () => {
  const git = gitFacts({ dirtyFiles: [{ status: ' M', path: 'src/a.ts' }, { status: '??', path: 'src/b.ts' }] });
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(ciJson([{ sha: SHA_HEAD, wf: 'CI', conclusion: 'success', at: '2026-07-29T11:00:00Z' }])),
  });
  const c = buildCiClaims(res, git)[0];
  assert.ok(c);
  assert.match(c.text, /the working tree has 2 changed files that CI did not see/);
});

test('Sonuçlanmamış/iptal koşum claim ÜRETMEZ, kapsam notunda durur', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(
      ciJson([
        { sha: SHA_HEAD, wf: 'CI', conclusion: null, at: '2026-07-29T11:00:00Z', status: 'in_progress' },
        { sha: SHA_HEAD, wf: 'deploy', conclusion: 'cancelled', at: '2026-07-29T11:00:00Z' },
      ]),
    ),
  });
  assert.deepEqual(buildCiClaims(res, git), []);
  assert.ok(res.notes.some((n) => /neither green nor red/.test(n)));
  assert.ok(res.notes.some((n) => /no result is invented/.test(n)));
});

test('Workflow başına SON koşum alınır (eski kırık, yeni yeşille değişir)', async () => {
  const git = gitFacts();
  const res = await collectCi('/proje', git, {
    env: {},
    run: mockGh(
      ciJson([
        { sha: SHA_HEAD, wf: 'CI', conclusion: 'success', at: '2026-07-29T12:00:00Z' },
        { sha: SHA_HEAD, wf: 'CI', conclusion: 'failure', at: '2026-07-29T10:00:00Z' },
      ]),
    ),
  });
  assert.equal(res.eslesme[0]?.runs.length, 1);
  const c = buildCiClaims(res, git)[0];
  assert.ok(c);
  assert.match(c.text, /CI green/);
});

test('Hiç eşleşme yoksa dürüst not: push edilmemiş ya da pencere dışı olabilir', async () => {
  const res = await collectCi('/proje', gitFacts(), { env: {}, run: mockGh('[]') });
  assert.equal(res.okundu, true);
  assert.deepEqual(res.eslesme, []);
  assert.ok(res.notes.some((n) => /None of this project’s \d+ known commits appeared/.test(n)));
  assert.ok(res.notes.some((n) => /may not be pushed yet/.test(n)));
});

// ── saf yardımcılar ──────────────────────────────────────────────────────────

test('parseCiRuns: bozuk kayıtlar atılır ve SAYILIR (sessiz kayıp yok)', () => {
  const r = parseCiRuns(
    JSON.stringify([
      { headSha: SHA_HEAD, workflowName: 'CI', conclusion: 'success', status: 'completed', createdAt: '2026-07-29T11:00:00Z' },
      { headSha: 'kısa', workflowName: 'CI', conclusion: 'success', createdAt: '2026-07-29T11:00:00Z' },
      { headSha: SHA_ONCEKI, workflowName: 'CI', conclusion: 'success' }, // createdAt yok
      null,
    ]),
  );
  assert.equal(r.ok, true);
  assert.equal(r.runs.length, 1);
  assert.equal(r.bozuk, 3);
});

test('parseCiRuns: dizi olmayan JSON → ok=false', () => {
  assert.equal(parseCiRuns('{"a":1}').ok, false);
  assert.equal(parseCiRuns('').ok, false);
});

test('ghHataSebebi: bilinmeyen hata AYNEN geçer (uydurma teşhis yok)', () => {
  assert.equal(ghHataSebebi('something unexpected happened'), 'something unexpected happened');
  assert.match(ghHataSebebi(`${'x'.repeat(400)}`), /…$/);
  assert.match(ghHataSebebi(''), /no detail given/);
});
