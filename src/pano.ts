/**
 * Pano render — .ocean/pano.html TEK statik dosya (saf fonksiyon, fs yok).
 * (Dosya/dizin adları `.ocean/…` Topbeam'de de sabit — veri göçü riski yok.)
 *
 * Görsel dil: Keşif raporundaki Topbeam token seti birebir (koyu zemin merdiveni,
 * teal aksan, mono-uppercase etiket imzası, sistem fontlar — gömülü font YOK).
 *
 * DÜRÜSTLÜK (yapısal):
 * - EN BASKIN öğe = sıradaki-tek-hareket kartı (GPT spec 6 alan + "Doğrulamayı
 *   başlat" kutusu: kopyalanabilir `topbeam verify <id>` komutu). Bar kartın
 *   ALTINDA durur — ilerleme kartın önüne geçmez.
 * - BAR = teslim sözleri (goal.md `- [ ]`): SONLU, iki durumlu, yüzdesiz.
 *   "3 / 7 madde onaylandı" dürüst sayımıyla; bölme yalnız defterle desteklenen
 *   insan onayıyla dolar. Söz yoksa bar HİÇ çizilmez (boş bar sahte affordance).
 * - Oturum kayıtları "Defter"dedir: nötr sayım ("11 oturum kaydı"), ilerleme
 *   dili yok, satırlarında verify komutu öne çıkarılmaz (lastik damga daveti).
 * - Kanıt satırı yoksa "kayıt yok" — sakin gri, kırmızı alarm değil.
 * - Motivasyon sözü yok; beyan satırları "beyan" rozetiyle işaretli VE
 *   varsayılan olarak KATLI: kanıt üstte ve açık, beyan altta ve kapalı
 *   (beyan kanıt değildir → görünürlüğü de kanıtla eşit olamaz).
 * - Tüm dinamik metin HTML-escape edilir; tek JS: kopyala butonu (opsiyonel,
 *   JS'siz de komut metni seçilip kopyalanabilir).
 * - İNSAN ROZETİ = YALNIZ DEFTER. Hiçbir satır kendi iddiasıyla "insan onaylı"
 *   görünemez: rozet, .ocean/passport.jsonl'deki geçerli (imzalı + terminal
 *   kanallı) doğrulama kaydına dayanır (ledger.ts). Kaydı olmayan kayıt
 *   SİLİNMEZ — "kanal kaydı yok" diye işaretlenir. Defter verilmezse rozet
 *   verilmez (fail-closed).
 */
import {
  CARD_PRIMARY_BUTTON_TR,
  TOOL_VERSION,
  type Card,
  type Claim,
  type EvidenceLevel,
  type LogEntry,
  type LogSource,
  type OceanState,
  type ScopeNotes,
} from './types.ts';
import {
  BOS_LEDGER,
  ROZETSIZ_BASLIK,
  ROZETSIZ_ETIKET,
  ROZETSIZ_NOT,
  birimOnayli,
  claimOnayli,
  dogrulananSayisi,
  logSatiriOnayli,
  maddeOnayli,
  pasaportTamMi,
  type VerificationLedger,
} from './ledger.ts';
import { buildDefter } from './passport.ts';

// ── küçük yardımcılar ────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO ts → "2026-07-28 10:03" (deterministik dilimleme, locale yok). */
function fmtTs(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(ts);
  return m !== null ? `${m[1]} ${m[2]}` : ts;
}

const LEVEL_PILL: Record<EvidenceLevel, { cls: string; label: string }> = {
  'dosya-kaniti': { cls: 'ev-file', label: 'file evidence' },
  'test-kaniti': { cls: 'ev-test', label: 'test evidence' },
  'insan-onayi': { cls: 'ev-human', label: 'human approval' },
  dogrulanmadi: { cls: 'ev-none', label: 'not verified' },
};

const SOURCE_PILL: Record<LogSource, { cls: string; label: string }> = {
  git: { cls: 'ev-file', label: 'git' },
  test: { cls: 'ev-test', label: 'test' },
  'claude-beyan': { cls: 'ev-none', label: 'statement' },
  insan: { cls: 'ev-human', label: 'human' },
  // enum DEĞERİ 'ocean' (şema uyumu) — kullanıcıya görünen etiket: topbeam.
  ocean: { cls: 'ev-ocean', label: 'topbeam' },
};

/** Defterle desteklenmeyen "insan" iddiasının yerine geçen dürüst rozet. */
const ROZETSIZ_PILL = `<span class="pill ev-stale" title="${esc(ROZETSIZ_BASLIK)}">${esc(
  ROZETSIZ_ETIKET,
)}</span>`;

/**
 * Seviye rozeti. `onayli` = bu birimin defterde geçerli doğrulama kaydı var mı.
 * 'insan-onayi' seviyesi için TEK yetkili budur; kaydı olmayan iddia rozet
 * ALAMAZ (parametre zorunlu: unutulup fail-open olmasın).
 */
