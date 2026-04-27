/**
 * Lunar hawl (~354 days) for Zakat eligibility on investments, commodities, and cash deposits.
 * Cash layers use FIFO from checking/savings transactions ({@link summarizeZakatableCashForZakat}).
 * When no acquisition/buy/created date is known, callers may treat the lot as
 * zakatable for backward compatibility (see evaluateHawlEligibility legacy flag).
 */

import type { CommodityHolding, Holding, InvestmentTransaction } from '../types';

/** Approximate lunar year in whole calendar days (common fiqh software default). */
export const HAWL_DAYS_LUNAR = 354;

export function parseIsoDateYmd(s: string | undefined | null): Date | null {
  if (!s || typeof s !== 'string') return null;
  const ymd = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function calendarDaysBetweenUtc(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86400000);
}

export function isHawlComplete(start: Date, asOf: Date): boolean {
  return calendarDaysBetweenUtc(start, asOf) >= HAWL_DAYS_LUNAR;
}

function normalizeSymbol(sym: string | undefined): string {
  return String(sym ?? '')
    .trim()
    .toUpperCase();
}

/** Earliest buy date for this symbol in this portfolio (YYYY-MM-DD). */
export function earliestBuyDateForHolding(
  portfolioId: string,
  symbol: string,
  txs: InvestmentTransaction[] | undefined,
): string | null {
  if (!txs?.length) return null;
  const pid = String(portfolioId);
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  let best: string | null = null;
  for (const t of txs) {
    if (t.type !== 'buy') continue;
    const tPid = String((t as InvestmentTransaction).portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '');
    if (tPid !== pid) continue;
    if (normalizeSymbol(t.symbol) !== sym) continue;
    const d = (t.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!best || d < best) best = d;
  }
  return best;
}

export type InvestmentHawlResolution = {
  source: 'manual' | 'buy' | 'none';
  /** YYYY-MM-DD when known */
  startDate: string | null;
};

export function resolveInvestmentHawlStart(
  holding: Holding,
  portfolioId: string,
  txs: InvestmentTransaction[] | undefined,
): InvestmentHawlResolution {
  const manual = holding.acquisitionDate ?? (holding as { acquisition_date?: string }).acquisition_date;
  if (manual && /^\d{4}-\d{2}-\d{2}/.test(String(manual))) {
    return { source: 'manual', startDate: String(manual).slice(0, 10) };
  }
  const buy = earliestBuyDateForHolding(portfolioId, holding.symbol, txs);
  if (buy) return { source: 'buy', startDate: buy };
  return { source: 'none', startDate: null };
}

export type CommodityHawlResolution = {
  source: 'manual' | 'created' | 'none';
  startDate: string | null;
};

export function resolveCommodityHawlStart(
  c: CommodityHolding & { created_at?: string; createdAt?: string },
): CommodityHawlResolution {
  const manual = c.acquisitionDate ?? (c as { acquisition_date?: string }).acquisition_date;
  if (manual && /^\d{4}-\d{2}-\d{2}/.test(String(manual))) {
    return { source: 'manual', startDate: String(manual).slice(0, 10) };
  }
  const createdRaw = c.createdAt ?? c.created_at;
  if (createdRaw && typeof createdRaw === 'string') {
    const d = createdRaw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { source: 'created', startDate: d };
  }
  return { source: 'none', startDate: null };
}

export type HawlEligibility = {
  eligible: boolean;
  label: string;
};

/**
 * @param legacyWhenUnknown - if true and startDate is null, treat as zakatable (pre–auto-hawl behavior).
 */
export function evaluateHawlEligibility(
  startDate: string | null,
  asOf: Date,
  legacyWhenUnknown: boolean,
): HawlEligibility {
  if (!startDate) {
    if (legacyWhenUnknown) {
      return {
        eligible: true,
        label: 'Hawl not tracked — set acquisition date or record buys for lunar-year rule',
      };
    }
    return { eligible: false, label: 'Unknown start — not counted' };
  }
  const start = parseIsoDateYmd(startDate);
  if (!start) {
    return legacyWhenUnknown
      ? { eligible: true, label: 'Invalid date — using zakatable default' }
      : { eligible: false, label: 'Invalid date' };
  }
  const days = calendarDaysBetweenUtc(start, asOf);
  if (isHawlComplete(start, asOf)) {
    return {
      eligible: true,
      label: `Hawl met (${days}d ≥ ${HAWL_DAYS_LUNAR}d from ${startDate})`,
    };
  }
  return {
    eligible: false,
    label: `Pending hawl (${days} / ${HAWL_DAYS_LUNAR} days since ${startDate})`,
  };
}
