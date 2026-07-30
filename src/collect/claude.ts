/**
 * Claude Code transcript toplayıcısı.
 *
 * Verilen proje cwd'si için ~/.claude/projects/<slug>/*.jsonl transcript
 * dosyalarını bulur ve AKIŞ halinde (satır satır — dev dosyayı asla komple
 * belleğe almadan) deterministik olarak özetler. LLM yok; her çıkarım yalnız
 * transcript'in YAPISAL alanlarından gelir (tool_use/tool_result/timestamp).
 *
 * DÜRÜSTLÜK NOTLARI (ürün yasaları):
 * - Bash "description" alanı Claude'un kendi niyet cümlesidir — KANIT DEĞİL,
 *   beyandır (LogSource 'claude-beyan'); UI "beyan" etiketiyle göstermeli.
 * - Obje tipli Bash sonucunda sayısal exit code YOKTUR; 0 VARSAYILIR ve
 *   exitAssumed=true ile açıkça işaretlenir.
 * - Sonucu transcript'te görülmeyen tool_use başarı SAYILMAZ → unknownEdits.
 * - Assistant'ın serbest metin blokları ("bitti, çalışıyor!") özete ASLA girmez.
 * - Transcript yokluğu doğaldır (retention silmiş olabilir) → not ile raporlanır.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// ── sınırlar (dev transcript'lere karşı bellek disiplini) ────────────────────

const CAPS = {
  /** Saklanan gerçek-kullanıcı prompt sayısı (toplam sayaç ayrı tutulur). */
  goalMax: 50,
  /** Tek prompt'un saklanan uzunluğu. */
  goalLen: 300,
  /** Saklanan bash koşumu sayısı (toplam sayaç ayrı tutulur). */
  bashMax: 1000,
  /** İzlenen tekil dosya sayısı. */
  filesMax: 2000,
  /** Saklanan son hata parçacığı sayısı. */
  errSnippets: 5,
  /** Hata/özet satırı uzunluğu. */
  snippetLen: 200,
  /** Komut metni uzunluğu. */
  cmdLen: 500,
  /** Beyan (description) uzunluğu. */
  descLen: 200,
  /** file-history ikincil sinyal yol sayısı. */
  fhsMax: 500,
  /** Test istatistiği çıkarımı için çıktının SON n karakteri taranır. */
  statTail: 4000,
} as const;

/** Dosya değiştiren araçlar (keşif: NotebookEdit/MultiEdit görülmedi ama aynı kalıp — toleranslı). */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/**
 * Test-benzeri komut deseni (keşif §4.5 reçetesi + node --test) — KOMUT
 * KONUMUNDA aranır, metnin herhangi bir yerinde değil.
 *
 * Dogfood dersi (gerçek yanlış pozitifler, ikisi de kartın tepesine çıkmıştı):
 *   `... "$HOME/Library/Caches/ms-playwright/..." --print-to-pdf ...`  → PDF render
 *   `ls /Applications/ | grep -iE "chrome|chromium|edge|brave"`        → grep exit 1
 * İkisi de "test koşumu" sayılıp exit kodları "kırık test" gibi okunuyordu.
 * Çözüm: kabuk zinciri parçalanır, her parçanın BAŞINDA test ikilisi aranır
 * (env atamaları ve npx/sudo gibi çalıştırıcı önekleri soyulduktan sonra).
 * Kaçırmak, yanlış suçlamaktan iyidir: `do npm test; done` gibi gömülü
 * kullanımlar bilinçli olarak dışarıda kalır.
 */
const TEST_CMD_RE =
  /^(npm (?:run )?test|pnpm (?:run )?test|yarn (?:run )?test|bun test|vitest|jest|pytest|go test|cargo test|playwright|node --test)(?![\w-])/;

/**
 * KONTROL komutu deseni — derleyici/linter/biçimlendirici. Bunlar "kaç test
 * geçti" gibi bir SAYI üretmez; sessiz çıkarlar.
 *
 * Dogfood dersi (gürültü kaynağı #1): tsc/eslint TEST_CMD_RE içindeydi →
 * her koşum "sonuç çıktıdan okunamadı — doğrulanmadı" claim'i doğuruyordu
 * (200+ gürültü claim). Sayı üretmeyen komuttan sayı beklemek ölçüm hatasıdır;
 * bunlar artık AYRI sınıf: kayda geçer (BashRun.isCheckLike), claim ÜRETMEZ.
 * Kanıt seviyesi gevşemez — tersine, uydurulmuş "doğrulanmadı" iddiası biter.
 */
const CHECK_CMD_RE =
  /^((?:npm|pnpm|yarn|bun) (?:run )?(?:lint|typecheck|type-check|check|format)|tsc|eslint|prettier|biome|stylelint|mypy|ruff|flake8|pylint)(?![\w-])/;

/** Kabuk zincirini komut konumlarına ayıran ayraçlar. */
const SHELL_SPLIT_RE = /(?:\|\||&&|;|\||\n)+/;

/** Soyulabilir önekler: env ataması + çalıştırıcı sarmalayıcılar. */
const RUNNER_PREFIX_RE =
  /^(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|sudo|time|npx|bunx|pnpm (?:exec|dlx)|yarn (?:exec|dlx)|npm exec|poetry run|uv run|pipenv run|python3? -m)\s+)+/;