function levelPill(level: EvidenceLevel, onayli: boolean): string {
  if (level === 'insan-onayi' && !onayli) return ROZETSIZ_PILL;
  const p = LEVEL_PILL[level];
  return `<span class="pill ${p.cls}">${p.label}</span>`;
}

// ── bölüm render'ları ────────────────────────────────────────────────────────

/** Kopyalanabilir komut satırı — TEK desen (kart ve pasaport aynı bileşeni kullanır). */
interface CmdBlockOptions {
  /** Kapsayıcıya eklenecek ek sınıf (yerleşim farkı için; bileşen aynı kalır). */
  cls?: string;
  /** Ekran okuyucu etiketi — çok satırlı listede hangi komut olduğunu ayırt eder. */
  etiket?: string;
}

function cmdBlock(command: string, opts: CmdBlockOptions = {}): string {
  const c = esc(command);
  const cls = opts.cls === undefined ? '' : ` ${opts.cls}`;
  const label = esc(opts.etiket ?? `Copy command: ${command}`);
  return (
    `<div class="cmdrow${cls}"><code class="cmd" data-cmd="${c}">${c}</code>` +
    `<button class="btn mini" type="button" aria-label="${label}" aria-live="polite" data-cmd="${c}" onclick="oceanKopyala(this)">Copy</button></div>`
  );
}

/** Uzun başlığı ekran-okuyucu etiketine sığacak kadar kısaltır (deterministik). */
function kisaBaslik(s: string, max = 60): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Kartın dayandığı KAYIT kimliği — rozetin defterde aranacağı anahtar.
 *
 * Normal kartlarda `card.id` zaten claim id'sidir. 'kart-tam' gibi sentetik
 * kartların kendi kimliği yoktur; gerçek yine bir claim'den gelir, o yüzden
 * aynı tarih + aynı cümle TEK bir claim'e işaret ediyorsa o kullanılır.
 * Birden çok aday varsa (ya da hiç yoksa) rozet YOKTUR — belirsizlikte
 * fail-closed davranırız, ama gerçek onayı da haksız yere düşürmeyiz.
 */
function kartKayitId(card: Card, claims: readonly Claim[]): string | null {
  if (claims.some((c) => c.id === card.id)) return card.id;
  if (card.factDate === undefined) return null;
  const adaylar = claims.filter((c) => c.createdAt === card.factDate && c.text === card.fact);
  return adaylar.length === 1 ? (adaylar[0] as Claim).id : null;
}

/**
 * Kartın "İnsan onayı" satırı — metin DEFTERDEN yazılır, claim'in kendi
 * cümlesinden DEĞİL. Böylece uydurulmuş bir kanıt cümlesi bu satıra giremez.
 */
function insanOnayiSatiri(
  card: Card,
  ledger: VerificationLedger,
  kayitId: string | null,
): string | null {
  const kayit = kayitId === null ? undefined : ledger.gecerli.get(kayitId);
  if (kayit !== undefined) {
    return `${kayit.by} verified this — ${fmtTs(kayit.at)} (terminal approval, passport.jsonl)`;
  }
  // İddia var ama dayanağı yok → sessizce silinmez, dürüstçe işaretlenir.
  return card.evidence.humanApproval === null ? null : ROZETSIZ_NOT;
}

function renderCard(card: Card, ledger: VerificationLedger, claims: readonly Claim[]): string {
  const ev = card.evidence;
  const kayitId = kartKayitId(card, claims);
  const onayli = kayitId !== null && claimOnayli(ledger, kayitId);
  const row = (k: string, v: string | null, stale = false): string =>
    `<div class="krow"><span class="k">${k}</span><span class="v${v === null ? ' none' : ''}${
      stale ? ' stale' : ''
    }">${v === null ? 'no record' : esc(v)}</span></div>`;

  const isClaimCard = card.id !== 'kart-bos' && card.id !== 'kart-tam';
  const verifyBox = isClaimCard
    ? `<div class="verifybox">
        <span class="eyebrow">${esc(CARD_PRIMARY_BUTTON_TR)}</span>
        <p class="hint">The board is static — run the command in your terminal:</p>
        ${cmdBlock(`topbeam verify ${card.id}`)}
      </div>`
    : '';

  return `<section class="panel hero" aria-label="The single next move">
    <div class="heroTop">
      <span class="eyebrow">The single next move</span>
      ${levelPill(card.factLevel, onayli)}
    </div>
    <h2 class="fact">${esc(card.fact)}</h2>
    ${
      // Gerçeğin KENDİ tarihi — kartın güncellenme damgasıyla karışmasın diye
      // fact'in hemen altında durur (kart bugün üretilir, koşum eski olabilir).
      card.factDate !== undefined
        ? `<p class="factstamp">This fact comes from a record dated <span class="mono">${esc(fmtTs(card.factDate))}</span></p>`
        : ''
    }
    <div class="evrows">
      ${row('Git diff', ev.gitDiff)}
      ${row('Test output', ev.testOutput)}
      ${row('Human approval', insanOnayiSatiri(card, ledger, kayitId), !onayli && ev.humanApproval !== null)}
    </div>
    <div class="unknown"><span class="k">Missing / unclear</span><p>${esc(card.unknown)}</p></div>
    <div class="action">
      <span class="eyebrow">Move</span>
      <p class="verb">${esc(card.action.verb)}</p>
      ${card.action.command !== undefined ? cmdBlock(card.action.command) : ''}
      <p class="why"><span class="k">Why this one?</span> ${esc(card.why)}</p>
      <p class="done"><span class="k">Counts as done when</span> ${esc(card.doneWhen)}</p>
    </div>
    ${verifyBox}
    <p class="stamp">Card updated: <span class="mono">${esc(fmtTs(card.updatedAt))}</span></p>
  </section>`;
}

