import type { Account, Transaction } from '../../types';

/**
 * Net effect of all recorded transactions on this account (income +, expense −).
 * Transfers post as expense on source and income on destination, so nets are consistent.
 */
export function transactionNetForAccount(accountId: string, transactions: Transaction[]): number {
  return (transactions || []).reduce((sum, t) => {
    if (t.accountId !== accountId) return sum;
    return sum + (Number(t.amount) || 0);
  }, 0);
}

export interface CashAccountReconciliation {
  accountId: string;
  transactionNet: number;
  storedBalance: number;
  drift: number;
  txCount: number;
  /** True when drift is large enough to warrant user attention. */
  showWarning: boolean;
}

export interface CreditAccountReconciliation {
  accountId: string;
  transactionNet: number;
  storedBalance: number;
  drift: number;
  txCount: number;
  reversalLikeCount: number;
  disputedLikeCount: number;
  /** True when drift is large enough to warrant user attention. */
  showWarning: boolean;
}

/**
 * Compare stored cash-account balance to the sum of linked transactions.
 * Drift often indicates opening balance not entered, missing/partial history, or manual balance edits.
 */
export function reconcileCashAccountBalance(
  account: Pick<Account, 'id' | 'type' | 'balance'>,
  transactions: Transaction[]
): CashAccountReconciliation | null {
  if (account.type !== 'Checking' && account.type !== 'Savings') return null;

  const id = account.id;
  const relevant = (transactions || []).filter((t) => t.accountId === id);
  const txCount = relevant.length;
  const transactionNet = transactionNetForAccount(id, transactions);
  const storedBalance = Number(account.balance) || 0;
  const drift = storedBalance - transactionNet;

  const scale = Math.max(Math.abs(storedBalance), Math.abs(transactionNet), 500);
  const threshold = Math.max(25, 0.015 * scale);
  const showWarning = txCount >= 1 && Math.abs(drift) > threshold;

  return {
    accountId: id,
    transactionNet,
    storedBalance,
    drift,
    txCount,
    showWarning,
  };
}

/**
 * Credit-card ledger reconciliation:
 * - includes all transactions linked to the credit account id
 * - permits negative balances (debt)
 * - flags potential reversal/dispute rows for review workflows
 */
export function reconcileCreditAccountBalance(
  account: Pick<Account, 'id' | 'type' | 'balance'>,
  transactions: Transaction[]
): CreditAccountReconciliation | null {
  if (account.type !== 'Credit') return null;

  const id = account.id;
  const relevant = (transactions || []).filter((t) => t.accountId === id);
  const txCount = relevant.length;
  const transactionNet = transactionNetForAccount(id, transactions);
  const storedBalance = Number(account.balance) || 0;
  const drift = storedBalance - transactionNet;

  const reversalLikeCount = relevant.filter((t) => /reversal|reversed|chargeback|void/i.test(String(t.description || ''))).length;
  const disputedLikeCount = relevant.filter((t) => /dispute|disputed|fraud|unauthori[sz]ed/i.test(String(t.description || ''))).length;

  const scale = Math.max(Math.abs(storedBalance), Math.abs(transactionNet), 500);
  const threshold = Math.max(25, 0.015 * scale);
  const showWarning = txCount >= 1 && Math.abs(drift) > threshold;

  return {
    accountId: id,
    transactionNet,
    storedBalance,
    drift,
    txCount,
    reversalLikeCount,
    disputedLikeCount,
    showWarning,
  };
}
