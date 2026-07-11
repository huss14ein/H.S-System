/**
 * Spending model single compute path — pages defer to useSpendingCommandCenterModel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE_FILES = ['pages/Dashboard.tsx', 'pages/Analysis.tsx', 'pages/Budgets.tsx'] as const;

describe('spendingModelSinglePath', () => {
  it('primary spending pages use the shared hook, not inline computeExpenseBudgetAnalysisModel', () => {
    for (const page of PAGE_FILES) {
      const src = read(page);
      expect(src, page).toContain('useSpendingCommandCenterModel');
      expect(src, page).not.toContain('computeExpenseBudgetAnalysisModel');
    }
  });

  it('hook defers compute via idle work, period preset, and exposes model + ready', () => {
    const hook = read('hooks/useSpendingCommandCenterModel.ts');
    expect(hook).toContain('computeExpenseBudgetAnalysisModel');
    expect(hook).toContain('scheduleIdleWorkAsync');
    expect(hook).toContain('periodPreset');
    expect(hook).toMatch(/ready/);
    expect(hook).toMatch(/model/);
  });

  it('legacy useExpenseBudgetAnalysisModel remains idle-deferred (pages use command center hook)', () => {
    const legacy = read('hooks/useExpenseBudgetAnalysisModel.ts');
    expect(legacy).toContain('computeExpenseBudgetAnalysisModel');
    expect(legacy).toContain('scheduleIdleWorkAsync');
    for (const page of PAGE_FILES) {
      expect(read(page)).not.toContain('useExpenseBudgetAnalysisModel');
    }
  });
});
