import type { Holding } from '../types';
import { AVG_COST_DECIMALS } from './money';

/** Decimal places for per-share / per-unit amounts (avg. cost, price per share, pullback prices). */
export const HOLDING_PER_UNIT_DECIMALS = AVG_COST_DECIMALS;

/**
 * Only `ticker` holdings are updated from market quotes (simulated/live).
 * `manual_fund` and other non-ticker types must use stored `currentValue` in aggregates.
 */
export function holdingUsesLiveQuote(h: Holding | { holdingType?: string; holding_type?: string }): boolean {
    const t = h.holdingType ?? (h as { holding_type?: string }).holding_type ?? 'ticker';
    return t === 'ticker';
}
