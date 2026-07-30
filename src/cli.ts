/**
 * Topbeam CLI — topbeam  (shebang release build'de banner ile eklenir)
 * Akış (MVP dikey dilim): init → sync → verify → open
 *
 * İnce yönlendirici: komut mantığı ayrı modüllerde (init/sync/verify),
 * burada yalnız arg yönlendirme + Türkçe stdout. LLM yok, network yok.
 */
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs, type Args } from './args.ts';
import { TOOL_VERSION, EVIDENCE_LEVEL_LABELS_TR, type EvidenceLevel } from './types.ts';
import { runInit } from './init.ts';
import { runSync } from './sync.ts';
import { runVerify } from './verify.ts';
import { runMakbuz } from './makbuz.ts';
import { runUninstall } from './uninstall.ts';
import { gozlemEkle } from './gozlem.ts';
import { userInfo } from 'node:os';
import { GuvenliYazmaHatasi, panoPath } from './state.ts';

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`✖ ${msg}\n`);
  process.exit(1);
}

const HELP = `
Topbeam v${TOOL_VERSION} — an honest project board (local-first, no LLM)

Usage: topbeam <command> [options]

Commands:
  init            Connect this project to Topbeam (.ocean/ setup + a .gitignore line)
                  ASKS FIRST before adding a section to CLAUDE.md — in automation
                  it does not ask and does not add (say --claude-md to mean yes)
  sync            Rebuild the log and the card from Claude Code transcripts + git facts
  verify <id>     Verify a piece of work (record human approval — the evidence level rises)
                  <id> can be a single record or a delivery promise (soz-…); give a
                  promise and every record matching it passes with one approval
                  TERMINAL ONLY: if the answer arrives from a pipe or a script,
                  nothing is recorded (human approval means a real human)
  open            Print the board's path (does NOT open a browser)
  gozlem "<text>"   Put your own observation on the record — for the work a
                  machine cannot see ("I used it, here is what I saw"). NOT
                  EVIDENCE: its level stays "not verified" and the board shows it
                  APART from measurement, badged "human statement". verify can approve it.
  uninstall       Undo the marks Topbeam left in your files
                  (the CLAUDE.md section + the .gitignore line). .ocean/ STAYS, ON PURPOSE:
                  the signed approval ledger inside it cannot be reproduced.
                  --purge deletes .ocean/ too (what you lose is spelled out)
  makbuz          Write a one-page delivery receipt you can show to someone else
                  (.ocean/makbuz.md · --html also writes .ocean/makbuz.html)
                  Commit SHAs + the test command + the ledger file are written out
                  in copyable form, so a third party can re-check them on their own
                  machine. An unapproved item never looks APPROVED.

Options:
  --claude-md     init: add the "## Topbeam" section to CLAUDE.md WITHOUT asking
  --no-claude-md  init: leave CLAUDE.md alone
  --purge         uninstall: delete the .ocean/ directory too (approval ledger included — NO WAY BACK)
  --html          makbuz: also write a single-file HTML (no outbound requests)
  --no-ci         sync: turn the optional CI read off completely (same as
                  TOPBEAM_NO_CI=1) — Topbeam stays local, not one outbound call
  --version       Print the version
  --help          Show this help

Principle: no claim is shown without evidence; "it works" is said only with test
evidence or human approval. The summary is deterministic (no LLM).
`.trim();

// ── komutlar ─────────────────────────────────────────────────────────────────

