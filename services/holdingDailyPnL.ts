/**
 * Open-position "Today" P/L — mark-to-market on shares still held.
 *
 * Also exposes a full breakdown (tooltip), optional realized-from-sells,
 * session gating, and same-day stock-dividend / DRIP quantity slices.
 * Defaults preserve prior broker-style behavior (open MTM only, session open).
 */
import type {
  CorporateActionEvent,
  Holding,
  InvestmentTransaction,
  Settings,
  TradeCurrency,
} from '../types';
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
import { splitRatio } from './corporateActions';
import { quoteChangeForDailyPnL } from './marketSessionLocal';

export type DailyPnLPrefs = {
  /** When true, Today includes realized day P/L on shares sold today. Default false. */
  includeRealizedFromSells?: boolean;
  /** When true, equity day change is zeroed outside regular session. Default false. */
  zeroOutsideSession?: boolean;
};

export type SameDayBuyLot = {
  quantity: number;
  /** Unit price as recorded on the trade (see `priceCurrency`). */
  price: number;
  /** Currency of `price`; defaults to portfolio book at compute time when unset. */
  priceCurrency?: TradeCurrency;
  dateYmd: string;
  /** Synthetic CA lots priced at prior close at compute time. */
  source?: 'trade' | 'ca_stock_dividend' | 'ca_drip';
};

export type SameDaySellLot = {
  quantity: number;
  price: number;
  priceCurrency?: TradeCurrency;
  dateYmd: string;
};

export type SameDayTradeSummary = {
  boughtQty: number;
  soldQty: number;
  buys: SameDayBuyLot[];
  sells: SameDaySellLot[];
};

export type HoldingDailyPnLQuantityBreakdown = {
  currentQty: number;
  boughtToday: number;
  soldToday: number;
  startOfDayQty: number;
  overnightStillHeld: number;
  boughtStillHeld: number;
  /** Overnight shares sold today (FIFO). */
  overnightSold: number;
  /** Bought-today shares sold today (day-trade). */
  boughtSold: number;
};

/** Full Today breakdown in portfolio book currency (for tooltips / detail). */
export type HoldingDailyPnLBreakdown = {
  openBook: number;
  overnightBook: number;
  boughtTodayBook: number;
  realizedSoldBook: number;
  totalBook: number;
  overnightStillHeld: number;
  boughtStillHeld: number;
  soldQtyExcluded: number;
  overnightSold: number;
  boughtSold: number;
  includeRealized: boolean;
};

