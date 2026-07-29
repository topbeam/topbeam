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
import { GuvenliYazmaHatasi, panoPath } from './state.ts';

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`✖ ${msg}\n`);
  process.exit(1);
}

const HELP = `
Topbeam v${TOOL_VERSION} — dürüst proje panosu (local-first, LLM'siz)

Kullanım: topbeam <komut> [seçenekler]

Komutlar:
  init            Bu projeyi Topbeam'e bağla (.ocean/ kurulumu + CLAUDE.md entegrasyonu)
  sync            Claude Code transcript + git gerçeklerinden log ve kartı güncelle
  verify <id>     Bir işi doğrula (insan onayı kaydet — kanıt seviyesi yükselir)
                  <id> tek kayıt ya da teslim sözü (soz-…) olabilir; söz
                  verirsen o söze eşleşen tüm kayıtlar tek onayla geçer
                  YALNIZ terminalden: cevap pipe/otomasyondan gelirse onay
                  kaydedilmez (insan onayı = gerçek insan)
  open            Pano yolunu göster (tarayıcıyı otomatik AÇMAZ)
  makbuz          Dışarıya gösterilebilir tek sayfalık teslim makbuzu üret
                  (.ocean/makbuz.md · --html ile .ocean/makbuz.html)
                  Üçüncü kişi kendi makinesinde yeniden doğrulayabilsin diye
                  commit SHA'ları + test komutu + defter dosyası kopyalanabilir
                  yazılır. Onaysız madde ONAYLI görünmez.

Seçenekler:
  --html          makbuz: tek dosya HTML de üret (dış istek yok)
  --no-ci         sync: opsiyonel CI okumasını tamamen kapat (TOPBEAM_NO_CI=1
                  ile aynı) — Topbeam tümüyle lokal kalır, tek dış çağrı yapılmaz
  --version       Sürümü yazdır
  --help          Bu yardımı göster

İlke: kanıtsız hiçbir iddia gösterilmez; "çalışıyor" yalnız test kanıtı
veya insan onayıyla söylenir. Özet deterministiktir (LLM yok).
`.trim();

// ── komutlar ─────────────────────────────────────────────────────────────────

async function cmdInit(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const res = await runInit(cwd);
  out(`Topbeam bağlandı: ${res.projectName}`);
  for (const c of res.created) out(`  + ${c}`);
  for (const s of res.skipped) out(`  = ${s} (vardı, dokunulmadı)`);
  out('');
  out('Sıradaki adım: topbeam sync  (transcript + git gerçeklerinden panoyu kur)');
}

const LEVEL_ORDER: EvidenceLevel[] = ['dosya-kaniti', 'test-kaniti', 'insan-onayi', 'dogrulanmadi'];

async function cmdSync(args: Args): Promise<void> {
  const cwd = process.cwd();
  // --no-ci: opsiyonel CI kaynağı hiç sorulmaz (TOPBEAM_NO_CI=1 de aynı işi görür).
  const res = await runSync(cwd, { noCi: args.flags['no-ci'] === true });
  if (!res.ok || res.state === undefined) fail(res.error ?? 'Senkron başarısız.');

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
      (l) => `${counts.get(l)} ${EVIDENCE_LEVEL_LABELS_TR[l].split(' — ')[0]?.toLocaleLowerCase('tr-TR')}`,
    ),
    ...(kaynaksiz > 0 ? [`${kaynaksiz} kanal kaydı yok`] : []),
  ].join(' · ');
  // Rapor da panoyla AYNI kapıdan geçer: onay sayısı passport.jsonl defterine
  // dayanır, maddenin kendi 'completed' iddiasına değil.
  const sozOnayli = res.sozOnayli ?? 0;
  const sozToplam = res.sozToplam ?? 0;

  out(`Topbeam senkron tamam — ${st.projectName}`);
  out(`  Transcript : ${res.transcriptsFound ?? 0} oturum tarandı`);
  out(`  Claim      : ${st.claims.length}${levelSummary !== '' ? ` (${levelSummary})` : ''}`);
  out(`  Log        : ${st.log.length} satır`);
  out(
    sozToplam > 0
      ? `  Teslim sözü: ${sozOnayli} / ${sozToplam} madde onaylandı`
      : "  Teslim sözü: yok — sözlerini .ocean/goal.md'ye yaz, bar orada dolsun",
  );
  // Defter ARŞİVDİR: sayılır ama ilerleme diye sunulmaz (payda büyüsün diye değil).
  out(`  Defter     : ${res.defterKaydi ?? 0} oturum kaydı (ilerleme ölçüsü değil)`);
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

/**
 * verify — İNSAN KAPISI burada kurulur:
 * - interactive: cevap kanalı (stdin) gerçek bir terminal mi. Pipe/dosya/CI ise
 *   false → runVerify onay istemez, hiçbir şey yazmaz.
 * - `by` GEÇİRİLMEZ: onaylayan kimliği işletim sisteminden okunur. Eski `--by`
 *   bayrağı imza uydurmaya (`by:"dogfood-ajan"`) izin veriyordu, kaldırıldı.
 */
async function cmdVerify(args: Args): Promise<void> {
  const id = args.positional[0];
  if (id === undefined || id === '') fail('Kullanım: topbeam verify <id>');
  if (args.flags.by !== undefined) {
    fail(
      "'--by' bayrağı kaldırıldı: onaylayan kimliği işletim sistemi kullanıcısından okunur.\n" +
        'Başkasının adına onay kaydedilemez — insan onayı bu üründe gerçek insan demektir.',
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
    if (!res.ok) fail(res.error ?? 'Doğrulama başarısız.');
    if (res.panoPath !== undefined) out(`Pano güncellendi: ${res.panoPath}`);
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
  if (!res.ok) fail(res.error ?? 'Makbuz üretilemedi.');
  out('Makbuz yazıldı (dışarıya gösterilebilir — Topbeam açmaz, göndermez):');
  out(`  ${res.mdPath ?? ''}`);
  if (res.htmlPath !== undefined) out(`  ${res.htmlPath}`);
  const toplam = res.sozToplam ?? 0;
  out(
    toplam > 0
      ? `  Teslim sözü: ${res.sozOnayli ?? 0} / ${toplam} madde insan onaylı`
      : "  Teslim sözü: yok — sözlerini .ocean/goal.md'ye yaz (makbuz yine üretildi, kanıt dökümü olarak)",
  );
  out('Makbuz kendi sınırlarını yazar; onaysız madde onaylı görünmez.');
}

async function cmdOpen(_args: Args): Promise<void> {
  const cwd = process.cwd();
  const p = panoPath(cwd);
  try {
    await access(p);
  } catch {
    fail(`Pano henüz yok: ${p}\nÖnce: topbeam sync`);
  }
  out('Pano yolu (tarayıcında aç — Topbeam otomatik açmaz):');
  out(`  ${p}`);
}

// ── yönlendirici ─────────────────────────────────────────────────────────────

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
    default:
      fail(`Bilinmeyen komut: ${args.cmd}\n\n${HELP}`);
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
  process.stderr.write(`✖ Beklenmeyen hata: ${mesaj}\n`);
  // Ayrıntı isteyen için: TOPBEAM_DEBUG=1 ile tam iz.
  if (process.env.TOPBEAM_DEBUG === '1' && e instanceof Error && e.stack !== undefined) {
    process.stderr.write(`${e.stack}\n`);
  } else {
    process.stderr.write('  (tam iz için: TOPBEAM_DEBUG=1 topbeam <komut>)\n');
  }
  process.exit(1);
});
