import { roundAvgCostPerUnit, roundMoney } from '../../utils/money';
import {
  appCalendarTodayYmd,
  isValidReason,
  normalizeReason,
  RECONCILIATION_ADJUSTMENT_CATEGORY,
  OPENING_BALANCE_CATEGORY,
  yearMonthFromYmd,
  type ReconciliationMechanism,
} from './constants';
import type { ApplyReconciliationInput, ReconciliationPreview } from './types';
import type { Account, FinancialData, Transaction } from '../../types';
import { isMonthLocked } from '../netWorthSnapshot';

const NOOP_EPS = 0.00005;

export function computeReconcileDelta(beforeValue: number, actualValue: number): number {
  return roundMoney(Number(actualValue) - Number(beforeValue));
}

export function isNoopDelta(delta: number): boolean {
  return Math.abs(Number(delta) || 0) < NOOP_EPS;
}

/** Broker platform history lives in the investment ledger, so cash rows alone cannot prove a platform is untouched. */
export interface BrokerLedgerActivitySource {
  investmentTransactions?: { accountId?: string; portfolioId?: string }[];
  /** Portfolios mapped to the account — covers legacy rows carrying only `portfolioId`. */
  portfolioIds?: string[];
}

export function accountHasLedgerActivity(
  accountId: string,
  transactions: Transaction[] | undefined,
  broker?: BrokerLedgerActivitySource,
): boolean {
  if ((transactions ?? []).some((t) => String(t.accountId) === String(accountId))) return true;
  const portfolioIds = new Set((broker?.portfolioIds ?? []).map((id) => String(id)));
  return (broker?.investmentTransactions ?? []).some((t) => {
    if (String(t?.accountId ?? '') === String(accountId)) return true;
    const pid = String(t?.portfolioId ?? '');
    return pid !== '' && portfolioIds.has(pid);
  });
}

export function resolveCashReconcileMechanism(
  accountId: string,
  transactions: Transaction[] | undefined,
  requested?: ReconciliationMechanism,
  broker?: BrokerLedgerActivitySource,
): 'reconcile_balance' | 'opening_balance' {
  if (requested === 'opening_balance' && !accountHasLedgerActivity(accountId, transactions, broker)) {
    return 'opening_balance';
  }
  return 'reconcile_balance';
}

export function previewCashAccountReconcile(args: {
  account: Account;
  actualValue: number;
  transactions?: Transaction[];
  investmentTransactions?: { accountId?: string; portfolioId?: string }[];
  portfolioIds?: string[];
  mechanism?: ReconciliationMechanism;
  effectiveDate?: string;
  reason?: string;
  confirmBackdated?: boolean;
}): ReconciliationPreview {
  const before = roundMoney(Number(args.account.balance) || 0);
  const actual = roundMoney(Number(args.actualValue));
  const delta = computeReconcileDelta(before, actual);
  const currency = args.account.currency === 'USD' ? 'USD' : 'SAR';
  const mechanism = resolveCashReconcileMechanism(
    args.account.id,
    args.transactions,
    args.mechanism,
    { investmentTransactions: args.investmentTransactions, portfolioIds: args.portfolioIds },
  );
  const effectiveDate = (args.effectiveDate || appCalendarTodayYmd()).slice(0, 10);
  const today = appCalendarTodayYmd();
  const impacts: string[] = [];
  let blockedReason: string | undefined;

  if (!Number.isFinite(actual)) {
    blockedReason = 'Actual balance must be a finite number.';
  } else if (args.reason != null && !isValidReason(args.reason)) {
    blockedReason = 'Reason is required (at least 3 characters).';
  } else if (args.account.type === 'Investment') {
    impacts.push('Broker uninvested cash will move by the delta via an investment ledger row.');
    if (delta < 0) {
      impacts.push(
        'Downward cash reconcile posts a tagged ledger balancing row (not economic capital withdrawn — Invested / Withdrawn KPIs ignore it).',
      );
    } else if (delta > 0) {
      impacts.push(
        'Upward cash reconcile posts a tagged ledger balancing row (not economic capital deposited — Invested / Withdrawn KPIs ignore it).',
      );
    }
  } else {
    impacts.push(
      `A ${RECONCILIATION_ADJUSTMENT_CATEGORY} ${delta >= 0 ? 'income' : 'expense'} of ${Math.abs(delta).toFixed(2)} ${currency} will be posted.`,
    );
    if (args.account.type === 'Credit') {
      impacts.push('Linked Credit Card liability amount will mirror the new balance in the same commit.');
    }
  }

  if (effectiveDate < today && !args.confirmBackdated) {
    blockedReason =
      blockedReason ??
      'Backdated reconcile requires confirmation (cashflow KPIs from that day forward will include the adjustment).';
  }
  if (effectiveDate < today && isMonthLocked(yearMonthFromYmd(effectiveDate))) {
    blockedReason =
      blockedReason ??
      `Month ${yearMonthFromYmd(effectiveDate)} is locked — unlock before backdating, or reconcile as of today.`;
  }

  if (mechanism === 'opening_balance') {
    impacts.push(`Category will be ${OPENING_BALANCE_CATEGORY} (first ledger event).`);
  }

  return {
    entityType: 'account',
    entityId: args.account.id,
    mechanism,
    beforeValue: before,
    actualValue: actual,
    delta,
    currency,
    accountType: args.account.type,
    noop: isNoopDelta(delta),
    impacts,
    blockedReason,
  };
}

