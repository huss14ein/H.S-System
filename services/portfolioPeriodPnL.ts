import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { calendarDayStartMs } from '../utils/financialMonth';
import { financialMonthRange } from '../utils/financialMonth';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';
import {
  computePlatformCardMetrics,
  computePortfolioMetricsBundle,
  getPortfolioAttributedTransactions,
  type SimulatedPriceMap,
} from './investmentPlatformCardMetrics';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';

export type PortfolioPeriodPnLBreakdown = {
  /** Realized on sells + dividends − fees/vat in the window (ledger, SAR). */
  ledgerSar: number;
  /** Estimated open-position quote move: daily P/L × trading days in window. */
  marketEstimateSar: number;
  /** ledger + marketEstimate */
  totalSar: number;
};

export type PortfolioPeriodPnLRow = {
  portfolioId: string;
  portfolioName: string;
  accountId: string;
  bookCurrency: ReturnType<typeof resolveInvestmentPortfolioCurrency>;
  valueSar: number;
  dailyPnLSar: number;
  weekly: PortfolioPeriodPnLBreakdown;
  monthly: PortfolioPeriodPnLBreakdown;
};

export type PortfolioPeriodPnLSummary = {
  rows: PortfolioPeriodPnLRow[];
  weeklyTotalSar: number;
  monthlyTotalSar: number;
};

type Lot = { qty: number; avgCostSar: number };

function txDayMs(tx: InvestmentTransaction): number {
  return calendarDayStartMs(String(tx.date ?? '').slice(0, 10));
}

function sortTxsAsc(a: InvestmentTransaction, b: InvestmentTransaction): number {
  return txDayMs(a) - txDayMs(b) || String(a.id).localeCompare(String(b.id));
}

function applyBuy(lots: Map<string, Lot>, symbol: string, qty: number, totalCostSar: number): void {
  if (!(qty > 0)) return;
  const key = symbol.toUpperCase();
  const prev = lots.get(key) ?? { qty: 0, avgCostSar: 0 };
  const nextQty = prev.qty + qty;
  const nextAvg = nextQty > 0 ? (prev.qty * prev.avgCostSar + totalCostSar) / nextQty : 0;
  lots.set(key, { qty: nextQty, avgCostSar: nextAvg });
}

function applySell(lots: Map<string, Lot>, symbol: string, qty: number): number {
  if (!(qty > 0)) return 0;
  const key = symbol.toUpperCase();
  const prev = lots.get(key) ?? { qty: 0, avgCostSar: 0 };
  const sellQty = Math.min(qty, prev.qty);
  const costSar = sellQty * prev.avgCostSar;
  const nextQty = Math.max(0, prev.qty - sellQty);
  if (nextQty > 0) lots.set(key, { qty: nextQty, avgCostSar: prev.avgCostSar });
  else lots.delete(key);
  return costSar;
}

/** Ledger P/L in [startMs, endMs]: realized sells + dividends − fees (SAR). */
export function computePortfolioLedgerPnLSarInRange(args: {
  transactions: InvestmentTransaction[];
  startMs: number;
  endMs: number;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
}): number {
  const { transactions, startMs, endMs, accounts, portfolios, data, sarPerUsd } = args;
  const lots = new Map<string, Lot>();
  let realized = 0;
  let dividends = 0;
  let fees = 0;

  const sorted = [...transactions].sort(sortTxsAsc);

  for (const tx of sorted) {
    const day = txDayMs(tx);
    if (Number.isNaN(day)) continue;
    const sym = String(tx.symbol ?? '').trim().toUpperCase();
    const qty = Math.abs(Number(tx.quantity) || 0);
    const cashSar = investmentTransactionCashAmountSarDated({
      tx,
      accounts,
      portfolios,
      data,
      uiExchangeRate: sarPerUsd,
    });

    if (day < startMs) {
      if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
        applyBuy(lots, sym, qty, cashSar);
      } else if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
        applySell(lots, sym, qty);
      }
      continue;
    }
    if (day > endMs) continue;

    if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
      applyBuy(lots, sym, qty, cashSar);
    } else if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
      const costSar = applySell(lots, sym, qty);
      realized += cashSar - costSar;
    } else if (isInvestmentTransactionType(tx.type, 'dividend')) {
      dividends += cashSar;
    } else if (isInvestmentTransactionType(tx.type, 'fee') || isInvestmentTransactionType(tx.type, 'vat')) {
      fees += cashSar;
    }
  }

  return realized + dividends - fees;
}

function tradingDaysBetween(startMs: number, endMs: number): number {
  if (!(endMs >= startMs)) return 1;
  let count = 0;
  const d = new Date(startMs);
  const end = new Date(endMs);
  d.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  while (d.getTime() <= end.getTime()) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

function weekWindowMs(now: Date): { startMs: number; endMs: number; tradingDays: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    tradingDays: tradingDaysBetween(start.getTime(), end.getTime()),
  };
}

