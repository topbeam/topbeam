/** init.ts testleri — mkdtemp izole proje dizinlerinde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, CLAUDE_MD_MARKER } from './init.ts';
import { readState } from './state.ts';

async function tmpProj(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'topbeam-init-'));
}

test('sıfırdan init: state + goal + notes + CLAUDE.md bölümü kurulur', async () => {
  const dir = await tmpProj();
  const res = await runInit(dir, { now: new Date('2026-07-28T10:00:00Z'), claudeMd: true });

  assert.ok(res.created.includes('.ocean/state.json'));
  assert.ok(res.created.includes('.ocean/goal.md'));
  assert.ok(res.created.includes('.ocean/notes.md'));
  assert.equal(res.claudeMdUpdated, true);

  const state = await readState(dir);
  assert.ok(state);
  assert.equal(state.projectName, res.projectName);
  assert.equal(state.claims.length, 0);
  assert.equal(state.log[0]?.source, 'ocean'); // init izi log'da

  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.includes(CLAUDE_MD_MARKER));
  assert.ok(claudeMd.includes('.ocean/goal.md'));
  assert.ok(claudeMd.includes('.ocean/notes.md'));
  assert.ok(claudeMd.includes('doğrulanmadı')); // dürüstlük talimatı
  // Sözler İNSANINDIR: Claude'a açıkça "ekleme, silme" denir (moat koruması)
  assert.ok(claudeMd.includes('teslim\n   sözleri kullanıcınındır'));
});

test('goal.md şablonu HİÇ SÖZ İÇERMEZ (söz insanındır) + yönerge; hedef satırı sızmaz', async () => {
  const { parseGoalItems } = await import('./goal.ts');
  const { readGoal } = await import('./state.ts');
  const dir = await tmpProj();
  await runInit(dir);

  const goal = await readFile(join(dir, '.ocean', 'goal.md'), 'utf8');
  const items = parseGoalItems(goal);
  // DÜRÜSTLÜK: "birim = İNSANIN yazdığı söz" yasası — araç kendi cümlesini
  // insanın sözüymüş gibi bara koyamaz. Şablon sıfır madde kurar.
  assert.equal(items.length, 0, 'şablon hiçbir söz yazmaz — söz kullanıcınındır');
  assert.ok(/kendi sözlerini yaz/i.test(goal), 'kullanıcıya sözün ONUN olduğu söylenir');
  assert.ok(goal.includes('araç senin adına söz veremez'), 'gerekçe açıkça yazılı');
  assert.ok(goal.includes('Eşleme ipuçları'), 'ipucu yönergesi korunur');

  // Yönerge satırları panonun HEDEF cümlesi yerine geçmez (alıntı ile yazılı).
  assert.equal(await readGoal(dir), null);
});

test('idempotent: ikinci init hiçbir şeyi ezmez, bölümü çiftlemez', async () => {
  const dir = await tmpProj();
  await runInit(dir, { claudeMd: true });

  // kullanıcı verisi simülasyonu: goal düzenlendi
  await writeFile(join(dir, '.ocean', 'goal.md'), '# Hedef\n\nGerçek hedefim.\n', 'utf8');

  const res2 = await runInit(dir, { claudeMd: true });
  assert.equal(res2.created.length, 0);
  assert.equal(res2.claudeMdUpdated, false);
  assert.ok(res2.skipped.some((s) => s.includes('state.json')));

  const goal = await readFile(join(dir, '.ocean', 'goal.md'), 'utf8');
  assert.ok(goal.includes('Gerçek hedefim.'), 'goal.md ezilmemeli');

  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  const occurrences = claudeMd.split(CLAUDE_MD_MARKER).length - 1;
  assert.equal(occurrences, 1, '## Topbeam bölümü tek olmalı');
});

test('mevcut CLAUDE.md korunur, bölüm SONUNA eklenir', async () => {
  const dir = await tmpProj();
  const mevcut = '# Benim Projem\n\nÖnemli kurallarım var.\n';
  await writeFile(join(dir, 'CLAUDE.md'), mevcut, 'utf8');

  await runInit(dir, { claudeMd: true });
  const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.startsWith('# Benim Projem'));
  assert.ok(claudeMd.includes('Önemli kurallarım var.'));
  assert.ok(claudeMd.includes(CLAUDE_MD_MARKER));
  assert.ok(claudeMd.indexOf(CLAUDE_MD_MARKER) > claudeMd.indexOf('Önemli kurallarım'));
});

test('.gitignore: .ocean/ eklenir — kullanıcının komut günlüğü deposuna girmesin', async () => {
  // Asimetri utancı: Topbeam'in KENDİ deposunda .ocean/ gitignore'luydu ama
  // kullanıcıya eklenmiyordu. `git add -A` yapan kullanıcı state.json'ı
  // (komut metinleri + beyanlar) fark etmeden repoya sokuyordu.
  const dir = await tmpProj();
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
  const res = await runInit(dir);

  const gi = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.ok(gi.includes('node_modules/'), 'mevcut kurallar korunmalı');
  assert.ok(gi.includes('.ocean/'), '.ocean/ eklenmeli');
  assert.ok(res.created.some((c) => c.includes('.gitignore')), 'sessiz değişiklik yok — ekranda söylenmeli');

  // İdempotent: ikinci init tekrar eklemez
  await runInit(dir);
  const gi2 = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.equal(gi2.split('.ocean/').length - 1, 1, '.ocean/ satırı çiftlenmemeli');
});

test('.gitignore yoksa oluşturulur', async () => {
  const dir = await tmpProj();
  await runInit(dir);
  const gi = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.ocean/'));
});


test('ONAY KAPISI: varsayılan olarak CLAUDE.md\'ye DOKUNULMAZ (soru yoksa ekleme yok)', async () => {
  // Ölçülen kusur: init, kullanıcının CLAUDE.md'sine 15 satır kalıcı davranış
  // talimatı ekliyordu — onay sormadan. Test deposunda o dosya
  // "Never edit files without asking" diyordu; araç ikisini de çiğnedi.
  const dir = await tmpProj();
  const mevcut = '# Benim Projem\n\nNever edit files without asking.\n';
  await writeFile(join(dir, 'CLAUDE.md'), mevcut, 'utf8');

  const res = await runInit(dir); // soru fonksiyonu YOK → otomasyon davranışı
  assert.equal(res.claudeMdUpdated, false, 'sormadan eklenmemeli');
  assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), mevcut, 'dosya AYNEN kalmalı');
  assert.ok(res.skipped.some((x) => x.includes('CLAUDE.md')), 'ne yapılmadığı söylenmeli');
});

test('ONAY KAPISI: "e" cevabı verilirse eklenir, "H" cevabı verilirse eklenmez', async () => {
  const evet = await tmpProj();
  const r1 = await runInit(evet, { sor: () => Promise.resolve('e'), yaz: () => {} });
  assert.equal(r1.claudeMdUpdated, true);

  const hayir = await tmpProj();
  const r2 = await runInit(hayir, { sor: () => Promise.resolve(''), yaz: () => {} });
  assert.equal(r2.claudeMdUpdated, false, 'boş cevap = Hayır (dürüst taraf)');
});
