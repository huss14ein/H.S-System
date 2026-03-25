import type { Account, Transaction } from '../types';
import type { TradeCurrency } from '../types';

/**
 * Book currency for a cash/credit account (same units as `account.balance` and `transaction.amount`).
 */
export function accountBookCurrency(acc: Account | undefined): TradeCurrency {
  return acc?.currency === 'USD' ? 'USD' : 'SAR';
}

/** Resolve book currency for a bank/credit transaction from its linked account. */
export function transactionBookCurrency(transaction: Pick<Transaction, 'accountId'>, accountsById: Map<string, Account>): TradeCurrency {
  return accountBookCurrency(accountsById.get(transaction.accountId ?? ''));
}
