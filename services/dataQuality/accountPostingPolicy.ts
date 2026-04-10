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
 * - All other accounts require strictly positive current balance.
 */
export function canPostTransactionToAccount(
  account: Pick<Account, 'id' | 'type' | 'balance'> | undefined,
  input?: AccountPostingPolicyInput
): AccountPostingPolicyResult {
  if (!account) return { allowed: false, reason: 'Account not found.' };
  if (account.type === 'Credit') return { allowed: true };
  // Allow inbound transfers so users can fund depleted accounts/platforms.
  const isTransferIn = input?.transactionType === 'income' && String(input?.category || '').trim().toLowerCase() === 'transfer';
  if (isTransferIn) return { allowed: true };
  const bal = Number(account.balance) || 0;
  if (bal <= 0) {
    return {
      allowed: false,
      reason: 'Transactions are blocked on non-credit accounts with non-positive balance.',
    };
  }
  return { allowed: true };
}
