/**
 * CI gerçekleri toplayıcısı — OPSİYONEL, KAPATILABİLİR dış kaynak.
 *
 * NEDEN VAR: Topbeam'in bildiği her şey lokaldir (transcript + git). Kullanıcının
 * BİLMEDİĞİ ve terminalde 5 saniyede öğrenemeyeceği tek gerçek şudur:
 * "bu commit CI'da yeşil mi?". Bu dosya yalnız o tek gerçeği okur.
 *
 * SINIRLAR (ürün anayasası — ihlal = red):
 * - SALT-OKUNUR: tek komut, `gh run list --json …`. Hiçbir şey yazmaz,
 *   tetiklemez, push etmez.
 * - KURULUM İSTEMEZ: `gh` yoksa ya da giriş yapılmamışsa zarif boş döner.
 *   Yeni hesap/token/kurulum ASLA istenmez (basitlik kapısı). Ama SESSİZ de
 *   kalmaz: neden okunamadığı kapsam notuna tek satır düşer — bu üründe
 *   kapsam daralmasının izsiz kalması yalandır. ("Sessizce atla" = kullanıcıyı
 *   kuruluma zorlama demek; gerçeği gizle demek değil.)
 * - UYDURMA EŞLEŞME YOK: bir koşum ancak head_sha'sı bu deponun BİLİNEN bir
 *   commit SHA'sıyla BİREBİR (40 hane, tam string) eşleşirse hesaba katılır.
 *   Eşleşmeyen koşum atılır ve kaç tane atıldığı yazılır.
 * - SEVİYE YÜKSELTMESİ EŞLEŞMEYE BAĞLI: SHA eşleşmezse hiçbir claim üretilmez;
 *   "muhtemelen bu koşum bizimdir" diye bir yol yok.
 * - KAPATILABİLİR: `--no-ci` ya da TOPBEAM_NO_CI=1 → tek bir dış çağrı bile
 *   yapılmaz. Local-first vaadi bayrakla korunur.
 * - LLM YOK: çıktı JSON olarak ayrıştırılır, metin yorumlanmaz.
 */
import { execFile } from 'node:child_process';
import type { Claim, ClaimEvidence } from '../types.ts';
import type { GitFacts } from './git.ts';

const DEFAULT_TIMEOUT_MS = 20_000;
/** gh'den istenecek koşum sayısı — eşleşme bunun içinde aranır (sınır yazılır). */
const DEFAULT_MAX_RUNS = 30;
const MAX_BUFFER = 4 * 1024 * 1024;
/** Not metnine giren ham gh hatasının üst sınırı (kart/pano tek satır kalsın). */
const MAX_HATA_UZUNLUK = 160;
/** Tam commit SHA'sı — kısaltma/prefix eşleşmesi bilinçli olarak YASAK. */
const SHA_RE = /^[0-9a-f]{40}$/;

/** Claim metninde kullanılacak kısa SHA — tam SHA'nın ilk 7 hanesi. */
function sha7(sha: string): string {
  return sha.slice(0, 7);
}

// ── dış tipler ───────────────────────────────────────────────────────────────

/** gh'den okunan tek CI koşumu (alanlar birebir GitHub'dan; türetme yok). */
export interface CiRun {
  /** Koşumun çalıştığı commit — 40 hane, küçük harf. */
  headSha: string;
  workflowName: string;
  /** 'success' | 'failure' | 'cancelled' | … | null (henüz sonuçlanmadı). */
  conclusion: string | null;
  /** 'completed' | 'in_progress' | … | null. */
  status: string | null;
  createdAt: string; // ISO-8601
}

/** Bilinen bir commit ile BİREBİR eşleşen koşumlar. */
export interface CiMatch {
  /** Eşleşen commit'in tam SHA'sı. */
  sha: string;
  /** HEAD'den kaç commit geride (0 = HEAD'in kendisi) — git log sırasından ölçülür. */
  behind: number;
  /** Bu commit için workflow başına SON koşum (en yeni önce). */
  runs: CiRun[];
}

