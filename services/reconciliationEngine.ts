/**
 * Reconciliation logic (spec §25).
 * Holdings vs buy/sell ledger; dividends vs cash; liability vs payments; exception report.
 */

import type { Holding, InvestmentTransaction, Liability, Transaction } from '../types';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';

/** Compare sum of (buy - sell) quantity to current holding quantity. */
export function reconcileHoldings(args: {
  holding: Pick<Holding, 'id' | 'symbol' | 'quantity'>;
  trades: Pick<InvestmentTransaction, 'symbol' | 'type' | 'quantity'>[];
}): { ledgerQuantity: number; storedQuantity: number; drift: number; ok: boolean } {
  const symbol = String(args.holding.symbol ?? '').toUpperCase();
  const stored = Math.max(0, Number(args.holding.quantity) || 0);
  let ledger = 0;
  (args.trades ?? []).forEach((t) => {
    if (String(t.symbol).toUpperCase() !== symbol) return;
    if (isInvestmentTransactionType(t.type, 'buy')) ledger += Math.max(0, Number(t.quantity) || 0);
    if (isInvestmentTransactionType(t.type, 'sell')) ledger -= Math.max(0, Number(t.quantity) || 0);
  });
  const drift = stored - ledger;
  const ok = Math.abs(drift) < 0.0001;
  return { ledgerQuantity: ledger, storedQuantity: stored, drift, ok };
}

/** Sum dividend transactions for an account vs expected (from holdings); simplified. */
export function reconcileDividends(args: {
  accountId: string;
  dividendTxs: Pick<InvestmentTransaction, 'accountId' | 'type' | 'total'>[];
  /** Expected total from holdings (optional). */
  expectedFromHoldings?: number;
}): { recordedTotal: number; expectedTotal: number; drift: number } {
  const recorded = (args.dividendTxs ?? [])
    .filter((t) => t.accountId === args.accountId && isInvestmentTransactionType(t.type, 'dividend'))
    .reduce((s, t) => s + Math.max(0, Number(t.total) || 0), 0);
  const expected = Number(args.expectedFromHoldings) ?? 0;
  return { recordedTotal: recorded, expectedTotal: expected, drift: expected - recorded };
}

/** Liability balance vs sum of payments (transactions tagged to this liability). */
export function reconcileLiabilities(args: {
  liability: Pick<Liability, 'id' | 'amount'>;
  /** Payments: expenses or transfers linked to this liability (e.g. by category or note). */
  paymentTxs: Pick<Transaction, 'amount' | 'category' | 'note'>[];
  /** Optional: opening balance to start from. */
  openingBalance?: number;
}): { storedBalance: number; paymentNet: number; drift: number } {
  const stored = Math.abs(Number(args.liability.amount) ?? 0);
  const paymentNet = (args.paymentTxs ?? []).reduce((s, t) => s + (Number(t.amount) ?? 0), 0);
  const opening = Number(args.openingBalance) ?? 0;
  const expected = opening - paymentNet;
  const drift = stored - expected;
  return { storedBalance: stored, paymentNet, drift };
}

export interface ReconciliationException {
  type: 'cash' | 'holding' | 'dividend' | 'liability';
  id: string;
  message: string;
  severity: 'warning' | 'error';
}

/** Aggregate exceptions from cash, holdings, dividends, liabilities. */
export function reconciliationExceptionReport(args: {
  cashExceptions: {
    accountId: string;
    drift: number;
    showWarning: boolean;
    /** Checking/Savings book currency for the drift amount. */
    bookCurrency?: string;
    /** Display name for the account. */
    accountLabel?: string;
  }[];
  holdingExceptions: { symbol: string; drift: number }[];
  dividendExceptions?: { accountId: string; drift: number }[];
  liabilityExceptions?: { liabilityId: string; drift: number }[];
}): ReconciliationException[] {
  const out: ReconciliationException[] = [];
  (args.cashExceptions ?? []).forEach((c) => {
    if (!c.showWarning) return;
    const cur = c.bookCurrency ?? 'book ccy';
    const lab = c.accountLabel ? `${c.accountLabel} (${c.accountId})` : c.accountId;
    out.push({
      type: 'cash',
      id: c.accountId,
      message: `Cash balance drift: ${c.drift.toFixed(2)} ${cur} — ${lab}`,
      severity: Math.abs(c.drift) > 500 ? 'error' : 'warning',
    });
  });
  (args.holdingExceptions ?? []).forEach((h) => {
    if (Math.abs(h.drift) < 0.0001) return;
    out.push({
      type: 'holding',
      id: h.symbol,
      message: `Holding quantity drift: ${h.drift.toFixed(4)}`,
      severity: 'warning',
    });
  });
  (args.dividendExceptions ?? []).forEach((d) => {
    if (Math.abs(d.drift) < 0.01) return;
    out.push({
      type: 'dividend',
      id: d.accountId,
      message: `Dividend ledger drift: ${d.drift.toFixed(2)}`,
      severity: 'warning',
    });
  });
  (args.liabilityExceptions ?? []).forEach((l) => {
    if (Math.abs(l.drift) < 0.01) return;
    out.push({
      type: 'liability',
      id: l.liabilityId,
      message: `Liability balance drift: ${l.drift.toFixed(2)}`,
      severity: Math.abs(l.drift) > 500 ? 'error' : 'warning',
    });
  });
  return out;
}
