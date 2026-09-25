/**
 * Open-position "Today" P/L — mark-to-market on shares still held.
 *
 * - Shares sold today do not contribute (removed from open qty).
 * - Shares held overnight: (last − prior close) × overnight still held.
 * - Shares bought today and still held: (last − buy price) × remaining bought qty
 *   (not the full prior-close day move — that would treat a midday buy as if held all day).
 */
import type { Holding, InvestmentTransaction, TradeCurrency } from '../types';
import {
  convertBetweenTradeCurrencies,
  quoteDailyPnLInBookCurrency,
  resolveInstrumentCurrencyForQuote,
  resolveQuoteChangePerShare,
} from '../utils/currencyMath';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { lookupLiveQuoteForSymbol, type LiveQuoteRow } from './finnhubService';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { appCalendarTodayYmd } from './reconciliation/constants';

export type SameDayBuyLot = {
  quantity: number;
  /** Unit price in portfolio book currency. */
  priceBook: number;
  dateYmd: string;
};

export type SameDayTradeSummary = {
  boughtQty: number;
  soldQty: number;
  buys: SameDayBuyLot[];
};

export type HoldingDailyPnLQuantityBreakdown = {
  currentQty: number;
  boughtToday: number;
  soldToday: number;
  startOfDayQty: number;
  /** Shares that existed before today and are still open (FIFO: sells hit overnight first). */
  overnightStillHeld: number;
  /** Shares bought today that remain open. */
  boughtStillHeld: number;
};

function txDayYmd(tx: InvestmentTransaction): string {
  return String(tx.date ?? '').trim().slice(0, 10);
}

function txSymbolKey(tx: InvestmentTransaction): string {
  return String(tx.symbol ?? '').trim().toUpperCase();
}

function portfolioKey(portfolioId: string | null | undefined): string {
  return String(portfolioId ?? '').trim();
}

export function sameDayTradeIndexKey(portfolioId: string | null | undefined, symbol: string): string {
  return `${portfolioKey(portfolioId)}::${String(symbol ?? '').trim().toUpperCase()}`;
}

/**
 * Index buy/sell trades for a calendar day, optionally scoped to one portfolio.
 * Chronological order preserved for FIFO day allocation.
 */
