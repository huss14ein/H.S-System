import { describe, expect, it } from 'vitest';
import { resolveHouseholdAutoSetup } from '../services/householdAutoSetup';
import {
  buildHouseholdBudgetPlan,
  buildHouseholdEngineInputFromData,
  estimateYearStartLiquidFromOpening,
  projectYearEndLiquidFromCurrent,
  suggestProfileFromIncomeVariance,
  sumLiquidCash,
} from '../services/householdBudgetEngine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('householdAutoSetup + KPI accuracy', () => {
  it('Auto-setup clears salary override and applies variance/risk profile', () => {
    const unstable = [8000, 22000, 9000, 25000, 8500, 21000];
    const setup = resolveHouseholdAutoSetup({
      currentProfile: 'Moderate',
      riskProfileRaw: 'Aggressive',
      monthlyActualIncome: unstable,
      suggestedMonthlySalary: 21060,
      adults: 2,
      kids: 0,
    });
    expect(setup.expectedMonthlySalary).toBe('');
    expect(setup.clearOverrides).toBe(true);
    expect(setup.bulkAddSalary).toBe(21060);
    expect(setup.profile).toBe('Conservative'); // variance wins over risk
    expect(setup.messages.some((m) => /salary/i.test(m))).toBe(true);
  });

  it('suggestProfileFromIncomeVariance needs 3+ months', () => {
    expect(suggestProfileFromIncomeVariance([10000, 10100])).toBeUndefined();
    expect(suggestProfileFromIncomeVariance([10000, 10050, 10020, 9990])).toBe('Growth');
  });

  it('year-end liquid does not re-apply past months onto current balances', () => {
    const opening = 40_000;
    const salary = Array(12).fill(20_000);
    const income = Array(12).fill(0);
    const expense = Array(12).fill(0);
    // If we wrongly walked all 12 months: 40k + 12*(20k-10k) = 160k
    const projected = projectYearEndLiquidFromCurrent({
      openingLiquidSar: opening,
      monthlySalaryPlan: salary,
      monthlyActualIncome: income,
      monthlyActualExpense: expense,
      currentMonthIndex: 6, // July (0-based) → remaining Aug–Dec = 5 months
      expectedFutureExpenseSar: 10_000,
    });
    expect(projected).toBe(40_000 + 5 * (20_000 - 10_000));
  });

  it('future plan year (index -1) projects all 12 months — not clamped to January', () => {
    const opening = 10_000;
    const salary = Array(12).fill(5_000);
    const projected = projectYearEndLiquidFromCurrent({
      openingLiquidSar: opening,
      monthlySalaryPlan: salary,
      monthlyActualIncome: Array(12).fill(0),
      monthlyActualExpense: Array(12).fill(0),
      currentMonthIndex: -1,
      expectedFutureExpenseSar: 2_000,
    });
    expect(projected).toBe(10_000 + 12 * (5_000 - 2_000));
    const clampedJan = projectYearEndLiquidFromCurrent({
      openingLiquidSar: opening,
      monthlySalaryPlan: salary,
      monthlyActualIncome: Array(12).fill(0),
      monthlyActualExpense: Array(12).fill(0),
      currentMonthIndex: 0,
      expectedFutureExpenseSar: 2_000,
    });
    expect(projected).not.toBe(clampedJan);
    expect(clampedJan).toBe(10_000 + 11 * (5_000 - 2_000));
  });

  it('elapsed plan year peels post-year ledger nets from current liquid', () => {
    const opening = 100_000;
    const salary = Array(12).fill(0);
    const income = Array(12).fill(5_000); // year net = 12*5k - 12*2k = 36k
    const expense = Array(12).fill(2_000);
    const postYearNet = 8_000; // activity after Dec of that year
    const projected = projectYearEndLiquidFromCurrent({
      openingLiquidSar: opening,
      monthlySalaryPlan: salary,
      monthlyActualIncome: income,
      monthlyActualExpense: expense,
      currentMonthIndex: 11,
      expectedFutureExpenseSar: 0,
      planYearFullyElapsed: true,
      postPlanYearCashflowNetSar: postYearNet,
    });
    expect(projected).toBe(100_000 - 8_000);
    const yearStart = estimateYearStartLiquidFromOpening(opening, salary, income, expense, postYearNet);
    expect(yearStart).toBe(92_000 - 36_000);
  });

  it('build plan for past year reconstructs year-end ≠ today liquid when post-year txs exist', () => {
    const input = buildHouseholdEngineInputFromData(
      [
        { date: '2024-03-05', type: 'Income', amount: 10000, accountId: 'a1', category: 'Salary' },
        { date: '2024-03-10', type: 'Expense', amount: 3000, accountId: 'a1', category: 'Food' },
        { date: '2025-06-01', type: 'Income', amount: 20000, accountId: 'a1', category: 'Salary' },
        { date: '2025-06-15', type: 'Expense', amount: 5000, accountId: 'a1', category: 'Food' },
      ] as any,
      [{ id: 'a1', type: 'Checking', balance: 80_000, currency: 'SAR' }] as any,
      [],
      {
        year: 2024,
        expectedMonthlySalary: 10000,
        monthStartDay: 1,
        uiExchangeRate: 3.75,
        sarPerUsd: 3.75,
        currentMonthIndex: 11,
      },
    );
    expect(input.postPlanYearCashflowNetSar).toBeCloseTo(15_000, 0);
    const plan = buildHouseholdBudgetPlan(input);
    expect(plan.balanceProjection.planYearFullyElapsed).toBe(true);
    expect(plan.balanceProjection.projectedYearEndLiquid).toBeCloseTo(80_000 - 15_000, 0);
    expect(plan.balanceProjection.openingLiquid).toBeCloseTo(65_000 - 7_000, 0);
  });

  it('actualNet ignores future-month ledger rows (YTD through current month)', () => {
    const input = buildHouseholdEngineInputFromData(
      [
        { date: '2026-07-05', type: 'Income', amount: 10000, accountId: 'a1', category: 'Salary' },
        { date: '2026-07-10', type: 'Expense', amount: 4000, accountId: 'a1', category: 'Food' },
        { date: '2026-12-05', type: 'Income', amount: 50000, accountId: 'a1', category: 'Bonus' },
      ] as any,
      [{ id: 'a1', type: 'Checking', balance: 0, currency: 'SAR' }] as any,
      [],
      { year: 2026, monthStartDay: 1, uiExchangeRate: 3.75, currentMonthIndex: 6 },
    );
    const plan = buildHouseholdBudgetPlan(input);
    expect(plan.plannedVsActual.actualNet).toBeCloseTo(6000, 0);
  });

  it('build plan: actualNet is ledger-only; projection uses currentMonthIndex', () => {
    const input = buildHouseholdEngineInputFromData(
      [
        { date: '2026-03-05', type: 'Income', amount: 10000, accountId: 'a1', category: 'Salary' },
        { date: '2026-03-10', type: 'Expense', amount: 3000, accountId: 'a1', category: 'Food' },
        { date: '2026-07-05', type: 'Income', amount: 10000, accountId: 'a1', category: 'Salary' },
        { date: '2026-07-12', type: 'Expense', amount: 4000, accountId: 'a1', category: 'Food' },
      ] as any,
      [
        { id: 'a1', type: 'Checking', balance: 50000, currency: 'SAR' },
        { id: 'inv', type: 'Investment', balance: 999999, currency: 'SAR' }, // must NOT inflate bank liquid
      ] as any,
      [],
      {
        year: 2026,
        expectedMonthlySalary: 10000,
        monthStartDay: 1,
        uiExchangeRate: 3.75,
        currentMonthIndex: 6,
      },
    );
    expect(input.liquidBalance).toBeCloseTo(50000, 0);
    expect(input.monthlyActualIncome[7]).toBe(0);

    const plan = buildHouseholdBudgetPlan(input);
    expect(plan.plannedVsActual.actualNet).toBeCloseTo(10000 - 3000 + 10000 - 4000, 0);
    // Opening 50k + Aug–Dec (5)*(10000 - avgExpense). avg = (3000+4000)/2 = 3500 → +5*6500
    expect(plan.balanceProjection.projectedYearEndLiquid).toBeCloseTo(50000 + 5 * (10000 - 3500), 0);
    expect(plan.balanceProjection.openingLiquid).toBeCloseTo(50000, 0);
  });

  it('sumLiquidCash excludes Investment portfolio balances', () => {
    expect(
      sumLiquidCash(
        [
          { type: 'Checking', balance: 1000, currency: 'SAR' },
          { type: 'Investment', balance: 50000, currency: 'SAR' },
        ],
        3.75,
      ),
    ).toBe(1000);
  });

  it('Budgets Auto-setup wires resolveHouseholdAutoSetup', () => {
    const src = readFileSync(join(process.cwd(), 'pages/Budgets.tsx'), 'utf8');
    expect(src).toContain('buildHouseholdProfileSnapshot');
    expect(src).toContain('setBulkAddSalary(setup.bulkAddSalary)');
    expect(src).toContain('household_budget_profiles');
    expect(src).not.toMatch(/householdBudgetEngine as unknown as \{ suggestedProfile/);
  });
});
