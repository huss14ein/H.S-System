/**
 * Open-position "Today" P/L — mark-to-market on shares still held.
 *
 * Scenarios covered:
 * - No same-day trades: (last − prior close) × current open qty
 * - Sell today: sold shares excluded (FIFO hits overnight first)
 * - Buy today still held: (last − buy price) × remaining bought qty
 * - Buy+sell same day (partial day-trade): FIFO overnight then buys
 * - Symbol aliases (1120 vs 1120.SR) match via canonical quote key
 * - Trade currency ≠ book: buy price converted into book before MTM
 * - Manual funds / missing quote / non-finite inputs → 0
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
import { canonicalQuoteLookupKey, lookupLiveQuoteForSymbol, type LiveQuoteRow } from './finnhubService';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { appCalendarTodayYmd } from './reconciliation/constants';

export type SameDayBuyLot = {
  quantity: number;
  /** Unit price as recorded on the trade (see `priceCurrency`). */
  price: number;
  /** Currency of `price`; defaults to portfolio book at compute time when unset. */
  priceCurrency?: TradeCurrency;
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

function symbolCanon(symbol: string | null | undefined): string {
  const raw = String(symbol ?? '').trim();
  if (!raw) return '';
  try {
    return canonicalQuoteLookupKey(raw) || raw.toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
}

function portfolioKey(portfolioId: string | null | undefined): string {
  return String(portfolioId ?? '').trim();
}

function sanitizeFinite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function tradePriceCurrency(tx: InvestmentTransaction): TradeCurrency | undefined {
  const c = tx.currency;
  return c === 'SAR' || c === 'USD' ? c : undefined;
}

export function sameDayTradeIndexKey(portfolioId: string | null | undefined, symbol: string): string {
  return `${portfolioKey(portfolioId)}::${symbolCanon(symbol)}`;
}

/**
 * Index buy/sell trades for a calendar day, optionally scoped to one portfolio.
 * Chronological order preserved for FIFO day allocation.
 * Symbols are keyed by {@link canonicalQuoteLookupKey} so `1120` / `1120.SR` match.
 * `includeOrphans` stamps legacy rows (no portfolio id) onto `portfolioId` for a sole book.
 */
export function buildSameDayTradeIndex(
  transactions: InvestmentTransaction[] | null | undefined,
  asOfYmd: string,
  options?: { portfolioId?: string | null; includeOrphans?: boolean },
): Map<string, SameDayTradeSummary> {
  const out = new Map<string, SameDayTradeSummary>();
  const day = String(asOfYmd ?? '').slice(0, 10);
  if (!day || !transactions?.length) return out;

  const scopePid = options?.portfolioId != null ? portfolioKey(options.portfolioId) : null;
  const includeOrphans = options?.includeOrphans === true && scopePid != null && scopePid !== '';
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

    const canon = symbolCanon(tx.symbol);
    if (!canon) continue;
    const pid = portfolioKey(tx.portfolioId);
    if (scopePid != null && scopePid !== '' && pid !== '' && pid !== scopePid) continue;
    // Named scopes skip orphans unless the caller is the sole book and opts in.
    // Unscoped orphans stay on the empty portfolio key and are not shared across books.
    if (scopePid != null && scopePid !== '' && pid === '' && !includeOrphans) continue;

    const qty = Number(tx.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const key = sameDayTradeIndexKey(pid || scopePid, canon);
    let row = out.get(key);
    if (!row) {
      row = { boughtQty: 0, soldQty: 0, buys: [] };
      out.set(key, row);
    }
    if (isBuy) {
      const price = Number(tx.price);
      row.boughtQty += qty;
      row.buys.push({
        quantity: qty,
        price: Number.isFinite(price) ? price : 0,
        priceCurrency: tradePriceCurrency(tx),
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
  const empty: SameDayTradeSummary = { boughtQty: 0, soldQty: 0, buys: [] };
  const canon = symbolCanon(symbol);
  if (!canon) return empty;
  // Do not fall back to the empty-portfolio key. One unscoped trade would otherwise
  // apply to every named book that has no same-day row of its own.
  return index.get(sameDayTradeIndexKey(portfolioId, canon)) ?? empty;
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
  // Reconstruct start-of-day from open book + today's net trades.
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
  // Clamp to open book (ledger/holding drift / oversold ledger).
  const overnightClamped = Math.min(overnightStillHeld, currentQty);
  boughtStillHeld = Math.min(
    Math.max(0, boughtStillHeld),
    Math.max(0, currentQty - overnightClamped),
  );

  return {
    currentQty,
    boughtToday,
    soldToday,
    startOfDayQty,
    overnightStillHeld: overnightClamped,
    // Prefer open-book residual so overnight + bought always equals currentQty.
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

  const rate = Number(sarPerUsd);
  if (!Number.isFinite(rate) || rate <= 0) return 0;

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

  if (!(breakdown.currentQty > 0)) return 0;

  const changePerShare = resolveQuoteChangePerShare(live as LiveQuoteRow);
  const overnightPnL = quoteDailyPnLInBookCurrency(
    changePerShare,
    breakdown.overnightStillHeld,
    sym.toUpperCase(),
    bookCurrency,
    rate,
    asOf,
    simulatedPrices as Record<string, unknown>,
  );

  if (!(breakdown.boughtStillHeld > 0)) return sanitizeFinite(overnightPnL);

  const inst = resolveInstrumentCurrencyForQuote(sym, bookCurrency, simulatedPrices as Record<string, unknown>);
  const lastBook = convertBetweenTradeCurrencies(live.price, inst, bookCurrency, rate);

  let boughtPnL = 0;
  let covered = 0;
  let need = breakdown.boughtStillHeld;
  // FIFO residual: sells hit overnight first, then today's buys in chronological order.
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
    const rawPrice = Number(lot.price);
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      // Invalid buy price → leave uncovered for prior-close day-move fallback.
      continue;
    }
    covered += take;
    const fromCur = lot.priceCurrency ?? bookCurrency;
    const buyBook = convertBetweenTradeCurrencies(rawPrice, fromCur, bookCurrency, rate);
    boughtPnL += (lastBook - buyBook) * take;
  }

  // Ledger drift: bought residual without matching buy lots → fall back to prior-close day move.
  const uncovered = breakdown.boughtStillHeld - covered;
  if (uncovered > 1e-9) {
    boughtPnL += quoteDailyPnLInBookCurrency(
      changePerShare,
      uncovered,
      sym.toUpperCase(),
      bookCurrency,
      rate,
      asOf,
      simulatedPrices as Record<string, unknown>,
    );
  }

  return sanitizeFinite(overnightPnL + boughtPnL);
}
