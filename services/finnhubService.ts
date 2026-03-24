/**
 * Finnhub API – single source for market data (free tier).
 * Endpoints: market status, holidays, company profile, basic financials,
 * quote with 52-week, earnings calendar, insider transactions, news, economic calendar.
 * Rate limit: 60 calls/min on free tier; requests are throttled and 429 is retried once.
 */

const BASE = 'https://finnhub.io/api/v1';

/** Min gap between requests (ms) to stay under 60/min (~1.1s = ~54/min). */
const MIN_GAP_MS = 1100;
/** Default wait (ms) when 429 is returned and Retry-After is missing. */
const DEFAULT_429_WAIT_MS = 60_000;

let lastRequestTime = 0;
const pending: Array<{ url: string; options?: RequestInit; resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
let processing = false;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(response: Response): number | null {
  const v = response.headers.get('Retry-After');
  if (v == null) return null;
  const n = parseInt(v, 10);
  if (!Number.isNaN(n)) return n * 1000;
  const d = new Date(v).getTime();
  if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  return null;
}

async function processQueue(): Promise<void> {
  if (processing || pending.length === 0) return;
  processing = true;
  while (pending.length > 0) {
    const task = pending.shift()!;
    const gap = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestTime));
    if (gap > 0) await delay(gap);
    lastRequestTime = Date.now();
    try {
      let res = await fetch(task.url, task.options);
      if (res.status === 429) {
        const waitMs = parseRetryAfter(res) ?? DEFAULT_429_WAIT_MS;
        console.warn(`Finnhub rate limit (429); waiting ${waitMs}ms before retry.`);
        await delay(waitMs);
        lastRequestTime = Date.now();
        res = await fetch(task.url, task.options);
      }
      task.resolve(res);
    } catch (e) {
      task.reject(e);
    }
  }
  processing = false;
}

/**
 * Rate-limited fetch for Finnhub. Use this for all Finnhub API calls so we stay under 60/min
 * and handle 429 (retry once after Retry-After or 60s).
 */
export function finnhubFetch(url: string, options?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    pending.push({ url, options, resolve, reject });
    processQueue();
  });
}

function getToken(): string {
  const key = import.meta.env.VITE_FINNHUB_API_KEY;
  if (!key) throw new Error('VITE_FINNHUB_API_KEY is not set.');
  return key;
}

function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken();
  const q = new URLSearchParams({ ...params, token });
  return finnhubFetch(`${BASE}${path}?${q}`).then((r) => {
    if (r.status === 429) throw new Error('Finnhub rate limit (60/min). Wait a minute and try again.');
    if (!r.ok) throw new Error(`Finnhub ${path}: ${r.status}`);
    return r.json();
  });
}

/** Saudi Tadawul symbols use .SR suffix. Returns exchange and currency for display. */
export function getExchangeAndCurrencyForSymbol(symbol: string): { exchange: string; currency: string } | null {
  const s = (symbol || '').trim().toUpperCase();
  if (/\.SR$/i.test(s)) return { exchange: 'Tadawul', currency: 'SAR' };
  if (/\.SA$/i.test(s)) return { exchange: 'Saudi', currency: 'SAR' };
  return null;
}

/**
 * Normalize user/holding symbol to Finnhub `symbol` query format (single mapping for the whole app).
 * US tickers: uppercase; Tadawul `1234.SR` → `TADAWUL:1234`; crypto shortcuts → BINANCE pairs.
 */