export interface CiFacts {
  /** CI okuması kapatıldı mı (--no-ci / TOPBEAM_NO_CI). */
  kapali: boolean;
  /** gh çalıştırılabildi ve koşum listesi okunabildi mi. */
  okundu: boolean;
  /** Bilinen SHA'larla birebir eşleşen koşumlar — HEAD'e en yakın commit önce. */
  eslesme: CiMatch[];
  /** Bilinen bir SHA'ya bağlanamadığı için ATILAN koşum sayısı. */
  eslesmeyen: number;
  /** Dürüst durum notları (kapsam notuna aynen düşer). */
  notes: string[];
}

export interface CiCmd {
  ok: boolean;
  stdout: string;
  stderr: string;
  enoent: boolean;
  timedOut: boolean;
}

export interface CiCollectOptions {
  /** Test için: 'gh' yerine başka binary (yokluk senaryosu). */
  ghBin?: string;
  timeoutMs?: number;
  maxRuns?: number;
  /** `--no-ci` bayrağı. */
  noCi?: boolean;
  /** Ortam (test determinizmi) — TOPBEAM_NO_CI buradan okunur. */
  env?: Record<string, string | undefined>;
  /**
   * Test enjeksiyonu: gh çağrısının yerine geçen çalıştırıcı.
   * Testler bunu kullanır — gerçek ağa ASLA çıkılmaz.
   */
  run?: (args: string[], cwd: string) => Promise<CiCmd>;
}

// ── çalıştırma ───────────────────────────────────────────────────────────────

/**
 * gh'yi salt-okunur, etkileşimsiz koştur. Kısıtlı env; ama kullanıcının
 * MEVCUT kimlik değişkenleri (GH_TOKEN/GITHUB_TOKEN/GH_HOST/config dizinleri)
 * aynen geçer — yoksa gh'ye "giriş yok" dedirtip yanlış not yazardık.
 * Yeni bir sır İSTENMEZ, var olan da okunmaz/yazılmaz; yalnız aktarılır.
 */
