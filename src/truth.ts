/**
 * Gerçek motoru — toplayıcı çıktılarından Claim + LogEntry üretir.
 *
 * DETERMİNİSTİK: aynı girdi → aynı çıktı. LLM yok, şablon var. Zaman damgaları
 * girdiden gelir (transcript/git ts'leri); `now` yalnız girdide ts olmayan
 * durumların son çaresidir.
 *
 * KANIT KURALLARI (dürüstlük yasaları — ihlal = red):
 * - "dosya değişti" YALNIZ transcript Edit/Write kaydı VE git kaydı (diff
 *   --numstat HEAD ∪ status --porcelain) kesişince 'dosya-kaniti' olur.
 * - Bash çıktısından OKUNMUŞ geçti/kaldı sayısı varsa o claim 'test-kaniti'.
 *   Sayı okunamadıysa sayı UYDURULMAZ → 'dogrulanmadi'.
 * - Hiçbir kanıt yoksa 'dogrulanmadi' + "uygulandı görünüyor, doğrulanmadı".
 * - "çalışıyor" ifadesi bu motordan ASLA çıkmaz; yalnız verify akışının
 *   çağırdığı buildCalisiyorClaim (insan-onayı) üretebilir.
 * - OPSİYONEL CI (opts.ci): GitHub koşumu ancak head_sha bu deponun bilinen
 *   bir commit'iyle BİREBİR eşleşirse claim üretir ('test-kaniti'). Eşleşme
 *   yoksa hiçbir şey üretilmez — kaynak kapalıysa motor lokal kalır.
 * - TestSignal.exitCode===0 varsayım olabilir (exitAssumed transcript'te) —
 *   bu yüzden claim metinlerinde "exit 0 başarı" iddiası YOK; yalnız çıktıdan
 *   okunan sayılar ve gerçek (string'den gelen) sıfır-dışı exit kodları anılır.
 *
 * Log listesi varsayılan olarak SADECE kanıtlı gerçekleri içerir (git/test).
 * Claude'un niyet beyanları (Bash description) ancak includeBeyan=true ile,
 * 'claude-beyan' kaynağı ve "Beyan:" önekiyle girer — kanıt değil, beyan.
 *
 * GÜRÜLTÜ KESME (ürünün vaadi: gürültüyü kesmek — kendisi gürültü üretemez):
 * - PROJE KAPSAMI: transcript'teki düzenlemelerin yalnız PROJE KÖKÜ ALTINDAKİ
 *   dosyaları claim/log'a girer. Başka projenin ya da ~/.claude altındaki
 *   dosyaların yolu bu projenin panosunda işi yoktur (sayısı not'a düşer —
 *   kapsam daralması sessiz kalmaz).
 * - KONTROL KOMUTU: tsc/eslint gibi sayı üretmeyen komutlar claim üretmez
 *   (isCheckLikeCommand). Sayı üretmeyen komuttan "sonuç okunamadı" iddiası
 *   çıkarmak ölçüm hatasıydı.
 * - BEYAN SEYRELTME: bir beyan yalnız komutu projeye dokunuyorsa/anlamlı bir
 *   araç çağırıyorsa log'a girer; ardışık tekrarlar "×N" ile tekilleşir.
 * - LOG SINIRI: 500 satır dolduğunda önce KANIT taşıyan satırlar tutulur,
 *   beyanlar düşer.
 * Bunların hiçbiri kanıt seviyesini yükseltmez; yalnız gürültüyü eler.
 *
 * KAPSAM SIZINTISI (dosya yolları kapsandı, KOMUT METNİ kapsanmamıştı):
 * dosya yolları proje kökü dışındaysa hiç girmiyordu ama komut metni ham
 * geliyordu → kart manşetinde `cd "/Users/<isim>/Desktop/BaskaProje"` görünüyordu.
 * Artık metne giren her komut kisaltYollar()'dan geçer: proje kökü proje-göreli
 * ('./…') yazılır, proje dışı ev-dizini yolları '~/…' diye kısaltılır. Kısaltma
 * SESSİZ değildir — sayısı kapsam bloğuna düşer.
 *
 * Not (persist katmanına): evidence.ref komut metni içerebilir; state.json'a
 * yazan modül BP redact desenini kurmadan bu alanı diske YAZMAMALI.
 */
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  Claim,
  ClaimEvidence,
  ClaimSignals,
  LogEntry,
  Verification,
} from './types.ts';
import {
  commandSegments,
  isCheckLikeCommand,
  isTestLikeCommand,
  type BashRun,
  type ChangedFile,
  type ClaudeCollectResult,
  type SessionSummary,
  type TestSignal,
} from './collect/claude.ts';
import type { GitCommit, GitFacts } from './collect/git.ts';
import { buildCiClaims, type CiFacts } from './collect/ci.ts';

// ── sınırlar ─────────────────────────────────────────────────────────────────

const LIMITS = {
  /** Claim metninde listelenen dosya adı sayısı (kalanı "+N dosya daha"). */
  nameList: 6,
  /** Komut metninin claim/log metnine giren uzunluğu. */
  cmdLen: 60,
  /** Toplam log satırı (aşım notes'a düşer). */
  logMax: 500,
  /**
   * Claim.signals.paths içinde saklanan yol sayısı (state.json şişmesin).
   * fileCount TAM sayıyı taşır; kırpma yalnız ad listesini etkiler — kart
   * kritik-dosya taraması bu listede döner, ötesi kaçabilir (bilinen sınır).
   */
  signalPaths: 50,
  /** Beyan eşleştirmesinde bakılan proje dosya adı sayısı (O(n·m) sınırı). */
  beyanNames: 200,
  /** Beyan eşleştirmesinde anlamlı sayılan en kısa dosya adı (rastgele eşleşme olmasın). */
  beyanNameMin: 4,
} as const;

