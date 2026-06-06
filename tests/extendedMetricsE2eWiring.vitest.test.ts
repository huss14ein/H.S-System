/**
 * Ensures wealth surfaces that show phase-2 canonical fields gate on extendedReady.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('extended metrics end-to-end wiring', () => {
  it('shared helpers and gate components exist', () => {
    expect(read('services/extendedMetricsPresentation.ts')).toContain('pickInvestmentsTotalSar');
    expect(read('components/shared/ExtendedMetricGate.tsx')).toContain('SectionLoadingPlaceholder');
    expect(read('context/InvestmentsMetricsContext.tsx')).toContain('useExtendedCanonicalMetrics');
  });

  it('full-page wealth surfaces wait for extended metrics', () => {
    for (const file of ['pages/Summary.tsx', 'pages/WealthAnalytics.tsx']) {
      const src = read(file);
      expect(src, file).toContain('useExtendedCanonicalMetrics');
      expect(src, file).toMatch(/extendedReady/);
    }
  });

  it('partial wealth surfaces pick extended fields with extendedReady', () => {
    const checks: Array<{ path: string; patterns: string[] }> = [
      { path: 'pages/InvestmentOverview.tsx', patterns: ['useExtendedCanonicalMetrics', 'extendedReady'] },
      { path: 'pages/Accounts.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickInvestmentsTotalSar'] },
      { path: 'pages/Analysis.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickInvestmentsTotalSar'] },
      { path: 'pages/Commodities.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickCommoditiesValueSar', 'ExtendedMetricGate'] },
      { path: 'pages/Assets.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickCommoditiesValueSar', 'ExtendedMetricGate'] },
      { path: 'pages/WealthUltraDashboard.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickInvestmentsTotalSar'] },
      { path: 'pages/Settings.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickWealthSummary'] },
      { path: 'pages/Investments.tsx', patterns: ['pickInvestmentsTotalSar', 'extendedReady'] },
      { path: 'components/DashboardKpiQualityPanel.tsx', patterns: ['useExtendedCanonicalMetrics', 'pickWealthSummary', 'extendedReady'] },
    ];
    for (const { path, patterns } of checks) {
      const src = read(path);
      for (const p of patterns) {
        expect(src, `${path} missing ${p}`).toContain(p);
      }
    }
  });

  it('layout shows global extended-metrics banner', () => {
    expect(read('components/Layout.tsx')).toContain('CanonicalMetricsExtendedBanner');
  });
});
