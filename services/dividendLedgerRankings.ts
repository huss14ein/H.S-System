/**
 * Dividend rankings from the user's investment ledger only (no market estimates).
 */

import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import {
  financialMonthKeysEndingAt,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';

export type DividendLedgerEarner = {
  symbol: string;
  name: string;
  receivedSar: number;
  paymentCount: number;
  lastPaymentDate: string | null;
};

export function computeTopDividendEarnersFromLedger(args: {
  dividendTransactions: InvestmentTransaction[];
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData | null;
  uiExchangeRate: number;
  /** Holding symbol → display name */
  nameBySymbol?: Record<string, string>;
  trailingMonths?: number;
  limit?: number;
}): DividendLedgerEarner[] {
  const {
    dividendTransactions,
    accounts,
    portfolios,
    data,
    uiExchangeRate,
    nameBySymbol = {},
    trailingMonths = 12,
    limit = 5,
  } = args;

  const monthStartDay = resolveMonthStartDayFromData(data);
  const now = new Date();
  const finKeys = financialMonthKeysEndingAt(now, trailingMonths, monthStartDay);
  const windowStart = financialMonthRangeFromKey(finKeys[0], monthStartDay).start;

  const bySymbol = new Map<
    string,
    { receivedSar: number; paymentCount: number; lastPaymentDate: string | null; name: string }
  >();

  for (const t of dividendTransactions) {
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const txDate = new Date(t.date);
    if (isNaN(txDate.getTime()) || txDate < windowStart) continue;

    const sar = investmentTransactionCashAmountSarDated({
      tx: t,
      accounts,
      portfolios,
      data,
      uiExchangeRate,
    });
    if (!Number.isFinite(sar) || sar <= 0) continue;

    const prev = bySymbol.get(sym) ?? {
      receivedSar: 0,
      paymentCount: 0,
      lastPaymentDate: null,
      name: nameBySymbol[sym] || sym,
    };
    const dateStr = String(t.date ?? '').slice(0, 10);
    const last =
      !prev.lastPaymentDate || (dateStr && dateStr > prev.lastPaymentDate)
        ? dateStr || prev.lastPaymentDate
        : prev.lastPaymentDate;

    bySymbol.set(sym, {
      receivedSar: prev.receivedSar + sar,
      paymentCount: prev.paymentCount + 1,
      lastPaymentDate: last,
      name: prev.name || nameBySymbol[sym] || sym,
    });
  }

  return [...bySymbol.entries()]
    .map(([symbol, row]) => ({
      symbol,
      name: row.name,
      receivedSar: row.receivedSar,
      paymentCount: row.paymentCount,
      lastPaymentDate: row.lastPaymentDate,
    }))
    .sort((a, b) => b.receivedSar - a.receivedSar)
    .slice(0, Math.max(1, limit));
}
