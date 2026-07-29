/**
 * topbeam uninstall — aracın kullanıcının dosyalarına BIRAKTIĞI izleri geri alır.
 *
 * Neden var (2026-07-29 sertleştirme bulgusu): `init`, kullanıcının CLAUDE.md'sine
 * bir bölüm ve .gitignore'una bir satır ekliyordu; geri alma yolu YOKTU. Bir aracın
 * senin dosyalarına yazıp çıkışı göstermemesi, saygısızlıktır.
 *
 * ⚠️ EN ÖNEMLİ KARAR: `.ocean/` VARSAYILAN OLARAK SİLİNMEZ.
 * İçindeki `passport.jsonl` senin İMZALI onay defterindir — append-only ve
 * YENİDEN ÜRETİLEMEZ. Transcript'ler zaten 30 günde siliniyor; defter, o işin
 * geriye kalan tek kanıtı olabilir. Bir "uninstall" komutunun kullanıcının tek
 * kalıcı kaydını sessizce yok etmesi kabul edilemez.
 * Silmek isteyen `--purge` der; o zaman bile ne kaybedeceği tek tek yazılır.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_MD_MARKER } from './init.ts';
import { OCEAN_DIR } from './types.ts';
import { guvenliYazDisa, oceanDir, passportLogPath } from './state.ts';

export interface UninstallResult {
  ok: boolean;
  /** Geri alınanlar (insan-okur). */
  temizlenen: string[];
  /** Dokunulmayanlar + gerekçesi. */
  dokunulmayan: string[];
  /** Kullanıcıya söylenecek uyarılar. */
  uyarilar: string[];
}

/**
 * `## Topbeam` bölümünü metinden çıkar. Bölüm bir sonraki `## ` başlığına ya da
 * dosya sonuna kadar sürer. Kullanıcının BAŞKA içeriği ASLA silinmez.
 */
export function claudeMdBolumunuCikar(metin: string): { text: string; bulundu: boolean } {
  const bas = metin.indexOf(CLAUDE_MD_MARKER);
  if (bas === -1) return { text: metin, bulundu: false };

  // Bölümün bitişi: sonraki satır-başı '## ' (kendisi hariç) ya da EOF.
  const sonrasi = metin.slice(bas + CLAUDE_MD_MARKER.length);
  const m = /\n## /.exec(sonrasi);
  const son = m === null ? metin.length : bas + CLAUDE_MD_MARKER.length + m.index + 1;

  const once = metin.slice(0, bas);
  const sonra = metin.slice(son);
  // Bölümden önce bırakılan fazla boş satırları tek satıra indir (dosya bozulmasın).
  const birlesik = `${once.replace(/\n{3,}$/, '\n\n')}${sonra}`;
  return { text: birlesik.replace(/^\n+/, ''), bulundu: true };
}

/** `.gitignore` içinden yalnız Topbeam'in eklediği satırı (+ yorumunu) çıkar. */
export function gitignoreSatiriniCikar(metin: string): { text: string; bulundu: boolean } {
  const satirlar = metin.split('\n');
  const out: string[] = [];
  let bulundu = false;
  for (const s of satirlar) {
    const t = s.trim();
    if (t === `${OCEAN_DIR}/` || t === OCEAN_DIR) {
      bulundu = true;
      continue;
    }
    // Bizim yazdığımız yorum satırı — yalnız o.
    if (t.startsWith('# Topbeam çalışma verisi')) {
      bulundu = true;
      continue;
    }
    out.push(s);
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), bulundu };
}

export async function runUninstall(
  cwd: string,
  opts: { purge?: boolean } = {},
): Promise<UninstallResult> {
  const temizlenen: string[] = [];
  const dokunulmayan: string[] = [];
  const uyarilar: string[] = [];

  // 1) CLAUDE.md bölümü
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  try {
    const ham = await readFile(claudeMdPath, 'utf8');
    const { text, bulundu } = claudeMdBolumunuCikar(ham);
    if (bulundu) {
      await guvenliYazDisa(cwd, claudeMdPath, text);
      temizlenen.push(`CLAUDE.md → "${CLAUDE_MD_MARKER}" bölümü kaldırıldı (başka içeriğe dokunulmadı)`);
    } else {
      dokunulmayan.push('CLAUDE.md (Topbeam bölümü yok)');
    }
  } catch {
    dokunulmayan.push('CLAUDE.md (dosya yok)');
  }

  // 2) .gitignore satırı
  const giPath = join(cwd, '.gitignore');
  try {
    const ham = await readFile(giPath, 'utf8');
    const { text, bulundu } = gitignoreSatiriniCikar(ham);
    if (bulundu) {
      await guvenliYazDisa(cwd, giPath, text);
      temizlenen.push(`.gitignore → "${OCEAN_DIR}/" satırı kaldırıldı`);
      uyarilar.push(
        `Dikkat: ${OCEAN_DIR}/ artık git tarafından yok sayılmıyor. İçinde bu projede ` +
          "koşulmuş komut metinleri var — commit'lemeden önce bak.",
      );
    } else {
      dokunulmayan.push('.gitignore (Topbeam satırı yok)');
    }
  } catch {
    dokunulmayan.push('.gitignore (dosya yok)');
  }

  // 3) .ocean/ — VARSAYILAN OLARAK KALIR
  const dizin = oceanDir(cwd);
  let defterSatir = 0;
  try {
    const log = await readFile(passportLogPath(cwd), 'utf8');
    defterSatir = log.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    defterSatir = 0;
  }

  if (opts.purge === true) {
    await rm(dizin, { recursive: true, force: true });
    temizlenen.push(`${OCEAN_DIR}/ SİLİNDİ (--purge)`);
    if (defterSatir > 0) {
      uyarilar.push(
        `${defterSatir} imzalı onay kaydı silindi ve GERİ GETİRİLEMEZ. ` +
          'Bu, o işi kendi gözünle doğruladığının tek kalıcı kanıtıydı.',
      );
    }
  } else {
    dokunulmayan.push(
      `${OCEAN_DIR}/ (bilerek KALDI — içinde ${defterSatir} imzalı onay kaydın var, ` +
        'yeniden üretilemez; silmek istersen: topbeam uninstall --purge)',
    );
  }

  return { ok: true, temizlenen, dokunulmayan, uyarilar };
}