export function buildSameDayTradeIndex(
  transactions: InvestmentTransaction[] | null | undefined,
  asOfYmd: string,
  options?: { portfolioId?: string | null },
): Map<string, SameDayTradeSummary> {
  const out = new Map<string, SameDayTradeSummary>();
  const day = String(asOfYmd ?? '').slice(0, 10);
  if (!day || !transactions?.length) return out;

  const scopePid = options?.portfolioId != null ? portfolioKey(options.portfolioId) : null;
  const sorted = [...transactions].sort((a, b) => {
    const da = txDayYmd(a);
    const db = txDayYmd(b);
    if (da !== db) return da.localeCompare(db);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });

  for (const tx of sorted) {
    if (txDayYmd(tx) !== day) continue;
    const isBuy = isInvestmentTransactionType(tx.type, 'buy');
    const isSell = isInvestmentTransactionType(tx.type, 'sell');
    if (!isBuy && !isSell) continue;

    const sym = txSymbolKey(tx);
    if (!sym) continue;
    const pid = portfolioKey(tx.portfolioId);
    if (scopePid != null && scopePid !== '' && pid !== scopePid) continue;

    const qty = Number(tx.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const key = sameDayTradeIndexKey(pid || scopePid, sym);
    let row = out.get(key);
    if (!row) {
      row = { boughtQty: 0, soldQty: 0, buys: [] };
      out.set(key, row);
    }
    if (isBuy) {
      const priceBook = Number(tx.price);
      row.boughtQty += qty;
      row.buys.push({
        quantity: qty,
        priceBook: Number.isFinite(priceBook) ? priceBook : 0,
        dateYmd: day,
      });
    } else {
      row.soldQty += qty;
    }
  }
  return out;
}

export function lookupSameDayTradeSummary(
  index: Map<string, SameDayTradeSummary>,
  portfolioId: string | null | undefined,
  symbol: string,
): SameDayTradeSummary {
  const key = sameDayTradeIndexKey(portfolioId, symbol);
  const hit = index.get(key);
  if (hit) return hit;
  /** Legacy ledger rows without portfolio_id. */
  const orphan = index.get(sameDayTradeIndexKey('', symbol));
  return orphan ?? { boughtQty: 0, soldQty: 0, buys: [] };
}

/**
 * Quantity slices for open-position day P/L after same-day buys/sells.
 * Sold shares never count; overnight vs bought-today slices use FIFO (sells hit overnight first).
 */
export function resolveHoldingDailyPnLQuantityBreakdown(
  currentQuantity: number,
  sameDay: SameDayTradeSummary | null | undefined,
): HoldingDailyPnLQuantityBreakdown {
  const currentQty = Number.isFinite(currentQuantity) ? Math.max(0, currentQuantity) : 0;
  const boughtToday = Math.max(0, Number(sameDay?.boughtQty) || 0);
  const soldToday = Math.max(0, Number(sameDay?.soldQty) || 0);
  const startOfDayQty = Math.max(0, currentQty - boughtToday + soldToday);

  let soldRemaining = soldToday;
  const overnightSold = Math.min(startOfDayQty, soldRemaining);
  soldRemaining -= overnightSold;
  const overnightStillHeld = Math.max(0, startOfDayQty - overnightSold);

  let boughtStillHeld = 0;
  for (const lot of sameDay?.buys ?? []) {
    const q = Math.max(0, Number(lot.quantity) || 0);
    const soldFromBuy = Math.min(q, soldRemaining);
    soldRemaining -= soldFromBuy;
    boughtStillHeld += q - soldFromBuy;
  }
  // Clamp to open book (ledger/holding drift).
  boughtStillHeld = Math.min(boughtStillHeld, Math.max(0, currentQty - overnightStillHeld));
  const overnightClamped = Math.min(overnightStillHeld, currentQty);

  return {
    currentQty,
    boughtToday,
    soldToday,
    startOfDayQty,
    overnightStillHeld: overnightClamped,
    boughtStillHeld: Math.max(0, currentQty - overnightClamped),
  };
}

export type ComputeHoldingDailyPnLArgs = {
  holding: Holding;
  portfolioId: string | null | undefined;
  bookCurrency: TradeCurrency;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap | Record<string, unknown> | null | undefined;
  /** Prebuilt same-day trade index (preferred for table loops). */
  sameDayIndex?: Map<string, SameDayTradeSummary>;
  /** When index omitted, filter these txs for today. */
  transactions?: InvestmentTransaction[] | null;
  asOf?: Date;
  asOfYmd?: string;
};

/**
 * Open-position Today P/L in portfolio book currency.
 * Manual / non-ticker lots → 0. Missing quote → 0.
 */
export function computeHoldingDailyPnLInBookCurrency(args: ComputeHoldingDailyPnLArgs): number {
  const {
    holding,
    portfolioId,
    bookCurrency,
    sarPerUsd,
    simulatedPrices,
    asOf = new Date(),
  } = args;
  if (!holdingUsesLiveQuote(holding)) return 0;

  const sym = String(holding.symbol ?? '').trim();
  if (!sym) return 0;

  const live =
    simulatedPrices != null
      ? lookupLiveQuoteForSymbol(simulatedPrices as SimulatedPriceMap, sym)
      : undefined;
  if (!live || !Number.isFinite(live.price) || live.price <= 0) return 0;

  const asOfYmd = args.asOfYmd ?? appCalendarTodayYmd(asOf);
  const index =
    args.sameDayIndex ??
    buildSameDayTradeIndex(args.transactions, asOfYmd, { portfolioId });
  const sameDay = lookupSameDayTradeSummary(index, portfolioId, sym);
  const breakdown = resolveHoldingDailyPnLQuantityBreakdown(Number(holding.quantity) || 0, sameDay);

  const changePerShare = resolveQuoteChangePerShare(live as LiveQuoteRow);
  const overnightPnL = quoteDailyPnLInBookCurrency(
    changePerShare,
    breakdown.overnightStillHeld,
    sym.toUpperCase(),
    bookCurrency,
    sarPerUsd,
    asOf,
    simulatedPrices as Record<string, unknown>,
  );

  if (!(breakdown.boughtStillHeld > 0)) return overnightPnL;

  const inst = resolveInstrumentCurrencyForQuote(sym, bookCurrency, simulatedPrices as Record<string, unknown>);
  const lastBook = convertBetweenTradeCurrencies(live.price, inst, bookCurrency, sarPerUsd);

  let boughtPnL = 0;
  let need = breakdown.boughtStillHeld;
  // Allocate remaining bought qty to today's buy lots newest-first after overnight sells
  // (same FIFO residual order as resolveHoldingDailyPnLQuantityBreakdown).
  let soldRemaining = breakdown.soldToday;
  const overnightSold = Math.min(breakdown.startOfDayQty, soldRemaining);
  soldRemaining -= overnightSold;

  for (const lot of sameDay.buys) {
    if (!(need > 0)) break;
    const q = Math.max(0, Number(lot.quantity) || 0);
    const soldFromBuy = Math.min(q, soldRemaining);
    soldRemaining -= soldFromBuy;
    const still = q - soldFromBuy;
    if (!(still > 0)) continue;
    const take = Math.min(still, need);
    need -= take;
    const buyPrice = Number(lot.priceBook);
    if (!Number.isFinite(buyPrice)) continue;
    boughtPnL += (lastBook - buyPrice) * take;
  }

  return overnightPnL + boughtPnL;
}