/**
 * Beyanı ayakta tutan araç ikilileri: sürüm kontrolü, paket/çalıştırma,
 * derleme/test, dağıtım. Bunların dışındaki komutlar (osascript, open, say,
 * sleep, echo…) proje dosyasına dokunmadıkça beyan olarak log'a girmez —
 * dogfood'daki "Beyan: Click ChatGPT send button" gürültüsünün kaynağı buydu.
 */
const ANLAMLI_BIN_RE =
  /^(git|npm|pnpm|yarn|bun|node|deno|tsc|eslint|prettier|biome|stylelint|jest|vitest|pytest|mocha|python3?|pip3?|poetry|uv|pipenv|cargo|go|rustc|make|cmake|docker|docker-compose|gradle|mvn|dotnet|swift|xcodebuild|expo|eas|next|vite|rollup|esbuild|webpack|tsx|ts-node|prisma|supabase|wrangler|vercel|netlify|surge|topbeam|ocean|buildpassport)(?![\w-])/;

// ── dış tipler ───────────────────────────────────────────────────────────────

export interface TruthOptions {
  /**
   * true → Bash description'ları "Beyan:" önekiyle log'a girer
   * (source 'claude-beyan'; KANIT DEĞİL). Varsayılan false: log yalnız
   * kanıtlı gerçekler.
   */
  includeBeyan?: boolean;
  /** Girdide ts olmayan satırlar için son-çare zaman (test determinizmi). */
  now?: Date;
  /** Ev dizini (yol kısaltma) — verilmezse os.homedir(). Test determinizmi. */
  homeDir?: string;
  /**
   * OPSİYONEL CI gerçekleri (collect/ci.ts). Verilmezse motor yalnız lokal
   * kaynaklardan çalışır — local-first vaadi burada da bozulmaz.
   */
  ci?: CiFacts;
}

/** Motorun ürettiği HAM log sayıları — sync bunları LogCounts'a tamamlar. */
export interface TruthCounts {
  /** Ham kanıt satırı (git olayları + kanıtlı claim satırları). */
  hamKanit: number;
  /** Ham beyan satırı (elenen dâhil — description'ı olan her bash koşumu). */
  hamBeyan: number;
  /** Projeyle ilişkilendirilemediği için log'a HİÇ alınmayan beyan. */
  ilgisizBeyan: number;
  /** Tekrar olduğu için birleşen satır. */
  tekillestirilen: number;
  /** Satır sınırında listeden düşen satır. */
  kirpilan: number;
  /** Motordan çıkan satır sayısı. */
  tutulan: number;
}

/** Motorun ölçtüğü kapsam daralmaları (pano "kapsam bloğu"nun kaynağı). */
export interface TruthScope {
  disKapsamDuzenleme: number;
  atlananOturum: number;
  kontrolKomutu: number;
  kisaltilanYol: number;
  gitYok: boolean;
}

export interface TruthResult {
  /** createdAt'a göre kronolojik, deterministik sıralı iddialar. */
  claims: Claim[];
  /** ts'e göre kronolojik log — varsayılan SADECE kanıtlı gerçekler. */
  log: LogEntry[];
  /** Dürüst durum notları (atlanan oturum, kırpılan liste...). */
  notes: string[];
  /** Ham → tutulan satır zinciri (panodaki her sayının kaynağı). */
  counts: TruthCounts;
  /** Neyin kapsam dışı bırakıldığı — sayıyla. */
  scope: TruthScope;
}

// ── yardımcılar ──────────────────────────────────────────────────────────────

/** Yolu mutlaklaştır: transcript yolları mutlak, git yolları köke göredir. */
function absPath(p: string, base: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(base, p);
}

/**
 * Proje köküne göre kısa yol — YALNIZ kök altındaki dosyalar için.
 * Dışarıdaki yol null döner: proje dışı mutlak yol bu panonun metnine
 * (ve dolayısıyla state.json'a) hiç girmez.
 */
function projectRelative(abs: string, projectCwd: string): string | null {
  const rel = relative(resolve(projectCwd), abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel;
}

/** Dosya proje kökünün ALTINDA mı (kökün kendisi dosya değildir → false). */
export function isInsideProject(path: string, projectCwd: string): boolean {
  return projectRelative(absPath(path, projectCwd), projectCwd) !== null;
}

// ── yol kısaltma (kapsam sızıntısı kapatma) ──────────────────────────────────

/** Regex özel karakter kaçışı (dinamik desen kurulumu için). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface YolKisaltma {
  text: string;
  /** Toplam kısaltma sayısı (proje-göreli + proje dışı). */
  hits: number;
  /** Proje DIŞINA çıktığı için kırpılan/masklenen yol sayısı. */
  disari: number;
}

/**
 * Metindeki mutlak yolları kısalt — kart manşeti başka projenin yolunu
 * göstermesin diye.
 *
 * - Proje kökü → '.' (yani `<kök>/src/a.ts` → `./src/a.ts`). Komut ÇALIŞIR
 *   kalır: proje kökünden koşulduğunda anlamı aynıdır.
 * - Proje dışı ama ev dizini altındaki yol → `disariKirp` ise '~/…' (kapsam
 *   dışı: bu panonun anlatacağı bir şey değil), değilse '~' öneki + kuyruk
 *   (notlar için: teşhis bilgisi korunur, kullanıcı adı görünmez).
 *
 * BİLİNEN SINIR: ev dizini dışındaki mutlak yollar (/tmp, /Volumes…) olduğu
 * gibi kalır — kullanıcı kimliği taşımazlar ve komutu kırmamak daha değerli.
 */
