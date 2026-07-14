/**
 * Guards against React #310 (hooks count change) on Dashboard surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Dashboard hooks stability', () => {
  it('DashboardCanIInvestCard runs useMemo before capitalDeployment early return', () => {
    const src = read('components/dashboard/DashboardCanIInvestCard.tsx');
    const memoIdx = src.indexOf('useMemo(');
    const earlyReturnIdx = src.indexOf('if (!capitalDeployment) return null');
    expect(memoIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeLessThan(earlyReturnIdx);
  });

  it('canonical metrics hooks do not early-return before local hook calls', () => {
    const src = read('hooks/useCanonicalFinancialMetrics.ts');
    expect(src).toContain('shell?.full.simulatedPrices ?? debounced');
    expect(src).toContain('useCanonicalFinancialMetricsLocal({ skip: !!shell })');
    expect(src).toContain('useDashboardCanonicalMetricsLocal({ skip: !!shell })');
    expect(src).not.toMatch(/if \(shell\) return shell\.full;\s*\n\s*return useCanonicalFinancialMetricsLocal/);
    expect(src).not.toMatch(/if \(shell\) return shell\.dashboard;\s*\n\s*return useDashboardCanonicalMetricsLocal/);
  });
});
