/**
 * verify.ts testleri — sahte ask/notify enjeksiyonu; osascript ASLA çağrılmaz.
 * Dürüstlük invaryantları: onay yalnız insan cevabıyla; red → seviye değişmez;
 * full-tik bildirimi BİR KEZ; passport.jsonl append-only.
 *
 * İNSAN KAPISI: fakeDeps interactive=true verir — yani "cevap gerçek bir
 * terminalden geldi" senaryosu. Kapının KAPALI hâli ayrı testlerde (aşağıda)
 * ve cli.test.ts'te (gerçek subprocess, gerçek pipe) kilitlenir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { newOceanState, type Claim, type Verification } from './types.ts';
import { writeState, readState, passportLogPath, goalPath, oceanDir, muhurPath } from './state.ts';
import { writeFile } from 'node:fs/promises';
import { buildTeslim, parseGoalItems } from './goal.ts';
import { KALABALIK_ESIK, approveClaim, insanKapisi, runVerify, type VerifyDeps } from './verify.ts';

const NOW = new Date('2026-07-28T15:00:00.000Z');

/**
 * Teslim sözleri — barın kaynağı. Testlerdeki iki claim'i kapsayan sözler:
 *   soz #1 → dosya kaydı (src/a.ts yolu), soz #2 → test koşumu kayıtları.
 */
const GOAL_IKI_SOZ = `# Proje Hedefi

## Teslim sözleri

- [ ] Giriş ekranı hazır src/a.ts
- [ ] test: testler yeşil
`;
/** Tek söz: iki kaydı da kapsar (dosya yolu + test ipucu aynı satırda). */
const GOAL_TEK_SOZ = `- [ ] Dikey dilim bitti src/a.ts #test\n`;

function claims2(): Claim[] {
  return [
    {
      id: 'dosya-git-s1', text: '1 dosya değişti: src/a.ts', level: 'dosya-kaniti', kind: 'dosya',
      signals: { fileCount: 1, paths: ['src/a.ts'] },
      evidence: [
        { kind: 'transcript-tool-use', summary: 'Transcript: hatasız edit.' },
        { kind: 'git-diff', summary: 'git: çalışma ağacında kayıt var.' },
      ],
      createdAt: '2026-07-28T10:00:00Z',
    },
    {
      id: 'test-s1-0', text: '19 test geçti (npm test).', level: 'test-kaniti', kind: 'test',
      evidence: [{ kind: 'test-output', summary: '# pass 19' }],
      createdAt: '2026-07-28T11:00:00Z',
    },
  ];
}

/** Aynı iki claim, ama AYNI oturuma bağlı (oturum artık pasaportu ETKİLEMEZ). */
function claimsBirimli(): Claim[] {
  return claims2().map((c) => ({ ...c, sessionId: 's1' }));
}

async function makeStateDir(claims: Claim[] = claims2(), goal = GOAL_IKI_SOZ): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-verify-'));
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(goalPath(dir), goal, 'utf8');
  const st = newOceanState('Verify Proje', NOW);
  st.claims = claims;
  st.passport = buildTeslim([], st.claims, parseGoalItems(goal));
  await writeState(dir, st);
  return dir;
}

/** goal.md'deki n. sözün id'si (0 tabanlı) — pano/CLI'da görünen `soz-…`. */
function sozId(goal: string, n = 0): string {
  return parseGoalItems(goal)[n]?.id ?? '';
}

interface FakeDeps extends VerifyDeps {
  lines: string[];
  notifications: string[];
}

function fakeDeps(answer: string): FakeDeps {
  const lines: string[] = [];
  const notifications: string[] = [];
  return {
    lines,
    notifications,
    ask: () => Promise.resolve(answer),
    out: (l) => lines.push(l),
    notify: (title, msg) => {
      notifications.push(`${title}: ${msg}`);
      return Promise.resolve(true);
    },
    by: 'ekin',
    interactive: true, // gerçek terminal senaryosu
    now: NOW,
  };
}

test('bilinmeyen id: dürüst hata + kayıtlı id listesi', async () => {
  const dir = await makeStateDir();
  const deps = fakeDeps('e');
  const res = await runVerify(dir, 'boyle-yok', deps);
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('boyle-yok'));
  assert.ok(res.error?.includes('dosya-git-s1'));
});

