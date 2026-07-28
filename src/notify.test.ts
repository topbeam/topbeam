/** notify.ts testleri — osascript ÇAĞIRMADAN (bin/platform enjeksiyonu). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyMac } from './notify.ts';

test('darwin dışı platformda hiç denemez → false', async () => {
  const ok = await notifyMac('Topbeam', 'selam', { platform: 'linux', bin: '/usr/bin/true' });
  assert.equal(ok, false);
});

test('binary yoksa hata YUTULUR → false (fırlatmaz)', async () => {
  const ok = await notifyMac('Topbeam', 'selam', {
    platform: 'darwin',
    bin: '/boyle-bir-binary-yok-topbeam-test',
  });
  assert.equal(ok, false);
});

test('komut başarılıysa true (sahte bin: /usr/bin/true)', async () => {
  const ok = await notifyMac('Topbeam', 'ürün geliştirildi 🎉', { platform: 'darwin', bin: '/usr/bin/true' });
  assert.equal(ok, true);
});

test('komut hata verirse false (sahte bin: /usr/bin/false)', async () => {
  const ok = await notifyMac('Topbeam', 'selam', { platform: 'darwin', bin: '/usr/bin/false' });
  assert.equal(ok, false);
});

test('OCEAN_NO_NOTIFY=1 → hiç çalışmaz, false', async () => {
  const prev = process.env.OCEAN_NO_NOTIFY;
  process.env.OCEAN_NO_NOTIFY = '1';
  try {
    const ok = await notifyMac('Topbeam', 'selam', { platform: 'darwin', bin: '/usr/bin/true' });
    assert.equal(ok, false);
  } finally {
    if (prev === undefined) delete process.env.OCEAN_NO_NOTIFY;
    else process.env.OCEAN_NO_NOTIFY = prev;
  }
});

test('tırnaklı mesaj AppleScript stringini bozmaz (true bin ile sorunsuz)', async () => {
  const ok = await notifyMac('Topbeam "test"', 'mesaj "tırnaklı" \\ ters bölü', {
    platform: 'darwin',
    bin: '/usr/bin/true',
  });
  assert.equal(ok, true);
});
