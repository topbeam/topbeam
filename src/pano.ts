/**
 * Pano render — .ocean/pano.html TEK statik dosya (saf fonksiyon, fs yok).
 *
 * Görsel dil: Keşif raporundaki Ocean token seti birebir (koyu zemin merdiveni,
 * teal aksan, mono-uppercase etiket imzası, sistem fontlar — gömülü font YOK).
 *
 * DÜRÜSTLÜK (yapısal):
 * - EN BASKIN öğe = sıradaki-tek-hareket kartı (GPT spec 6 alan + "Doğrulamayı
 *   başlat" kutusu: kopyalanabilir `ocean verify <id>` komutu).
 * - Yüzde-progress-bar YOK; pasaport "3/7 doğrulandı" dürüst sayımla verilir.
 * - Kanıt satırı yoksa "kayıt yok" — sakin gri, kırmızı alarm değil.
 * - Motivasyon sözü yok; beyan satırları "beyan" rozetiyle işaretli VE
 *   varsayılan olarak KATLI: kanıt üstte ve açık, beyan altta ve kapalı
 *   (beyan kanıt değildir → görünürlüğü de kanıtla eşit olamaz).
 * - Tüm dinamik metin HTML-escape edilir; tek JS: kopyala butonu (opsiyonel,
 *   JS'siz de komut metni seçilip kopyalanabilir).
 */
import {
  CARD_PRIMARY_BUTTON_TR,
  TOOL_VERSION,
  isPassportFull,
  type Card,
  type EvidenceLevel,
  type LogEntry,
  type LogSource,
  type OceanState,
} from './types.ts';

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
  'dosya-kaniti': { cls: 'ev-file', label: 'dosya-kanıtı' },
  'test-kaniti': { cls: 'ev-test', label: 'test-kanıtı' },
  'insan-onayi': { cls: 'ev-human', label: 'insan-onayı' },
  dogrulanmadi: { cls: 'ev-none', label: 'doğrulanmadı' },
};

const SOURCE_PILL: Record<LogSource, { cls: string; label: string }> = {
  git: { cls: 'ev-file', label: 'git' },
  test: { cls: 'ev-test', label: 'test' },
  'claude-beyan': { cls: 'ev-none', label: 'beyan' },
  insan: { cls: 'ev-human', label: 'insan' },
  ocean: { cls: 'ev-ocean', label: 'ocean' },
};

function levelPill(level: EvidenceLevel): string {
  const p = LEVEL_PILL[level];
  return `<span class="pill ${p.cls}">${p.label}</span>`;
}

// ── bölüm render'ları ────────────────────────────────────────────────────────

function cmdBlock(command: string): string {
  const c = esc(command);
  return (
    `<div class="cmdrow"><code class="cmd" data-cmd="${c}">${c}</code>` +
    `<button class="btn mini" type="button" data-cmd="${c}" onclick="oceanKopyala(this)">Kopyala</button></div>`
  );
}

function renderCard(card: Card): string {
  const ev = card.evidence;
  const row = (k: string, v: string | null): string =>
    `<div class="krow"><span class="k">${k}</span><span class="v${v === null ? ' none' : ''}">${
      v === null ? 'kayıt yok' : esc(v)
    }</span></div>`;

  const isClaimCard = card.id !== 'kart-bos' && card.id !== 'kart-tam';
  const verifyBox = isClaimCard
    ? `<div class="verifybox">
        <span class="eyebrow">${esc(CARD_PRIMARY_BUTTON_TR)}</span>
        <p class="hint">Pano statik — komutu terminalde çalıştır:</p>
        ${cmdBlock(`ocean verify ${card.id}`)}
      </div>`
    : '';

  return `<section class="panel hero" aria-label="Sıradaki tek hareket">
    <div class="heroTop">
      <span class="eyebrow">Sıradaki tek hareket</span>
      ${levelPill(card.factLevel)}
    </div>
    <h2 class="fact">${esc(card.fact)}</h2>
    <div class="evrows">
      ${row('Git diff', ev.gitDiff)}
      ${row('Test çıktısı', ev.testOutput)}
      ${row('İnsan onayı', ev.humanApproval)}
    </div>
    <div class="unknown"><span class="k">Eksik / belirsiz</span><p>${esc(card.unknown)}</p></div>
    <div class="action">
      <span class="eyebrow">Hareket</span>
      <p class="verb">${esc(card.action.verb)}</p>
      ${card.action.command !== undefined ? cmdBlock(card.action.command) : ''}
      <p class="why"><span class="k">Neden bu?</span> ${esc(card.why)}</p>
      <p class="done"><span class="k">Bitti sayılması için</span> ${esc(card.doneWhen)}</p>
    </div>
    ${verifyBox}
    <p class="stamp">Kart güncellendi: <span class="mono">${esc(fmtTs(card.updatedAt))}</span></p>
  </section>`;
}

