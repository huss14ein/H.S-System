/**
 * UI must stay interactive while Supabase hydrate, extended metrics, or lazy chunks load.
 * Shell chrome (header/nav) is outside these gates — only main-column sections may show placeholders.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function pageFiles(): string[] {
  return readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.tsx'));
}

describe('UI non-blocking coverage', () => {
  it('DataContext never blocks pages with showBlockingLoader', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toMatch(/const showBlockingLoader = false/);
    expect(src).toContain('FAST_HYDRATE_INDICES');
    expect(src).toContain('HEAVY_HYDRATE_INDICES');
    expect(src).toContain('secondaryFetchPromise');
    expect(src).toContain('isBackgroundSyncing');
  });

  it('Layout wraps routes with PageDeferredDataProvider and hydrate banner only', () => {
    const layout = read('components/Layout.tsx');
    expect(layout).toContain('PageDeferredDataProvider');
    expect(layout).toContain('FinancialDataHydrateBanner');
    expect(layout).not.toContain('showBlockingLoader');
  });

  it('deferred page data always uses useDeferredValue on data snapshot', () => {
    const src = read('context/PageDeferredDataContext.tsx');
    expect(src).toContain('useDeferredValue(data)');
    expect(src).not.toMatch(/useDeferredValue\(showHydrateBanner \? null : data\)/);
  });

  it('lazy route suspense uses section placeholders not full-viewport spinners', () => {
    const suspense = read('components/PageRouteSuspense.tsx');
    expect(suspense).toContain('SectionLoadingPlaceholder');
    expect(suspense).not.toContain('min-h-[24rem]');
    expect(suspense).not.toContain('LoadingSpinner');
  });

  it('Summary never full-page blocks on extended metrics', () => {
    const src = read('pages/Summary.tsx');
    expect(src).not.toMatch(/if\s*\(\s*!extendedReady\s*\|\|\s*!reportModel\s*\)\s*\{[\s\S]{0,400}?return\s*\(/);
    expect(src).toContain('NetWorthCockpit');
    expect(src).toContain('ExtendedMetricGate');
  });

  it('Notifications shows section placeholder when context is not ready', () => {
    const src = read('pages/Notifications.tsx');
    expect(src).toContain('SectionLoadingPlaceholder');
    expect(src).not.toMatch(/if\s*\(\s*!ctx\s*\)[\s\S]{0,200}LoadingSpinner/);
  });

  it('investment and engines hubs keep sub-nav outside suspense fallbacks', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('INVESTMENT_SUB_PAGES.map');
    expect(inv).toContain('SectionLoadingPlaceholder');
    expect(inv).toMatch(/<nav[\s\S]{0,1200}INVESTMENT_SUB_PAGES[\s\S]{0,1200}<Suspense/);

    const engines = read('pages/EnginesAndToolsHub.tsx');
    expect(engines).toContain('tabIds');
    expect(engines).toContain('SectionLoadingPlaceholder');
  });

  it('heavy pages defer engine data for non-blocking compute', () => {
    for (const file of [
      'pages/Budgets.tsx',
      'pages/Plan.tsx',
      'pages/Goals.tsx',
      'pages/Transactions.tsx',
      'pages/Analysis.tsx',
      'pages/WealthAnalytics.tsx',
      'pages/Forecast.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain('usePageDeferredData');
      expect(src, file).toContain('engineData');
    }
  });

  it('wealth pages do not full-page block on loading || !data', () => {
    const exempt = new Set([
      'LoginPage.tsx',
      'SignupPage.tsx',
      'PendingApprovalPage.tsx',
      'Installments.tsx',
      'SystemHealth.tsx',
      'FinancialJournal.tsx',
      'StatementHistoryView.tsx',
      'Notifications.tsx',
    ]);
    const offenders: string[] = [];
    for (const file of pageFiles()) {
      if (exempt.has(file)) continue;
      const src = read(`pages/${file}`);
      if (/\bloading\s*\|\|\s*!data\b/.test(src) || /\bloading\s*&&\s*!data\b/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('background work pauses on input but not on nav links', () => {
    expect(read('hooks/useBackgroundWorkInputPause.ts')).toContain('data-nav-link');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('cancelQuoteRefreshOnNav');
  });

  it('recovery plan sub-tab uses section placeholder suspense', () => {
    const src = read('pages/RecoveryPlanView.tsx');
    expect(src).toContain('SectionLoadingPlaceholder');
    expect(src).not.toMatch(/Suspense fallback=\{<div className="text-center p-8/);
  });
});