function runGh(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<CiCmd> {
  const gecen: Record<string, string> = {};
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME']) {
    const v = process.env[k];
    if (v !== undefined && v !== '') gecen[k] = v;
  }
  return new Promise((done) => {
    execFile(
      bin,
      args,
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
          // Etkileşim yok: soru soran bir CLI, senkronu kilitler.
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          GH_PAGER: 'cat',
          NO_COLOR: '1',
          GIT_TERMINAL_PROMPT: '0',
          ...gecen,
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

// ── yardımcılar ──────────────────────────────────────────────────────────────

function emptyCi(): CiFacts {
  return { kapali: false, okundu: false, eslesme: [], eslesmeyen: 0, notes: [] };
}

/**
 * TOPBEAM_NO_CI okuması. Var olması yeter; '0' ve boş değer kapatmaz
 * (kullanıcı açıkça kapatmak istediğinde yazdığı her şey kapatır).
 */
export function ciKapaliMi(env: Record<string, string | undefined>): boolean {
  const v = env.TOPBEAM_NO_CI;
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Bu deponun BİLİNEN commit SHA'ları: git log sırası (HEAD önce).
 * behind = listedeki sıra = HEAD'den kaç commit geride. Kısa hash KULLANILMAZ —
 * eşleşme tam string üzerindendir.
 */
function bilinenShalar(git: GitFacts): Map<string, number> {
  const m = new Map<string, number>();
  git.recentCommits.forEach((c, i) => {
    const full = c.full.toLowerCase();
    if (SHA_RE.test(full) && !m.has(full)) m.set(full, i);
  });
  const head = git.headHash?.toLowerCase();
  if (head !== undefined && SHA_RE.test(head) && !m.has(head)) m.set(head, 0);
  return m;
}

/** gh stderr'inden tek satırlık, sakin İngilizce sebep. Bilinmeyen hata AYNEN geçer (kısaltılmış). */
export function ghHataSebebi(stderr: string): string {
  const ham = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')[0];
  if (ham === undefined) return 'the gh command failed (no detail given).';
  if (/no git remotes|failed to determine base repo|not a git repository/i.test(ham)) {
    return 'this repository is not connected to a GitHub remote.';
  }
  if (/gh auth login|not logged|authentication|unauthorized|http 401|bad credentials/i.test(ham)) {
    return 'no GitHub session (gh is not logged in) — Topbeam does not ask you to log in, CI is optional.';
  }
  if (/http 404|could not resolve to a repository|not found/i.test(ham)) {
    return 'the GitHub repository was not found, or this account has no access to it.';
  }
  if (/dial tcp|no such host|network is unreachable|i\/o timeout|connection refused|tls|proxy/i.test(ham)) {
    return 'the network could not be reached.';
  }
  return ham.length > MAX_HATA_UZUNLUK ? `${ham.slice(0, MAX_HATA_UZUNLUK)}…` : ham;
}

/** gh JSON çıktısını CiRun'lara çevir — şekli bozuk kayıt sessizce ATILIR, sayılır. */
export function parseCiRuns(stdout: string): { runs: CiRun[]; bozuk: number; ok: boolean } {
  let veri: unknown;
  try {
    veri = JSON.parse(stdout);
  } catch {
    return { runs: [], bozuk: 0, ok: false };
  }
  if (!Array.isArray(veri)) return { runs: [], bozuk: 0, ok: false };
  const runs: CiRun[] = [];
  let bozuk = 0;
  for (const item of veri) {
    if (typeof item !== 'object' || item === null) {
      bozuk++;
      continue;
    }
    const o = item as Record<string, unknown>;
    const headSha = typeof o.headSha === 'string' ? o.headSha.toLowerCase() : '';
    const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
    if (!SHA_RE.test(headSha) || createdAt === '') {
      bozuk++;
      continue;
    }
    runs.push({
      headSha,
      workflowName: typeof o.workflowName === 'string' && o.workflowName !== '' ? o.workflowName : 'workflow',
      conclusion: typeof o.conclusion === 'string' && o.conclusion !== '' ? o.conclusion : null,
      status: typeof o.status === 'string' && o.status !== '' ? o.status : null,
      createdAt,
    });
  }
  return { runs, bozuk, ok: true };
}

/** Workflow başına SON koşum (createdAt desc, eşitlikte ad) — deterministik. */
function workflowBasinaSon(runs: readonly CiRun[]): CiRun[] {
  const sirali = [...runs].sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.workflowName.localeCompare(b.workflowName),
  );
  const gorulen = new Map<string, CiRun>();
  for (const r of sirali) if (!gorulen.has(r.workflowName)) gorulen.set(r.workflowName, r);
  return [...gorulen.values()];
}

// ── toplayıcı ────────────────────────────────────────────────────────────────

/**
 * CI gerçeklerini topla. ASLA fırlatmaz: gh yok / giriş yok / ağ yok / repo yok →
 * zarif boş + tek satır dürüst not.
 */
export async function collectCi(
  cwd: string,
  git: GitFacts,
  opts: CiCollectOptions = {},
): Promise<CiFacts> {
  const facts = emptyCi();
  const env = opts.env ?? process.env;

  if (opts.noCi === true || ciKapaliMi(env)) {
    facts.kapali = true;
    facts.notes.push(
      'CI was not read: CI reading is switched off (--no-ci / TOPBEAM_NO_CI) — this board speaks only about local facts.',
    );
    return facts;
  }

  const bilinen = bilinenShalar(git);
  if (bilinen.size === 0) {
    // Eşleştirilecek commit yoksa dış çağrı da yapılmaz (boşuna ağ trafiği yok).
    facts.notes.push(
      git.isGit
        ? 'CI could not be read: this repository has no commits — there is no SHA for a CI run to attach to.'
        : 'CI could not be read: this directory is not a git repository — a CI run cannot be tied to a commit.',
    );
    return facts;
  }

  const bin = opts.ghBin ?? 'gh';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRuns = opts.maxRuns ?? DEFAULT_MAX_RUNS;
  const runner = opts.run ?? ((args: string[], dir: string) => runGh(bin, args, dir, timeoutMs));

  const res = await runner(
    [
      'run',
      'list',
      '--limit',
      String(maxRuns),
      '--json',
      'headSha,conclusion,status,workflowName,createdAt',
    ],
    cwd,
  );

  if (res.enoent) {
    facts.notes.push(
      'CI could not be read: the `gh` command is not installed — CI is an optional source, and Topbeam does not ask you to install anything.',
    );
    return facts;
  }
  if (res.timedOut) {
    facts.notes.push('CI could not be read: gh timed out.');
    return facts;
  }
  if (!res.ok) {
    facts.notes.push(`CI could not be read: ${ghHataSebebi(res.stderr)}`);
    return facts;
  }

  const { runs, bozuk, ok } = parseCiRuns(res.stdout);
  if (!ok) {
    facts.notes.push('CI could not be read: the gh output was not in the expected JSON shape.');
    return facts;
  }
  facts.okundu = true;
  if (bozuk > 0) {
    facts.notes.push(
      `${bozuk} CI run record${bozuk === 1 ? '' : 's'} had missing or malformed fields and ${bozuk === 1 ? 'was' : 'were'} dropped.`,
    );
  }

  // BİREBİR EŞLEŞME: bilinen SHA listesinde olmayan koşum kapsam dışıdır.
  const kovalar = new Map<string, CiRun[]>();
  for (const r of runs) {
    if (!bilinen.has(r.headSha)) {
      facts.eslesmeyen++;
      continue;
    }
    const liste = kovalar.get(r.headSha);
    if (liste === undefined) kovalar.set(r.headSha, [r]);
    else liste.push(r);
  }
  if (facts.eslesmeyen > 0) {
    facts.notes.push(
      `${facts.eslesmeyen} CI run${facts.eslesmeyen === 1 ? '' : 's'} could not be tied to a known commit of this project and ${facts.eslesmeyen === 1 ? 'was' : 'were'} left out of scope (no guessed matches).`,
    );
  }

  facts.eslesme = [...kovalar.entries()]
    .map(([sha, liste]) => ({ sha, behind: bilinen.get(sha) ?? 0, runs: workflowBasinaSon(liste) }))
    .sort((a, b) => a.behind - b.behind);

  if (facts.eslesme.length === 0) {
    facts.notes.push(
      `None of this project’s ${bilinen.size} known commits appeared in the last ${maxRuns} CI runs — ` +
        'the commits may not be pushed yet, or the runs may fall outside this window.',
    );
    return facts;
  }

  // En yakın eşleşmede sonuçlanmamış / başka sonuçlu koşumlar sessiz kalmaz.
  const yakin = facts.eslesme[0];
  if (yakin !== undefined) {
    const diger = yakin.runs.filter((r) => r.conclusion !== 'success' && r.conclusion !== 'failure');
    if (diger.length > 0) {
      const suren = diger.filter((r) => r.conclusion === null).length;
      facts.notes.push(
        `At commit ${sha7(yakin.sha)}, ${diger.length} CI run${diger.length === 1 ? ' is' : 's are'} neither green nor red ` +
          `(${suren > 0 ? `${suren} ${suren === 1 ? 'has' : 'have'} not finished yet; ` : ''}cancelled or skipped results do not count as green) — no result is invented.`,
      );
    }
  }

  return facts;
}

// ── claim üretimi ────────────────────────────────────────────────────────────

/** Koşumun HEAD'e göre yeri — ölçülmüş, tahmin değil. */
function nerede(m: CiMatch): string {
  if (m.behind === 0) return ' — the HEAD commit';
  return ` — ${m.behind} commit${m.behind === 1 ? '' : 's'} behind HEAD`;
}

/** Çalışma ağacı kirliyse CI'ın diskteki hâli görmediği AÇIKÇA yazılır. */
function kirliKuyruk(git: GitFacts): string {
  const n = git.dirtyFiles.length;
  return n > 0 ? ` · the working tree has ${n} changed file${n === 1 ? '' : 's'} that CI did not see` : '';
}

function adlar(runs: readonly CiRun[]): string {
  return runs.map((r) => r.workflowName).join(', ');
}

/** Koşum listesindeki en yeni zaman damgası — claim'in kendi tarihi (uydurma yok). */
function enYeniTs(runs: readonly CiRun[]): string {
  return runs.reduce((acc, r) => (r.createdAt > acc ? r.createdAt : acc), runs[0]?.createdAt ?? '');
}

/**
 * CI gerçeklerinden claim üret.
 *
 * KURALLAR:
 * - Yalnız HEAD'e EN YAKIN eşleşen commit anlatılır: pano CI'ın ŞU ANKİ
 *   durumunu gösterir, GitHub'ın koşum arşivini değil.
 * - 'success' → test-kanıtı seviyesinde YEŞİL claim.
 * - 'failure' → test-kanıtı seviyesinde KIRIK claim (signals.ciFailed) →
 *   kart 'kirik-test' kuralıyla bunu manşete alır.
 * - Başka sonuçlar (iptal/atlanan/süren) claim ÜRETMEZ; kapsam notunda durur.
 * - Kanıta KOMUT REF'İ YAZILMAZ (bilinçli): kart, komut ref'i olan kayıtları
 *   birbiriyle eşleştirip "aynı komut sonradan yeşil geçti" diye manşetten
 *   düşürüyor. Lokalde `npm test` yeşil geçmesi CI'ı yeşil YAPMAZ — ref
 *   yazsaydık lokal yeşil, CI kırmızısını sessizce örterdi.
 */
export function buildCiClaims(ci: CiFacts, git: GitFacts): Claim[] {
  if (ci.kapali || !ci.okundu) return [];
  const m = ci.eslesme[0];
  if (m === undefined || m.runs.length === 0) return [];

  const kirik = m.runs.filter((r) => r.conclusion === 'failure');
  const yesil = m.runs.filter((r) => r.conclusion === 'success');
  const kisa = sha7(m.sha);
  const kuyruk = `${nerede(m)}${kirliKuyruk(git)}`;

  if (kirik.length > 0) {
    const yesilKuyruk = yesil.length > 0 ? ` (${yesil.length} workflow${yesil.length === 1 ? '' : 's'} green)` : '';
    const evidence: ClaimEvidence[] = kirik.map((r) => ({
      kind: 'test-output',
      summary: `GitHub Actions: at commit ${kisa} the “${r.workflowName}” workflow ended with 'failure' (${r.createdAt}).`,
    }));
    return [
      {
        id: `ci-kirik-${kisa}`,
        text: `CI red: the ${adlar(kirik)} workflow${kirik.length === 1 ? '' : 's'} failed at commit ${kisa}${yesilKuyruk}${kuyruk}.`,
        level: 'test-kaniti',
        kind: 'test',
        signals: { ciFailed: true },
        evidence,
        createdAt: enYeniTs(kirik),
      },
    ];
  }

  if (yesil.length > 0) {
    const evidence: ClaimEvidence[] = yesil.map((r) => ({
      kind: 'test-output',
      summary: `GitHub Actions: at commit ${kisa} the “${r.workflowName}” workflow ended with 'success' (${r.createdAt}).`,
    }));
    return [
      {
        id: `ci-yesil-${kisa}`,
        text: `CI green: ${yesil.length} workflow${yesil.length === 1 ? '' : 's'} passed at commit ${kisa} (${adlar(yesil)})${kuyruk}.`,
        level: 'test-kaniti',
        kind: 'test',
        // Sayı sinyali YOK: CI yeşili "kaç test geçti" demez ve lokalde kayıtlı
        // kırık bir koşumu temizlemez (farklı ölçüm, farklı ağaç).
        evidence,
        createdAt: enYeniTs(yesil),
      },
    ];
  }

  return [];
}