export function kisaltYollar(
  text: string,
  projectCwd: string,
  home: string,
  opts: { disariKirp?: boolean } = {},
): YolKisaltma {
  let hits = 0;
  let disari = 0;
  let out = text;

  const root = projectCwd === '' ? '' : resolve(projectCwd);
  // Sınır kontrolü (lookahead): '/a/b' deseni '/a/bc' yolunu yakalamasın.
  if (root !== '' && root !== sep) {
    out = out.replace(new RegExp(`${escapeRe(root)}(?=$|[/\\s"'\`;:,)\\]])`, 'g'), () => {
      hits++;
      return '.';
    });
  }

  const ev = home === '' ? '' : resolve(home);
  if (ev !== '' && ev !== sep && ev !== root) {
    // Kuyruk sınıfı kabuk ayraçlarını dışarıda bırakır (komutun geri kalanı yenmez).
    const re = new RegExp(`${escapeRe(ev)}((?:/[^\\s"'\`;:,)\\]|&<>]+)*)`, 'g');
    out = out.replace(re, (_m, tail: string) => {
      hits++;
      disari++;
      if (tail === '') return '~';
      return opts.disariKirp === true ? '~/…' : `~${tail}`;
    });
  }

  return { text: out, hits, disari };
}

/** Metin yazım yardımcıları — kısaltma sayacı buradan akar. */
interface Yazim {
  /** Komut/beyan metni: proje dışı yol '~/…' diye kırpılır (kapsam kuralı). */
  komut: (s: string) => string;
  /** Not metni: ev dizini '~' olur ama kuyruk kalır (teşhis bilgisi korunur). */
  not: (s: string) => string;
  /** Proje dışına çıktığı için kırpılan yol sayısı. */
  disari: () => number;
}

function makeYazim(projectCwd: string, home: string): Yazim {
  let disari = 0;
  return {
    komut: (s) => {
      const r = kisaltYollar(s, projectCwd, home, { disariKirp: true });
      disari += r.disari;
      return r.text;
    },
    not: (s) => kisaltYollar(s, projectCwd, home).text,
    disari: () => disari,
  };
}

/** "a, b, c" listesi — LIMITS.nameList üstü "+N dosya daha". */
function nameList(names: readonly string[]): string {
  if (names.length <= LIMITS.nameList) return names.join(', ');
  const shown = names.slice(0, LIMITS.nameList).join(', ');
  return `${shown} +${names.length - LIMITS.nameList} dosya daha`;
}

function shortCmd(command: string): string {
  const c = command.trim().replace(/\s+/g, ' ');
  return c.length > LIMITS.cmdLen ? `${c.slice(0, LIMITS.cmdLen)}…` : c;
}

/**
 * Git kanıt dizini — bir düzenlemenin git tarafında karşılığı İKİ yoldan kurulabilir:
 *
 *  1. ÇALIŞMA AĞACI: diff --numstat HEAD ∪ status --porcelain (kirli+yeni).
 *  2. COMMIT: recentCommits içinde o yola dokunan ve düzenlemeden SONRA atılmış
 *     bir commit.
 *
 * 2. madde neden var (2026-07-29 kusur düzeltmesi): commit'lenip ağacı temizlenen
 * dosya 1. kümede GÖRÜNMEZ. Yalnız 1'e bakıldığında aynı düzenleme "git'te izi yok
 * — doğrulanmadı" diye YENİ bir iddia doğuruyor, o iddia aynı teslim sözüne
 * eşleşiyor ve söz `completed` → `partial` düşüyordu. Ölçülen sonuç: bar 2/2 → 1/2
 * GERİLİYORDU. Yani **işini commit'lemek barını boşaltıyordu** — ürünün vaadinin
 * tam tersi.
 *
 * ZAMAN DİSİPLİNİ: commit yalnız düzenlemeden SONRA atıldıysa kanıt sayılır
 * (`commit.date >= file.lastTs`). Aksi hâlde "bu dosya geçmişte bir kez
 * commit'lenmiş" gibi zayıf bir gerçek, güncel bir düzenlemenin kanıtı gibi
 * görünürdü — bu, kanıtı sulandırmak olurdu. Zaman okunamıyorsa (lastTs yok ya da
 * tarih ayrıştırılamıyor) commit kanıtı KURULMAZ: kaçırmak, yanlış suçlamaktan iyidir.
 */
interface GitEvidenceIndex {
  /** Çalışma ağacında kaydı olan mutlak yollar. */
  worktree: Set<string>;
  /** Mutlak yol → o yola dokunan commit'ler (git log sırası: yeniden eskiye). */
  commits: Map<string, GitCommit[]>;
}

function gitEvidenceIndex(git: GitFacts, projectCwd: string): GitEvidenceIndex {
  const base = git.root ?? resolve(projectCwd);
  const worktree = new Set<string>();
  if (git.diffStat) {
    for (const f of git.diffStat.files) worktree.add(absPath(f.path, base));
  }
  for (const d of git.dirtyFiles) worktree.add(absPath(d.path, base));

  const commits = new Map<string, GitCommit[]>();
  for (const c of git.recentCommits) {
    for (const yol of c.files) {
      const abs = absPath(yol, base);
      const liste = commits.get(abs);
      if (liste) liste.push(c);
      else commits.set(abs, [c]);
    }
  }
  return { worktree, commits };
}

/**
 * Bu düzenlemeyi KAYDA GEÇİREN commit (varsa): yola dokunan ve düzenlemeden
 * sonra atılmış olanların EN ESKİSİ — yani değişikliği ilk kayda geçiren.
 * Tarihler farklı zaman dilimi ofsetleriyle gelebildiği için metin karşılaştırması
 * YAPILMAZ; epoch'a çevrilir.
 */
function kaydedenCommit(idx: GitEvidenceIndex, abs: string, lastTs: string | null): GitCommit | null {
  if (lastTs === null) return null;
  const duzenleme = Date.parse(lastTs);
  if (!Number.isFinite(duzenleme)) return null;
  const adaylar = idx.commits.get(abs);
  if (adaylar === undefined) return null;
  let en: { c: GitCommit; t: number } | null = null;
  for (const c of adaylar) {
    const t = Date.parse(c.date);
    if (!Number.isFinite(t) || t < duzenleme) continue;
    if (en === null || t < en.t) en = { c, t };
  }
  return en?.c ?? null;
}

/** Oturum için deterministik kısa etiket (log/claim metinlerinde). */
function sessionLabel(s: SessionSummary): string {
  return s.title ?? s.sessionId.slice(0, 8);
}

// ── claim üretimi ────────────────────────────────────────────────────────────

