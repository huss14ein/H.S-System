/**
 * Internal moves between your accounts (and cash↔brokerage legs that use the same categories).
 * `addTransfer` uses "Transfer"; recurring + some flows use "Transfers" — treat both as internal
 * so Income/Expenses/Net Flow on Transactions are not inflated by money that never left your world.
 */
export function isInternalTransferTransaction(t: {
  category?: string;
  type?: string;
}): boolean {
  const c = String(t.category ?? '').trim().toLowerCase();
  return c === 'transfer' || c === 'transfers';
}

export function countsAsExpenseForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return t.type === 'expense' && !isInternalTransferTransaction(t);
}

/** Income with category Transfer/Transfers is treated as an internal move, not earned cashflow. */
export function countsAsIncomeForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return t.type === 'income' && !isInternalTransferTransaction(t);
}