export type HoldingForCaSlice = {
  portfolioId: string;
  symbol: string;
  quantity: number;
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

function emptySummary(): SameDayTradeSummary {
  return { boughtQty: 0, soldQty: 0, buys: [], sells: [] };
}

export function resolveDailyPnLPrefs(settings?: Settings | null | undefined): Required<DailyPnLPrefs> {
  const p = settings?.uiAcks?.dailyPnLPrefs;
  return {
    includeRealizedFromSells: p?.includeRealizedFromSells === true,
    zeroOutsideSession: p?.zeroOutsideSession === true,
  };
}

export function sameDayTradeIndexKey(portfolioId: string | null | undefined, symbol: string): string {
  return `${portfolioKey(portfolioId)}::${symbolCanon(symbol)}`;
}

function ensureRow(out: Map<string, SameDayTradeSummary>, key: string): SameDayTradeSummary {
  let row = out.get(key);
  if (!row) {
    row = emptySummary();
    out.set(key, row);
  }
  return row;
}

/**
 * Index buy/sell trades for a calendar day (+ optional same-day stock dividend / DRIP CA slices).
 * Symbols keyed by {@link canonicalQuoteLookupKey}.
 */
export function buildSameDayTradeIndex(
  transactions: InvestmentTransaction[] | null | undefined,
  asOfYmd: string,
  options?: {
    portfolioId?: string | null;
    corporateActionEvents?: CorporateActionEvent[] | null;
    holdingsForCa?: HoldingForCaSlice[] | null;
  },
): Map<string, SameDayTradeSummary> {
  const out = new Map<string, SameDayTradeSummary>();
  const day = String(asOfYmd ?? '').slice(0, 10);
  if (!day) return out;

  const scopePid = options?.portfolioId != null ? portfolioKey(options.portfolioId) : null;

  if (transactions?.length) {
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
      if (scopePid != null && scopePid !== '' && pid === '') continue;

      const qty = Number(tx.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const key = sameDayTradeIndexKey(pid || scopePid, canon);
      const row = ensureRow(out, key);
      if (isBuy) {
        const price = Number(tx.price);
        row.boughtQty += qty;
        row.buys.push({
          quantity: qty,
          price: Number.isFinite(price) ? price : 0,
          priceCurrency: tradePriceCurrency(tx),
          dateYmd: day,
          source: 'trade',
        });
      } else {
        const price = Number(tx.price);
        row.soldQty += qty;
        row.sells.push({
          quantity: qty,
          price: Number.isFinite(price) ? price : 0,
          priceCurrency: tradePriceCurrency(tx),
          dateYmd: day,
        });
      }
    }
  }

  applySameDayCorporateActionSlices(out, day, options?.corporateActionEvents, options?.holdingsForCa, scopePid);
  return out;
}

/**
 * Same-day stock_dividend / dividend_drip: treat newly issued shares as acquired at prior close
 * (day MTM ≈ quote day change × added qty). Skips splits (quotes are already adjusted).
 * Skips CA drip when a same-day buy already exists for that symbol (DRIP buy path).
 */
export function applySameDayCorporateActionSlices(
  index: Map<string, SameDayTradeSummary>,
  asOfYmd: string,
  events: CorporateActionEvent[] | null | undefined,
  holdings: HoldingForCaSlice[] | null | undefined,
  scopePortfolioId?: string | null,
): void {
  const day = String(asOfYmd ?? '').slice(0, 10);
  if (!day || !events?.length || !holdings?.length) return;

  const holdingMap = new Map<string, number>();
  for (const h of holdings) {
    const pid = portfolioKey(h.portfolioId);
    const canon = symbolCanon(h.symbol);
    if (!pid || !canon) continue;
    if (scopePortfolioId != null && scopePortfolioId !== '' && pid !== scopePortfolioId) continue;
    holdingMap.set(sameDayTradeIndexKey(pid, canon), Math.max(0, Number(h.quantity) || 0));
  }

  for (const ev of events) {
    if (String(ev.status ?? 'applied') === 'reversed') continue;
    const exec = String(ev.executionDate ?? '').slice(0, 10);
    if (exec !== day) continue;
    const actionType = String(ev.actionType ?? '');
    if (actionType !== 'stock_dividend' && actionType !== 'dividend_drip') continue;

    const pid = portfolioKey(ev.portfolioId);
    const canon = symbolCanon(ev.symbol);
    if (!pid || !canon) continue;
    if (scopePortfolioId != null && scopePortfolioId !== '' && pid !== scopePortfolioId) continue;

    const key = sameDayTradeIndexKey(pid, canon);
    const row = ensureRow(index, key);

    // DRIP usually already recorded as a buy — avoid double-counting.
    if (actionType === 'dividend_drip' && row.buys.some((b) => b.source === 'trade')) continue;

    const postQty = holdingMap.get(key) ?? 0;
    if (!(postQty > 0)) continue;

    let added = 0;
    if (actionType === 'stock_dividend') {
      const ratio = splitRatio({
        type: 'stock_dividend',
        ratioNumerator: ev.ratioNumerator ?? undefined,
        ratioDenominator: ev.ratioDenominator ?? undefined,
      });
      if (!(ratio > 1)) continue;
      const preQty = postQty / ratio;
      added = Math.max(0, postQty - preQty);
    } else {
      // dividend_drip without a matching buy: best-effort — no reliable qty on event; skip.
      continue;
    }
    if (!(added > 1e-9)) continue;

    row.boughtQty += added;
    row.buys.push({
      quantity: added,
      price: 0,
      dateYmd: day,
      source: actionType === 'stock_dividend' ? 'ca_stock_dividend' : 'ca_drip',
    });
  }
}

export function lookupSameDayTradeSummary(
  index: Map<string, SameDayTradeSummary>,
  portfolioId: string | null | undefined,
  symbol: string,
): SameDayTradeSummary {
  const canon = symbolCanon(symbol);
  if (!canon) return emptySummary();
  const hit = index.get(sameDayTradeIndexKey(portfolioId, canon));
  if (hit) return hit;
  return index.get(sameDayTradeIndexKey('', canon)) ?? emptySummary();
}

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
  let boughtSold = 0;
  for (const lot of sameDay?.buys ?? []) {
    const q = Math.max(0, Number(lot.quantity) || 0);
    const soldFromBuy = Math.min(q, soldRemaining);
    soldRemaining -= soldFromBuy;
    boughtSold += soldFromBuy;
    boughtStillHeld += q - soldFromBuy;
  }
  const overnightClamped = Math.min(overnightStillHeld, currentQty);

  return {
    currentQty,
    boughtToday,
    soldToday,
    startOfDayQty,
    overnightStillHeld: overnightClamped,
    boughtStillHeld: Math.max(0, currentQty - overnightClamped),
    overnightSold,
    boughtSold,
  };
}