interface FileBuckets {
  /** Transcript'te hatasız edit VE git kaydı var → dosya-kanıtı adayı. */
  verified: ChangedFile[];
  /** Transcript'te hatasız edit var, git'te izi yok → doğrulanmadı. */
  transcriptOnly: ChangedFile[];
  /** Sonucu transcript'te hiç görülmeyen denemeler → ayrı, başarı sayılmaz. */
  unknownOnly: ChangedFile[];
  /** Proje kökü DIŞINDA kalan düzenlemeler — sayılır, claim'e girmez. */
  outsideCount: number;
  /**
   * Çalışma ağacında değil, COMMIT'te doğrulanan dosyalar → onu kayda geçiren
   * commit. Kanıt satırı SHA'yı yazsın diye tutulur: üçüncü kişi
   * `git show <sha> --stat` ile kendi makinesinde bakabilir.
   */
  commitRefs: Map<string, GitCommit>;
}

/**
 * Dosyaları kanıt kovalarına ayır. Proje kökü dışındaki dosyalar en başta
 * elenir: bu pano yalnız BU projeyi anlatır (yol da metne sızmaz).
 */
function bucketFiles(
  session: SessionSummary,
  gitIdx: GitEvidenceIndex,
  projectCwd: string,
): FileBuckets {
  const b: FileBuckets = {
    verified: [],
    transcriptOnly: [],
    unknownOnly: [],
    outsideCount: 0,
    commitRefs: new Map(),
  };
  for (const f of session.changedFiles) {
    if (f.edits === 0 && f.unknownEdits === 0) continue; // yalnız failedEdits: iddia yok
    const abs = absPath(f.path, projectCwd);
    if (projectRelative(abs, projectCwd) === null) {
      b.outsideCount++;
      continue;
    }
    if (f.edits > 0) {
      if (gitIdx.worktree.has(abs)) {
        b.verified.push(f);
      } else {
        // Ağaç temiz olabilir çünkü iş COMMIT'LENMİŞ olabilir — kanıt kaybolmaz.
        const c = kaydedenCommit(gitIdx, abs, f.lastTs);
        if (c !== null) {
          b.verified.push(f);
          b.commitRefs.set(f.path, c);
        } else {
          b.transcriptOnly.push(f);
        }
      }
    } else {
      b.unknownOnly.push(f);
    }
  }
  return b;
}

/**
 * git kanıt satırının metni. İki kaynak ayrı ayrı sayılır — "kaydı var" demek
 * yetmez, NEREDE kaydı olduğu söylenir: çalışma ağacı mı, commit mi.
 * Commit'te olan iş DAHA GÜÇLÜ kanıttır (üçüncü kişi `git show` ile bakabilir),
 * ama seviye YÜKSELTİLMEZ — seviye yalnız verify ile yükselir.
 */
function gitOzet(n: number, b: FileBuckets): string {
  const commitli = b.verified.filter((f) => b.commitRefs.has(f.path)).length;
  const agacta = n - commitli;
  if (commitli === 0) {
    return `git: ${n} dosyanın çalışma ağacında kaydı var (diff --numstat / status).`;
  }
  if (agacta === 0) {
    const shalar = [...new Set([...b.commitRefs.values()].map((c) => c.hash))];
    return (
      `git: ${n} dosya commit'lenmiş — düzenlemeden sonra atılan commit kayda geçirdi ` +
      `(${shalar.slice(0, 3).join(', ')}${shalar.length > 3 ? `, +${shalar.length - 3}` : ''}).`
    );
  }
  return `git: ${agacta} dosyanın çalışma ağacında kaydı var, ${commitli} dosya commit'lenmiş.`;
}

/** Kanıt referansı: commit kanıtı varsa onu kayda geçiren commit, yoksa HEAD. */
function gitRef(b: FileBuckets, git: GitFacts): string | null {
  const ilk = [...b.commitRefs.values()][0];
  if (ilk !== undefined) return ilk.hash;
  return git.headShort;
}

