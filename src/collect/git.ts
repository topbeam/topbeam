/**
 * Git gerçekleri toplayıcısı.
 *
 * cwd'nin git durumunu SALT-OKUNUR komutlarla özetler: status --porcelain,
 * log, diff --numstat. Repo'ya tek byte yazılmaz. Git yoksa ya da dizin repo
 * değilse zarif boş döner — ASLA fırlatmaz (hata = notes'ta dürüst cümle).
 *
 * BP konvansiyonları: shell:false (execFile), timeout, kısıtlı env,
 * sınırlı buffer, kapsam daralması sessiz olamaz (notes).
 */
import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_DIRTY_FILES = 500;
const MAX_NUMSTAT_FILES = 1000;
/** Commit başına saklanan yol sayısı — dev commit'ler belleği şişirmesin. */
const MAX_COMMIT_FILES = 500;
const MAX_BUFFER = 8 * 1024 * 1024;

export interface GitDirtyFile {
  /** status --porcelain XY kodu (örn " M", "??", "A "). */
  status: string;
  path: string;
}

export interface GitCommit {
  hash: string; // kısa hash
  /**
   * Tam (40 hane) commit SHA'sı. CI eşleştirmesi BUNUN üzerinden yapılır:
   * kısa hash bir ÖNEKTİR, önek eşleşmesi "birebir" değildir (collect/ci.ts).
   */
  full: string;
  date: string; // ISO-8601 (committer date)
  subject: string;
  /**
   * Bu commit'in dokunduğu yollar (repo köküne göre, `git log --name-only`).
   * Boş olabilir: merge commit'leri varsayılan olarak dosya listelemez ve
   * liste MAX_COMMIT_FILES ile sınırlıdır. Boşluk "dosya yok" demek DEĞİLDİR —
   * bu yüzden boş liste hiçbir iddiayı çürütmek için kullanılmaz.
   */
  files: string[];
}

export interface GitDiffFileStat {
  path: string;
  /** null = binary dosya (numstat '-'). */
  added: number | null;
  removed: number | null;
}

export interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** MAX_NUMSTAT_FILES ile sınırlı (aşım notes'a düşer). */
  files: GitDiffFileStat[];
}

export interface GitFacts {
  /** false = git çalıştırılamadı (PATH'te yok). */
  gitAvailable: boolean;
  isGit: boolean;
  root: string | null;
  branch: string | null;
  headHash: string | null;
  headShort: string | null;
  headDate: string | null;
  headSubject: string | null;
  dirtyFiles: GitDirtyFile[];
  recentCommits: GitCommit[];
  /** Çalışma ağacı+index vs HEAD (numstat). Commit yoksa null. */
  diffStat: GitDiffStat | null;
  /** Dürüst durum notları — eksik kapsam sessiz kalmaz. */
  notes: string[];
}

export interface GitCollectOptions {
  maxCommits?: number;
  timeoutMs?: number;
  /** Test için: 'git' yerine başka binary (yokluk senaryosu simülasyonu). */
  gitBin?: string;
}

interface GitCmd {
  ok: boolean;
  stdout: string;
  stderr: string;
  enoent: boolean;
  timedOut: boolean;
}

/**
 * Git bazı yolları çift tırnak içinde verir (boşluk/özel karakter). quotepath
 * kapalı olsa da tırnaklama sürebilir; tırnak yolun parçası DEĞİLDİR.
 */
function tirnaksiz(yol: string): string {
  const y = yol.trim();
  if (y.length >= 2 && y.startsWith('"') && y.endsWith('"')) return y.slice(1, -1);
  return y;
}

/**
 * ⚠️ `core.quotepath=false` ZORUNLU (2026-07-29 sertleştirme bulgusu).
 *
 * Git, ASCII dışı dosya adlarını VARSAYILAN olarak sekizli kaçışlarla verir:
 *     çıkış-raporu.ts  →  "\303\247\304\261k\304\261\305\237-raporu.ts"
 * Topbeam bu diziyi transcript'teki gerçek yolla eşleştiremiyordu; sonuç, sakin
 * ama DÜPEDÜZ YANLIŞ bir cümleydi: dosya `git status`'ta gözle görünürken araç
 * "git'te izi yok" diyor ve barı geriletiyordu. Türkçe, Almanca, Fransızca,
 * Japonca — ASCII dışı ad kullanan herkesi vuruyordu.
 *
 * `LC_ALL=C` ortamı bu davranışı ETKİLEMEZ (quotepath ayrı bir git ayarıdır),
 * o yüzden env değil, komut düzeyinde `-c` ile kapatılır.
 */
