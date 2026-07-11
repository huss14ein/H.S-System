import { describe, it, expect } from 'vitest';
import {
  buildExtendedNetWorthSnapshot,
  buildNetWorthSnapshotFromHeadline,
  captureNetWorthSnapshotFromHeadline,
} from '../services/netWorthSnapshotExtended';
import {
  computePersonalHeadlineNetWorthSar,
  computeTodayBalanceSheetSnapshotSar,
} from '../services/personalNetWorth';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import { bucketSumMatchesNetWorth } from '../services/netWorthReconciliation';
import { NW_BUCKETS_SCHEMA_V2 } from '../services/netWorthSnapshot';
import type { FinancialData } from '../types';

describe('buildExtendedNetWorthSnapshot', () => {
  const data = {
    accounts: [
      { id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' },
      { id: 'inv', name: 'Broker', type: 'Investment', balance: 2000, currency: 'SAR' },
    ],
    assets: [
      { id: 'p1', name: 'Gold', type: 'Physical', value: 3000 },
    ],
    sukukPositions: [
      {
        id: 's1',
        name: 'Gov Sukuk',
        investmentAccountId: 'inv',
        currency: 'SAR',
        faceValue: 1500,
        outstandingPrincipal: 1500,
        issueDate: '2024-01-01',
        maturityDate: '2027-01-01',
        status: 'active',
      },
    ],
    liabilities: [{ id: 'l1', name: 'Loan', amount: -1000, status: 'Active' }],
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
  const simulatedPrices = { '2222': { price: 95 } };
  const opts = { getAvailableCashForAccount: getCash, simulatedPrices };

  it('matches headline NW, KPI, today snapshot, and wealth summary', () => {
    const { snap } = buildExtendedNetWorthSnapshot(data, fx, getCash, simulatedPrices);
    const headline = computePersonalHeadlineNetWorthSar(data, fx, opts);
    const today = computeTodayBalanceSheetSnapshotSar(data, fx, opts);
    const kpi = computeDashboardKpiSnapshot(data, fx, getCash, simulatedPrices);
    const wealth = computeWealthSummaryReportModel(data, fx, getCash, simulatedPrices);

    expect(snap.bucketsSchemaVersion).toBe(NW_BUCKETS_SCHEMA_V2);
    expect(snap.netWorth).toBe(headline.netWorth);
    expect(snap.netWorth).toBe(today.netWorth);
    expect(kpi?.netWorth).toBe(headline.netWorth);
    expect(wealth.financialMetricsWithEf.netWorth).toBe(headline.netWorth);

    expect(snap.buckets?.cash).toBe(headline.buckets.cash);
    expect(snap.buckets?.investments).toBe(headline.buckets.investments);
    expect(snap.buckets?.physicalAndCommodities).toBe(headline.buckets.physicalAndCommodities);
    expect(snap.buckets?.receivables).toBe(headline.buckets.receivables);
    expect(snap.buckets?.liabilities).toBe(headline.buckets.liabilities);
    expect(snap.buckets?.sukukSar).toBe(1500);

    const balance = bucketSumMatchesNetWorth(snap);
    expect(balance.matches).toBe(true);
    expect(balance.driftSar).toBeLessThan(1.5);
  });

  it('captureNetWorthSnapshotFromHeadline matches buildExtendedNetWorthSnapshot net worth', () => {
    const headline = computePersonalHeadlineNetWorthSar(data, fx, opts);
    const fromHeadline = buildNetWorthSnapshotFromHeadline(headline, data);
    const { snap } = buildExtendedNetWorthSnapshot(data, fx, getCash, simulatedPrices);
    expect(fromHeadline.netWorth).toBe(snap.netWorth);
    expect(fromHeadline.buckets).toEqual(snap.buckets);
    expect(captureNetWorthSnapshotFromHeadline(headline, data, null)?.netWorth).toBe(headline.netWorth);
  });
});
