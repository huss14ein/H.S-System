import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveBudgetCategoryHeadroom,
  shouldWarnBudgetOverspend,
  statusFromAnnualAwareUtilization,
} from '../services/budgetOverspendGate';
import type { Budget } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('budgetOverspendGate', () => {
  const finKey = { year: 2026, month: 3 };
  const rentYearly: Budget = {
    id: 'b1',
    category: 'Housing Rent',
    limit: 12000,
    period: 'yearly',
    month: 1,
    year: 2026,
  } as Budget;

  it('does not warn when a lumpy rent month exceeds monthly-eq but YTD is within yearly plan', () => {
    // Two 6k payments/year → one month looks like 6× monthly-eq (1000) but annual OK.
    const headroom = resolveBudgetCategoryHeadroom({
      category: 'Housing Rent',
      finKey,
      monthStartDay: 1,
      budgets: [rentYearly],
      monthSpentSar: 6000,
      ytdSpentSar: 6000,
      upcomingSar: 0,
    });
    expect(headroom.mode).toBe('annual');
    expect(headroom.limitSar).toBe(12000);
    expect(headroom.annualUtilizationPct).toBeCloseTo(50, 5);
    expect(headroom.lumpyMonthWithinAnnual).toBe(true);
    expect(shouldWarnBudgetOverspend(headroom)).toBe(false);
    expect(statusFromAnnualAwareUtilization(headroom.annualUtilizationPct, true)).toBe('healthy');
  });

  it('warns when YTD would exceed the yearly plan', () => {
    const headroom = resolveBudgetCategoryHeadroom({
      category: 'Housing Rent',
      finKey,
      monthStartDay: 1,
      budgets: [rentYearly],
      monthSpentSar: 6000,
      ytdSpentSar: 12000,
      upcomingSar: 100,
    });
    expect(shouldWarnBudgetOverspend(headroom)).toBe(true);
    expect(statusFromAnnualAwareUtilization(headroom.annualUtilizationPct, true)).toBe('over');
  });

  it('wires Transactions + expense model + confirm suppress through the gate', () => {
    const tx = read('pages/Transactions.tsx');
    expect(tx).toContain('resolveBudgetCategoryHeadroom');
    expect(tx).toContain('suppressBudgetOverWarn');
    expect(tx).toContain('suppressOverWarn');
    expect(read('services/expenseBudgetAnalysisModel.ts')).toContain('statusFromAnnualAwareUtilization');
    expect(read('services/transactionBudgetCoverage.ts')).toContain('suppressOverWarn');
  });
});
