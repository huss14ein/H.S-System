/**
 * Budgets household page — E2E wiring for add, auto-setup, trends, KPI labels.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('householdBudgetPageCompletion', () => {
  it('Budgets wires budget add, auto-setup, and trends helpers', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toContain('resolveHouseholdAutoSetup');
    expect(budgets).toContain('selectHouseholdTrendMonths');
    expect(budgets).toContain('await addBudget(budget, { confirmed: true })');
    expect(budgets).toContain('YTD actual net');
    expect(budgets).toContain('resolveHouseholdPlanMonthIndex(currentYear, new Date()');
    expect(budgets).toContain('householdEngineRequested');
    expect(budgets).toContain('setHouseholdEngineRequested(true)');
    expect(budgets).not.toMatch(/householdBudgetEngine\.months\.slice\(-6\)/);
    // Auto-setup cashflow uses canonical spot FX
    expect(budgets).toMatch(
      /accumulateHouseholdYearCashflowSar\(\s*engineData[\s\S]*?sarPerUsd[\s\S]*?resolveHouseholdAutoSetup/,
    );
    // Finalize IncreaseLimit awaits updates and aborts on failure / false return
    const finalize = budgets.slice(
      budgets.indexOf("} else if (request.request_type === 'IncreaseLimit')"),
      budgets.indexOf('if (!finalizedByAtomicAdvance)'),
    );
    expect(finalize).toContain('await updateBudget');
    expect(finalize).toContain('if (!ok)');
    expect(finalize).not.toContain('forEach');
    expect(finalize).toContain('Request was not finalized');
  });

  it('yearly budgets stay visible via match score + canonical month=1 on write', () => {
    const budgets = read('pages/Budgets.tsx');
    const ctx = read('context/DataContext.tsx');
    const fm = read('utils/financialMonth.ts');
    expect(fm).toContain('canonicalBudgetStorageMonth');
    expect(fm).toMatch(/period === 'yearly'[\s\S]{0,200}return budgetView === 'Yearly' \? 250 : 150/);
    expect(fm).toContain('// Group already passed budgetAppliesToFinancialView — always keep a winner.');
    expect(ctx).toContain('canonicalBudgetStorageMonth(periodNorm, budget.month)');
    expect(budgets).toContain('canonicalBudgetStorageMonth(cat.period, bulkAddTargetMonth)');
  });

  it('DataContext addBudget uses snake_case insert payload', () => {
    const ctx = read('context/DataContext.tsx');
    const start = ctx.indexOf('const addBudget = async');
    const end = ctx.indexOf('const updateBudget = async', start);
    const body = ctx.slice(start, end);
    expect(body).toContain('payload.goal_id');
    expect(body).not.toMatch(/\{\s*\.\.\.withUser\(budget\)/);
  });

  it('engine exposes YTD actual net helper and fiscal month index', () => {
    const engine = read('services/householdBudgetEngine.ts');
    expect(engine).toContain('sumHouseholdYtdActualNet');
    expect(engine).toContain('resolveHouseholdPlanMonthIndex');
    expect(engine).toContain('clampHouseholdPlanMonthIndex');
    expect(engine).toContain('projectYearEndLiquidFromCurrent');
    expect(engine).toContain('sumHouseholdCashflowNetAfterPlanYear');
    expect(engine).toContain('estimateYearStartLiquidFromOpening');
    expect(engine).toContain('postPlanYearCashflowNetSar');
  });

  it('Budgets gates Advanced KPI cards and resets trend selection', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toContain('householdEngineLoaded');
    expect(budgets).toMatch(
      /setSelectedTrendMonthIdx\(null\);\s*\}, \[currentYear, currentMonth, trendsThroughMonth\]/,
    );
    expect(budgets).toMatch(/!householdEngineLoaded \?[\s\S]*Advanced summaries appear/);
  });

  it('Budgets guards cloud profile race and surfaces idle compute errors', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toContain('householdProfileLocalEpochRef');
    expect(budgets).toContain('householdEngineComputeError');
    expect(budgets).toContain('planYearFullyElapsed');
  });
});
