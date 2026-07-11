/**
 * Analytics workspace context — persistence + cross-page state + URL sync.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAwParam, serializeAwParam } from '../context/AnalyticsWorkspaceContext';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('analyticsWorkspaceContext', () => {
  it('persists period, scope, selection, zones, and studio tabs', () => {
    const src = read('context/AnalyticsWorkspaceContext.tsx');
    expect(src).toContain('finova_analytics_workspace_v1');
    expect(src).toContain('periodPreset');
    expect(src).toContain('selectedCategory');
    expect(src).toContain('selectedMonthKey');
    expect(src).toContain('wealthZone');
    expect(src).toContain('analysisExplorerTab');
    expect(src).toContain('analysisStudioTab');
  });

  it('provider wraps authenticated shell', () => {
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('AnalyticsWorkspaceProvider');
  });

  it('visit snapshot service tracks deltas on Analysis and Wealth Analytics', () => {
    expect(read('services/analyticsVisitSnapshot.ts')).toContain('computeVisitDelta');
    expect(read('pages/Analysis.tsx')).toContain('AnalyticsVisitDeltaChips');
    expect(read('pages/WealthAnalytics.tsx')).toContain('AnalyticsVisitDeltaChips');
    expect(read('pages/WealthAnalytics.tsx')).toContain('saveAnalyticsVisitSnapshot');
  });

  it('URL sync uses aw param with debounce and whitelisted keys', () => {
    const src = read('context/AnalyticsWorkspaceContext.tsx');
    expect(src).toContain("const URL_PARAM = 'aw'");
    expect(src).toContain('URL_DEBOUNCE_MS = 300');
    expect(src).toContain("key === 'period'");
    expect(src).toContain("key === 'scope'");
    expect(src).toContain("key === 'zone'");
    expect(src).toContain("key === 'tab'");
    expect(src).toContain("key === 'cat'");
    expect(src).toContain("key === 'studio'");
    expect(src).toContain('history.replaceState');
  });

  it('parseAwParam and serializeAwParam round-trip workspace keys', () => {
    const parsed = parseAwParam('period:MTD;scope:personal;zone:cash;tab:merchants;cat:Food');
    expect(parsed.periodPreset).toBe('MTD');
    expect(parsed.scope).toBe('personal');
    expect(parsed.wealthZone).toBe('cash');
    expect(parsed.analysisExplorerTab).toBe('merchants');
    expect(parsed.selectedCategory).toBe('Food');

    const serialized = serializeAwParam({
      periodPreset: 'MTD',
      scope: 'personal',
      selectedCategory: 'Food',
      selectedMonthKey: null,
      wealthZone: 'cash',
      analysisExplorerTab: 'merchants',
      analysisStudioTab: 'explore',
    });
    expect(serialized).toContain('zone:cash');
    expect(serialized).toContain('tab:merchants');
    expect(serialized).toContain('cat:Food');
  });

  it('position studio tab shows WealthPulseRing', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toMatch(/analysisStudioTab === 'position'[\s\S]*WealthPulseRing/);
  });

  it('URL sync includes fiscal month key', () => {
    const ctx = read('context/AnalyticsWorkspaceContext.tsx');
    expect(ctx).toContain("key === 'month'");
    expect(ctx).toContain('selectedMonthKey');
  });
});
