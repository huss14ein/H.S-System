import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  financialMonthKeyLabel,
  financialMonthKeyOverlapsIsoRange,
} from '../services/operationsCockpitFinancialMonth';
import { budgetsForFinancialMonthView } from '../utils/financialMonth';

const read = (path: string) => readFileSync(path, 'utf8');

describe('operations cockpit financial month', () => {
  it('labels fiscal month keys with range when start day > 1', () => {
    expect(financialMonthKeyLabel('2026-06', 28, 'en')).toContain('–');
    expect(financialMonthKeyLabel('2026-06', 1, 'en')).toMatch(/Jun/i);
  });

  it('overlaps calendar filter with fiscal month window', () => {
    expect(financialMonthKeyOverlapsIsoRange('2026-06', 28, '2026-06-15', '2026-07-10')).toBe(true);
    expect(financialMonthKeyOverlapsIsoRange('2026-01', 28, '2026-06-01', '2026-06-30')).toBe(false);
  });

  it('resolves unspecified budget year/month to active financial view', () => {
    const viewKey = { year: 2026, month: 6 };
    const rows = budgetsForFinancialMonthView(
      [{ id: 'b1', category: 'Food', year: 0, month: 0, period: 'monthly', limit: 2000 }],
      viewKey,
      28,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe('Food');
  });
});

describe('Wealth Analytics operations cockpit wiring', () => {
  it('uses fiscal month helpers in burn rate, donuts, and cashflow chart', () => {
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('financialMonthLabel');
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('mode: \'spend_only\'');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('dateInRange');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('DonutLegend');
    expect(read('components/dashboard/MomCashflowTrendChart.tsx')).toContain('financialMonthKeyLabel');
    expect(read('components/dashboard/MomCashflowTrendChart.tsx')).toContain('financialMonthKeyOverlapsIsoRange');
  });
});
