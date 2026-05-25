/**
 * Guards that personal-wealth surfaces use the canonical metrics hook (not ad-hoc resolveSarPerUsd in pages).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'pages');

/** Auth / diagnostics — allowed to resolve FX locally or skip the hook. */
const PAGE_EXEMPT = new Set([
  'LoginPage.tsx',
  'SignupPage.tsx',
  'PendingApprovalPage.tsx',
  'SystemHealth.tsx',
]);

/** No personal headline NW / investment KPI strip — hook not required. */
const PAGE_NO_HEADLINE_METRICS = new Set([
  'Installments.tsx',
  'StatementHistoryView.tsx',
  'ExecutionHistoryView.tsx',
  'FinancialJournal.tsx',
  'SinkingFunds.tsx',
  'Notifications.tsx',
  /** Empty routing stubs — real UI lives in Transactions.tsx / Investments.tsx */
  'Cashflow.tsx',
  'Platforms.tsx',
  'TransactionsPage.tsx',
]);

function pageFiles(): string[] {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx'));
}

describe('canonical metrics surface coverage', () => {
  it('every wealth page imports useCanonicalFinancialMetrics', () => {
    const missing: string[] = [];
    for (const file of pageFiles()) {
      if (PAGE_EXEMPT.has(file) || PAGE_NO_HEADLINE_METRICS.has(file)) continue;
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (!src.includes('useCanonicalFinancialMetrics')) {
        missing.push(file);
      }
    }
    expect(missing, `Add useCanonicalFinancialMetrics() to: ${missing.join(', ')}`).toEqual([]);
  });

  it('wealth pages do not call resolveSarPerUsd directly', () => {
    const offenders: string[] = [];
    for (const file of pageFiles()) {
      if (PAGE_EXEMPT.has(file)) continue;
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (src.includes('resolveSarPerUsd')) {
        offenders.push(file);
      }
    }
    expect(offenders, `Use hook sarPerUsd instead of resolveSarPerUsd in: ${offenders.join(', ')}`).toEqual([]);
  });
});
