/**
 * End-to-end completion guards: Period Financial Report (browser Print / Save as PDF).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  financialMonthKeysCoveringRange,
  periodReportToAnalyticsPreset,
  resolvePeriodReportWindow,
  resolvePeriodReportTwinWindows,
  validateCustomPeriodRange,
} from '../services/periodReportWindow';
import { buildPeriodFinancialReportModel } from '../services/periodFinancialReportModel';
import { generatePeriodFinancialReportHtml } from '../services/periodFinancialReportHtml';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const FIXTURE = {
  accounts: [
    { id: 'a1', name: 'Checking', type: 'Checking', balance: 5000, currency: 'SAR' },
    { id: 'a2', name: 'Visa', type: 'Credit', balance: -800, currency: 'SAR' },
    { id: 'a3', name: 'Broker', type: 'Investment', balance: 1000, currency: 'SAR' },
  ],
  transactions: [
    { id: 't1', accountId: 'a1', date: '2026-02-01', amount: 10000, type: 'income', category: 'Salary', description: 'Salary' },
    { id: 't2', accountId: 'a1', date: '2026-02-10', amount: -2000, type: 'expense', category: 'Food', description: 'Groceries' },
    { id: 't3', accountId: 'a1', date: '2026-02-12', amount: -500, type: 'expense', category: 'Subscriptions', description: 'Netflix subscription' },
    { id: 't4', accountId: 'a2', date: '2026-02-15', amount: -300, type: 'expense', category: 'Shopping', description: 'Store' },
    { id: 't5', accountId: 'a2', date: '2026-02-20', amount: 200, type: 'income', category: 'Transfer', description: 'Card payment', transferRole: 'principal_in' },
  ],
  investments: [
    {
      id: 'p1',
      name: 'Main',
      accountId: 'a3',
      currency: 'SAR',
      holdings: [{ id: 'h1', symbol: 'TEST', name: 'Test Co', quantity: 10, avgCost: 100, currentValue: 1200 }],
    },
  ],
  liabilities: [
    { id: 'l1', name: 'BNPL Phone', type: 'Installment', amount: -1200, status: 'Active', interestRate: 18 },
  ],
  budgets: [{ id: 'b1', category: 'Food', limit: 1500, period: 'monthly' }],
  goals: [],
  assets: [],
  subscriptions: [
    { id: 's1', name: 'Streaming', amount: 40, currency: 'SAR', cadence: 'monthly', status: 'active', nextRenewalDate: '2026-03-01' },
  ],
  settings: { monthStartDay: 1 },
} as unknown as FinancialData;

const EMPTY_DATA = {
  accounts: [],
  transactions: [],
  investments: [],
  liabilities: [],
  budgets: [],
  goals: [],
  assets: [],
  settings: { monthStartDay: 1 },
} as unknown as FinancialData;

describe('Period Financial Report completion (E2E)', () => {
  it('core services exist: window, portfolio PnL window, model, HTML', () => {
    expect(read('services/periodReportWindow.ts')).toContain('resolvePeriodReportTwinWindows');
    expect(read('services/periodReportWindow.ts')).toContain('financialMonthKeysCoveringRange');
    expect(read('services/periodReportWindow.ts')).toContain('periodReportToAnalyticsPreset');
    expect(read('services/periodReportWindow.ts')).toContain('validatePeriodReportRequest');
    expect(read('services/periodReportInstallments.ts')).toContain('fetchPeriodReportInstallmentSnapshot');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('computePortfolioPnLForWindow');
    expect(read('services/periodFinancialReportModel.ts')).toContain('reconcileDashboardVsSummaryKpis');
    expect(read('services/periodFinancialReportModel.ts')).toContain('PERIOD_REPORT_SECTION_OPTIONS');
    expect(read('services/periodFinancialReportModel.ts')).toContain('appendix-inventory');
    expect(read('services/periodFinancialReportHtml.ts')).toContain('svgWaterfall');
    expect(read('services/periodFinancialReportHtml.ts')).toContain('appendix-inventory');
    expect(read('services/periodFinancialReportHtml.ts')).not.toMatch(/jspdf|pdfkit|pdf-lib/i);
  });

  it('window presets + prior twin + custom validation + finKeys for CY/custom', () => {
    const now = new Date('2026-06-15T12:00:00');
    for (const preset of ['FY', 'CY', 'YTD', '12M'] as const) {
      const twin = resolvePeriodReportTwinWindows({ preset, monthStartDay: 1, now });
      expect(twin.current.end.getTime()).toBeGreaterThanOrEqual(twin.current.start.getTime());
      expect(twin.prior.end.getTime()).toBeLessThan(twin.current.start.getTime());
      expect(twin.current.finKeys.length).toBeGreaterThan(0);
    }
    const cy = resolvePeriodReportWindow({ preset: 'CY', monthStartDay: 1, now });
    expect(cy.finKeys.length).toBeGreaterThan(0);
    const custom = resolvePeriodReportWindow({
      preset: 'custom',
      monthStartDay: 1,
      now,
      customStartIso: '2026-01-01',
      customEndIso: '2026-03-31',
    });
    expect(custom.startIso).toBe('2026-01-01');
    expect(custom.endIso).toBe('2026-03-31');
    expect(custom.finKeys.length).toBeGreaterThanOrEqual(3);
    expect(financialMonthKeysCoveringRange(custom.start, custom.end, 1).length).toBe(custom.finKeys.length);
    expect(periodReportToAnalyticsPreset('12M', custom)).toBe('12M');
    expect(validateCustomPeriodRange('2026-01-01', '2026-01-31').ok).toBe(true);
    expect(validateCustomPeriodRange('2026-02-01', '2026-01-01').ok).toBe(false);
    expect(validateCustomPeriodRange('bad', '2026-01-01').ok).toBe(false);
  });

  it('fixture model: period cashflow, waterfall, subscriptions, holdings, recon engine', () => {
    const model = buildPeriodFinancialReportModel({
      data: FIXTURE,
      uiExchangeRate: 3.75,
      getAvailableCashForAccount: () => ({ SAR: 1000, USD: 0 }),
      simulatedPrices: {},
      preset: 'custom',
      customStartIso: '2026-02-01',
      customEndIso: '2026-02-28',
      now: new Date('2026-06-15T12:00:00'),
    });
    const cf = model.byId['2-cashflow']?.data as {
      current: { incomeSar: number; expensesSar: number; netSar: number };
      waterfall: Array<{ label: string; sar: number; cumulative: number }>;
    };
    expect(cf.current.incomeSar).toBeGreaterThan(0);
    expect(cf.current.expensesSar).toBeGreaterThan(0);
    expect(cf.waterfall.map((w) => w.label)).toEqual(['Income', 'Expenses', 'Transfers net', 'Net']);
    expect(cf.waterfall[0]?.cumulative).toBe(0);

    const subs = model.byId['6-subscriptions']?.data as { plans: Array<{ name: string }>; plannedMonthlySar: number };
    expect(subs.plans.some((p) => p.name === 'Streaming')).toBe(true);
    expect(subs.plannedMonthlySar).toBe(40);

    const holdings = model.byId['5-holdings-gl']?.data as Array<{ symbol: string; valueSar: number }>;
    expect(holdings.some((h) => h.symbol === 'TEST')).toBe(true);

    const recon = model.byId['11-transfers-recon']?.data as { reconRows: unknown[]; mismatchCount: number };
    expect(Array.isArray(recon.reconRows)).toBe(true);
    expect(recon.reconRows.length).toBeGreaterThanOrEqual(5);

    const cards = model.byId['7-credit-cards']?.data as Array<{ interestAndFees: number; name: string }>;
    expect(cards.some((c) => c.name === 'Visa')).toBe(true);

    const html = generatePeriodFinancialReportHtml(model);
    expect(html).toContain('Cashflow waterfall');
    expect(html).toContain('KPI reconciliation');
    expect(html).toContain('Subscription records');
    expect(html).toContain('Interest/fees');
    expect(html).toContain('as of today');
  });

  it('model soft-fail sections 1→12 + orphans + live actions', () => {
    const model = buildPeriodFinancialReportModel({
      data: EMPTY_DATA,
      uiExchangeRate: 3.75,
      getAvailableCashForAccount: () => ({ SAR: 0, USD: 0 }),
      simulatedPrices: {},
      preset: 'YTD',
      now: new Date('2026-06-15T12:00:00'),
    });
    const ids = model.sections.map((s) => s.id);
    expect(ids.slice(0, 12)).toEqual([
      '1-executive',
      '2-cashflow',
      '3-budget',
      '4-portfolio-pnl',
      '5-holdings-gl',
      '6-subscriptions',
      '7-credit-cards',
      '8-installments',
      '9-household',
      '10-forecast',
      '11-transfers-recon',
      '12-investment-roi',
    ]);
    expect(ids).toEqual(
      expect.arrayContaining([
        'orphan-budget-insights',
        'orphan-live-nw',
        'orphan-ef',
        'orphan-pti-payoff',
        'orphan-salary',
        'appendix-inventory',
      ]),
    );
    expect(model.byId['1-executive']?.data).toMatchObject({
      snapshotTrend: expect.any(Array),
      periodNetCashflowSar: expect.any(Number),
    });
    expect(model.byId['8-installments']?.status).toBe('ok');
    expect(String((model.byId['8-installments']?.data as { note?: string })?.note || '')).toMatch(/BNPL|installment/i);
    expect(model.byId['9-household']?.data).toMatchObject({ managedNote: expect.any(String) });
    expect(model.liveActions.some((a) => a.action === 'open-period-financial-report')).toBe(true);
    expect(model.liveActions.some((a) => a.page === 'Installments')).toBe(true);

    const html = generatePeriodFinancialReportHtml(model);
    expect(html).toContain('Period Financial Report');
    expect(html).toContain('id="1-executive"');
    expect(html).toContain('id="12-investment-roi"');
    expect(html).toContain('Table of contents');
    expect(html).toContain('Print → Save as PDF');
    const pos = (id: string) => html.indexOf(`id="${id}"`);
    expect(pos('2-cashflow')).toBeGreaterThan(pos('1-executive'));
    expect(pos('12-investment-roi')).toBeGreaterThan(pos('11-transfers-recon'));
    expect(pos('orphan-salary')).toBeGreaterThan(pos('12-investment-roi'));
  });

  it('modal: light preview twin + liveActions + validations + section picker + JSON + stay open if blocked', () => {
    const modal = read('components/reports/PeriodFinancialReportModal.tsx');
    expect(modal).toContain('validatePeriodReportRequest');
    expect(modal).toContain('resolvePeriodReportTwinWindows');
    expect(modal).toMatch(
      /const previewLabel = useMemo\(\(\) => \{\s*try \{\s*const twin = resolvePeriodReportTwinWindows/,
    );
    expect(modal).toContain('Print window was blocked');
    expect(modal).toContain('This dialog stays open');
    expect(modal).toContain('Cross-engine actions');
    expect(modal).toContain('onNavigate(a.page, a.action)');
    expect(modal).toContain('PERIOD_REPORT_SECTION_OPTIONS');
    expect(modal).toContain('Export JSON');
    expect(modal).toContain('fetchPeriodReportInstallmentSnapshot');
    expect(modal).toContain('yieldToMain');
    expect(modal).toContain('busyRef');
    expect(modal).toContain('Select at least one report section');
    expect(modal).not.toMatch(/jspdf|pdfkit|pdf-lib/i);
    const layout = read('components/Layout.tsx');
    expect(layout).toContain('PeriodFinancialReportModal');
    expect(layout).toContain('PERIOD_FINANCIAL_REPORT_EVENT');
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain("import Layout from './Layout'");
    expect(shell).toContain('<Layout');
  });

  it('entry points: Settings, Wealth Analytics, Summary, Dashboard, Command palette, pageActions', () => {
    expect(read('utils/periodFinancialReportOpen.ts')).toContain('openPeriodFinancialReportModal');
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('openPeriodFinancialReportModal');
    expect(settings).toContain('full period extract');
    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain('Period Financial Report');
    expect(read('pages/Summary.tsx')).toContain('Period Financial Report');
    expect(read('pages/Dashboard.tsx')).toContain('Period Financial Report');
    expect(read('components/CommandPalette.tsx')).toContain('onOpenPeriodFinancialReport');
    const actions = read('utils/pageActions.ts');
    expect(actions).toContain("action === 'open-period-financial-report'");
    expect(actions).toMatch(/page === 'Summary'[\s\S]*open-period-financial-report/);
    expect(actions).toMatch(/page === 'Wealth Analytics'[\s\S]*open-period-financial-report/);
  });

  it('docs mention Period Financial Report', () => {
    expect(read('docs/FULL_UI_SECTIONS_WIRING.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/IMPLEMENTATION_COVERAGE.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/SYSTEM_ARCHITECTURE.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/QA_MANUAL_PASS.md')).toMatch(/Period Financial Report/i);
  });
});
