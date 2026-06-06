import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { calendarDayStartMs } from '../utils/financialMonth';
import { financialMonthRange } from '../utils/financialMonth';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { toSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency, holdingUsesLiveQuote } from '../utils/holdingValuation';
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
  /** Mark-to-market since period start: (end live − start cost) − ledger − external flows. */
  marketEstimateSar: number;
  /** ledger + marketEstimate — same as endValue − startValue − netDepositsWithdrawals. */
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

type LedgerReplayState = {
  lots: Map<string, Lot>;
  cashSar: number;
};

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

function cashSarForTx(args: {
  tx: InvestmentTransaction;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
}): number {
  return investmentTransactionCashAmountSarDated({
    tx: args.tx,
    accounts: args.accounts,
    portfolios: args.portfolios,
    data: args.data,
    uiExchangeRate: args.sarPerUsd,
  });
}

/** Replay portfolio ledger through end of `throughMs` (inclusive). */
export function replayPortfolioLedgerStateThrough(args: {
  transactions: InvestmentTransaction[];
  throughMs: number;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
}): LedgerReplayState {
  const lots = new Map<string, Lot>();
  let cashBalanceSar = 0;
  const sorted = [...args.transactions].sort(sortTxsAsc);

  for (const tx of sorted) {
    const day = txDayMs(tx);
    if (Number.isNaN(day) || day > args.throughMs) continue;
    const sym = String(tx.symbol ?? '').trim().toUpperCase();
    const qty = Math.abs(Number(tx.quantity) || 0);
    const amountSar = cashSarForTx({ tx, ...args });

    if (isInvestmentTransactionType(tx.type, 'deposit')) {
      cashBalanceSar += amountSar;
      continue;
    }
    if (isInvestmentTransactionType(tx.type, 'withdrawal')) {
      cashBalanceSar -= amountSar;
      continue;
    }
    if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
      applyBuy(lots, sym, qty, amountSar);
      cashBalanceSar -= amountSar;
      continue;
    }
    if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
      applySell(lots, sym, qty);
      cashBalanceSar += amountSar;
      continue;
    }
    if (isInvestmentTransactionType(tx.type, 'dividend')) {
      cashBalanceSar += amountSar;
      continue;
    }
    if (isInvestmentTransactionType(tx.type, 'fee') || isInvestmentTransactionType(tx.type, 'vat')) {
      cashBalanceSar -= amountSar;
    }
  }

  return { lots, cashSar: cashBalanceSar };
}

function holdingBySymbol(portfolio: InvestmentPortfolio): Map<string, Holding> {
  const map = new Map<string, Holding>();
  for (const h of portfolio.holdings ?? []) {
    const sym = String(h.symbol ?? '').trim().toUpperCase();
    if (sym) map.set(sym, h);
  }
  return map;
}

/** When ledger replay has no lots (imported holdings), open the period from current qty × avg cost. */
function seedLedgerStateFromHoldingsIfEmpty(
  state: LedgerReplayState,
  portfolio: InvestmentPortfolio,
  sarPerUsd: number,
): LedgerReplayState {
  if (state.lots.size > 0) return state;
  const book = resolveInvestmentPortfolioCurrency(portfolio);
  const lots = new Map<string, Lot>();
  for (const h of portfolio.holdings ?? []) {
    const sym = String(h.symbol ?? '').trim().toUpperCase();
    const qty = Number(h.quantity ?? 0);
    const avg = Number(h.avgCost ?? 0);
    if (!(sym && qty > 0 && avg > 0)) continue;
    lots.set(sym, { qty, avgCostSar: toSAR(avg, book, sarPerUsd) });
  }
  return { lots, cashSar: state.cashSar };
}

/** Portfolio value at a ledger cutoff — cost basis unless `useLiveMark`. */
export function computePortfolioSnapshotValueSar(args: {
  portfolio: InvestmentPortfolio;
  state: LedgerReplayState;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  useLiveMark: boolean;
  includeCash: boolean;
}): number {
  const book = resolveInvestmentPortfolioCurrency(args.portfolio);
  const holdingsBySym = holdingBySymbol(args.portfolio);
  let holdingsSar = 0;

  for (const [sym, lot] of args.state.lots) {
    if (!(lot.qty > 0)) continue;
    const holding = holdingsBySym.get(sym);
    if (args.useLiveMark && holding && holdingUsesLiveQuote(holding)) {
      const synthetic = { ...holding, quantity: lot.qty };
      const v = effectiveHoldingValueInBookCurrency(synthetic, book, args.simulatedPrices, args.sarPerUsd);
      holdingsSar += toSAR(v, book, args.sarPerUsd);
    } else {
      holdingsSar += lot.qty * lot.avgCostSar;
    }
  }

  return holdingsSar + (args.includeCash ? args.state.cashSar : 0);
}

