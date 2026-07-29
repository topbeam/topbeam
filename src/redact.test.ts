/** redact.ts testleri — secret maskeleme (BP deseni) + derin maskeleme. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep } from './redact.ts';

test('bilinen token desenleri maskelenir', () => {
  const cases = [
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_abcdefghijklmnopqrstuv123456',
    'sk-abcdefghijklmnopqrstuvwx',
    'xoxb-1234567890-abcdefghij',
    'API_KEY=cokgizlideger123',
    'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz',
  ];
  for (const c of cases) {
    const r = redact(`önce ${c} sonra`);
    assert.ok(r.hits >= 1, `maskelenmeliydi: ${c}`);
    assert.equal(r.text.includes(c), false, `ham secret kalmamalı: ${c}`);
  }
});

test('sıradan metin dokunulmadan geçer', () => {
  const s = 'src/login.ts dosyası değişti (+142/−8) — npm test yeşil.';
  const r = redact(s);
  assert.equal(r.hits, 0);
  assert.equal(r.text, s);
});

test('idempotent: maskelenmiş metin yeniden maskelenmez', () => {
  const once = redact('TOKEN=gizli-deger-12345 ve sk-abcdefghijklmnopqrstuvwx');
  const twice = redact(once.text);
  assert.equal(twice.hits, 0);
});

test('url içindeki kimlik bilgisi maskelenir', () => {
  const r = redact('git clone https://kullanici:parola@ornek.com/repo.git');
  assert.ok(r.hits >= 1);
  assert.equal(r.text.includes('parola'), false);
  assert.ok(r.text.includes('ornek.com'));
});

test('redactDeep: iç içe nesnelerdeki stringler maskelenir, yapı korunur', () => {
  const input = {
    id: 'test-1',
    evidence: [{ kind: 'test-output', ref: 'API_KEY=supersecret999 npm test' }],
    sayi: 42,
    bos: null,
  };
  const { value, hits } = redactDeep(input);
  assert.ok(hits >= 1);
  assert.equal(value.id, 'test-1');
  assert.equal(value.sayi, 42);
  assert.equal(value.bos, null);
  assert.equal(JSON.stringify(value).includes('supersecret999'), false);
  assert.ok(value.evidence[0]?.ref?.includes('npm test'));
});

// ── SIZINTI PROBE (2026-07-29 sertleştirme saldırısı) ───────────────────────
//
// Ajanların GERÇEKTEN sızdırdığı 12 vaka. Hepsi state.json + pano.html +
// MAKBUZ'a düz metin giriyordu. Makbuz dışarıya gösterilen belgedir; oraya
// sızan bir anahtar, ürünün "diske giden her metin maskelenir" sözünü çürütür.
test('SIZINTI PROBE: gerçek sızdıran 12 vakanın hiçbiri artık geçmiyor', () => {
  const vakalar: Array<[string, string]> = [
    ['curl -H "X-Api-Key: 9f8e7d6c5b4a39281706abcdef012345"', '9f8e7d6c'],
    ['curl -H "x-api-key: sekret_deger_1234567890"', 'sekret_deger'],
    ['npm test -- --api-key=9f8e7d6c5b4a39281706abcdef012345', '9f8e7d6c'],
    ['MYSQL_PWD=SuperGizli123 mysql -u root', 'SuperGizli123'],
    ['DB_PASS=SuperGizli123', 'SuperGizli123'],
    ['export OPENAI_KEY=abcd1234efgh5678', 'abcd1234'],
    ['mysql -u root -pSuperGizli123', 'SuperGizli123'],
    ['docker login -u ekin -p SuperGizli123 ghcr.io', 'SuperGizli123'],
    ['curl -u admin:GizliParola99 https://x', 'GizliParola99'],
    ['export ANTHROPIC_API_KEY=sk-ant-api03-AAAABBBBCCCCDDDDEEEE', 'sk-ant-api03'],
    ['SESSION_COOKIE=abc123def456ghi', 'abc123def456'],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG', 'wJalrXUt'],
  ];
  const sizanlar: string[] = [];
  for (const [girdi, sir] of vakalar) {
    if (redact(girdi).text.includes(sir)) sizanlar.push(girdi);
  }
  assert.deepEqual(sizanlar, [], `sır sızdı:\n${sizanlar.join('\n')}`);
});

test('SIZINTI PROBE: masum komutlar bozulmaz (yanlış-pozitif kontrolü)', () => {
  // Fazla maskeleme ücretsiz değil: kullanıcı kendi komutunu tanıyamazsa
  // pano işe yaramaz. Bu vakalar AYNEN kalmalı.
  for (const m of ['mkdir -p /tmp/x/y', 'npm test -- --reporter=dot', 'git commit -m "fix: pass tests"']) {
    assert.equal(redact(m).text, m, `masum komut bozuldu: ${m}`);
  }
});

test('SIZINTI PROBE: tek sır tek kez maskelenir (sayaç şişmez)', () => {
  // "7 parça maskelendi" derken gerçekte 4 sır vardı — sayı da bir iddiadır.
  const r = redact('export API_KEY=sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF');
  assert.equal(r.hits, 1, 'tek sır tek hit sayılmalı');
  assert.equal(r.text.includes('[MASKED]***[MASKED]'), false, 'çift maske olmamalı');
});
