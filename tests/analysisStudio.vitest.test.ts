/**
 * Analysis studio — Phase 6B wiring guards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('analysisStudio', () => {
  it('uses three studio tabs from workspace context', () => {
    expect(read('context/AnalyticsWorkspaceContext.tsx')).toContain('analysisStudioTab');
    expect(read('components/analysis/AnalysisStudioTabs.tsx')).toContain('Explore');
    expect(read('components/analysis/AnalysisStudioTabs.tsx')).toContain('Command center');
    expect(read('components/analysis/AnalysisStudioTabs.tsx')).toContain('Position');
    expect(read('pages/Analysis.tsx')).toContain('AnalysisStudioTabs');
  });

  it('mounts only the active studio tab', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toContain("analysisStudioTab === 'explore'");
    expect(page).toContain("analysisStudioTab === 'command'");
    expect(page).toContain("analysisStudioTab === 'position'");
  });

  it('asset liability chart lives on position tab only', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toContain('AssetLiabilityChart');
    const positionBlock = page.split("analysisStudioTab === 'position'")[1] ?? '';
    expect(positionBlock).toContain('<AssetLiabilityChart');
    const exploreBlock = page.split("analysisStudioTab === 'explore'")[1]?.split("analysisStudioTab === 'command'")[0] ?? '';
    expect(exploreBlock).not.toContain('<AssetLiabilityChart');
  });

  it('command center tab lazy-loads expense budget panel', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toContain('LazyExpenseBudgetAnalysisPanel');
    expect(page).toContain('hideDetailPanel');
    expect(page).toMatch(/analysisStudioTab === 'command'[\s\S]*LazyExpenseBudgetAnalysisPanel/);
  });

  it('page actions dropdown has single investments link', () => {
    const page = read('pages/Analysis.tsx');
    const matches = page.match(/label: 'Investments'/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('scope-aware page description', () => {
    const page = read('pages/Analysis.tsx');
    expect(page).toContain('pageDescription');
    expect(page).toContain("scope === 'household'");
    expect(page).toContain('description={pageDescription}');
  });

  it('visit delta action chips on analysis', () => {
    expect(read('pages/Analysis.tsx')).toContain('AnalyticsVisitDeltaChips');
  });
});