async function cmdInit(args: Args): Promise<void> {
  const cwd = process.cwd();
  /**
   * CLAUDE.md kararı KULLANICININ (2026-07-29). Terminalde sorulur ve eklenecek
   * metin önce EKRANA basılır — kör onay istemiyoruz. Otomasyonda (pipe/CI)
   * soru sorulamaz, o yüzden bölüm EKLENMEZ; `--claude-md` ile açıkça istenir.
   */
  const claudeMdBayrak =
    args.flags['claude-md'] === true ? true : args.flags['no-claude-md'] === true ? false : undefined;
  const interactive = process.stdin.isTTY === true;
  const asker = interactive && claudeMdBayrak === undefined ? makeAsker() : null;
  const res = await runInit(cwd, {
    ...(claudeMdBayrak !== undefined ? { claudeMd: claudeMdBayrak } : {}),
    ...(asker !== null ? { sor: asker.ask, yaz: out } : {}),
  }).finally(() => asker?.close());
  out(`Topbeam connected: ${res.projectName}`);
  for (const c of res.created) out(`  + ${c}`);
  /**
   * Her atlanan girdi kendi gerekçesini TAŞIR — CLI genel bir son ek EKLEMEZ.
   *
   * Neden (2026-07-30, lansman postu yazılırken bulundu): son ek her satıra
   * '(already there, left alone)' yapıştırıyordu. CLAUDE.md hiç YOKKEN bile
   * 'already there' diyordu — yani dosyanın varlığı hakkında YALAN. Üstelik
   * mesaj iki kez okunuyordu. Yalan söylememeyi vaat eden bir üründe bu küçük
   * değil: okurun ilk 10 saniyede gördüğü şey.
   */
  for (const s of res.skipped) out(`  = ${s}`);
  out('');
  out('Next step: topbeam sync  (build the board from transcript + git facts)');
}

const LEVEL_ORDER: EvidenceLevel[] = ['dosya-kaniti', 'test-kaniti', 'insan-onayi', 'dogrulanmadi'];

async function cmdSync(args: Args): Promise<void> {
  const cwd = process.cwd();
  // --no-ci: opsiyonel CI kaynağı hiç sorulmaz (TOPBEAM_NO_CI=1 de aynı işi görür).
  const res = await runSync(cwd, { noCi: args.flags['no-ci'] === true });
  if (!res.ok || res.state === undefined) fail(res.error ?? 'Sync failed.');

  const st = res.state;
  const counts = new Map<EvidenceLevel, number>();
  for (const c of st.claims) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
  /**
   * "insan onayı" sayısı DEFTERDEN gelir (passport.jsonl), claim'in kendi
   * seviyesinden değil. Dayanağı olmayanlar sayıya girmez; yok da sayılmaz —
   * ayrı "kanal kaydı yok" kalemi olarak yazılır (sessiz silme yok).
   */
  const kaynaksiz = res.kaynaksizClaim ?? 0;
  counts.set('insan-onayi', res.onayliClaim ?? 0);
  const levelSummary = [
    ...LEVEL_ORDER.filter((l) => (counts.get(l) ?? 0) > 0).map(
      // NOT: etiketler artık İngilizce → küçültme de 'en-US' ile (tr-TR 'I'→'ı' yapardı).
      (l) => `${counts.get(l)} ${EVIDENCE_LEVEL_LABELS_TR[l].split(' — ')[0]?.toLocaleLowerCase('en-US')}`,
    ),
    ...(kaynaksiz > 0 ? [`${kaynaksiz} with no ledger entry`] : []),
  ].join(' · ');
  // Rapor da panoyla AYNI kapıdan geçer: onay sayısı passport.jsonl defterine
  // dayanır, maddenin kendi 'completed' iddiasına değil.
  const sozOnayli = res.sozOnayli ?? 0;
  const sozToplam = res.sozToplam ?? 0;

  out(`Topbeam sync done — ${st.projectName}`);
  out(`  Transcript : ${res.transcriptsFound ?? 0} sessions scanned`);
  out(`  Claims     : ${st.claims.length}${levelSummary !== '' ? ` (${levelSummary})` : ''}`);
  out(`  Log        : ${st.log.length} lines`);
  out(
    sozToplam > 0
      ? `  Promises   : ${sozOnayli} / ${sozToplam} approved`
      : "  Promises   : none — write yours in .ocean/goal.md; that is where the bar fills",
  );
  // Defter ARŞİVDİR: sayılır ama ilerleme diye sunulmaz (payda büyüsün diye değil).
  out(`  Ledger     : ${res.defterKaydi ?? 0} session entries (not a measure of progress)`);
  if (st.card !== undefined) {
    out(`  Card       : ${st.card.action.verb}${st.card.action.command !== undefined ? `  →  ${st.card.action.command}` : ''}`);
  }
  out(`  Board      : ${res.panoPath ?? ''}`);
  if (res.notes.length > 0) {
    out('Notes:');
    for (const n of res.notes) out(`  - ${n}`);
  }
}