/** Net external cash added to the portfolio in [startMs, endMs]: deposits − withdrawals (SAR). */
export function computeNetExternalInvestmentFlowSarInRange(args: {
  transactions: InvestmentTransaction[];
  startMs: number;
  endMs: number;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
}): number {
  let deposits = 0;
  let withdrawals = 0;
  for (const tx of args.transactions) {
    const day = txDayMs(tx);
    if (Number.isNaN(day) || day < args.startMs || day > args.endMs) continue;
    const cashSar = cashSarForTx({ tx, ...args });
    if (isInvestmentTransactionType(tx.type, 'deposit')) deposits += cashSar;
    else if (isInvestmentTransactionType(tx.type, 'withdrawal')) withdrawals += cashSar;
  }
  return deposits - withdrawals;
}

/**
 * Mark-to-market period P/L (SAR): end live value − start cost snapshot − net deposits/withdrawals.
 * Same formula as Wealth Analytics / Investments hub — not daily P/L × trading days.
 */
export function computePortfolioMarkToMarketPeriodPnLSar(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  startMs: number;
  endMs: number;
  endValueSar: number;
  includeCash: boolean;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
}): PortfolioPeriodPnLBreakdown {
  const startThroughMs = Math.max(0, args.startMs - 1);
  const startState = seedLedgerStateFromHoldingsIfEmpty(
    replayPortfolioLedgerStateThrough({
      transactions: args.transactions,
      throughMs: startThroughMs,
      accounts: args.accounts,
      portfolios: args.portfolios,
      data: args.data,
      sarPerUsd: args.sarPerUsd,
    }),
    args.portfolio,
    args.sarPerUsd,
  );
  const startValueSar = computePortfolioSnapshotValueSar({
    portfolio: args.portfolio,
    state: startState,
    sarPerUsd: args.sarPerUsd,
    simulatedPrices: args.simulatedPrices,
    useLiveMark: false,
    includeCash: args.includeCash,
  });

  const externalFlowSar = computeNetExternalInvestmentFlowSarInRange({
    transactions: args.transactions,
    startMs: args.startMs,
    endMs: args.endMs,
    accounts: args.accounts,
    portfolios: args.portfolios,
    data: args.data,
    sarPerUsd: args.sarPerUsd,
  });

  const ledgerSar = computePortfolioLedgerPnLSarInRange({
    transactions: args.transactions,
    startMs: args.startMs,
    endMs: args.endMs,
    accounts: args.accounts,
    portfolios: args.portfolios,
    data: args.data,
    sarPerUsd: args.sarPerUsd,
  });

  const totalSar = args.endValueSar - startValueSar - externalFlowSar;
  const marketEstimateSar = totalSar - ledgerSar;

  return { ledgerSar, marketEstimateSar, totalSar };
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
    const txCashSar = cashSarForTx({ tx, accounts, portfolios, data, sarPerUsd });

    if (day < startMs) {
      if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
        applyBuy(lots, sym, qty, txCashSar);
      } else if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
        applySell(lots, sym, qty);
      }
      continue;
    }
    if (day > endMs) continue;

    if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
      applyBuy(lots, sym, qty, txCashSar);
    } else if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
      const costSar = applySell(lots, sym, qty);
      realized += txCashSar - costSar;
    } else if (isInvestmentTransactionType(tx.type, 'dividend')) {
      dividends += txCashSar;
    } else if (isInvestmentTransactionType(tx.type, 'fee') || isInvestmentTransactionType(tx.type, 'vat')) {
      fees += txCashSar;
    }
  }

  return realized + dividends - fees;
}

