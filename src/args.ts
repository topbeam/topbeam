/**
 * CLI argüman ayrıştırma — BuildPassport cli.ts parseArgs deseninin
 * test edilebilir modül hali. Bağımlılık yok, saf fonksiyon.
 */

export interface Args {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * argv (node/script sonrası dilim) → {cmd, positional, flags}.
 * `--anahtar deger` çifti; değer yoksa boolean true.
 * `--anahtar --digeri` durumunda ilki boolean kalır.
 * İlk öğe `--` ile başlıyorsa komut değildir (örn. `ocean --version`).
 */
export function parseArgs(argv: string[]): Args {
  const first = argv[0];
  const hasCmd = first !== undefined && !first.startsWith('--');
  const cmd = hasCmd ? first : 'help';
  const rest = hasCmd ? argv.slice(1) : argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}
