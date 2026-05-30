import { getQuoteWith52W, canonicalQuoteLookupKey } from './finnhubService';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import type { WatchlistItem } from '../types';

/** Sample tickers from the user's Arabic multi-stock analysis request. */
export const SAMPLE_MULTI_STOCK_SYMBOLS = [
  'NKE', 'CHWY', 'CRMT', 'SNAP', 'HRMY', 'INSP', 'NVO', 'TTD', 'PLTR', 'UBER',
  'SOUN', 'LCID', 'BABA', 'UL', 'KMB', 'ELF', 'CRM', 'ORCL', 'CELH',
] as const;

export interface MultiSymbolGroundedRow {
  symbol: string;
  name?: string;
  price?: number;
  changePercent?: number;
  currency?: string;
  high52?: number;
  low52?: number;
  dayHigh?: number;
  dayLow?: number;
  rangePositionPct?: number;
  quoteSource: 'finova-live' | 'finnhub' | 'unavailable';
  fairValue?: number;
  targetBuyLow?: number;
  targetBuyHigh?: number;
  thesisStatus?: string;
}

export interface MultiSymbolGroundingResult {
  asOfIso: string;
  rows: MultiSymbolGroundedRow[];
  promptBlock: string;
}

const MAX_SYMBOLS = 25;

/** Parse comma/space/newline-separated tickers; dedupe and cap. */
export function parseMultiStockSymbols(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase().replace(/^\$/, ''))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sym of parts) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function rangePositionPct(price: number | undefined, low?: number, high?: number): number | undefined {
  if (price == null || low == null || high == null || high <= low) return undefined;
  const pct = ((price - low) / (high - low)) * 100;
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : undefined;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function watchlistBySymbol(items: WatchlistItem[] | undefined): Map<string, WatchlistItem> {
  const map = new Map<string, WatchlistItem>();
  for (const item of items ?? []) {
    const sym = (item.symbol ?? '').trim().toUpperCase();
    if (sym) map.set(sym, item);
  }
  return map;
}

function formatRowLine(row: MultiSymbolGroundedRow): string {
  const parts: string[] = [`**${row.symbol}**`];
  if (row.name) parts.push(`(${row.name})`);
  if (row.price != null && Number.isFinite(row.price)) {
    parts.push(`price=${row.price.toFixed(2)}${row.currency ? ` ${row.currency}` : ''}`);
  } else {
    parts.push('price=unavailable');
  }
  if (row.changePercent != null && Number.isFinite(row.changePercent)) {
    parts.push(`chg=${row.changePercent.toFixed(2)}%`);
  }
  if (row.high52 != null && row.low52 != null) {
    parts.push(`52w=${row.low52.toFixed(2)}–${row.high52.toFixed(2)}`);
  }
  if (row.rangePositionPct != null) {
    parts.push(`52w-pos=${row.rangePositionPct.toFixed(0)}%`);
  }
  if (row.fairValue != null) parts.push(`user-fair-value=${row.fairValue}`);
  if (row.targetBuyLow != null || row.targetBuyHigh != null) {
    parts.push(`user-buy-zone=${row.targetBuyLow ?? '?'}–${row.targetBuyHigh ?? '?'}`);
  }
  if (row.thesisStatus) parts.push(`thesis=${row.thesisStatus}`);
  parts.push(`quote-source=${row.quoteSource}`);
  return `- ${parts.join(' · ')}`;
}

/** Build deterministic GROUND TRUTH block for multi-symbol AI prompts. */
export function formatMultiSymbolGroundingPromptBlock(result: MultiSymbolGroundingResult): string {
  const lines = [
    '=== MULTI-STOCK MARKET GROUND TRUTH (Finova) ===',
    `As-of (UTC): ${result.asOfIso}`,
    'Rules: Use ONLY these prices/ranges for numeric claims. Analyst consensus is NOT in this block — cite search sources or mark unavailable.',
    ...result.rows.map(formatRowLine),
    '=== END MULTI-STOCK GROUND TRUTH ===',
  ];
  return lines.join('\n');
}

export async function buildMultiSymbolMarketGrounding(opts: {
  symbols: string[];
  simulatedPrices?: SimulatedPriceMap;
  watchlistItems?: WatchlistItem[];
  symbolQuoteUpdatedAt?: Record<string, string>;
}): Promise<MultiSymbolGroundingResult> {
  const symbols = parseMultiStockSymbols(opts.symbols.join(','));
  const asOfIso = new Date().toISOString();
  const wl = watchlistBySymbol(opts.watchlistItems);
  const prices = opts.simulatedPrices ?? {};

  const rows = await mapWithConcurrency(symbols, 4, async (symbol): Promise<MultiSymbolGroundedRow> => {
    const wlItem = wl.get(symbol);
    const lookupKey = canonicalQuoteLookupKey(symbol);
    const live = prices[lookupKey] ?? prices[symbol];
    let price = live?.price;
    let changePercent = live?.changePercent ?? (live?.change != null && price ? (live.change / price) * 100 : undefined);
    let quoteSource: MultiSymbolGroundedRow['quoteSource'] = price != null ? 'finova-live' : 'unavailable';
    let high52: number | undefined;
    let low52: number | undefined;
    let dayHigh: number | undefined;
    let dayLow: number | undefined;

    try {
      const q52 = await getQuoteWith52W(symbol);
      if (q52) {
        if (price == null && Number.isFinite(q52.c) && q52.c > 0) {
          price = q52.c;
          quoteSource = 'finnhub';
        }
        if (changePercent == null && Number.isFinite(q52.dp)) changePercent = q52.dp;
        high52 = q52.high52;
        low52 = q52.low52;
        dayHigh = q52.h;
        dayLow = q52.l;
        if (price != null && quoteSource === 'finova-live' && (high52 == null || low52 == null)) {
          high52 = q52.high52 ?? high52;
          low52 = q52.low52 ?? low52;
        }
      }
    } catch {
      /* keep live price if any */
    }

    return {
      symbol,
      name: wlItem?.name?.trim() || undefined,
      price,
      changePercent,
      currency: symbol.endsWith('.SR') || symbol.endsWith('.SA') ? 'SAR' : 'USD',
      high52,
      low52,
      dayHigh,
      dayLow,
      rangePositionPct: rangePositionPct(price, low52, high52),
      quoteSource,
      fairValue: wlItem?.fairValue,
      targetBuyLow: wlItem?.targetBuyLow,
      targetBuyHigh: wlItem?.targetBuyHigh,
      thesisStatus: wlItem?.thesisStatus,
    };
  });

  const promptBlock = formatMultiSymbolGroundingPromptBlock({ asOfIso, rows, promptBlock: '' });
  return { asOfIso, rows, promptBlock };
}
