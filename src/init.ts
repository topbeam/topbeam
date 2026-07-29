/**
 * topbeam init — projeyi Topbeam'e bağlar. Kullanıcı elle iş yapmaz:
 * - .ocean/ kurulur: state.json + goal.md + notes.md (varsa DOKUNULMAZ).
 *   NOT: veri dizini adı `.ocean` KALIR (marka Topbeam olsa da) — mevcut
 *   kurulumlarda veri göçü/bozulma riski almamak için bilinçli karar.
 * - Projenin CLAUDE.md'sine "## Topbeam" bölümü APPEND edilir (varsa dokunma):
 *   Claude'a talimat — hedefi goal.md'de güncel tut + önemli adımlarda
 *   notes.md'ye 1 satır Türkçe not ekle + kanıtsız "çalışıyor" deme.
 *
 * İdempotent: ikinci `topbeam init` hiçbir şeyi ezmez, ne yaptığını söyler.
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { newOceanState, OCEAN_DIR, type LogEntry } from './types.ts';
import { goalPath, guvenliYazDisa, notesPath, oceanDir, readState, statePath, writeState } from './state.ts';

export const CLAUDE_MD_MARKER = '## Topbeam';

export const CLAUDE_MD_SECTION = `
## Topbeam

Bu proje Topbeam ile izleniyor — dürüst proje panosu (\`.ocean/pano.html\`).

Claude, bu projede çalışırken şu alışkanlıkları uygula:
1. **Hedef:** Proje hedefi değiştiğinde \`.ocean/goal.md\` dosyasının "Proje Hedefi"
   paragrafını güncel tut (kısa, tek paragraf). Aynı dosyadaki \`- [ ]\` **teslim
   sözleri kullanıcınındır — ekleme, silme, yeniden yazma.** Bar o satırlardan kurulur;
   sözü yazan da onaylayan da insandır.
2. **Not:** Önemli her adımda \`.ocean/notes.md\` dosyasına 1 satırlık Türkçe not EKLE (append, eskiyi silme):
   \`- YYYY-MM-DD HH:MM — ne yapıldı\` biçiminde.
3. **Dürüstlük:** Kanıt görmeden "çalışıyor / bitti" deme; "uygulandı görünüyor, doğrulanmadı" de.
   Doğrulama kullanıcıya aittir: \`topbeam verify <id>\`.
4. **Senkron:** Anlamlı bir iş bitince \`topbeam sync\` çalıştır — pano ve kart güncellensin.
`;

/**
 * goal.md şablonu — İKİ bölüm:
 *  1. Proje Hedefi : tek paragraf, panonun başlığında görünür (Claude günceller).
 *  2. Teslim sözleri: `- [ ]` satırları — BARIN TEK KAYNAĞI, insanın kendi sözü.
 *
 * Yönerge satırları `>` (alıntı) ile yazılır: readGoal bunları atlar, böylece
 * şablon panonun hedef satırına sızmaz. Örnek sözler bilinçli olarak EVRENSEL
 * teslim kapılarıdır — kullanıcı siler, kendi cümlelerini yazar.
 */
const GOAL_TEMPLATE = `# Proje Hedefi

> (Buraya tek paragraf yaz: bu proje şu an neyi hedefliyor. Panonun başlığında görünür.)

## Teslim sözleri

> Her \`- [ ]\` satırı bir teslim kapısıdır — barın bir bölmesi.
> Bar sonludur: kaç satır yazarsan o kadar bölme olur, oturum sayısı barı BÜYÜTMEZ.
> Bölme yalnız kendi terminalinden verdiğin insan onayıyla dolar: \`topbeam verify <söz-id>\`.
>
> Buraya HİÇBİR söz yazılmadı — bilerek. Söz senindir; araç senin adına söz veremez.
> Kendi sözlerini yaz: kısa, tek cümle, teslim edilebilir. Örnek biçim (kopyalama, kendin yaz):
>   \`- [ ] Kurulum tek komutla çalışıyor\`
>   \`- [ ] test: testler yeşil\`
>
> Sen yazana kadar bar çizilmez — dolduracak bir söz yoktur.

> Eşleme ipuçları (isteğe bağlı — kayıtları bir söze bağlamak için):
>   yol      \`src/auth\` ya da \`src/cli.ts\` → o yola dokunan kayıtlar
>   test     satır \`test:\` ile başlarsa → yalnız test koşumu kayıtları
>   etiket   \`#odeme\` → kaydın metninde ya da yolunda geçen etiket
> İpucu yoksa madde "kanıt yok" durur — Topbeam eşleşme uydurmaz.
`;

