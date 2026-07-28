/**
 * macOS bildirimi — osascript sarmalayıcı.
 *
 * Kurallar:
 * - Hata YUTULUR: bildirim süs, ürün akışını asla düşürmez (false döner).
 * - macOS dışı platformda hiç denenmez (false).
 * - Network yok, LLM yok; tek dış süreç: osascript (yalnız darwin).
 * - Test/otomasyon kaçışları: OCEAN_NO_NOTIFY=1 → hiç çalışmaz;
 *   OCEAN_NOTIFY_BIN → osascript yerine başka binary (test izolasyonu).
 */
import { execFile } from 'node:child_process';

export interface NotifyOptions {
  /** osascript yerine binary (test). Varsayılan: OCEAN_NOTIFY_BIN env ?? 'osascript'. */
  bin?: string;
  /** Platform (test). Varsayılan: process.platform. */
  platform?: string;
  timeoutMs?: number;
}

/** AppleScript string literal'i — çift tırnak ve ters bölü kaçışlı. */
function asString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Bildirim göster. true = komut hatasız bitti; false = gösterilemedi
 * (platform dışı / kapalı / binary yok / hata). ASLA fırlatmaz.
 */
export function notifyMac(title: string, message: string, opts: NotifyOptions = {}): Promise<boolean> {
  if (process.env.OCEAN_NO_NOTIFY === '1') return Promise.resolve(false);
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.resolve(false);
  const bin = opts.bin ?? process.env.OCEAN_NOTIFY_BIN ?? 'osascript';
  const script = `display notification ${asString(message)} with title ${asString(title)}`;
  return new Promise((done) => {
    try {
      execFile(
        bin,
        ['-e', script],
        { timeout: opts.timeoutMs ?? 5000, windowsHide: true },
        (err) => done(err === null),
      );
    } catch {
      done(false);
    }
  });
}
