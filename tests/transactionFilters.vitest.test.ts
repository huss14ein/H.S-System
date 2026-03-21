import { describe, expect, it } from 'vitest';
import {
  countsAsExpenseForCashflowKpi,
  countsAsIncomeForCashflowKpi,
  isInternalTransferTransaction,
} from '../services/transactionFilters';

describe('transactionFilters', () => {
  it('flags transfer category as internal transfer', () => {
    expect(isInternalTransferTransaction({ category: 'Transfer' })).toBe(true);
    expect(isInternalTransferTransaction({ category: 'Transfers' })).toBe(true);
    expect(isInternalTransferTransaction({ category: ' transfer ' })).toBe(true);
    expect(isInternalTransferTransaction({ category: 'Transfers ' })).toBe(true);
    expect(isInternalTransferTransaction({ category: 'Food' })).toBe(false);
  });

  it('excludes transfer expenses/income from cashflow KPIs', () => {
    expect(countsAsExpenseForCashflowKpi({ type: 'expense', category: 'Transfer' })).toBe(false);
    expect(countsAsIncomeForCashflowKpi({ type: 'income', category: 'Transfer' })).toBe(false);
    expect(countsAsExpenseForCashflowKpi({ type: 'expense', category: 'Transfers' })).toBe(false);
    expect(countsAsIncomeForCashflowKpi({ type: 'income', category: 'Transfers' })).toBe(false);
  });

  it('includes normal income/expense in KPIs', () => {
    expect(countsAsExpenseForCashflowKpi({ type: 'expense', category: 'Groceries' })).toBe(true);
    expect(countsAsIncomeForCashflowKpi({ type: 'income', category: 'Salary' })).toBe(true);
  });
});
