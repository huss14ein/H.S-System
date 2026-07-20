/**
 * Budget card → filtered Transactions drill-down — full E2E wiring + behavior.
 * Trace: BudgetOwnPortfolioCard click → Budgets handleOwnPortfolioNavigate →
 * buildBudgetDrillDownAction → triggerSpendingDrillDown → triggerPageAction →
 * Transactions parseFilterByBudgetPageAction → setFilters.budgetCategory →
 * filterTransactionsForLedgerView.
 *
 * Regression: AppRouteHost must NOT key the route on ephemeral pageAction —
 * clearing the action remounted Transactions and wiped the budget filter.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBudgetDrillDownAction,
  triggerSpendingDrillDown,
} from '../services/spendingDrillDown';
import {
  filterTransactionsForLedgerView,
  parseFilterByBudgetPageAction,
} from '../utils/transactionLedgerFilters';
import type { Page, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('budgetDrillDownCompletion', () => {
  it('AppRouteHost uses stable shell key (does not remount when pageAction clears)', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('const routeKey = shell;');
    expect(shell).not.toMatch(/const routeKey = `\$\{shell\}:\$\{pageAction/);
    expect(shell).toMatch(/Stable key by shell only|wiping Transactions budget filters/i);
  });

  it('Budgets own + shared cards fire full filter-by-budget via triggerPageAction', () => {
    const card = read('components/BudgetOwnPortfolioCard.tsx');
    const budgets = read('pages/Budgets.tsx');
    expect(card).toContain('onClick={() => onNavigateToTransactions(budget)}');
    expect(budgets).toContain('onNavigateToTransactions={handleOwnPortfolioNavigate}');
    expect(budgets).toContain('handleOwnPortfolioNavigate(budget)');
    expect(budgets).toContain('buildBudgetDrillDownAction');
    expect(budgets).toContain('triggerSpendingDrillDown');
    expect(budgets).toContain('triggerPageAction');
  });

  it('Dashboard / spending surfaces use the same drill-down contract', () => {
    expect(read('components/dashboard/BudgetBurnRatePanel.tsx')).toContain('buildBudgetDrillDownAction');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('triggerSpendingDrillDown');
    expect(read('components/spending/SpendingCommandCenter.tsx')).toContain('triggerSpendingDrillDown');
    expect(read('components/charts/ExpenseBreakdownChart.tsx')).toContain('buildBudgetDrillDownAction');
  });

  it('Transactions applies budgetCategory then clears pageAction (filter must survive clear)', () => {
    const tx = read('pages/Transactions.tsx');
    const effect = tx.slice(
      tx.indexOf("if (pageAction.startsWith('filter-by-budget:'))"),
      tx.indexOf("if (pageAction.startsWith('filter-by-month:'))"),
    );
    expect(effect).toContain('parseFilterByBudgetPageAction');
    expect(effect).toContain('budgetCategory: category || \'all\'');
    expect(effect).toContain("monthMode: 'fiscal'");
    expect(effect).toContain('scheduleClearPageAction(clearPageAction)');
    // Apply filters before clearing — order matters for the remount bug class.
    const setIdx = effect.indexOf('budgetCategory: category');
    const clearIdx = effect.lastIndexOf('scheduleClearPageAction');
    expect(setIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(setIdx);
  });

  it('build + parse + ledger filter: Food budget shows only Food expenses in window', () => {
    const action = buildBudgetDrillDownAction({
      budgetCategory: 'Food',
      year: 2026,
      month: 6,
      period: 'monthly',
      anchorDate: '2026-06-15',
      monthStartDay: 1,
    });
    expect(action).toBe('filter-by-budget:Food:monthly:2026:6:2026-06-15');
    const parsed = parseFilterByBudgetPageAction(action);
    expect(parsed).toEqual({
      category: 'Food',
      period: 'monthly',
      year: 2026,
      month: 6,
      anchorDate: '2026-06-15',
    });

    const txs: Transaction[] = [
      {
        id: 'food-1',
        date: '2026-06-10',
        description: 'Groceries',
        amount: -120,
        type: 'expense',
        category: 'Food',
        budgetCategory: 'Food',
        accountId: 'a1',
        status: 'Approved',
      },
      {
        id: 'rent-1',
        date: '2026-06-05',
        description: 'Rent',
        amount: -3000,
        type: 'expense',
        category: 'Housing',
        budgetCategory: 'Housing',
        accountId: 'a1',
        status: 'Approved',
      },
      {
        id: 'food-income',
        date: '2026-06-01',
        description: 'Refund',
        amount: 50,
        type: 'income',
        category: 'Food',
        budgetCategory: 'Food',
        accountId: 'a1',
        status: 'Approved',
      },
      {
        id: 'food-prev',
        date: '2026-05-20',
        description: 'Old groceries',
        amount: -40,
        type: 'expense',
        category: 'Food',
        budgetCategory: 'Food',
        accountId: 'a1',
        status: 'Approved',
      },
    ];

    const filtered = filterTransactionsForLedgerView(
      txs,
      {
        accountId: 'all',
        month: '2026-06',
        allMonths: false,
        monthMode: 'fiscal',
        nature: 'all',
        expenseType: 'all',
        budgetCategory: parsed!.category,
        searchText: '',
        approvalStatus: 'all',
        merchantQuery: '',
      },
      1,
    );
    expect(filtered.map((t) => t.id)).toEqual(['food-1']);
  });

  it('triggerSpendingDrillDown prefers triggerPageAction with action payload', () => {
    const calls: Array<{ page: Page; action: string }> = [];
    let navigated: Page | null = null;
    const action = buildBudgetDrillDownAction({
      budgetCategory: 'Transport',
      year: 2026,
      month: 7,
      period: 'monthly',
      anchorDate: '2026-07-01',
    });
    triggerSpendingDrillDown(
      (page, act) => {
        calls.push({ page, action: act });
      },
      (page) => {
        navigated = page;
      },
      action,
    );
    expect(calls).toEqual([{ page: 'Transactions', action }]);
    expect(navigated).toBeNull();
  });

  it('all pageAction consumers clear via scheduleClearPageAction (not sync clear)', () => {
    const pages = [
      'pages/Transactions.tsx',
      'pages/Investments.tsx',
      'pages/Budgets.tsx',
      'pages/Assets.tsx',
      'pages/Goals.tsx',
      'pages/Dashboard.tsx',
      'pages/EnginesAndToolsHub.tsx',
      'pages/Notifications.tsx',
      'pages/DividendTrackerView.tsx',
    ];
    for (const p of pages) {
      const src = read(p);
      expect(src).toContain('scheduleClearPageAction');
      expect(src).not.toMatch(/clearPageAction\?\.\(\)/);
    }
  });

  it('analytics visit insights use full buildBudgetDrillDownAction (parseable)', () => {
    const snap = read('services/analyticsVisitSnapshot.ts');
    expect(snap).toContain('buildBudgetDrillDownAction');
    expect(snap).not.toMatch(/drillAction: `filter-by-budget:\$\{encodeURIComponent/);
  });
});
