/**
 * System-wide household engine E2E — canonical builder used on every surface.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHouseholdEngineInputFromFinancialData,
  buildHouseholdPlanFromFinancialData,
  resolveHouseholdEngineRuntimeContext,
} from '../services/householdEngineFromData';
import { runShockDrill } from '../services/shockDrillEngine';
import { computeHouseholdStressFromData } from '../services/householdBudgetStress';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const sampleData = {
  settings: { monthStartDay: 28 },
  goals: [],
  assets: [],
  investments: [],
  liabilities: [],
  budgets: [],
  accounts: [{ id: 'a1', type: 'Checking', currency: 'SAR', balance: 20000 }],
  transactions: [
    { id: 't1', date: '2026-01-29', accountId: 'a1', amount: 21060, type: 'Income', category: 'Salary' },
    { id: 't2', date: '2026-01-30', accountId: 'a1', amount: 8000, type: 'Expense', category: 'Food' },
  ],
} as unknown as FinancialData;

describe('householdEngineSystemCompletion', () => {
  it('canonical builder respects fiscal monthStartDay', () => {
    const ctx = resolveHouseholdEngineRuntimeContext(sampleData, { year: 2026 });
    expect(ctx.monthStartDay).toBe(28);
    expect(ctx.currentMonthIndex).toBeGreaterThanOrEqual(0);
    const plan = buildHouseholdPlanFromFinancialData(sampleData, { year: 2026 });
    expect(plan).not.toBeNull();
    expect(plan!.balanceProjection.openingLiquid).toBeGreaterThan(0);
  });

  it('future plan year keeps currentMonthIndex at -1 (not clamped to January)', () => {
    const futureYear = new Date().getFullYear() + 2;
    const ctx = resolveHouseholdEngineRuntimeContext(sampleData, { year: futureYear });
    expect(ctx.currentMonthIndex).toBe(-1);
    const input = buildHouseholdEngineInputFromFinancialData(sampleData, { year: futureYear });
    expect(input?.currentMonthIndex).toBe(-1);
    const plan = buildHouseholdPlanFromFinancialData(sampleData, { year: futureYear });
    expect(plan).not.toBeNull();
    expect(plan!.plannedVsActual.actualNet).toBe(0);
  });

  it('stress + shock drill use canonical household plan path', () => {
    const stress = computeHouseholdStressFromData(sampleData, { year: 2026 });
    expect(stress).not.toBeNull();
    const shock = runShockDrill(sampleData, 'job_loss');
    expect(shock).not.toBeNull();
    expect(Number.isFinite(shock!.householdProjectedYearEndDelta)).toBe(true);
  });

  it('wealth summary imports canonical builder', () => {
    const src = read('services/wealthSummaryReportModel.ts');
    expect(src).toContain('buildHouseholdPlanFromFinancialData');
    expect(src).not.toContain('buildHouseholdEngineInputFromData(');
  });

  it('Budgets + Plan wire auto-setup persist helper', () => {
    expect(read('pages/Budgets.tsx')).toContain('persistHouseholdProfileSnapshot');
    expect(read('pages/Plan.tsx')).toContain('persistHouseholdProfileSnapshot');
    expect(read('pages/Plan.tsx')).toContain('runHouseholdAutoSetup');
  });

  it('householdEngineFromData exports input + plan builders', () => {
    const input = buildHouseholdEngineInputFromFinancialData(sampleData, { year: 2026 });
    expect(input?.currentMonthIndex).toBeDefined();
    expect(input?.monthlyActualIncome?.length).toBe(12);
  });
});
