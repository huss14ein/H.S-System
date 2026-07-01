/**
 * End-to-end guards: platform/portfolio week & month P/L — single engine, scoped cash/txs, UI wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computePortfolioPeriodPnLSummary, platformPeriodPnLFromSummary } from '../services/portfolioPeriodPnL';
import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('portfolio period P/L end-to-end', () => {
  it('wiring: Investments, Wealth Analytics, and engine share one scope + summary path', () => {
    expect(read('services/portfolioPeriodPnL.ts')).toContain('buildInvestmentAccountKpiScope');
    expect(read('pages/Investments.tsx')).toContain('buildInvestmentAccountKpiScope');
    expect(read('pages/Investments.tsx')).toContain('platformPeriodPnLFromSummary');
    expect(read('pages/Investments.tsx')).toContain('portfolioPnLSummary={portfolioPnL.summary}');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('computePortfolioPeriodPnLSummaryAsync');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain('computePortfolioPeriodPnLSummary');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('useLiveMark: false');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('resolvePortfolioPeriodPnLEndValueSar');
  });

  it('mixed-ownership account: managed deposit does not inflate personal week P/L', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
      id: 'p1',
      name: 'Personal',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAA.SR',
          quantity: 100,
          avgCost: 10,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const m1: InvestmentPortfolio = {
      id: 'm1',
      name: 'Managed',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h2',
          symbol: 'BBB.SR',
          quantity: 500,
          avgCost: 10,
          currentValue: 5000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'd-managed',
        accountId: 'acc-1',
        portfolioId: 'm1',
        type: 'deposit',
        date: '2026-05-24',
        total: 5000,
        currency: 'SAR',
      },
    ];
    const data = {
      accounts,
      investments: [p1, m1],
      investmentTransactions: txs,
      personalInvestments: [p1],
      personalAccounts: accounts,
    } as FinancialData;

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios: [p1],
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      monthStartDay: 1,
      getAvailableCashForAccount: () => ({ SAR: 5000, USD: 0 }),
      now: new Date(2026, 4, 25),
    });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].portfolioId).toBe('p1');
    expect(summary.rows[0].weekly.totalSar).toBeCloseTo(0, 0);
    expect(summary.rows[0].monthly.totalSar).toBeCloseTo(0, 0);

    const platform = platformPeriodPnLFromSummary(summary, 'acc-1');
    expect(platform.weekly.totalSar).toBeCloseTo(0, 0);
    expect(platform.monthly.totalSar).toBeCloseTo(0, 0);
  });

  it('platform rollup equals sum of sibling portfolio rows on the account', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
      id: 'p1',
      name: 'A',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAA.SR',
          quantity: 10,
          avgCost: 100,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const p2: InvestmentPortfolio = {
      id: 'p2',
      name: 'B',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h2',
          symbol: 'BBB.SR',
          quantity: 20,
          avgCost: 50,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const data = {
      accounts,
      investments: [p1, p2],
      investmentTransactions: [] as InvestmentTransaction[],
      personalInvestments: [p1, p2],
    } as FinancialData;

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios: [p1, p2],
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      monthStartDay: 1,
      now: new Date(2026, 4, 25),
    });

    const platform = platformPeriodPnLFromSummary(summary, 'acc-1');
    const sumWeekly = summary.rows.reduce((s, r) => s + r.weekly.totalSar, 0);
    const sumMonthly = summary.rows.reduce((s, r) => s + r.monthly.totalSar, 0);
    expect(platform.weekly.totalSar).toBeCloseTo(sumWeekly, 5);
    expect(platform.monthly.totalSar).toBeCloseTo(sumMonthly, 5);
  });
});
