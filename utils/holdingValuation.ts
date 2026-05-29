import type { Holding, TradeCurrency } from '../types';
import { convertBetweenTradeCurrencies, inferInstrumentCurrencyFromSymbol, quoteNotionalInBookCurrency } from './currencyMath';
import { AVG_COST_DECIMALS } from './money';
import { lookupLiveQuoteForSymbol } from '../services/finnhubService';
import { isTadawulQuoteSymbol } from '../services/marketQuoteRouting';
import { sanitizeLiveQuoteRow } from '../services/tadawulQuoteSanity';
import { MAX_HOLDING_BOOK_NOTIONAL } from '../services/marketSimulatorHoldingPersist';

/** Ignore corrupt stored notionals so platform P/L and NW are not driven by bad rows. */
function clampStoredMarketValue(marketValue: number, costValue: number): number {
  if (!Number.isFinite(marketValue) || marketValue <= 0) return marketValue;
  if (marketValue > MAX_HOLDING_BOOK_NOTIONAL) return costValue > 0 ? costValue : 0;
  if (costValue > 0 && marketValue > costValue * 50) return costValue;
  return marketValue;
}

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
    const rawQuote = holdingUsesLiveQuote(h) ? lookupLiveQuoteForSymbol(simulatedPrices, symRaw || sym) : undefined;
    const priceInfo =
        rawQuote && isTadawulQuoteSymbol(sym)
            ? sanitizeLiveQuoteRow(sym, rawQuote, {
                  avgCostPerShare: Number.isFinite(avgCost) && avgCost > 0 ? avgCost : undefined,
                  storedPricePerShare:
                      qty > 0 && Number.isFinite(Number(h.currentValue)) && Number(h.currentValue) > 0
                          ? Number(h.currentValue) / qty
                          : undefined,
              })
            : rawQuote;
    if (priceInfo && Number.isFinite(priceInfo.price) && qty > 0) {
        return quoteNotionalInBookCurrency(priceInfo.price as number, qty, sym, bookCurrency, sarPerUsd);
    }
    const marketValue = clampStoredMarketValue(Number(h.currentValue || 0), Number.isFinite(avgCost) && Number.isFinite(qty) ? avgCost * qty : 0);
    const costValue = Number.isFinite(avgCost) && Number.isFinite(qty) ? avgCost * qty : 0;
    if (marketValue > 0) return marketValue;
    if (costValue > 0) return costValue;
    return 0;
}

/**
 * Best-effort current price per unit, expressed in the portfolio's **book currency**.
 * Mirrors the fallback chain used in aggregates:
 * - live/simulated quote (instrument currency → book currency)
 * - stored market value ÷ qty
 * - avg cost
 */
export function effectiveHoldingUnitPriceInBookCurrency(
    h: Holding,
    bookCurrency: TradeCurrency,
    simulatedPrices: Record<string, { price?: number; change?: number } | undefined>,
    sarPerUsd: number,
): number {
    const qty = Number(h.quantity || 0);
    const avgCost = Number(h.avgCost || 0);
    const symRaw = (h.symbol || '').trim();
    const sym = symRaw.toUpperCase();

    const rawQuote = holdingUsesLiveQuote(h) ? lookupLiveQuoteForSymbol(simulatedPrices, symRaw || sym) : undefined;
    const priceInfo =
        rawQuote && isTadawulQuoteSymbol(sym)
            ? sanitizeLiveQuoteRow(sym, rawQuote, {
                  avgCostPerShare: Number.isFinite(avgCost) && avgCost > 0 ? avgCost : undefined,
                  storedPricePerShare:
                      qty > 0 && Number.isFinite(Number(h.currentValue)) && Number(h.currentValue) > 0
                          ? Number(h.currentValue) / qty
                          : undefined,
              })
            : rawQuote;
    if (priceInfo && Number.isFinite(priceInfo.price) && (priceInfo.price as number) > 0) {
        // Quote is in instrument currency; convert to book currency for per-unit comparison.
        return convertBetweenTradeCurrencies(priceInfo.price as number, inferInstrumentCurrencyFromSymbol(symRaw || sym), bookCurrency, sarPerUsd);
    }

    const marketValue = Number(h.currentValue || 0);
    if (qty > 0 && Number.isFinite(marketValue) && marketValue > 0) {
        return marketValue / qty;
    }
    if (Number.isFinite(avgCost) && avgCost > 0) return avgCost;
    return 0;
}