export function toFinnhubSymbol(symbol: string): string {
  const upper = (symbol || '').toUpperCase().trim();
  if (!upper) return upper;
  if (upper === 'BTC' || upper === 'BTC-USD') return 'BINANCE:BTCUSDT';
  if (upper === 'ETH' || upper === 'ETH-USD') return 'BINANCE:ETHUSDT';
  // Earnings/calendar often return Saudi listings as bare digits (e.g. 2222) — same Finnhub prefix as 2222.SR.
  if (/^[0-9]{4,6}$/.test(upper)) return `TADAWUL:${upper}`;
  // Tadawul: numeric (2222.SR) and letter tickers (REITF.SR) both use TADAWUL: prefix on Finnhub.
  const tadawulMatch = upper.match(/^([A-Z0-9]{1,8})\.(SR|SA)$/);
  if (tadawulMatch) return `TADAWUL:${tadawulMatch[1]}`;
  // US class shares: Finnhub uses hyphen (e.g. BRK-B), not a dot — but not .SR/.SA (handled above).
  const usClass = upper.match(/^([A-Z]{1,5})\.([A-Z])$/);
  if (usClass) return `${usClass[1]}-${usClass[2]}`;
  return upper;
}

/** Canonical key used for live quote maps (matches getFinnhubLivePrices / fromFinnhubSymbol after request). */
export function canonicalQuoteLookupKey(symbol: string): string {
  return fromFinnhubSymbol(toFinnhubSymbol(symbol));
}

/** Map Finnhub quote/profile symbol back to app display keys (e.g. TADAWUL:2222 → 2222.SR). */
export function fromFinnhubSymbol(finnhubSymbol: string): string {
  const upper = (finnhubSymbol || '').toUpperCase().trim();
  if (!upper) return upper;
  if (upper === 'BINANCE:BTCUSDT') return 'BTC';
  if (upper === 'BINANCE:ETHUSDT') return 'ETH';
  const tadawulMatch = upper.match(/^TADAWUL:([A-Z0-9]{1,8})$/);
  if (tadawulMatch) return `${tadawulMatch[1]}.SR`;
  return upper;
}

/** 1-month daily candle data for charting. Points are day index (0 = oldest) and close price. */
export interface CandlePoint {
  day: number;
  price: number;
}

/** Stooq symbol for historical CSV: Saudi 2222.SR -> 2222.sr, US AAPL -> aapl.us, BRK.A -> brk-a */
function toStooqSymbol(symbol: string): string {
  const s = (symbol || '').trim();
  if (/\.(SR|SA)$/i.test(s)) return s.toLowerCase();
  const hadDot = s.includes('.');
  const lower = s.toLowerCase().replace(/\./g, '-');
  return hadDot ? lower : lower + '.us';
}

