import { roundMoney } from '../../utils/money';
import type { ReconciliationAdjustment } from './types';
import { appCalendarTodayYmd } from './constants';
import { buildCashReconcileLedgerTransaction, buildBrokerCashReconcileInvestmentRow } from './cashDelta';
import type { Account } from '../../types';

export function assertCanReverseAdjustment(adj: ReconciliationAdjustment | null | undefined): string | null {
  if (!adj) return 'Adjustment not found.';
  if (adj.status === 'reversed') {
    return 'This adjustment was already reversed. Apply a new forward adjustment instead.';
  }
  if (adj.status === 'noop') return 'No-op adjustments cannot be reversed.';
  if (adj.reversedByAdjustmentId) {
    return 'This adjustment was already reversed. Apply a new forward adjustment instead.';
  }
  return null;
}

/** Inverse actual/before for reverse preview. */
export function reverseTargets(adj: ReconciliationAdjustment): {
  beforeValue: number;
  actualValue: number;
  delta: number;
} {
  return {
    beforeValue: adj.actualValue,
    actualValue: adj.beforeValue,
    delta: roundMoney(-Number(adj.delta) || 0),
  };
}

export function buildReverseCashLedgerTx(args: {
  account: Account;
  original: ReconciliationAdjustment;
  reason: string;
}) {
  const { delta } = reverseTargets(args.original);
  return buildCashReconcileLedgerTransaction({
    account: args.account,
    delta,
    mechanism: 'reconcile_balance',
    effectiveDate: appCalendarTodayYmd(),
    reason: args.reason,
  });
}

export function buildReverseBrokerCashRow(args: {
  accountId: string;
  portfolioId?: string | null;
  original: ReconciliationAdjustment;
  reason: string;
}) {
  const { delta } = reverseTargets(args.original);
  return buildBrokerCashReconcileInvestmentRow({
    accountId: args.accountId,
    portfolioId: args.portfolioId,
    delta,
    currency: args.original.currency,
    effectiveDate: appCalendarTodayYmd(),
    reason: args.reason,
  });
}