const LOG_SHOWN_MAX = 100;

/**
 * Log satırı rozeti. 'insan' kaynağı KENDİ BAŞINA yetmez: satır, defterdeki
 * bir terminal onayına (aynı zaman damgası) bağlanamıyorsa "insan" rozeti
 * ALMAZ — satır silinmez, "kanal kaydı yok" diye işaretlenir.
 */
function logItems(entries: readonly LogEntry[], ledger: VerificationLedger): string {
  return entries
    .map((e) => {
      const kaynaksiz = e.source === 'insan' && !logSatiriOnayli(ledger, e.ts);
      const p = SOURCE_PILL[e.source];
      const pill = kaynaksiz
        ? ROZETSIZ_PILL
        : `<span class="pill ${p.cls}">${p.label}</span>`;
      const not = kaynaksiz ? `<span class="kaynaksiz">${esc(ROZETSIZ_NOT)}</span>` : '';
      return `<li><span class="ts mono">${esc(fmtTs(e.ts))}</span>${pill}<span class="txt">${esc(e.text)}${not}</span></li>`;
    })
    .join('\n');
}

/**
 * Log — KANIT ÜSTTE VE AÇIK, BEYAN ALTTA VE KATLI.
 *
 * Gerekçe (dogfood): beyan satırları (Claude'un niyet cümleleri) sayıca kanıtı
 * eziyordu; kart mükemmel olsa da altı kirliyse pano gürültü gibi okunuyor.
 * Beyan kanıt değildir → varsayılan görünürlüğü de kanıtla eşit olamaz.
 * Silmiyoruz (dürüstlük: kayıt duruyor), katlıyoruz — isteyen açar.
 */
function renderLog(
  log: readonly LogEntry[],
  ledger: VerificationLedger,
  scope?: ScopeNotes,
): string {
  const total = log.length;
  const ters = [...log].reverse(); // en yeni üstte
  const kanit = ters.filter((e) => e.source !== 'claude-beyan');
  const beyan = ters.filter((e) => e.source === 'claude-beyan');

  const kanitShown = kanit.slice(0, LOG_SHOWN_MAX);
  const beyanShown = beyan.slice(0, LOG_SHOWN_MAX);

  /**
   * "toplam N" YASAK. Buradaki N, panoda TUTULAN satır sayısıdır; ham kayıt
   * daha büyüktür (elenmiş + tekilleşmiş + kırpılmış). Eski metin "toplam 454"
   * derken 454 zaten süzülmüş bir sayıydı — sayı uydurmak moat ihlalidir.
   * Ham sayı yalnız ÖLÇÜLDÜYSE (scope varsa) yazılır; yoksa hiç iddia edilmez.
   */
  const capNote = (gosterilen: number, tutulan: number, ham: number | null, ad: string): string => {
    const kirpildi = tutulan > gosterilen;
    const hamFarkli = ham !== null && ham > tutulan;
    if (!kirpildi && !hamFarkli) return '';
    const bas = kirpildi
      ? `Showing the last ${gosterilen} ${ad} lines — of the ${tutulan} this board keeps.`
      : `This board keeps ${tutulan} ${ad} lines.`;
    const kuyruk = hamFarkli
      ? ` The raw record held ${ham} ${ad} lines; the difference is broken down in the “What this board covers” block above.`
      : '';
    return `<p class="capnote">${bas}${kuyruk}</p>`;
  };
  const hamKanit = scope !== undefined ? scope.log.hamKanit : null;
  const hamBeyan = scope !== undefined ? scope.log.hamBeyan : null;

  const empty =
    total === 0 ? '<p class="empty">No log lines yet — they arrive after <span class="mono">topbeam sync</span>.</p>' : '';
  const kanitBos =
    total > 0 && kanit.length === 0
      ? '<p class="empty">No line here carries evidence — the statements below are what Claude said, not evidence.</p>'
      : '';
  const beyanBlok =
    beyan.length > 0
      ? `<details class="beyanlar">
      <summary><span class="pill ev-none">statement</span> Claude's statements (${beyan.length}) — not evidence, folded away</summary>
      <ul class="timeline">${logItems(beyanShown, ledger)}</ul>
      ${capNote(beyanShown.length, beyan.length, hamBeyan, 'statement')}
    </details>`
      : '';

  /**
   * Kaynaksız "insan" satırı varsa bu SAYIYLA söylenir — gizlenmez de,
   * rozetlenmez de. (Kaç satır dayanaksız çıktı: denetçinin ilk sorusu.)
   */
  const kaynaksizSayi = ters.filter(
    (e) => e.source === 'insan' && !logSatiriOnayli(ledger, e.ts),
  ).length;
  const kaynaksizNot =
    kaynaksizSayi > 0
      ? `<p class="capnote">${kaynaksizSayi} lines call themselves human-approved but could not be ` +
        `tied to a terminal-signed verification in the <span class="mono">passport.jsonl</span> ledger — ` +
        `left without a badge; nothing was deleted.</p>`
      : '';

  return `<section class="panel" aria-label="Log history">
    <div class="sechead"><span class="eyebrow">Log history</span><span class="count mono">on this board: ${kanit.length} evidence · ${beyan.length} statements</span></div>
    ${empty}
    ${kanitBos}
    <ul class="timeline">${logItems(kanitShown, ledger)}</ul>
    ${capNote(kanitShown.length, kanit.length, hamKanit, 'evidence')}
    ${kaynaksizNot}
    ${beyanBlok}
  </section>`;
}

