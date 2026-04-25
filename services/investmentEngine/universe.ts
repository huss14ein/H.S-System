import type {
  Asset,
  CommodityHolding,
  FinancialData,
  Holding,
  InvestmentPortfolio,
  TickerStatus,
  TradeCurrency,
  UniverseTicker,
} from '../../types';
import { resolveSarPerUsd, toSAR, inferInstrumentCurrencyFromSymbol } from '../../utils/currencyMath';
import { holdingUsesLiveQuote } from '../../utils/holdingValuation';
import { canonicalQuoteLookupKey } from '../finnhubService';

export type EngineInstrumentKind = 'equity' | 'commodity' | 'sukuk';

export type EngineInstrument = {
  instrumentId: string;
  kind: EngineInstrumentKind;
  /** A ticker-like key used for mapping and dedupe. */
  symbol: string;
  name: string;
  /** Currency of the instrument’s traded price (spot). */
  instrumentCurrency: TradeCurrency;
  /** Book currency of the portfolio (equities) or native currency (others). */
  bookCurrency: TradeCurrency;
  /** Value in book currency (where applicable). */
  positionValueBook: number;
  /** Value normalized to SAR (for cross-asset comparisons). */
  positionValueSar: number;
  /** Optional spot price in instrument currency. */
  priceNow?: number;
  /** Optional quantity / units. */
  quantity?: number;
  /** Universe status that drives automation. */
  status: TickerStatus | 'Untracked';
  /** Optional caps and sleeve weights (0–1). */
  monthlyWeight?: number | null;
  maxPositionWeight?: number | null;
  /** Where this row came from (for explainability). */
  source: 'Universe' | 'Holding' | 'Commodity' | 'Asset';
  /** Links back to concrete rows. */
  holdingId?: string;
  portfolioId?: string;
  commodityId?: string;
  assetId?: string;
};

export type EngineUniverse = {
  instruments: EngineInstrument[];
  totals: {
    equitiesSar: number;
    commoditiesSar: number;
    sukukSar: number;
    totalSar: number;
  };
  sarPerUsd: number;
};

function upper(s: string): string {
  return (s || '').trim().toUpperCase();
}

function canonSymbol(raw: string): string {
  const u = upper(raw);
  if (!u) return u;
  // Normalize Tadawul aliases and US class-share dots to the same keys used by live quote maps.
  return canonicalQuoteLookupKey(u);
}

function asTradeCurrency(s: unknown, fallback: TradeCurrency): TradeCurrency {
  return String(s || '').toUpperCase() === 'SAR' ? 'SAR' : String(s || '').toUpperCase() === 'USD' ? 'USD' : fallback;
}

function universeMapForPortfolio(data: FinancialData | null, portfolioId: string | null): Map<string, UniverseTicker> {
  const rows = (data?.portfolioUniverse ?? []).filter((t) => !t.portfolioId || t.portfolioId === portfolioId);
  const m = new Map<string, UniverseTicker>();
  for (const r of rows) m.set(canonSymbol(r.ticker || ''), r);
  return m;
}

function sumHoldingsBook(portfolio: InvestmentPortfolio, simulatedPrices?: Record<string, { price?: number }>, sarPerUsd?: number): number {
  const book = asTradeCurrency(portfolio.currency, 'USD');
  const fx = sarPerUsd || 3.75;
  return (portfolio.holdings || []).reduce((s, h) => {
    const sym = canonSymbol(h.symbol);
    const qty = Number(h.quantity) || 0;
    const stored = Number(h.currentValue) || 0;
    if (!holdingUsesLiveQuote(h as Holding)) return s + stored;
    const pxRaw = simulatedPrices?.[sym]?.price ?? simulatedPrices?.[upper(h.symbol)]?.price;
    if (pxRaw != null && Number.isFinite(pxRaw) && pxRaw > 0 && qty > 0) {
      const instr = inferInstrumentCurrencyFromSymbol(sym);
      const pxBook = instr === book ? pxRaw : instr === 'USD' && book === 'SAR' ? pxRaw * fx : pxRaw / fx;
      return s + pxBook * qty;
    }
    return s + stored;
  }, 0);
}

