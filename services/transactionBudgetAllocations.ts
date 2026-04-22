import type { Transaction } from '../types';

export interface TransactionBudgetAllocation {
  category: string;
  amount: number;
}

/**
 * Resolve how an expense transaction should be deducted from budget categories.
 * - If split lines exist, each line contributes to its category.
 * - If split sum drifts from parent amount, lines are scaled proportionally to match parent.
 * - Otherwise falls back to single mapped budget/category with full amount.
 */
export function getTransactionBudgetAllocations(
  tx: Pick<Transaction, 'type' | 'amount' | 'budgetCategory' | 'category' | 'splitLines'>,
): TransactionBudgetAllocation[] {
  if (tx.type !== 'expense') return [];
  const parentAmount = Math.abs(Number(tx.amount) || 0);
  if (!(parentAmount > 0)) return [];

  const splitLines = Array.isArray(tx.splitLines)
    ? tx.splitLines
        .map((line) => ({
          category: String(line?.category ?? '').trim(),
          amount: Math.abs(Number(line?.amount) || 0),
        }))
        .filter((line) => line.category && line.amount > 0)
    : [];

  if (splitLines.length > 0) {
    const splitTotal = splitLines.reduce((sum, line) => sum + line.amount, 0);
    if (splitTotal > 0) {
      const scale = parentAmount / splitTotal;
      return splitLines.map((line) => ({
        category: line.category,
        amount: line.amount * scale,
      }));
    }
  }

  const singleCategory = String(tx.budgetCategory ?? tx.category ?? '').trim();
  if (!singleCategory) return [];
  return [{ category: singleCategory, amount: parentAmount }];
}