/**
 * "Bu panonun kapsamı — ve bilmedikleri" — kartın HEMEN ALTINDA.
 *
 * NEDEN: Topbeam gürültüyü keser (proje dışı düzenleme, ilişkilendirilemeyen
 * beyan, sayı üretmeyen kontrol komutu, satır sınırı). Kesmek doğru; ama İZ
 * BIRAKMADAN kesmek gizlemektir — kullanıcı panonun her şeyi gördüğünü sanır.
 * Bu blok farkı kapatır: neyin, kaç tane elendiği ölçülmüş sayılarla yazar.
 * Sayı yoksa (eski state / sync koşmamış) UYDURULMAZ, "kayıt yok" denir.
 */
function renderScope(scope: ScopeNotes | undefined): string {
  const bas = `<div class="sechead"><span class="eyebrow">What this board covers — and what it does not know</span></div>`;
  if (scope === undefined) {
    return `<section class="panel scope" aria-label="What this board covers">
    ${bas}
    <p class="empty">No scope record — this board was produced before scope was measured.
    Run <span class="mono">topbeam sync</span> and what was filtered out gets written here.</p>
  </section>`;
  }

  const c = scope.log;
  const satir = (k: string, v: string): string =>
    `<li><span class="sk">${esc(k)}</span><span class="sv">${esc(v)}</span></li>`;

  const rows: string[] = [];
  if (scope.disKapsamDuzenleme > 0) {
    rows.push(
      satir(
        'Edits outside the project',
        `${scope.disKapsamDuzenleme} edits touched files outside this project root — no claim, no log line (this board speaks only about this project).`,
      ),
    );
  }
  if (c.ilgisizBeyan > 0) {
    rows.push(
      satir(
        'Statements that could not be linked',
        `${c.ilgisizBeyan} statement lines could not be tied to this project — left out of the log (a statement is not evidence anyway).`,
      ),
    );
  }
  if (scope.kontrolKomutu > 0) {
    rows.push(
      satir(
        'Check commands that produced no claim',
        `${scope.kontrolKomutu} check commands (tsc, eslint and the like) produced no claim — they report no pass/fail count, and a result is not invented.`,
      ),
    );
  }
  if (scope.atlananOturum > 0) {
    rows.push(
      satir(
        'Skipped sessions',
        `${scope.atlananOturum} Claude Code sessions were recorded from start to finish in another directory — no claim was produced.`,
      ),
    );
  }
  if (scope.kisaltilanYol > 0) {
    rows.push(
      satir(
        'Shortened paths',
        `In ${scope.kisaltilanYol} places an absolute path outside the project was shortened to “~/…” — another project's path does not belong in this board's headline.`,
      ),
    );
  }
  if (scope.gitYok) {
    rows.push(
      satir(
        'Git',
        'This directory is not a git repository — changes could not be compared against git, so the file-evidence route is closed.',
      ),
    );
  }

  // Sayı zinciri HER ZAMAN yazılır: panodaki her satırın nereden geldiği.
  const zincir =
    `Raw ${c.hamToplam} lines (${c.hamKanit} evidence · ${c.hamBeyan} statements) → ` +
    `${c.ilgisizBeyan} unlinked statements dropped → ${c.tekillestirilen} duplicates merged → ` +
    `${c.kirpilan} lines cut at the display limit → ${c.tutulan} lines on the board.`;
  rows.push(satir('Log line chain', zincir));

  /**
   * ⚠️ PANONUN KENDİ DÜRÜSTLÜK BEYANI (2026-07-29 sertleştirme bulgusu).
   *
   * Koşul yalnız `rows.length === 1` idi ve "Log satır zinciri" satırı HER ZAMAN
   * ekleniyordu → 46. oturumdan itibaren pano şunu yazıyordu:
   *     "Bu senkronda elenen kayıt yok — ham kayıtların tamamı panoda."
   * hemen altında ise:
   *     "821 satır sınırda kırpıldı … 221 kanıt satırı listeden düştü."
   * Panonun dürüstlük cümlesi kendini AYNI EKRANDA yalanlıyordu. Bir kanıt
   * ürününde bu, kusurların en pahalısı: okur haklı olarak "başka nerede
   * yalan söylüyor?" diye sorar.
   *
   * Artık "temiz" iddiası ancak GERÇEKTEN hiçbir şey elenmediyse kurulur; aksi
   * hâlde kaybın SAYISI söylenir ve tam kaydın nerede olduğu gösterilir.
   */
  const elenenVar =
    rows.length > 1 || c.kirpilan > 0 || c.ilgisizBeyan > 0 || c.tekillestirilen > 0;
  const temiz = !elenenVar
    ? '<p class="scopelead">Nothing was filtered out in this sync — every raw record is on the board.</p>'
    : c.kirpilan > 0 && rows.length === 1
      ? `<p class="scopelead">This board shows ${esc(String(c.tutulan))} of ${esc(String(c.hamToplam))} raw lines — ${esc(String(c.kirpilan))} did not fit the list. The full record is in <code>.ocean/state.json</code>.</p>`
      : '<p class="scopelead">The noise was cut, but a trace was left: the items below were deliberately kept out of scope.</p>';

  const notlar =
    scope.notlar.length > 0
      ? `<details class="scopenotes">
      <summary>Engine notes (${scope.notlar.length})</summary>
      <ul class="notelist">${scope.notlar.map((n) => `<li>${esc(n)}</li>`).join('\n')}</ul>
    </details>`
      : '';

  return `<section class="panel scope" aria-label="What this board covers">
    ${bas}
    ${temiz}
    <ul class="scopelist">${rows.join('\n')}</ul>
    ${notlar}
  </section>`;
}