/**
 * stdin'den cevap okuma — pipe dostu. Piped girdide satır, soru sorulmadan
 * ÖNCE gelebilir ve readline erken kapanabilir; satırlar tamponlanır,
 * kapanmış girdi = boş cevap (varsayılan Hayır — dürüst taraf).
 */
function makeAsker(): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin });
  const buffered: string[] = [];
  let waiter: ((s: string) => void) | null = null;
  let closed = false;
  rl.on('line', (l) => {
    if (waiter !== null) {
      const w = waiter;
      waiter = null;
      w(l);
    } else buffered.push(l);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter !== null) {
      const w = waiter;
      waiter = null;
      w('');
    }
  });
  return {
    ask: (q) => {
      process.stdout.write(q);
      const b = buffered.shift();
      if (b !== undefined) return Promise.resolve(b);
      if (closed) return Promise.resolve('');
      return new Promise((res) => {
        waiter = res;
      });
    },
    close: () => rl.close(),
  };
}

/**
 * verify — İNSAN KAPISI burada kurulur:
 * - interactive: cevap kanalı (stdin) gerçek bir terminal mi. Pipe/dosya/CI ise
 *   false → runVerify onay istemez, hiçbir şey yazmaz.
 * - `by` GEÇİRİLMEZ: onaylayan kimliği işletim sisteminden okunur. Eski `--by`
 *   bayrağı imza uydurmaya (`by:"dogfood-ajan"`) izin veriyordu, kaldırıldı.
 */
async function cmdVerify(args: Args): Promise<void> {
  const id = args.positional[0];
  if (id === undefined || id === '') fail('Usage: topbeam verify <id>');
  if (args.flags.by !== undefined) {
    fail(
      "The '--by' flag was removed: the approver's identity is read from the operating-system user.\n" +
        "No approval is written in someone else's name — in this product, human approval means a real person.",
    );
  }
  const cwd = process.cwd();
  const asker = makeAsker();
  try {
    const res = await runVerify(cwd, id, {
      ask: asker.ask,
      out,
      interactive: process.stdin.isTTY === true,
    });
    if (!res.ok) fail(res.error ?? 'Verification failed.');
    if (res.panoPath !== undefined) out(`Board updated: ${res.panoPath}`);
  } finally {
    asker.close();
  }
}

/**
 * makbuz — DIŞARIYA gösterilebilir tek sayfa. Pano içeri bakar, makbuz dışarı:
 * müşteriye/ekibe yapıştırılır. Dosyayı yazar, yolu söyler, AÇMAZ (ağa da
 * çıkmaz — hiçbir şey gönderilmez, yayınlanmaz).
 */
async function cmdMakbuz(args: Args): Promise<void> {
  const cwd = process.cwd();
  const res = await runMakbuz(cwd, { html: args.flags.html === true });
  if (!res.ok) fail(res.error ?? 'The receipt could not be written.');
  out('Receipt written (yours to show — Topbeam does not open it and does not send it):');
  out(`  ${res.mdPath ?? ''}`);
  if (res.htmlPath !== undefined) out(`  ${res.htmlPath}`);
  const toplam = res.sozToplam ?? 0;
  out(
    toplam > 0
      ? `  Promises: ${res.sozOnayli ?? 0} / ${toplam} human-approved`
      : "  Promises: none — write yours in .ocean/goal.md (the receipt was written anyway, as a listing of evidence)",
  );
  out('The receipt states its own limits; an unapproved item does not look approved.');
}

