/**
 * Ocean CLI — ocean  (shebang release build'de banner ile eklenir)
 * Akış (MVP dikey dilim): init → sync → verify → open
 *
 * Bu iskelet: arg parsing GERÇEK, komut gövdeleri stub ("henüz yok").
 * Kural: LLM çağrısı yok, network çağrısı yok — local-first.
 */
import { parseArgs, type Args } from './args.ts';
import { TOOL_VERSION } from './types.ts';

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
  verify <id>     Bir işi doğrula (test koş / insan onayı kaydet)
  open            Panoyu aç (pano.html yolunu gösterir)

Seçenekler:
  --version       Sürümü yazdır
  --help          Bu yardımı göster
`.trim();

// ── stub komutlar (iskelet — sıradaki ajan dolduracak) ──────────────────────

function cmdInit(_args: Args): void {
  out('ocean init: henüz yok.');
  out('Gelecek: .ocean/state.json kurulumu + CLAUDE.md entegrasyonu (kullanıcı elle iş yapmaz).');
}

function cmdSync(_args: Args): void {
  out('ocean sync: henüz yok.');
  out('Gelecek: ~/.claude/projects transcript taraması + git gerçekleri → deterministik log + sıradaki-tek-hareket kartı.');
}

function cmdVerify(args: Args): void {
  const id = args.positional[0];
  if (!id) fail('Kullanım: ocean verify <id>');
  out(`ocean verify ${id}: henüz yok.`);
  out('Gelecek: doğrulama koşumu (test-kanıtı) veya insan onayı kaydı → kanıt seviyesi yükselir.');
}

function cmdOpen(_args: Args): void {
  out('ocean open: henüz yok.');
  out('Gelecek: pano yolunu gösterir (tarayıcıyı otomatik açmaz).');
}

// ── yönlendirici ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version || args.cmd === 'version') {
    out(`ocean v${TOOL_VERSION}`);
    return;
  }
  if (args.flags.help || args.cmd === 'help') {
    out(HELP);
    return;
  }

  switch (args.cmd) {
    case 'init':
      cmdInit(args);
      break;
    case 'sync':
      cmdSync(args);
      break;
    case 'verify':
      cmdVerify(args);
      break;
    case 'open':
      cmdOpen(args);
      break;
    default:
      fail(`Bilinmeyen komut: ${args.cmd}\n\n${HELP}`);
  }
}

await main();
