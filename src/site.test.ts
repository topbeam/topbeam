/**
 * Landing (site/index.html) dürüstlük nöbetçisi.
 *
 * Landing, ürünün kendi kurallarına tabidir: çalışmayan komut kopyalatılmaz,
 * ölü link verilmez, kaynak linki yokken varmış gibi ima edilmez.
 * Bu testler o kuralları REGRESYONA karşı kilitler — sayfa elle düzenlenirken
 * yanlışlıkla eski hâle dönerse burada kırılır.
 *
 * Not: hiçbiri ağa çıkmaz; yalnız dosya metnini okur (Topbeam'in "ağ çağrısı yok"
 * kuralı testlerde de geçerli).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'index.html');
const html = readFileSync(SITE, 'utf8');

/**
 * Yorumlar kullanıcıya render EDİLMEZ; yayın-günü talimatı da bir yorumda duruyor.
 * Bu yüzden "sayfada ne var" soran testler yorumsuz metne bakar.
 */
const live = html.replace(/<!--[\s\S]*?-->/g, '');

/** data-copy="..." payload'larının tamamı (yalnız render edilen kısım). */
function copyPayloads(source: string): string[] {
  const out: string[] = [];
  const re = /data-copy="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1] ?? '');
  return out;
}

/** href="..." değerlerinin tamamı (yalnız render edilen kısım). */
function hrefs(source: string): string[] {
  const out: string[] = [];
  const re = /href="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1] ?? '');
  return out;
}

test('landing: kopyala butonu ÇALIŞMAYAN komut taşımaz (npx yayın öncesi kopyalatılmaz)', () => {
  const payloads = copyPayloads(live);
  assert.ok(payloads.length > 0, 'en az bir kopyala butonu bekleniyordu');
  for (const p of payloads) {
    assert.ok(
      !/\bnpx\b|\bnpm i\b|\bnpm install -g\b/.test(p),
      `yayın öncesi çalışmayan komut kopyalatılıyor: "${p}"`,
    );
  }
});

test('landing: npx komutu gösteriliyorsa "yayından sonra" işareti ve yayın durumu notu yanında', () => {
  // Paket adı Topbeam'e taşındı; eski ad da kontrol edilir ki landing hangi
  // adı taşırsa taşısın nöbetçi SUSMASIN (ad değişince kural sessizce düşmesin).
  if (!/npx (topbeam|ocean-code)/.test(html)) return; // komut kaldırıldıysa kural konusuz
  assert.match(html, /class="cmd soon"/, '.cmd.soon işareti yok — komut çalışıyormuş gibi duruyor');
  assert.match(html, /yayından sonra/, '"yayından sonra" etiketi yok');
  assert.match(html, /Yayın durumu:/, 'yayın durumu notu yok');
  assert.match(html, /henüz npm'e yayınlanmadı/, 'yayınlanmadığı açıkça yazmıyor');
});

test('landing: en az bir ÇALIŞAN yüksek-niyet yolu var (mailto)', () => {
  const mailtos = hrefs(live).filter((h) => h.startsWith('mailto:'));
  assert.ok(mailtos.length > 0, 'sayfada iletişim yolu yok — yüksek niyet ölü-sona çıkıyor');
  for (const m of mailtos) {
    assert.match(m, /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}/i, `geçersiz mailto: "${m}"`);
  }
});

test('landing: ölü apex link kullanılmaz (reveriajans.com apex A kaydı yok, www canlı)', () => {
  for (const h of hrefs(live)) {
    assert.ok(
      !/^https?:\/\/reveriajans\.com/i.test(h),
      `apex host çözülmüyor, www kullanılmalı: "${h}"`,
    );
  }
});

test('landing: dış istek yok — yalnız data: URI, mailto ve dış BAĞLANTI serbest', () => {
  // Kaynak yükleyen nitelikler: src=, @import, url(...) — hiçbiri dış hosta gitmemeli.
  const srcs = [...live.matchAll(/\bsrc="([^"]*)"/g)].map((m) => m[1] ?? '');
  for (const s of srcs) {
    assert.ok(!/^https?:\/\//i.test(s), `dış kaynak yükleniyor: "${s}"`);
  }
  assert.ok(!/@import/.test(html), 'CSS @import var — dış istek riski');
  const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map((m) => (m[1] ?? '').replace(/['"]/g, '').trim());
  for (const u of urls) {
    assert.ok(!/^https?:\/\//i.test(u), `CSS dış kaynak: "${u}"`);
  }
  // <link rel="icon"> gömülü data: URI olmalı (dosya isteği bile yok)
  const icon = live.match(/<link rel="icon" href="([^"]*)"/);
  if (icon) assert.ok((icon[1] ?? '').startsWith('data:'), 'favicon dış istek üretiyor');
});

test('landing: kaynak linki yokken "açık kaynak" imasi yapılmaz, MIT olgusu korunur', () => {
  assert.ok(!/Açık çekirdek · MIT|açık çekirdek · MIT/.test(html), '"açık çekirdek" rozeti kaynağı okuyabilirmiş gibi ima ediyor');
  assert.match(html, /MIT lisanslı çekirdek/, 'MIT olgusu (doğru) kayboldu');
  assert.match(html, /depo herkese açık değil/, 'deponun kapalı olduğu açıkça yazmıyor');
  // Söz vermeme kuralı: "yakında açılacak / yayınlanacak" taahhüdü landing'de olmayacak.
  assert.ok(
    !/(yakında|erken erişim sonrası|ilerleyen günlerde)[^.]{0,40}(açılacak|yayınlanacak)/i.test(html),
    'landing kaynak açma sözü veriyor — bu Ekin\'in kararı, sayfa taahhüt etmez',
  );
});

test('landing: yüzde-ilerleme ve hype dili yok (ürünün kendi kuralı)', () => {
  const body = html.slice(html.indexOf('<body>'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
  assert.ok(!/(%\s?\d+|\d+\s?%)/.test(text), 'gövde metninde yüzde ifadesi var');
  for (const w of ['devrim', 'sihir', 'mükemmel', 'garanti', 'inanılmaz', 'zahmetsiz']) {
    assert.ok(!text.toLowerCase().includes(w), `hype kelimesi: "${w}"`);
  }
});

test('landing: hareket yalnız prefers-reduced-motion:no-preference içinde tanımlı', () => {
  const motion = [...html.matchAll(/(transition|animation)\s*:/g)];
  if (motion.length === 0) return;
  const guard = html.indexOf('@media (prefers-reduced-motion:no-preference)');
  assert.ok(guard > -1, 'hareket var ama reduced-motion koruması yok');
  for (const m of motion) {
    assert.ok(
      (m.index ?? 0) > guard,
      'reduced-motion korumasının DIŞINDA hareket tanımı var',
    );
  }
});
