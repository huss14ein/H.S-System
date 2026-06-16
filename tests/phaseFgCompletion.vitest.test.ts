/**
 * End-to-end guards for Phases F (layout) and G (PDF exports).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase F — Wealth Analytics layout E2E', () => {
  it('compact header with export row in PageLayout action slot', () => {
    const wa = read('pages/WealthAnalytics.tsx');
    expect(wa).toContain('WealthAnalyticsExportMenuSection');
    expect(wa).toContain('action={exportAction}');
    expect(wa).not.toContain('PAGE_INTROS');
    expect(wa).not.toContain('ExecutiveStatusRow');
  });

  it('above-fold order: KPI grid → P/L → atlas → cockpit', () => {
    const wa = read('pages/WealthAnalytics.tsx');
    const kpi = wa.indexOf('<WealthAnalyticsExecutiveKpiSection');
    const pnl = wa.indexOf('<PortfolioPeriodPnLPanelSection');
    const atlas = wa.indexOf('aria-label="Wealth atlas"');
    const cockpit = wa.indexOf('aria-label="Operations cockpit"');
    expect(kpi).toBeGreaterThan(-1);
    expect(pnl).toBeGreaterThan(kpi);
    expect(atlas).toBeGreaterThan(pnl);
    expect(cockpit).toBeGreaterThan(atlas);
  });

  it('prose and AI panels collapsed under Details section', () => {
    const wa = read('pages/WealthAnalytics.tsx');
    expect(wa).toContain('analyticsDetailsTitle');
    expect(wa).toContain('defaultExpanded={false}');
    expect(wa).toContain('WealthAnalyticsDetailsSectionLazy');
    expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('WealthAnalyticsSummaryPanelsSection');
  });
});

describe('Phase G — PDF export E2E', () => {
  it('report model and HTML generators exist and are wired', () => {
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain('buildWealthAnalyticsReportModel');
    expect(read('services/reportingEngine.ts')).toContain('generateWealthExecutiveSummaryHtml');
    expect(read('services/reportingEngine.ts')).toContain('generateWealthMetricPassportHtml');
    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain('openHtmlForPrint');
    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain('generateWealthExecutiveSummaryHtml');
  });

  it('export menu offers executive summary and five metric passports', () => {
    const menu = read('components/analytics/WealthAnalyticsExportMenu.tsx');
    expect(menu).toContain('exportExecutiveSummary');
    expect(menu).toContain('passport-${key}');
    expect(menu).toContain('WEALTH_METRIC_PASSPORT_LABELS');
  });
});
