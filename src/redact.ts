/**
 * Tek-geçiş maskeleme filtresi (BuildPassport core/redact.ts deseni — birebir).
 * Diske giden HER metin buradan geçer: state.json + passport.jsonl + pano.html
 * yazan katman (state.ts) bypass'sız kullanır. Claim.evidence.ref ve komut
 * metinleri secret içerebilir — önceki ajanların açık görevi burada kapanır.
 *
 * Tasarım notu: false-negative (kaçan secret) false-positive'den (fazla
 * maskelenen metin) daha kötüdür — desenler agresif.
 */

interface Pattern {
  name: string;
  re: RegExp;
  /** Maske üretici — eşleşmenin tanınabilir küçük bir önekini bırakır. */
  mask?: (match: string) => string;
}

function defaultMask(match: string): string {
  const head = match.slice(0, 4);
  return `${head}***[MASKED]`;
}

const PATTERNS: Pattern[] = [
  // Private key blokları — tamamı gider
  {
    name: 'private-key-block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    mask: () => '[MASKED PRIVATE KEY BLOCK]',
  },
  // AWS access key id
  { name: 'aws-access-key', re: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g },
  // GitHub token'ları
  { name: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // Stripe
  { name: 'stripe-key', re: /\b[sprk]k_(live|test)_[A-Za-z0-9]{10,}\b/g },
  // Slack
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // OpenAI / Anthropic tarzı
  { name: 'sk-token', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  // Google API key + OAuth
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35,}/g },
  { name: 'google-oauth', re: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  // SendGrid
  { name: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  // npm token
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  // Twilio account SID + Mailgun
  { name: 'twilio-sid', re: /\bAC[0-9a-f]{32}\b/g },
  { name: 'mailgun', re: /\bkey-[0-9a-f]{32}\b/g },
  // JWT
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  // URL içinde kimlik bilgisi: scheme://user:pass@host — SON '@'a kadar maske
  {
    name: 'url-credentials',
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s@]+)?@(?=[^\s/@]+)/gi,
    mask: (m) => {
      const schemeEnd = m.indexOf('://') + 3;
      return `${m.slice(0, schemeEnd)}***[MASKED]@`;
    },
  },
  // Authorization: Bearer / Basic başlıkları
  {
    name: 'auth-header',
    re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g,
    mask: (m) => `${m.split(/\s+/)[0]} ***[MASKED]`,
  },
  // KEY=value / KEY: value çiftleri — isim secret'ı ima ediyorsa değer maskelenir
  {
    name: 'secretish-assignment',
    // Değer sınıfında `*` ve `[` yok → maske çıktısı tekrar eşleşmez (idempotentlik).
    // BP'den fark: önek OPSİYONEL (bare `API_KEY=` / `TOKEN=` de yakalanır) + case-insensitive.
    re: /\b((?:[A-Za-z_][A-Za-z0-9_]*?)?(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|APIKEY|PRIVATE_?KEY|CREDENTIALS?|AUTH)[A-Za-z0-9_]*)\s*[:=]\s*("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"';,*[\]]{4,})/gi,
    mask: (m) => {
      const sep = m.search(/[:=]/);
      return `${m.slice(0, sep + 1)}***[MASKED]`;
    },
  },
];

export interface RedactResult {
  text: string;
  /** Kaç parça maskelendi — şeffaflık: çıktı "N parça gizlendi" diyebilir. */
  hits: number;
  /** Hangi desenler tetiklendi (secret DEĞİL, desen adı). */
  patternNames: string[];
}

/** Tek-geçiş maskeleme. Idempotent: redact(redact(x).text) yeni hit üretmez. */
export function redact(input: string): RedactResult {
  let text = input;
  let hits = 0;
  const patternNames: string[] = [];
  for (const p of PATTERNS) {
    text = text.replace(p.re, (m) => {
      hits++;
      if (!patternNames.includes(p.name)) patternNames.push(p.name);
      return (p.mask ?? defaultMask)(m);
    });
  }
  return { text, hits, patternNames };
}

/**
 * Derin maskeleme: nesne/dizi içindeki HER string değeri maskeler.
 * JSON.stringify öncesi uygulanır — serileştirilmiş metin üzerinde regex
 * koşturmaktan güvenlidir (JSON yapısını bozma riski sıfır).
 */
export function redactDeep<T>(value: T): { value: T; hits: number } {
  let hits = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redact(v);
      hits += r.hits;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, hits };
}
