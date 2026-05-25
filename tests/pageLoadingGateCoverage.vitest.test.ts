/**
 * Wealth pages must gate on DataContext.showBlockingLoader, not `loading || !data`
 * (background refetch must not blank the whole page).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'pages');
const CONTEXT_DIR = join(process.cwd(), 'context');

/** No personal Supabase hydrate gate (auth, local-only, or diagnostics). */
const PAGE_EXEMPT = new Set([
  'LoginPage.tsx',
  'SignupPage.tsx',
  'PendingApprovalPage.tsx',
  'Installments.tsx',
  'SystemHealth.tsx',
  'FinancialJournal.tsx',
  'StatementHistoryView.tsx',
  'Notifications.tsx',
]);

describe('page loading gate coverage', () => {
  it('wealth pages do not use loading || !data for full-page blocking', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx'))) {
      if (PAGE_EXEMPT.has(file)) continue;
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (/\bloading\s*\|\|\s*!data\b/.test(src) || /\bloading\s*&&\s*!data\b/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Use showBlockingLoader from DataContext in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('DataContext pages with full-page loading UI use showBlockingLoader', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx'))) {
      if (PAGE_EXEMPT.has(file)) continue;
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (!src.includes('useContext(DataContext)')) continue;
      const hasFullPageBlock =
        /if\s*\([^)]*\bshowBlockingLoader\b/.test(src) ||
        /\{\s*showBlockingLoader\s*\?/.test(src) ||
        /FinancialDataPageGate/.test(src);
      const hasLegacySpinner =
        /aria-busy=["']true["']/.test(src) &&
        (/min-h-\[(?:20|24)rem\]|className="[^"]*h-96/.test(src) || /PageLoading/.test(src));
      if (hasLegacySpinner && !hasFullPageBlock) {
        offenders.push(file);
      }
    }
    expect(offenders, `Add showBlockingLoader gate in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('DataContext resets per-user hydrate flag when auth user id changes', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'DataContext.tsx'), 'utf8');
    expect(src).toContain('financialDataLoadedRef.current = false');
    expect(src).toMatch(/\[auth\?\.user\?\.id\][\s\S]*financialDataLoadedRef\.current = false/);
    expect(src).toContain('setAwaitingInitialHydrate(true)');
    expect(src).toMatch(/const showBlockingLoader = awaitingInitialHydrate/);
  });

  it('DataContext side effects skip while loading or awaiting initial hydrate', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'DataContext.tsx'), 'utf8');
    expect(src).toMatch(/loading\s*\|\|[\s\S]*awaitingInitialHydrate[\s\S]*applyRecurringDueToday/);
    expect(src).toMatch(/loading\s*\|\|[\s\S]*awaitingInitialHydrate[\s\S]*duplicateHoldingsReconcileInFlightRef/);
  });

  it('NotificationsContext skips digest while showBlockingLoader', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'NotificationsContext.tsx'), 'utf8');
    expect(src).toContain('showBlockingLoader');
    expect(src).toMatch(/if\s*\(\s*!data\s*\|\|\s*showBlockingLoader\s*\)/);
  });
});
