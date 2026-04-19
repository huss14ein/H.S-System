import { describe, expect, it } from 'vitest';
import { resolveBudgetCategoryForImportedExpense } from '../services/budgetCategoryResolve';
import type { Transaction } from '../types';

function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'description' | 'category'>): Transaction {
  return { id: '1', accountId: 'a', date: '2026-01-01', amount: -1, status: 'Approved', ...p } as Transaction;
}

describe('resolveBudgetCategoryForImportedExpense', () => {
  it('maps parser category to a differently named budget (e.g. Food → Groceries)', () => {
    const b = resolveBudgetCategoryForImportedExpense(
      tx({ type: 'expense', category: 'Food', description: 'CARREFOUR' }),
      ['Home & Groceries', 'Transport'],
    );
    expect(b).toBe('Home & Groceries');
  });

  it('links utilities/internet to a budget that includes "bills" or "internet" in the name', () => {
    const b = resolveBudgetCategoryForImportedExpense(
      tx({ type: 'expense', category: 'Utilities', description: 'شراء إنترنت' }),
      ['Household bills', 'Dining out'],
    );
    expect(b).toBe('Household bills');
  });

  it('uses the only budget when there is a single row', () => {
    const b = resolveBudgetCategoryForImportedExpense(
      tx({ type: 'expense', category: 'Uncategorized', description: 'X' }),
      ['Main spend'],
    );
    expect(b).toBe('Main spend');
  });

  it('returns undefined for income', () => {
    const b = resolveBudgetCategoryForImportedExpense(
      tx({ type: 'income', category: 'Income', description: 'Salary' }),
      ['Bills', 'Savings'],
    );
    expect(b).toBeUndefined();
  });
});
