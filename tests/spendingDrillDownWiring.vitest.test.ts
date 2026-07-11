/**
 * Spending drill-down contract wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBudgetDrillDownAction, buildFiscalMonthDrillDownAction } from '../services/spendingDrillDown';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('spendingDrillDownWiring', () => {
  it('builds full filter-by-budget page action', () => {
    const action = buildBudgetDrillDownAction({
      budgetCategory: 'Food',
      year: 2026,
      month: 5,
      period: 'monthly',
      anchorDate: '2026-05-15',
    });
    expect(action).toMatch(/^filter-by-budget:Food:monthly:2026:5:2026-05-15$/);
  });

  it('charts and command center wire drill-down helpers', () => {
    expect(read('components/spending/SpendingCommandCenter.tsx')).toContain('triggerSpendingDrillDown');
    expect(read('components/dashboard/MomCashflowTrendChart.tsx')).toContain('buildFiscalMonthDrillDownAction');
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('buildBudgetDrillDownAction');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('spendingIntelMapping');
    expect(read('components/analysis/ExpenseBudgetAnalysisPanel.tsx')).toContain('triggerSpendingDrillDown');
    expect(read('components/charts/ExpenseBreakdownChart.tsx')).toContain('buildBudgetDrillDownAction');
  });

  it('fiscal month drill-down action format', () => {
    expect(buildFiscalMonthDrillDownAction('2026-05')).toBe('filter-by-month:2026-05');
  });
});
