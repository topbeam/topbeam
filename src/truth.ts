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
 * - TestSignal.exitCode===0 varsayım olabilir (exitAssumed transcript'te) —
 *   bu yüzden claim metinlerinde "exit 0 başarı" iddiası YOK; yalnız çıktıdan
 *   okunan sayılar ve gerçek (string'den gelen) sıfır-dışı exit kodları anılır.
 *
 * Log listesi varsayılan olarak SADECE kanıtlı gerçekleri içerir (git/test).
 * Claude'un niyet beyanları (Bash description) ancak includeBeyan=true ile,
 * 'claude-beyan' kaynağı ve "Beyan:" önekiyle girer — kanıt değil, beyan.
 *
 * Not (persist katmanına): evidence.ref komut metni içerebilir; state.json'a
 * yazan modül BP redact desenini kurmadan bu alanı diske YAZMAMALI.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  Claim,
  ClaimEvidence,
  ClaimSignals,
  LogEntry,
  Verification,
} from './types.ts';
import type {
  ChangedFile,
  ClaudeCollectResult,
  SessionSummary,
  TestSignal,
} from './collect/claude.ts';
import type { GitFacts } from './collect/git.ts';

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
} as const;

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
}

export interface TruthResult {
  /** createdAt'a göre kronolojik, deterministik sıralı iddialar. */
  claims: Claim[];
  /** ts'e göre kronolojik log — varsayılan SADECE kanıtlı gerçekler. */
  log: LogEntry[];
  /** Dürüst durum notları (atlanan oturum, kırpılan liste...). */
  notes: string[];
}

// ── yardımcılar ──────────────────────────────────────────────────────────────

/** Yolu mutlaklaştır: transcript yolları mutlak, git yolları köke göredir. */
function absPath(p: string, base: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(base, p);
}

/** Kullanıcıya gösterilecek kısa yol (proje köküne göre; dışarıysa olduğu gibi). */
function shortPath(abs: string, projectCwd: string): string {
  const rel = relative(resolve(projectCwd), abs);
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' ? rel : abs;
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
 * Git'in kayıt gördüğü dosyaların mutlak yol kümesi:
 * diff --numstat HEAD (izlenen değişiklik) ∪ status --porcelain (kirli+yeni).
 * DİKKAT: commit'lenip ağacı temizlenen dosyalar burada GÖRÜNMEZ — bu bilinen
 * bir kapsam sınırı, claim metni bunu dürüstçe söyler.
 */
function gitKnownPaths(git: GitFacts, projectCwd: string): Set<string> {
  const base = git.root ?? resolve(projectCwd);
  const known = new Set<string>();
  if (git.diffStat) {
    for (const f of git.diffStat.files) known.add(absPath(f.path, base));
  }
  for (const d of git.dirtyFiles) known.add(absPath(d.path, base));
  return known;
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
}

function bucketFiles(
  session: SessionSummary,
  gitKnown: ReadonlySet<string>,
  projectCwd: string,
): FileBuckets {
  const b: FileBuckets = { verified: [], transcriptOnly: [], unknownOnly: [] };
  for (const f of session.changedFiles) {
    if (f.edits > 0) {
      const abs = absPath(f.path, projectCwd);
      if (gitKnown.has(abs)) b.verified.push(f);
      else b.transcriptOnly.push(f);
    } else if (f.unknownEdits > 0) {
      b.unknownOnly.push(f);
    }
    // edits=0 & yalnız failedEdits: değişiklik iddiası yok (hata sayacı ayrı).
  }
  return b;
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
  const names = (files: readonly ChangedFile[]): string[] =>
    files.map((f) => shortPath(absPath(f.path, projectCwd), projectCwd)).sort();
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
        summary: `git: ${n} dosyanın çalışma ağacında kaydı var (diff --numstat / status).`,
        ...(git.headShort !== null ? { ref: git.headShort } : {}),
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
    claims.push({
      id: `dosya-transcript-${session.sessionId}`,
      text:
        `${n} dosya için düzenleme kaydı var ama git'te izi yok ` +
        `(commit'lenmiş ya da geri alınmış olabilir) — uygulandı görünüyor, doğrulanmadı: ` +
        nameList(names(buckets.transcriptOnly)),
      level: 'dogrulanmadi',
      kind: 'dosya',
      signals: fileSignals(buckets.transcriptOnly, true), // git'te izi YOK (kesin)
      evidence: [
        {
          kind: 'transcript-tool-use',
          summary: `Transcript: ${n} dosyada Edit/Write sonucu hatasız görüldü; git diff/status kaydı yok.`,
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

function testClaims(session: SessionSummary, fallbackTs: string): Claim[] {
  const claims: Claim[] = [];
  const signals = lastSignalPerCommand(session.testSignals);
  signals.forEach((sig, i) => {
    const ts = sig.ts ?? session.lastTs ?? fallbackTs;
    const cmd = shortCmd(sig.command);
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
          ref: sig.command,
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
            ref: sig.command,
          },
        ],
        sessionId: session.sessionId,
        createdAt: ts,
      });
    }
  });
  return claims;
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

function beyanLog(session: SessionSummary, fallbackTs: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const run of session.bashRuns) {
    if (run.description === null) continue;
    entries.push({
      ts: run.ts ?? session.lastTs ?? fallbackTs,
      text: `Beyan: ${run.description}`,
      source: 'claude-beyan',
      sessionId: session.sessionId,
      // ref BİLEREK yok: komut metni secret içerebilir (redact persist katmanında).
    });
  }
  return entries;
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
  const notes: string[] = [...claude.notes, ...git.notes];
  const gitKnown = gitKnownPaths(git, claude.projectCwd);

  const claims: Claim[] = [];
  let log: LogEntry[] = gitLog(git, nowIso);

  for (const session of claude.sessions) {
    if (session.cwdMismatch && session.cwd !== null && session.lastCwd !== null && session.cwd === session.lastCwd) {
      // Baştan sona başka cwd — büyük olasılıkla başka projenin işi.
      notes.push(
        `Oturum ${sessionLabel(session)} (${session.sessionId.slice(0, 8)}…) farklı bir cwd ile kaydedilmiş — claim üretilmedi.`,
      );
      continue;
    }
    const buckets = bucketFiles(session, gitKnown, claude.projectCwd);
    claims.push(...fileClaims(session, buckets, git, claude.projectCwd, nowIso));
    claims.push(...testClaims(session, nowIso));
    if (opts.includeBeyan === true) log.push(...beyanLog(session, nowIso));
  }

  log.push(...claimLog(claims));

  // Deterministik sıralama: ts, sonra metin (eşit ts'te sabit sıra).
  log.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : x.text.localeCompare(y.text)));
  if (log.length > LIMITS.logMax) {
    notes.push(`Log ${LIMITS.logMax} satırla sınırlandı (toplam ${log.length}).`);
    log = log.slice(-LIMITS.logMax);
  }

  claims.sort((x, y) =>
    x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id.localeCompare(y.id),
  );

  return { claims, log, notes };
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
