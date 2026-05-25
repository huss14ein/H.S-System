import { describe, it, expect } from 'vitest';
import { buildBudgetCardVisualMetrics, spendingCapForBudgetView } from '../services/budgetCardMetrics';
import {
  annualEnvelopeLimitForCategory,
  dedupeBudgetRowsByFinancialMonthInYear,
} from '../services/budgetEnvelopeMath';
import { transactionDateInSpendWindow } from '../services/budgetSpendMath';
import { financialMonthRangeFromKey } from '../utils/financialMonth';
import type { Budget } from '../types';

describe('spendingCapForBudgetView', () => {
  it('Weekly view uses weekly cap for a monthly-period budget', () => {
    const cap = spendingCapForBudgetView('Weekly', 'monthly', 1200);
    expect(cap).toBeCloseTo(1200 / (52 / 12), 2);
  });

  it('Daily view uses daily cap for a monthly-period budget', () => {
    const cap = spendingCapForBudgetView('Daily', 'monthly', 3000);
    expect(cap).toBeCloseTo(3000 / (365 / 12), 2);
  });
});

describe('buildBudgetCardVisualMetrics weekly/daily accuracy', () => {
  it('dial % matches weekly spend vs weekly cap', () => {
    const weeklyCap = spendingCapForBudgetView('Weekly', 'monthly', 1200);
    const spent = weeklyCap * 0.5;
    const m = buildBudgetCardVisualMetrics({
      budgetView: 'Weekly',
      period: 'monthly',
      limit: 1200,
      spentPeriod: spent,
      spentYtd: spent,
      annualEnvelopeLimit: 0,
    });
    expect(m.percentage).toBeCloseTo(50, 1);
    expect(m.periodSpendCap).toBeCloseTo(weeklyCap, 2);
  });
});

describe('annualEnvelopeLimitForCategory dedupe', () => {
  const monthStartDay = 28;
  const year = 2026;
  const cat = 'Transportation';

  it('does not double-count duplicate rows stored on the same month index', () => {
    const rows: Budget[] = [
      { id: '1', category: cat, year, month: 4, limit: 600, period: 'monthly' } as Budget,
      { id: '2', category: cat, year, month: 4, limit: 800, period: 'monthly' } as Budget,
    ];
    const deduped = dedupeBudgetRowsByFinancialMonthInYear(rows, year, monthStartDay);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].limit).toBe(800);
    expect(annualEnvelopeLimitForCategory(cat, year, deduped, monthStartDay)).toBe(800 * 12);
  });
});

describe('transactionDateInSpendWindow', () => {
  it('includes boundary ISO dates in financial month (local calendar)', () => {
    const monthStartDay = 28;
    const { start, end } = financialMonthRangeFromKey({ year: 2026, month: 4 }, monthStartDay);
    const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    expect(transactionDateInSpendWindow(startIso, start, end)).toBe(true);
  });
});