export function buildInvestmentEngineUniverse(args: {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices?: Record<string, { price?: number }>;
  portfolioId?: string | null;
}): EngineUniverse {
  const { data, exchangeRate, simulatedPrices, portfolioId = null } = args;
  const sarPerUsd = resolveSarPerUsd(data ?? null, exchangeRate);

  const uMap = universeMapForPortfolio(data, portfolioId);
  const portfolios = (data?.investments ?? []) as InvestmentPortfolio[];
  const scopedPortfolios = portfolioId ? portfolios.filter((p) => p.id === portfolioId) : portfolios;

  const equitiesSarTotal = scopedPortfolios.reduce((s, p) => {
    const book = asTradeCurrency(p.currency, 'USD');
    const vBook = sumHoldingsBook(p, simulatedPrices, sarPerUsd);
    return s + toSAR(vBook, book, sarPerUsd);
  }, 0);

  const commodities = (data?.commodityHoldings ?? []) as CommodityHolding[];
  const commoditiesSarTotal = commodities.reduce((s, c) => s + Math.max(0, Number(c.currentValue) || 0), 0); // already SAR in app data

  const sukukAssets = ((data?.assets ?? []) as Asset[]).filter((a) => a.type === 'Sukuk');
  const sukukSarTotal = sukukAssets.reduce((s, a) => s + Math.max(0, Number(a.value) || 0), 0); // SAR in Assets

  const instruments: EngineInstrument[] = [];

  // Equities
  for (const p of scopedPortfolios) {
    const book = asTradeCurrency(p.currency, 'USD');
    const portfolioBookTotal = Math.max(0, sumHoldingsBook(p, simulatedPrices, sarPerUsd));
    for (const h of p.holdings || []) {
      const sym = canonSymbol(h.symbol);
      if (!sym) continue;
      const u = uMap.get(sym);
      const status: EngineInstrument['status'] = (u?.status as TickerStatus) || 'Untracked';
      const qty = Number(h.quantity) || 0;
      const storedBook = Math.max(0, Number(h.currentValue) || 0);
      const useLive = holdingUsesLiveQuote(h as Holding);
      const pxRaw = simulatedPrices?.[sym]?.price ?? simulatedPrices?.[upper(h.symbol)]?.price;
      const instrCcy = inferInstrumentCurrencyFromSymbol(sym);
      let priceNow: number | undefined = undefined;
      let valueBook = storedBook;
      if (useLive && pxRaw != null && Number.isFinite(pxRaw) && pxRaw > 0 && qty > 0) {
        priceNow = pxRaw;
        const pxBook = instrCcy === book ? pxRaw : instrCcy === 'USD' && book === 'SAR' ? pxRaw * sarPerUsd : pxRaw / sarPerUsd;
        valueBook = pxBook * qty;
      }
      const valueSar = toSAR(valueBook, book, sarPerUsd);
      instruments.push({
        instrumentId: `equity:${p.id}:${sym}`,
        kind: 'equity',
        symbol: sym,
        name: h.name || sym,
        instrumentCurrency: instrCcy,
        bookCurrency: book,
        positionValueBook: valueBook,
        positionValueSar: valueSar,
        priceNow,
        quantity: qty,
        status,
        monthlyWeight: u?.monthly_weight ?? null,
        maxPositionWeight: u?.max_position_weight ?? null,
        source: u ? 'Universe' : 'Holding',
        holdingId: h.id,
        portfolioId: p.id,
      });
    }
    // Universe tickers not held yet (so we can suggest new buys)
    for (const [sym, u] of uMap.entries()) {
      const already = instruments.some((x) => x.kind === 'equity' && x.portfolioId === p.id && x.symbol === sym);
      if (already) continue;
      const px = simulatedPrices?.[sym]?.price ?? simulatedPrices?.[upper(u.ticker || '')]?.price;
      const instr = inferInstrumentCurrencyFromSymbol(sym);
      instruments.push({
        instrumentId: `equity:${p.id}:${sym}:unheld`,
        kind: 'equity',
        symbol: sym,
        name: u.name || sym,
        instrumentCurrency: instr,
        bookCurrency: book,
        positionValueBook: 0,
        positionValueSar: 0,
        priceNow: px && Number.isFinite(px) && px > 0 ? px : undefined,
        status: (u.status as TickerStatus) || 'Watchlist',
        monthlyWeight: u.monthly_weight ?? null,
        maxPositionWeight: u.max_position_weight ?? null,
        source: 'Universe',
        portfolioId: p.id,
      });
    }
    // Use portfolioBookTotal just to avoid unused warnings in future expansions
    void portfolioBookTotal;
  }

  // Commodities
  for (const c of commodities) {
    const sym = upper(c.symbol || `COM-${c.id}`);
    const valueSar = Math.max(0, Number(c.currentValue) || 0);
    const qty = Number(c.quantity) || 0;
    const px = qty > 0 ? valueSar / qty : undefined;
    instruments.push({
      instrumentId: `commodity:${c.id}`,
      kind: 'commodity',
      symbol: sym,
      name: c.name || 'Commodity',
      instrumentCurrency: 'SAR',
      bookCurrency: 'SAR',
      positionValueBook: valueSar,
      positionValueSar: valueSar,
      priceNow: px && Number.isFinite(px) && px > 0 ? px : undefined,
      quantity: qty,
      status: 'Untracked',
      monthlyWeight: null,
      maxPositionWeight: null,
      source: 'Commodity',
      commodityId: c.id,
    });
  }

  // Sukuk assets (Assets table)
  for (const a of sukukAssets) {
    const sym = `SUKUK:${a.id}`;
    const valueSar = Math.max(0, Number(a.value) || 0);
    instruments.push({
      instrumentId: `sukuk:${a.id}`,
      kind: 'sukuk',
      symbol: sym,
      name: a.name ? `${a.name} (Sukuk)` : 'Sukuk',
      instrumentCurrency: 'SAR',
      bookCurrency: 'SAR',
      positionValueBook: valueSar,
      positionValueSar: valueSar,
      status: 'Untracked',
      monthlyWeight: null,
      maxPositionWeight: null,
      source: 'Asset',
      assetId: a.id,
    });
  }

  const totalSar = equitiesSarTotal + commoditiesSarTotal + sukukSarTotal;

  return {
    instruments,
    totals: {
      equitiesSar: equitiesSarTotal,
      commoditiesSar: commoditiesSarTotal,
      sukukSar: sukukSarTotal,
      totalSar,
    },
    sarPerUsd,
  };
}

