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

function normalizedTxType(t: { type?: string }): string {
  return String(t.type ?? '').trim().toLowerCase();
}

export function countsAsExpenseForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return normalizedTxType(t) === 'expense' && !isInternalTransferTransaction(t);
}

/** Income with category Transfer/Transfers is treated as an internal move, not earned cashflow. */
export function countsAsIncomeForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  return normalizedTxType(t) === 'income' && !isInternalTransferTransaction(t);
}
