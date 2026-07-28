/**
 * ocean init — projeyi Ocean'a bağlar. Kullanıcı elle iş yapmaz:
 * - .ocean/ kurulur: state.json + goal.md + notes.md (varsa DOKUNULMAZ).
 * - Projenin CLAUDE.md'sine "## Ocean" bölümü APPEND edilir (varsa dokunma):
 *   Claude'a talimat — hedefi goal.md'de güncel tut + önemli adımlarda
 *   notes.md'ye 1 satır Türkçe not ekle + kanıtsız "çalışıyor" deme.
 *
 * İdempotent: ikinci `ocean init` hiçbir şeyi ezmez, ne yaptığını söyler.
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { newOceanState, type LogEntry } from './types.ts';
import { goalPath, notesPath, oceanDir, readState, statePath, writeState } from './state.ts';

export const CLAUDE_MD_MARKER = '## Ocean';

export const CLAUDE_MD_SECTION = `
## Ocean

Bu proje Ocean ile izleniyor — dürüst proje panosu (\`.ocean/pano.html\`).

Claude, bu projede çalışırken şu alışkanlıkları uygula:
1. **Hedef:** Proje hedefi değiştiğinde \`.ocean/goal.md\` dosyasını güncel tut (kısa, tek paragraf).
2. **Not:** Önemli her adımda \`.ocean/notes.md\` dosyasına 1 satırlık Türkçe not EKLE (append, eskiyi silme):
   \`- YYYY-MM-DD HH:MM — ne yapıldı\` biçiminde.
3. **Dürüstlük:** Kanıt görmeden "çalışıyor / bitti" deme; "uygulandı görünüyor, doğrulanmadı" de.
   Doğrulama kullanıcıya aittir: \`ocean verify <id>\`.
4. **Senkron:** Anlamlı bir iş bitince \`ocean sync\` çalıştır — pano ve kart güncellensin.
`;

const GOAL_TEMPLATE = `# Proje Hedefi

(Claude: bu dosyayı güncel tut — tek paragraf, şu anki gerçek hedef. Ocean panoda gösterir.)
`;

const NOTES_TEMPLATE = `# Ocean Notları

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

export async function runInit(cwd: string, opts: { now?: Date } = {}): Promise<InitResult> {
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
      text: 'Ocean bu projeye bağlandı (ocean init).',
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
    await writeFile(goalPath(cwd), GOAL_TEMPLATE, 'utf8');
    created.push('.ocean/goal.md');
  }
  if (await exists(notesPath(cwd))) skipped.push('.ocean/notes.md');
  else {
    await writeFile(notesPath(cwd), NOTES_TEMPLATE, 'utf8');
    created.push('.ocean/notes.md');
  }

  // CLAUDE.md — "## Ocean" bölümü yoksa APPEND; varsa dokunma.
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  let claudeMdUpdated = false;
  let claudeMd = '';
  try {
    claudeMd = await readFile(claudeMdPath, 'utf8');
  } catch {
    claudeMd = '';
  }
  if (claudeMd.includes(CLAUDE_MD_MARKER)) {
    skipped.push('CLAUDE.md (## Ocean bölümü zaten var)');
  } else {
    const sep = claudeMd === '' || claudeMd.endsWith('\n') ? '' : '\n';
    await appendFile(claudeMdPath, `${sep}${CLAUDE_MD_SECTION}`, 'utf8');
    claudeMdUpdated = true;
    created.push('CLAUDE.md → "## Ocean" bölümü eklendi');
  }

  return { created, skipped, claudeMdUpdated, projectName };
}
