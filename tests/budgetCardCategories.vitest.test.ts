import { describe, expect, it } from 'vitest';
import {
  budgetCardCategoryNames,
  coerceBudgetCategorySelection,
  matchBudgetCardCategory,
} from '../utils/budgetCardCategories';

describe('budgetCardCategoryNames', () => {
  const viewKey = { year: 2026, month: 8 };

  it('returns only categories that apply to the financial month (Budgets cards), not other months', () => {
    const names = budgetCardCategoryNames({
      budgets: [
        { category: 'Wife and Kids Allowance', year: 2026, month: 8, period: 'monthly', limit: 2000 },
        { category: 'Groceries & Supermarket', year: 2026, month: 8, period: 'monthly', limit: 1500 },
        { category: 'Wife', year: 2026, month: 5, period: 'monthly', limit: 500 },
        { category: 'Legacy Misc', year: 2025, month: 12, period: 'monthly', limit: 100 },
      ],
      viewKey,
      monthStartDay: 1,
      userRole: 'Admin',
    });

    expect(names).toEqual(['Groceries & Supermarket', 'Wife and Kids Allowance']);
    expect(names).not.toContain('Wife');
    expect(names).not.toContain('Legacy Misc');
  });

  it('dedupes duplicate rows for the same category in the active month', () => {
    const names = budgetCardCategoryNames({
      budgets: [
        { category: 'Utilities', year: 2026, month: 8, period: 'monthly', limit: 300 },
        { category: 'Utilities', year: 2026, month: 8, period: 'monthly', limit: 400 },
      ],
      viewKey,
      monthStartDay: 1,
      userRole: 'Admin',
    });
    expect(names).toEqual(['Utilities']);
  });

  it('includes shared and finalized new-category card names', () => {
    const names = budgetCardCategoryNames({
      budgets: [{ category: 'Rent', year: 2026, month: 8, period: 'monthly', limit: 5000 }],
      viewKey,
      monthStartDay: 1,
      userRole: 'Admin',
      sharedCategories: ['Shared Groceries'],
      finalizedNewCategoryNames: ['School Uniforms'],
    });
    expect(names).toEqual(['Rent', 'School Uniforms', 'Shared Groceries']);
  });

  it('for Restricted role keeps permitted + shared synthetic cards', () => {
    const names = budgetCardCategoryNames({
      budgets: [
        { category: 'Rent', year: 2026, month: 8, period: 'monthly', limit: 5000 },
        { category: 'Shopping', year: 2026, month: 8, period: 'monthly', limit: 800 },
      ],
      viewKey,
      monthStartDay: 1,
      userRole: 'Restricted',
      permittedCategories: ['Rent', 'Pocket Money'],
      sharedCategories: ['Shared Health'],
    });
    expect(names).toEqual(['Pocket Money', 'Rent', 'Shared Health']);
    expect(names).not.toContain('Shopping');
  });

  it('for Restricted role includes finalized NewCategory cards even when not in permitted list', () => {
    const names = budgetCardCategoryNames({
      budgets: [{ category: 'Rent', year: 2026, month: 8, period: 'monthly', limit: 5000 }],
      viewKey,
      monthStartDay: 1,
      userRole: 'Restricted',
      permittedCategories: ['Rent'],
      sharedCategories: [],
      finalizedNewCategoryNames: ['School Uniforms'],
    });
    expect(names).toEqual(['Rent', 'School Uniforms']);
  });
});

describe('matchBudgetCardCategory', () => {
  const cards = ['Wife and Kids Allowance', 'Groceries & Supermarket', 'Utilities'];

  it('matches exact names only (no loose substring mapping)', () => {
    expect(matchBudgetCardCategory('Wife and Kids Allowance', cards)).toBe('Wife and Kids Allowance');
    expect(matchBudgetCardCategory('Wife', cards)).toBeNull();
    expect(matchBudgetCardCategory('utilities', cards)).toBe('Utilities');
  });
});

describe('coerceBudgetCategorySelection', () => {
  it('keeps valid card selection and falls back when stale', () => {
    const cards = ['Wife and Kids Allowance', 'Utilities'];
    expect(coerceBudgetCategorySelection('Wife and Kids Allowance', cards)).toBe('Wife and Kids Allowance');
    expect(coerceBudgetCategorySelection('Wife', cards)).toBe('Wife and Kids Allowance');
    expect(coerceBudgetCategorySelection('Wife', cards, false)).toBe('');
  });
});
