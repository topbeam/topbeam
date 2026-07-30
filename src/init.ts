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

This project is tracked with Topbeam — an honest project board (\`.ocean/pano.html\`).

Claude, while working in this project, keep these habits:
1. **Goal:** When the project goal changes, keep the "Project Goal" paragraph in
   \`.ocean/goal.md\` current (short, one paragraph).
   The \`- [ ]\` **delivery promises in that file belong to the user — do not add, delete
   or rewrite them.** The bar is built from those lines; the person who writes a promise
   is the person who approves it.
2. **Note:** At every meaningful step APPEND a one-line note to \`.ocean/notes.md\`
   (append; do not erase what is already there): \`- YYYY-MM-DD HH:MM — what was done\`.
3. **Honesty:** Without evidence, do not say "it works / it's done";
   say "looks applied, not verified". Verification belongs to the user: \`topbeam verify <id>\`.
4. **Sync:** When a meaningful piece of work is finished, run \`topbeam sync\` — the board
   and the card update.
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
const GOAL_TEMPLATE = `# Project Goal

> (Write one paragraph here: what this project is aiming at right now. It appears in the board's header.)

## Delivery promises

> Every \`- [ ]\` line is a delivery gate — one segment of the bar.
> The bar is finite: as many lines as you write, that many segments. Sessions do NOT grow it.
> A segment fills only with human approval given from your own terminal: \`topbeam verify <promise-id>\` (ids look like \`soz-…\`).
>
> NO promise has been written here — on purpose.
> The promise is yours; the tool cannot make a promise on your behalf.
> Write your own promises: short, one sentence, deliverable. Example shape (don't copy it, write yours):
>   \`- [ ] Setup works with a single command\`
>   \`- [ ] test: the tests are green\`
>
> Until you write one, no bar is drawn — there is nothing to fill.

> Matching hints (optional — to tie records to a promise):
>   path   \`src/auth\` or \`src/cli.ts\` → records that touch that path
>   test   a line starting with \`test:\` → test-run records only
>   tag    \`#payments\` → a tag that appears in the record's text or its path
> With no hint the item stays at "no evidence" — Topbeam does not invent a match.
`;

const NOTES_TEMPLATE = `# Topbeam Notes

(Claude: at each meaningful step add a one-line note here — \`- YYYY-MM-DD HH:MM — note\`. Don't erase the old ones.)
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
      text: 'Topbeam was connected to this project (topbeam init).',
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
      `${ayrac}\n# Topbeam working data — contains command text and the approval ledger.\n${oceanKurali}\n`,
      'ekle',
    );
    created.push(`.gitignore → "${oceanKurali}" added (so command text stays out of the repo)`);
  } else {
    skipped.push(`.gitignore (${oceanKurali} was already there)`);
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
    skipped.push(`CLAUDE.md (the ${CLAUDE_MD_MARKER} section was already there)`);
  } else {
    let ekle = opts.claudeMd;
    if (ekle === undefined && opts.sor !== undefined) {
      // Ne yazacağımızı ÖNCE göster — kör onay istemiyoruz.
      opts.yaz?.('');
      opts.yaz?.(`This section can be added to CLAUDE.md (Claude's habits in this project):`);
      for (const l of CLAUDE_MD_SECTION.trim().split('\n')) opts.yaz?.(`  │ ${l}`);
      opts.yaz?.('');
      // Soru İngilizce ([y/N]) ama eski Türkçe cevap da kabul edilir — kullanıcı
      // alışkanlığı kırılmasın (verify.ts'teki YES kümesiyle aynı davranış).
      const cevap = (await opts.sor('Add it? [y/N] ')).trim().toLocaleLowerCase('en-US');
      ekle = cevap === 'y' || cevap === 'yes' || cevap === 'e' || cevap === 'evet';
    }
    if (ekle === true) {
      const sep = claudeMd === '' || claudeMd.endsWith('\n') ? '' : '\n';
      await guvenliYazDisa(cwd, claudeMdPath, `${sep}${CLAUDE_MD_SECTION}`, 'ekle');
      claudeMdUpdated = true;
      created.push(`CLAUDE.md → "${CLAUDE_MD_MARKER}" section added`);
    } else {
      skipped.push('CLAUDE.md (left alone — if you want it: topbeam init --claude-md)');
    }
  }

  return { created, skipped, claudeMdUpdated, projectName };
}
