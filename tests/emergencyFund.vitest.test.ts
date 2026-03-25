import { describe, expect, it } from 'vitest';
import { computeEmergencyFundMetrics } from '../hooks/useEmergencyFund';
import type { FinancialData } from '../types';

describe('computeEmergencyFundMetrics', () => {
  it('uses monthly-equivalent essential budgets when no essential transactions exist', () => {
    const now = new Date();
    const data = {
      accounts: [
        { id: 'a1', type: 'Checking', balance: 12_000 },
      ],
      budgets: [
        { category: 'Housing Rent', limit: 24_000, period: 'yearly', month: now.getMonth() + 1, year: now.getFullYear() },
      ],
      transactions: [],
      investments: [],
      liabilities: [],
      assets: [],
      commodityHoldings: [],
      goals: [],
      recurringTransactions: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const m = computeEmergencyFundMetrics(data);
    expect(m.monthlyCoreExpenses).toBeCloseTo(2000, 6);
    expect(m.monthsCovered).toBeCloseTo(6, 6);
  });
});