function fileClaims(
  session: SessionSummary,
  buckets: FileBuckets,
  git: GitFacts,
  projectCwd: string,
  fallbackTs: string,
): Claim[] {
  const claims: Claim[] = [];
  const ts = session.lastTs ?? fallbackTs;
  // Kovalardaki her dosya proje kökü altındadır (bucketFiles eledi) → rel yolu
  // her zaman vardır; yine de son çare olarak dosya adına düşülür.
  const names = (files: readonly ChangedFile[]): string[] =>
    files
      .map((f) => projectRelative(absPath(f.path, projectCwd), projectCwd) ?? basename(f.path))
      .sort();
  const lineTotals = (files: readonly ChangedFile[]): { a: number; r: number } => {
    let a = 0;
    let r = 0;
    for (const f of files) {
      a += f.addedLines;
      r += f.removedLines;
    }
    return { a, r };
  };

  /**
   * Kartın okuyacağı YAPISAL sinyaller. Yalnız ölçülmüş gerçek: dosya sayısı,
   * kısa yollar, git izi. noGitTrace SADECE kesin bilindiğinde yazılır
   * (belirsiz kova için hiç yazılmaz — bilinmiyor ≠ yok).
   */
  const fileSignals = (files: readonly ChangedFile[], noGitTrace?: boolean): ClaimSignals => {
    const all = names(files);
    const s: ClaimSignals = { fileCount: files.length, paths: all.slice(0, LIMITS.signalPaths) };
    if (noGitTrace !== undefined) s.noGitTrace = noGitTrace;
    return s;
  };

  if (buckets.verified.length > 0) {
    const n = buckets.verified.length;
    const { a, r } = lineTotals(buckets.verified);
    const evidence: ClaimEvidence[] = [
      {
        kind: 'transcript-tool-use',
        summary: `Transcript: ${n} dosyada Edit/Write sonucu hatasız görüldü (+${a}/−${r} satır).`,
        ref: session.sessionId,
      },
      {
        kind: 'git-diff',
        summary: gitOzet(n, buckets),
        ...(gitRef(buckets, git) !== null ? { ref: gitRef(buckets, git) as string } : {}),
      },
    ];
    claims.push({
      id: `dosya-git-${session.sessionId}`,
      text: `${n} dosya değişti: ${nameList(names(buckets.verified))}`,
      level: 'dosya-kaniti',
      kind: 'dosya',
      signals: fileSignals(buckets.verified, false), // git kaydı VAR (kesişim)
      evidence,
      sessionId: session.sessionId,
      createdAt: ts,
    });
  }

  if (buckets.transcriptOnly.length > 0) {
    const n = buckets.transcriptOnly.length;
    /**
     * GİT-YOK AYRIMI. Git deposu olmayan dizinde kesişim hiç KURULAMAZ:
     * "git'te izi yok" demek burada yanlış suçlamadır (ölçüm yapılmadı,
     * ölçüm başarısız olmadı). Metin farklı, sinyal de farklı: noGitTrace
     * YAZILMAZ → kart 'kayıp-riski' kuralını çalıştırıp git komutu önermez.
     */
    const gitsiz = !git.isGit;
    claims.push({
      id: `dosya-transcript-${session.sessionId}`,
      text: gitsiz
        ? `${n} dosya düzenlendi ama bu dizin git deposu değil — değişiklik git ile karşılaştırılamadı, ` +
          `uygulandı görünüyor, doğrulanmadı: ${nameList(names(buckets.transcriptOnly))}`
        : `${n} dosya için düzenleme kaydı var ama git'te izi yok ` +
          `(commit'lenmiş ya da geri alınmış olabilir) — uygulandı görünüyor, doğrulanmadı: ` +
          nameList(names(buckets.transcriptOnly)),
      level: 'dogrulanmadi',
      kind: 'dosya',
      // git varsa: izin YOKLUĞU ölçüldü (true). Git yoksa: ölçüm yapılamadı (yazılmaz).
      signals: fileSignals(buckets.transcriptOnly, gitsiz ? undefined : true),
      evidence: [
        {
          kind: 'transcript-tool-use',
          summary: gitsiz
            ? `Transcript: ${n} dosyada Edit/Write sonucu hatasız görüldü; dizin git deposu olmadığı için karşılaştırma yapılamadı.`
            : `Transcript: ${n} dosyada Edit/Write sonucu hatasız görüldü; git diff/status kaydı yok.`,
          ref: session.sessionId,
        },
      ],
      sessionId: session.sessionId,
      createdAt: ts,
    });
  }

  if (buckets.unknownOnly.length > 0) {
    const n = buckets.unknownOnly.length;
    claims.push({
      id: `dosya-belirsiz-${session.sessionId}`,
      text:
        `${n} dosyada düzenleme denendi, sonucu transcript'te görünmüyor — ` +
        `başarı sayılmaz, doğrulanmadı: ${nameList(names(buckets.unknownOnly))}`,
      level: 'dogrulanmadi',
      kind: 'dosya',
      // noGitTrace YAZILMAZ: bu kovada git kesişimi hiç sorulmadı — bilinmiyor.
      signals: fileSignals(buckets.unknownOnly),
      evidence: [
        {
          kind: 'transcript-tool-use',
          summary: `Transcript: ${n} dosyada tool_use var ama tool_result hiç görülmedi.`,
          ref: session.sessionId,
        },
      ],
      sessionId: session.sessionId,
      createdAt: ts,
    });
  }

  return claims;
}

/** Oturum içi test sinyallerini komut başına SON koşuma indirger (kronolojik sıra korunur). */
function lastSignalPerCommand(signals: readonly TestSignal[]): TestSignal[] {
  const byCmd = new Map<string, TestSignal>();
  for (const s of signals) byCmd.set(s.command, s); // sonraki öncekini ezer = son koşum
  return [...byCmd.values()];
}

/**
 * KONTROL komutu mu (tsc/eslint/prettier…)? Sayı üretmeyen komuttan sonuç
 * beklenmez → claim de üretilmez. Test ikilisiyle aynı zincirdeyse (npm test
 * && tsc) test sınıfı kazanır, claim üretilmeye devam eder.
 */
function kontrolKomutu(command: string): boolean {
  return isCheckLikeCommand(command) && !isTestLikeCommand(command);
}

/**
 * ⚠️ KAPSAM KAPISI (2026-07-29, sertleştirme saldırısının 2. kritiği).
 *
 * Dosya claim'leri her zaman projectRelative()'ten geçiyordu; TEST claim'leri
 * HİÇBİR kapsam kontrolünden geçmiyordu. Ata-dizin okuması eklenince
 * (aynı gün) sonuç ölçüldü: ~/Desktop altında SIFIR iş yapılmış boş bir depoda
 * "Claim: 93 (61 test kanıtı)" — başka projenin `npm test` çıktısı, bu projenin
 * "test-kanıtı" manşeti oluyordu. Üstelik pano aynı ekranda
 * "yalnız bu projenin altındaki dosyalar sayıldı" diye YAZIYORDU.
 *
 * Bu bir yanlış-pozitif değil, ÜRETİLMİŞ SAHTE KANITTI — ürünün tek iddiasının
 * tam karşısı.
 *
 * Kural: bir test sinyali ancak oturumun cwd'si PROJE KÖKÜNÜN ALTINDAYSA claim
 * üretir. Ata-dizin oturumlarında (fromAncestor) testin hangi alt projede
 * koşulduğu ÖLÇÜLEMEZ → test claim'i hiç üretilmez. Kaçırmak, yanlış
 * suçlamaktan iyidir; elenen sayı kapsam notuna yazılır (sessiz eleme yok).
 */
function testSinyaliBuProjeyeAtfedilebilirMi(session: SessionSummary, projectCwd: string): boolean {
  if (session.fromAncestor) return false; // hangi alt projede koştuğu bilinmiyor
  const cwd = session.cwd;
  if (cwd === null) return false; // cwd okunamadı → atfetme
  const kok = resolve(projectCwd);
  const oturum = resolve(cwd);
  return oturum === kok || oturum.startsWith(kok + sep);
}

