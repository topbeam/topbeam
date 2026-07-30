/**
 * makbuz.ts testleri — makbuz ürünün DIŞARIYA giden yüzüdür; buradaki
 * invaryantlar gevşerse ürün yalan söyler.
 *
 * Kilitlenen dürüstlük kuralları:
 *  1. Onaysız madde ONAYLI görünmez (defter kapısı — ledger.ts).
 *  2. SHA'lar ve komutlar state'ten gelir; uydurma yok.
 *  3. Hiçbir şey onaylı değilken makbuz yine üretilir ama durumunu söyler.
 *  4. Markdown tek başına okunur (yapıştırılabilir) ve deterministiktir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Claim, LogEntry, PassportItem, ScopeNotes } from './types.ts';
import { newOceanState } from './types.ts';
import { BOS_LEDGER, buildLedger } from './ledger.ts';
import {
  COMMIT_MAX,
  ciKayitlari,
  commitKayitlari,
  headKimlikleri,
  kanitOzeti,
  makbuzHtml,
  makbuzMetni,
  runMakbuz,
  sonTestKaydi,
  sozSatirlari,
  type MakbuzGirdi,
} from './makbuz.ts';
import { writeState } from './state.ts';

const AT = '2026-07-29T14:03:00.000Z';

function defter(claimIds: readonly string[], by = 'ekin') {
  return buildLedger(
    claimIds.map((claimId) => ({
      schema_version: 2,
      at: AT,
      claimId,
      title: 'onaylanan iş',
      decision: 'approved',
      by,
      source: 'terminal',
      levelBefore: 'test-kaniti',
      levelAfter: 'insan-onayi',
    })),
  );
}

const claims: Claim[] = [
  {
    id: 'c1',
    text: '3 dosya değişti: src/auth/login.ts',
    level: 'dosya-kaniti',
    kind: 'dosya',
    signals: { fileCount: 3, paths: ['src/auth/login.ts'] },
    evidence: [
      { kind: 'transcript-tool-use', summary: 'Transcript: 3 dosyada Edit hatasız.', ref: 'oturum-1' },
      { kind: 'git-diff', summary: 'git: 3 dosyanın kaydı var.', ref: '3e8cb9c' },
    ],
    createdAt: '2026-07-28T10:00:00Z',
  },
  {
    id: 'c2',
    text: '299 test geçti, 0 başarısız (npm test).',
    level: 'test-kaniti',
    kind: 'test',
    signals: { passedTests: 299, failedTests: 0 },
    evidence: [{ kind: 'test-output', summary: '# pass 299', ref: 'npm test' }],
    createdAt: '2026-07-28T11:00:00Z',
  },
  {
    id: 'c3',
    text: '2 dosya için düzenleme kaydı var ama git\'te izi yok — doğrulanmadı: src/x.ts',
    level: 'dogrulanmadi',
    kind: 'dosya',
    signals: { fileCount: 2, paths: ['src/x.ts'], noGitTrace: true },
    evidence: [{ kind: 'transcript-tool-use', summary: 'Transcript: 2 dosyada Edit.', ref: 'oturum-1' }],
    createdAt: '2026-07-28T12:00:00Z',
  },
];

const log: LogEntry[] = [
  {
    ts: '2026-07-29T02:36:00Z',
    text: 'Commit: Sisifos barı bitti: bar goal.md sözlerinden kuruluyor (3e8cb9c)',
    source: 'git',
    ref: '3e8cb9c',
  },
  {
    ts: '2026-07-28T21:04:00Z',
    text: 'Commit: denetlenebilirlik tamiri (ea01c1c)',
    source: 'git',
    ref: 'ea01c1c',
  },
  { ts: '2026-07-28T20:00:00Z', text: 'Beyan: kart tamir edildi', source: 'claude-beyan' },
];

const items: PassportItem[] = [
  {
    id: 'soz-a',
    title: 'Giriş akışı çalışıyor src/auth',
    status: 'not_verified',
    claimIds: ['c1'],
    level: 'dosya-kaniti',
    reason: '1 kayıt eşleşti — insan onayı yok.',
  },
  {
    id: 'soz-b',
    title: 'test: testler yeşil',
    status: 'completed',
    claimIds: ['c2'],
    level: 'insan-onayi',
    reason: '1 kayıt insan onaylı.',
  },
  {
    id: 'soz-c',
    title: 'Hata durumları insan diliyle anlatılıyor',
    status: 'not_verified',
    claimIds: [],
    level: 'dogrulanmadi',
    reason: 'Kanıt yok — bu söze bağlanacak ipucu yazılmamış (yol, `test:` ya da #etiket).',
  },
];

const scope: ScopeNotes = {
  disKapsamDuzenleme: 12,
  atlananOturum: 1,
  kontrolKomutu: 4,
  kisaltilanYol: 3,
  gitYok: false,
  log: {
    hamToplam: 454,
    hamKanit: 300,
    hamBeyan: 154,
    ilgisizBeyan: 40,
    tekillestirilen: 210,
    kirpilan: 4,
    tutulan: 200,
  },
  notlar: ['2 eski claim yeniden üretilmedi.'],
};

function girdi(over: Partial<MakbuzGirdi> = {}): MakbuzGirdi {
  return {
    projectName: 'Deneme Proje',
    at: AT,
    items,
    claims,
    log,
    ledger: defter(['c2']),
    scope,
    toolVersion: '0.1.0',
    goalText: 'Vibe coder için dürüst proje panosu.',
    testKomutu: 'npm test',
    ci: [],
    ...over,
  };
}

// ── 1. ONAYSIZ MADDE ONAYLI GÖRÜNMEZ ────────────────────────────────────────

test('ONAYSIZ MADDE ONAYLI GÖRÜNMEZ: defter kaydı olmayan madde tik ALMAZ', () => {
  // soz-b state'te 'completed' + 'insan-onayi' diyor ama defter BOŞ.
  const m = makbuzMetni(girdi({ ledger: BOS_LEDGER }));
  assert.ok(m.includes('- [ ] **2. test: testler yeşil**'), 'tik verilmemeli');
  assert.equal(m.includes('- [x]'), false, 'defter boşken hiçbir madde tikli olamaz');
  assert.ok(m.includes('human approval NOT CONFIRMED'), 'neden söylenmeli');
  assert.ok(m.includes('0 / 3 human-approved'));
  assert.equal(m.includes('HUMAN APPROVED'), false);
});

test('defterle desteklenen madde tik ALIR — imza ve tarih defterden gelir', () => {
  const m = makbuzMetni(girdi());
  assert.ok(m.includes('- [x] **2. test: testler yeşil**'));
  assert.ok(m.includes('HUMAN APPROVED — ekin · 2026-07-29 14:03 (terminal signature · .ocean/passport.jsonl)'));
  assert.ok(m.includes('1 / 3 human-approved'));
  // Onaysız iki madde tik almamalı
  assert.ok(m.includes('- [ ] **1. Giriş akışı çalışıyor src/auth**'));
  assert.ok(m.includes('- [ ] **3. Hata durumları insan diliyle anlatılıyor**'));
});

test('sozSatirlari: onay YALNIZ defterden — status alanı tek başına yetmez', () => {
  const bos = sozSatirlari(items, claims, BOS_LEDGER);
  assert.deepEqual(
    bos.map((r) => r.onayli),
    [false, false, false],
  );
  const dolu = sozSatirlari(items, claims, defter(['c2']));
  assert.deepEqual(
    dolu.map((r) => r.onayli),
    [false, true, false],
  );
  // Kaydı olmayan söz: "kayıt yok" der, kanıt uydurmaz.
  assert.equal(dolu[2]?.kanit, 'no records');
  assert.equal(dolu[0]?.kanit, '1 records (1 file evidence)');
});

test('HTML de aynı kapıdan geçer: onaysız madde HTML makbuzda da tiksiz', () => {
  const h = makbuzHtml(girdi({ ledger: BOS_LEDGER }));
  assert.equal(h.includes('[x]'), false);
  assert.ok(h.includes('human approval NOT CONFIRMED'));
  assert.ok(h.includes('No item is human-approved yet'));
});

// ── 2. SHA'LAR GERÇEK STATE'TEN GELİR ───────────────────────────────────────

test("SHA'LAR STATE'TEN: makbuzdaki her `git show` kimliği log'daki gerçek commit", () => {
  const m = makbuzMetni(girdi());
  const shalar = [...m.matchAll(/git show ([0-9a-f]{7,40}) --stat/g)].map((x) => x[1]);
  assert.deepEqual(shalar, ['3e8cb9c', 'ea01c1c'], 'sıra en yeni önce, uydurma yok');
  for (const sha of shalar) {
    assert.ok(
      log.some((e) => e.ref === sha),
      `${sha} log'daki bir commit kaydından gelmeli`,
    );
  }
  assert.ok(m.includes('`3e8cb9c`  2026-07-29  Sisifos barı bitti'), 'özet ve tarih de state\'ten');
});

test('commit kaydı YOKSA SHA UYDURULMAZ: HEAD kimliğine düşer, o da yoksa "kayıt yok"', () => {
  // git-diff kanıtı var (HEAD kimliği ölçülmüş) ama commit log satırı yok.
  const sadeceHead = makbuzMetni(girdi({ log: [] }));
  assert.ok(sadeceHead.includes('Commits: no summary on record'));
  assert.ok(sadeceHead.includes('git show 3e8cb9c --stat'));
  assert.ok(sadeceHead.includes('the HEAD at the moment the records were measured'));

  // Hiçbir git kanıtı yok → tek bir SHA bile yazılmamalı.
  const hicbiri = makbuzMetni(girdi({ log: [], claims: [claims[1] as Claim] }));
  assert.ok(hicbiri.includes('Commits: no record'));
  assert.equal(/git show \S/.test(hicbiri), false, 'kaynağı olmayan SHA yazılamaz');
  assert.equal(/[0-9a-f]{7,40}/.test(hicbiri.split('## Evidence summary')[1] ?? ''), false);
});

test('commitKayitlari: yalnız git kaynaklı + gerçek kimlikli satırlar, en yeni önce', () => {
  const bozuk: LogEntry[] = [
    ...log,
    { ts: '2026-07-29T03:00:00Z', text: 'Commit: sahte (zzz)', source: 'git', ref: 'zzz' },
    { ts: '2026-07-29T04:00:00Z', text: 'Beyan: commit attım (abcdef1)', source: 'claude-beyan', ref: 'abcdef1' },
  ];
  const c = commitKayitlari(bozuk);
  assert.deepEqual(
    c.map((x) => x.sha),
    ['3e8cb9c', 'ea01c1c'],
    'hex olmayan ref ve beyan satırı commit sayılmaz',
  );
  assert.equal(c[0]?.ozet, 'Sisifos barı bitti: bar goal.md sözlerinden kuruluyor');
});

test('headKimlikleri: yalnız git-diff kanıtındaki gerçek kimlikler', () => {
  assert.deepEqual(headKimlikleri(claims), ['3e8cb9c']);
  assert.deepEqual(headKimlikleri([claims[2] as Claim]), []);
});

test('commit listesi tek sayfa sınırını aşmaz ama toplamı DÜRÜSTÇE yazar', () => {
  const cok: LogEntry[] = Array.from({ length: 12 }, (_, i) => ({
    ts: `2026-07-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
    text: `Commit: iş ${i} (${String(i).repeat(7)})`,
    source: 'git' as const,
    ref: String(i).repeat(7),
  }));
  const m = makbuzMetni(girdi({ log: cok }));
  assert.ok(m.includes(`- Commits: showing ${COMMIT_MAX} records (12 in state)`));
});

test('test komutu PROJEDEN gelir; yoksa uydurulmaz', () => {
  assert.ok(makbuzMetni(girdi()).includes('\nnpm test\n'));
  const yok = makbuzMetni(girdi({ testKomutu: null }));
  assert.ok(yok.includes('no test command on record'));
  assert.equal(yok.includes('\nnpm test\n'), false);
});

test('son test ölçümü ölçülmüş kayıttan gelir; test kaydı yoksa "kayıt yok"', () => {
  assert.equal(sonTestKaydi(claims)?.id, 'c2');
  assert.equal(sonTestKaydi([claims[0] as Claim]), null);
  assert.ok(makbuzMetni(girdi()).includes('- Last test measurement: 299 test geçti, 0 başarısız (npm test).'));
  assert.ok(
    makbuzMetni(girdi({ claims: [claims[0] as Claim] })).includes('- Last test measurement: no record'),
  );
});

test('kanıt özeti: her kayıt TEK kovaya girer, insan onayı defterden sayılır', () => {
  const o = kanitOzeti(claims, defter(['c2']));
  assert.deepEqual(o, { toplam: 3, dosya: 1, test: 0, dogrulanmadi: 1, insanOnayi: 1, kaynaksiz: 0 });
  assert.equal(o.dosya + o.test + o.dogrulanmadi + o.insanOnayi + o.kaynaksiz, o.toplam);

  // Kendini insan onaylı sayan ama defterde karşılığı olmayan kayıt: ayrı kova.
  const sahte: Claim[] = [{ ...(claims[1] as Claim), level: 'insan-onayi' }];
  const o2 = kanitOzeti(sahte, BOS_LEDGER);
  assert.equal(o2.insanOnayi, 0);
  assert.equal(o2.kaynaksiz, 1);
  assert.ok(makbuzMetni(girdi({ claims: sahte, ledger: BOS_LEDGER })).includes('no channel record: 1'));
});

// ── 3. BOŞ DURUMDA DÜRÜST METİN ─────────────────────────────────────────────

test('BOŞ DURUM: kayıt da söz de yokken makbuz yine üretilir ve durumunu söyler', () => {
  const m = makbuzMetni({
    projectName: 'Bomboş',
    at: AT,
    items: [],
    claims: [],
    log: [],
    ledger: BOS_LEDGER,
    toolVersion: '0.1.0',
  });
  assert.ok(m.startsWith('# Delivery Receipt — Bomboş'));
  assert.ok(m.includes('No delivery promise has been written in this project'));
  assert.ok(m.includes('- Records (claims): 0 in total'));
  assert.ok(m.includes('Approval ledger: .ocean/passport.jsonl is missing — no record counted as human-approved'));
  assert.ok(m.includes('- Last test measurement: no record'));
  assert.ok(m.includes('- Commits: no record'));
  assert.ok(m.includes('No scope record'), 'scope yoksa sayı uydurulmaz');
  assert.ok(m.includes('## What this receipt does NOT mean'));
  // Sahte mühür/rozet yok
  for (const yasak of ['Seal', '🎉', 'Topped out', 'Congratulations', 'successfully']) {
    assert.equal(m.includes(yasak), false, `boş makbuz '${yasak}' içermemeli`);
  }
});

test('BOŞ PASAPORT iki ayrı gerçek: "yazılmamış" ile "senkronlanmamış" karıştırılmaz', () => {
  const ortak = { projectName: 'P', at: AT, items: [], claims: [], log: [], ledger: BOS_LEDGER, toolVersion: '0.1.0' };
  const hicYok = makbuzMetni(ortak);
  assert.ok(hicYok.includes('No delivery promise has been written in this project'));

  // goal.md'de söz VAR ama state'e işlenmemiş: insanın sözü "yok" sayılamaz.
  const senksiz = makbuzMetni({ ...ortak, goalSozSayisi: 7 });
  assert.ok(senksiz.includes('7 delivery promises are written in'));
  assert.ok(senksiz.includes('topbeam sync'));
  assert.equal(senksiz.includes('No delivery promise has been written in this project'), false);
  assert.ok(makbuzHtml({ ...ortak, goalSozSayisi: 7 }).includes('7 delivery promises are written in'));
});

test('söz VAR ama hiçbiri onaylı DEĞİL: makbuz "teslim onayı değildir" der', () => {
  const m = makbuzMetni(girdi({ ledger: BOS_LEDGER }));
  assert.ok(m.includes('**No item is human-approved yet.**'));
  assert.ok(m.includes('This receipt is NOT a delivery approval'));
});

// ── 4. MARKDOWN YAPIŞTIRILABİLİR (BAĞIMSIZ OKUNUR) ──────────────────────────

test('MARKDOWN YAPIŞTIRILABİLİR: tek sayfa, HTML yok, tek başına okunur', () => {
  const m = makbuzMetni(girdi());
  // Markdown iskeleti tam
  assert.ok(m.startsWith('# Delivery Receipt — Deneme Proje'));
  for (const bolum of [
    '## Delivery promises',
    '## Evidence summary',
    '## Check it yourself (for a third party)',
    '## What this receipt does not know (scope)',
    '## What this receipt does NOT mean',
  ]) {
    assert.ok(m.includes(bolum), `${bolum} bölümü olmalı`);
  }
  // Yapıştırılınca bozulacak HTML/stil kalıntısı yok
  for (const html of ['<div', '<span', '<style', '<!doctype', '</p>']) {
    assert.equal(m.toLowerCase().includes(html), false, `markdown '${html}' içermemeli`);
  }
  // Bağımsız okunur: başka bir dosyaya bakmadan ne olduğu anlaşılır; pano
  // gerektirmez. (Adı geçen dosyalar doğrulama içindir, ön koşul değil.)
  assert.equal(m.includes('pano.html'), false);
  assert.ok(m.includes('summarises evidence; it does not claim a result'));
  // Kod bloğu kapanmış (yapıştırılan yerde biçim bozulmasın)
  assert.equal((m.match(/```/g) ?? []).length % 2, 0);
});

test('makbuzda hype/yüzde/ilerleme dili YOK', () => {
  const m = makbuzMetni(girdi());
  assert.equal(/%\s?\d/.test(m), false, 'yüzde yok');
  assert.equal(/\d+\s?%/.test(m), false, 'yüzde yok');
  for (const yasak of ['Congratulations', 'Awesome', 'perfect', 'successfully', 'progress recorded']) {
    assert.equal(m.includes(yasak), false, `makbuz '${yasak}' içermemeli`);
  }
});

test('deterministik: aynı girdi → aynı metin (md ve html)', () => {
  assert.equal(makbuzMetni(girdi()), makbuzMetni(girdi()));
  assert.equal(makbuzHtml(girdi()), makbuzHtml(girdi()));
});

test('kapsam bloğu ölçülmüş sayıları taşır (bilmedikleri gizlenmez)', () => {
  const m = makbuzMetni(girdi());
  assert.ok(m.includes('Edits outside the project: 12'));
  assert.ok(m.includes('Check commands that produce no record: 4'));
  assert.ok(m.includes('Log line chain: raw 454 lines'));
  const gitsiz = makbuzMetni(girdi({ scope: { ...scope, gitYok: true } }));
  assert.ok(gitsiz.includes('this directory is not a git repository'));
});

test('CI kaydı yoksa KAPSAMLI dürüst cümle ("bu makbuzda yok"), varsa bağlantı yazılır', () => {
  // "CI yok" demez — yalnız kendi gördüğü hakkında konuşur (bilinmiyor ≠ yok).
  assert.ok(makbuzMetni(girdi()).includes('CI runs: no CI record in this receipt'));
  const ciVar = makbuzMetni(
    girdi({ ci: [{ ad: 'node-test', url: 'https://example.invalid/run/1', durum: 'geçti' }] }),
  );
  assert.ok(ciVar.includes('node-test (geçti): https://example.invalid/run/1'));
});

test('CI kayıtları claim olarak geldiğinde makbuz onları GÖRÜR (yanlışlıkla "yok" demez)', () => {
  // collect/ci.ts CI gerçeklerini `ci-…` id'li claim olarak üretir.
  const ciClaim: Claim = {
    id: 'ci-yesil-3e8cb9c',
    text: 'CI yeşil: 1 workflow 3e8cb9c commit’inde başarılı (test).',
    level: 'test-kaniti',
    kind: 'test',
    evidence: [{ kind: 'test-output', summary: 'GitHub Actions: success' }],
    createdAt: '2026-07-29T01:00:00Z',
  };
  const m = makbuzMetni(girdi({ claims: [...claims, ciClaim] }));
  assert.equal(m.includes('no CI record in this receipt'), false, 'kayıt varken "yok" denemez');
  assert.ok(m.includes('- CI runs: 1 records'));
  assert.ok(m.includes('CI yeşil: 1 workflow'));
  assert.ok(makbuzHtml(girdi({ claims: [...claims, ciClaim] })).includes('CI runs: 1 records'));
  assert.deepEqual(ciKayitlari([...claims, ciClaim]).map((c) => c.id), ['ci-yesil-3e8cb9c']);
});

test('"ağ yok" iddiası KAPSAMLI: makbuz üretimi için söylenir, ürünün tamamı için değil', () => {
  const m = makbuzMetni(girdi());
  assert.ok(m.includes('nothing left this machine while the receipt was produced'));
  assert.equal(/deterministic summary: no LLM, no network/.test(m), false, 'kapsamsız iddia kalmamalı');
});

test('HTML tek dosya: dış istek yok (script/link/img/font yok), başlık ve içerik yerinde', () => {
  const h = makbuzHtml(girdi());
  assert.ok(h.startsWith('<!doctype html>'));
  assert.ok(h.includes('<title>Delivery Receipt — Deneme Proje</title>'));
  for (const disistek of ['<script', '<link', '<img', '@import', 'src=', 'https://fonts']) {
    assert.equal(h.includes(disistek), false, `HTML '${disistek}' içermemeli (0 dış istek)`);
  }
  assert.ok(h.includes('git show 3e8cb9c --stat'), 'doğrulama adımları HTML\'de de var');
  assert.ok(h.includes('What this receipt does NOT mean'));
});

test('HTML kaçışı: madde metnindeki < > & kaçırılır (enjeksiyon yok)', () => {
  const h = makbuzHtml(
    girdi({
      items: [
        { id: 'soz-x', title: '<script>alert(1)</script> & co', status: 'not_verified', claimIds: [], level: 'dogrulanmadi' },
      ],
    }),
  );
  assert.equal(h.includes('<script>alert(1)'), false);
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co'));
});

// ── uçtan uca: topbeam makbuz ───────────────────────────────────────────────

test('runMakbuz: state\'ten dosyayı yazar, --html ikinci dosyayı üretir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-makbuz-'));
  const st = newOceanState('MakbuzProje', new Date('2026-07-28T10:00:00Z'));
  st.claims = claims;
  st.log = log;
  st.passport = items;
  st.scope = scope;
  await writeState(dir, st);

  const res = await runMakbuz(dir, { now: new Date(AT), html: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.mdPath, join(dir, '.ocean', 'makbuz.md'));
  assert.equal(res.htmlPath, join(dir, '.ocean', 'makbuz.html'));
  assert.equal(res.sozToplam, 3);
  // passport.jsonl YOK → hiçbir madde onaylı sayılmaz (fail-closed).
  assert.equal(res.sozOnayli, 0);

  const md = await readFile(res.mdPath as string, 'utf8');
  assert.ok(md.startsWith('# Delivery Receipt — MakbuzProje'));
  assert.equal(md.includes('- [x]'), false, 'defter yokken tik olamaz');
  assert.ok(md.includes('git show 3e8cb9c --stat'));
  const html = await readFile(res.htmlPath as string, 'utf8');
  assert.ok(html.includes('<title>Delivery Receipt — MakbuzProje</title>'));
});

test('runMakbuz: --html verilmezse HTML dosyası ÜRETİLMEZ', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-makbuz-md-'));
  const st = newOceanState('SadeceMd', new Date('2026-07-28T10:00:00Z'));
  await writeState(dir, st);
  const res = await runMakbuz(dir, { now: new Date(AT) });
  assert.equal(res.ok, true);
  assert.equal(res.htmlPath, undefined);
  await assert.rejects(() => readFile(join(dir, '.ocean', 'makbuz.html'), 'utf8'));
});

test('runMakbuz: state yoksa dürüstçe reddeder (uydurma makbuz yok)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-makbuz-yok-'));
  const res = await runMakbuz(dir, { now: new Date(AT) });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /topbeam init/);
});

test('runMakbuz: sır maskeleme kapısı makbuzda da açık (dışarı giden dosya)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topbeam-makbuz-sir-'));
  const st = newOceanState('SirProje', new Date('2026-07-28T10:00:00Z'));
  st.claims = [
    {
      id: 'c-sir',
      text: 'Anahtar yazıldı: sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM',
      level: 'dogrulanmadi',
      kind: 'dosya',
      evidence: [],
      createdAt: '2026-07-28T09:00:00Z',
    },
  ];
  st.passport = [
    { id: 'soz-s', title: 'Gizli anahtar depoda değil', status: 'not_verified', claimIds: ['c-sir'], level: 'dogrulanmadi' },
  ];
  await writeState(dir, st);
  await runMakbuz(dir, { now: new Date(AT) });
  const md = await readFile(join(dir, '.ocean', 'makbuz.md'), 'utf8');
  assert.equal(md.includes('sk-ant-api03-AAAABBBB'), false, 'sır makbuza sızmamalı');
});
