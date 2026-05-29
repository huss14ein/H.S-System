import { describe, expect, it } from 'vitest';
import { buildBudgetMonthOpenHints } from '../services/budgetMonthOpenAssistant';
import type { FinancialData } from '../types';

describe('budgetMonthOpenAssistant', () => {
  it('suggests copy-last-month when no rows exist in first days of month', () => {
    const ref = new Date(2026, 4, 3);
    const data = {
      settings: { monthStartDay: 1 },
      budgets: [],
      transactions: [{ type: 'expense', date: '2026-05-02', amount: 100, category: 'Food', budgetCategory: 'Food' }],
    } as unknown as FinancialData;
    const hints = buildBudgetMonthOpenHints({
      data,
      currentViewKey: { year: 2026, month: 5 },
      budgetDrift: [],
      budgets: [],
      ref,
    });
    expect(hints.some((h) => h.action === 'copy-last-month')).toBe(true);
  });

  it('returns empty outside first week of financial month', () => {
    const ref = new Date(2026, 4, 20);
    const data = { settings: { monthStartDay: 1 }, budgets: [], transactions: [] } as unknown as FinancialData;
    const hints = buildBudgetMonthOpenHints({
      data,
      currentViewKey: { year: 2026, month: 5 },
      budgetDrift: [],
      budgets: [],
      ref,
    });
    expect(hints).toEqual([]);
  });
});
