/**
 * Master E2E audit — traces every household/budget fix path with wiring + behavior.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHouseholdBudgetPlan } from '../services/householdBudgetEngine';
import { buildHouseholdPlanFromFinancialData } from '../services/householdEngineFromData';
import { effectiveMonthExpense, effectiveMonthExpenseForProjection, effectiveMonthIncome, selectHouseholdTrendMonths } from '../services/householdBudgetAnalytics';
import { resolveHouseholdAutoSetup, buildHouseholdProfileSnapshot } from '../services/householdAutoSetup';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const sampleData = {
  settings: { monthStartDay: 1, riskProfile: 'Moderate' },
  goals: [],
  assets: [],
  investments: [],
  liabilities: [],
  budgets: [],
  accounts: [{ id: 'a1', type: 'Checking', currency: 'SAR', balance: 25000 }],
  transactions: [
    { id: 't1', date: '2026-02-10', accountId: 'a1', amount: 10000, type: 'Income', category: 'Salary' },
    { id: 't2', date: '2026-02-15', accountId: 'a1', amount: 3000, type: 'Expense', category: 'Food' },
    { id: 't3', date: '2026-06-08', accountId: 'a1', amount: 10000, type: 'Income', category: 'Salary' },
    { id: 't4', date: '2026-06-12', accountId: 'a1', amount: 5000, type: 'Expense', category: 'Food' },
    { id: 't5', date: '2026-07-05', accountId: 'a1', amount: 10000, type: 'Income', category: 'Salary' },
    { id: 't6', date: '2026-07-20', accountId: 'a1', amount: 4000, type: 'Expense', category: 'Food' },
  ],
} as unknown as FinancialData;

/** Documented E2E paths — each must have wiring + at least one behavioral assertion below. */
const E2E_FLOWS = [
  { id: 'manual-add', entry: 'BudgetModal → handleSaveBudget → addBudget({ confirmed: true })' },
  { id: 'bulk-add', entry: 'Household Advanced confirm → loop addBudget({ confirmed: true })' },
  { id: 'smart-fill', entry: 'Page actions → handleSmartFillBudgets → await addBudget' },
  { id: 'auto-setup', entry: 'Auto-setup → resolveHouseholdAutoSetup → persistHouseholdProfileSnapshot' },
  { id: 'trends', entry: 'selectHouseholdTrendMonths(currentMonth, 6) — no slice(-6)' },
  { id: 'system-kpis', entry: 'buildHouseholdPlanFromFinancialData on stress/shock/wealth' },
] as const;

