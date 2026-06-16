/**
 * Guards system-wide performance patterns across pages and shared surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function pageFiles(): string[] {
  return readdirSync(join(root, 'pages'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `pages/${f}`);
}

describe('system performance surface coverage', () => {
  it('Layout wraps page content with PageDeferredDataProvider', () => {
    const layout = read('components/Layout.tsx');
    expect(layout).toContain('PageDeferredDataProvider');
    expect(layout).toMatch(/<PageDeferredDataProvider>\{children\}<\/PageDeferredDataProvider>/);
  });

  it('MarketDataContext splits price ticks from control meta', () => {
    const src = read('context/MarketDataContext.tsx');
    expect(src).toContain('MarketPricesContext');
    expect(src).toContain('MarketDebouncedPricesContext');
    expect(src).toContain('MarketDataControlContext');
    expect(src).toContain('export function useMarketPrices');
  });

  it('shared AI / palette surfaces use debounced canonical prices', () => {
    for (const file of [
      'components/AIFeed.tsx',
      'components/AIAdvisor.tsx',
      'components/CommandPalette.tsx',
      'components/LiveAdvisorModal.tsx',
      'components/DashboardKpiQualityPanel.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('useCanonicalSimulatedPrices');
      expect(src).not.toMatch(/useMarketData\(\)[\s\S]{0,80}simulatedPrices/);
    }
  });

  it('investment sub-views read quote meta without price subscription', () => {
    for (const file of ['pages/AIRebalancerView.tsx', 'pages/RecoveryPlanView.tsx', 'pages/InvestmentPlanView.tsx']) {
      const src = read(file);
      expect(src).toContain('useMarketQuoteMeta');
      expect(src).not.toMatch(/useMarketData\(\)[\s\S]{0,80}symbolQuoteUpdatedAt/);
    }
  });

  it('heavy household pages defer compute data', () => {
    for (const file of ['pages/Budgets.tsx', 'pages/Plan.tsx', 'pages/Goals.tsx', 'pages/Transactions.tsx', 'pages/Analysis.tsx', 'pages/WealthAnalytics.tsx', 'pages/Forecast.tsx']) {
      const src = read(file);
      expect(src).toContain('usePageDeferredData');
      expect(src).toContain('engineData');
    }
  });

  it('pages do not hydrate FX series inside useMemo', () => {
    for (const file of pageFiles()) {
      const src = read(file);
      const useMemoBlocks = src.match(/useMemo\s*\([^;]{0,4000}/g) ?? [];
      for (const block of useMemoBlocks) {
        expect(block, file).not.toContain('hydrateSarPerUsdDailySeries');
      }
    }
  });

  it('pages do not subscribe to raw simulatedPrices via useMarketData', () => {
    for (const file of pageFiles()) {
      const src = read(file);
      expect(src, file).not.toMatch(/useMarketData\(\)[\s\S]{0,120}simulatedPrices/);
    }
  });

  it('emergency fund hook hydrates FX in effect not memo', () => {
    const src = read('hooks/useEmergencyFund.ts');
    expect(src).toContain('useHydrateSarPerUsdDailySeries');
    expect(src).toContain('skipHydrate: true');
    expect(src).not.toMatch(/useMemo\([\s\S]*hydrateSarPerUsdDailySeries/);
  });

  it('NetWorthCompositionChart hydrates FX outside chart memo', () => {
    const src = read('components/charts/NetWorthCompositionChart.tsx');
    expect(src).toContain('useHydrateSarPerUsdDailySeries');
    expect(src).not.toMatch(/useMemo\([\s\S]*hydrateSarPerUsdDailySeries/);
  });

  it('shell chrome reads quote meta without price subscription', () => {
    for (const file of ['components/Header.tsx', 'components/LivePricesStatus.tsx', 'components/Layout.tsx']) {
      const src = read(file);
      expect(src).toContain('useMarketQuoteMeta');
      expect(src).not.toMatch(/useMarketData\(\)/);
    }
  });

  it('NotificationsContext uses debounced market prices context', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toContain('useMarketDebouncedPrices');
    expect(src).toContain('useMarketQuoteMeta');
    expect(src).not.toContain('debouncedPricesState');
  });
});
