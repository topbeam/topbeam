/**
 * DİZE UYGULAMA KOŞUMU — sessiz başarısızlık İMKÂNSIZ.
 *
 * Neden var: 300+ dizeyi elle değiştirmek, sessizce eşleşmeyen bir dizeyi
 * kaçırmaya davetiyedir. Kaçan dize = yarı Türkçe yarı İngilizce bir yüzey,
 * yani okurun ilk 10 saniyede gördüğü özensizlik.
 *
 * Kural: HER dize ya uygulanır ya da RAPOR EDİLİR. Eşleşmeyen tek dize varsa
 * hiçbir dosya YAZILMAZ (all-or-nothing) — yarım uygulanmış yüzey en kötüsü.
 *
 * Kullanım: node scripts/dize-uygula.mjs <dizeler.json> [--yaz]
 *   --yaz olmadan: KURU KOŞU (ne olacağını söyler, dosyaya dokunmaz)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , girdi, ...bayraklar] = process.argv;
if (!girdi) {
  console.error('Kullanım: node scripts/dize-uygula.mjs <dizeler.json> [--yaz]');
  process.exit(1);
}
const yaz = bayraklar.includes('--yaz');
const kok = process.cwd();
const dizeler = JSON.parse(readFileSync(girdi, 'utf8'));

/** dosya → [{turkce, ingilizce}] */
const gruplar = new Map();
for (const d of dizeler) {
  const dosya = String(d.dosya).split(':')[0].trim();
  if (!gruplar.has(dosya)) gruplar.set(dosya, []);
  gruplar.get(dosya).push(d);
}

const eslesmeyen = [];
const planlanan = new Map();
let toplamDegisim = 0;

for (const [dosya, liste] of gruplar) {
  const yol = join(kok, dosya);
  if (!existsSync(yol)) {
    for (const d of liste) eslesmeyen.push(`${dosya} — DOSYA YOK`);
    continue;
  }
  let metin = readFileSync(yol, 'utf8');
  for (const d of liste) {
    const eski = d.turkce;
    const yeni = d.ingilizce;
    if (eski === '(tam dosya)') {
      metin = yeni;               // README gibi tam-dosya değişimi
      toplamDegisim++;
      continue;
    }
    if (!metin.includes(eski)) {
      eslesmeyen.push(`${dosya} — eşleşmedi: ${JSON.stringify(eski.slice(0, 70))}`);
      continue;
    }
    // Kaç kez geçiyor? Birden fazlaysa hepsi değişir ama SÖYLENİR.
    const kac = metin.split(eski).length - 1;
    if (kac > 1) console.log(`  ⓘ ${dosya}: "${eski.slice(0, 40)}…" ${kac} yerde geçiyor, hepsi değişecek`);
    metin = metin.split(eski).join(yeni);
    toplamDegisim++;
  }
  planlanan.set(yol, metin);
}

console.log(`\n${toplamDegisim}/${dizeler.length} dize uygulanabilir · ${eslesmeyen.length} eşleşmedi`);
if (eslesmeyen.length > 0) {
  console.error('\n✖ EŞLEŞMEYENLER (hiçbir dosya yazılmadı):');
  for (const e of eslesmeyen.slice(0, 40)) console.error(`   - ${e}`);
  if (eslesmeyen.length > 40) console.error(`   … +${eslesmeyen.length - 40} tane daha`);
  process.exit(1);
}
if (!yaz) {
  console.log('✓ kuru koşu temiz — uygulamak için: --yaz');
  process.exit(0);
}
for (const [yol, metin] of planlanan) writeFileSync(yol, metin, 'utf8');
console.log(`✓ ${planlanan.size} dosya yazıldı`);
