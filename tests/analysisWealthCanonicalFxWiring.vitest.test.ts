/**
 * Analysis / Dashboard / Wealth Analytics FX + snapshot SSoT wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('analysisWealthCanonicalFxWiring', () => {
  it('Wealth Analytics uses extended canonical metrics (not resolveSarPerUsd)', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('useExtendedCanonicalMetrics');
    expect(page).toContain('netWorth');
    expect(page).toContain('liquidCashSar');
    expect(page).toContain('investmentsTotalSar');
    expect(page).not.toContain('resolveSarPerUsd');
  });

  it('Dashboard spending model uses canonicalSarPerUsd', () => {
    const page = read('pages/Dashboard.tsx');
    expect(page).toContain('useSpendingCommandCenterModel(workingData, canonicalSarPerUsd');
    expect(page).toContain('tryAutoCaptureNetWorthSnapshot');
  });

  it('Analysis spending, drift, and composition use headlineFx / useCanonicalSpotFx', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toContain('useCanonicalSpotFx');
    expect(page).toContain('useSpendingCommandCenterModel(\n        engineData,\n        headlineFx,');
    expect(page).toContain('detectBudgetDrift(engineData ?? null, headlineFx)');
    expect(page).toContain('computeAllNetWorthChartBucketsSAR(data, headlineFx');
    expect(page).toContain('computeAllNetWorthChartBucketsSAR(data, sarPerUsd');
  });

  it('Summary review pack + snapshot use canonical headline path', () => {
    const page = read('pages/Summary.tsx');
    expect(page).toContain('buildReviewPack(data, canonicalSarPerUsd');
    expect(page).toContain('captureNetWorthSnapshotFromHeadline');
    expect(page).toContain('tryAutoCaptureNetWorthSnapshot');
  });

  it('AIExecutiveSummary and LiveAdvisor use canonical spot FX', () => {
    expect(read('components/dashboard/AIExecutiveSummary.tsx')).toContain('useCanonicalSpotFx');
    expect(read('components/dashboard/AIExecutiveSummary.tsx')).not.toContain('useCurrency');
    const advisor = read('components/LiveAdvisorModal.tsx');
    expect(advisor).toContain('exchangeRate: sarPerUsd');
    expect(advisor).not.toContain('useCurrency');
  });

  it('Layout scheduled snapshot prefers headline.sarPerUsd', () => {
    expect(read('components/Layout.tsx')).toContain('headline?.sarPerUsd ?? exchangeRate');
  });

  it('snapshot capture persists headline net worth (canonical)', () => {
    expect(read('services/netWorthSnapshotCapture.ts')).toContain('captureNetWorthSnapshotFromHeadline');
    expect(read('services/netWorthSnapshotExtended.ts')).toContain('computePersonalHeadlineNetWorthSar');
  });
});