function runGit(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<GitCmd> {
  return new Promise((done) => {
    execFile(
      bin,
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: process.env.HOME ?? '',
          LANG: 'C',
          LC_ALL: 'C',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, stdout, stderr) => {
        if (!err) {
          done({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '', enoent: false, timedOut: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
        done({
          ok: false,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          enoent: e.code === 'ENOENT',
          timedOut: e.killed === true && (e.signal === 'SIGTERM' || e.signal === 'SIGKILL'),
        });
      },
    );
  });
}

function emptyFacts(): GitFacts {
  return {
    gitAvailable: true,
    isGit: false,
    root: null,
    branch: null,
    headHash: null,
    headShort: null,
    headDate: null,
    headSubject: null,
    dirtyFiles: [],
    recentCommits: [],
    diffStat: null,
    notes: [],
  };
}

/**
 * cwd için git gerçeklerini topla. Asla fırlatmaz; git yoksa/repo değilse
 * boş + not döner. Tüm komutlar salt-okunur.
 */
export async function collectGit(cwd: string, opts: GitCollectOptions = {}): Promise<GitFacts> {
  const bin = opts.gitBin ?? 'git';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCommits = opts.maxCommits ?? 10;
  const facts = emptyFacts();

  const probe = await runGit(bin, ['rev-parse', '--is-inside-work-tree'], cwd, timeoutMs);
  if (probe.enoent) {
    facts.gitAvailable = false;
    facts.notes.push('git bulunamadı (PATH üzerinde yok) — git gerçekleri toplanamadı.');
    return facts;
  }
  if (probe.timedOut) {
    facts.notes.push('git zaman aşımına uğradı — git gerçekleri toplanamadı.');
    return facts;
  }
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    facts.notes.push('Bu dizin bir git çalışma ağacı değil — git kanıtı yok.');
    return facts;
  }
  facts.isGit = true;

  const root = await runGit(bin, ['rev-parse', '--show-toplevel'], cwd, timeoutMs);
  if (root.ok) facts.root = root.stdout.trim() || null;

  // Dal: symbolic-ref unborn branch'te de çalışır; detached HEAD'de rev-parse 'HEAD' döner.
  const sym = await runGit(bin, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd, timeoutMs);
  if (sym.ok && sym.stdout.trim()) {
    facts.branch = sym.stdout.trim();
  } else {
    const abb = await runGit(bin, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, timeoutMs);
    if (abb.ok && abb.stdout.trim()) facts.branch = abb.stdout.trim();
  }

  const head = await runGit(bin, ['log', '-1', '--format=%H%x09%h%x09%cI%x09%s'], cwd, timeoutMs);
  if (head.ok && head.stdout.trim()) {
    const parts = head.stdout.trim().split('\t');
    facts.headHash = parts[0] ?? null;
    facts.headShort = parts[1] ?? null;
    facts.headDate = parts[2] ?? null;
    facts.headSubject = parts.length > 3 ? parts.slice(3).join('\t') : null;
  } else {
    facts.notes.push('HEAD commit okunamadı — muhtemelen henüz commit yok.');
  }

  // --untracked-files=all: yeni dizindeki yeni dosyalar `?? dizin/` diye
  // TEK satıra indirgenmesin — truth katmanının dosya-düzeyi kesişimi
  // (transcript ∩ git) ancak dosya adları tek tek görününce çalışır.
  const st = await runGit(bin, ['status', '--porcelain', '--untracked-files=all'], cwd, timeoutMs);
  if (st.ok) {
    const lines = st.stdout.split('\n').filter((l) => l.length > 3);
    for (const l of lines.slice(0, MAX_DIRTY_FILES)) {
      const durum = l.slice(0, 2);
      const ham = l.slice(3);
      /**
       * YENİDEN ADLANDIRMA (2026-07-29 bulgusu): porcelain biçimi
       *     R  eski/yol.ts -> yeni/yol.ts
       * veriyor. Tek yol gibi ayrıştırılınca HİÇBİRİ eşleşmiyordu → transcript'te
       * düzenlenen dosya "git'te izi yok" sayılıyordu. HER İKİ yol da kanıt
       * kümesine girer: transcript eski adı da yeni adı da taşıyabilir.
       */
      const ok = ham.indexOf(' -> ');
      if (durum.includes('R') && ok !== -1) {
        const eski = tirnaksiz(ham.slice(0, ok));
        const yeni = tirnaksiz(ham.slice(ok + 4));
        if (eski !== '') facts.dirtyFiles.push({ status: durum, path: eski });
        if (yeni !== '') facts.dirtyFiles.push({ status: durum, path: yeni });
        continue;
      }
      facts.dirtyFiles.push({ status: durum, path: tirnaksiz(ham) });
    }
    if (lines.length > MAX_DIRTY_FILES) {
      facts.notes.push(`Kirli dosya listesi ${MAX_DIRTY_FILES} ile sınırlandı (toplam ${lines.length}).`);
    }
  } else {
    facts.notes.push('git status okunamadı.');
  }

  /**
   * `--name-only` ile her commit'in dokunduğu yollar da okunur. Bunlar kanıt
   * için ŞART: commit'lenip ağacı temizlenen bir dosya `diff HEAD`/`status`
   * kümelerinde görünmez; commit yolları olmadan "işini commit'lemek kanıtını
   * siler" davranışı çıkar (barın gerilemesinin kök sebebiydi).
   *
   * Commit'ler \x1e (record separator) ile ayrılır: konu satırında \n olamaz
   * ama \t olabilir, bu yüzden satır değil KAYIT sınırı kullanılır.
   */
  const log = await runGit(
    bin,
    ['log', '-n', String(maxCommits), '--name-only', '--format=%x1e%H%x09%h%x09%cI%x09%s'],
    cwd,
    timeoutMs,
  );
  if (log.ok) {
    let kirpilanCommit = 0;
    let bozukCommit = 0;
    for (const kayit of log.stdout.split('\x1e')) {
      if (!kayit.trim()) continue;
      const satirlar = kayit.split('\n');
      const parts = (satirlar[0] ?? '').split('\t');
      const full = parts[0];
      const hash = parts[1];
      const date = parts[2];
      /**
       * COMMIT ENJEKSİYONU KAPISI (2026-07-29): commit KONUSU içine sekme +
       * sahte alanlar yazan biri, kayıt listesine uydurma commit sokabiliyordu.
       * Biçim doğrulanır: tam SHA 40 hane hex OLMALI ve kısa hash onun ÖNEKİ.
       * Uymayan kayıt DÜŞER ve sayılır — sessiz kabul yok.
       */
      if (!full || !hash || !date) continue;
      if (!/^[0-9a-f]{40}$/.test(full) || !full.startsWith(hash)) {
        bozukCommit++;
        continue;
      }
      const files: string[] = [];
      let toplam = 0;
      for (const s of satirlar.slice(1)) {
        const yol = s.trim();
        if (!yol) continue;
        toplam++;
        if (files.length < MAX_COMMIT_FILES) files.push(yol);
      }
      if (toplam > MAX_COMMIT_FILES) kirpilanCommit++;
      facts.recentCommits.push({ hash, full, date, subject: parts.slice(3).join('\t'), files });
    }
    if (bozukCommit > 0) {
      facts.notes.push(
        `${bozukCommit} commit kaydı ayrıştırılamadı ve atlandı (hash biçimi beklenen 40-hane değil).`,
      );
    }
    if (kirpilanCommit > 0) {
      facts.notes.push(
        `${kirpilanCommit} commit'in dosya listesi ${MAX_COMMIT_FILES} ile sınırlandı — ` +
          'kırpılan yollar için commit kanıtı kurulamaz (kaçırmak, yanlış suçlamaktan iyidir).',
      );
    }
  } else if (facts.headHash !== null) {
    facts.notes.push('git log okunamadı.');
  }

  if (facts.headHash !== null) {
    const diff = await runGit(bin, ['diff', '--numstat', 'HEAD'], cwd, timeoutMs);
    if (diff.ok) {
      const files: GitDiffFileStat[] = [];
      let insertions = 0;
      let deletions = 0;
      let filesChanged = 0;
      for (const l of diff.stdout.split('\n')) {
        if (!l) continue;
        const parts = l.split('\t');
        if (parts.length < 3) continue;
        filesChanged++;
        const aRaw = parts[0] ?? '-';
        const rRaw = parts[1] ?? '-';
        const added = aRaw === '-' ? null : Number(aRaw);
        const removed = rRaw === '-' ? null : Number(rRaw);
        if (added !== null && Number.isFinite(added)) insertions += added;
        if (removed !== null && Number.isFinite(removed)) deletions += removed;
        if (files.length < MAX_NUMSTAT_FILES) files.push({ path: parts.slice(2).join('\t'), added, removed });
      }
      if (filesChanged > MAX_NUMSTAT_FILES) {
        facts.notes.push(`diff dosya listesi ${MAX_NUMSTAT_FILES} ile sınırlandı (toplam ${filesChanged}).`);
      }
      facts.diffStat = { filesChanged, insertions, deletions, files };
    } else {
      facts.notes.push('git diff okunamadı.');
    }
  } else {
    facts.notes.push('Commit olmadığı için diff hesaplanamadı.');
  }

  return facts;
}