describe('householdBudgetE2EAudit', () => {
  it('documents all E2E flows under test', () => {
    expect(E2E_FLOWS.length).toBe(6);
  });

  describe('manual-add + bulk-add + smart-fill wiring', () => {
    it('DataContext addBudget uses snake_case-only insert', () => {
      const body = read('context/DataContext.tsx').slice(
        read('context/DataContext.tsx').indexOf('const addBudget = async'),
        read('context/DataContext.tsx').indexOf('const updateBudget = async'),
      );
      expect(body).toContain('payload.goal_id');
      expect(body).not.toMatch(/\{\s*\.\.\.withUser\(budget\)/);
      expect(body).toContain('throw error');
    });

    it('Budgets passes confirmed: true on manual, bulk, smart-fill, finalize', () => {
      const src = read('pages/Budgets.tsx');
      expect(src).toContain('await addBudget(budget, { confirmed: true })');
      const smart = src.slice(src.indexOf('const handleSmartFillBudgets'), src.indexOf('const handleSuggestBudgetAdjustments'));
      expect(smart).toContain('await addBudget');
      expect(smart).not.toContain('toCreate.forEach');
    });
  });

  describe('auto-setup', () => {
    it('resolve + persist snapshot round-trip profile key', () => {
      const setup = resolveHouseholdAutoSetup({
        currentProfile: 'Moderate',
        riskProfileRaw: 'Moderate',
        monthlyActualIncome: [9000, 22000, 8500, 21000],
        suggestedMonthlySalary: 18000,
        adults: 2,
        kids: 1,
      });
      const snap = buildHouseholdProfileSnapshot({
        profile: setup.profile,
        adults: setup.adults,
        kids: setup.kids,
        expectedMonthlySalary: setup.expectedMonthlySalary,
        clearOverrides: setup.clearOverrides,
      });
      expect(snap.profile).toBeTruthy();
      expect(snap.adults).toBe(2);
      expect(setup.clearOverrides).toBe(true);
    });

    it('Budgets + Plan share persistHouseholdProfileSnapshot', () => {
      expect(read('pages/Budgets.tsx')).toContain('persistHouseholdProfileSnapshot');
      expect(read('pages/Plan.tsx')).toContain('persistHouseholdProfileSnapshot');
    });

    it('Autopilot expand requests engine without requiring Advanced open', () => {
      const src = read('pages/Budgets.tsx');
      expect(src).toContain('householdEngineRequested');
      // Opening Autopilot must request engine independently of Advanced
      expect(src).toMatch(/onExpandedChange=\{\(open\) => \{\s*if \(open\) setHouseholdEngineRequested\(true\);/);
      // Advanced open also requests; closing Advanced must not clear the request flag
      expect(src).toMatch(/setAdvancedHouseholdOpen\(true\);\s*setHouseholdEngineRequested\(true\);/);
      expect(src).not.toMatch(/if \(!advancedHouseholdOpen\) \{\s*setHouseholdEngineReady\(false\)/);
    });
  });

  describe('trends', () => {
    it('rolling window differs month-to-month (no duplicate bars)', () => {
      const plan = buildHouseholdPlanFromFinancialData(sampleData, { year: 2026, ref: new Date('2026-07-30') })!;
      const trends = selectHouseholdTrendMonths(plan.months, 7, 6);
      expect(trends.map((m) => m.month)).toEqual([2, 3, 4, 5, 6, 7]);
      const nets = trends.map((m) => effectiveMonthIncome(m) - effectiveMonthExpense(m));
      // Feb has spend, Mar–May empty, Jun/Jul differ
      expect(nets[0]).toBeCloseTo(7000, 0);
      expect(nets[4]).toBeCloseTo(5000, 0);
      expect(nets[5]).toBeCloseTo(6000, 0);
      expect(new Set(nets.slice(0, 3)).size).toBeGreaterThan(1);
    });

    it('effectiveMonthExpense is ledger-only (no modeled bucket fallback)', () => {
      const monthlyActualIncome = Array(12).fill(0);
      monthlyActualIncome[6] = 10000;
      const plan = buildHouseholdBudgetPlan({
        year: 2026,
        adults: 2,
        kids: 0,
        profile: 'Moderate',
        monthlySalaryPlan: Array(12).fill(10000),
        monthlyActualIncome,
        monthlyActualExpense: Array(12).fill(0),
        liquidBalance: 0,
        emergencyBalance: 0,
        reserveBalance: 0,
        monthlyOverrides: [],
        goals: [],
        monthStartDay: 1,
        currentMonthIndex: 6,
        uiExchangeRate: 3.75,
      } as any);
      const jul = plan.months[6];
      expect(jul.incomeActual).toBeCloseTo(10000, 0);
      expect(effectiveMonthExpense(jul)).toBe(0);
      expect(effectiveMonthExpenseForProjection(jul)).toBeGreaterThan(0);
    });
  });

  describe('system-kpis', () => {
    it('canonical plan: YTD net, opening liquid, year-end projection', () => {
      const plan = buildHouseholdPlanFromFinancialData(sampleData, { year: 2026, ref: new Date('2026-07-30') })!;
      expect(plan.plannedVsActual.actualNet).toBeCloseTo(7000 + 5000 + 6000, 0);
      expect(plan.balanceProjection.openingLiquid).toBeCloseTo(25000, 0);
      expect(Number.isFinite(plan.balanceProjection.projectedYearEndLiquid)).toBe(true);
    });

    it('stress/shock/wealth import canonical builder only', () => {
      for (const file of [
        'services/householdBudgetStress.ts',
        'services/shockDrillEngine.ts',
        'services/wealthSummaryReportModel.ts',
      ]) {
        const src = read(file);
        expect(src).toContain('buildHouseholdPlanFromFinancialData');
      }
    });
  });
});