export type ComputeHoldingDailyPnLArgs = {
  holding: Holding;
  portfolioId: string | null | undefined;
  bookCurrency: TradeCurrency;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap | Record<string, unknown> | null | undefined;
  sameDayIndex?: Map<string, SameDayTradeSummary>;
  transactions?: InvestmentTransaction[] | null;
  corporateActionEvents?: CorporateActionEvent[] | null;
  asOf?: Date;
  asOfYmd?: string;
  /** Include realized day P/L on shares sold today. Default false. */
  includeRealizedFromSells?: boolean;
  /** Zero equity day change outside regular session. Default false. */
  zeroOutsideSession?: boolean;
};

function dailyPnLOpts(zeroOutsideSession: boolean | undefined) {
  return zeroOutsideSession ? { zeroOutsideSession: true as const } : undefined;
}

/**
 * Full Today breakdown in book currency. Prefer this for UI tooltips / detail.
 */
export function computeHoldingDailyPnLBreakdown(args: ComputeHoldingDailyPnLArgs): HoldingDailyPnLBreakdown {
  const empty: HoldingDailyPnLBreakdown = {
    openBook: 0,
    overnightBook: 0,
    boughtTodayBook: 0,
    realizedSoldBook: 0,
    totalBook: 0,
    overnightStillHeld: 0,
    boughtStillHeld: 0,
    soldQtyExcluded: 0,
    overnightSold: 0,
    boughtSold: 0,
    includeRealized: args.includeRealizedFromSells === true,
  };

  const {
    holding,
    portfolioId,
    bookCurrency,
    sarPerUsd,
    simulatedPrices,
    asOf = new Date(),
    includeRealizedFromSells = false,
    zeroOutsideSession = false,
  } = args;

  if (!holdingUsesLiveQuote(holding)) return empty;

  const sym = String(holding.symbol ?? '').trim();
  if (!sym) return empty;

  const rate = Number(sarPerUsd);
  if (!Number.isFinite(rate) || rate <= 0) return empty;

  const live =
    simulatedPrices != null
      ? lookupLiveQuoteForSymbol(simulatedPrices as SimulatedPriceMap, sym)
      : undefined;
  if (!live || !Number.isFinite(live.price) || live.price <= 0) return empty;

  const asOfYmd = args.asOfYmd ?? appCalendarTodayYmd(asOf);
  const index =
    args.sameDayIndex ??
    buildSameDayTradeIndex(args.transactions, asOfYmd, {
      portfolioId,
      corporateActionEvents: args.corporateActionEvents,
      holdingsForCa: [
        {
          portfolioId: String(portfolioId ?? ''),
          symbol: sym,
          quantity: Number(holding.quantity) || 0,
        },
      ],
    });
  const sameDay = lookupSameDayTradeSummary(index, portfolioId, sym);
  const qty = resolveHoldingDailyPnLQuantityBreakdown(Number(holding.quantity) || 0, sameDay);

  const changePerShare = resolveQuoteChangePerShare(live as LiveQuoteRow);
  const sessionOpts = dailyPnLOpts(zeroOutsideSession);
  const quoteMap = simulatedPrices as Record<string, unknown>;
  const symU = sym.toUpperCase();

  const overnightBook = sanitizeFinite(
    quoteDailyPnLInBookCurrency(
      changePerShare,
      qty.overnightStillHeld,
      symU,
      bookCurrency,
      rate,
      asOf,
      quoteMap,
      sessionOpts,
    ),
  );

  const inst = resolveInstrumentCurrencyForQuote(sym, bookCurrency, quoteMap);
  const lastBook = convertBetweenTradeCurrencies(live.price, inst, bookCurrency, rate);
  const changeBook = convertBetweenTradeCurrencies(
    sanitizeFinite(quoteChangeForDailyPnL(symU, changePerShare, asOf, sessionOpts)),
    inst,
    bookCurrency,
    rate,
  );
  const priorCloseBook = lastBook - changeBook;

  let boughtTodayBook = 0;
  let covered = 0;
  let need = qty.boughtStillHeld;
  let soldRemaining = qty.soldToday;
  const overnightSoldAlloc = Math.min(qty.startOfDayQty, soldRemaining);
  soldRemaining -= overnightSoldAlloc;

  // Residual buy lots after FIFO sells (for open bought MTM + day-trade realized).
  const buyResiduals: { qty: number; priceBook: number; source?: SameDayBuyLot['source'] }[] = [];

  for (const lot of sameDay.buys) {
    const q = Math.max(0, Number(lot.quantity) || 0);
    const soldFromBuy = Math.min(q, soldRemaining);
    soldRemaining -= soldFromBuy;
    const still = q - soldFromBuy;

    let priceBook: number;
    if (lot.source === 'ca_stock_dividend' || lot.source === 'ca_drip') {
      priceBook = priorCloseBook;
    } else {
      const rawPrice = Number(lot.price);
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
        priceBook = Number.NaN;
      } else {
        const fromCur = lot.priceCurrency ?? bookCurrency;
        priceBook = convertBetweenTradeCurrencies(rawPrice, fromCur, bookCurrency, rate);
      }
    }

    if (soldFromBuy > 0) {
      buyResiduals.push({ qty: soldFromBuy, priceBook, source: lot.source });
    }
    if (still > 0 && need > 0) {
      const take = Math.min(still, need);
      need -= take;
      const isCa = lot.source === 'ca_stock_dividend' || lot.source === 'ca_drip';
      if (isCa || (Number.isFinite(priceBook) && priceBook > 0)) {
        covered += take;
        const basis = isCa || !Number.isFinite(priceBook) ? priorCloseBook : priceBook;
        boughtTodayBook += (lastBook - basis) * take;
      }
    }
  }

  const uncovered = qty.boughtStillHeld - covered;
  if (uncovered > 1e-9) {
    boughtTodayBook += quoteDailyPnLInBookCurrency(
      changePerShare,
      uncovered,
      symU,
      bookCurrency,
      rate,
      asOf,
      quoteMap,
      sessionOpts,
    );
  }
  boughtTodayBook = sanitizeFinite(boughtTodayBook);

  const openBook = sanitizeFinite(overnightBook + boughtTodayBook);

  let realizedSoldBook = 0;
  if (includeRealizedFromSells && qty.soldToday > 0) {
    // Allocate sells chronologically: overnight first, then buy residuals.
    let overnightLeft = qty.overnightSold;
    let buySoldIdx = 0;
    let buySoldLeft = buyResiduals.length ? buyResiduals[0]?.qty ?? 0 : 0;

    for (const sell of sameDay.sells) {
      let left = Math.max(0, Number(sell.quantity) || 0);
      const sellRaw = Number(sell.price);
      if (!Number.isFinite(sellRaw) || sellRaw <= 0 || !(left > 0)) continue;
      const sellBook = convertBetweenTradeCurrencies(
        sellRaw,
        sell.priceCurrency ?? bookCurrency,
        bookCurrency,
        rate,
      );

      const fromOvernight = Math.min(left, overnightLeft);
      if (fromOvernight > 0) {
        realizedSoldBook += (sellBook - priorCloseBook) * fromOvernight;
        overnightLeft -= fromOvernight;
        left -= fromOvernight;
      }

      while (left > 1e-12 && buySoldIdx < buyResiduals.length) {
        if (!(buySoldLeft > 0)) {
          buySoldIdx += 1;
          buySoldLeft = buyResiduals[buySoldIdx]?.qty ?? 0;
          continue;
        }
        const take = Math.min(left, buySoldLeft);
        const basis = buyResiduals[buySoldIdx]?.priceBook;
        const basisBook = Number.isFinite(basis) ? (basis as number) : priorCloseBook;
        realizedSoldBook += (sellBook - basisBook) * take;
        buySoldLeft -= take;
        left -= take;
      }
    }
    realizedSoldBook = sanitizeFinite(realizedSoldBook);
  }

  const totalBook = sanitizeFinite(openBook + (includeRealizedFromSells ? realizedSoldBook : 0));

  return {
    openBook,
    overnightBook,
    boughtTodayBook,
    realizedSoldBook,
    totalBook,
    overnightStillHeld: qty.overnightStillHeld,
    boughtStillHeld: qty.boughtStillHeld,
    soldQtyExcluded: qty.soldToday,
    overnightSold: qty.overnightSold,
    boughtSold: qty.boughtSold,
    includeRealized: includeRealizedFromSells,
  };
}