function testClaims(
  session: SessionSummary,
  fallbackTs: string,
  yaz: Yazim,
  projectCwd: string,
): { claims: Claim[]; skipped: number; kapsamDisi: number } {
  const claims: Claim[] = [];
  if (!testSinyaliBuProjeyeAtfedilebilirMi(session, projectCwd)) {
    const n = lastSignalPerCommand(session.testSignals).filter((x) => !kontrolKomutu(x.command)).length;
    return { claims, skipped: 0, kapsamDisi: n };
  }
  const tumu = lastSignalPerCommand(session.testSignals);
  // Sınıflandırma HAM komut üzerinde yapılır (maskeleme yalnız METNE dokunur).
  const signals = tumu.filter((s) => !kontrolKomutu(s.command));
  const skipped = tumu.length - signals.length;
  signals.forEach((sig, i) => {
    const ts = sig.ts ?? session.lastTs ?? fallbackTs;
    const komut = yaz.komut(sig.command);
    const cmd = shortCmd(komut);
    const id = `test-${session.sessionId}-${i}`;
    const hasNumbers = sig.passed !== null || sig.failed !== null;

    /**
     * Kart sinyalleri — yalnız ÇIKTIDAN OKUNMUŞ sayılar ve GERÇEK sıfır-dışı
     * exit. exitCode 0 varsayım olabilir (exitAssumed) → asla sinyal yazılmaz.
     */
    const signals: ClaimSignals = {};
    if (sig.passed !== null) signals.passedTests = sig.passed;
    if (sig.failed !== null) signals.failedTests = sig.failed;
    if (sig.exitCode !== null && sig.exitCode !== 0) signals.nonZeroExit = sig.exitCode;

    if (hasNumbers) {
      // Çıktıdan OKUNMUŞ sayı var → test-kanıtı (geçse de kalsa da kanıtlı gerçek).
      let text: string;
      if (sig.failed !== null && sig.failed > 0) {
        text =
          sig.passed !== null
            ? `Test koşumunda ${sig.failed} test başarısız, ${sig.passed} test geçti (${cmd}).`
            : `Test koşumunda ${sig.failed} test başarısız (${cmd}).`;
      } else if (sig.passed !== null && sig.passed > 0) {
        text = `${sig.passed} test geçti${sig.failed === 0 ? ', 0 başarısız' : ''} (${cmd}).`;
      } else {
        text = `Test komutu koştu, çıktıda 0 test sayıldı (${cmd}).`;
      }
      const evidence: ClaimEvidence[] = [
        {
          kind: 'test-output',
          summary: sig.summaryLine ?? 'Test çıktısından geçti/kaldı sayısı okundu.',
          ref: komut,
        },
      ];
      if (sig.exitCode !== null && sig.exitCode !== 0) {
        // Sıfır-dışı exit yalnız string sonuçtan gelir → gerçek, varsayım değil.
        evidence.push({ kind: 'test-output', summary: `Komut exit ${sig.exitCode} ile bitti.` });
      }
      claims.push({
        id,
        text,
        level: 'test-kaniti',
        kind: 'test',
        signals,
        evidence,
        sessionId: session.sessionId,
        createdAt: ts,
      });
    } else {
      // Sayı okunamadı → sayı uydurulmaz, seviye yükselmez.
      const suffix =
        sig.exitCode !== null && sig.exitCode !== 0 ? ` Komut exit ${sig.exitCode} ile bitti.` : '';
      claims.push({
        id,
        text: `Test komutu koşuldu (${cmd}) ama sonuç çıktıdan okunamadı — doğrulanmadı.${suffix}`,
        level: 'dogrulanmadi',
        kind: 'test',
        signals,
        evidence: [
          {
            kind: 'transcript-tool-use',
            summary: 'Transcript: test-benzeri komut koştu; çıktıdan geçti/kaldı sayısı çekilemedi.',
            ref: komut,
          },
        ],
        sessionId: session.sessionId,
        createdAt: ts,
      });
    }
  });
  return { claims, skipped, kapsamDisi: 0 };
}

// ── log üretimi ──────────────────────────────────────────────────────────────

function gitLog(git: GitFacts, nowIso: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const c of git.recentCommits) {
    entries.push({ ts: c.date, text: `Commit: ${c.subject} (${c.hash})`, source: 'git', ref: c.hash });
  }
  if (git.diffStat && git.diffStat.filesChanged > 0) {
    const d = git.diffStat;
    entries.push({
      ts: nowIso,
      text: `Çalışma ağacında ${d.filesChanged} dosya değişik (+${d.insertions}/−${d.deletions}) — henüz commit'lenmedi.`,
      source: 'git',
    });
  }
  return entries;
}

function claimLog(claims: readonly Claim[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const c of claims) {
    if (c.level === 'dosya-kaniti') {
      entries.push({ ts: c.createdAt, text: c.text, source: 'git', ...(c.sessionId ? { sessionId: c.sessionId } : {}) });
    } else if (c.level === 'test-kaniti') {
      entries.push({ ts: c.createdAt, text: c.text, source: 'test', ...(c.sessionId ? { sessionId: c.sessionId } : {}) });
    }
    // dogrulanmadi → log'a girmez: log SADECE kanıtlı gerçekler.
  }
  return entries;
}

/**
 * Beyan log'a girmeye değer mi? Beyan zaten KANIT DEĞİL; bu yüzden en azından
 * PROJEYLE İLİŞKİLİ olmak zorunda. Ölçüt (sırayla):
 *  1. koşum test/kontrol komutu → ilişkili,
 *  2. komut metni proje kökünü ya da bu oturumda dokunulan bir proje dosyasını
 *     anıyor → ilişkili,
 *  3. komut anlamlı bir araç ikilisi çağırıyor (git/npm/node/docker…) → ilişkili.
 * Hiçbiri değilse beyan düşer: "Beyan: Click ChatGPT send button" gibi satırlar
 * bu projenin panosunda gerçeğin altını doldurmaz, üstünü örter.
 */
