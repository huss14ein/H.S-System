/**
 * Household Trends — rolling window + no fake actuals.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHouseholdBudgetPlan,
  buildHouseholdEngineInputFromData,
} from '../services/householdBudgetEngine';
import {
  effectiveMonthExpense,
  effectiveMonthExpenseForProjection,
  effectiveMonthIncome,
  selectHouseholdTrendMonths,
  resolveHouseholdTrendsThroughMonth,
} from '../services/householdBudgetAnalytics';

describe('householdTrendsCompletion', () => {
  it('selectHouseholdTrendMonths excludes future months in the plan year', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, monthIndex: i }));
    const last6 = selectHouseholdTrendMonths(months, 7, 6);
    expect(last6.map((m) => m.month)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(selectHouseholdTrendMonths(months, 3, 6).map((m) => m.month)).toEqual([1, 2, 3]);
  });

  it('resolveHouseholdTrendsThroughMonth caps navigator to today in the plan year', () => {
    const ref = new Date('2026-07-15T12:00:00');
    expect(resolveHouseholdTrendsThroughMonth(2026, 12, ref, 1)).toBe(7);
    expect(resolveHouseholdTrendsThroughMonth(2026, 5, ref, 1)).toBe(5);
    expect(resolveHouseholdTrendsThroughMonth(2025, 12, ref, 1)).toBe(12);
    expect(resolveHouseholdTrendsThroughMonth(2027, 3, ref, 1)).toBe(0);
  });

  it('does not copy expected salary into incomeActual for empty months', () => {
    const input = buildHouseholdEngineInputFromData(
      [
        {
          date: '2026-07-05',
          type: 'Income',
          amount: 21060,
          accountId: 'a1',
          category: 'Salary',
        },
        {
          date: '2026-07-10',
          type: 'Expense',
          amount: 37157,
          accountId: 'a1',
          category: 'Food',
        },
      ] as any,
      [{ id: 'a1', type: 'Checking', balance: 0, currency: 'SAR' }] as any,
      [],
      { year: 2026, expectedMonthlySalary: 20000, adults: 2, kids: 0, monthStartDay: 1, uiExchangeRate: 3.75 },
    );
    expect(input.monthlyActualIncome[6]).toBeCloseTo(21060, 0);
    expect(input.monthlyActualExpense[6]).toBeCloseTo(37157, 0);
    // August+ must stay 0 actual income (not salary fill)
    for (let i = 7; i < 12; i++) {
      expect(input.monthlyActualIncome[i]).toBe(0);
      expect(input.monthlyActualExpense[i]).toBe(0);
    }
    expect(input.monthlySalaryPlan.every((v) => v === 20000)).toBe(true);
  });

  it('build plan keeps incomeActual honest and expenseActual ledger-only', () => {
    const input = buildHouseholdEngineInputFromData(
      [
        { date: '2026-06-12', type: 'Expense', amount: 5000, accountId: 'a1', category: 'Food' },
        { date: '2026-07-05', type: 'Income', amount: 10000, accountId: 'a1', category: 'Salary' },
        { date: '2026-07-10', type: 'Expense', amount: 8000, accountId: 'a1', category: 'Food' },
      ] as any,
      [{ id: 'a1', type: 'Checking', balance: 0, currency: 'SAR' }] as any,
      [],
      { year: 2026, expectedMonthlySalary: 10000, monthStartDay: 1, uiExchangeRate: 3.75 },
    );
    const plan = buildHouseholdBudgetPlan(input);
    const jun = plan.months[5];
    const jul = plan.months[6];
    const aug = plan.months[7];
    expect(jun.expenseActual).toBeCloseTo(5000, 0);
    expect(jun.incomeActual).toBe(0);
    expect(jul.incomeActual).toBeCloseTo(10000, 0);
    expect(jul.expenseActual).toBeCloseTo(8000, 0);
    expect(aug.incomeActual).toBe(0);
    expect(aug.expenseActual).toBe(0);
    expect(effectiveMonthExpense(aug)).toBe(0);
    expect(effectiveMonthIncome(aug)).toBe(10000); // planned salary fallback
    expect(effectiveMonthExpense(jun)).toBeCloseTo(5000, 0);
    // Projection helpers may use modeled plan when ledger is empty
    expect(effectiveMonthExpenseForProjection(aug)).toBeGreaterThanOrEqual(0);

    const trends = selectHouseholdTrendMonths(plan.months, 7, 6);
    expect(trends.map((m) => m.month)).toEqual([2, 3, 4, 5, 6, 7]);
    const nets = trends.map((m) => effectiveMonthIncome(m) - effectiveMonthExpense(m));
    // Future months not included; Aug clone cannot appear
    expect(trends.some((m) => m.month === 8)).toBe(false);
    // Jun and Jul differ
    expect(nets[4]).not.toEqual(nets[5]);
  });

  it('Budgets trends UI wires rolling selector helpers', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'pages/Budgets.tsx'), 'utf8');
    expect(src).toContain('selectHouseholdTrendMonths');
    expect(src).toContain('resolveHouseholdTrendsThroughMonth');
    expect(src).toContain('trendsThroughMonth');
    expect(src).toContain('effectiveMonthIncome');
    expect(src).not.toMatch(/householdBudgetEngine\.months\.slice\(-6\)/);
    expect(src).not.toMatch(/selectHouseholdTrendMonths\(householdBudgetEngine\.months,\s*currentMonth/);
  });
});
