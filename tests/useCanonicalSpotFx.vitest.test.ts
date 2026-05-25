/**
 * useCanonicalSpotFx must not call hydrateSarPerUsdDailySeries inside useMemo (localStorage side effects).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('useCanonicalSpotFx', () => {
  it('hydrates FX series in useHydrateSarPerUsdDailySeries effect, not inside useMemo', () => {
    const src = readFileSync(join(process.cwd(), 'hooks/useCanonicalFinancialMetrics.ts'), 'utf8');
    const spotFn = src.slice(src.indexOf('export function useCanonicalSpotFx'), src.indexOf('export function useCanonicalFinancialMetrics'));
    expect(spotFn).toContain('useHydrateSarPerUsdDailySeries(data, exchangeRate)');
    expect(spotFn).not.toMatch(/useMemo\([\s\S]*hydrateSarPerUsdDailySeries/);
  });
});

describe('useCanonicalFinancialMetrics', () => {
  it('returns debounced prices as simulatedPrices (same input as compute)', () => {
    const src = readFileSync(join(process.cwd(), 'hooks/useCanonicalFinancialMetrics.ts'), 'utf8');
    const metricsFn = src.slice(src.indexOf('export function useCanonicalFinancialMetrics'));
    expect(metricsFn).toMatch(/simulatedPrices:\s*debouncedPrices/);
    expect(metricsFn).not.toMatch(/return\s*\{[\s\S]*simulatedPrices,\s*\n[\s\S]*getAvailableCashForAccount/);
  });
});
