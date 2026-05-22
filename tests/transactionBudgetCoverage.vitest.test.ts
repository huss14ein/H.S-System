import { describe, expect, it } from 'vitest';
import {
  BUDGET_OVER_UTILIZATION_BLOCKS_SUBMIT,
  computeBudgetCoverageTone,
  evaluateTransactionBudgetCoverageState,
} from '../services/transactionBudgetCoverage';

describe('transactionBudgetCoverage', () => {
  it('does not block submit when budget is over-utilized', () => {
    expect(BUDGET_OVER_UTILIZATION_BLOCKS_SUBMIT).toBe(false);
  });

  it('flags red tone when amount exceeds remaining', () => {
    expect(
      computeBudgetCoverageTone({ limitSar: 1000, remainingSar: 50, amountSar: 100 }),
    ).toBe('red');
  });

  it('warns on single-category over budget without implying save is blocked', () => {
    const state = evaluateTransactionBudgetCoverageState({
      transactionType: 'expense',
      hasAmount: true,
      budgetCategory: 'Groceries',
      useSplitExpense: false,
      splitCoverage: [
        {
          category: 'Groceries',
          amountSar: 200,
          remainingSar: 50,
          shortfallSar: 150,
        },
      ],
      budgetCoverageSummary: { limitSar: 500, remainingSar: 50 },
      inputAmountSar: 200,
    });
    expect(state.isWithinBudget).toBe(false);
    expect(state.tone).toBe('red');
    expect(state.summary).toMatch(/still save/i);
    expect(state.shortfalls).toHaveLength(1);
  });

  it('warns on split over budget without implying save is blocked', () => {
    const state = evaluateTransactionBudgetCoverageState({
      transactionType: 'expense',
      hasAmount: true,
      budgetCategory: 'Groceries',
      useSplitExpense: true,
      splitCoverage: [
        {
          category: 'Groceries',
          amountSar: 100,
          remainingSar: 20,
          shortfallSar: 80,
        },
        {
          category: 'Transport',
          amountSar: 50,
          remainingSar: 200,
          shortfallSar: 0,
        },
      ],
      budgetCoverageSummary: null,
      inputAmountSar: 150,
    });
    expect(state.isWithinBudget).toBe(false);
    expect(state.summary).toMatch(/still save/i);
  });

  it('reports within budget when headroom is sufficient', () => {
    const state = evaluateTransactionBudgetCoverageState({
      transactionType: 'expense',
      hasAmount: true,
      budgetCategory: 'Groceries',
      useSplitExpense: false,
      splitCoverage: [
        {
          category: 'Groceries',
          amountSar: 40,
          remainingSar: 200,
          shortfallSar: 0,
        },
      ],
      budgetCoverageSummary: { limitSar: 500, remainingSar: 200 },
      inputAmountSar: 40,
    });
    expect(state.isWithinBudget).toBe(true);
    expect(state.tone).toBe('green');
  });
});