test('init edilmemiş dizin: dürüst hata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-verify-bos-'));
  const res = await runVerify(dir, 'x', fakeDeps('e'));
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('topbeam init'));
});

test('red (H): seviye DEĞİŞMEZ, passport.jsonl yazılmaz', async () => {
  const dir = await makeStateDir();
  const res = await runVerify(dir, 'dosya-git-s1', fakeDeps('h'));
  assert.equal(res.ok, true);
  assert.equal(res.approved, false);

  const st = await readState(dir);
  assert.equal(st?.claims.find((c) => c.id === 'dosya-git-s1')?.level, 'dosya-kaniti');
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8')); // dosya hiç oluşmadı
});

test('onay (e): insan-onayı + pasaport completed + append-only log + kanıt gösterildi', async () => {
  const dir = await makeStateDir();
  const deps = fakeDeps('e');
  const res = await runVerify(dir, 'dosya-git-s1', deps);
  assert.equal(res.ok, true);
  assert.equal(res.approved, true);
  assert.equal(res.fullTick, false); // 1/2 — full değil

  // ekrana iddia + kanıtlar döküldü (karar insanın, kör onay değil)
  assert.ok(deps.lines.some((l) => l.includes('1 dosya değişti')));
  assert.ok(deps.lines.some((l) => l.includes('git-diff')));

  const st = await readState(dir);
  const c = st?.claims.find((x) => x.id === 'dosya-git-s1');
  assert.equal(c?.level, 'insan-onayi');
  assert.ok(c?.evidence.some((e) => e.kind === 'human'));

  // Onay, o kaydı kapsayan TESLİM SÖZÜNE yazılır (oturuma değil).
  const item = st?.passport.find((p) => p.id === sozId(GOAL_IKI_SOZ, 0));
  assert.equal(item?.status, 'completed');
  assert.equal(item?.verification?.by, 'ekin');

  const logRaw = await readFile(passportLogPath(dir), 'utf8');
  const rec = JSON.parse(logRaw.trim()) as { claimId: string; levelBefore: string; levelAfter: string };
  assert.equal(rec.claimId, 'dosya-git-s1');
  assert.equal(rec.levelBefore, 'dosya-kaniti');
  assert.equal(rec.levelAfter, 'insan-onayi');

  // bar dolmadan bildirim YOK, mühür de YOK
  assert.equal(deps.notifications.length, 0);
  await assert.rejects(() => readFile(muhurPath(dir), 'utf8'));

  // pano tazelendi
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('1 / 2 madde onaylandı'));
});

test('BAR DOLUNCA: mühür yazılır + bildirim BİR KEZ, tekrarlanmaz', async () => {
  const dir = await makeStateDir();
  const d1 = fakeDeps('e');
  await runVerify(dir, 'dosya-git-s1', d1);
  const d2 = fakeDeps('e');
  const res2 = await runVerify(dir, 'test-s1-0', d2);

  assert.equal(res2.fullTick, true);
  assert.equal(res2.notified, true);
  assert.equal(d2.notifications.length, 1);
  assert.ok(d2.notifications[0]?.includes('Ürün geliştirildi'));

  const st = await readState(dir);
  assert.ok(st?.fullTickNotifiedAt);
  assert.ok(st?.log.some((e) => e.source === 'ocean' && e.text.includes('Bar doldu')));

  // MÜHÜR: kapsam dürüstçe yazılı
  const muhur = await readFile(muhurPath(dir), 'utf8');
  assert.ok(muhur.includes('Kapsam    : 2 teslim sözü — hepsi insan onaylı.'));
  assert.ok(muhur.includes('- Giriş ekranı hazır src/a.ts'));
  assert.ok(muhur.includes('## Bu mühür ne demek DEĞİL'));
  assert.ok(d2.lines.some((l) => l.includes('Mühür yazıldı')));

  // pano tören bandı
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('Ürün geliştirildi 🎉'));
  assert.ok(html.includes('2 / 2 madde onaylandı'));

  // zaten onaylı claim'i tekrar verify → yeniden onay istenmez, bildirim yok
  const d3 = fakeDeps('e');
  const res3 = await runVerify(dir, 'test-s1-0', d3);
  assert.equal(res3.approved, false);
  assert.equal(d3.notifications.length, 0);
  assert.ok(d3.lines.some((l) => l.includes('zaten insan onaylı')));
});

