import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeWeeklyDigestPortfolioPnLSar } from '../services/portfolioPeriodPnLDigest';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('weekly digest portfolio P/L', () => {
  it('digest helper returns week and month totals', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Broker', type: 'Investment', balance: 1000, currency: 'SAR' }],
      investments: [
        {
          id: 'p1',
          name: 'Growth',
          accountId: 'a1',
          holdings: [{ symbol: 'AAPL', quantity: 10, avgCost: 100, assetClass: 'Equity' }],
        },
      ],
      transactions: [],
      assets: [],
      liabilities: [],
      goals: [],
      budgets: [],
    } as unknown as FinancialData;
    const r = computeWeeklyDigestPortfolioPnLSar({ data, sarPerUsd: 3.75, simulatedPrices: { AAPL: 110 } });
    expect(typeof r.weeklyTotalSar).toBe('number');
    expect(typeof r.monthlyTotalSar).toBe('number');
  });

  it('edge function imports portfolio P/L digest and fetches cost lots', () => {
    const edge = read('supabase/functions/send-weekly-digest/index.ts');
    expect(edge).toContain('computeWeeklyDigestPortfolioPnLSar');
    expect(edge).toContain('investment_cost_lots');
  });
});
