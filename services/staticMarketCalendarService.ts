/**
 * Static market calendar data (US holidays + economic events).
 * Used when Finnhub is unavailable or returns no data, so Market Events always has content.
 * Data files: public/data/us-market-holidays.json, public/data/economic-calendar.json
 */

export interface StaticMarketHoliday {
  date: string;
  name: string;
  exchange?: string;
  status?: string;
}

export interface StaticEconomicEvent {
  date: string;
  country: string;
  event: string;
}

const HOLIDAYS_URL = '/data/us-market-holidays.json';
const ECONOMIC_URL = '/data/economic-calendar.json';

let holidaysCache: StaticMarketHoliday[] | null = null;
let economicCache: StaticEconomicEvent[] | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '';
  const res = await fetch(`${base}${url.startsWith('/') ? url.slice(1) : url}`);
  if (!res.ok) throw new Error(`Static calendar: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Load US market holidays from static JSON.
 * Returns array compatible with Finnhub MarketHoliday shape (date, name, exchange, status).
 */
export async function getStaticMarketHolidays(): Promise<StaticMarketHoliday[]> {
  if (holidaysCache) return holidaysCache;
  try {
    const data = await fetchJson<StaticMarketHoliday[]>(HOLIDAYS_URL);
    holidaysCache = Array.isArray(data) ? data : [];
    return holidaysCache;
  } catch {
    return [];
  }
}

/**
 * Load economic calendar events from static JSON, filtered by date range.
 * from/to are YYYY-MM-DD. Returns array compatible with EconomicCalendarEvent (date, country, event).
 */
export async function getStaticEconomicCalendar(from: string, to: string): Promise<StaticEconomicEvent[]> {
  try {
    if (!economicCache) {
      const data = await fetchJson<StaticEconomicEvent[]>(ECONOMIC_URL);
      economicCache = Array.isArray(data) ? data : [];
    }
    return economicCache.filter((e) => e.date >= from && e.date <= to);
  } catch {
    return [];
  }
}
