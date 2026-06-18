/**
 * Tiered Supabase hydrate: fast unlock, background heavy/secondary, workspace SWR cache.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('supabase hydrate completion', () => {
  it('DataContext uses tiered fetch plan and workspace cache', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toContain('FAST_HYDRATE_INDICES');
    expect(src).toContain('HEAVY_HYDRATE_INDICES');
    expect(src).toContain('readWorkspaceHydrateCache');
    expect(src).toContain('writeWorkspaceHydrateCache');
    expect(src).toContain('isBackgroundSyncing');
    expect(src).not.toContain('CRITICAL_COUNT');
  });

  it('background refetch does not re-show hydrate banner when data already loaded', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toMatch(/const isInitialHydrate = !financialDataLoadedRef\.current/);
    expect(src).toMatch(/if \(isInitialHydrate\)[\s\S]{0,120}pauseBackgroundWork/);
    expect(src).toMatch(/financialDataLoadedRef\.current = true[\s\S]{0,80}setAwaitingInitialHydrate\(false\)/);
  });

  it('FinancialDataHydrateBanner shows subtle background sync state', () => {
    const src = read('components/FinancialDataHydrateBanner.tsx');
    expect(src).toContain('isBackgroundSyncing');
    expect(src).toContain('Finishing background sync');
  });

  it('canonical metrics use partial hydrate data when available', () => {
    const src = read('context/CanonicalFinancialMetricsContext.tsx');
    expect(src).toMatch(
      /const metricsData = data && financialDataHasHydrated\(data\) \? data : null/,
    );
  });

  it('hydrate tiers cover all primary tables before secondary slice', () => {
    const tiers = read('services/workspaceHydrateTiers.ts');
    expect(tiers).toContain('HYDRATE_SECONDARY_START_INDEX = 10');
    expect(tiers).toContain("'transactions'");
    expect(tiers).toContain("'settings'");
  });
});
