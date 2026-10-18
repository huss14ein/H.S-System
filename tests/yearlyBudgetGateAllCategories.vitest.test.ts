/**
 * Guarantees the annual overspend gate is category-agnostic: any budget with
 * period: 'yearly' gets YTD vs annual treatment — Housing Rent is only one example.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isYearlyPeriodBudget,
  resolveBudgetCategoryHeadroom,
  shouldWarnBudgetOverspend,
  lumpyYearlyMonthExcessWithinPlanSar,
  adjustMonthExpensesForYearlyPlanHeadroom,
} from '../services/budgetOverspendGate';
import { detectSpendingAnomaliesFromTransactions } from '../services/householdBudgetAnalytics';
import { detectBudgetDrift } from '../services/budgetDrift';
import { detectPlanExpenseOutliers } from '../services/planExpenseOutliers';
import type { Account, Budget, FinancialData, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Representative yearly categories from household engine + a custom user yearly. */
const YEARLY_CATEGORIES = [
  'Housing Rent',
  'School Tuition (Semester)',
  'Iqama Renewal',
  'Vehicle Insurance',
  'Istimara (Registration)',
  'Fahas (MVPI)',
  'Dependent Fees',
  'Exit/Re-entry Visa',
  'Zakat',
  'Custom Yearly Envelope',
] as const;

describe('yearly budget gate — all categories', () => {
  const finKey = { year: 2026, month: 6 };
  const accounts: Account[] = [
    { id: 'a1', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
  ];

  it('isYearlyPeriodBudget keys on period only (any category name)', () => {
    expect(isYearlyPeriodBudget({ period: 'yearly' })).toBe(true);
    expect(isYearlyPeriodBudget({ period: 'Yearly' })).toBe(true);
    expect(isYearlyPeriodBudget({ period: 'monthly' })).toBe(false);
    expect(isYearlyPeriodBudget({ period: 'weekly' })).toBe(false);
    expect(isYearlyPeriodBudget({})).toBe(false);
  });

  it.each([...YEARLY_CATEGORIES])(
    'does not warn for lumpy month on yearly category "%s" while YTD ≤ annual plan',
    (category) => {
      const budgets: Budget[] = [
        {
          id: `y-${category}`,
          category,
          limit: 24_000,
          period: 'yearly',
          month: 1,
          year: 2026,
        } as Budget,
      ];
      const headroom = resolveBudgetCategoryHeadroom({
        category,
        finKey,
        monthStartDay: 1,
        budgets,
        monthSpentSar: 12_000,
        ytdSpentSar: 12_000,
      });
      expect(headroom.mode).toBe('annual');
      expect(headroom.hasAnnualEnvelope).toBe(true);
      expect(headroom.lumpyMonthWithinAnnual).toBe(true);
      expect(shouldWarnBudgetOverspend(headroom)).toBe(false);
    },
  );

  it('strips lumpy excess for multiple yearly categories in one month', () => {
    const budgets = YEARLY_CATEGORIES.slice(0, 3).map(
      (category, i) =>
        ({
          id: `b${i}`,
          category,
          limit: 120_000,
          period: 'yearly',
          year: 2026,
          month: 1,
        }) as Budget,
    );
    const monthSpent = new Map(budgets.map((b) => [b.category, 60_000]));
    const ytdSpent = new Map(budgets.map((b) => [b.category, 60_000]));
    const excess = lumpyYearlyMonthExcessWithinPlanSar({
      budgets,
      finKey,
      monthStartDay: 1,
      monthSpentByCat: monthSpent,
      ytdSpentByCat: ytdSpent,
    });
    // Each category: 60k − (120k/12=10k) = 50k excess → 3 × 50k = 150k
    expect(excess).toBeCloseTo(150_000, 0);
    expect(
      adjustMonthExpensesForYearlyPlanHeadroom(200_000, {
        budgets,
        finKey,
        monthStartDay: 1,
        monthSpentByCat: monthSpent,
        ytdSpentByCat: ytdSpent,
      }),
    ).toBeCloseTo(50_000, 0);
  });

  it('does not anomaly-flag Iqama or Vehicle Insurance lumps within yearly plan', () => {
    for (const category of ['Iqama Renewal', 'Vehicle Insurance'] as const) {
      const budgets: Budget[] = [
        { id: 'y', category, limit: 18_000, period: 'yearly', month: 1, year: 2026 } as Budget,
      ];
      const transactions = [
        { date: '2026-01-10', amount: -200, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: category },
        { date: '2026-02-10', amount: -200, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: category },
        { date: '2026-03-10', amount: -200, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: category },
        { date: '2026-04-15', amount: -9000, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: category },
      ];
      const flagged = detectSpendingAnomaliesFromTransactions({
        year: 2026,
        transactions,
        accounts,
        sarPerUsd: 3.75,
        monthStartDay: 1,
        budgets,
      });
      expect(flagged.some((r) => r.category === category)).toBe(false);
    }
  });

  it('does not drift-flag School Tuition while YTD within yearly plan', () => {
    const category = 'School Tuition (Semester)';
    const data = {
      settings: { monthStartDay: 1 },
      accounts,
      personalAccounts: accounts,
      budgets: [
        { id: 't', category, limit: 40_000, period: 'yearly', month: 1, year: 2026 } as Budget,
      ],
      transactions: [
        { id: '1', date: '2026-01-05', type: 'expense', amount: -1000, accountId: 'a1', status: 'Approved', budgetCategory: category },
        { id: '2', date: '2026-02-05', type: 'expense', amount: -1000, accountId: 'a1', status: 'Approved', budgetCategory: category },
        { id: '3', date: '2026-03-05', type: 'expense', amount: -1000, accountId: 'a1', status: 'Approved', budgetCategory: category },
        { id: '4', date: '2026-04-05', type: 'expense', amount: -20000, accountId: 'a1', status: 'Approved', budgetCategory: category },
      ] as Transaction[],
    } as unknown as FinancialData;
    const drift = detectBudgetDrift(data, 3.75, new Date(2026, 3, 20));
    expect(drift.some((r) => r.category === category)).toBe(false);
  });

  it('does not outlier-flag custom yearly category lumps within plan', () => {
    const category = 'Custom Yearly Envelope';
    const data = {
      accounts,
      budgets: [
        { id: 'c', category, limit: 100_000, period: 'yearly', year: 2026, month: 1 } as Budget,
      ],
      transactions: [
        {
          id: 'big',
          date: '2026-05-01',
          type: 'expense',
          amount: -55_000,
          category,
          budgetCategory: category,
          accountId: 'a1',
          status: 'Approved',
        },
      ],
    } as unknown as FinancialData;
    const rows = detectPlanExpenseOutliers({ data, year: 2026, sarPerUsd: 3.75 });
    expect(rows.every((r) => r.category !== category)).toBe(true);
  });

  it('gate implementation does not hardcode Housing Rent as the only yearly category', () => {
    const gate = read('services/budgetOverspendGate.ts');
    expect(gate).toContain('isYearlyPeriodBudget');
    expect(gate).toContain("=== 'yearly'");
    expect(gate).toContain('every');
    // Category matching uses the passed category string, not a rent constant.
    expect(gate).not.toMatch(/category\s*===\s*['\"]Housing Rent['\"]/);
    expect(gate).not.toMatch(/includes\(['\"]Housing Rent['\"]\)/);
  });
});
