import { describe, it, expect } from 'vitest';
import {
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
  computeTodayBalanceSheetSnapshotSar,
} from '../services/personalNetWorth';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import {
  buildInvestableCashBarsFromInvestmentAccounts,
  sumTradableCashSarFromInvestmentAccounts,
} from '../services/investmentCashLedger';
import type { FinancialData } from '../types';

describe('computePersonalHeadlineNetWorthSar', () => {
  it('matches breakdown net worth for the same FX and options', () => {
    const data = {
      accounts: [
        { id: 'a1', name: 'Chk', type: 'Checking', balance: 1000, currency: 'SAR' },
      ],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = () => ({ SAR: 0, USD: 0 });
    const h = computePersonalHeadlineNetWorthSar(data, fx, { getAvailableCashForAccount: getCash });
    const b = computePersonalNetWorthBreakdownSAR(data, fx, { getAvailableCashForAccount: getCash });
    expect(h.netWorth).toBe(b.netWorth);
    expect(h.buckets.netWorth).toBe(h.netWorth);
  });
});

describe('computeTodayBalanceSheetSnapshotSar', () => {
  it('reconciles assets, debt, and buckets to the same net worth', () => {
    const data = {
      accounts: [
        { id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' },
        { id: 'inv', name: 'Broker', type: 'Investment', balance: 2000, currency: 'SAR' },
      ],
      assets: [{ id: 'p1', name: 'Gold', type: 'Physical', value: 3000 }],
      liabilities: [{ id: 'l1', name: 'Loan', amount: -1000, status: 'Active' }],
      commodityHoldings: [],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 2000, USD: 0 } : { SAR: 0, USD: 0 });
    const snap = computeTodayBalanceSheetSnapshotSar(data, fx, {
      getAvailableCashForAccount: getCash,
      simulatedPrices: {},
    });
    expect(snap.netWorth).toBeCloseTo(snap.assetsSar - snap.totalDebtSar, 6);
    expect(snap.cashSar + snap.investmentsSar + snap.physicalAndCommoditiesSar + snap.receivablesSar - snap.totalDebtSar).toBeCloseTo(
      snap.netWorth,
      6,
    );
  });

  it('matches Dashboard KPI net worth and headline buckets (single source of truth)', () => {
    const data = {
      accounts: [
        { id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' },
        { id: 'inv', name: 'Broker', type: 'Investment', balance: 2000, currency: 'SAR' },
      ],
      assets: [{ id: 'p1', name: 'Gold', type: 'Physical', value: 3000 }],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'PF',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [{ symbol: '2222', name: 'SABIC', quantity: 10, avgCost: 80, currentValue: 900 }],
        },
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 2000, USD: 0 } : { SAR: 0, USD: 0 });
    const opts = { getAvailableCashForAccount: getCash, simulatedPrices: { '2222': { price: 95 } } };
    const headline = computePersonalHeadlineNetWorthSar(data, fx, opts);
    const snap = computeTodayBalanceSheetSnapshotSar(data, fx, opts);
    const kpi = computeDashboardKpiSnapshot(data, fx, getCash, opts.simulatedPrices);
    expect(kpi).not.toBeNull();
    expect(kpi!.netWorth).toBe(headline.netWorth);
    expect(snap.netWorth).toBe(headline.netWorth);
    expect(snap.investmentsSar).toBe(headline.buckets.investments);
    expect(snap.cashSar).toBe(headline.buckets.cash);
  });

  it('investable cash bars total matches canonical platform cash sum', () => {
    const accounts = [
      { id: 'a', name: 'Al-Riyadh', type: 'Investment', balance: 1000, currency: 'SAR' },
      { id: 'b', name: 'Awaed', type: 'Investment', balance: 200, currency: 'USD' },
    ] as unknown as FinancialData['accounts'];
    const fx = 3.75;
    const bars = buildInvestableCashBarsFromInvestmentAccounts(accounts!, accounts!, fx);
    const barTotal = bars.reduce((s, r) => s + r.sar, 0);
    expect(barTotal).toBeCloseTo(sumTradableCashSarFromInvestmentAccounts(accounts!, accounts!, fx), 6);
  });
});
