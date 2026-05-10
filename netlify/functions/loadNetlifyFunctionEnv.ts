/**
 * Optional local overlay after Netlify Site env: `netlify env:pull` may mirror dashboard vars into `.env`.
 * Deployed functions already receive Site → Environment variables in `process.env`; dotenv does not override existing keys
 * unless `.env.local` uses override (last wins for locals).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function discoverRoots(): string[] {
  const roots = new Set<string>();
  roots.add(process.cwd());
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    roots.add(path.resolve(dir, '../..'));
  } catch {
    /* bundled without import.meta */
  }
  return [...roots];
}

export function loadNetlifyFunctionEnv(): void {
  for (const root of discoverRoots()) {
    const envPath = path.join(root, '.env');
    if (existsSync(envPath)) {
      config({ path: envPath });
    }
    const localPath = path.join(root, '.env.local');
    if (existsSync(localPath)) {
      config({ path: localPath, override: true });
    }
  }
}

loadNetlifyFunctionEnv();
