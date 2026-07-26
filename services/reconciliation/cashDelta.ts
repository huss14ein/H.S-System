import type { Account, Transaction } from '../../types';
import { roundMoney } from '../../utils/money';
import {
  OPENING_BALANCE_CATEGORY,
  RECONCILIATION_ADJUSTMENT_CATEGORY,
  type ReconciliationMechanism,
} from './constants';
import { appCalendarTodayYmd } from './constants';

/** Signed ledger amount: income positive, expense negative (matches account Σ(tx.amount)). */
export function buildCashReconcileLedgerTransaction(args: {
  account: Account;
  delta: number;
  mechanism: 'reconcile_balance' | 'opening_balance';
  effectiveDate?: string;
  reason: string;
}): Omit<Transaction, 'id' | 'user_id'> {
  const delta = roundMoney(Number(args.delta) || 0);
  const category =
    args.mechanism === 'opening_balance' ? OPENING_BALANCE_CATEGORY : RECONCILIATION_ADJUSTMENT_CATEGORY;
  return {
    date: (args.effectiveDate || appCalendarTodayYmd()).slice(0, 10),
    description: `${category}: ${args.reason}`.slice(0, 200),
    amount: delta,
    category,
    accountId: args.account.id,
    type: delta >= 0 ? 'income' : 'expense',
    note: `reconciliation:${args.mechanism}`,
  };
}

export function buildBrokerCashReconcileInvestmentRow(args: {
  accountId: string;
  portfolioId?: string | null;
  delta: number;
  currency: 'SAR' | 'USD';
  effectiveDate?: string;
  reason: string;
}): {
  type: 'deposit' | 'withdrawal';
  total: number;
  date: string;
  accountId: string;
  portfolioId?: string;
  currency: 'SAR' | 'USD';
  note: string;
  symbol?: string;
} {
  const abs = Math.abs(roundMoney(Number(args.delta) || 0));
  const isDeposit = (Number(args.delta) || 0) >= 0;
  return {
    type: isDeposit ? 'deposit' : 'withdrawal',
    total: abs,
    date: (args.effectiveDate || appCalendarTodayYmd()).slice(0, 10),
    accountId: args.accountId,
    portfolioId: args.portfolioId || undefined,
    currency: args.currency,
    note: `Reconciliation Adjustment: ${args.reason}`.slice(0, 200),
    symbol: undefined,
  };
}

export function pendingApprovalsBlockAccount(
  accountId: string,
  transactions: Transaction[] | undefined,
): boolean {
  return (transactions ?? []).some((t) => {
    if (String(t.accountId) !== String(accountId)) return false;
    const status = String(t.status ?? '').toLowerCase();
    return status === 'pending' || status === 'pending_approval' || status === 'awaiting_approval';
  });
}

export function isCashReconcileEligibleAccount(account: Pick<Account, 'type'>): boolean {
  const t = String(account.type ?? '');
  return t === 'Checking' || t === 'Savings' || t === 'Credit' || t === 'Investment';
}

export function mechanismForEntity(
  entityType: string,
  fallback: ReconciliationMechanism = 'reconcile_balance',
): ReconciliationMechanism {
  switch (entityType) {
    case 'asset':
      return 'asset_revaluation';
    case 'commodity':
      return 'commodity_revaluation';
    case 'liability':
      return 'liability_restatement';
    case 'holding':
      return 'reconcile_quantity';
    case 'sukuk_position':
      return 'sukuk_face_yield';
    default:
      return fallback;
  }
}
