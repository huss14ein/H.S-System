import { describe, expect, it } from 'vitest';
import { buildHouseholdEngineInputFromData } from '../services/householdBudgetEngine';

describe('household engine currency fallback', () => {
  it('converts USD transactions to SAR when financialData is missing but sarPerUsd is provided', () => {
    const txs = [
      { date: '2026-02-10', type: 'income', amount: 1000, accountId: 'acc-usd' }, // USD
      { date: '2026-02-11', type: 'expense', amount: 200, accountId: 'acc-usd' }, // USD
      { date: '2026-02-12', type: 'expense', amount: 300, accountId: 'acc-sar' }, // SAR
    ];
    const accounts = [
      { id: 'acc-usd', currency: 'USD', type: 'Checking', balance: 0 },
      { id: 'acc-sar', currency: 'SAR', type: 'Checking', balance: 0 },
    ];

    const input = buildHouseholdEngineInputFromData(txs, accounts, [], {
      year: 2026,
      expectedMonthlySalary: 0,
      adults: 2,
      kids: 0,
      profile: 'Moderate',
      sarPerUsd: 3.75,
      uiExchangeRate: 3.75,
      financialData: null,
    });

    // February index = 1
    expect(input.monthlyActualIncome[1]).toBeCloseTo(1000 * 3.75, 6);
    expect(input.monthlyActualExpense[1]).toBeCloseTo(200 * 3.75 + 300, 6);
  });
});