// ── teslim sözü onayı (barı dolduran tek yol) ───────────────────────────────

test('teslim sözü id\'si ile onay: söze eşleşen TÜM kayıtlar tek soruda geçer', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const soz = sozId(GOAL_TEK_SOZ);
  const deps = fakeDeps('e');
  const res = await runVerify(dir, soz, deps);
  assert.equal(res.ok, true);
  assert.equal(res.approved, true);

  // KÖR ONAY YOK: iki iddia da soru sorulmadan önce gösterildi
  assert.ok(deps.lines.some((l) => l.includes('1 dosya değişti')));
  assert.ok(deps.lines.some((l) => l.includes('19 test geçti')));
  assert.ok(deps.lines.some((l) => l.includes('Teslim sözü: Dikey dilim bitti')));

  const st = await readState(dir);
  assert.ok(st?.claims.every((c) => c.level === 'insan-onayi'));
  assert.equal(st?.passport.length, 1);
  assert.equal(st?.passport[0]?.status, 'completed');
  assert.equal(st?.passport[0]?.verification?.by, 'ekin');

  // append-only log: KAYIT BAŞINA satır (izlenebilirlik kaybolmaz)
  const satirlar = (await readFile(passportLogPath(dir), 'utf8')).trim().split('\n');
  assert.equal(satirlar.length, 2);
  assert.deepEqual(
    satirlar.map((l) => (JSON.parse(l) as { claimId: string }).claimId).sort(),
    ['dosya-git-s1', 'test-s1-0'],
  );

  // tek söz tamamen onaylandı → bar doldu
  assert.equal(res.fullTick, true);
  assert.equal(res.notified, true);
});

test('sözün tek kaydını onaylamak sözü "tamam" YAPMAZ (partial, dürüst sayım)', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const res = await runVerify(dir, 'dosya-git-s1', fakeDeps('e'));
  assert.equal(res.approved, true);
  assert.equal(res.fullTick, false);

  const st = await readState(dir);
  assert.equal(st?.passport.length, 1);
  assert.equal(st?.passport[0]?.status, 'partial');
  assert.ok(st?.passport[0]?.reason?.includes('1/2'));
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  // yarısı onaylı söz bölmeyi DOLDURMAZ
  assert.ok(html.includes('0 / 1 madde onaylandı'));
  assert.equal(html.includes('class="seg on"'), false);
});

test('söz onayında red (H): hiçbir kayıt yükselmez', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const res = await runVerify(dir, sozId(GOAL_TEK_SOZ), fakeDeps('h'));
  assert.equal(res.approved, false);
  const st = await readState(dir);
  assert.ok(st?.claims.every((c) => c.level !== 'insan-onayi'));
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'));
});

test('bilinmeyen id hatası teslim sözlerini de gösterir (yol tarif eder)', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const res = await runVerify(dir, 'olmayan-id', fakeDeps('e'));
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes(sozId(GOAL_TEK_SOZ)));
  assert.ok(res.error?.includes('2 kayıt'));
  assert.ok(res.error?.includes('Dikey dilim bitti'));
});

test('KAYDI OLMAYAN söz onaylanamaz: "kanıt yok" der, lastik damga vurdurmaz', async () => {
  const goal = '- [ ] Belgeler hazır\n';
  const dir = await makeStateDir(claims2(), goal);
  const deps = fakeDeps('e');
  const res = await runVerify(dir, sozId(goal), deps);
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('bağlanan kayıt yok'));
  assert.ok(res.error?.includes('ipucu'), 'ne yapacağı söylenmeli');
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'));
});

test('SİSİFOS: yeni oturumun kayıtları PAYDAYI büyütmez (madde sayısı goal.md\'den)', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const once = (await readState(dir))?.passport.length;
  assert.equal(once, 1);

  // ertesi gün başka bir oturum daha çalıştı
  const st = await readState(dir);
  assert.ok(st);
  st.claims = [
    ...st.claims,
    {
      id: 'dosya-git-s2', text: '9 dosya değişti: src/a.ts', level: 'dosya-kaniti', kind: 'dosya',
      sessionId: 's2', signals: { fileCount: 9, paths: ['src/a.ts'] },
      evidence: [{ kind: 'git-diff', summary: 'git kaydı' }],
      createdAt: '2026-07-29T10:00:00Z',
    },
  ];
  await writeState(dir, st);

  await runVerify(dir, 'dosya-git-s1', fakeDeps('e'));
  const sonra = await readState(dir);
  assert.equal(sonra?.passport.length, 1, 'oturum eklendi ama bar UZAMADI');
});