const LOG_SHOWN_MAX = 100;

function logItems(entries: readonly LogEntry[]): string {
  return entries
    .map((e) => {
      const p = SOURCE_PILL[e.source];
      return `<li><span class="ts mono">${esc(fmtTs(e.ts))}</span><span class="pill ${p.cls}">${p.label}</span><span class="txt">${esc(e.text)}</span></li>`;
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
function renderLog(log: readonly LogEntry[]): string {
  const total = log.length;
  const ters = [...log].reverse(); // en yeni üstte
  const kanit = ters.filter((e) => e.source !== 'claude-beyan');
  const beyan = ters.filter((e) => e.source === 'claude-beyan');

  const kanitShown = kanit.slice(0, LOG_SHOWN_MAX);
  const beyanShown = beyan.slice(0, LOG_SHOWN_MAX);

  const capNote = (gosterilen: number, tumu: number, ad: string): string =>
    tumu > gosterilen ? `<p class="capnote">Son ${gosterilen} ${ad} satırı gösteriliyor (toplam ${tumu}).</p>` : '';

  const empty =
    total === 0 ? '<p class="empty">Henüz log kaydı yok — <span class="mono">ocean sync</span> sonrası dolar.</p>' : '';
  const kanitBos =
    total > 0 && kanit.length === 0
      ? '<p class="empty">Kanıt taşıyan satır yok — aşağıdaki beyanlar Claude\'un kendi ifadeleridir, kanıt değildir.</p>'
      : '';
  const beyanBlok =
    beyan.length > 0
      ? `<details class="beyanlar">
      <summary><span class="pill ev-none">beyan</span> Claude'un beyanları (${beyan.length}) — kanıt değil, katlı</summary>
      <ul class="timeline">${logItems(beyanShown)}</ul>
      ${capNote(beyanShown.length, beyan.length, 'beyan')}
    </details>`
      : '';

  return `<section class="panel" aria-label="Log history">
    <div class="sechead"><span class="eyebrow">Log history</span><span class="count mono">${kanit.length} kanıt · ${beyan.length} beyan</span></div>
    ${empty}
    ${kanitBos}
    <ul class="timeline">${logItems(kanitShown)}</ul>
    ${capNote(kanitShown.length, kanit.length, 'kanıt')}
    ${beyanBlok}
  </section>`;
}

function renderPassport(state: OceanState): string {
  const items = state.passport;
  const verified = items.filter((i) => i.status === 'completed' && i.level === 'insan-onayi').length;
  const full = isPassportFull(items);
  const band = full
    ? `<div class="fullband">Ürün geliştirildi 🎉 — pasaporttaki tüm maddeler insan onaylı.</div>`
    : '';
  const rows = items
    .map((i) => {
      const done = i.status === 'completed' && i.level === 'insan-onayi';
      // İş birimi = insanın tek seferde onaylayabileceği öbek → komutu görünür
      // olsun ki FULL-TİK erişilebilir kalsın (kayıt sayısı da dürüstçe yazar).
      const adet = i.claimIds.length > 1 ? `<span class="pcount mono">${i.claimIds.length} kayıt</span>` : '';
      const cmd = done ? '' : `<code class="pid mono">ocean verify ${esc(i.id)}</code>`;
      const reason = i.reason !== undefined ? `<span class="preason">${esc(i.reason)}</span>` : '';
      return `<li class="pitem"><span class="tick ${done ? 'on' : ''}">${done ? '✓' : '○'}</span><span class="ptitle">${esc(i.title)}${reason}</span>${adet}${levelPill(i.level)}${cmd}</li>`;
    })
    .join('\n');
  const empty =
    items.length === 0
      ? '<p class="empty">Pasaport henüz boş — claim üretildikçe maddeler buraya dolar.</p>'
      : '';
  return `<section class="panel" aria-label="Pasaport">
    <div class="sechead"><span class="eyebrow">Pasaport</span><span class="count mono">${verified}/${items.length} doğrulandı</span></div>
    ${band}
    ${empty}
    <ul class="plist">${rows}</ul>
  </section>`;
}

// ── tam sayfa ────────────────────────────────────────────────────────────────

export interface PanoOptions {
  /** goal.md'den okunan güncel hedef satırı (beyan — Claude/kullanıcı yazar). */
  goalText?: string | null;
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
.pill{font-family:var(--mono);font-size:9px;letter-spacing:.09em;text-transform:uppercase;padding:3px 7px;border-radius:6px;font-weight:500;white-space:nowrap}
.ev-test{color:var(--ok);background:rgba(52,211,153,.13)}
.ev-file{color:var(--info);background:rgba(56,189,248,.12)}
.ev-human{color:var(--teal2);background:var(--teald)}
.ev-none{color:var(--plan);background:rgba(135,144,160,.14)}
.ev-ocean{color:var(--violet);background:rgba(167,139,250,.13)}
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
.beyanlar{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
.beyanlar>summary{cursor:pointer;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;list-style:none;padding:4px 0}
.beyanlar>summary::-webkit-details-marker{display:none}
.beyanlar>summary::after{content:'göster';font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--plan);margin-left:auto}
.beyanlar[open]>summary::after{content:'gizle'}
.beyanlar>summary:hover{color:var(--dim)}
.plist{list-style:none}
.pitem{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--line);padding:10px 0;font-size:13px;flex-wrap:wrap}
.pitem:last-child{border-bottom:none}
.tick{font-family:var(--mono);color:var(--plan);width:18px;flex:none;text-align:center}
.tick.on{color:var(--ok)}
.ptitle{flex:1;min-width:min(100%,22ch);color:var(--dim);overflow-wrap:anywhere}
.preason{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.pcount{font-size:10.5px;color:var(--muted);white-space:nowrap}
.pid{font-size:11px;color:var(--teal2);background:var(--s3);border:1px solid var(--line2);border-radius:7px;padding:3px 8px;white-space:nowrap;user-select:all}
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
    var eski=btn.textContent;btn.textContent='Kopyalandı';
    setTimeout(function(){btn.textContent=eski},1400);
  }).catch(function(){});
}
`;

/**
 * OceanState → pano.html tam sayfa metni. Saf ve deterministik:
 * aynı state + aynı goal → aynı HTML. fs yok, network yok, LLM yok.
 */
export function renderPano(state: OceanState, opts: PanoOptions = {}): string {
  const card: Card | undefined = state.card;
  const goal =
    opts.goalText !== undefined && opts.goalText !== null && opts.goalText.trim() !== ''
      ? `<p class="goal"><span class="k">Hedef</span>${esc(opts.goalText.trim())}</p>`
      : '';
  const lastSync =
    state.lastSyncedAt !== undefined ? fmtTs(state.lastSyncedAt) : 'henüz senkron koşmadı';

  const cardHtml =
    card !== undefined
      ? renderCard(card)
      : `<section class="panel hero"><span class="eyebrow">Sıradaki tek hareket</span>
         <h2 class="fact">Henüz kart üretilmedi.</h2>
         <div class="action"><p class="verb">Senkronu çalıştır.</p>${cmdBlock('ocean sync')}</div></section>`;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#04060d">
<title>Ocean — ${esc(state.projectName)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <span class="eyebrow">Ocean — dürüst proje panosu</span>
    <h1>${esc(state.projectName)}</h1>
    <p class="meta">son senkron: ${esc(lastSync)} · ocean v${esc(TOOL_VERSION)} · deterministik özet — LLM yok</p>
    ${goal}
  </header>
  ${cardHtml}
  ${renderLog(state.log)}
  ${renderPassport(state)}
  <footer>Ocean yalnız kanıtlı gerçekleri ve açık belirsizlikleri gösterir.<br>
  kanıt seviyeleri: dosya-kanıtı · test-kanıtı · insan-onayı · doğrulanmadı</footer>
</main>
<script>${COPY_JS}</script>
</body>
</html>
`;
}
