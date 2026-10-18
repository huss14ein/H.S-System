/**
 * E2E behavior for budget-related notifications: yearly gate, drill-down pairing, no false alarms.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBudgetRelatedNotifications,
  buildNotificationBudgetDrillAction,
  notificationBudgetPeriodTag,
  withTransactionsDrillDown,
} from '../services/notificationBudgetAlerts';
import { isSupportedPageAction } from '../utils/pageActions';
import { parseFilterByBudgetPageAction } from '../utils/transactionLedgerFilters';
import type { Account, Budget, FinancialData, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const accounts: Account[] = [
  { id: 'a1', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
];

function baseData(overrides: Partial<FinancialData> = {}): FinancialData {
  return {
    settings: { monthStartDay: 1, budgetThreshold: 90 },
    accounts,
    personalAccounts: accounts,
    budgets: [],
    transactions: [],
    goals: [],
    ...overrides,
  } as unknown as FinancialData;
}

describe('notificationBudgetAlerts', () => {
  const now = new Date(2026, 5, 15); // mid June

  it('notificationBudgetPeriodTag normalizes yearly aliases', () => {
    expect(notificationBudgetPeriodTag({ period: 'yearly' })).toBe('yearly');
    expect(notificationBudgetPeriodTag({ period: 'Yearly' })).toBe('yearly');
    expect(notificationBudgetPeriodTag({ period: 'annual' })).toBe('yearly');
    expect(notificationBudgetPeriodTag({ period: 'monthly' })).toBe('monthly');
  });

  it('withTransactionsDrillDown always pairs pageLink with a valid Transactions action', () => {
    const action = 'filter-by-budget:Housing%20Rent:yearly:2026:6';
    const paired = withTransactionsDrillDown(action);
    expect(paired.pageLink).toBe('Transactions');
    expect(paired.pageAction).toBe(action);
    expect(isSupportedPageAction(paired.pageLink, paired.pageAction!)).toBe(true);
  });

  it('does not alert for lumpy yearly category while YTD within yearly plan', () => {
    const category = 'Housing Rent';
    const data = baseData({
      budgets: [
        { id: 'y1', category, limit: 24_000, period: 'yearly', year: 2026, month: 1 } as Budget,
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-01',
          type: 'expense',
          amount: -12_000,
          accountId: 'a1',
          status: 'Approved',
          budgetCategory: category,
        } as Transaction,
      ],
    });
    const rows = buildBudgetRelatedNotifications({
      data,
      sarPerUsd: 3.75,
      now,
      skipEnhancementBudgetAlerts: true,
    });
    expect(rows.some((n) => n.message.includes(category))).toBe(false);
  });

  it('alerts when YTD exceeds yearly plan and drill-down uses yearly period', () => {
    const category = 'Iqama Renewal';
    const data = baseData({
      budgets: [
        { id: 'y2', category, limit: 10_000, period: 'Yearly', year: 2026, month: 1 } as Budget,
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-01-10',
          type: 'expense',
          amount: -6_000,
          accountId: 'a1',
          status: 'Approved',
          budgetCategory: category,
        } as Transaction,
        {
          id: 't2',
          date: '2026-06-05',
          type: 'expense',
          amount: -5_000,
          accountId: 'a1',
          status: 'Approved',
          budgetCategory: category,
        } as Transaction,
      ],
    });
    const rows = buildBudgetRelatedNotifications({
      data,
      sarPerUsd: 3.75,
      now,
      skipEnhancementBudgetAlerts: true,
    });
    const hit = rows.find((n) => n.id === 'budget-y2');
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/yearly plan/);
    expect(hit!.pageLink).toBe('Transactions');
    expect(hit!.pageAction).toBeTruthy();
    expect(isSupportedPageAction(hit!.pageLink, hit!.pageAction!)).toBe(true);
    const parsed = parseFilterByBudgetPageAction(hit!.pageAction!);
    expect(parsed?.period).toBe('yearly');
    expect(parsed?.category).toBe(category);
  });

  it('alerts monthly overspend and keeps monthly drill-down period', () => {
    const category = 'Groceries';
    const data = baseData({
      budgets: [
        { id: 'm1', category, limit: 1_000, period: 'monthly', year: 2026, month: 6 } as Budget,
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-02',
          type: 'expense',
          amount: -1_500,
          accountId: 'a1',
          status: 'Approved',
          budgetCategory: category,
        } as Transaction,
      ],
    });
    const rows = buildBudgetRelatedNotifications({
      data,
      sarPerUsd: 3.75,
      now,
      skipEnhancementBudgetAlerts: true,
    });
    const hit = rows.find((n) => n.id === 'budget-m1');
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/limit/);
    expect(hit!.severity).toBe('urgent');
    const parsed = parseFilterByBudgetPageAction(hit!.pageAction!);
    expect(parsed?.period).toBe('monthly');
  });

  it('suppresses budget drift for yearly category still within annual cap', () => {
    const category = 'Vehicle Insurance';
    const data = baseData({
      budgets: [
        { id: 'y3', category, limit: 18_000, period: 'yearly', year: 2026, month: 1 } as Budget,
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-01',
          type: 'expense',
          amount: -8_000,
          accountId: 'a1',
          status: 'Approved',
          budgetCategory: category,
        } as Transaction,
      ],
    });
    const rows = buildBudgetRelatedNotifications({
      data,
      sarPerUsd: 3.75,
      now,
      budgetDrift: [{ category, driftPct: 80, baselineSar: 1000, currentSar: 8000 } as any],
      skipEnhancementBudgetAlerts: false,
    });
    expect(rows.some((n) => n.id.startsWith('budget-drift-'))).toBe(false);
  });

  it('buildNotificationBudgetDrillAction uses yearly when a yearly row exists', () => {
    const data = baseData({
      budgets: [
        {
          id: 'y',
          category: 'School Tuition (Semester)',
          limit: 40_000,
          period: 'yearly',
          year: 2026,
          month: 1,
        } as Budget,
      ],
    });
    const action = buildNotificationBudgetDrillAction({
      category: 'School Tuition (Semester)',
      data,
      budgets: data.budgets ?? [],
      finKey: { year: 2026, month: 6 },
      monthStartDay: 1,
      now,
    });
    expect(parseFilterByBudgetPageAction(action)?.period).toBe('yearly');
  });

  it('NotificationsContext wires shared builder; click handlers recover Transactions drills', () => {
    const ctx = read('context/NotificationsContext.tsx');
    expect(ctx).toContain('buildBudgetRelatedNotifications');
    // Budget drift no longer points at Analysis with a Transactions-only pageAction.
    expect(ctx).not.toContain("id: `budget-drift-${d.category}`");
    expect(read('pages/Notifications.tsx')).toContain('transactionsDrill');
    expect(read('components/Header.tsx')).toContain('transactionsDrill');
    expect(read('services/notificationBudgetAlerts.ts')).toContain('withTransactionsDrillDown');
    expect(read('services/notificationBudgetAlerts.ts')).toContain("pageLink: 'Transactions'");
  });
});
