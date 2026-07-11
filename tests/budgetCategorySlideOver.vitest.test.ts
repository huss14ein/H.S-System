/**
 * Budget card → Transactions drill-down E2E wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBudgetCategorySlideOverModel } from '../services/budgetCategorySlideOverModel';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('budgetCardTransactionsDrillDown', () => {
  it('own-portfolio and shared cards navigate to filtered Transactions', () => {
    const card = read('components/BudgetOwnPortfolioCard.tsx');
    const budgets = read('pages/Budgets.tsx');
    expect(card).toContain('onNavigateToTransactions(budget)');
    expect(card).not.toContain('onOpenSlideOver');
    expect(budgets).toContain('handleOwnPortfolioNavigate');
    expect(budgets).toContain('buildBudgetDrillDownAction');
    expect(budgets).toContain('triggerSpendingDrillDown');
    expect(budgets).toContain('handleOwnPortfolioNavigate(budget)');
    expect(budgets).not.toContain('BudgetCategorySlideOver');
  });

  it('slide-over model helper still available for exports/previews', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' }],
      budgets: [{ id: 'b1', category: 'Food', limit: 1000, month: 6, year: 2026, period: 'monthly' }],
      transactions: Array.from({ length: 25 }, (_, i) => ({
        id: `t${i}`,
        date: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
        description: `Expense ${i}`,
        amount: -50,
        category: 'Food',
        budgetCategory: 'Food',
        type: 'expense',
        accountId: 'a1',
        status: 'Approved',
      })),
    } as unknown as FinancialData;

    const model = buildBudgetCategorySlideOverModel({
      data,
      category: 'Food',
      exchangeRate: 3.75,
      ref: new Date(2026, 5, 15),
      month: 6,
      year: 2026,
    });
    expect(model.transactions.length).toBeLessThanOrEqual(20);
    expect(model.momSparkline.length).toBe(6);
    expect(model.totalSpentSar).toBeCloseTo(25 * 50, 0);
  });
});