/**
 * Open-position Today P/L in portfolio book currency (or incl. realized when opted in).
 * Manual / non-ticker lots → 0. Missing quote → 0.
 */
export function computeHoldingDailyPnLInBookCurrency(args: ComputeHoldingDailyPnLArgs): number {
  return computeHoldingDailyPnLBreakdown(args).totalBook;
}

/** Human-readable tooltip / aria label for a Today cell. */
export function formatHoldingDailyPnLBreakdownTitle(
  b: HoldingDailyPnLBreakdown,
  formatMoney: (n: number) => string,
): string {
  const lines = [
    `Today: ${formatMoney(b.totalBook)}`,
    `Overnight (${formatQty(b.overnightStillHeld)} sh): ${formatMoney(b.overnightBook)}`,
    `Bought today (${formatQty(b.boughtStillHeld)} sh): ${formatMoney(b.boughtTodayBook)}`,
  ];
  if (b.soldQtyExcluded > 0) {
    lines.push(`Sold today excluded: ${formatQty(b.soldQtyExcluded)} sh`);
  }
  if (b.includeRealized) {
    lines.push(`Realized on sells: ${formatMoney(b.realizedSoldBook)}`);
  }
  return lines.join('\n');
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Commodity day P/L in SAR — same quote/session rules as equity holdings (no trade ledger).
 */
export function computeCommodityDailyPnLSar(args: {
  symbol: string;
  quantity: number;
  quote: { price?: number; change?: number; changePercent?: number } | null | undefined;
  asOf?: Date;
  zeroOutsideSession?: boolean;
}): number {
  const qty = Number(args.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const change = resolveQuoteChangePerShare(args.quote);
  const gated = quoteChangeForDailyPnL(
    args.symbol,
    change,
    args.asOf ?? new Date(),
    dailyPnLOpts(args.zeroOutsideSession),
  );
  return sanitizeFinite(gated * qty);
}
