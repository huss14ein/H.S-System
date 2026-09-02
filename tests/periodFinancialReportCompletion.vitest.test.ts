/**
 * Period Financial Report — E2E completion.
 * Path: Settings / Wealth Analytics / Summary / Dashboard / Command palette →
 * openPeriodFinancialReportModal → buildPeriodFinancialReportModel (canonical engines) →
 * generatePeriodFinancialReportHtml → openHtmlForPrint.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePeriodReportWindow } from '../services/periodReportWindow';
import { buildPeriodFinancialReportModel } from '../services/periodFinancialReportModel';
import { generatePeriodFinancialReportHtml } from '../services/periodFinancialReportHtml';
import type { FinancialData } from '../types';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('periodFinancialReportCompletion', () => {
  it('window resolver supports FY, CY, YTD, 12M, custom + prior twin', () => {
    const ref = new Date(2026, 8, 2); // Sep 2, 2026
    const fy = resolvePeriodReportWindow({ ref, monthStartDay: 1, preset: 'financial_year' });
    expect(fy.finKeys[0]).toEqual({ year: 2026, month: 1 });
    expect(fy.priorWindow.finKeys.length).toBe(fy.finKeys.length);

    const cy = resolvePeriodReportWindow({ ref, monthStartDay: 1, preset: 'calendar_year' });
    expect(cy.periodLabel).toContain('Calendar year');
    expect(cy.priorWindow.start.getTime()).toBeLessThan(cy.start.getTime());

    const ytd = resolvePeriodReportWindow({ ref, monthStartDay: 1, preset: 'ytd' });
    expect(ytd.preset).toBe('ytd');

    const m12 = resolvePeriodReportWindow({ ref, monthStartDay: 1, preset: 'last_12m' });
    expect(m12.finKeys.length).toBe(12);

    const custom = resolvePeriodReportWindow({
      ref,
      monthStartDay: 1,
      preset: 'custom',
      customStart: '2026-01-01',
      customEnd: '2026-03-31',
    });
    expect(custom.periodLabel).toContain('Custom');
    expect(custom.priorWindow.end.getTime()).toBeLessThan(custom.start.getTime());
  });

  it('model builds all required sections from minimal fixture', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [
        { id: 'a1', name: 'Checking', type: 'Checking', balance: 10000, currency: 'SAR' },
        { id: 'inv1', name: 'Broker', type: 'Investment', balance: 500, currency: 'SAR' },
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-02-10',
          description: 'Salary',
          amount: 15000,
          category: 'Salary',
          accountId: 'a1',
          type: 'income',
          status: 'Approved',
        },
        {
          id: 't2',
          date: '2026-02-12',
          description: 'Groceries',
          amount: 800,
          category: 'Food',
          budgetCategory: 'Food',
          accountId: 'a1',
          type: 'expense',
          status: 'Approved',
        },
      ],
      budgets: [{ id: 'b1', category: 'Food', amount: 2000, period: 'Monthly' }],
      investments: [
        {
          id: 'p1',
          name: 'Core',
          accountId: 'inv1',
          holdings: [{ symbol: 'SPY', quantity: 10, avgCost: 400, currentPrice: 450 }],
        },
      ],
      goals: [{ id: 'g1', name: 'House', targetAmount: 100000, currentAmount: 20000, deadline: '2030-01-01' }],
      liabilities: [],
      assets: [],
      sukukPositions: [],
      sukukPayoutEvents: [],
      commodityHoldings: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const model = buildPeriodFinancialReportModel({
      data,
      exchangeRate: 3.75,
      getAvailableCashForAccount: () => ({ SAR: 10000, USD: 0 }),
      simulatedPrices: { SPY: { price: 450 } },
      preset: 'ytd',
      ref: new Date(2026, 8, 2),
      snapshots: [],
    });

    expect(model.cover.periodLabel.length).toBeGreaterThan(0);
    expect(model.wealth.endNwSar).toBeGreaterThan(0);
    expect(model.cashflow.months.length).toBeGreaterThan(0);
    expect(model.transactions.count).toBeGreaterThanOrEqual(0);
    expect(model.investments.totalExposureSar).toBeGreaterThanOrEqual(0);
    expect(model.goalsPlan.goals.length).toBe(1);
    expect(Array.isArray(model.recommendations)).toBe(true);

    const html = generatePeriodFinancialReportHtml(model);
    for (const id of [
      'report-wealth',
      'report-cashflow',
      'report-budgets',
      'report-transactions',
      'report-investments',
      'report-sukuk',
      'report-debt',
      'report-safety',
      'report-goals',
      'report-zakat',
      'report-quality',
      'report-recommendations',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<svg');
  });

  it('model imports only canonical wealth / investment / goal engines', () => {
    const src = read('services/periodFinancialReportModel.ts');
    expect(src).toContain('computeCanonicalFinancialMetrics');
    expect(src).toContain("from './canonicalFinancialMetrics'");
    expect(src).toContain('computePortfolioPnLForWindow');
    expect(src).toContain('computeGoalResolvedAmountsSar');
    expect(src).toContain('sumPersonalSukukPositionsSar');
    expect(src).toContain('computeExpenseBudgetAnalysisModel');
    expect(src).toContain('personalMonthlyInflowOutflowByFinancialMonthSar');
    expect(src).toContain('computeEmergencyFundMetrics');
    expect(src).toContain('buildEnhancementSignals');
  });

  it('portfolio window P/L API is exported from portfolioPeriodPnL', () => {
    const src = read('services/portfolioPeriodPnL.ts');
    expect(src).toContain('export function computePortfolioPnLForWindow');
  });

  it('HTML generator and print path are wired', () => {
    const html = read('services/periodFinancialReportHtml.ts');
    expect(html).toContain('generatePeriodFinancialReportHtml');
    expect(html).toContain('periodReportTransactionsCsv');
    const modal = read('components/reports/PeriodFinancialReportModal.tsx');
    expect(modal).toContain('openHtmlForPrint');
    expect(modal).toContain('generatePeriodFinancialReportHtml');
    expect(modal).toContain('buildPeriodFinancialReportModel');
    expect(modal).toContain('openPeriodFinancialReportModal');
  });

  it('all entry points open the same modal', () => {
    const settings = read('pages/Settings.tsx');
    const wa = read('components/analytics/WealthAnalyticsExportMenu.tsx');
    const summary = read('pages/Summary.tsx');
    const dash = read('pages/Dashboard.tsx');
    const palette = read('components/CommandPalette.tsx');
    const shell = read('components/AuthenticatedAppShell.tsx');

    expect(shell).toContain('PeriodFinancialReportHost');
    expect(settings).toContain('Period financial report (PDF)');
    expect(settings).toContain('openPeriodFinancialReportModal');
    expect(wa).toContain('period-financial-report');
    expect(wa).toContain('openPeriodFinancialReportModal');
    expect(summary).toContain('Period financial report (PDF)');
    expect(dash).toContain('Period financial report (PDF)');
    expect(palette).toContain('Generate period financial report (PDF)');
    expect(palette).toContain('openPeriodFinancialReportModal');
  });
});