/** Fetch ~1 month of daily close prices from Stooq (no API key). Used when Finnhub has no data (e.g. Tadawul). */
async function getStooqCandles1M(symbol: string): Promise<CandlePoint[]> {
  const stooqSym = toStooqSymbol(symbol);
  try {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`);
    if (!res.ok) return [];
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    const rows = lines.slice(1).map((line) => line.split(','));
    const withDate: { date: number; close: number }[] = [];
    for (const row of rows) {
      if (row.length < 5) continue;
      const dateStr = row[0];
      const close = Number(row[4]);
      if (!Number.isFinite(close) || close <= 0) continue;
      const date = dateStr ? new Date(dateStr).getTime() : NaN;
      if (!Number.isFinite(date)) continue;
      withDate.push({ date, close });
    }
    if (withDate.length === 0) return [];
    withDate.sort((a, b) => a.date - b.date);
    const last31 = withDate.slice(-31);
    return last31.map((p, i) => ({ day: i, price: p.close }));
  } catch {
    return [];
  }
}

/** Fetch last ~30 calendar days of daily candles for a symbol. Returns array of { day, price } for chart. Uses Finnhub first; falls back to Stooq when Finnhub returns no data (Saudi .SR/.SA or any symbol). */
export async function getStockCandles1M(symbol: string): Promise<CandlePoint[]> {
  try {
    const finnhubSymbol = toFinnhubSymbol(symbol);
    const to = Math.floor(Date.now() / 1000);
    const from = to - 31 * 24 * 60 * 60;
    const token = getToken();
    const url = `${BASE}/stock/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(token)}`;
    const res = await finnhubFetch(url);
    if (!res.ok) return getStooqCandles1M(symbol);
    const data = await res.json();
    const t = data?.t as number[] | undefined;
    const c = data?.c as number[] | undefined;
    if (!Array.isArray(t) || !Array.isArray(c) || t.length === 0 || t.length !== c.length) return getStooqCandles1M(symbol);
    const pairs = t.map((ts, i) => ({ ts, price: Number(c[i]) })).filter((p) => Number.isFinite(p.price) && p.price > 0);
    pairs.sort((a, b) => a.ts - b.ts);
    const points = pairs.map((p, i) => ({ day: i, price: p.price }));
    if (points.length === 0) return getStooqCandles1M(symbol);
    return points;
  } catch {
    return getStooqCandles1M(symbol);
  }
}

// --- Market status (exchange open/closed) ---
/**
 * Finnhub `/stock/market-status` may return `session` with different casing or separators
 * (e.g. `pre_market`, `after hours`). Normalize so UI only branches on stable tokens.
 * @returns One of: pre-market | post-market | regular | closed | unknown | (lowercased raw if unrecognized)
 */
export function normalizeFinnhubMarketSession(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  if (!s || s === 'unknown' || s === 'n/a' || s === 'na') return 'unknown';
  if (s === 'closed' || s === 'close') return 'closed';
  if (s === 'regular' || s === 'open' || s === 'regular-market' || s === 'market-hours') return 'regular';
  if (
    s === 'pre-market' ||
    s === 'premarket' ||
    s === 'pre' ||
    s.startsWith('pre-market') ||
    s.includes('premarket')
  ) {
    return 'pre-market';
  }
  if (
    s === 'post-market' ||
    s === 'postmarket' ||
    s === 'after-hours' ||
    s === 'afterhours' ||
    s.startsWith('post-market') ||
    s.includes('postmarket') ||
    s.includes('after-hour')
  ) {
    return 'post-market';
  }
  return s;
}

export interface MarketStatusItem {
  exchange: string;
  holiday: string | null;
  isOpen: boolean;
  session: string;
  timezone: string;
  tztime: string;
}

export async function getMarketStatus(exchange: string = 'US'): Promise<MarketStatusItem | null> {
  try {
    const data = await get<{ exchange?: string; timezone?: string; tztime?: string; session?: string; isOpen?: boolean }>('/stock/market-status', { exchange });
    const rawSession = String((data as any).session ?? '').trim();
    return {
      exchange: data.exchange ?? exchange,
      holiday: (data as any).holiday ?? null,
      isOpen: (data as any).isOpen ?? false,
      session: normalizeFinnhubMarketSession(rawSession || 'unknown'),
      timezone: data.timezone ?? 'US/Eastern',
      tztime: data.tztime ?? '',
    };
  } catch {
    return null;
  }
}

// --- Market holidays ---
export interface MarketHoliday {
  date: string;
  exchange: string;
  name: string;
  status: string;
  open?: string;
  close?: string;
}

export async function getMarketHolidays(exchange: string = 'US'): Promise<MarketHoliday[]> {
  try {
    const data = await get<{ holiday?: MarketHoliday[] }>('/stock/market-holiday', { exchange });
    return Array.isArray((data as any).holiday) ? (data as any).holiday : [];
  } catch {
    return [];
  }
}

// --- Company profile ---
export interface CompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const resolved = toFinnhubSymbol(symbol);
    const data = await get<CompanyProfile>('/stock/profile2', { symbol: resolved });
    if (!data?.name) return null;
    // Finnhub may return ticker as bare "2222" or "REITF" while we queried TADAWUL:… — still the same listing.
    if (data.ticker) {
      const apiResolved = toFinnhubSymbol(data.ticker);
      if (apiResolved !== resolved && canonicalQuoteLookupKey(data.ticker) !== canonicalQuoteLookupKey(symbol)) {
        console.warn(`[Finnhub] profile2 ticker may not match "${symbol}": requested ${resolved}, profile ticker ${data.ticker} (keeping profile if name is set)`);
      }
    }
    return data;
  } catch {
    return null;
  }
}

// --- Basic financials / metrics ---
export interface BasicFinancials {
  metric: Record<string, number | string>;
  series?: Record<string, { period: string; v: number }[]>;
  symbol: string;
}

export async function getBasicFinancials(symbol: string): Promise<BasicFinancials | null> {
  try {
    const data = await get<BasicFinancials>('/stock/metric', { symbol: toFinnhubSymbol(symbol), metric: 'all' });
    return data && data.symbol ? data : null;
  } catch {
    return null;
  }
}

// --- Quote (day high/low; 52w from metrics) ---
export interface QuoteWith52W {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  high52?: number;
  low52?: number;
}

/** US, TADAWUL, etc. — session from Finnhub: pre-market | regular | post-market | closed */
export interface ExchangeMarketStatus {
  exchange: string;
  holiday: boolean;
  session: string;
}

export async function getExchangeMarketStatus(exchange: string): Promise<ExchangeMarketStatus | null> {
  try {
    const data = await get<{ exchange?: string; holiday?: boolean; session?: string }>('/stock/market-status', {
      exchange,
    });
    const raw = String(data.session ?? '').trim();
    const session = normalizeFinnhubMarketSession(raw || 'unknown');
    return {
      exchange: (data.exchange || exchange).toUpperCase(),
      holiday: !!data.holiday,
      session,
    };
  } catch {
    return null;
  }
}

export async function getQuote(symbol: string): Promise<QuoteWith52W | null> {
  try {
    const data = await get<QuoteWith52W & { p?: number }>('/quote', { symbol: toFinnhubSymbol(symbol) });
    if (!data) return null;
    const price = Number(data.c ?? data.pc ?? data.p);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { ...data, c: price, d: Number(data.d ?? 0), dp: Number(data.dp ?? 0), h: Number(data.h ?? price), l: Number(data.l ?? price), o: Number(data.o ?? price), pc: Number(data.pc ?? price) };
  } catch {
    return null;
  }
}

/** Quote plus 52-week from metrics endpoint. */
export async function getQuoteWith52W(symbol: string): Promise<QuoteWith52W | null> {
  const [quote, metrics] = await Promise.all([getQuote(symbol), getBasicFinancials(symbol)]);
  if (!quote) return null;
  const m = metrics?.metric as Record<string, number> | undefined;
  const high52 = m && typeof m['52WeekHigh'] === 'number' ? m['52WeekHigh'] : undefined;
  const low52 = m && typeof m['52WeekLow'] === 'number' ? m['52WeekLow'] : undefined;
  return { ...quote, high52, low52 };
}

// --- Earnings calendar ---
export interface EarningsEvent {
  actual: number | null;
  estimate: number | null;
  period: string;
  quarter: number;
  surprise: number | null;
  surprisePercent: number | null;
  symbol: string;
  year: number;
  date?: string;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
}

export async function getEarningsCalendar(from: string, to: string): Promise<EarningsEvent[]> {
  try {
    const data = await get<{ earningsCalendar?: EarningsEvent[] }>('/calendar/earnings', { from, to });
    return Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
  } catch {
    return [];
  }
}

export interface HoldingFundamentals {
  symbol: string;
  currency?: string;
  /** Day range from last quote; 52w from metrics when Finnhub returns them. */
  priceContext?: {
    dayHigh?: number;
    dayLow?: number;
    week52High?: number;
    week52Low?: number;
  };
  nextEarnings?: {
    date?: string;
    period?: string;
    quarter?: number;
    year?: number;
    revenueEstimate?: number | null;
  };
  dividend?: {
    dividendYieldPct?: number | null;
    dividendPerShareAnnual?: number | null;
  };
}

/** Convenience helper: upcoming earnings (revenue estimate) + dividend yield metrics for a symbol. */
export async function getHoldingFundamentals(symbol: string): Promise<HoldingFundamentals | null> {
  if (!symbol) return null;
  const today = new Date();
  const from = today.toISOString().split('T')[0];
  const oneYearAhead = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
  const to = oneYearAhead.toISOString().split('T')[0];

  const wantResolved = toFinnhubSymbol(symbol).toUpperCase();
  const [earningsList, metrics, profile, quote] = await Promise.all([
    getEarningsCalendar(from, to).then((list) =>
      list.filter((e) => {
        if (!e.date || !e.symbol) return false;
        return toFinnhubSymbol(e.symbol).toUpperCase() === wantResolved;
      }),
    ),
    getBasicFinancials(symbol),
    getCompanyProfile(symbol),
    getQuote(symbol),
  ]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let nextEarnings: HoldingFundamentals['nextEarnings'];
  if (earningsList.length > 0) {
    const sortedUpcoming = [...earningsList]
      .filter((e) => {
        if (!e.date) return false;
        const eventDate = new Date(e.date);
        return Number.isFinite(eventDate.getTime()) && eventDate.getTime() >= todayStart.getTime();
      })
      .sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });

    const first = sortedUpcoming[0];
    if (first) {
      nextEarnings = {
        date: first.date,
        period: first.period,
        quarter: first.quarter,
        year: first.year,
        revenueEstimate: first.revenueEstimate ?? null,
      };
    }
  }

  let dividend: HoldingFundamentals['dividend'];
  const m = metrics?.metric as Record<string, number | string> | undefined;
  if (m) {
    const rawYield =
      Number(m['dividendYieldIndicatedAnnual'] as number) ||
      Number(m['dividendYield'] as number) ||
      Number(m['dividendYieldTTM'] as number) ||
      Number(m['dividendYieldForward'] as number);
    const rawPerShare =
      Number(m['dividendPerShareTTM'] as number) ||
      Number(m['dividendPerShareAnnual'] as number) ||
      Number(m['dividendPerShareIndicatedAnnual'] as number);

    const dividendPerShareAnnual = Number.isFinite(rawPerShare) && rawPerShare > 0 ? rawPerShare : null;
    const inferredYieldPct = (dividendPerShareAnnual && quote?.c && quote.c > 0)
      ? (dividendPerShareAnnual / quote.c) * 100
      : null;

    let normalizedYield: number | null = null;
    if (Number.isFinite(rawYield) && rawYield > 0) {
      if (rawYield > 1) {
        normalizedYield = rawYield;
      } else if (inferredYieldPct && Number.isFinite(inferredYieldPct) && inferredYieldPct > 0) {
        const asPct = rawYield;
        const asRatioPct = rawYield * 100;
        normalizedYield = Math.abs(asPct - inferredYieldPct) <= Math.abs(asRatioPct - inferredYieldPct) ? asPct : asRatioPct;
      } else {
        normalizedYield = rawYield < 0.05 ? rawYield * 100 : rawYield;
      }
    }
    const dividendYieldPct = normalizedYield && normalizedYield < 100 ? normalizedYield : null;

    if (dividendYieldPct != null || dividendPerShareAnnual != null) {
      dividend = { dividendYieldPct, dividendPerShareAnnual };
    }
  }

  const currencyFromProfile = profile?.currency;
  const currencyFromMetrics = (metrics?.metric?.['currency'] as string | undefined) || undefined;
  const currency = (currencyFromProfile || currencyFromMetrics || '').toUpperCase() || undefined;

  const m52 = metrics?.metric as Record<string, number> | undefined;
  const week52High = m52 && typeof m52['52WeekHigh'] === 'number' ? m52['52WeekHigh'] : undefined;
  const week52Low = m52 && typeof m52['52WeekLow'] === 'number' ? m52['52WeekLow'] : undefined;
  const priceContext =
    quote || week52High != null || week52Low != null
      ? {
          dayHigh: quote?.h,
          dayLow: quote?.l,
          week52High,
          week52Low,
        }
      : undefined;

  return {
    symbol,
    currency,
    priceContext,
    nextEarnings,
    dividend,
  };
}

// --- Insider transactions ---
export interface InsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;
  transactionPrice: number;
}

export async function getInsiderTransactions(symbol: string, from?: string, to?: string): Promise<InsiderTransaction[]> {
  try {
    const toDate = to || new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await get<{ data?: InsiderTransaction[] }>('/stock/insider-transactions', {
      symbol: toFinnhubSymbol(symbol),
      from: fromDate,
      to: toDate,
    });
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    return [];
  }
}

// --- Company news (re-export style for use in research) ---
export interface CompanyNewsItem {
  symbol: string;
  headline: string;
  source: string;
  url: string;
  datetime: number;
  summary?: string;
}

export async function getCompanyNews(symbol: string, from: string, to: string): Promise<CompanyNewsItem[]> {
  try {
    const data = await get<any[]>('/company-news', { symbol: toFinnhubSymbol(symbol), from, to });
    if (!Array.isArray(data)) return [];
    return data.slice(0, 10).map((item) => ({
      symbol,
      headline: item.headline || '',
      source: item.source || 'Unknown',
      url: item.url || '',
      datetime: item.datetime || 0,
      summary: item.summary,
    }));
  } catch {
    return [];
  }
}

// --- Economic calendar ---
export interface EconomicCalendarEvent {
  date: string;
  country: string;
  event: string;
  actual?: string;
  estimate?: string;
}

interface MarketCalendarCachePayload {
  cachedAt: number;
  economic: EconomicCalendarEvent[];
  earnings: EarningsEvent[];
}

export type MarketCalendarLoadMode = 'fresh' | 'cache_fresh' | 'cache_stale' | 'none';

const MARKET_CALENDAR_CACHE_PREFIX = 'finnhub-market-calendar:v2:';
const MARKET_CALENDAR_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function getMarketCalendarCacheKey(from: string, to: string, symbols: string[]): string {
  const normalizedSymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort().join(',');
  return `${MARKET_CALENDAR_CACHE_PREFIX}${from}:${to}:${normalizedSymbols}`;
}

/**
 * Finnhub earnings rows may use bare tickers (e.g. `2222`) while the app stores `2222.SR`.
 * Compare using the same Finnhub symbol mapping as quotes/calendar requests.
 */
export function earningsEventMatchesTrackedSymbols(trackedDisplaySymbols: string[], earningsApiSymbol: string): boolean {
  const tracked = trackedDisplaySymbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (tracked.length === 0) return true;
  const keys = new Set(tracked.map((s) => toFinnhubSymbol(s).toUpperCase()));
  const k = toFinnhubSymbol((earningsApiSymbol || '').trim()).toUpperCase();
  return keys.has(k);
}

function readMarketCalendarCache(cacheKey: string): { payload: MarketCalendarCachePayload; stale: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const payload = JSON.parse(raw) as MarketCalendarCachePayload;
    if (!payload?.cachedAt || !Array.isArray(payload.economic) || !Array.isArray(payload.earnings)) return null;
    const stale = Date.now() - payload.cachedAt > MARKET_CALENDAR_CACHE_TTL_MS;
    return { payload, stale };
  } catch {
    return null;
  }
}

function writeMarketCalendarCache(cacheKey: string, payload: MarketCalendarCachePayload): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

export async function getEconomicCalendar(from: string, to: string): Promise<EconomicCalendarEvent[]> {
  const token = getToken();
  const q = new URLSearchParams({ from, to, token });
  const res = await finnhubFetch(`${BASE}/calendar/economic?${q.toString()}`);
  if (res.status === 403) {
    throw new Error('FINNHUB_ECONOMIC_FORBIDDEN');
  }
  if (res.status === 429) {
    throw new Error('Finnhub rate limit (60/min). Wait a minute and try again.');
  }
  if (!res.ok) {
    throw new Error(`Finnhub /calendar/economic: ${res.status}`);
  }
  const data = await res.json() as any;
  const events = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
  return events.map((e: any) => ({
    date: String(e?.date ?? ''),
    country: String(e?.country ?? 'Global'),
    event: String(e?.event ?? ''),
    actual: e?.actual != null ? String(e.actual) : undefined,
    estimate: e?.estimate != null ? String(e.estimate) : undefined,
  }));
}

export async function getMarketCalendarCached(from: string, to: string, trackedSymbols: string[]): Promise<{ economic: EconomicCalendarEvent[]; earnings: EarningsEvent[]; mode: MarketCalendarLoadMode; cachedAt?: number; warnings?: string[]; }> {
  const symbols = [...new Set(trackedSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const cacheKey = getMarketCalendarCacheKey(from, to, symbols);
  const cache = readMarketCalendarCache(cacheKey);
  if (cache && !cache.stale) {
    return {
      economic: cache.payload.economic,
      earnings: cache.payload.earnings,
      mode: 'cache_fresh',
      cachedAt: cache.payload.cachedAt,
      warnings: [],
    };
  }

  try {
    const warnings: string[] = [];
    let economic: EconomicCalendarEvent[] = [];
    try {
      economic = await getEconomicCalendar(from, to);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || '');
      if (msg.includes('FINNHUB_ECONOMIC_FORBIDDEN')) {
        warnings.push('Economic calendar is not available for your Finnhub plan (403). Showing earnings and local modeled events only.');
      }
    }
    const earningsAll = await getEarningsCalendar(from, to);

    const earnings = earningsAll.filter((e) => earningsEventMatchesTrackedSymbols(symbols, e.symbol || ''));
    const payload: MarketCalendarCachePayload = { cachedAt: Date.now(), economic, earnings };
    writeMarketCalendarCache(cacheKey, payload);
    return { economic, earnings, mode: 'fresh', cachedAt: payload.cachedAt, warnings };
  } catch {
    if (cache) {
      return {
        economic: cache.payload.economic,
        earnings: cache.payload.earnings,
        mode: 'cache_stale',
        cachedAt: cache.payload.cachedAt,
        warnings: [],
      };
    }
    return { economic: [], earnings: [], mode: 'none', warnings: [] };
  }
}

export async function getMarketCalendarFresh(from: string, to: string, trackedSymbols: string[]): Promise<{ economic: EconomicCalendarEvent[]; earnings: EarningsEvent[]; cachedAt: number; warnings?: string[]; }> {
  const symbols = [...new Set(trackedSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const warnings: string[] = [];
  let economic: EconomicCalendarEvent[] = [];
  try {
    economic = await getEconomicCalendar(from, to);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || '');
    if (msg.includes('FINNHUB_ECONOMIC_FORBIDDEN')) {
      warnings.push('Economic calendar is not available for your Finnhub plan (403). Showing earnings and local modeled events only.');
    }
  }
  const earningsAll = await getEarningsCalendar(from, to);
  const earnings = earningsAll.filter((e) => earningsEventMatchesTrackedSymbols(symbols, e.symbol || ''));
  const payload: MarketCalendarCachePayload = { cachedAt: Date.now(), economic, earnings };
  writeMarketCalendarCache(getMarketCalendarCacheKey(from, to, symbols), payload);
  return { economic, earnings, cachedAt: payload.cachedAt, warnings };
}


// --- Aggregated research for a symbol (profile + quote 52w + earnings + insider + news) ---
export interface SymbolResearch {
  symbol: string;
  profile: CompanyProfile | null;
  quote: QuoteWith52W | null;
  earnings: EarningsEvent[];
  insider: InsiderTransaction[];
  news: CompanyNewsItem[];
}

export async function getSymbolResearch(symbol: string): Promise<SymbolResearch> {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];
  const [profile, quote, earnings, insider, news] = await Promise.all([
    getCompanyProfile(symbol),
    getQuoteWith52W(symbol),
    getEarningsCalendar(fromStr, toStr).then((list) => list.filter((e) => e.symbol.toUpperCase() === symbol.toUpperCase())),
    getInsiderTransactions(symbol, fromStr, toStr),
    getCompanyNews(symbol, fromStr, toStr),
  ]);
  return { symbol, profile, quote, earnings, insider, news };
}
