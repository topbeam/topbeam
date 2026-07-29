/**
 * YAYIN KAPISI (prepublishOnly). Amaç: yayınlanan tarball'ın KENDİ İDDİALARI
 * tutarlı olsun. 2026-07-29'da yayınlanan 0.1.1 kendini "v0.1.0" diye tanıttı;
 * makbuz o sürümü dışarıya yazdı. Bir kanıt ürününde bu kabul edilemez.
 *
 * Kapı: `npm pack` → tarball'ı aç → `node dist/cli.js --version` çıktısı
 * package.json.version ile BİREBİR eşleşmiyorsa publish DURDURULUR.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kok = process.cwd();
const pkg = JSON.parse(readFileSync(join(kok, 'package.json'), 'utf8'));
const beklenen = pkg.version;
const yayinlanan = pkg.topbeam?.publishedVersion;

const hatalar = [];

// 1) publishedVersion yeni sürümün ÖNÜNE geçmiş olamaz
if (yayinlanan !== undefined && yayinlanan === beklenen) {
  hatalar.push(
    `package.json → topbeam.publishedVersion (${yayinlanan}) zaten yayınlanacak sürüme eşit.\n` +
      '   Bu alan YALNIZ başarılı publish SONRASI yükseltilir; şimdi yükseltirsen landing\n' +
      '   yayında olmayan bir sürümü "yayında" diye gösterir (2026-07-29\'da yaşandı).',
  );
}

// 2) Tarball'daki binary kendini DOĞRU tanıtıyor mu
const gecici = mkdtempSync(join(tmpdir(), 'topbeam-kapi-'));
try {
  const cikti = execFileSync('npm', ['pack', '--pack-destination', gecici], { cwd: kok, encoding: 'utf8' });
  const tgz = cikti.trim().split('\n').pop();
  execFileSync('tar', ['-xzf', join(gecici, tgz), '-C', gecici]);
  const cli = join(gecici, 'package', 'dist', 'cli.js');
  const surum = execFileSync('node', [cli, '--version'], { encoding: 'utf8' }).trim();
  if (surum !== `topbeam v${beklenen}`) {
    hatalar.push(
      `Tarball'daki binary kendini "${surum}" diye tanıtıyor ama package.json ${beklenen} diyor.\n` +
        '   Makbuz/pano/state.json bu damgayı DIŞARIYA yazar. src/types.ts → TOOL_VERSION güncellenmeli\n' +
        '   ve `npm run build` yeniden koşulmalı.',
    );
  } else {
    console.log(`✓ tarball tutarlı: ${surum}`);
  }
} finally {
  rmSync(gecici, { recursive: true, force: true });
}

if (hatalar.length > 0) {
  console.error('\n✖ YAYIN DURDURULDU:\n');
  for (const h of hatalar) console.error(` - ${h}\n`);
  process.exit(1);
}
console.log('✓ yayın kapısı geçildi');
