import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('dashboard capital deployment card', () => {
  it('Dashboard renders Can I invest card', () => {
    expect(read('pages/Dashboard.tsx')).toContain('DashboardCanIInvestCard');
  });

  it('card uses computeCapitalDeployment via enhancement insights hook', () => {
    expect(read('components/dashboard/DashboardCanIInvestCard.tsx')).toContain('useFinancialEnhancementInsights');
  });

  it('card drills to top budget drift category', () => {
    const card = read('components/dashboard/DashboardCanIInvestCard.tsx');
    expect(card).toContain('setSelectedCategory');
    expect(card).toContain('buildBudgetDrillDownAction');
    expect(read('pages/Dashboard.tsx')).toContain('AnalyticsCrossFilterRibbon');
  });
});