/** Ata-dizin yürüyüşünde en fazla kaç seviye yukarı çıkılır. */
const ANCESTOR_MAX_UP = 2;

/** Kaç günlük transcript'ten sonra saklama uyarısı verilir (silinme 30 gün). */
const RETENTION_UYARI_GUN = 25;

/** Asla ata-oturum kaynağı sayılmayacak konak dizinler. */
const KONAK_DIZINLER: ReadonlySet<string> = new Set([
  '/', '/Users', '/home', '/tmp', '/var', '/private', '/private/tmp', '/opt', '/mnt',
]);

/** Yol var mı (dizin/dosya fark etmez). */
async function varMi(yol: string): Promise<boolean> {
  try {
    await readdir(yol);
    return true;
  } catch (e) {
    // ENOTDIR = var ama dizin değil (`.git` dosya olabilir: worktree linki)
    return (e as NodeJS.ErrnoException).code === 'ENOTDIR';
  }
}

/** Verilen slug dizinlerinde EN AZ BİR .jsonl var mı (boş dizin sayılmaz). */
async function dizinlerdeTranscriptVarMi(projectsDir: string, dirNames: readonly string[]): Promise<boolean> {
  for (const d of dirNames) {
    try {
      const files = await readdir(join(projectsDir, d), { withFileTypes: true });
      if (files.some((f) => f.isFile() && f.name.endsWith('.jsonl'))) return true;
    } catch {
      // okunamadı — yok say
    }
  }
  return false;
}

// ── dış tipler ───────────────────────────────────────────────────────────────

export interface ClaudeCollectOptions {
  /** ~/.claude yerine kullanılacak kök (test izolasyonu; OCEAN_CLAUDE_DIR env de geçerli). */
  claudeDir?: string;
  /** subagents/*.jsonl dosyaları da taransın mı (varsayılan true — keşif: yoksa iş kaybolur). */
  includeSubagents?: boolean;
}

/** Bash sonucunun yapısal yorumu. */
export type BashResultKind = 'ok' | 'error' | 'blocked' | 'interrupted' | 'unknown';

export interface BashRun {
  /** Komut metni (kırpılmış). */
  command: string;
  /** Claude'un niyet beyanı — KANIT DEĞİL ('claude-beyan'). */
  description: string | null;
  ts: string | null;
  /** Sayısal exit code; obje sonuçta yoktur → 0 varsayılır. */
  exitCode: number | null;
  /** true = exit code transcript'te yazmıyordu, 0 VARSAYILDI. */
  exitAssumed: boolean;
  resultKind: BashResultKind;
  timedOut: boolean;
  isTestLike: boolean;
  /** Kontrol komutu (tsc/eslint/prettier…): sayı üretmez → claim üretilmez. */
  isCheckLike: boolean;
  fromSubagent: boolean;
}

export interface TestSignal {
  command: string;
  ts: string | null;
  exitCode: number | null;
  /** Çıktıdan çekilen geçen test sayısı (bulunamadıysa null — uydurulmaz). */
  passed: number | null;
  failed: number | null;
  /** Çıktıda eşleşen sonuç satırı (kanıt referansı). */
  summaryLine: string | null;
  fromSubagent: boolean;
}

export interface ChangedFile {
  path: string;
  /** Dokunan araç adları (Edit/Write/...). */
  tools: string[];
  /** tool_result'u hatasız görülen değişiklik sayısı. */
  edits: number;
  /** is_error:true dönen deneme sayısı (başarı DEĞİL). */
  failedEdits: number;
  /** Sonucu transcript'te hiç görülmeyen deneme — başarı SAYILMAZ. */
  unknownEdits: number;
  addedLines: number;
  removedLines: number;
  /** Sonuçta userModified:true görüldü — kullanıcı elle değiştirmiş. */
  userModified: boolean;
  fromSubagent: boolean;
  lastTs: string | null;
}

