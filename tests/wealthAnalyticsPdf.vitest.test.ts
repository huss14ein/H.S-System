import { describe, expect, it } from 'vitest';
import {
  generateWealthExecutiveSummaryHtml,
  generateWealthMetricPassportHtml,
} from '../services/reportingEngine';
import { buildWealthAnalyticsReportModel } from '../services/wealthAnalyticsReportModel';
import type { FinancialData } from '../types';

const basePayload = {
  generatedAtIso: '2026-05-28T12:00:00.000Z',
  currency: 'SAR',
  netWorth: 500000,
  netWorthTrendPct: 1.2,
  monthlyIncome: 25000,
  monthlyExpenses: 18000,
  monthlyPnL: 7000,
  savingsRatePct: 28,
  debtToAssetRatioPct: 15,
  emergencyFundMonths: 5,
  emergencyFundTargetAmount: 120000,
  emergencyFundShortfall: 20000,
  liquidNetWorth: 200000,
  managedWealthTotal: 520000,
  riskLane: 'Balanced',
  liquidityRunwayMonths: 7,
  disciplineScore: 78,
  investmentStyle: 'Balanced',
  householdStressLabel: 'low',
  householdStressPressureMonths: 1,
  shockDrillSeverity: 'Job loss',
  shockDrillEstimatedGap: -2000,
  holdings: [],
};

describe('wealth analytics PDF exports', () => {
  it('buildWealthAnalyticsReportModel aligns executive KPIs with snapshot payload', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 50000, currency: 'SAR' }],
      investments: [],
      investmentTransactions: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const model = buildWealthAnalyticsReportModel({
      wealthSummaryPayload: basePayload,
      headline: { netWorth: 500000, buckets: { cash: 50000, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0 }, sarPerUsd: 3.75 },
      kpiSnapshot: {
        netWorth: 500000,
        monthlyPnL: 7000,
        budgetVariance: 500,
        roi: 0.08,
        netWorthTrend: 1.2,
        pnlTrend: 0,
        liquidCashSar: 50000,
        avgMonthlyIncomeSar6Mo: 24000,
        investmentCapitalSource: 'ledger_inferred',
      },
      emergencyFund: {
        emergencyCash: 50000,
        monthlyCoreExpenses: 10000,
        monthsCovered: 5,
        targetMonths: 6,
        status: 'adequate',
        shortfall: 10000,
        targetAmount: 60000,
        emergencyFundCoverage: 0.83,
        hasEssentialExpenseEstimate: true,
      },
      data,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      investmentsTotalSar: 0,
      quotesAsOfIso: '2026-05-28T11:55:00.000Z',
      quotesLive: true,
    });

    expect(model.base.netWorth).toBe(500000);
    expect(model.executiveKpis.find((k) => k.key === 'netWorth')?.numericValue).toBe(500000);
    expect(model.quotesAsOfIso).toBe('2026-05-28T11:55:00.000Z');
  });

  it('executive summary HTML includes KPI grid and quote timestamp', () => {
    const data = { accounts: [], investments: [], investmentTransactions: [], transactions: [], budgets: [] } as FinancialData;
    const model = buildWealthAnalyticsReportModel({
      wealthSummaryPayload: basePayload,
      headline: { netWorth: 500000, buckets: { cash: 0, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0 }, sarPerUsd: 3.75 },
      kpiSnapshot: null,
      emergencyFund: {
        emergencyCash: 0,
        monthlyCoreExpenses: 0,
        monthsCovered: 0,
        targetMonths: 6,
        status: 'critical',
        shortfall: 0,
        targetAmount: 0,
        emergencyFundCoverage: 0,
        hasEssentialExpenseEstimate: false,
      },
      data,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      investmentsTotalSar: 0,
      quotesAsOfIso: '2026-05-28T11:55:00.000Z',
      quotesLive: true,
    });
    const html = generateWealthExecutiveSummaryHtml(model);
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Headline KPIs');
    expect(html).toContain('Quotes as of');
    expect(html).toContain('500,000');
  });

  it('metric passport HTML renders A/B/C sections for each metric', () => {
    const data = { accounts: [], investments: [], investmentTransactions: [], transactions: [], budgets: [] } as FinancialData;
    const model = buildWealthAnalyticsReportModel({
      wealthSummaryPayload: basePayload,
      headline: { netWorth: 500000, buckets: { cash: 0, investments: 0, physicalAndCommodities: 0, receivables: 0, liabilities: 0 }, sarPerUsd: 3.75 },
      kpiSnapshot: { netWorth: 500000, monthlyPnL: 7000, budgetVariance: 0, roi: 0.1, netWorthTrend: 0, pnlTrend: 0, liquidCashSar: 0, avgMonthlyIncomeSar6Mo: 0, investmentCapitalSource: 'ledger_inferred' },
      emergencyFund: {
        emergencyCash: 0,
        monthlyCoreExpenses: 0,
        monthsCovered: 4,
        targetMonths: 6,
        status: 'low',
        shortfall: 0,
        targetAmount: 0,
        emergencyFundCoverage: 0,
        hasEssentialExpenseEstimate: false,
      },
      data,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      investmentsTotalSar: 100000,
      quotesLive: false,
    });

    for (const metric of ['netWorth', 'monthlyPnL', 'investmentRoi', 'budgetVariance', 'emergencyFund'] as const) {
      const html = generateWealthMetricPassportHtml(model, metric);
      expect(html).toContain('A — Current reading');
      expect(html).toContain('B — Trend series');
      expect(html).toContain('C — Definition');
    }
  });
});
