/**
 * Ocean CLI — ocean  (shebang release build'de banner ile eklenir)
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
import { panoPath } from './state.ts';

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`✖ ${msg}\n`);
  process.exit(1);
}

const HELP = `
Ocean v${TOOL_VERSION} — dürüst proje panosu (local-first, LLM'siz)

Kullanım: ocean <komut> [seçenekler]

Komutlar:
  init            Bu projeyi Ocean'a bağla (.ocean/ kurulumu + CLAUDE.md entegrasyonu)
  sync            Claude Code transcript + git gerçeklerinden log ve kartı güncelle
  verify <id>     Bir işi doğrula (insan onayı kaydet — kanıt seviyesi yükselir)
  open            Pano yolunu göster (tarayıcıyı otomatik AÇMAZ)

Seçenekler:
  --version       Sürümü yazdır
  --help          Bu yardımı göster

İlke: kanıtsız hiçbir iddia gösterilmez; "çalışıyor" yalnız test kanıtı
veya insan onayıyla söylenir. Özet deterministiktir (LLM yok).
`.trim();

// ── komutlar ─────────────────────────────────────────────────────────────────

async function cmdInit(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const res = await runInit(cwd);
  out(`Ocean bağlandı: ${res.projectName}`);
  for (const c of res.created) out(`  + ${c}`);
  for (const s of res.skipped) out(`  = ${s} (vardı, dokunulmadı)`);
  out('');
  out('Sıradaki adım: ocean sync  (transcript + git gerçeklerinden panoyu kur)');
}

const LEVEL_ORDER: EvidenceLevel[] = ['dosya-kaniti', 'test-kaniti', 'insan-onayi', 'dogrulanmadi'];

async function cmdSync(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const res = await runSync(cwd);
  if (!res.ok || res.state === undefined) fail(res.error ?? 'Senkron başarısız.');

  const st = res.state;
  const counts = new Map<EvidenceLevel, number>();
  for (const c of st.claims) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
  const levelSummary = LEVEL_ORDER.filter((l) => (counts.get(l) ?? 0) > 0)
    .map((l) => `${counts.get(l)} ${EVIDENCE_LEVEL_LABELS_TR[l].split(' — ')[0]?.toLocaleLowerCase('tr-TR')}`)
    .join(' · ');
  const verified = st.passport.filter((p) => p.status === 'completed' && p.level === 'insan-onayi').length;

  out(`Ocean senkron tamam — ${st.projectName}`);
  out(`  Transcript : ${res.transcriptsFound ?? 0} oturum tarandı`);
  out(`  Claim      : ${st.claims.length}${levelSummary !== '' ? ` (${levelSummary})` : ''}`);
  out(`  Log        : ${st.log.length} satır`);
  out(`  Pasaport   : ${verified}/${st.passport.length} doğrulandı`);
  if (st.card !== undefined) {
    out(`  Kart       : ${st.card.action.verb}${st.card.action.command !== undefined ? `  →  ${st.card.action.command}` : ''}`);
  }
  out(`  Pano       : ${res.panoPath ?? ''}`);
  if (res.notes.length > 0) {
    out('Notlar:');
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

async function cmdVerify(args: Args): Promise<void> {
  const id = args.positional[0];
  if (id === undefined || id === '') fail('Kullanım: ocean verify <id>');
  const cwd = process.cwd();
  const asker = makeAsker();
  try {
    const res = await runVerify(cwd, id, {
      ask: asker.ask,
      out,
      ...(typeof args.flags.by === 'string' ? { by: args.flags.by } : {}),
    });
    if (!res.ok) fail(res.error ?? 'Doğrulama başarısız.');
    if (res.panoPath !== undefined) out(`Pano güncellendi: ${res.panoPath}`);
  } finally {
    asker.close();
  }
}

async function cmdOpen(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const p = panoPath(cwd);
  try {
    await access(p);
  } catch {
    fail(`Pano henüz yok: ${p}\nÖnce: ocean sync`);
  }
  out('Pano yolu (tarayıcında aç — Ocean otomatik açmaz):');
  out(`  ${p}`);
}

// ── yönlendirici ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version === true || args.cmd === 'version') {
    out(`ocean v${TOOL_VERSION}`);
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
    default:
      fail(`Bilinmeyen komut: ${args.cmd}\n\n${HELP}`);
  }
}

await main();