export interface SessionSummary {
  sessionId: string;
  transcriptPath: string;
  firstTs: string | null;
  lastTs: string | null;
  /** İlk görülen cwd (proje eşlemesinde slug'a değil BUNA güven). */
  cwd: string | null;
  lastCwd: string | null;
  gitBranch: string | null;
  /** son custom-title > son ai-title > ilk prompt'un ilk 60 karakteri. */
  title: string | null;
  /** Gerçek kullanıcı prompt'ları (ilki = oturum hedefi). Kırpılmış. */
  userGoals: string[];
  /** Toplam gerçek prompt sayısı (userGoals kırpılmış olabilir). */
  userPromptCount: number;
  changedFiles: ChangedFile[];
  /** İkincil sinyal: file-history-delta/snapshot yolları (doğrulayıcı, kanıt değil). */
  fileHistoryPaths: string[];
  bashRuns: BashRun[];
  /** Toplam bash koşumu (bashRuns kırpılmış olabilir). */
  bashRunCount: number;
  testSignals: TestSignal[];
  /** is_error:true tool_result sayısı. */
  errorCount: number;
  /** Son hata metinleri (kırpılmış). */
  lastErrors: string[];
  /** "[Request interrupted by user]" sayısı — kullanıcı müdahale sinyali. */
  interruptedCount: number;
  /** Oturumda compact yaşandı (compact_boundary / isCompactSummary). */
  compacted: boolean;
  /** JSON.parse edilemeyen satır sayısı (atlandı, sayıldı). */
  parseErrors: number;
  /** Okunamayan dosya sayısı (stream hatası). */
  readErrors: number;
  /** Taranan subagent transcript sayısı. */
  subagentFiles: number;
  /** Oturumun cwd'si istenen proje cwd'sinden farklı (dürüst bayrak). */
  cwdMismatch: boolean;
  /**
   * Oturum, projenin ÜST dizininde açılmış bir Claude oturumundan geldi.
   *
   * Neden var (2026-07-29, gerçek kurulumda ölçüldü): Claude Code çoğu zaman bir
   * çalışma klasörünün kökünde açılır, depo ise onun ALTINDA durur. Transcript
   * dizini oturumun cwd'sine göre adlandırıldığı için, deponun içinde `topbeam
   * sync` koşturmak "0 oturum" veriyordu — yani araç, kendi yazıldığı işi bile
   * göremiyordu. Üst dizin oturumları artık taranıyor.
   *
   * Güvenlik: bu oturumlar başka kardeş projelerin işini de içerebilir. Kapsam
   * filtresi (truth.ts → projectRelative) proje kökü dışındaki her yolu zaten
   * eler; bu bayrak yalnız "atlama" kuralının bunları atmaması için var ve
   * kullanıcıya nereden okunduğu NOT olarak söylenir.
   */
  fromAncestor: boolean;
}

export interface ClaudeCollectResult {
  projectCwd: string;
  claudeProjectsDir: string;
  /** Beklenen normalize slug. */
  slug: string;
  /** Slug'a denk düşen gerçek dizin adları. */
  matchedDirs: string[];
  transcriptsFound: number;
  /** firstTs'e göre kronolojik. */
  sessions: SessionSummary[];
  /** Dürüst durum notları (transcript yok / temizlenmiş olabilir vb.). */
  notes: string[];
}

export interface TestStats {
  passed: number | null;
  failed: number | null;
  summaryLine: string | null;
}

// ── küçük yardımcılar ────────────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * cwd → Claude Code proje dizin slug'ı.
 * Gözlenen kural: '/' ve boşluk '-' olur ("/…/Benim Proje" → "-…-Benim-Proje").
 * Diğer özel karakterler için de '-' varsayılır (est.); eşleme bu yüzden
 * normalize-karşılaştırma ile yapılır ve oturumun içindeki cwd ile doğrulanır.
 */
