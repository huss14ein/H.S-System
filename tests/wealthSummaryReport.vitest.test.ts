import { describe, expect, it } from 'vitest';
import {
  exportPortfolioReview,
  generateMonthlyReport,
  generateWealthSummaryReportCsv,
  generateWealthSummaryReportHtml,
  generateWealthSummaryReportJson,
  type WealthSummaryReportInput,
} from '../services/reportingEngine';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import type { FinancialData } from '../types';

const sampleInput: WealthSummaryReportInput = {
  generatedAtIso: '2026-03-19T10:00:00.000Z',
  currency: 'SAR',
  netWorth: 100000,
  netWorthTrendPct: 2.5,
  monthlyIncome: 20000,
  monthlyExpenses: 12000,
  monthlyPnL: 8000,
  savingsRatePct: 40,
  debtToAssetRatioPct: 18,
  emergencyFundMonths: 6,
  emergencyFundTargetAmount: 60000,
  emergencyFundShortfall: 0,
  liquidNetWorth: 45000,
  managedWealthTotal: 120000,
  riskLane: 'Balanced',
  liquidityRunwayMonths: 8,
  disciplineScore: 84,
  investmentStyle: 'Balanced',
  householdStressLabel: 'low',
  householdStressPressureMonths: 1,
  shockDrillSeverity: 'Job loss',
  shockDrillEstimatedGap: -3500,
  holdings: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      quantity: 10,
      avgCost: 150,
      currentValue: 1800,
      gainLoss: 300,
      gainLossPct: 20,
      currency: 'USD',
      currentValueSar: 6750,
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft',
      quantity: 5,
      avgCost: 300,
      currentValue: 1700,
      gainLoss: 200,
      gainLossPct: 13.3,
      currency: 'USD',
      currentValueSar: 6375,
    },
  ],
  assets: [
    { name: 'Home', type: 'Property', value: 900000 },
  ],
  liabilities: [
    { name: 'Mortgage', type: 'Mortgage', amount: -350000, status: 'Active' },
  ],
};

describe('wealth summary report exports', () => {
  it('includes holdings array in JSON export', () => {
    const json = generateWealthSummaryReportJson(sampleInput);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('wealth_summary_report');
    expect(Array.isArray(parsed.holdings)).toBe(true);
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0].symbol).toBe('AAPL');
    expect(parsed.holdings[1].currentValueSar).toBe(6375);
  });

  it('includes summary and per-holding rows in CSV export', () => {
    const csv = generateWealthSummaryReportCsv(sampleInput);
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + summary + 2 holdings
    expect(csv).toContain('rowType');
    expect(csv).toContain('summary');
    expect(csv).toContain('holding');
    expect(csv).toContain('AAPL');
    expect(csv).toContain('MSFT');
  });

  it('renders holding details table in HTML export', () => {
    const html = generateWealthSummaryReportHtml(sampleInput);
    expect(html).toContain('Holding Details (Position by Position)');
    expect(html).toContain('Asset Details');
    expect(html).toContain('Liability Details');
    expect(html).toContain('<table>');
    expect(html).toContain('AAPL');
    expect(html).toContain('MSFT');
    expect(html).toContain('Current Value (SAR)');
  });

  it('respects section options in HTML export', () => {
    const html = generateWealthSummaryReportHtml(sampleInput, {
      includeSnapshot: true,
      includeCashflow: false,
      includeRisk: false,
      includeHoldings: false,
      includeAssets: true,
      includeLiabilities: false,
    });
    expect(html).toContain('Net Worth Snapshot');
    expect(html).not.toContain('Cashflow & Efficiency');
    expect(html).not.toContain('Resilience & Risk');
    expect(html).not.toContain('Holding Details (Position by Position)');
    expect(html).toContain('Asset Details');
    expect(html).not.toContain('Liability Details');
  });
});

describe('monthly report and portfolio review export', () => {
  it('includes net worth and cashflow fields in monthly JSON', () => {
    const json = generateMonthlyReport({
      periodLabel: '2026-03',
      netWorth: 50000,
      liquidNetWorth: 10000,
      monthlyIncome: 15000,
      monthlyExpenses: 12000,
      monthlyPnL: 3000,
      budgetVariance: 0,
      roi: 0,
    });
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('monthly_report');
    expect(parsed.period).toBe('2026-03');
    expect(parsed.netWorth).toBe(50000);
    expect(parsed.liquidNetWorth).toBe(10000);
    expect(parsed.monthlyIncome).toBe(15000);
    expect(parsed.monthlyExpenses).toBe(12000);
    expect(parsed.monthlyPnL).toBe(3000);
    expect(parsed.budgetVariance).toBe(0);
    expect(parsed.roi).toBe(0);
  });

  it('computeMonthlyReportFinancialKpis returns budget variance and roi', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = `${y}-${m}-15`;
    const data = {
      budgets: [{ category: 'Food', limit: 3000, period: 'monthly', month: now.getMonth() + 1, year: now.getFullYear() }],
      transactions: [{ date: d, type: 'expense', category: 'Food', amount: -1000 }],
      accounts: [{ id: 'a1', type: 'Checking', balance: 5000 }],
      investments: [],
      investmentTransactions: [],
      settings: {},
    } as unknown as FinancialData;
    const k = computeMonthlyReportFinancialKpis(data, 3.75, () => ({ SAR: 0, USD: 0 }));
    expect(k.budgetVariance).toBe(2000);
    expect(typeof k.roi).toBe('number');
  });

  it('includes non-zero plPct in portfolio review CSV', () => {
    const csv = exportPortfolioReview({
      positions: [
        {
          symbol: 'TEST',
          marketValue: 1100,
          avgCost: 100,
          plPct: 10,
          sleeve: 'Core',
        },
      ],
    });
    expect(csv).toContain('TEST');
    expect(csv).toContain('10');
  });
});