export function previewRevaluation(args: {
  entityType: 'asset' | 'commodity' | 'liability';
  entityId: string;
  beforeValue: number;
  actualValue: number;
  currency?: 'SAR' | 'USD';
  reason?: string;
}): ReconciliationPreview {
  const before = roundMoney(Number(args.beforeValue) || 0);
  const actual = roundMoney(Number(args.actualValue));
  const delta = computeReconcileDelta(before, actual);
  const mechanism =
    args.entityType === 'asset'
      ? 'asset_revaluation'
      : args.entityType === 'commodity'
        ? 'commodity_revaluation'
        : 'liability_restatement';
  let blockedReason: string | undefined;
  if (!Number.isFinite(actual)) blockedReason = 'Target value must be a finite number.';
  if (args.reason != null && !isValidReason(args.reason)) {
    blockedReason = blockedReason ?? 'Reason is required (at least 3 characters).';
  }
  const impacts =
    args.entityType === 'liability'
      ? ['Liability principal restated; net worth / debt KPIs update. No cash transaction.']
      : ['Balance-sheet revaluation only — no cash transaction will be created.'];
  if (args.entityType === 'liability') {
    impacts.push('If Credit-linked, the credit account balance will be mirrored.');
  }
  return {
    entityType: args.entityType,
    entityId: args.entityId,
    mechanism,
    beforeValue: before,
    actualValue: actual,
    delta,
    currency: args.currency === 'USD' ? 'USD' : 'SAR',
    noop: isNoopDelta(delta),
    impacts,
    blockedReason,
  };
}

/**
 * Direct Sukuk position: restate outstanding principal (the number that feeds Sukuk exposure).
 * Posted coupon/principal events stay untouched; only unposted future events are rebuilt on apply.
 */
export function previewSukukPrincipalRestatement(args: {
  positionId: string;
  beforeValue: number;
  actualValue: number;
  faceValue?: number;
  currency?: 'SAR' | 'USD';
  status?: string;
  reason?: string;
}): ReconciliationPreview {
  const before = roundMoney(Number(args.beforeValue) || 0);
  const actual = roundMoney(Number(args.actualValue));
  const delta = computeReconcileDelta(before, actual);
  let blockedReason: string | undefined;
  if (!Number.isFinite(actual) || actual < 0) {
    blockedReason = 'Outstanding principal must be a non-negative finite number.';
  }
  const face = Number(args.faceValue);
  if (blockedReason == null && Number.isFinite(face) && face > 0 && actual > roundMoney(face)) {
    blockedReason = 'Outstanding principal cannot exceed the Sukuk face value.';
  }
  if (blockedReason == null && args.reason != null && !isValidReason(args.reason)) {
    blockedReason = 'Reason is required (at least 3 characters).';
  }
  return {
    entityType: 'sukuk_position',
    entityId: args.positionId,
    mechanism: 'sukuk_face_yield',
    beforeValue: before,
    actualValue: actual,
    delta,
    currency: args.currency === 'USD' ? 'USD' : 'SAR',
    noop: isNoopDelta(delta),
    impacts: [
      'Sukuk exposure and net worth update from the restated outstanding principal. No cash transaction.',
      'Posted coupon/principal payouts are preserved; only unposted future events are regenerated.',
    ],
    blockedReason,
  };
}