/**
 * BAR — SONLU ve İKİ DURUMLU. Bölme sayısı = teslim sözü sayısı (kullanıcı
 * goal.md'yi değiştirmedikçe SABİT: yeni oturum barı uzatmaz). Bölme yalnız
 * DEFTERLE desteklenen insan onayıyla dolar. Yüzde yok, kısmi doluluk yok:
 * bir söz ya insan onaylıdır ya değildir.
 */
function renderBar(dolu: number, toplam: number): string {
  const segs = Array.from(
    { length: toplam },
    (_, i) => `<span class="seg${i < dolu ? ' on' : ''}"></span>`,
  ).join('');
  const etiket = `${dolu} of ${toplam} delivery promises are human-approved`;
  return `<div class="bar" role="img" aria-label="${esc(etiket)}">${segs}</div>`;
}

/**
 * TESLİM SÖZLERİ — ilerlemenin TEK yeri. Kartın hemen altında durur; kart
 * en baskın öğe kalsın diye bar ince ve sessizdir.
 *
 * Söz yoksa BAR GÖSTERİLMEZ: boş bar sahte affordance olurdu ("bir yerde
 * doluyormuş" hissi verir, oysa ölçülecek bir söz yoktur).
 */
function renderTeslim(state: OceanState, ledger: VerificationLedger): string {
  const items = state.passport;
  const bas = `<span class="eyebrow">Delivery promises</span>`;
  if (items.length === 0) {
    return `<section class="panel" aria-label="Delivery promises">
    <div class="sechead">${bas}</div>
    <p class="empty">Write your delivery promises in <span class="mono">.ocean/goal.md</span> — that is where the bar fills.</p>
  </section>`;
  }

  // Tik de, sayı da, tören bandı da DEFTERE dayanır: maddenin kendi
  // "completed" iddiası tek başına ✓ getirmez (yoksa tik ölçmez, süsler).
  const verified = dogrulananSayisi(items, ledger);
  const full = pasaportTamMi(items, ledger);
  const band = full
    ? `<div class="fullband">Topped out 🎉 — every delivery promise is human-approved. Seal: <span class="mono">.ocean/muhur.md</span></div>`
    : '';
  const rows = items
    .map((i) => {
      const done = maddeOnayli(ledger, i);
      const adet = i.claimIds.length > 0 ? `<span class="pcount mono">${i.claimIds.length} records</span>` : '';
      /**
       * Çıplak id elle seçilmez: her satır kartla AYNI kopyala desenini taşır.
       * Kaydı olmayan sözde komut YOK — onaylanacak bir şey olmadığı hâlde
       * "doğrula" demek lastik damga davetidir.
       */
      const cmd =
        done || i.claimIds.length === 0
          ? ''
          : cmdBlock(`topbeam verify ${i.id}`, {
              cls: 'pcmd',
              etiket: `Copy the verification command — ${kisaBaslik(i.title)}`,
            });
      const reason = i.reason !== undefined ? `<span class="preason">${esc(i.reason)}</span>` : '';
      // Madde "insan onaylı" diyor ama defterde karşılığı yoksa: silme yok,
      // dürüst not — hangi kaydın dayanağı düşmüş, görünsün.
      const kaynaksiz =
        i.level === 'insan-onayi' && !birimOnayli(ledger, i.claimIds)
          ? `<span class="preason kaynaksiz">${esc(ROZETSIZ_NOT)} — this promise could not be tied to a terminal approval in the ${esc(
              'passport.jsonl',
            )} ledger.</span>`
          : '';
      return `<li class="pitem"><span class="tick ${done ? 'on' : ''}">${done ? '✓' : '○'}</span><span class="ptitle">${esc(i.title)}${reason}${kaynaksiz}</span>${adet}${levelPill(i.level, done)}${cmd}</li>`;
    })
    .join('\n');

  return `<section class="panel" aria-label="Delivery promises">
    <div class="sechead">${bas}<span class="count mono">${verified} / ${items.length} approved</span></div>
    ${renderBar(verified, items.length)}
    ${band}
    <ul class="plist">${rows}</ul>
  </section>`;
}

