import { describe, expect, it } from 'vitest';
import { computeMonthlyInvestmentPlanProgress } from '../services/monthlyInvestmentPlanProgress';
import type { FinancialData } from '../types';

describe('computeMonthlyInvestmentPlanProgress', () => {
  it('sums per-portfolio monthly budgets (not legacy root only)', () => {
    const data = {
      accounts: [{ id: 'a1', type: 'Investment', balance: 0, currency: 'SAR' }],
      investments: [
        { id: 'p1', name: 'A', accountId: 'a1', currency: 'SAR', holdings: [] },
        { id: 'p2', name: 'B', accountId: 'a1', currency: 'SAR', holdings: [] },
      ],
      investmentPlan: {
        monthlyBudget: 1000,
        budgetCurrency: 'SAR',
        plansByPortfolioId: {
          p1: { monthlyBudget: 3000, budgetCurrency: 'SAR' },
          p2: { monthlyBudget: 2000, budgetCurrency: 'SAR' },
        },
      },
      investmentTransactions: [],
    } as unknown as FinancialData;

    const p = computeMonthlyInvestmentPlanProgress(data, 3.75);
    expect(p.target).toBe(5000);
    expect(p.hasBudgetTarget).toBe(true);
  });
});
