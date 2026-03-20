/**
 * Internal account-to-account transfers use category "Transfer" (see DataContext.addTransfer).
 * Exclude both legs from spend/income KPIs so cash-flow metrics reflect external flows only.
 */
export function isInternalTransferTransaction(t: {
  category?: string;
  type?: string;
}): boolean {
  return String(t.category ?? '').trim().toLowerCase() === 'transfer';
}

export function countsAsExpenseForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return t.type === 'expense' && !isInternalTransferTransaction(t);
}

export function countsAsIncomeForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return t.type === 'income' && !isInternalTransferTransaction(t);
}
