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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site', 'index.html');
const html = readFileSync(SITE, 'utf8');

/** Gerçek paket kimliği — landing iddiaları buna karşı sınanır (tek doğru kaynak). */
const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  repository?: { url?: string };
};
const PKG_NAME = pkgJson.name;
const PKG_VERSION = pkgJson.version;

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

test('landing: kopyalatılan kurulum komutu BİZİM paketimizi kurar (yabancı paket kurdurma yasağı)', () => {
  // 2026-07-29 yayınından ÖNCE bu kural "npx hiç kopyalatılmaz" idi (paket yoktu).
  // Paket yayında olduğu için kural yön değiştirdi ama GEVŞEMEDİ: kopyalanan komut
  // ziyaretçinin makinesinde çalışacak — bizim adımızdan BAŞKA bir paket adı
  // kopyalatmak, yabancının kodunu kurdurmak demektir (ad geçişinde yaşanan risk).
  const payloads = copyPayloads(live);
  assert.ok(payloads.length > 0, 'en az bir kopyala butonu bekleniyordu');
  const re = /\b(?:npx(?:\s+--yes)?|npm\s+i(?:nstall)?(?:\s+-g)?)\s+(?:--\S+\s+)*([@\w./-]+)/;
  for (const p of payloads) {
    const m = re.exec(p);
    if (m === null) continue; // kurulum komutu değil (ör. `topbeam sync`)
    const pkg = (m[1] ?? '').replace(/@[^/@]+$/, ''); // sürüm ekini at
    assert.equal(pkg, PKG_NAME, `kopyala butonu BAŞKA paketi kurduruyor: "${p}"`);
  }
});

test('landing: yayın durumu GERÇEĞİ söyler (yayındayken "yayınlanmadı" yazamaz, tersi de)', () => {
  // Paket adı Topbeam'e taşındı; eski ad da kontrol edilir ki landing hangi
  // adı taşırsa taşısın nöbetçi SUSMASIN (ad değişince kural sessizce düşmesin).
  if (!/npx (topbeam|ocean-code)/.test(html)) return; // komut kaldırıldıysa kural konusuz
  // Sayfa, kurulum komutunu çalışır gibi sunuyorsa yayın-öncesi dilinden ESER kalmamalı.
  for (const eski of [/class="cmd soon"/, /yayından sonra/, /henüz npm'e yayınlanmadı/]) {
    assert.ok(!eski.test(live), `paket yayındayken yayın-öncesi ifadesi duruyor: ${eski}`);
  }
  // Ve yayın iddiası package.json'daki GERÇEK sürümle birebir eşleşmeli.
  assert.match(live, /Yayında:/, 'yayın durumu notu yok');
  assert.ok(
    live.includes(`${PKG_NAME}@${PKG_VERSION}`),
    `landing sürümü package.json ile uyuşmuyor (beklenen ${PKG_NAME}@${PKG_VERSION})`,
  );
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

test('landing: "kaynak açık" iddiası GERÇEK depoya bağlı (tıklanabilir link + package.json ile aynı depo)', () => {
  // 2026-07-29 open-core kararından ÖNCE bu kural "depo kapalı olduğunu açıkça yaz"
  // idi. Depo public olduğu için kural yön değiştirdi ama GEVŞEMEDİ: açık-kaynak
  // iddiası ancak okunabilir bir depoya işaret ediyorsa dürüsttür.
  assert.match(html, /MIT lisanslı çekirdek/, 'MIT olgusu (doğru) kayboldu');
  assert.ok(!/depo herkese açık değil/.test(live), 'depo public iken "kapalı" yazıyor');

  // Sayfa kaynağın açık olduğunu söylüyorsa, tıklanabilir depo linki ŞART.
  if (/[Kk]aynak açık|açık kaynak/.test(live)) {
    const repo = hrefs(live).find((h) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(h));
    assert.ok(repo !== undefined, '"kaynak açık" deniyor ama tıklanabilir depo linki yok');
    // Link, paketin beyan ettiği depoyla AYNI olmalı — başka bir depoyu
    // "bizim kaynağımız" diye göstermek yabancı-paket riskinin ikizidir.
    const beyan = (pkgJson.repository?.url ?? '')
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    assert.equal(
      repo.replace(/\/$/, ''),
      beyan,
      `landing'deki depo package.json'daki depoyla aynı değil (beyan: ${beyan})`,
    );
  }

  // Söz vermeme kuralı: sayfa gelecek için taahhüt etmez (karar Ekin'in).
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
