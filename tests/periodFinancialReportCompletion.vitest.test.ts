/**
 * End-to-end completion guards: Period Financial Report (browser Print / Save as PDF).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolvePeriodReportWindow,
  resolvePeriodReportTwinWindows,
  validateCustomPeriodRange,
} from '../services/periodReportWindow';
import { buildPeriodFinancialReportModel } from '../services/periodFinancialReportModel';
import { generatePeriodFinancialReportHtml } from '../services/periodFinancialReportHtml';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

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
    expect(read('services/periodReportWindow.ts')).toContain("preset: PeriodReportPreset");
    expect(read('services/periodReportWindow.ts')).toMatch(/'FY' \| 'CY' \| 'YTD' \| '12M' \| 'custom'/);
    expect(read('services/periodReportWindow.ts')).toContain('validateCustomPeriodRange');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('computePortfolioPnLForWindow');
    expect(read('services/periodFinancialReportModel.ts')).toContain('buildPeriodFinancialReportModel');
    expect(read('services/periodFinancialReportModel.ts')).toContain('soft(');
    expect(read('services/periodFinancialReportHtml.ts')).toContain('generatePeriodFinancialReportHtml');
    expect(read('services/periodFinancialReportHtml.ts')).toContain('class="toc"');
    expect(read('services/periodFinancialReportHtml.ts')).not.toMatch(/jspdf|pdfkit|pdf-lib/i);
  });

  it('window presets + prior twin + custom validation', () => {
    const now = new Date('2026-06-15T12:00:00');
    for (const preset of ['FY', 'CY', 'YTD', '12M'] as const) {
      const twin = resolvePeriodReportTwinWindows({ preset, monthStartDay: 1, now });
      expect(twin.current.end.getTime()).toBeGreaterThanOrEqual(twin.current.start.getTime());
      expect(twin.prior.end.getTime()).toBeLessThan(twin.current.start.getTime());
    }
    const custom = resolvePeriodReportWindow({
      preset: 'custom',
      monthStartDay: 1,
      now,
      customStartIso: '2026-01-01',
      customEndIso: '2026-03-31',
    });
    expect(custom.startIso).toBe('2026-01-01');
    expect(custom.endIso).toBe('2026-03-31');
    expect(validateCustomPeriodRange('2026-01-01', '2026-01-31').ok).toBe(true);
    expect(validateCustomPeriodRange('2026-02-01', '2026-01-01').ok).toBe(false);
    expect(validateCustomPeriodRange('bad', '2026-01-01').ok).toBe(false);
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
    expect(ids).toEqual(expect.arrayContaining([
      'orphan-budget-insights',
      'orphan-live-nw',
      'orphan-ef',
      'orphan-pti-payoff',
      'orphan-salary',
    ]));
    expect(model.byId['1-executive']?.data).toMatchObject({
      snapshotTrend: expect.any(Array),
    });
    expect(model.byId['2-cashflow']?.data).toMatchObject({
      waterfall: expect.any(Array),
    });
    // Installment guidance note must remain visible even with zero rows (not soft-empty).
    expect(model.byId['8-installments']?.status).toBe('ok');
    expect(String((model.byId['8-installments']?.data as { note?: string })?.note || '')).toMatch(/BNPL|installment/i);
    expect(model.byId['9-household']?.data).toMatchObject({
      managedNote: expect.any(String),
    });
    expect(model.liveActions.some((a) => a.action === 'open-period-financial-report')).toBe(true);
    const html = generatePeriodFinancialReportHtml(model);
    expect(html).toContain('Period Financial Report');
    expect(html).toContain('id="1-executive"');
    expect(html).toContain('id="12-investment-roi"');
    expect(html).toContain('Table of contents');
    expect(html).toContain('Print → Save as PDF');
    expect(html).toContain('Waterfall');
    expect(html).toContain('Snapshot trend');
    expect(html).toMatch(/BNPL|installment/i);
    // Section order in HTML body follows 1→12 then orphans
    const pos = (id: string) => html.indexOf(`id="${id}"`);
    expect(pos('1-executive')).toBeGreaterThan(0);
    expect(pos('2-cashflow')).toBeGreaterThan(pos('1-executive'));
    expect(pos('12-investment-roi')).toBeGreaterThan(pos('11-transfers-recon'));
    expect(pos('orphan-salary')).toBeGreaterThan(pos('12-investment-roi'));
  });

  it('modal: custom validation + stay open if print blocked; Layout hosts modal', () => {
    const modal = read('components/reports/PeriodFinancialReportModal.tsx');
    expect(modal).toContain('validateCustomPeriodRange');
    expect(modal).toContain('Print window was blocked');
    expect(modal).toContain('This dialog stays open');
    expect(modal).toContain('openHtmlForPrint');
    expect(modal).not.toMatch(/jspdf|pdfkit|pdf-lib/i);
    const layout = read('components/Layout.tsx');
    expect(layout).toContain('PeriodFinancialReportModal');
    expect(layout).toContain('PERIOD_FINANCIAL_REPORT_EVENT');
    expect(layout).toContain('isPeriodReportOpen');
    // AuthenticatedAppShell hosts the modal via Layout (same pattern as CommandPalette / LiveAdvisor).
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain("import Layout from './Layout'");
    expect(shell).toContain('<Layout');
    expect(shell).toContain("case 'Summary':");
    expect(shell).toContain('actionProps');
  });

  it('entry points: Settings, Wealth Analytics, Summary, Dashboard, Command palette, pageActions', () => {
    expect(read('utils/periodFinancialReportOpen.ts')).toContain('openPeriodFinancialReportModal');
    expect(read('utils/periodFinancialReportOpen.ts')).toContain('finova:open-period-financial-report');

    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('openPeriodFinancialReportModal');
    expect(settings).toContain('Period Financial Report');
    expect(settings).toContain('full period extract');
    expect(settings).toContain("pageAction !== 'open-period-financial-report'");

    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain(
      'Period Financial Report (Print / PDF)',
    );
    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain(
      'openPeriodFinancialReportModal',
    );

    const summary = read('pages/Summary.tsx');
    expect(summary).toContain('Period Financial Report (Print / PDF)');
    expect(summary).toContain('openPeriodFinancialReportModal');
    expect(summary).toContain("pageAction !== 'open-period-financial-report'");

    const dashboard = read('pages/Dashboard.tsx');
    expect(dashboard).toContain('Period Financial Report');
    expect(dashboard).toContain('openPeriodFinancialReportModal');
    expect(dashboard).toContain("'open-period-financial-report'");

    const palette = read('components/CommandPalette.tsx');
    expect(palette).toContain('Period Financial Report (Print / PDF)');
    expect(palette).toContain('onOpenPeriodFinancialReport');

    const actions = read('utils/pageActions.ts');
    expect(actions).toContain("action === 'open-period-financial-report'");
    expect(actions).toMatch(/page === 'Dashboard'[\s\S]*open-period-financial-report/);
    expect(actions).toMatch(/page === 'Settings'[\s\S]*open-period-financial-report/);
    expect(actions).toMatch(/page === 'Summary'[\s\S]*open-period-financial-report/);
    expect(actions).toMatch(/page === 'Wealth Analytics'[\s\S]*open-period-financial-report/);

    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toMatch(/case 'Summary':\s*return <Lazy[^;]*actionProps/);
    expect(shell).toMatch(/case 'Wealth Analytics':\s*return <Lazy[^;]*actionProps/);
  });

  it('gap-fill model surfaces: household planned/actual, PTI, subscriptions, cards, forecast', () => {
    const modelSrc = read('services/periodFinancialReportModel.ts');
    expect(modelSrc).toContain('buildHouseholdPlanFromFinancialData');
    expect(modelSrc).toContain('plannedVsActual');
    expect(modelSrc).toContain('debtServiceRatio');
    expect(modelSrc).toContain('subscriptionSpendMonthlySar');
    expect(modelSrc).toContain('aggregateCreditCardStatementActivity');
    expect(modelSrc).toContain('projectForecastSeries');
    expect(modelSrc).toContain('computePortfolioPnLForWindow');
    expect(modelSrc).toContain('topHoldingsGainLoss');
    expect(modelSrc).toContain('listNetWorthSnapshots');
    expect(modelSrc).toContain('dashboardMonthlyPnL');
    expect(modelSrc).toContain('summaryMonthlyPnL');
    expect(modelSrc).toContain('liveActions');
    const html = read('services/periodFinancialReportHtml.ts');
    expect(html).toContain("case 'orphan-budget-insights'");
    expect(html).toContain("case 'orphan-live-nw'");
    expect(html).toContain("case 'orphan-ef'");
    expect(html).toContain("case 'orphan-pti-payoff'");
    expect(html).toContain("case 'orphan-salary'");
    expect(html).toContain('Planned net');
  });

  it('docs mention Period Financial Report', () => {
    expect(read('docs/FULL_UI_SECTIONS_WIRING.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/IMPLEMENTATION_COVERAGE.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/SYSTEM_ARCHITECTURE.md')).toMatch(/Period Financial Report/i);
    expect(read('docs/QA_MANUAL_PASS.md')).toMatch(/Period Financial Report/i);
  });
});