export function slugifyCwd(cwd: string): string {
  return resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

function normalizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Kabuk zincirini KOMUT KONUMLARINA ayırır: her parça çalıştırıcı önekleri
 * (env ataması, npx/sudo…) ve yol öneki soyulmuş haldedir. Sınıflandırma yapan
 * herkes (test/kontrol/anlamlı-komut) aynı parçalara bakar.
 */
export function commandSegments(command: string): string[] {
  return command.split(SHELL_SPLIT_RE).map((raw) =>
    raw
      .trim()
      .replace(/^[({]\s*/, '') // alt-kabuk / blok açıcı
      .replace(RUNNER_PREFIX_RE, '') // CI=1 npx …
      .replace(/^\S*\//, ''), // ./node_modules/.bin/jest → jest
  );
}

/**
 * Komut test-benzeri mi? Zincirdeki HERHANGİ bir parça gerçekten bir test
 * ikilisi çağırıyorsa true. Argüman/yol içinde geçen ad sayılmaz.
 */
export function isTestLikeCommand(command: string): boolean {
  for (const seg of commandSegments(command)) {
    if (TEST_CMD_RE.test(seg)) return true;
  }
  return false;
}

/**
 * Komut KONTROL komutu mu (tsc/eslint/prettier…)? Sayı üretmez → claim üretmez.
 * Test ikilisiyle aynı zincirde geçebilir (`npm test && tsc`); o durumda
 * test sınıfı kazanır (çağıran taraf isTestLikeCommand'ı önce sorar).
 */
export function isCheckLikeCommand(command: string): boolean {
  for (const seg of commandSegments(command)) {
    if (CHECK_CMD_RE.test(seg)) return true;
  }
  return false;
}

/**
 * Test çıktısından pass/fail sayısı çek (yalnız çıktının son 4000 karakteri).
 * Bulunamazsa null — sayı UYDURULMAZ.
 * Desteklenen desenler: node:test TAP ("# pass 19"), node:test spec reporter
 * ("ℹ pass 19" — dogfood'da GERÇEK transcript'lerde görülen tek node:test formatı),
 * jest/vitest/pytest/mocha ("N passed"/"N failed"/"N passing"), go/genel PASS-FAIL satırları.
 */
export function extractTestStats(output: string): TestStats {
  const tail = output.length > CAPS.statTail ? output.slice(-CAPS.statTail) : output;
  let passed: number | null = null;
  let failed: number | null = null;

  const tapPass = /^# pass (\d+)\s*$/m.exec(tail);
  if (tapPass?.[1] !== undefined) passed = Number(tapPass[1]);
  const tapFail = /^# fail (\d+)\s*$/m.exec(tail);
  if (tapFail?.[1] !== undefined) failed = Number(tapFail[1]);

  // node:test spec reporter (Node 20+ TTY varsayılanı; Claude bash çıktısında da bu görülüyor).
  if (passed === null) {
    const m = /^\s*ℹ pass (\d+)\s*$/m.exec(tail);
    if (m?.[1] !== undefined) passed = Number(m[1]);
  }
  if (failed === null) {
    const m = /^\s*ℹ fail (\d+)\s*$/m.exec(tail);
    if (m?.[1] !== undefined) failed = Number(m[1]);
  }

  if (passed === null) {
    const m = /(\d+)\s+pass(?:ed|ing)\b/i.exec(tail);
    if (m?.[1] !== undefined) passed = Number(m[1]);
  }
  if (failed === null) {
    const m = /(\d+)\s+fail(?:ed|ing)\b/i.exec(tail);
    if (m?.[1] !== undefined) failed = Number(m[1]);
  }

  // Kanıt referansı: sondan başa ilk sonuç-benzeri satır.
  const lineRe =
    /(# (?:pass|fail) \d+|ℹ (?:pass|fail) \d+|\d+\s+(?:passed|failed|passing|failing)\b|^(?:PASS|FAIL)\b|^ok\s+\S+|^FAIL\s+\S+)/i;
  let summaryLine: string | null = null;
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = (lines[i] ?? '').trim();
    if (ln && lineRe.test(ln)) {
      summaryLine = ln.slice(0, CAPS.snippetLen);
      break;
    }
  }
  return { passed, failed, summaryLine };
}

// ── iç durum ─────────────────────────────────────────────────────────────────

interface Pending {
  name: string;
  ts: string | null;
  fromSubagent: boolean;
  filePath?: string;
  command?: string;
  description?: string;
}

interface Acc {
  firstTs: string | null;
  lastTs: string | null;
  cwdFirst: string | null;
  cwdLast: string | null;
  gitBranch: string | null;
  aiTitle: string | null;
  customTitle: string | null;
  userGoals: string[];
  userPromptCount: number;
  files: Map<string, ChangedFile>;
  fileHistoryPaths: Set<string>;
  bashRuns: BashRun[];
  bashRunCount: number;
  testSignals: TestSignal[];
  errorCount: number;
  lastErrors: string[];
  interruptedCount: number;
  compacted: boolean;
  parseErrors: number;
  readErrors: number;
  subagentFiles: number;
}

function newAcc(): Acc {
  return {
    firstTs: null,
    lastTs: null,
    cwdFirst: null,
    cwdLast: null,
    gitBranch: null,
    aiTitle: null,
    customTitle: null,
    userGoals: [],
    userPromptCount: 0,
    files: new Map(),
    fileHistoryPaths: new Set(),
    bashRuns: [],
    bashRunCount: 0,
    testSignals: [],
    errorCount: 0,
    lastErrors: [],
    interruptedCount: 0,
    compacted: false,
    parseErrors: 0,
    readErrors: 0,
    subagentFiles: 0,
  };
}

function getFileAcc(acc: Acc, path: string, fromSubagent: boolean): ChangedFile | null {
  let f = acc.files.get(path);
  if (!f) {
    if (acc.files.size >= CAPS.filesMax) return null;
    f = {
      path,
      tools: [],
      edits: 0,
      failedEdits: 0,
      unknownEdits: 0,
      addedLines: 0,
      removedLines: 0,
      userModified: false,
      fromSubagent,
      lastTs: null,
    };
    acc.files.set(path, f);
  }
  if (fromSubagent) f.fromSubagent = true;
  return f;
}

function pushErrSnippet(acc: Acc, blockContent: unknown, tur: unknown): void {
  let text = '';
  if (typeof blockContent === 'string') text = blockContent;
  else if (Array.isArray(blockContent)) {
    for (const b of blockContent) {
      const r = rec(b);
      if (r && r.type === 'text') {
        const t = str(r.text);
        if (t) {
          text = t;
          break;
        }
      }
    }
  }
  if (!text && typeof tur === 'string') text = tur;
  text = text.trim().slice(0, CAPS.snippetLen);
  if (!text) return;
  acc.lastErrors.push(text);
  if (acc.lastErrors.length > CAPS.errSnippets) acc.lastErrors.shift();
}

/** İlk metin bloğunu ya da string content'i döndürür (filtresiz, trim'li). */
function rawPromptText(content: unknown): string | null {
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const first = rec(content[0]);
    if (first && first.type === 'text') text = str(first.text);
  }
  if (text === null) return null;
  const t = text.trim();
  return t.length > 0 ? t : null;
}

// ── tool_result sonlandırma ──────────────────────────────────────────────────

function finalizeEdit(acc: Acc, p: Pending, isError: boolean, tur: unknown, ts: string | null): void {
  if (!p.filePath) return;
  const f = getFileAcc(acc, p.filePath, p.fromSubagent);
  if (!f) return;
  if (!f.tools.includes(p.name)) f.tools.push(p.name);
  f.lastTs = ts ?? p.ts ?? f.lastTs;
  if (isError) {
    f.failedEdits++;
    return;
  }
  f.edits++;
  const r = rec(tur);
  if (r) {
    if (r.userModified === true) f.userModified = true;
    if (Array.isArray(r.structuredPatch)) {
      for (const h of r.structuredPatch) {
        const hunk = rec(h);
        if (!hunk || !Array.isArray(hunk.lines)) continue;
        for (const ln of hunk.lines) {
          if (typeof ln !== 'string') continue;
          if (ln.startsWith('+')) f.addedLines++;
          else if (ln.startsWith('-')) f.removedLines++;
        }
      }
    }
  }
}

function finalizeBash(acc: Acc, p: Pending, isError: boolean, tur: unknown, ts: string | null): void {
  let exitCode: number | null = null;
  let exitAssumed = false;
  let kind: BashResultKind = 'unknown';
  let timedOut = false;
  let output = '';

  const r = rec(tur);
  if (r) {
    // Keşif: obje sonuç = başarılı kabul; sayısal exit code alanı YOK.
    const so = str(r.stdout) ?? '';
    const se = str(r.stderr) ?? '';
    output = se ? `${so}\n${se}` : so;
    timedOut = typeof r.timedOutAfterMs === 'number';
    if (r.interrupted === true) kind = 'interrupted';
    else if (isError) kind = 'error';
    else {
      kind = 'ok';
      exitCode = 0;
      exitAssumed = true; // 0 yazılı değildi, varsayıldı — dürüst işaret.
    }
  } else if (typeof tur === 'string') {
    // Keşif: hatalı Bash sonucu düz string: "Error: Exit code 1\n..."
    output = tur;
    const m = /^Error: Exit code (\d+)/.exec(tur);
    if (m?.[1] !== undefined) {
      kind = 'error';
      exitCode = Number(m[1]);
    } else if (tur.startsWith('Error: Blocked')) {
      kind = 'blocked';
    } else {
      kind = isError ? 'error' : 'unknown';
    }
  } else if (Array.isArray(tur)) {
    for (const item of tur) {
      if (typeof item === 'string') output += `${item}\n`;
      else {
        const ir = rec(item);
        const t = str(ir?.text);
        if (t) output += `${t}\n`;
      }
    }
    kind = isError ? 'error' : 'unknown';
  } else {
    kind = isError ? 'error' : 'unknown';
  }

  const command = p.command ?? '';
  const testLike = isTestLikeCommand(command);
  const run: BashRun = {
    command,
    description: p.description ?? null,
    ts: p.ts ?? ts,
    exitCode,
    exitAssumed,
    resultKind: kind,
    timedOut,
    isTestLike: testLike,
    isCheckLike: !testLike && isCheckLikeCommand(command),
    fromSubagent: p.fromSubagent,
  };
  acc.bashRunCount++;
  if (acc.bashRuns.length < CAPS.bashMax) acc.bashRuns.push(run);

  if (testLike) {
    const stats = extractTestStats(output);
    acc.testSignals.push({
      command: run.command,
      ts: run.ts,
      exitCode,
      passed: stats.passed,
      failed: stats.failed,
      summaryLine: stats.summaryLine,
      fromSubagent: p.fromSubagent,
    });
  }
}

function finalizePending(acc: Acc, p: Pending, isError: boolean, tur: unknown, ts: string | null): void {
  if (p.name === 'Bash') finalizeBash(acc, p, isError, tur, ts);
  else if (EDIT_TOOLS.has(p.name)) finalizeEdit(acc, p, isError, tur, ts);
}

/** Dosya sonunda sonucu hiç görülmeyen tool_use'lar — başarı SAYILMAZ. */
function flushPending(acc: Acc, pending: Map<string, Pending>): void {
  for (const p of pending.values()) {
    if (p.name === 'Bash') {
      const command = p.command ?? '';
      const testLike = isTestLikeCommand(command);
      acc.bashRunCount++;
      if (acc.bashRuns.length < CAPS.bashMax) {
        acc.bashRuns.push({
          command,
          description: p.description ?? null,
          ts: p.ts,
          exitCode: null,
          exitAssumed: false,
          resultKind: 'unknown',
          timedOut: false,
          isTestLike: testLike,
          isCheckLike: !testLike && isCheckLikeCommand(command),
          fromSubagent: p.fromSubagent,
        });
      }
    } else if (p.filePath) {
      const f = getFileAcc(acc, p.filePath, p.fromSubagent);
      if (f) {
        if (!f.tools.includes(p.name)) f.tools.push(p.name);
        f.unknownEdits++;
      }
    }
  }
  pending.clear();
}

// ── satır işleme ─────────────────────────────────────────────────────────────

function handleUserLine(
  obj: Record<string, unknown>,
  acc: Acc,
  fromSubagent: boolean,
  pending: Map<string, Pending>,
  ts: string | null,
): void {
  const msg = rec(obj.message);
  const content = msg?.content;

  // 1) tool_result taşıyıcısı mı?
  let hadToolResult = false;
  if (Array.isArray(content)) {
    for (const b of content) {
      const blk = rec(b);
      if (!blk || blk.type !== 'tool_result') continue;
      hadToolResult = true;
      const id = str(blk.tool_use_id);
      const isError = blk.is_error === true;
      if (isError) {
        acc.errorCount++;
        pushErrSnippet(acc, blk.content, obj.toolUseResult);
      }
      if (id) {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          finalizePending(acc, p, isError, obj.toolUseResult, ts);
        }
      }
    }
  }
  if (hadToolResult || obj.toolUseResult !== undefined) return;

  // 2) meta / compact / kesinti
  if (obj.isCompactSummary === true) {
    acc.compacted = true;
    return;
  }
  if (obj.isMeta === true) return;
  if (fromSubagent) return; // alt-ajan prompt'u kullanıcı hedefi değildir

  const t = rawPromptText(content);
  if (t === null) return;
  if (t.startsWith('[Request interrupted')) {
    acc.interruptedCount++;
    return;
  }
  if (t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('Caveat:')) return;

  // 3) gerçek kullanıcı prompt'u
  acc.userPromptCount++;
  if (acc.userGoals.length < CAPS.goalMax) acc.userGoals.push(t.slice(0, CAPS.goalLen));
}

function handleLine(
  obj: Record<string, unknown>,
  acc: Acc,
  fromSubagent: boolean,
  pending: Map<string, Pending>,
): void {
  // Zaman aralığı: timestamp taşıyan HER satır sayılır (ISO-8601 Z, leksik sıralanabilir).
  const ts = str(obj.timestamp);
  if (ts) {
    if (acc.firstTs === null || ts < acc.firstTs) acc.firstTs = ts;
    if (acc.lastTs === null || ts > acc.lastTs) acc.lastTs = ts;
  }
  if (!fromSubagent) {
    const cwd = str(obj.cwd);
    if (cwd) {
      if (acc.cwdFirst === null) acc.cwdFirst = cwd;
      acc.cwdLast = cwd;
    }
    const gb = str(obj.gitBranch);
    if (gb) acc.gitBranch = gb;
  }

  switch (str(obj.type)) {
    case 'assistant': {
      const msg = rec(obj.message);
      const content = msg?.content;
      if (!Array.isArray(content)) break;
      for (const b of content) {
        const blk = rec(b);
        if (!blk || blk.type !== 'tool_use') continue;
        const id = str(blk.id);
        const name = str(blk.name) ?? '';
        if (!id) continue;
        if (!EDIT_TOOLS.has(name) && name !== 'Bash') continue;
        const input = rec(blk.input);
        const p: Pending = { name, ts, fromSubagent };
        if (EDIT_TOOLS.has(name)) {
          const fp = str(input?.file_path) ?? str(input?.notebook_path);
          if (fp) p.filePath = fp;
        } else {
          p.command = (str(input?.command) ?? '').slice(0, CAPS.cmdLen);
          const d = str(input?.description);
          if (d) p.description = d.slice(0, CAPS.descLen);
        }
        pending.set(id, p);
      }
      break;
    }
    case 'user':
      handleUserLine(obj, acc, fromSubagent, pending, ts);
      break;
    case 'system':
      if (str(obj.subtype) === 'compact_boundary') acc.compacted = true;
      break;
    case 'ai-title':
      if (!fromSubagent) acc.aiTitle = str(obj.aiTitle) ?? acc.aiTitle;
      break;
    case 'custom-title':
      if (!fromSubagent) acc.customTitle = str(obj.customTitle) ?? acc.customTitle;
      break;
    case 'file-history-delta': {
      const tp = str(obj.trackingPath);
      if (tp && acc.fileHistoryPaths.size < CAPS.fhsMax) acc.fileHistoryPaths.add(tp);
      break;
    }
    case 'file-history-snapshot': {
      const snap = rec(obj.snapshot);
      const tb = rec(snap?.trackedFileBackups);
      if (tb) {
        for (const k of Object.keys(tb)) {
          if (acc.fileHistoryPaths.size >= CAPS.fhsMax) break;
          acc.fileHistoryPaths.add(k);
        }
      }
      break;
    }
    default:
      break; // attachment/queue-operation/mode/last-prompt: yalnız ts katkısı
  }
}

async function parseFile(path: string, acc: Acc, fromSubagent: boolean): Promise<void> {
  const pending = new Map<string, Pending>();
  try {
    const input = createReadStream(path, { encoding: 'utf8' });
    const rl = createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        acc.parseErrors++;
        continue;
      }
      const obj = rec(parsed);
      if (!obj) {
        acc.parseErrors++;
        continue;
      }
      handleLine(obj, acc, fromSubagent, pending);
    }
  } catch {
    acc.readErrors++;
  }
  flushPending(acc, pending);
}