function financialMonthWindowMs(now: Date, monthStartDay: number): { startMs: number; endMs: number; tradingDays: number } {
  const { start, end } = financialMonthRange(now, monthStartDay);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return { startMs, endMs, tradingDays: tradingDaysBetween(startMs, Math.min(endMs, now.getTime())) };
}

/**
 * Per-portfolio weekly & monthly P/L (SAR):
 * - Ledger: realized sells, dividends, fees in the window (avg-cost lots).
 * - Market estimate: Investments-hub daily quote P/L × trading days in window (no stored tick history).
 */
export function computePortfolioPeriodPnLSummary(args: {
  data: FinancialData;
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  monthStartDay: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  now?: Date;
}): PortfolioPeriodPnLSummary {
  const {
    data,
    portfolios,
    accounts,
    sarPerUsd,
    simulatedPrices,
    monthStartDay,
    getAvailableCashForAccount,
    now = new Date(),
  } = args;

  const allTx = getPersonalInvestmentTransactionsForKpis(data);
  const week = weekWindowMs(now);
  const month = financialMonthWindowMs(now, monthStartDay);

  const byAccount = new Map<string, InvestmentPortfolio[]>();
  for (const p of portfolios) {
    const list = byAccount.get(p.accountId) ?? [];
    list.push(p);
    byAccount.set(p.accountId, list);
  }

  const rows: PortfolioPeriodPnLRow[] = [];

  for (const [, siblings] of byAccount) {
    const sorted = [...siblings].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const accountId = sorted[0]?.accountId ?? '';
    const accountTx = allTx.filter(
      (t) => resolveInvestmentTransactionAccountId(t, accounts, portfolios) === accountId,
    );
    const cashBuckets = getAvailableCashForAccount?.(accountId) ?? { SAR: 0, USD: 0 };

    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: sorted,
      transactions: accountTx,
      accounts,
      allInvestments: portfolios,
      sarPerUsd,
      simulatedPrices,
      accountAvailableCashByCurrency: {
        SAR: Math.max(0, cashBuckets?.SAR ?? 0),
        USD: Math.max(0, cashBuckets?.USD ?? 0),
      },
    });

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const txsForLedger =
        sorted.length === 1
          ? accountTx
          : getPortfolioAttributedTransactions({
              portfolioId: p.id,
              portfolioIndex: i,
              siblingPortfolios: sorted,
              transactions: accountTx,
              sarPerUsd,
              simulatedPrices,
            });

      const book = resolveInvestmentPortfolioCurrency(p);
      const metrics =
        bundle.metricsByPortfolioId.get(p.id) ??
        computePlatformCardMetrics({
          portfolios: [p],
          transactions: txsForLedger,
          accounts,
          allInvestments: portfolios,
          sarPerUsd,
          availableCashByCurrency: { SAR: 0, USD: 0 },
          simulatedPrices,
          platformCurrency: book,
          unrealizedPnLBasis: 'holdings_cost',
        });

      const weeklyLedger = computePortfolioLedgerPnLSarInRange({
        transactions: txsForLedger,
        startMs: week.startMs,
        endMs: week.endMs,
        accounts,
        portfolios,
        data,
        sarPerUsd,
      });
      const monthlyLedger = computePortfolioLedgerPnLSarInRange({
        transactions: txsForLedger,
        startMs: month.startMs,
        endMs: month.endMs,
        accounts,
        portfolios,
        data,
        sarPerUsd,
      });

      const weeklyMarket = metrics.dailyPnLSAR * week.tradingDays;
      const monthlyMarket = metrics.dailyPnLSAR * month.tradingDays;

      rows.push({
        portfolioId: p.id,
        portfolioName: p.name || p.id,
        accountId,
        bookCurrency: book,
        valueSar: metrics.totalValueInSAR,
        dailyPnLSar: metrics.dailyPnLSAR,
        weekly: {
          ledgerSar: weeklyLedger,
          marketEstimateSar: weeklyMarket,
          totalSar: weeklyLedger + weeklyMarket,
        },
        monthly: {
          ledgerSar: monthlyLedger,
          marketEstimateSar: monthlyMarket,
          totalSar: monthlyLedger + monthlyMarket,
        },
      });
    }
  }

  rows.sort((a, b) => b.valueSar - a.valueSar);

  return {
    rows,
    weeklyTotalSar: rows.reduce((s, r) => s + r.weekly.totalSar, 0),
    monthlyTotalSar: rows.reduce((s, r) => s + r.monthly.totalSar, 0),
  };
}

/** Lookup map for UI surfaces (Investments portfolio rows, etc.). */
export function portfolioPeriodPnLMap(summary: PortfolioPeriodPnLSummary): Map<string, PortfolioPeriodPnLRow> {
  return new Map(summary.rows.map((r) => [r.portfolioId, r]));
}
