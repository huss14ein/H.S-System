/**
 * Removes full-page `if (showBlockingLoader) return (...spinner...)` early exits from wealth pages.
 * Hydration feedback is handled globally in Layout via FinancialDataHydrateBanner.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'pages');
const EXEMPT = new Set([
  'LoginPage.tsx',
  'SignupPage.tsx',
  'PendingApprovalPage.tsx',
  'Installments.tsx',
  'SystemHealth.tsx',
  'FinancialJournal.tsx',
  'StatementHistoryView.tsx',
  'Notifications.tsx',
]);

const BLOCK_RE =
  /\n[ \t]*if\s*\(\s*showBlockingLoader\s*\)\s*\{\s*\n[\s\S]*?\n[ \t]*\}\s*\n(?=\s*return\s*\()/g;

let changed = 0;
for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx'))) {
  if (EXEMPT.has(file)) continue;
  const path = join(PAGES_DIR, file);
  const src = readFileSync(path, 'utf8');
  if (!src.includes('showBlockingLoader')) continue;
  const next = src.replace(BLOCK_RE, '\n');
  if (next !== src) {
    writeFileSync(path, next);
    changed += 1;
    console.log('stripped', file);
  }
}
console.log(`Done. Updated ${changed} file(s).`);
