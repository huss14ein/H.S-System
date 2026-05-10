/**
 * Load `.env` / `.env.local` from the project root for local `npm run dev` + Netlify functions.
 * Netlify **deployed** functions already have Site → Environment variables in `process.env` before
 * this runs; `dotenv` does not override existing keys unless `.env.local` uses override (last wins for locals).
 *
 * Tries `process.cwd()` and paths derived from this file so functions still find `.env` if cwd differs.
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
