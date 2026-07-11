/**
 * Wealth Analytics zone refactor + creative chart components.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('wealthAnalyticsZones', () => {
  it('uses zone components with active-zone-only mount', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain("wealthZone === 'overview'");
    expect(page).toContain('OverviewZone');
    expect(page).toContain('WealthZone');
    expect(page).toContain('InvestmentsZone');
    expect(page).toContain('CashSpendZone');
    expect(page).not.toContain('wealthZone === \'overview\' || wealthZone === \'wealth\'');
  });

  it('zone files exist under components/analytics/zones', () => {
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('WealthPulseRing');
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('WealthChangeWaterfallChart');
    expect(read('components/analytics/zones/CashSpendZone.tsx')).toContain('SpendingCommandCenter');
  });

  it('creative chart components wired', () => {
    expect(read('components/analytics/WealthPulseRing.tsx')).toContain('WealthPulseRing');
    expect(read('components/analytics/WealthChangeWaterfallChart.tsx')).toContain('InteractiveChartShell');
    expect(read('components/analytics/InteractiveChartShell.tsx')).toContain('InteractiveChartShell');
  });
});
