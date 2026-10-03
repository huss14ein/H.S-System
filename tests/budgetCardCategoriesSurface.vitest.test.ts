import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('budget card category surface coverage', () => {
  it('Transactions Map-to list uses budgetCardCategoryNames (Budgets cards)', () => {
    const src = read('pages/Transactions.tsx');
    expect(src).toContain('budgetCardCategoryNames');
    expect(src).toContain('mappableBudgetCategories');
    expect(src).toContain('categoriesForTransactionDate');
    // Must not rebuild Map-to options from all historical budget rows.
    expect(src).not.toMatch(/const ownCategories = \(data\?\.budgets \?\? \[\]\)\.map\(b => b\.category\)/);
  });

  it('Statement Upload and Dashboard review use the same card helper', () => {
    expect(read('pages/StatementUpload.tsx')).toContain('budgetCardCategoryNames');
    expect(read('pages/Dashboard.tsx')).toContain('budgetCardCategoryNames');
  });

  it('Statement Upload budgets are keyed by transaction date (not only current month)', () => {
    const src = read('pages/StatementUpload.tsx');
    expect(src).toContain('financialMonthKeyFromTransactionDate');
    expect(src).toContain('budgetCategoriesForTransactionDate');
    expect(src).toContain('budgetCategoriesForTransactionDate(tx.date)');
    expect(src).toContain('budgetCategoriesForTransactionDate(next.date)');
    // Must not map every imported row against a single "now" month key only.
    expect(src).not.toMatch(
      /enrichTransactionsWithBudgetMapping[\s\S]*?budgetCategoryNames = budgetCategoryOptions/,
    );
  });
});
