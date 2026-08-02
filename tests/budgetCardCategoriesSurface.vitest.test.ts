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
});