async function cmdOpen(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const p = panoPath(cwd);
  try {
    await access(p);
  } catch {
    fail(`The board does not exist yet: ${p}\nRun this first: topbeam sync`);
  }
  out('Board path (open it in your browser — Topbeam will not open it for you):');
  out(`  ${p}`);
}

// ── yönlendirici ─────────────────────────────────────────────────────────────

async function cmdGozlem(args: Args): Promise<void> {
  const metin = args.positional.join(' ').trim();
  if (metin === '') {
    fail('Usage: topbeam gozlem "I used it, here is what I saw"\n' +
      'This is NOT EVIDENCE — it puts on the record the work a machine cannot see.');
  }
  const kullanici = (() => {
    try {
      return userInfo().username;
    } catch {
      return '';
    }
  })();
  if (kullanici.trim() === '') {
    fail('Identity could not be read (operating-system username) — an unsigned observation is not written.');
  }
  const res = await gozlemEkle(process.cwd(), metin, { by: kullanici });
  if (!res.ok) fail(res.error ?? 'The observation could not be written.');
  out(`Observation recorded: ${res.id}  (signed: ${kullanici})`);
  out('  This is NOT EVIDENCE — it is your statement. The board shows it badged "human statement".');
  out('  Next step: topbeam sync   (then, if you want: topbeam verify <promise-id>)');
}

async function cmdUninstall(args: Args): Promise<void> {
  const cwd = process.cwd();
  const res = await runUninstall(cwd, { purge: args.flags.purge === true });
  out("Topbeam's marks have been undone.");
  for (const t of res.temizlenen) out(`  − ${t}`);
  for (const d of res.dokunulmayan) out(`  = ${d}`);
  if (res.uyarilar.length > 0) {
    out('');
    for (const u of res.uyarilar) out(`  ⚠ ${u}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version === true || args.cmd === 'version') {
    out(`topbeam v${TOOL_VERSION}`);
    return;
  }
  if (args.flags.help === true || args.cmd === 'help') {
    out(HELP);
    return;
  }

  switch (args.cmd) {
    case 'init':
      await cmdInit(args);
      break;
    case 'sync':
      await cmdSync(args);
      break;
    case 'verify':
      await cmdVerify(args);
      break;
    case 'open':
      await cmdOpen(args);
      break;
    case 'makbuz':
      await cmdMakbuz(args);
      break;
    case 'gozlem':
      await cmdGozlem(args);
      break;
    case 'uninstall':
      await cmdUninstall(args);
      break;
    default:
      fail(`Unknown command: ${args.cmd}\n\n${HELP}`);
  }
}

/**
 * Üst düzey hata kapısı. Ham Node stack trace kullanıcıya GÖSTERİLMEZ —
 * ürünün dili sakin ve açıklayıcıdır. Özellikle güvenlik reddi (symlink
 * koruması) bir çökme değil, KASITLI bir karardır ve öyle anlatılır.
 */
await main().catch((e: unknown) => {
  if (e instanceof GuvenliYazmaHatasi) {
    process.stderr.write(`✖ ${e.message}\n`);
    process.exit(2); // 2 = güvenlik reddi (1 = normal hata) — betikler ayırt edebilsin
  }
  const mesaj = e instanceof Error ? e.message : String(e);
  process.stderr.write(`✖ Unexpected error: ${mesaj}\n`);
  // Ayrıntı isteyen için: TOPBEAM_DEBUG=1 ile tam iz.
  if (process.env.TOPBEAM_DEBUG === '1' && e instanceof Error && e.stack !== undefined) {
    process.stderr.write(`${e.stack}\n`);
  } else {
    process.stderr.write('  (for the full trace: TOPBEAM_DEBUG=1 topbeam <command>)\n');
  }
  process.exit(1);
});