function weekWindowMs(now: Date): { startMs: number; endMs: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function financialMonthWindowMs(now: Date, monthStartDay: number): { startMs: number; endMs: number } {
  const { start, end } = financialMonthRange(now, monthStartDay);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return { startMs, endMs: Math.min(endMs, now.getTime()) };
}

/**
 * Per-portfolio weekly & monthly P/L (SAR) — single source of truth:
 * end live value − start-of-period cost snapshot − net deposits/withdrawals;
 * ledger = realized sells, dividends, fees; market = residual open-position MTM.
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
      const includeCash = sorted.length === 1;
      const metrics =
        bundle.metricsByPortfolioId.get(p.id) ??
        computePlatformCardMetrics({
          portfolios: [p],
          transactions: txsForLedger,
          accounts,
          allInvestments: portfolios,
          sarPerUsd,
          availableCashByCurrency: includeCash
            ? { SAR: Math.max(0, cashBuckets?.SAR ?? 0), USD: Math.max(0, cashBuckets?.USD ?? 0) }
            : { SAR: 0, USD: 0 },
          simulatedPrices,
          platformCurrency: book,
          unrealizedPnLBasis: 'holdings_cost',
        });

      const endValueSar = metrics.totalValueInSAR;

      const weekly = computePortfolioMarkToMarketPeriodPnLSar({
        portfolio: p,
        transactions: txsForLedger,
        startMs: week.startMs,
        endMs: week.endMs,
        endValueSar,
        includeCash,
        accounts,
        portfolios,
        data,
        sarPerUsd,
        simulatedPrices,
      });
      const monthly = computePortfolioMarkToMarketPeriodPnLSar({
        portfolio: p,
        transactions: txsForLedger,
        startMs: month.startMs,
        endMs: month.endMs,
        endValueSar,
        includeCash,
        accounts,
        portfolios,
        data,
        sarPerUsd,
        simulatedPrices,
      });

      rows.push({
        portfolioId: p.id,
        portfolioName: p.name || p.id,
        accountId,
        bookCurrency: book,
        valueSar: endValueSar,
        dailyPnLSar: metrics.dailyPnLSAR,
        weekly,
        monthly,
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

export type PortfolioPnLDailyPoint = {
  day: string;
  label: string;
  ledgerSar: number;
  marketEstimateSar: number;
  totalSar: number;
  cumulativeSar: number;
};

export type PortfolioPnLDailySeries = {
  weekly: PortfolioPnLDailyPoint[];
  monthly: PortfolioPnLDailyPoint[];
  weeklyByPortfolioId: Map<string, PortfolioPnLDailyPoint[]>;
};

function eachCalendarDayIsoInRange(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function dayBoundsMs(dayIso: string): { startMs: number; endMs: number } {
  return {
    startMs: new Date(`${dayIso}T00:00:00`).getTime(),
    endMs: new Date(`${dayIso}T23:59:59.999`).getTime(),
  };
}

type LedgerTxContext = {
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
};

function applyTxToLedgerReplayState(
  state: LedgerReplayState,
  tx: InvestmentTransaction,
  ctx: LedgerTxContext,
): void {
  const sym = String(tx.symbol ?? '').trim().toUpperCase();
  const qty = Math.abs(Number(tx.quantity) || 0);
  const amountSar = cashSarForTx({ tx, ...ctx });

  if (isInvestmentTransactionType(tx.type, 'deposit')) {
    state.cashSar += amountSar;
    return;
  }
  if (isInvestmentTransactionType(tx.type, 'withdrawal')) {
    state.cashSar -= amountSar;
    return;
  }
  if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
    applyBuy(state.lots, sym, qty, amountSar);
    state.cashSar -= amountSar;
    return;
  }
  if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
    applySell(state.lots, sym, qty);
    state.cashSar += amountSar;
    return;
  }
  if (isInvestmentTransactionType(tx.type, 'dividend')) {
    state.cashSar += amountSar;
    return;
  }
  if (isInvestmentTransactionType(tx.type, 'fee') || isInvestmentTransactionType(tx.type, 'vat')) {
    state.cashSar -= amountSar;
  }
}

/** Ledger P/L delta for one in-window tx (realized + dividends − fees). */
function applyTxToLedgerPnLLots(
  lots: Map<string, Lot>,
  tx: InvestmentTransaction,
  ctx: LedgerTxContext,
): number {
  const sym = String(tx.symbol ?? '').trim().toUpperCase();
  const qty = Math.abs(Number(tx.quantity) || 0);
  const txCashSar = cashSarForTx({ tx, ...ctx });

  if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
    applyBuy(lots, sym, qty, txCashSar);
    return 0;
  }
  if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
    const costSar = applySell(lots, sym, qty);
    return txCashSar - costSar;
  }
  if (isInvestmentTransactionType(tx.type, 'dividend')) {
    return txCashSar;
  }
  if (isInvestmentTransactionType(tx.type, 'fee') || isInvestmentTransactionType(tx.type, 'vat')) {
    return -txCashSar;
  }
  return 0;
}