// ── İNSAN KAPISI (ürünün en kutsal kuralı: insan onayı = GERÇEK insan) ──────

test('insanKapisi: etkileşimsiz girdi (pipe/otomasyon) kapıyı KAPATIR', () => {
  const yok = insanKapisi({ by: 'ekin' }); // interactive verilmedi = TTY yok
  assert.equal(yok.ok, false);
  assert.equal(yok.ok === false && yok.gate, 'etkilesimsiz');
  assert.ok(yok.ok === false && yok.message.includes('terminal'));

  const kapali = insanKapisi({ interactive: false, by: 'ekin' });
  assert.equal(kapali.ok, false);
  assert.equal(kapali.ok === false && kapali.gate, 'etkilesimsiz');
});

test('insanKapisi: kimlik okunamıyorsa onay YOK ("bilinmiyor" imzayla onay olmaz)', () => {
  for (const by of ['', '   ', 'unknown', 'bilinmiyor', 'NONE']) {
    const r = insanKapisi({ interactive: true, by });
    assert.equal(r.ok, false, `'${by}' kimlik sayılmamalı`);
    assert.equal(r.ok === false && r.gate, 'kimlik-yok');
  }
  const ok = insanKapisi({ interactive: true, by: 'ekin' });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true && ok.by, 'ekin');
});

test('BOT ONAYI ENGELLENDİ: etkileşimsiz "e" cevabı seviyeyi YÜKSELTMEZ, log YAZMAZ', async () => {
  const dir = await makeStateDir();
  const deps = fakeDeps('e');
  let soruldu = false;
  const bot: FakeDeps = {
    ...deps,
    interactive: false, // pipe / otomasyon
    ask: () => {
      soruldu = true;
      return Promise.resolve('e');
    },
  };

  const res = await runVerify(dir, 'dosya-git-s1', bot);
  assert.equal(res.ok, true);
  assert.equal(res.approved, false);
  assert.equal(res.gate, 'etkilesimsiz');
  assert.equal(soruldu, false, 'otomasyona soru bile sorulmamalı');

  // seviye aynı, insan kanıtı eklenmedi
  const st = await readState(dir);
  const c = st?.claims.find((x) => x.id === 'dosya-git-s1');
  assert.equal(c?.level, 'dosya-kaniti');
  assert.equal(c?.evidence.some((e) => e.kind === 'human'), false);
  // pasaport yükselmedi + değişmez log HİÇ oluşmadı
  assert.notEqual(st?.passport.find((p) => p.id === sozId(GOAL_IKI_SOZ, 0))?.status, 'completed');
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'));

  // kullanıcıya neden söylenir (sessiz yutma yok)
  assert.ok(bot.lines.some((l) => l.includes('GERÇEK insan') || l.includes('gerçek insan')));
});

test('kimliksiz onay: kapı kapalı, hiçbir kayıt yazılmaz', async () => {
  const dir = await makeStateDir();
  const deps: FakeDeps = { ...fakeDeps('e'), by: '   ' };
  const res = await runVerify(dir, 'dosya-git-s1', deps);
  assert.equal(res.approved, false);
  assert.equal(res.gate, 'kimlik-yok');
  const st = await readState(dir);
  assert.equal(st?.claims.find((x) => x.id === 'dosya-git-s1')?.level, 'dosya-kaniti');
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'));
});

test('terminal onayı kanalını KAYDEDER: verification.source + jsonl source = terminal', async () => {
  const dir = await makeStateDir();
  await runVerify(dir, 'dosya-git-s1', fakeDeps('e'));

  const st = await readState(dir);
  assert.equal(
    st?.passport.find((p) => p.id === sozId(GOAL_IKI_SOZ, 0))?.verification?.source,
    'terminal',
  );

  const rec = JSON.parse((await readFile(passportLogPath(dir), 'utf8')).trim()) as {
    by: string;
    source?: string;
  };
  assert.equal(rec.source, 'terminal');
  assert.equal(rec.by, 'ekin');
});

