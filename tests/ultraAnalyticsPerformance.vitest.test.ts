/**
 * Ultra analytics performance wiring — idle deferral, zone lazy mount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('ultra analytics performance', () => {
  it('single spending model hook shared across surfaces', () => {
    expect(read('hooks/useSpendingCommandCenterModel.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('pages/Dashboard.tsx')).toContain('useSpendingCommandCenterModel');
    expect(read('pages/Budgets.tsx')).toContain('useSpendingCommandCenterModel');
    expect(read('pages/Analysis.tsx')).toContain('useSpendingCommandCenterModel');
  });

  it('wealth analytics mounts zones conditionally', () => {
    const page = read('pages/WealthAnalytics.tsx');
    const investments = read('components/analytics/zones/InvestmentsZone.tsx');
    expect(page).toContain('WealthAnalyticsZoneTabs');
    expect(page).toContain('wealthZone');
    expect(investments).toContain('DeferredMount');
  });

  it('analytics workspace persisted in localStorage', () => {
    expect(read('context/AnalyticsWorkspaceContext.tsx')).toContain('finova_analytics_workspace_v1');
  });
});
