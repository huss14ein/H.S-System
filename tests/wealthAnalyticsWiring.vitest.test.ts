import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('wealth analytics end-to-end wiring', () => {
    it('is registered in types, nav, lazy pages, and shell routing', () => {
        expect(read('types.ts')).toContain("'Wealth Analytics'");
        expect(read('constants.tsx')).toMatch(/name:\s*'Wealth Analytics'/);
        expect(read('utils/lazyPages.tsx')).toMatch(/'Wealth Analytics':\s*lazyPage/);
        expect(read('components/AuthenticatedAppShell.tsx')).toContain("'Wealth Analytics'");
        expect(read('components/AuthenticatedAppShell.tsx')).toContain("case 'Wealth Analytics':");
        const header = read('components/Header.tsx');
        expect(header).toMatch(/Overview.*Wealth Analytics/s);
    });

    it('Wealth Analytics page uses canonical metrics and advanced widgets', () => {
        const src = read('pages/WealthAnalytics.tsx');
        expect(src).toContain('useCanonicalFinancialMetrics');
        expect(src).toContain('useDashboardCanonicalMetrics');
        expect(src).toContain('DashboardOperationsCockpit');
        expect(src).toContain('SummaryWealthAtlas');
        expect(src).toContain('WealthAnalyticsSummaryPanels');
        expect(src).toContain('PortfolioHoldingsGrid');
        expect(src).toContain('PortfolioPeriodPnLPanel');
        expect(src).toContain('CostAveragingCalculator');
        expect(src).toContain('Goals2030Timeline');
        expect(src).toContain('AIExecutiveSummary');
        expect(src).toContain('AIFeed');
        expect(src).toContain('getPersonalTransactions');
        expect(src).not.toMatch(/personalTransactions\s*\?\?\s*data\?\.transactions/);
        expect(src).not.toMatch(/personalAccounts\s*\?\?\s*data\?\.accounts/);
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