test('approveClaim: kanıt ekler, seviye yükseltir, orijinali MUTASYONA UĞRATMAZ', () => {
  const orig = claims2()[0] as Claim;
  const verification: Verification = { by: 'ekin', at: NOW.toISOString(), decision: 'approved' };
  const approved = approveClaim(orig, verification);
  assert.equal(approved.level, 'insan-onayi');
  assert.equal(approved.evidence.length, orig.evidence.length + 1);
  assert.equal(orig.level, 'dosya-kaniti'); // orijinal değişmedi
  assert.ok(approved.evidence.at(-1)?.summary.includes('ekin'));
});

// ── İNSAN ROZETİ = DEFTER (rapor tarafı) ────────────────────────────────────

test('DEFTERSİZ "insan-onayi" seviyesi onaylı SAYILMAZ: dürüstçe işaretlenir ve yeniden sorulur', async () => {
  // state "insan onaylı" diyor ama passport.jsonl'de karşılığı yok (bot izi).
  const dir = await makeStateDir(claims2().map((c) => ({ ...c, level: 'insan-onayi' as const })));
  const deps = fakeDeps('e');
  const res = await runVerify(dir, 'dosya-git-s1', deps);

  // "zaten onaylı" DEMEZ — dayanağı olmayan seviye kapıyı kilitleyemez
  assert.equal(res.approved, true);
  assert.equal(deps.lines.some((l) => l.includes('zaten insan onaylı')), false);
  assert.ok(
    deps.lines.some((l) => l.includes('kanal kaydı yok')),
    'dayanaksız seviye ekranda dürüstçe işaretlenmeli',
  );

  // gerçek terminal onayı artık DEFTERDE — ikinci çağrı "zaten onaylı" der
  const rec = JSON.parse((await readFile(passportLogPath(dir), 'utf8')).trim()) as {
    source?: string;
    by: string;
  };
  assert.equal(rec.source, 'terminal');
  const d2 = fakeDeps('e');
  const res2 = await runVerify(dir, 'dosya-git-s1', d2);
  assert.equal(res2.approved, false);
  assert.ok(d2.lines.some((l) => l.includes('zaten insan onaylı')));
  assert.equal(d2.lines.some((l) => l.includes('kanal kaydı yok')), false);
});

test('rapor sayısı DEFTERDEN: dayanaksız "completed" madde onaylandı diye sayılmaz', async () => {
  const dir = await makeStateDir(claimsBirimli(), GOAL_TEK_SOZ);
  const deps = fakeDeps('e');
  await runVerify(dir, 'dosya-git-s1', deps); // sözün YALNIZ bir kaydı onaylı
  assert.ok(deps.lines.some((l) => l.includes('Teslim sözü: 0 / 1 madde onaylandı')));

  const d2 = fakeDeps('e');
  await runVerify(dir, 'test-s1-0', d2); // söz tamamlandı → defterle 1/1
  assert.ok(d2.lines.some((l) => l.includes('Teslim sözü: 1 / 1 madde onaylandı')));
});

test('GENİŞ SÖZ uyarısı: eşiği aşan kayıt sayısında soru öncesi lastik-damga uyarısı', async () => {
  const goal = '- [ ] test: testler yeşil\n';
  const cok: Claim[] = Array.from({ length: KALABALIK_ESIK + 1 }, (_, i) => ({
    id: `test-${i}`,
    text: `${i} test geçti (npm test).`,
    level: 'test-kaniti',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: '# pass' }],
    createdAt: `2026-07-28T10:${String(i).padStart(2, '0')}:00Z`,
  }));
  const dir = await makeStateDir(cok, goal);
  const deps = fakeDeps('h'); // uyarıyı görüp REDDEDEN insan
  const res = await runVerify(dir, sozId(goal), deps);

  assert.equal(res.approved, false);
  assert.ok(deps.lines.some((l) => l.includes(`bu söz ${KALABALIK_ESIK + 1} kaydı kapsıyor`)));
  assert.ok(deps.lines.some((l) => l.includes('onay olmaktan çıkar')));

  // eşiğin altında uyarı YOK (gürültü yapmaz)
  const az = await makeStateDir(cok.slice(0, 2), goal);
  const d2 = fakeDeps('h');
  await runVerify(az, sozId(goal), d2);
  assert.equal(d2.lines.some((l) => l.includes('kaydı kapsıyor')), false);
});
