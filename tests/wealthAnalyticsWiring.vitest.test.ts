import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('wealth analytics end-to-end wiring', () => {
    it('is registered in types, nav, lazy pages, and shell routing', () => {
        expect(read('types.ts')).toContain("'Wealth Analytics'");
        expect(read('constants.tsx')).toMatch(/name:\s*'Wealth Analytics'/);
        expect(read('constants.tsx')).not.toContain('charts & health');
        expect(read('utils/lazyPages.tsx')).toMatch(/'Wealth Analytics':\s*lazyPage/);
        expect(read('components/AuthenticatedAppShell.tsx')).toContain("'Wealth Analytics'");
        expect(read('components/AuthenticatedAppShell.tsx')).toContain("case 'Wealth Analytics':");
        const header = read('components/Header.tsx');
        expect(header).toMatch(/Overview.*Wealth Analytics/s);
    });

    it('Wealth Analytics page uses canonical metrics and advanced widgets', () => {
        const src = read('pages/WealthAnalytics.tsx');
        expect(src).toContain('useCanonicalFinancialMetrics');
        expect(src).toContain('netWorth');
        expect(src).toContain('liquidCashSar');
        expect(src).toContain('wealthSummary: reportModel');
        expect(src).not.toContain('resolveSarPerUsd');
        expect(src).not.toContain('useMarketData');
        expect(src).toContain('ExecutiveKpiGrid');
        expect(src).toContain('PortfolioPeriodPnLPanelSection');
        expect(src).toContain('WealthAnalyticsExportMenuSection');
        expect(src).toContain('WealthHealthIndicatorsSection');
        expect(src).toContain('DashboardOperationsCockpitSection');
        expect(src).toContain('SummaryWealthAtlasSection');
        expect(src).toContain('WealthAnalyticsDetailsSectionLazy');
        expect(src).toContain('PortfolioHoldingsGridSection');
        expect(src).toContain('portfolioId={holdingsPortfolioId');
        expect(src).toContain('wealth-analytics-portfolio');
        expect(src).toContain('CostAveragingCalculatorSection');
        expect(src).toContain('Goals2030TimelineSection');
        expect(src).toContain('useExecutiveKpiSparklines');
        expect(src).toContain('useEnhancementSignals');
        expect(src).toContain('useEnhancementSignals(sarPerUsd)');
        expect(src).toContain('staggerIndex');
        expect(src).not.toContain('Loading analytics');
        expect(read('components/analytics/wealthAnalyticsLazySections.tsx')).toContain('WealthHealthIndicators');
        expect(read('components/analytics/wealthAnalyticsLazySections.tsx')).toContain('SummaryWealthAtlas');
        expect(read('components/analytics/wealthAnalyticsLazySections.tsx')).toContain('DashboardOperationsCockpit');
        expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('useWealthAnalyticsDeferredInsights');
        expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('exchangeRate: sarPerUsd');
        expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('kpiSnapshot: DashboardKpiSnapshot');
    });

    it('monthly cockpit uses inline date toolbar (not a wasted side card)', () => {
        const cockpit = read('components/dashboard/DashboardOperationsCockpit.tsx');
        expect(cockpit).not.toContain('lg:col-span-1');
        expect(cockpit).toContain('DateRangePicker');
        expect(read('components/dashboard/DateRangePicker.tsx')).not.toContain('h-full flex flex-col justify-center');
        expect(read('components/dashboard/DateRangePicker.tsx')).toContain('ring-slate-200/80');
    });

    it('holdings grid scopes rows by portfolio id', () => {
        expect(read('components/dashboard/PortfolioHoldingsGrid.tsx')).toContain('portfolioId');
        expect(read('components/dashboard/PortfolioHoldingsGrid.tsx')).toContain('scopedPortfolios');
        expect(read('components/dashboard/CostAveragingCalculator.tsx')).toContain('portfolioId');
    });

    it('Dashboard and Summary gate auto snapshots on quote readiness', () => {
        const dashboard = read('pages/Dashboard.tsx');
        const summary = read('pages/Summary.tsx');
        expect(dashboard).toContain('canAutoCaptureNetWorthSnapshot');
        expect(dashboard).toContain('dashboardDebouncedPrices');
        expect(summary).toContain('canAutoCaptureNetWorthSnapshot');
        expect(summary).toContain('quoteRefreshFingerprint');
    });

    it('Dashboard and Summary stay lean (heavy widgets on Wealth Analytics only)', () => {
        const dashboard = read('pages/Dashboard.tsx');
        const summary = read('pages/Summary.tsx');
        expect(dashboard).not.toContain('DashboardOperationsCockpit');
        expect(dashboard).not.toContain('SummaryWealthAtlas');
        expect(summary).not.toContain('WealthAnalyticsSummaryPanels');
        expect(dashboard).toContain('Wealth Analytics');
        expect(summary).toContain('Wealth Analytics');
    });

    it('canonical KPI snapshot uses getPersonalTransactions', () => {
        const src = read('services/dashboardKpiSnapshot.ts');
        expect(src).toContain('getPersonalTransactions');
        expect(src).not.toMatch(/personalTransactions\s*\?\?\s*data\.transactions/);
    });

    it('DataContext wraps transaction writes in startTransition', () => {
        const src = read('context/DataContext.tsx');
        expect(src).toContain('transactions: [normalized, ...prev.transactions]');
        expect(src).toContain('startTransition(() => {\n                setData((prevState) => ({\n                    ...prevState,\n                    transactions: prevState.transactions.map((t) => (t.id === transaction.id ? normalized : t)),');
    });

    it('CanonicalFinancialMetricsProvider debounces data before compute', () => {
        const src = read('context/CanonicalFinancialMetricsContext.tsx');
        expect(src).toContain('useDebouncedValue(showHydrateBanner ? null : data, 350)');
    });
});