export function previewHoldingQuantityReconcile(args: {
  holdingId: string;
  beforeQty: number;
  actualQty: number;
  /** Cost of *added* shares when quantity increases (legacy / preferred for buys). */
  costBasisTotal?: number;
  /** Full remaining book cost after reconcile (optional restatement). */
  targetBookCost?: number;
  /** Remaining avg cost after reconcile (optional restatement). */
  targetAvgCost?: number;
  beforeAvgCost?: number;
  /** When true, qty+cost noop still applies so open lots can be trim+cost-aligned. */
  alignLotCostsToBook?: boolean;
  reason?: string;
}): ReconciliationPreview {
  const before = Number(args.beforeQty) || 0;
  const actual = Number(args.actualQty);
  const delta = actual - before;
  const beforeAvg = Number(args.beforeAvgCost) || 0;
  const beforeBook = roundMoney(before * beforeAvg);
  let blockedReason: string | undefined;
  if (!Number.isFinite(actual) || actual < 0) {
    blockedReason = 'Actual quantity must be a non-negative finite number.';
  }

  const hasTargetBook =
    args.targetBookCost != null && Number.isFinite(Number(args.targetBookCost)) && Number(args.targetBookCost) >= 0;
  const hasTargetAvg =
    args.targetAvgCost != null && Number.isFinite(Number(args.targetAvgCost)) && Number(args.targetAvgCost) >= 0;
  const hasAddCost =
    args.costBasisTotal != null && Number.isFinite(Number(args.costBasisTotal)) && Number(args.costBasisTotal) >= 0;

  if (delta > 0 && !hasAddCost && !hasTargetBook) {
    blockedReason =
      blockedReason ??
      'Increasing quantity requires total cost basis for the added shares (or a full restated book cost).';
  }
  if (actual > 0 && hasTargetBook && Number(args.targetBookCost) < 0) {
    blockedReason = blockedReason ?? 'Target book cost cannot be negative.';
  }
  if (args.reason != null && !isValidReason(args.reason)) {
    blockedReason = blockedReason ?? 'Reason is required (at least 3 characters).';
  }

  let nextAvg = beforeAvg;
  let nextBook = beforeBook;
  if (actual <= 0) {
    nextAvg = 0;
    nextBook = 0;
  } else if (hasTargetBook) {
    nextBook = roundMoney(Number(args.targetBookCost));
    nextAvg = roundAvgCostPerUnit(nextBook / actual);
  } else if (hasTargetAvg && delta <= 0) {
    nextAvg = roundAvgCostPerUnit(Number(args.targetAvgCost));
    nextBook = roundMoney(nextAvg * actual);
  } else if (delta > 0 && hasAddCost) {
    nextBook = roundMoney(beforeBook + Number(args.costBasisTotal));
    nextAvg = roundAvgCostPerUnit(nextBook / actual);
  } else if (hasTargetAvg) {
    nextAvg = roundAvgCostPerUnit(Number(args.targetAvgCost));
    nextBook = roundMoney(nextAvg * actual);
  } else {
    nextBook = roundMoney(beforeAvg * actual);
    nextAvg = beforeAvg;
  }

  const qtyNoop = Math.abs(delta) < 1e-9;
  const costNoop = Math.abs(nextBook - beforeBook) < 0.005 && Math.abs(nextAvg - beforeAvg) < 1e-6;
  const forceLotAlign = args.alignLotCostsToBook === true && actual > 0;
  const impacts: string[] = [
    'Symbol-only holding book update; market marks unchanged.',
    'Non-cash correction only — no sell, deposit, or withdrawal is posted, so Invested / Withdrawn and cashflow KPIs are unchanged.',
    'Open lots are trimmed FIFO when quantity decreases, then cost-aligned to the restated book when requested.',
  ];
  if (!qtyNoop) {
    impacts.push(
      delta > 0
        ? `Quantity ${before} → ${actual} (+${roundMoney(delta)} shares).`
        : `Quantity ${before} → ${actual} (${roundMoney(delta)} shares — book reduction only, not a cash withdrawal).`,
    );
  }
  if (!costNoop) {
    impacts.push(
      `Cost basis ${beforeBook.toFixed(2)} → ${nextBook.toFixed(2)} (avg ${beforeAvg.toFixed(4)} → ${nextAvg.toFixed(4)}).`,
    );
  }
  if (forceLotAlign && qtyNoop && costNoop) {
    impacts.push('Holding book unchanged — open lots will be trimmed and cost-aligned to the current WAC book.');
  }

  return {
    entityType: 'holding',
    entityId: args.holdingId,
    mechanism: 'reconcile_quantity',
    beforeValue: before,
    actualValue: actual,
    delta,
    currency: 'SAR',
    noop: qtyNoop && costNoop && !forceLotAlign,
    impacts,
    blockedReason,
  };
}