// ── dış API ──────────────────────────────────────────────────────────────────

/**
 * Tek transcript dosyasını (+ varsa subagent dosyalarını) akışla özetler.
 * sessionId = dosya adı (keşif: dosya adı = sessionId).
 */
export async function summarizeTranscript(
  transcriptPath: string,
  subagentPaths: readonly string[] = [],
): Promise<SessionSummary> {
  const acc = newAcc();
  await parseFile(transcriptPath, acc, false);
  for (const sp of subagentPaths) {
    await parseFile(sp, acc, true);
    acc.subagentFiles++;
  }

  const sessionId = basename(transcriptPath).replace(/\.jsonl$/, '');
  const firstGoal = acc.userGoals[0] ?? null;
  const title =
    acc.customTitle ?? acc.aiTitle ?? (firstGoal !== null ? firstGoal.slice(0, 60) : null);

  return {
    sessionId,
    transcriptPath,
    firstTs: acc.firstTs,
    lastTs: acc.lastTs,
    cwd: acc.cwdFirst,
    lastCwd: acc.cwdLast,
    gitBranch: acc.gitBranch,
    title,
    userGoals: acc.userGoals,
    userPromptCount: acc.userPromptCount,
    changedFiles: [...acc.files.values()],
    fileHistoryPaths: [...acc.fileHistoryPaths],
    bashRuns: acc.bashRuns,
    bashRunCount: acc.bashRunCount,
    testSignals: acc.testSignals,
    errorCount: acc.errorCount,
    lastErrors: acc.lastErrors,
    interruptedCount: acc.interruptedCount,
    compacted: acc.compacted,
    parseErrors: acc.parseErrors,
    readErrors: acc.readErrors,
    subagentFiles: acc.subagentFiles,
    cwdMismatch: false,
    fromAncestor: false,
  };
}

