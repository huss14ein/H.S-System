import { describe, expect, it } from 'vitest';
import { getTransactionBudgetAllocations } from '../services/transactionBudgetAllocations';
import type { Transaction } from '../types';

function expenseTx(partial: Partial<Transaction>): Transaction {
  return {
    id: 't1',
    accountId: 'acc-1',
    date: '2026-04-22',
    description: 'Expense',
    amount: -100,
    category: 'General',
    type: 'expense',
    status: 'Approved',
    ...partial,
  };
}

describe('getTransactionBudgetAllocations', () => {
  it('falls back to single mapped budget category when no splits exist', () => {
    const allocations = getTransactionBudgetAllocations(
      expenseTx({
        amount: -120,
        budgetCategory: 'Groceries',
      }),
    );
    expect(allocations).toEqual([{ category: 'Groceries', amount: 120 }]);
  });

  it('uses split lines and scales to parent transaction amount', () => {
    const allocations = getTransactionBudgetAllocations(
      expenseTx({
        amount: -100,
        budgetCategory: 'Groceries',
        splitLines: [
          { category: 'Groceries', amount: 30 },
          { category: 'Transportation', amount: 30 },
        ],
      }),
    );
    expect(allocations).toHaveLength(2);
    expect(allocations[0].category).toBe('Groceries');
    expect(allocations[1].category).toBe('Transportation');
    const total = allocations.reduce((sum, line) => sum + line.amount, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(allocations[0].amount).toBeCloseTo(50, 6);
    expect(allocations[1].amount).toBeCloseTo(50, 6);
  });

  it('returns no allocations for income transactions', () => {
    const allocations = getTransactionBudgetAllocations({
      type: 'income',
      amount: 100,
      category: 'Salary',
      budgetCategory: 'Salary',
      splitLines: [{ category: 'Salary', amount: 100 }],
    });
    expect(allocations).toEqual([]);
  });
});