/**
 * DEFTER — oturum kayıtları arşivi. NÖTR SAYIM: "11 oturum kaydı", ilerleme
 * dili YOK ("0/11 doğrulandı" burada bilinçli olarak kaldırıldı — çalıştıkça
 * büyüyen bir payda, ilerleme değil Sisifos'tur).
 *
 * Satırlarda `topbeam verify` ÖNE ÇIKARILMAZ: 99 dosyalık bir arşiv birimine
 * onay istemek lastik damga üretir ve insan onayını değersizleştirir.
 */
function renderDefter(claims: readonly Claim[], ledger: VerificationLedger): string {
  const kayitlar = buildDefter(claims);
  const bas = `<div class="sechead"><span class="eyebrow">Sessions</span><span class="count mono">${kayitlar.length} session records</span></div>`;
  const not =
    '<p class="capnote">This is not a measure of progress — only a record of what was measured in which session. Progress lives in the delivery promises above.</p>';
  if (kayitlar.length === 0) {
    return `<section class="panel" aria-label="Sessions">
    ${bas}
    ${not}
    <p class="empty">No session records yet — they arrive after <span class="mono">topbeam sync</span>.</p>
  </section>`;
  }
  const rows = kayitlar
    .map((k) => {
      const onayli = birimOnayli(ledger, k.claimIds);
      return `<li class="pitem"><span class="ptitle">${esc(k.title)}</span><span class="pcount mono">${k.claimIds.length} records</span>${levelPill(k.level, onayli)}</li>`;
    })
    .join('\n');
  return `<section class="panel" aria-label="Sessions">
    ${bas}
    ${not}
    <details class="defter">
      <summary>Session records (${kayitlar.length})</summary>
      <ul class="plist">${rows}</ul>
    </details>
  </section>`;
}

// ── tam sayfa ────────────────────────────────────────────────────────────────

export interface PanoOptions {
  /** goal.md'den okunan güncel hedef satırı (beyan — Claude/kullanıcı yazar). */
  goalText?: string | null;
  /**
   * .ocean/passport.jsonl doğrulama defteri — İNSAN ROZETİNİN TEK KAYNAĞI.
   * VERİLMEZSE hiçbir yerde insan rozeti çıkmaz (fail-closed): rozet için
   * kanıt gerekir, "bilinmiyor" insan sayılmaz.
   */
  ledger?: VerificationLedger;
}