/**
 * Proje cwd'si için tüm Claude Code oturumlarını toplar.
 * Dizin eşlemesi normalize-slug karşılaştırmasıyla yapılır; her oturumun
 * içindeki cwd ayrıca kontrol edilir (uyuşmazsa cwdMismatch=true, atılmaz).
 */
export async function collectClaude(
  projectCwd: string,
  opts: ClaudeCollectOptions = {},
): Promise<ClaudeCollectResult> {
  const claudeDir = opts.claudeDir ?? process.env.OCEAN_CLAUDE_DIR ?? join(homedir(), '.claude');
  const projectsDir = join(claudeDir, 'projects');
  const slug = slugifyCwd(projectCwd);
  const notes: string[] = [];
  const matchedDirs: string[] = [];

  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return {
      projectCwd,
      claudeProjectsDir: projectsDir,
      slug,
      matchedDirs,
      transcriptsFound: 0,
      sessions: [],
      notes: [
        `The Claude Code projects directory was not found: ${projectsDir} — there is no transcript record (not confirmed).`,
      ],
    };
  }

  for (const e of entries) {
    if (e.isDirectory() && normalizeName(e.name) === slug) matchedDirs.push(e.name);
  }

  /**
   * ÜST DİZİN OTURUMLARI (2026-07-29). Claude Code çoğu zaman bir çalışma
   * klasörünün kökünde açılır, depo onun ALTINDA durur:
   *     ~/Desktop/Calisma        ← Claude burada açık, transcript slug'ı bu
   *     ~/Desktop/Calisma/depo   ← `topbeam sync` burada koşuyor
   * Birebir slug eşlemesi bu durumda "0 oturum" verir; araç kendi yazıldığı işi
   * bile göremez (bunu Topbeam'in kendi deposunda ölçtük).
   *
   * Bu yüzden birebir eşleşme YOKSA üst dizinlere yürünür ve İLK bulunan
   * ata-oturum dizini kullanılır (en yakın ata; daha yukarısı daha çok yabancı iş
   * içerir). Ata oturumlar `fromAncestor` ile işaretlenir ve kapsam filtresi
   * (truth.ts) proje kökü dışındaki her yolu zaten eler — yani kardeş projelerin
   * işi bu panoya SIZMAZ, yalnız sayısı kapsam notuna düşer.
   *
   * Birebir eşleşme VARSA yukarı bakılmaz: kendi kaydı olan proje başkasının
   * kaydına ihtiyaç duymaz.
   */
  /**
   * ⚠️ SINIRLAR (2026-07-29 sertleştirme saldırısı — ilk hâli sınırsızdı).
   *
   * İlk sürüm kök dizine kadar yürüyordu ve `/` için üretilen `-` slug'ıyla
   * eşleşiyordu. ÖLÇÜLDÜ: boş bir klasörde `sync` koşunca makinedeki `/`
   * oturumlarından 5 yabancı oturum taranıyordu. Bu, sessiz bir kapsam
   * genişlemesidir — kullanıcının hiç ilgisi olmayan işleri okur.
   *
   * Sınırlar:
   *  - en fazla ANCESTOR_MAX_UP seviye yukarı,
   *  - $HOME'un ÜSTÜNE asla çıkma,
   *  - konak dizinlere (/, /Users, /tmp, /var …) asla eşleşme,
   *  - bir `.git` sınırına gelince dur (o zaten başka bir deponun köküdür).
   */
  let ancestorCwd: string | null = null;
  const kendiKaydiVar = await dizinlerdeTranscriptVarMi(projectsDir, matchedDirs);
  if (!kendiKaydiVar) {
    // Boş bir birebir-eşleşme dizini "kendi kaydı var" demek DEĞİLDİR
    // (ölçüldü: ajan koşumları boş slug dizinleri bırakabiliyor).
    // Ama dizinin VAR olup BOŞ olması ayrı bir gerçektir: retention silmiş
    // olabilir. Bu bilgi ata-oturuma düşerken kaybolmamalı.
    if (matchedDirs.length > 0) {
      notes.push(
        'This project has a transcript directory but no .jsonl inside — Claude Code retention ' +
          '(30 days by default) may have cleared it (not confirmed).',
      );
    }
    matchedDirs.length = 0;
    let dizin = resolve(projectCwd);
    const ev = resolve(homedir());
    for (let seviye = 0; seviye < ANCESTOR_MAX_UP; seviye++) {
      const ust = dirname(dizin);
      if (ust === dizin) break; // dosya sistemi kökü
      dizin = ust;
      if (KONAK_DIZINLER.has(dizin)) break;
      if (dizin === ev || !dizin.startsWith(ev)) break; // $HOME ve üstü kapalı
      const ustSlug = slugifyCwd(dizin);
      const bulunan = entries.filter((e) => e.isDirectory() && normalizeName(e.name) === ustSlug);
      if (bulunan.length > 0) {
        matchedDirs.push(...bulunan.map((e) => e.name));
        ancestorCwd = dizin;
        break;
      }
      // Başka bir deponun kökündeysek daha yukarı çıkma.
      if (await varMi(join(dizin, '.git'))) break;
    }
  }

  if (matchedDirs.length === 0) {
    notes.push(
      'There is no transcript directory for this project — Claude Code never recorded anything from this working directory, or the records were cleared (not confirmed).',
    );
    return { projectCwd, claudeProjectsDir: projectsDir, slug, matchedDirs, transcriptsFound: 0, sessions: [], notes };
  }
  if (ancestorCwd !== null) {
    notes.push(
      `This directory has no transcript record of its own; the records were read from a session in a parent directory (${ancestorCwd}). ` +
        'Only files under this project were counted — other work in that session was left out of scope.',
    );
  }

  const sessions: SessionSummary[] = [];
  let transcriptsFound = 0;
  /** En eski transcript dosyasının mtime'ı (ms) — saklama uyarısı için. */
  let enEskiMs: number | null = null;
  const resolvedCwd = resolve(projectCwd);

  for (const dirName of matchedDirs) {
    const dir = join(projectsDir, dirName);
    let files;
    try {
      files = await readdir(dir, { withFileTypes: true });
    } catch {
      notes.push(`This directory could not be read: ${dir}`);
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      transcriptsFound++;
      const transcriptPath = join(dir, f.name);
      try {
        const st = await stat(transcriptPath);
        const ms = st.mtimeMs;
        if (enEskiMs === null || ms < enEskiMs) enEskiMs = ms;
      } catch {
        // mtime okunamadı — uyarı verilmez (uydurma yok).
      }
      const sessionId = f.name.slice(0, -'.jsonl'.length);

      let subPaths: string[] = [];
      if (opts.includeSubagents !== false) {
        const subDir = join(dir, sessionId, 'subagents');
        try {
          const subs = await readdir(subDir, { withFileTypes: true });
          subPaths = subs
            .filter((s) => s.isFile() && s.name.endsWith('.jsonl'))
            .map((s) => join(subDir, s.name));
        } catch {
          // subagent dizini yok — normal.
        }
      }

      const summary = await summarizeTranscript(transcriptPath, subPaths);
      if (summary.cwd !== null && resolve(summary.cwd) !== resolvedCwd) summary.cwdMismatch = true;
      if (ancestorCwd !== null) summary.fromAncestor = true;
      sessions.push(summary);
    }
  }

  /**
   * SAKLAMA UYARISI (2026-07-29). Claude Code transcript'leri
   * `cleanupPeriodDays` (varsayılan 30 gün) sonunda siler. Silinince Topbeam'in
   * dosya/test kanıtı YENİDEN ÜRETİLEMEZ — iddialar sessizce düşer.
   * ÖLÇÜM (bu makine): 1903 transcript, en eskisi 28 gün, 30 günden eski SIFIR.
   * Kullanıcı kanıtını kaybetmeden önce haber alsın diye eşik 25 gün.
   */
  if (enEskiMs !== null) {
    const gun = Math.floor((Date.now() - enEskiMs) / 86_400_000);
    if (gun >= RETENTION_UYARI_GUN) {
      notes.push(
        `The oldest transcript is ${gun} days old. Claude Code deletes its records after ` +
          '30 days by default (cleanupPeriodDays); once they are gone, the evidence behind ' +
          'these claims cannot be reproduced. The only lasting record is the human approvals ' +
          'in the .ocean/passport.jsonl ledger — do not put off approving work that is ' +
          'finished, or raise "cleanupPeriodDays" in ~/.claude/settings.json.',
      );
    }
  }

  if (transcriptsFound === 0) {
    notes.push('There is a transcript directory but no .jsonl — retention may have cleared it (not confirmed).');
  }

  sessions.sort((a, b) => {
    const ka = a.firstTs ?? '￿';
    const kb = b.firstTs ?? '￿';
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.sessionId.localeCompare(b.sessionId);
  });

  return { projectCwd, claudeProjectsDir: projectsDir, slug, matchedDirs, transcriptsFound, sessions, notes };
}
