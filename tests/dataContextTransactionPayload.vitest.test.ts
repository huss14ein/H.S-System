import { describe, expect, it } from 'vitest';
import { buildTransactionPayloadVariants } from '../services/transactionPayloadVariants';

describe('transaction payload variants', () => {
  it('always includes budget category and account id in both snake and camel formats', () => {
    const variants = buildTransactionPayloadVariants({
      date: '2026-04-22',
      description: 'SMS Purchase',
      amount: -89.9,
      category: 'Food',
      type: 'expense',
      accountId: 'acc-1',
      budgetCategory: 'Groceries',
      status: 'Approved',
    });

    const snake = variants[0];
    const camel = variants[1];
    const snakeCore = variants[2];
    const camelCore = variants[3];

    expect(snake.budget_category).toBe('Groceries');
    expect(snake.account_id).toBe('acc-1');
    expect(camel.budgetCategory).toBe('Groceries');
    expect(camel.accountId).toBe('acc-1');
    expect(snakeCore.budget_category).toBe('Groceries');
    expect(snakeCore.account_id).toBe('acc-1');
    expect(camelCore.budgetCategory).toBe('Groceries');
    expect(camelCore.accountId).toBe('acc-1');
  });
});