const CSS = `
:root{
  --bg:#04060d; --s1:#070a12; --s2:#0a0f18; --s3:#0f1622; --s4:#15202e;
  --line:rgba(255,255,255,.055); --line2:rgba(255,255,255,.105); --line3:rgba(255,255,255,.17);
  --tx:rgba(235,241,240,.93); --dim:rgba(205,217,217,.75); --muted:rgba(183,198,198,.63);
  --teal:#2dd4bf; --teal2:#5eead4; --teald:rgba(45,212,191,.13); --on-teal:#041210;
  --ok:#34d399; --watch:#fbbf24; --risk:#fb7185; --risksoft:#fca5b4; --cold:#5b6675; --info:#38bdf8; --plan:#8790a0; --violet:#a78bfa;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
  --r:12px; --r2:16px; --micro:160ms; --ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(1300px 720px at 82% -16%,rgba(45,212,191,.06),transparent 56%),radial-gradient(900px 600px at -8% 116%,rgba(56,189,248,.045),transparent 55%),var(--bg);color:var(--tx);font-family:var(--sans);font-size:15.5px;line-height:1.66;-webkit-font-smoothing:antialiased;min-height:100vh}
::selection{background:rgba(94,234,212,.24)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--muted)}
main{max-width:820px;margin:0 auto;padding:34px 20px 60px;display:flex;flex-direction:column;gap:18px}
header.top{display:flex;flex-direction:column;gap:6px;padding:6px 2px 10px}
header.top h1{font-size:clamp(1.5rem,3vw,2.1rem);font-weight:600;letter-spacing:-.028em;line-height:1.08}
header.top .meta{font-family:var(--mono);font-size:11px;color:var(--muted)}
header.top .goal{font-size:13px;color:var(--dim);border-left:2px solid var(--teal);padding-left:10px;margin-top:4px}
header.top .goal .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:8px}
.panel{background:linear-gradient(180deg,var(--s2),var(--s1));border:1px solid var(--line);border-radius:var(--r2);padding:24px 26px}
.panel.hero{border-color:var(--line2);position:relative;overflow:hidden}
.panel.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(600px 260px at 85% -20%,rgba(45,212,191,.07),transparent 60%);pointer-events:none}
.heroTop{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.heroTop .pill{margin-left:auto}
.fact{font-size:21px;font-weight:600;letter-spacing:-.02em;line-height:1.24;max-width:64ch}
.factstamp{margin-top:7px;font-size:11px;color:var(--muted)}
.pill{font-family:var(--mono);font-size:9px;letter-spacing:.09em;text-transform:uppercase;padding:3px 7px;border-radius:6px;font-weight:500;white-space:nowrap}
.ev-test{color:var(--ok);background:rgba(52,211,153,.13)}
.ev-file{color:var(--info);background:rgba(56,189,248,.12)}
.ev-human{color:var(--teal2);background:var(--teald)}
.ev-none{color:var(--plan);background:rgba(135,144,160,.14)}
.ev-ocean{color:var(--violet);background:rgba(167,139,250,.13)}
/* unsupported approval claim: a calm mark, not an alarm */
.ev-stale{color:var(--watch);background:rgba(251,191,36,.11)}
.kaynaksiz{display:block;font-size:11.5px;color:var(--watch);margin-top:2px}
.krow .v.stale{color:var(--watch)}
.evrows{margin-top:16px}
.krow{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:11px 0}
.krow:last-child{border-bottom:none}
.k{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.krow .v{font-size:13px;text-align:right}
.krow .v.none{color:var(--plan)}
.unknown{display:flex;flex-direction:column;gap:4px;margin-top:16px;padding:12px 14px;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.2);border-radius:11px}
.unknown p{font-size:12.5px;color:var(--watch)}
.action{margin-top:18px;display:flex;flex-direction:column;gap:8px}
.action .verb{font-size:14px;font-weight:600;letter-spacing:-.012em}
.why,.done{font-size:12.5px;color:var(--dim)}
.why .k,.done .k{margin-right:8px}
.cmdrow{display:flex;align-items:stretch;gap:8px}
.cmd{font-family:var(--mono);font-size:12px;background:var(--s3);border:1px solid var(--line2);border-radius:9px;padding:10px 13px;color:var(--teal2);display:block;overflow-x:auto;flex:1;white-space:nowrap;user-select:all}
.btn{font-family:var(--sans);border:1px solid var(--line2);border-radius:9px;padding:9px 14px;font-size:12.5px;background:var(--s3);color:var(--tx);cursor:pointer;transition:border-color var(--micro) var(--ease),color var(--micro) var(--ease)}
.btn:hover{border-color:var(--teal);color:var(--teal2)}
.btn.mini{font-size:11px;padding:0 12px;white-space:nowrap}
.verifybox{margin-top:20px;padding:16px;border:1px solid var(--teald);background:linear-gradient(180deg,rgba(45,212,191,.08),rgba(45,212,191,.03));border-radius:12px;display:flex;flex-direction:column;gap:8px}
.verifybox .eyebrow{color:var(--teal2)}
.verifybox .hint{font-size:12px;color:var(--dim)}
.stamp{margin-top:16px;font-size:11px;color:var(--muted)}
.sechead{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.sechead .count{margin-left:auto;font-size:12px;color:var(--dim)}
.timeline{list-style:none}
.timeline li{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--line);padding:9px 0;font-size:13px}
.timeline li:last-child{border-bottom:none}
.timeline .ts{font-size:11px;color:var(--muted);white-space:nowrap}
.timeline .txt{color:var(--dim);overflow-wrap:anywhere}
.capnote,.empty{font-size:12px;color:var(--muted);padding:8px 0 0}
.scope .scopelead{font-size:12.5px;color:var(--dim);margin-bottom:10px}
.scopelist{list-style:none}
.scopelist li{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding:9px 0;font-size:12.5px;flex-wrap:wrap}
.scopelist li:last-child{border-bottom:none}
.scopelist .sk{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);flex:none;min-width:16ch}
.scopelist .sv{flex:1;min-width:min(100%,26ch);color:var(--dim);overflow-wrap:anywhere}
.scopenotes{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}
.scopenotes>summary{cursor:pointer;font-size:12px;color:var(--muted);list-style:none;padding:4px 0}
.scopenotes>summary::-webkit-details-marker{display:none}
.scopenotes>summary::after{content:'show';font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--plan);margin-left:8px}
.scopenotes[open]>summary::after{content:'hide'}
.notelist{list-style:none;margin-top:6px}
.notelist li{font-size:12px;color:var(--muted);padding:5px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.notelist li:last-child{border-bottom:none}
.beyanlar{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
.beyanlar>summary{cursor:pointer;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;list-style:none;padding:4px 0}
.beyanlar>summary::-webkit-details-marker{display:none}
.beyanlar>summary::after{content:'show';font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--plan);margin-left:auto}
.beyanlar[open]>summary::after{content:'hide'}
.beyanlar>summary:hover{color:var(--dim)}
/* Bar: finite segments, two states. No percentages, no animation, no partial fill. */
.bar{display:flex;gap:4px;margin:0 0 14px}
.bar .seg{flex:1;height:7px;border-radius:3px;background:var(--s4);border:1px solid var(--line2)}
.bar .seg.on{background:var(--teal);border-color:var(--teal)}
.defter{border-top:1px solid var(--line);padding-top:10px;margin-top:4px}
.defter>summary{cursor:pointer;font-size:12px;color:var(--muted);list-style:none;padding:4px 0}
.defter>summary::-webkit-details-marker{display:none}
.defter>summary::after{content:'show';font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--plan);margin-left:8px}
.defter[open]>summary::after{content:'hide'}
.defter>summary:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.plist{list-style:none}
.pitem{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--line);padding:10px 0;font-size:13px;flex-wrap:wrap}
.pitem:last-child{border-bottom:none}
.tick{font-family:var(--mono);color:var(--plan);width:18px;flex:none;text-align:center}
.tick.on{color:var(--ok)}
.ptitle{flex:1;min-width:min(100%,22ch);color:var(--dim);overflow-wrap:anywhere}
.preason{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.pcount{font-size:10.5px;color:var(--muted);white-space:nowrap}
.cmdrow.pcmd{flex-basis:100%;margin-top:6px}
.cmdrow.pcmd .cmd{font-size:11px;padding:6px 10px;color:var(--teal2)}
.cmdrow.pcmd .btn.mini{font-size:10.5px;padding:0 10px}
.btn:focus-visible,.beyanlar>summary:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.fullband{margin:0 0 14px;padding:12px 16px;border-radius:11px;background:var(--teald);border:1px solid rgba(45,212,191,.3);color:var(--teal2);font-size:13.5px;font-weight:600;letter-spacing:-.01em}
footer{font-family:var(--mono);font-size:10.5px;color:var(--muted);text-align:center;padding-top:8px;line-height:1.8}
@media(max-width:600px){.panel{padding:18px 16px}.krow .v{text-align:left}.krow{flex-direction:column;gap:2px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

const COPY_JS = `
function oceanKopyala(btn){
  var t=btn.getAttribute('data-cmd');
  if(!t||!navigator.clipboard){return}
  navigator.clipboard.writeText(t).then(function(){
    var eski=btn.textContent;btn.textContent='Copied';
    setTimeout(function(){btn.textContent=eski},1400);
  }).catch(function(){});
}
`;

/**
 * OceanState → pano.html tam sayfa metni. Saf ve deterministik:
 * aynı state + aynı goal → aynı HTML. fs yok, network yok, LLM yok.
 */
export function renderPano(state: OceanState, opts: PanoOptions = {}): string {
  const ledger = opts.ledger ?? BOS_LEDGER;
  const card: Card | undefined = state.card;
  const goal =
    opts.goalText !== undefined && opts.goalText !== null && opts.goalText.trim() !== ''
      ? `<p class="goal"><span class="k">Goal</span>${esc(opts.goalText.trim())}</p>`
      : '';
  const lastSync =
    state.lastSyncedAt !== undefined ? fmtTs(state.lastSyncedAt) : 'sync has not run yet';

  const cardHtml =
    card !== undefined
      ? renderCard(card, ledger, state.claims)
      : `<section class="panel hero"><span class="eyebrow">The single next move</span>
         <h2 class="fact">No card produced yet.</h2>
         <div class="action"><p class="verb">Run the sync.</p>${cmdBlock('topbeam sync')}</div></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#04060d">
<title>Topbeam — ${esc(state.projectName)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <span class="eyebrow">Topbeam — honest project board</span>
    <h1>${esc(state.projectName)}</h1>
    <p class="meta">last sync: ${esc(lastSync)} · topbeam v${esc(TOOL_VERSION)} · deterministic summary — no LLM</p>
    ${goal}
  </header>
  ${cardHtml}
  ${renderTeslim(state, ledger)}
  ${renderScope(state.scope)}
  ${renderLog(state.log, ledger, state.scope)}
  ${renderDefter(state.claims, ledger)}
  <footer>Topbeam shows the facts that carry evidence, and the gaps it knows about.<br>
  evidence levels: file evidence · test evidence · human approval · not verified<br>
  the human-approval badge rests on one thing only: a terminal-signed entry in the <span class="mono">.ocean/passport.jsonl</span> ledger</footer>
</main>
<script>${COPY_JS}</script>
</body>
</html>
`;
}
