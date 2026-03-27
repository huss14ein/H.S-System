import type { TickerStatus } from '../types';

/** Read-only label: how automation treats this universe status (same copy in Investments & Wealth Ultra). */
export function getUniversePlanRoleLabel(status: TickerStatus | string | undefined): string {
  switch (status) {
    case 'Core':
    case 'High-Upside':
      return 'In monthly rotation';
    case 'Speculative':
      return 'Speculative sleeve only';
    case 'Watchlist':
      return 'Tracked; no monthly $';
    case 'Quarantine':
    case 'Excluded':
      return 'Blocked from new buys';
    default:
      return 'Custom / review';
  }
}

/** For unified universe rows that include `source` (holdings vs universe). */
export function getUniverseRowPlanRole(ticker: { status?: TickerStatus | string; source?: string }): string {
  const src = ticker.source ?? '';
  const inUniverse = src === 'Universe' || src.includes('Universe');
  if (!inUniverse) return 'Needs universe mapping';
  return getUniversePlanRoleLabel(ticker.status as TickerStatus);
}

/** `monthly_weight` is stored as 0–1 fraction in app data. */
export function formatUniverseMonthlyWeightFraction(weight?: number | null): string {
  if (weight == null || !Number.isFinite(weight)) return '—';
  const pct = weight > 0 && weight <= 1 ? weight * 100 : weight;
  return `${pct.toFixed(1)}%`;
}