export function beyanAnlamli(
  run: BashRun,
  projectCwd: string,
  projectNames: ReadonlySet<string>,
): boolean {
  if (run.isTestLike || run.isCheckLike) return true;
  const cmd = run.command;
  if (cmd.trim() === '') return false; // komut yok → bağlam yok → kanıt-dışı gürültü
  if (cmd.includes(resolve(projectCwd))) return true;
  for (const seg of commandSegments(cmd)) {
    if (ANLAMLI_BIN_RE.test(seg)) return true;
  }
  for (const name of projectNames) {
    if (cmd.includes(name)) return true;
  }
  return false;
}

/** Bu oturumda dokunulan PROJE dosyalarının eşleştirme adları (rel yol + dosya adı). */
function projectFileNames(session: SessionSummary, projectCwd: string): Set<string> {
  const out = new Set<string>();
  for (const f of session.changedFiles) {
    if (out.size >= LIMITS.beyanNames) break;
    const rel = projectRelative(absPath(f.path, projectCwd), projectCwd);
    if (rel === null) continue;
    if (rel.length >= LIMITS.beyanNameMin) out.add(rel);
    const base = basename(rel);
    if (base.length >= LIMITS.beyanNameMin) out.add(base);
  }
  return out;
}

function beyanLog(
  session: SessionSummary,
  projectCwd: string,
  fallbackTs: string,
  yaz: Yazim,
): { entries: LogEntry[]; dropped: number; ham: number } {
  const entries: LogEntry[] = [];
  const names = projectFileNames(session, projectCwd);
  let dropped = 0;
  let ham = 0;
  for (const run of session.bashRuns) {
    if (run.description === null) continue;
    ham++;
    // İlişki testi HAM komut üzerinde (maskeleme kararı etkilemesin).
    if (!beyanAnlamli(run, projectCwd, names)) {
      dropped++;
      continue;
    }
    entries.push({
      ts: run.ts ?? session.lastTs ?? fallbackTs,
      text: `Beyan: ${yaz.komut(run.description)}`,
      source: 'claude-beyan',
      sessionId: session.sessionId,
      // ref BİLEREK yok: komut metni secret içerebilir (redact persist katmanında).
    });
  }
  return { entries, dropped, ham };
}

// ── tekrar sıkıştırma + log sınırı ───────────────────────────────────────────

/** Metnin sonundaki "×N" sayacı (varsa) — tekrar birleştirmede toplanır. */
const REPEAT_SUFFIX_RE = /\s×(\d+)$/;

function splitRepeat(text: string): { base: string; n: number } {
  const m = REPEAT_SUFFIX_RE.exec(text);
  if (m?.[1] === undefined) return { base: text, n: 1 };
  return { base: text.slice(0, m.index), n: Number(m[1]) };
}

/** Karşılaştırma anahtarı: kaynak + normalize metin (büyük/küçük ve boşluk farkı yutulur). */
function repeatKey(source: string, base: string): string {
  return `${source}|${base.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')}`;
}

/**
 * ARDIŞIK tekrarları tek satıra indir: "Beyan: X" ×3 → "Beyan: X ×3".
 * Kronolojik sıra korunur (birleşen satır EN ERKEN ts'i tutar); sayaç toplanır,
 * yani ikinci kez çalıştırmak sayıyı bozmaz. Ardışık olmayan tekrarlar
 * bilerek ayrı kalır — araları başka olayla dolu iki koşum aynı olay değildir.
 */
export function collapseRepeats(entries: readonly LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  const counts: number[] = [];
  const keys: string[] = [];
  for (const e of entries) {
    const { base, n } = splitRepeat(e.text);
    const key = repeatKey(e.source, base);
    const last = out.length - 1;
    if (last >= 0 && keys[last] === key) {
      counts[last] = (counts[last] ?? 1) + n;
      continue;
    }
    out.push({ ...e, text: base });
    counts.push(n);
    keys.push(key);
  }
  return out.map((e, i) => {
    const n = counts[i] ?? 1;
    return n > 1 ? { ...e, text: `${e.text} ×${n}` } : e;
  });
}

/**
 * Log sınırı — KANIT ÖNCELİKLİ. Sınır dolduğunda önce beyanlar düşer;
 * git/test/insan/topbeam satırları (gerçeğin kendisi) en sona kadar korunur.
 */
function capLog(log: readonly LogEntry[], notes: string[]): LogEntry[] {
  if (log.length <= LIMITS.logMax) return [...log];
  const kanit = log.filter((e) => e.source !== 'claude-beyan');
  const beyan = log.filter((e) => e.source === 'claude-beyan');
  const keptKanit = kanit.slice(-LIMITS.logMax);
  const slot = LIMITS.logMax - keptKanit.length;
  const keptBeyan = slot > 0 ? beyan.slice(-slot) : [];
  // "toplam" DEMİYORUZ: buraya gelen sayı zaten süzülmüş+tekilleşmiş bir sayı.
  // Ham sayı kapsam bloğunda (ScopeNotes.log) durur.
  notes.push(
    `Log ${LIMITS.logMax} satırla sınırlandı (bu adıma ${log.length} satır girmişti): kanıt taşıyan satırlar önce tutuldu, ` +
      `${beyan.length - keptBeyan.length} beyan ve ${kanit.length - keptKanit.length} kanıt satırı listeden düştü.`,
  );
  return sortLog([...keptKanit, ...keptBeyan]);
}

/** Deterministik log sıralaması: ts, eşitlikte metin. */
function sortLog(entries: LogEntry[]): LogEntry[] {
  return entries.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : x.text.localeCompare(y.text)));
}

// ── dış API ──────────────────────────────────────────────────────────────────

/**
 * Toplayıcı çıktılarından deterministik Claim + LogEntry üret.
 * Bu motor ASLA 'insan-onayi' seviyesi ve "çalışıyor" ifadesi üretmez.
 */
