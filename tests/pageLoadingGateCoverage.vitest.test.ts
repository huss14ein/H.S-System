/**
 * Wealth pages must not full-page block on `loading || !data` or `showBlockingLoader`.
 * Hydration feedback is global (Layout FinancialDataHydrateBanner + showHydrateBanner).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'pages');
const CONTEXT_DIR = join(process.cwd(), 'context');
const COMPONENTS_DIR = join(process.cwd(), 'components');

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
    expect(offenders, `Do not block on loading || !data in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('wealth pages do not early-return full-page spinners on showBlockingLoader', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx'))) {
      if (PAGE_EXEMPT.has(file)) continue;
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (
        src.includes('showBlockingLoader') &&
        /if\s*\(\s*showBlockingLoader\s*\)\s*\{[\s\S]{0,1200}?return\s*\([\s\S]{0,2500}?(?:min-h-\[(?:20|24)rem\]|(?:^|[^-])h-96)/.test(
          src,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders, `Remove full-page showBlockingLoader return in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('index.css loads from entry, not lazy AuthenticatedAppShell', () => {
    const entry = readFileSync(join(process.cwd(), 'index.tsx'), 'utf8');
    const shell = readFileSync(join(COMPONENTS_DIR, 'AuthenticatedAppShell.tsx'), 'utf8');
    expect(entry).toMatch(/import\s+['"]\.\/index\.css['"]/);
    expect(shell).not.toMatch(/import\s+['"]\.\.\/index\.css['"]/);
  });

  it('Layout shows global hydrate banner', () => {
    const layout = readFileSync(join(COMPONENTS_DIR, 'Layout.tsx'), 'utf8');
    expect(layout).toContain('FinancialDataHydrateBanner');
    expect(layout).toContain('showHydrateBanner');
  });

  it('DataContext exposes showHydrateBanner and does not block pages via showBlockingLoader', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'DataContext.tsx'), 'utf8');
    expect(src).toContain('showHydrateBanner');
    expect(src).toMatch(/const showHydrateBanner = awaitingInitialHydrate/);
    expect(src).toMatch(/const showBlockingLoader = false/);
    expect(src).toContain('financialDataLoadedRef.current = false');
    expect(src).toMatch(/\[auth\?\.user\?\.id\][\s\S]*financialDataLoadedRef\.current = false/);
  });

  it('DataContext side effects skip while loading or awaiting initial hydrate', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'DataContext.tsx'), 'utf8');
    expect(src).toMatch(/loading\s*\|\|[\s\S]*awaitingInitialHydrate[\s\S]*applyRecurringDueToday/);
    expect(src).toMatch(/loading\s*\|\|[\s\S]*awaitingInitialHydrate[\s\S]*duplicateHoldingsReconcileInFlightRef/);
  });

  it('NotificationsContext skips digest while showHydrateBanner', () => {
    const src = readFileSync(join(CONTEXT_DIR, 'NotificationsContext.tsx'), 'utf8');
    expect(src).toContain('showHydrateBanner');
    expect(src).toMatch(/if\s*\(\s*!data\s*\|\|\s*showHydrateBanner\s*\)/);
  });
});
