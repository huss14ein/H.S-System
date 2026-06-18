/**
 * Client-side regular-session checks for equity daily P/L.
 * When the listing exchange is closed, today's P/L must be zero — not yesterday's quote delta.
 */
import { isTadawulQuoteSymbol, isUsEquityQuoteSymbol } from './marketQuoteRouting';
import { getMarketHoursGuardrail, isNYSEHolidayOrWeekend } from './riskCompliance';

export type EquityListingExchange = 'US' | 'TADAWUL';

export function resolveEquityListingExchange(symbol: string | null | undefined): EquityListingExchange | null {
  const s = String(symbol ?? '').trim();
  if (!s) return null;
  if (isTadawulQuoteSymbol(s)) return 'TADAWUL';
  if (isUsEquityQuoteSymbol(s)) return 'US';
  return null;
}

type ClockParts = { weekday: number; hour: number; minute: number; year: number; month: number; day: number };

function clockPartsInTimeZone(date: Date, timeZone: string): ClockParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const weekdayLabel = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[weekdayLabel] ?? date.getDay(),
    hour: pick('hour'),
    minute: pick('minute'),
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
  };
}

function dateFromParts(p: ClockParts): Date {
  return new Date(p.year, p.month - 1, p.day);
}

/** NYSE regular session (9:30–16:00 ET) on a trading day. */
export function isUsEquityRegularSessionOpen(now: Date = new Date()): boolean {
  const et = clockPartsInTimeZone(now, 'America/New_York');
  const etDate = dateFromParts(et);
  if (isNYSEHolidayOrWeekend(etDate)) return false;
  const guard = getMarketHoursGuardrail(etDate, et.hour, et.minute);
  return guard.allowed;
}

/** Tadawul regular session (10:00–15:00 AST, Sun–Thu). */
export function isTadawulRegularSessionOpen(now: Date = new Date()): boolean {
  const riyadh = clockPartsInTimeZone(now, 'Asia/Riyadh');
  const day = riyadh.weekday;
  if (day === 5 || day === 6) return false;
  const mins = riyadh.hour * 60 + riyadh.minute;
  const open = 10 * 60;
  const close = 15 * 60;
  return mins >= open && mins < close;
}

export function isEquityListingRegularSessionOpen(
  exchange: EquityListingExchange,
  now: Date = new Date(),
): boolean {
  return exchange === 'US' ? isUsEquityRegularSessionOpen(now) : isTadawulRegularSessionOpen(now);
}

/** True when at least one supported equity market is in regular session (US or Tadawul). */
export function isAnyEquityMarketRegularSessionOpen(now: Date = new Date()): boolean {
  return isUsEquityRegularSessionOpen(now) || isTadawulRegularSessionOpen(now);
}

/** True when today's quote delta should count toward daily P/L for this symbol. */
export function isEquityDailyPnLSessionOpen(symbol: string | null | undefined, now: Date = new Date()): boolean {
  const exchange = resolveEquityListingExchange(symbol);
  if (!exchange) return false;
  return isEquityListingRegularSessionOpen(exchange, now);
}

/** Daily P/L change per share — provider day move vs prior close (broker-style). */
export function quoteChangeForDailyPnL(
  _symbol: string | null | undefined,
  change: number | undefined,
  _now: Date = new Date(),
): number {
  if (!Number.isFinite(change)) return 0;
  return change as number;
}
