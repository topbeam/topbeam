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
import { newOceanState, type Claim, type Verification } from './types.ts';
import { writeState, readState, passportLogPath } from './state.ts';
import { buildPassport } from './passport.ts';
import { approveClaim, insanKapisi, runVerify, type VerifyDeps } from './verify.ts';

const NOW = new Date('2026-07-28T15:00:00.000Z');

function claims2(): Claim[] {
  return [
    {
      id: 'dosya-git-s1', text: '1 dosya değişti: src/a.ts', level: 'dosya-kaniti', kind: 'dosya',
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

/** Aynı iki claim, ama AYNI oturuma bağlı → tek iş birimi (birim-s1). */
function claimsBirimli(): Claim[] {
  return claims2().map((c) => ({ ...c, sessionId: 's1' }));
}

async function makeStateDir(claims: Claim[] = claims2()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ocean-verify-'));
  const st = newOceanState('Verify Proje', NOW);
  st.claims = claims;
  st.passport = buildPassport([], st.claims);
  await writeState(dir, st);
  return dir;
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
  const dir = await mkdtemp(join(tmpdir(), 'ocean-verify-bos-'));
  const res = await runVerify(dir, 'x', fakeDeps('e'));
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('ocean init'));
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

  const item = st?.passport.find((p) => p.id === 'dosya-git-s1');
  assert.equal(item?.status, 'completed');
  assert.equal(item?.verification?.by, 'ekin');

  const logRaw = await readFile(passportLogPath(dir), 'utf8');
  const rec = JSON.parse(logRaw.trim()) as { claimId: string; levelBefore: string; levelAfter: string };
  assert.equal(rec.claimId, 'dosya-git-s1');
  assert.equal(rec.levelBefore, 'dosya-kaniti');
  assert.equal(rec.levelAfter, 'insan-onayi');

  // full-tik olmadan bildirim YOK
  assert.equal(deps.notifications.length, 0);

  // pano tazelendi
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('1/2 doğrulandı'));
});

test('tüm maddeler onaylanınca FULL-TİK: bildirim BİR KEZ, tekrarlanmaz', async () => {
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
  assert.ok(st?.log.some((e) => e.source === 'ocean' && e.text.includes('FULL-TİK')));

  // pano kutlama bandı
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('Ürün geliştirildi 🎉'));
  assert.ok(html.includes('2/2 doğrulandı'));

  // zaten onaylı claim'i tekrar verify → yeniden onay istenmez, bildirim yok
  const d3 = fakeDeps('e');
  const res3 = await runVerify(dir, 'test-s1-0', d3);
  assert.equal(res3.approved, false);
  assert.equal(d3.notifications.length, 0);
  assert.ok(d3.lines.some((l) => l.includes('zaten insan onaylı')));
});

// ── iş birimi onayı (FULL-TİK'i erişilebilir kılan yol) ─────────────────────

test('iş birimi id\'si ile onay: birimdeki TÜM kayıtlar tek soruda geçer, hepsi ekrana dökülür', async () => {
  const dir = await makeStateDir(claimsBirimli());
  const deps = fakeDeps('e');
  const res = await runVerify(dir, 'birim-s1', deps);
  assert.equal(res.ok, true);
  assert.equal(res.approved, true);

  // KÖR ONAY YOK: iki iddia da soru sorulmadan önce gösterildi
  assert.ok(deps.lines.some((l) => l.includes('1 dosya değişti')));
  assert.ok(deps.lines.some((l) => l.includes('19 test geçti')));
  assert.ok(deps.lines.some((l) => l.includes('İş birimi')));

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

  // tek birim tamamen onaylandı → FULL-TİK
  assert.equal(res.fullTick, true);
  assert.equal(res.notified, true);
});

test('birimin tek kaydını onaylamak birimi "tamam" YAPMAZ (partial, dürüst sayım)', async () => {
  const dir = await makeStateDir(claimsBirimli());
  const res = await runVerify(dir, 'dosya-git-s1', fakeDeps('e'));
  assert.equal(res.approved, true);
  assert.equal(res.fullTick, false);

  const st = await readState(dir);
  assert.equal(st?.passport.length, 1);
  assert.equal(st?.passport[0]?.status, 'partial');
  assert.ok(st?.passport[0]?.reason?.includes('1/2'));
  const html = await readFile(join(dir, '.ocean', 'pano.html'), 'utf8');
  assert.ok(html.includes('0/1 doğrulandı')); // yarısı onaylı birim "doğrulandı" sayılmaz
});

test('birim onayında red (H): hiçbir kayıt yükselmez', async () => {
  const dir = await makeStateDir(claimsBirimli());
  const res = await runVerify(dir, 'birim-s1', fakeDeps('h'));
  assert.equal(res.approved, false);
  const st = await readState(dir);
  assert.ok(st?.claims.every((c) => c.level !== 'insan-onayi'));
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'));
});

test('bilinmeyen id hatası iş birimlerini de gösterir (yol tarif eder)', async () => {
  const dir = await makeStateDir(claimsBirimli());
  const res = await runVerify(dir, 'olmayan-id', fakeDeps('e'));
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('birim-s1'));
  assert.ok(res.error?.includes('2 kayıt'));
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
  assert.notEqual(st?.passport.find((p) => p.id === 'dosya-git-s1')?.status, 'completed');
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
  assert.equal(st?.passport.find((p) => p.id === 'dosya-git-s1')?.verification?.source, 'terminal');

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