function seedLedgerPnLLotsBeforeWindow(
  lots: Map<string, Lot>,
  transactions: InvestmentTransaction[],
  startMs: number,
  ctx: LedgerTxContext,
): void {
  const sorted = [...transactions].sort(sortTxsAsc);
  for (const tx of sorted) {
    const day = txDayMs(tx);
    if (Number.isNaN(day) || day >= startMs) break;
    const sym = String(tx.symbol ?? '').trim().toUpperCase();
    const qty = Math.abs(Number(tx.quantity) || 0);
    const txCashSar = cashSarForTx({ tx, ...ctx });
    if (isInvestmentTransactionType(tx.type, 'buy') && sym) {
      applyBuy(lots, sym, qty, txCashSar);
    } else if (isInvestmentTransactionType(tx.type, 'sell') && sym) {
      applySell(lots, sym, qty);
    }
  }
}

function buildPortfolioDailySeriesInWindow(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  startMs: number;
  endMs: number;
  endValueSar: number;
  includeCash: boolean;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  locale?: string;
}): PortfolioPnLDailyPoint[] {
  const days = eachCalendarDayIsoInRange(args.startMs, args.endMs);
  if (days.length === 0) return [];

  const ctx: LedgerTxContext = {
    accounts: args.accounts,
    portfolios: args.portfolios,
    data: args.data,
    sarPerUsd: args.sarPerUsd,
  };
  const sorted = [...args.transactions].sort(sortTxsAsc);
  const startThroughMs = Math.max(0, args.startMs - 1);
  const replayState = seedLedgerStateFromHoldingsIfEmpty(
    replayPortfolioLedgerStateThrough({
      transactions: args.transactions,
      throughMs: startThroughMs,
      ...ctx,
    }),
    args.portfolio,
    args.sarPerUsd,
  );
  const startValueSar = computePortfolioSnapshotValueSar({
    portfolio: args.portfolio,
    state: replayState,
    sarPerUsd: args.sarPerUsd,
    simulatedPrices: args.simulatedPrices,
    useLiveMark: false,
    includeCash: args.includeCash,
  });

  const ledgerLots = new Map<string, Lot>();
  seedLedgerPnLLotsBeforeWindow(ledgerLots, args.transactions, args.startMs, ctx);

  let txIdx = 0;
  while (txIdx < sorted.length && txDayMs(sorted[txIdx]!) < args.startMs) txIdx++;

  const lastDayIso = days[days.length - 1]!;
  let prevCumulative = 0;
  let prevLedgerToDate = 0;
  let ledgerToDate = 0;
  let externalToDate = 0;

  return days.map((day) => {
    const { endMs: dayEndMs } = dayBoundsMs(day);

    while (txIdx < sorted.length) {
      const tx = sorted[txIdx]!;
      const dayMs = txDayMs(tx);
      if (Number.isNaN(dayMs) || dayMs > dayEndMs) break;
      if (dayMs >= args.startMs) {
        applyTxToLedgerReplayState(replayState, tx, ctx);
        ledgerToDate += applyTxToLedgerPnLLots(ledgerLots, tx, ctx);
        const cashSar = cashSarForTx({ tx, ...ctx });
        if (isInvestmentTransactionType(tx.type, 'deposit')) externalToDate += cashSar;
        else if (isInvestmentTransactionType(tx.type, 'withdrawal')) externalToDate -= cashSar;
      }
      txIdx++;
    }

    const endValueSar =
      day === lastDayIso
        ? args.endValueSar
        : computePortfolioSnapshotValueSar({
            portfolio: args.portfolio,
            state: replayState,
            sarPerUsd: args.sarPerUsd,
            simulatedPrices: args.simulatedPrices,
            useLiveMark: false,
            includeCash: args.includeCash,
          });

    const cumulativeSar = endValueSar - startValueSar - externalToDate;
    const totalSar = cumulativeSar - prevCumulative;
    const dayLedgerSar = ledgerToDate - prevLedgerToDate;
    const marketEstimateSar = totalSar - dayLedgerSar;

    prevCumulative = cumulativeSar;
    prevLedgerToDate = ledgerToDate;

    const label = new Date(`${day}T12:00:00`).toLocaleDateString(args.locale ?? 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    return {
      day,
      label,
      ledgerSar: dayLedgerSar,
      marketEstimateSar,
      totalSar,
      cumulativeSar,
    };
  });
}

function aggregateDailySeries(seriesList: PortfolioPnLDailyPoint[][]): PortfolioPnLDailyPoint[] {
  if (seriesList.length === 0) return [];
  const dayOrder = seriesList[0].map((p) => p.day);
  const byDay = new Map<string, { ledgerSar: number; marketEstimateSar: number; totalSar: number; label: string }>();
  for (const series of seriesList) {
    for (const p of series) {
      const prev = byDay.get(p.day) ?? { ledgerSar: 0, marketEstimateSar: 0, totalSar: 0, label: p.label };
      byDay.set(p.day, {
        label: p.label,
        ledgerSar: prev.ledgerSar + p.ledgerSar,
        marketEstimateSar: prev.marketEstimateSar + p.marketEstimateSar,
        totalSar: prev.totalSar + p.totalSar,
      });
    }
  }
  let cumulative = 0;
  return dayOrder.map((day) => {
    const row = byDay.get(day)!;
    cumulative += row.totalSar;
    return {
      day,
      label: row.label,
      ledgerSar: row.ledgerSar,
      marketEstimateSar: row.marketEstimateSar,
      totalSar: row.totalSar,
      cumulativeSar: cumulative,
    };
  });
}

/** Daily cumulative P/L series for charts and sparklines (mark-to-market, aligned with summary totals). */
export function computePortfolioPnLDailySeries(args: {
  data: FinancialData;
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  monthStartDay: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  now?: Date;
  locale?: string;
  /** When provided, skips recomputing {@link computePortfolioPeriodPnLSummary}. */
  summary?: PortfolioPeriodPnLSummary;
}): PortfolioPnLDailySeries {
  const summary = args.summary ?? computePortfolioPeriodPnLSummary(args);
  const allTx = getPersonalInvestmentTransactionsForKpis(args.data);
  const week = weekWindowMs(args.now ?? new Date());
  const month = financialMonthWindowMs(args.now ?? new Date(), args.monthStartDay);

  const weeklyByPortfolioId = new Map<string, PortfolioPnLDailyPoint[]>();
  const weeklyParts: PortfolioPnLDailyPoint[][] = [];
  const monthlyParts: PortfolioPnLDailyPoint[][] = [];

  const byAccount = new Map<string, InvestmentPortfolio[]>();
  for (const p of args.portfolios) {
    const list = byAccount.get(p.accountId) ?? [];
    list.push(p);
    byAccount.set(p.accountId, list);
  }

  for (const [, siblings] of byAccount) {
    const sorted = [...siblings].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const accountId = sorted[0]?.accountId ?? '';
    const accountTx = allTx.filter(
      (t) => resolveInvestmentTransactionAccountId(t, args.accounts, args.portfolios) === accountId,
    );

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const row = summary.rows.find((r) => r.portfolioId === p.id);
      if (!row) continue;
      const includeCash = sorted.length === 1;
      const txsForLedger =
        sorted.length === 1
          ? accountTx
          : getPortfolioAttributedTransactions({
              portfolioId: p.id,
              portfolioIndex: i,
              siblingPortfolios: sorted,
              transactions: accountTx,
              sarPerUsd: args.sarPerUsd,
              simulatedPrices: args.simulatedPrices,
            });

      const weekly = buildPortfolioDailySeriesInWindow({
        portfolio: p,
        transactions: txsForLedger,
        startMs: week.startMs,
        endMs: week.endMs,
        endValueSar: row.valueSar,
        includeCash,
        accounts: args.accounts,
        portfolios: args.portfolios,
        data: args.data,
        sarPerUsd: args.sarPerUsd,
        simulatedPrices: args.simulatedPrices,
        locale: args.locale,
      });
      const monthly = buildPortfolioDailySeriesInWindow({
        portfolio: p,
        transactions: txsForLedger,
        startMs: month.startMs,
        endMs: month.endMs,
        endValueSar: row.valueSar,
        includeCash,
        accounts: args.accounts,
        portfolios: args.portfolios,
        data: args.data,
        sarPerUsd: args.sarPerUsd,
        simulatedPrices: args.simulatedPrices,
        locale: args.locale,
      });
      weeklyByPortfolioId.set(p.id, weekly);
      weeklyParts.push(weekly);
      monthlyParts.push(monthly);
    }
  }

  const weeklyAgg = aggregateDailySeries(weeklyParts);
  const monthlyAgg = aggregateDailySeries(monthlyParts);

  // Align aggregated cumulative with summary totals (rounding / multi-portfolio)
  if (weeklyAgg.length > 0) {
    weeklyAgg[weeklyAgg.length - 1]!.cumulativeSar = summary.weeklyTotalSar;
  }
  if (monthlyAgg.length > 0) {
    monthlyAgg[monthlyAgg.length - 1]!.cumulativeSar = summary.monthlyTotalSar;
  }

  return {
    weekly: weeklyAgg,
    monthly: monthlyAgg,
    weeklyByPortfolioId,
  };
}
