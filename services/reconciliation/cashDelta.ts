import type { Account, Transaction } from '../../types';
import { roundMoney } from '../../utils/money';
import {
  OPENING_BALANCE_CATEGORY,
  RECONCILIATION_ADJUSTMENT_CATEGORY,
  type ReconciliationMechanism,
} from './constants';
import { appCalendarTodayYmd } from './constants';

/** Stable note prefix for broker-cash reconcile rows (investment ledger). */
export const INVESTMENT_RECONCILIATION_NOTE_PREFIX = 'reconciliation:reconcile_balance:' as const;

/**
 * Broker-cash Reconcile Balance posts as deposit/withdrawal so Σ(ledger) can move with balance,
 * but those rows are **not** economic capital in/out (ROI / Invested / Withdrawn). Period MTM may
 * still include them so cash-balance corrections do not look like performance.
 */
export function isInvestmentReconciliationCashAdjustment(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  const typ = String(tx.type ?? '').trim().toLowerCase();
  if (typ !== 'deposit' && typ !== 'withdrawal') return false;
  const note = String(tx.note ?? '').trim();
  const desc = String(tx.description ?? '').trim();
  const category = String(tx.category ?? '').trim();
  if (note.toLowerCase().startsWith('reconciliation:')) return true;
  if (/^reconciliation adjustment\s*:/i.test(note)) return true;
  if (/reconciliation adjustment/i.test(desc)) return true;
  if (category.toLowerCase() === RECONCILIATION_ADJUSTMENT_CATEGORY.toLowerCase()) return true;
  // Idempotency keys stamped onto investment rows by the reconcile engine.
  const idem = String(tx.idempotencyKey ?? '').trim().toLowerCase();
  if (idem.includes('|reconcile_balance|') || idem.includes('|opening_balance|')) return true;
  return false;
}

/** Economic capital deposit — excludes broker-cash reconcile↑ rows. */
export function isCapitalInvestmentDeposit(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  return String(tx.type ?? '').trim().toLowerCase() === 'deposit' && !isInvestmentReconciliationCashAdjustment(tx);
}

/** Economic capital withdrawal — excludes broker-cash reconcile↓ rows. */
export function isCapitalInvestmentWithdrawal(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  return String(tx.type ?? '').trim().toLowerCase() === 'withdrawal' && !isInvestmentReconciliationCashAdjustment(tx);
}

/**
 * Trade-log label for investment ledger rows. Broker-cash reconcile uses deposit/withdrawal
 * types for cash identity only — never show those as economic WITHDRAWAL/DEPOSIT in the UI.
 */
export function investmentLedgerTypeLabel(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
}): string {
  const typ = String(tx.type ?? '').trim().toLowerCase();
  if (isInvestmentReconciliationCashAdjustment(tx)) {
    if (typ === 'withdrawal') return 'RECONCILE↓';
    if (typ === 'deposit') return 'RECONCILE↑';
    return 'RECONCILE';
  }
  return typ.toUpperCase() || '—';
}

export function isInvestmentLedgerTypeCapitalOutflow(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
}): boolean {
  const typ = String(tx.type ?? '').trim().toLowerCase();
  if (typ !== 'sell' && typ !== 'withdrawal') return false;
  if (typ === 'withdrawal' && isInvestmentReconciliationCashAdjustment(tx)) return false;
  return true;
}

export function isInvestmentLedgerTypeCapitalInflow(tx: {
  type?: string | null;
  note?: string | null;
  description?: string | null;
  category?: string | null;
}): boolean {
  const typ = String(tx.type ?? '').trim().toLowerCase();
  if (typ !== 'buy' && typ !== 'deposit') return false;
  if (typ === 'deposit' && isInvestmentReconciliationCashAdjustment(tx)) return false;
  return true;
}

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
  idempotencyKey?: string | null;
}): {
  type: 'deposit' | 'withdrawal';
  total: number;
  date: string;
  accountId: string;
  portfolioId?: string;
  currency: 'SAR' | 'USD';
  note: string;
  symbol?: string;
  idempotencyKey?: string;
} {
  const abs = Math.abs(roundMoney(Number(args.delta) || 0));
  const isDeposit = (Number(args.delta) || 0) >= 0;
  const reason = String(args.reason ?? '').trim() || 'Broker cash reconcile';
  const idem = args.idempotencyKey != null && String(args.idempotencyKey).trim() !== ''
    ? String(args.idempotencyKey).trim()
    : undefined;
  return {
    type: isDeposit ? 'deposit' : 'withdrawal',
    total: abs,
    date: (args.effectiveDate || appCalendarTodayYmd()).slice(0, 10),
    accountId: args.accountId,
    portfolioId: args.portfolioId || undefined,
    currency: args.currency,
    /** Detected by {@link isInvestmentReconciliationCashAdjustment} — excluded from capital withdrawals/deposits. */
    note: `${INVESTMENT_RECONCILIATION_NOTE_PREFIX} ${reason}`.slice(0, 200),
    symbol: undefined,
    ...(idem ? { idempotencyKey: idem } : {}),
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
