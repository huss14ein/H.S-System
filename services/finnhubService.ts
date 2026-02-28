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

// --- Market status (exchange open/closed) ---
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
    return {
      exchange: data.exchange ?? exchange,
      holiday: (data as any).holiday ?? null,
      isOpen: (data as any).isOpen ?? false,
      session: (data as any).session ?? '',
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
    const data = await get<CompanyProfile>('/stock/profile2', { symbol: symbol.toUpperCase() });
    return data && data.name ? data : null;
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
    const data = await get<BasicFinancials>('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' });
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

export async function getQuote(symbol: string): Promise<QuoteWith52W | null> {
  try {
    const data = await get<QuoteWith52W>('/quote', { symbol: symbol.toUpperCase() });
    if (data && Number.isFinite(data.c)) return data;
    return null;
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
      symbol: symbol.toUpperCase(),
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
    const data = await get<any[]>('/company-news', { symbol: symbol.toUpperCase(), from, to });
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

export async function getEconomicCalendar(from: string, to: string): Promise<EconomicCalendarEvent[]> {
  try {
    const data = await get<{ economicCalendar?: any[] }>('/calendar/economic', { from, to });
    const events = Array.isArray((data as any).economicCalendar) ? (data as any).economicCalendar : [];
    return events.slice(0, 20).map((e: any) => ({
      date: String(e?.date ?? ''),
      country: String(e?.country ?? 'Global'),
      event: String(e?.event ?? ''),
      actual: e?.actual != null ? String(e.actual) : undefined,
      estimate: e?.estimate != null ? String(e.estimate) : undefined,
    }));
  } catch {
    return [];
  }
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
