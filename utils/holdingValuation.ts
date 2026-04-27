import type { Holding, TradeCurrency } from '../types';
import { quoteNotionalInBookCurrency } from './currencyMath';
import { AVG_COST_DECIMALS } from './money';
import { lookupLiveQuoteForSymbol } from '../services/finnhubService';

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

/**
 * Market value of one holding in the portfolio's **book currency** (matches Portfolios / Overview).
 * Uses live/simulated price when the holding is quote-backed; otherwise stored value or cost basis.
 */
export function effectiveHoldingValueInBookCurrency(
    h: Holding,
    bookCurrency: TradeCurrency,
    simulatedPrices: Record<string, { price?: number; change?: number } | undefined>,
    sarPerUsd: number,
): number {
    const qty = Number(h.quantity || 0);
    const avgCost = Number(h.avgCost || 0);
    const symRaw = (h.symbol || '').trim();
    const sym = symRaw.toUpperCase();
    const priceInfo = holdingUsesLiveQuote(h) ? lookupLiveQuoteForSymbol(simulatedPrices, symRaw || sym) : undefined;
    if (priceInfo && Number.isFinite(priceInfo.price) && qty > 0) {
        return quoteNotionalInBookCurrency(priceInfo.price as number, qty, sym, bookCurrency, sarPerUsd);
    }
    const marketValue = Number(h.currentValue || 0);
    const costValue = Number.isFinite(avgCost) && Number.isFinite(qty) ? avgCost * qty : 0;
    if (marketValue > 0) return marketValue;
    if (costValue > 0) return costValue;
    return 0;
}
