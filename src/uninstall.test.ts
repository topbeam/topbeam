/**
 * uninstall testleri — bir aracın en çok güven isteyen anı: kullanıcının
 * dosyalarından bir şey SİLERKEN. Buradaki her test "yalnız kendi izimizi
 * sildik mi" sorusunu sorar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.ts';
import { claudeMdBolumunuCikar, gitignoreSatiriniCikar, runUninstall } from './uninstall.ts';
import { oceanDir, passportLogPath } from './state.ts';

async function tmpProj(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'topbeam-uninstall-'));
}

test('CLAUDE.md: yalnız Topbeam bölümü gider, kullanıcının BAŞKA bölümü kalır', () => {
  const metin = `# Benim Projem

Kurallarım.

## Topbeam

Buradaki her satır bizim.
- madde

## Başka Bölüm

Bu KALMALI.
`;
  const { text, bulundu } = claudeMdBolumunuCikar(metin);
  assert.equal(bulundu, true);
  assert.ok(text.includes('# Benim Projem'), 'kullanıcının başlığı kalmalı');
  assert.ok(text.includes('Kurallarım.'), 'kullanıcının metni kalmalı');
  assert.ok(text.includes('## Başka Bölüm'), 'SONRAKİ bölüm kalmalı');
  assert.ok(text.includes('Bu KALMALI.'), 'sonraki bölümün içeriği kalmalı');
  assert.equal(text.includes('## Topbeam'), false, 'yalnız bizim bölüm gitmeli');
  assert.equal(text.includes('Buradaki her satır bizim'), false);
});

test('CLAUDE.md: Topbeam bölümü DOSYA SONUNDAysa da temiz çıkar', () => {
  const metin = '# Proje\n\nMetin.\n\n## Topbeam\n\nbizim satır\n';
  const { text, bulundu } = claudeMdBolumunuCikar(metin);
  assert.equal(bulundu, true);
  assert.ok(text.includes('Metin.'));
  assert.equal(text.includes('Topbeam'), false);
});

test('CLAUDE.md: bölüm yoksa dosyaya DOKUNULMAZ', () => {
  const metin = '# Proje\n\nHiç Topbeam yok.\n';
  const { text, bulundu } = claudeMdBolumunuCikar(metin);
  assert.equal(bulundu, false);
  assert.equal(text, metin, 'metin bit bit aynı kalmalı');
});

test('.gitignore: yalnız bizim satır gider, kullanıcının kuralları kalır', () => {
  const metin = 'node_modules/\ndist/\n\n# Topbeam çalışma verisi — komut metinleri ve onay defteri içerir.\n.ocean/\n\n*.log\n';
  const { text, bulundu } = gitignoreSatiriniCikar(metin);
  assert.equal(bulundu, true);
  assert.ok(text.includes('node_modules/'));
  assert.ok(text.includes('dist/'));
  assert.ok(text.includes('*.log'));
  assert.equal(text.includes('.ocean/'), false);
  assert.equal(text.includes('Topbeam çalışma verisi'), false);
});

test('VERİ KORUMASI: uninstall .ocean/ dizinini SİLMEZ (defter yeniden üretilemez)', async () => {
  const dir = await tmpProj();
  await runInit(dir, { claudeMd: true });
  // İmzalı onay kaydı varmış gibi yap — bu kullanıcının tek kalıcı kanıtı.
  await mkdir(oceanDir(dir), { recursive: true });
  await writeFile(passportLogPath(dir), '{"claimId":"x","decision":"approved","by":"ekin"}\n', 'utf8');

  const res = await runUninstall(dir);
  assert.equal(res.ok, true);
  // Defter DURUYOR
  const log = await readFile(passportLogPath(dir), 'utf8');
  assert.ok(log.includes('approved'), 'onay defteri silinmemeli');
  assert.ok(
    res.dokunulmayan.some((d) => d.includes('imzalı onay')),
    'neyin neden kaldığı SÖYLENMELİ',
  );
  // İzler gitmiş
  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(claudeMd.includes('## Topbeam'), false);
});

test('--purge: siler AMA ne kaybedildiğini SAYIYLA söyler', async () => {
  const dir = await tmpProj();
  await runInit(dir, { claudeMd: true });
  await writeFile(passportLogPath(dir), '{"a":1}\n{"b":2}\n', 'utf8');

  const res = await runUninstall(dir, { purge: true });
  await assert.rejects(() => readFile(passportLogPath(dir), 'utf8'), 'purge gerçekten silmeli');
  assert.ok(
    res.uyarilar.some((u) => u.includes('2 imzalı onay kaydı')),
    'kaç kayıt gittiği sessiz kalamaz',
  );
  assert.ok(res.uyarilar.some((u) => u.includes('GERİ GETİRİLEMEZ')));
});