const NOTES_TEMPLATE = `# Topbeam Notları

(Claude: önemli adımlarda buraya 1 satır Türkçe not ekle — \`- YYYY-MM-DD HH:MM — not\`. Eskiyi silme.)
`;

export interface InitResult {
  /** Yeni oluşturulanlar (yol kısaltmalı). */
  created: string[];
  /** Zaten vardı, dokunulmadı. */
  skipped: string[];
  /** CLAUDE.md'ye bölüm eklendi mi. */
  claudeMdUpdated: boolean;
  projectName: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export interface InitOptions {
  now?: Date;
  /**
   * CLAUDE.md'ye "## Topbeam" bölümü eklensin mi?
   *   true  → ekle · false → hiç dokunma · undefined → SOR (soru yoksa EKLEME)
   *
   * ⚠️ Neden varsayılan "sorma-ekleme değil" (2026-07-29 sertleştirme bulgusu):
   * init, kullanıcının CLAUDE.md'sine 15 satır TÜRKÇE kalıcı davranış talimatı
   * ekliyordu — onay sormadan, geri alma yolu olmadan. Test deposunda o dosya
   * "Always answer in English. Never edit files without asking." diyordu; araç
   * ikisini de çiğnedi. Kullanıcının Claude'una talimat yazmak, kullanıcının
   * kararıdır.
   */
  claudeMd?: boolean;
  /** TTY'de onay sorusu — verilmezse soru sorulmaz (ve bölüm eklenmez). */
  sor?: (soru: string) => Promise<string>;
  /** Kullanıcıya gösterilecek metin (soru öncesi bloğu basmak için). */
  yaz?: (satir: string) => void;
}

export async function runInit(cwd: string, opts: InitOptions = {}): Promise<InitResult> {
  const now = opts.now ?? new Date();
  const projectName = basename(cwd);
  const created: string[] = [];
  const skipped: string[] = [];

  await mkdir(oceanDir(cwd), { recursive: true });

  // state.json — varsa ASLA ezme (geçmiş onaylar kaybolmasın).
  const existing = await readState(cwd);
  if (existing === null && !(await exists(statePath(cwd)))) {
    const state = newOceanState(projectName, now);
    const entry: LogEntry = {
      ts: now.toISOString(),
      text: 'Topbeam bu projeye bağlandı (topbeam init).',
      // NOT: 'ocean' = LogSource enum DEĞERİ (veri şeması, panoda etiketi
      // "topbeam" olarak gösterilir). Değeri değiştirmek eski state.json'ları
      // bozardı — bilinçli olarak sabit bırakıldı.
      source: 'ocean',
    };
    state.log.push(entry);
    await writeState(cwd, state);
    created.push('.ocean/state.json');
  } else {
    skipped.push('.ocean/state.json');
  }

  // goal.md / notes.md — varsa dokunma.
  if (await exists(goalPath(cwd))) skipped.push('.ocean/goal.md');
  else {
    await guvenliYazDisa(cwd, goalPath(cwd), GOAL_TEMPLATE);
    created.push('.ocean/goal.md');
  }
  if (await exists(notesPath(cwd))) skipped.push('.ocean/notes.md');
  else {
    await guvenliYazDisa(cwd, notesPath(cwd), NOTES_TEMPLATE);
    created.push('.ocean/notes.md');
  }

  /**
   * .gitignore — `.ocean/` satırı yoksa EKLE.
   *
   * Neden (2026-07-29 sertleştirme bulgusu): `.ocean/state.json` bu projede
   * koşulmuş KOMUT METİNLERİNİ ve Claude'un beyan satırlarını taşır; pano ve
   * defter de öyle. Maskeleme kaçırırsa bunlar kullanıcının deposuna, oradan da
   * public bir repoya gidebiliyordu. `git add -A` yapan kullanıcı bunu FARK
   * ETMEDEN yapıyor — ölçüldü.
   *
   * ⚠️ Asimetri utancı: Topbeam'in KENDİ deposunda `.ocean/` zaten gitignore'lu.
   * Yazar kendini korumuş, kullanıcıyı korumamıştı. Artık ikisi aynı.
   *
   * Bilinçli olarak izlemek isteyen satırı silebilir; biz sormadan EKLERİZ ama
   * ekrana YAZARIZ — sessiz değişiklik yok.
   */
  const gitignorePath = join(cwd, '.gitignore');
  let gi = '';
  try {
    gi = await readFile(gitignorePath, 'utf8');
  } catch {
    gi = '';
  }
  const oceanKurali = `${OCEAN_DIR}/`;
  const zatenVar = gi
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === oceanKurali || l === OCEAN_DIR || l === `/${oceanKurali}`);
  if (!zatenVar) {
    const ayrac = gi === '' || gi.endsWith('\n') ? '' : '\n';
    await guvenliYazDisa(
      cwd,
      gitignorePath,
      `${ayrac}\n# Topbeam çalışma verisi — komut metinleri ve onay defteri içerir.\n${oceanKurali}\n`,
      'ekle',
    );
    created.push(`.gitignore → "${oceanKurali}" eklendi (komut metinleri depoya girmesin)`);
  } else {
    skipped.push(`.gitignore (${oceanKurali} zaten var)`);
  }

