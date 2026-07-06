/**
 * Analytics workspace context — persistence + cross-page state.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('analyticsWorkspaceContext', () => {
  it('persists period, scope, selection, and zones', () => {
    const src = read('context/AnalyticsWorkspaceContext.tsx');
    expect(src).toContain('finova_analytics_workspace_v1');
    expect(src).toContain('periodPreset');
    expect(src).toContain('selectedCategory');
    expect(src).toContain('selectedMonthKey');
    expect(src).toContain('wealthZone');
    expect(src).toContain('analysisExplorerTab');
  });

  it('provider wraps authenticated shell', () => {
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('AnalyticsWorkspaceProvider');
  });

  it('visit snapshot service tracks deltas on Analysis and Wealth Analytics', () => {
    expect(read('services/analyticsVisitSnapshot.ts')).toContain('computeVisitDelta');
    expect(read('pages/Analysis.tsx')).toContain('visitDelta');
    expect(read('pages/WealthAnalytics.tsx')).toContain('visitDelta');
    expect(read('pages/WealthAnalytics.tsx')).toContain('saveAnalyticsVisitSnapshot');
  });
});
