import { describe, it, expect } from 'vitest';
import { computeLiquidNetWorth } from '../services/liquidNetWorth';
import { computeLiquidityRunwayFromData } from '../services/liquidityRunwayEngine';
import type { FinancialData } from '../types';

describe('liquid metrics currency normalization', () => {
  it('normalizes USD cash + USD portfolio holdings to SAR in liquid net worth', () => {
    const data = {
      accounts: [
        { id: 'chk-usd', name: 'USD Checking', type: 'Checking', balance: 1000, currency: 'USD' },
        { id: 'inv-1', name: 'Broker', type: 'Investment', balance: 0, currency: 'USD' },
      ],
      investments: [
        {
          id: 'p1',
          name: 'US Portfolio',
          accountId: 'inv-1',
          currency: 'USD',
          holdings: [
            { id: 'h1', symbol: 'AAPL', quantity: 1, avgCost: 100, currentValue: 500, zakahClass: 'Zakatable', realizedPnL: 0 },
          ],
        },
      ],
      liabilities: [],
      assets: [],
      transactions: [],
      wealthUltraConfig: { fxRate: 3.75 },
    } as unknown as FinancialData;

    const result = computeLiquidNetWorth(data, {
      exchangeRate: 3.75,
      getAvailableCashForAccount: (id: string) => (id === 'inv-1' ? { SAR: 0, USD: 200 } : { SAR: 0, USD: 0 }),
    });

    // 1000 USD checking + 200 USD tradable cash + 500 USD holdings = 1700 USD => 6375 SAR
    expect(result.liquidCash).toBeCloseTo(4500, 2);
    expect(result.investmentsSAR).toBeCloseTo(1875, 2);
    expect(result.liquidNetWorth).toBeCloseTo(6375, 2);
  });

  it('computes liquidity runway using SAR-normalized cash and expenses', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const data = {
      accounts: [
        { id: 'chk-usd', name: 'USD Checking', type: 'Checking', balance: 1000, currency: 'USD' },
      ],
      transactions: [
        { id: 't1', date: iso, description: 'rent', amount: -500, type: 'expense', category: 'Housing', accountId: 'chk-usd' },
      ],
      wealthUltraConfig: { fxRate: 3.75 },
    } as unknown as FinancialData;

    const runway = computeLiquidityRunwayFromData(data, { exchangeRate: 3.75, getAvailableCashForAccount: () => ({ SAR: 0, USD: 0 }) });

    // 1000 USD cash / 500 USD monthly expenses => 2 months
    expect(runway).not.toBeNull();
    expect(runway!.monthsOfRunway).toBeCloseTo(2, 4);
    expect(runway!.status).toBe('critical');
  });
});
