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
