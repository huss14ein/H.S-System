import { describe, it, expect } from 'vitest';
import { financialDataHasHydrated } from '../services/financialDataHydration';
import type { FinancialData } from '../types';

const emptyShell = {
  accounts: [],
  transactions: [],
  investments: [],
  goals: [],
  budgets: [],
  liabilities: [],
  assets: [],
  commodityHoldings: [],
} as unknown as FinancialData;

describe('financialDataHasHydrated', () => {
  it('is false for empty initial shell', () => {
    expect(financialDataHasHydrated(emptyShell)).toBe(false);
  });

  it('is true when accounts exist', () => {
    expect(
      financialDataHasHydrated({
        ...emptyShell,
        accounts: [{ id: 'a1', name: 'Bank', type: 'Bank', currency: 'SAR', balance: 0 } as FinancialData['accounts'][0]],
      } as FinancialData),
    ).toBe(true);
  });

  it('is true when only transactions exist (edge: no accounts yet)', () => {
    expect(
      financialDataHasHydrated({
        ...emptyShell,
        transactions: [
          {
            id: 't1',
            date: '2026-01-01',
            description: 'x',
            amount: 1,
            type: 'Expense',
            category: 'Food',
            accountId: 'a1',
          } as FinancialData['transactions'][0],
        ],
      } as FinancialData),
    ).toBe(true);
  });
});