export function buildTruth(
  claude: ClaudeCollectResult,
  git: GitFacts,
  opts: TruthOptions = {},
): TruthResult {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const home = opts.homeDir ?? homedir();
  const yaz = makeYazim(claude.projectCwd, home);
  const notes: string[] = [...claude.notes, ...git.notes, ...(opts.ci?.notes ?? [])];
  const gitIdx = gitEvidenceIndex(git, claude.projectCwd);

  const claims: Claim[] = [];
  const log: LogEntry[] = gitLog(git, nowIso);
  let hamKanit = log.length;
  let hamBeyan = 0;
  let disKapsam = 0;
  let kontrolAtlanan = 0;
  /** Bu projeye ATFEDİLEMEYEN test koşumu (ata oturum / proje dışı cwd). */
  let testKapsamDisi = 0;
  let beyanDusen = 0;
  let atlananOturum = 0;

  for (const session of claude.sessions) {
    // Ata oturum (üst dizinde açılmış Claude) BİLİNÇLİ olarak atlanmaz: cwd'si
    // farklıdır ama işin bir kısmı bu projeye aittir; kapsam filtresi zaten
    // proje kökü dışındaki yolları eler.
    if (
      !session.fromAncestor &&
      session.cwdMismatch &&
      session.cwd !== null &&
      session.lastCwd !== null &&
      session.cwd === session.lastCwd
    ) {
      // Baştan sona başka cwd — büyük olasılıkla başka projenin işi.
      atlananOturum++;
      notes.push(
        `Oturum ${sessionLabel(session)} (${session.sessionId.slice(0, 8)}…) farklı bir cwd ile kaydedilmiş — claim üretilmedi.`,
      );
      continue;
    }
    const buckets = bucketFiles(session, gitIdx, claude.projectCwd);
    disKapsam += buckets.outsideCount;
    claims.push(...fileClaims(session, buckets, git, claude.projectCwd, nowIso));
    const t = testClaims(session, nowIso, yaz, claude.projectCwd);
    claims.push(...t.claims);
    kontrolAtlanan += t.skipped;
    testKapsamDisi += t.kapsamDisi;
    if (opts.includeBeyan === true) {
      const b = beyanLog(session, claude.projectCwd, nowIso, yaz);
      log.push(...b.entries);
      beyanDusen += b.dropped;
      hamBeyan += b.ham;
    }
  }

  /**
   * CI claim'leri (varsa) — oturumlardan bağımsız, commit'e bağlı gerçekler.
   * SHA birebir eşleşmediyse buradan hiçbir şey çıkmaz (collect/ci.ts).
   */
  if (opts.ci !== undefined) claims.push(...buildCiClaims(opts.ci, git));

  // Kapsam daralması SESSİZ kalmaz — neyin dışarıda tutulduğu sayıyla söylenir.
  if (disKapsam > 0) {
    notes.push(
      `${disKapsam} düzenleme proje kökü dışındaki dosyalarda — claim ve log dışında tutuldu (bu pano yalnız bu projeyi anlatır).`,
    );
  }
  if (testKapsamDisi > 0) {
    // Sessiz eleme YOK: kaçırdığımızı da sayıyla söyleriz.
    notes.push(
      `${testKapsamDisi} test koşumu bu projeye atfedilemedi ve kanıt SAYILMADI — ` +
        'koşum bu projenin dizininde yapılmamış (ya da üst dizin oturumundan geliyor, ' +
        'hangi alt projede koştuğu ölçülemiyor). Kaçırmak, yanlış suçlamaktan iyidir.',
    );
  }
  if (kontrolAtlanan > 0) {
    notes.push(
      `${kontrolAtlanan} kontrol komutu (tsc/eslint gibi) claim üretmedi — bu komutlar geçti/kaldı sayısı üretmez.`,
    );
  }
  if (beyanDusen > 0) {
    notes.push(
      `${beyanDusen} beyan satırı projeyle ilişkilendirilemedi ve log'a alınmadı (beyan zaten kanıt değildir).`,
    );
  }

  const kanitSatirlari = claimLog(claims);
  hamKanit += kanitSatirlari.length;
  log.push(...kanitSatirlari);

  // Deterministik sıralama: ts, sonra metin (eşit ts'te sabit sıra).
  // Sonra ardışık tekrarlar "×N" ile tekilleşir, en son kanıt-öncelikli sınır.
  const giren = log.length; // elemeden SONRA, tekilleştirmeden ÖNCE
  const collapsed = collapseRepeats(sortLog(log));
  const capped = capLog(collapsed, notes);

  claims.sort((x, y) =>
    x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id.localeCompare(y.id),
  );

  return {
    claims,
    log: capped,
    // Notlarda da mutlak yol kalmasın (toplayıcı notları dizin yolu taşıyor).
    notes: notes.map((n) => yaz.not(n)),
    counts: {
      hamKanit,
      hamBeyan,
      ilgisizBeyan: beyanDusen,
      tekillestirilen: giren - collapsed.length,
      kirpilan: collapsed.length - capped.length,
      tutulan: capped.length,
    },
    scope: {
      disKapsamDuzenleme: disKapsam,
      atlananOturum,
      kontrolKomutu: kontrolAtlanan,
      kisaltilanYol: yaz.disari(),
      gitYok: !git.isGit,
    },
  };
}

/**
 * "Çalışıyor" iddiasının TEK üretim yolu — verify akışı çağırır.
 * İnsan onayı olmadan bu fonksiyona gelinemez (Verification zorunlu).
 */
export function buildCalisiyorClaim(subject: string, verification: Verification): Claim {
  return {
    id: `calisiyor-${verification.at}`,
    text: `${subject} çalışıyor — kullanıcı doğruladı (${verification.by}).`,
    level: 'insan-onayi',
    kind: 'durum',
    evidence: [
      {
        kind: 'human',
        summary: `${verification.by} ${verification.at} tarihinde '${verification.decision}' kararı verdi${
          verification.note ? `: ${verification.note}` : '.'
        }`,
      },
    ],
    createdAt: verification.at,
  };
}
