import type { Account } from '../../types';

export interface AccountPostingPolicyResult {
  allowed: boolean;
  reason?: string;
}

export interface AccountPostingPolicyInput {
  transactionType?: 'income' | 'expense';
  category?: string;
}

/**
 * Posting policy:
 * - Credit accounts are exempt (can post at any balance).
 * - Income (salary, deposits, inbound transfers) may always post — it funds depleted accounts.
 * - Reconciliation Adjustment / Opening Balance may post onto zero/negative non-credit accounts.
 * - Expenses / other debits on non-credit accounts require a strictly positive current balance
 *   (prevents spending past zero without a reconcile).
 */
export function canPostTransactionToAccount(
  account: Pick<Account, 'id' | 'type' | 'balance'> | undefined,
  input?: AccountPostingPolicyInput
): AccountPostingPolicyResult {
  if (!account) return { allowed: false, reason: 'Account not found.' };
  const rawType = String((account as { type?: unknown }).type ?? '').trim().toLowerCase();
  if (rawType === 'credit') return { allowed: true };
  // Income funds the account — never block because the current balance is already empty.
  if (input?.transactionType === 'income') return { allowed: true };
  const cat = String(input?.category || '').trim().toLowerCase();
  const isReconcile =
    cat === 'reconciliation adjustment' || cat === 'opening balance';
  if (isReconcile) return { allowed: true };
  const bal = Number(account.balance) || 0;
  if (bal <= 0) {
    return {
      allowed: false,
      reason: 'Expenses are blocked on non-credit accounts with non-positive balance. Add income, a transfer in, or reconcile the balance first.',
    };
  }
  return { allowed: true };
}
