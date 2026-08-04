/**
 * Interactive responsiveness E2E — shell + heavy pages defer work off the critical path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('interactiveResponsivenessCompletion', () => {
  it('Dashboard lazy-loads recharts sections with Suspense + DeferredMount', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toMatch(/lazy\(\(\) => import\('\.\.\/components\/charts\/CashflowChart'\)\)/);
    expect(dash).toMatch(/lazy\(\(\) => import\('\.\.\/components\/charts\/NetWorthCockpit'\)\)/);
    expect(dash).toMatch(/lazy\(\(\) => import\('\.\.\/components\/charts\/PerformanceTreemap'\)\)/);
    expect(dash).toContain('<DeferredMount');
    expect(dash).toContain('<Suspense');
  });

  it('CommandPalette mounts heavy panel only when open', () => {
    const src = read('components/CommandPalette.tsx');
    expect(src).toContain('CommandPalettePanel');
    expect(src).toMatch(/if \(!props\.isOpen\) return null/);
    expect(src).toContain('useExtendedCanonicalMetrics');
  });

  it('NotificationsContext defers fingerprint and avoids full canonical metrics hook', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toContain('useDeferredValue(notificationsDataFingerprint)');
    expect(src).toContain('computeSalaryInvestmentKpis(data, sarPerUsd)');
    expect(src).toContain('useCanonicalSpotFx');
    expect(src).not.toMatch(/\{\s*salaryInvestment[^}]*\}\s*=\s*useCanonicalFinancialMetrics\(\)/);
  });

  it('Budgets defers household engine via idle compute hook', () => {
    const src = read('pages/Budgets.tsx');
    expect(src).toContain('useDeferredIdleCompute');
    expect(src).toContain('scheduleIdleWorkAsync');
    expect(src).toContain('householdEngineRequested');
    expect(src).toContain('householdEngineComputeReady');
    expect(src).toContain('householdEngineComputeError');
    expect(src).toContain('Projection failed');
    expect(src).toContain('householdProfileLocalEpochRef');
    expect(src).not.toMatch(/const householdBudgetEngine = useMemo\(\(\) => \{\s*if \(!householdEngineReady\)/);
    expect(src).toContain('engineLoaded');
    expect(src).toContain('householdEngineLoaded');
    expect(src).toContain('Loading projection');
    expect(src).toMatch(/engineLoaded \? \([\s\S]*projectedYearEndLiquid/);
    expect(src).toMatch(/!householdEngineLoaded \?[\s\S]*Loading projection/);
    expect(src).toContain('setSelectedTrendMonthIdx(null)');
  });

  it('Plan defers household engine off first paint', () => {
    const src = read('pages/Plan.tsx');
    expect(src).toContain('useDeferredIdleCompute');
    expect(src).toContain('planHouseholdEngineReady');
    expect(src).toContain('EMPTY_HOUSEHOLD_BUDGET_PLAN');
    expect(src).toContain('householdProfileLocalEpochRef');
    expect(src).toContain('value: householdBudgetEngine');
    expect(src).not.toMatch(/const householdBudgetEngine = useMemo\(\(\) => \{/);
  });

  it('useDeferredIdleCompute waits for nav pause and surfaces compute errors', () => {
    const hook = read('hooks/useDeferredIdleCompute.ts');
    expect(hook).toContain('waitUntilBackgroundWorkResumed');
    expect(hook).toContain('DeferredIdleComputeResult');
    expect(hook).toContain('setError');
    expect(hook).not.toMatch(/if \(isBackgroundWorkPaused\(\) \|\| aborted\) return;/);
  });

  it('live quote path is manual-only with DB persistence', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('SAHMK_RATE_LIMIT_COOLDOWN_MS');
    expect(sim).toContain('MAX_LIVE_FETCH_PER_TICK = 12');
    expect(sim).toContain('SAHMK_MAX_CODES_PER_BATCH');
    expect(sim).toContain('tadawulOnly');
    expect(sim).toContain('holdingPersistChainRef');
    expect(sim).toContain("const rateLimited = isQuoteRefreshInCooldown('default')");
    expect(sim).toContain('consumeSahmkBatchDeferredSymbols');
    expect(sim).toContain('upsertMarketQuotesToDb');
    expect(sim).not.toContain('MARKET_SESSION_POLL_MS');
    expect(read('services/sahmkQuote.ts')).toContain('SAHMK_MAX_CODES_PER_BATCH');
    expect(read('services/sahmkQuote.ts')).toContain('SAHMK_FETCH_CONCURRENCY');
    expect(read('services/geminiService.ts')).toContain("isQuoteRefreshInCooldown('sahmk')");
    expect(read('services/geminiService.ts')).toContain('usSymbols.length === 0');
    expect(sim).toContain('MANUAL_INTER_SCOPE_DELAY_MS');
    expect(sim).toContain('holdingPersistChainRef');
  });

  it('suggested adjustments await updateBudget and keep panel on total failure', () => {
    const src = read('pages/Budgets.tsx');
    const apply = src.slice(
      src.indexOf('const applySuggestedAdjustments'),
      src.indexOf('const submitBudgetRequest'),
    );
    expect(apply).toContain('await updateBudget');
    expect(apply).not.toContain('forEach');
    expect(apply).toContain('setSuggestedAdjustments(remaining)');
    expect(apply).toContain('if (ok)');
  });

  it('WealthAnalytics lazy-loads zone tabs', () => {
    const src = read('pages/WealthAnalytics.tsx');
    expect(src).toMatch(/lazy\(\(\) => import\('\.\.\/components\/analytics\/zones\/OverviewZone'\)\)/);
    expect(src).toMatch(/lazy\(\(\) => import\('\.\.\/components\/analytics\/zones\/WealthZone'\)\)/);
    expect(src).toContain('ZoneSuspense');
  });

  it('shell wires PerformanceProvider before canonical metrics', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('<PerformanceProvider>');
    expect(shell).toMatch(/<PerformanceProvider>[\s\S]*<CanonicalFinancialMetricsProvider>/);
  });

  it('canonical metrics adapt quote debounce to performance mode', () => {
    const ctx = read('context/CanonicalFinancialMetricsContext.tsx');
    expect(ctx).toContain('usePerformanceOptional');
    expect(ctx).toContain('quoteDebounceMs');
  });

  it('Layout Cmd+K toggles palette without requiring panel to be mounted', () => {
    const layout = read('components/Layout.tsx');
    expect(layout).toMatch(/metaKey \|\| event\.ctrlKey/);
    expect(layout).toContain("event.key === 'k'");
    expect(layout).toContain('setIsCommandPaletteOpen');
    expect(layout).toContain('<CommandPalette');
  });
});