  // CLAUDE.md — "## Topbeam" bölümü yoksa APPEND; varsa dokunma.
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  let claudeMdUpdated = false;
  let claudeMd = '';
  try {
    claudeMd = await readFile(claudeMdPath, 'utf8');
  } catch {
    claudeMd = '';
  }
  if (claudeMd.includes(CLAUDE_MD_MARKER)) {
    skipped.push(`CLAUDE.md (${CLAUDE_MD_MARKER} bölümü zaten var)`);
  } else {
    let ekle = opts.claudeMd;
    if (ekle === undefined && opts.sor !== undefined) {
      // Ne yazacağımızı ÖNCE göster — kör onay istemiyoruz.
      opts.yaz?.('');
      opts.yaz?.(`CLAUDE.md'ye şu bölüm eklenebilir (Claude'un bu projedeki alışkanlıkları):`);
      for (const l of CLAUDE_MD_SECTION.trim().split('\n')) opts.yaz?.(`  │ ${l}`);
      opts.yaz?.('');
      const cevap = (await opts.sor('Eklensin mi? [e/H] ')).trim().toLocaleLowerCase('tr-TR');
      ekle = cevap === 'e' || cevap === 'evet';
    }
    if (ekle === true) {
      const sep = claudeMd === '' || claudeMd.endsWith('\n') ? '' : '\n';
      await guvenliYazDisa(cwd, claudeMdPath, `${sep}${CLAUDE_MD_SECTION}`, 'ekle');
      claudeMdUpdated = true;
      created.push(`CLAUDE.md → "${CLAUDE_MD_MARKER}" bölümü eklendi`);
    } else {
      skipped.push('CLAUDE.md (dokunulmadı — istersen: topbeam init --claude-md)');
    }
  }

  return { created, skipped, claudeMdUpdated, projectName };
}
