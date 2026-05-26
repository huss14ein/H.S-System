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
    const src = readFileSync(join(process.cwd(), 'hooks/canonicalFinancialMetricsBundle.ts'), 'utf8');
    expect(src).toMatch(/simulatedPrices:\s*debouncedPrices/);
    expect(src).toContain('buildCanonicalFinancialMetricsResult');
  });

  it('shell provider is mounted in AuthenticatedAppShell', () => {
    const src = readFileSync(join(process.cwd(), 'components/AuthenticatedAppShell.tsx'), 'utf8');
    expect(src).toContain('CanonicalFinancialMetricsProvider');
  });
});