export function portfolioIdsForAccount(data: FinancialData, accountId: string): string[] {
  return (data.investments ?? [])
    .filter(
      (p) =>
        String((p as { accountId?: string }).accountId ?? (p as { account_id?: string }).account_id ?? '') ===
        String(accountId),
    )
    .map((p) => String(p.id));
}

export function previewFromInput(
  data: FinancialData,
  input: ApplyReconciliationInput,
): ReconciliationPreview | { error: string } {
  if (!isValidReason(input.reason) && input.reason !== undefined) {
    return { error: 'Reason is required (at least 3 characters).' };
  }
  if (input.entityType === 'account') {
    const account = (data.accounts ?? []).find((a) => a.id === input.entityId);
    if (!account) return { error: 'Account not found.' };
    return previewCashAccountReconcile({
      account,
      actualValue: input.actualValue,
      transactions: data.transactions,
      investmentTransactions: data.investmentTransactions,
      portfolioIds: portfolioIdsForAccount(data, account.id),
      mechanism: input.mechanism,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      confirmBackdated: input.confirmBackdated,
    });
  }
  if (input.entityType === 'asset') {
    const asset = (data.assets ?? []).find((a) => a.id === input.entityId);
    if (!asset) return { error: 'Asset not found.' };
    return previewRevaluation({
      entityType: 'asset',
      entityId: asset.id,
      beforeValue: Number(asset.value ?? 0),
      actualValue: input.actualValue,
      reason: input.reason,
    });
  }
  if (input.entityType === 'commodity') {
    const c = (data.commodityHoldings ?? []).find((h) => h.id === input.entityId);
    if (!c) return { error: 'Commodity holding not found.' };
    return previewRevaluation({
      entityType: 'commodity',
      entityId: c.id,
      beforeValue: Number(c.currentValue ?? 0),
      actualValue: input.actualValue,
      reason: input.reason,
    });
  }
  if (input.entityType === 'liability') {
    const l = (data.liabilities ?? []).find((x) => x.id === input.entityId);
    if (!l) return { error: 'Liability not found.' };
    return previewRevaluation({
      entityType: 'liability',
      entityId: l.id,
      beforeValue: Number(l.amount ?? 0),
      actualValue: input.actualValue,
      reason: input.reason,
    });
  }
  if (input.entityType === 'sukuk_position') {
    const p = (data.sukukPositions ?? []).find((x) => x.id === input.entityId);
    if (!p) return { error: 'Sukuk position not found.' };
    return previewSukukPrincipalRestatement({
      positionId: p.id,
      beforeValue: Number(p.outstandingPrincipal ?? 0),
      actualValue: input.actualValue,
      faceValue: Number(p.faceValue ?? 0),
      currency: p.currency === 'USD' ? 'USD' : 'SAR',
      status: p.status,
      reason: input.reason,
    });
  }
  if (input.entityType === 'holding') {
    let beforeQty = 0;
    let beforeAvgCost = 0;
    for (const p of data.investments ?? []) {
      const h = (p.holdings ?? []).find((x) => x.id === input.entityId);
      if (h) {
        beforeQty = Number(h.quantity) || 0;
        beforeAvgCost = Number(h.avgCost) || 0;
        break;
      }
    }
    return previewHoldingQuantityReconcile({
      holdingId: input.entityId,
      beforeQty,
      actualQty: input.actualValue,
      costBasisTotal: input.costBasisTotal,
      targetBookCost: input.targetBookCost,
      targetAvgCost: input.targetAvgCost,
      beforeAvgCost,
      alignLotCostsToBook: input.alignLotCostsToBook,
      reason: input.reason,
    });
  }
  return { error: `Unsupported entity type: ${input.entityType}` };
}

export { normalizeReason, isValidReason };
