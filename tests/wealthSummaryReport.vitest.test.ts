import { describe, expect, it } from 'vitest';
import {
  generateWealthSummaryReportCsv,
  generateWealthSummaryReportHtml,
  generateWealthSummaryReportJson,
  type WealthSummaryReportInput,
} from '../services/reportingEngine';

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
    expect(html).toContain('<table>');
    expect(html).toContain('AAPL');
    expect(html).toContain('MSFT');
    expect(html).toContain('Current Value (SAR)');
  });
});
