import { describe, expect, it } from 'vitest';
import {
  categorizeImportedTransaction,
  inferImportTransactionCategory,
} from '../services/importTransactionCategorization';

describe('importTransactionCategorization', () => {
  it('maps Saudi POS SMS to Shopping', () => {
    expect(inferImportTransactionCategory('شراء عبر نقاط البيع لدى DUBAI PLA')).toBe('Shopping');
  });

  it('maps STC/yaqoot telecom spend toward Utilities', () => {
    const cat = inferImportTransactionCategory('yaqoot mobile recharge', { amount: -57.5, type: 'expense' });
    expect(['Utilities', 'Subscriptions']).toContain(cat);
  });

  it('reuses user history budget category for same merchant', () => {
    const mapped = categorizeImportedTransaction(
      {
        type: 'expense',
        description: 'STARBUCKS RIYADH',
        amount: -32,
        category: 'Uncategorized',
      },
      {
        budgetCategoryNames: ['Food & Dining', 'Shopping'],
        userHistory: [
          {
            id: '1',
            type: 'expense',
            description: 'STARBUCKS OLAYA',
            amount: -28,
            category: 'Food & Dining',
            budgetCategory: 'Food & Dining',
            accountId: 'a',
            date: '2026-01-01',
            status: 'Approved',
          },
        ],
      },
    );
    expect(mapped.category).toBe('Food & Dining');
    expect(mapped.budgetCategory).toBe('Food & Dining');
  });
});
