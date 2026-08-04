import type { InvestmentPortfolio } from '../types';
import { quoteNotionalInBookCurrency } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { lookupLiveQuoteForSymbol, type LiveQuoteRow } from './finnhubService';
import { isTadawulQuoteSymbol } from './marketQuoteRouting';
import { holdingCanUseQuoteRefresh } from './quoteRefreshSymbols';
import { sanitizeLiveQuoteRow } from './tadawulQuoteSanity';

/** Skip persisting nonsense totals if upstream data is corrupt (protects DB / UI aggregates). */
export const MAX_HOLDING_BOOK_NOTIONAL = 1e12;

export type HoldingMarketValueUpdate = {
    id: string;
    /** Book-currency position value. */
    currentValue: number;
    /** Exact trusted provider unit price in the symbol's quote currency. */
    currentPrice: number;
    /** Original API/cache retrieval timestamp; prevents stale cache from looking newly fetched. */
    priceUpdatedAt?: string;
    /** Book-currency unrealized P/L: currentValue − quantity × avgCost. */
    unrealizedPnL?: number;
};

function trustedQuoteRowForHolding(
    sym: string,
    trusted: Record<string, LiveQuoteRow>,
    holding: { avgCost?: number; quantity?: number; currentValue?: number },
): LiveQuoteRow | undefined {
    const rowRaw = lookupLiveQuoteForSymbol(trusted, sym);
    if (!rowRaw || !Number.isFinite(rowRaw.price) || rowRaw.price <= 0) return undefined;
    if (!isTadawulQuoteSymbol(sym)) return rowRaw;
    const avgCost = Number(holding.avgCost ?? 0);
    return sanitizeLiveQuoteRow(sym, rowRaw, {
        avgCostPerShare: Number.isFinite(avgCost) && avgCost > 0 ? avgCost : undefined,
    });
}

/**
 * Persisted `currentValue` for equity holdings: only from **trusted** (cache/API) quotes, converted to each portfolio's book currency.
 * Simulated RNG fills must not be passed in `trusted` — they would corrupt stored notionals when live feeds fail.
 * Tadawul rows are re-sanitized per holding (avg cost / stored price) so bad cache rows do not stick.
 */
export function buildEquityHoldingValueUpdatesFromTrustedSnapshot(
    portfolios: InvestmentPortfolio[],
    trusted: Record<string, LiveQuoteRow>,
    sarPerUsd: number,
    quoteUpdatedAtBySymbol: Record<string, string | undefined> = {},
): HoldingMarketValueUpdate[] {
    const out: HoldingMarketValueUpdate[] = [];
    for (const p of portfolios) {
        const book = resolveInvestmentPortfolioCurrency(p);
        for (const holding of p.holdings ?? []) {
            if (!holdingCanUseQuoteRefresh(holding, { bookCurrency: book })) continue;
            const sym = holding.symbol;
            if (sym == null || !holding.id) continue;
            const row = trustedQuoteRowForHolding(sym, trusted, holding);
            if (!row || !Number.isFinite(row.price) || row.price <= 0) continue;
            const qty = Number(holding.quantity ?? 0);
            if (!(qty > 0)) continue;
            const notion = quoteNotionalInBookCurrency(row.price, qty, sym, book, sarPerUsd, trusted);
            if (!Number.isFinite(notion) || notion <= 0 || notion > MAX_HOLDING_BOOK_NOTIONAL) continue;
            const avgCost = Number(holding.avgCost ?? 0);
            const costBasis = Number.isFinite(avgCost) && avgCost > 0 ? avgCost * qty : 0;
            const unrealizedPnL = Number.isFinite(costBasis) ? notion - costBasis : notion;
            out.push({
                id: holding.id,
                currentValue: notion,
                currentPrice: row.price,
                unrealizedPnL,
                ...(quoteUpdatedAtBySymbol[String(sym).trim().toUpperCase()]
                    ? { priceUpdatedAt: quoteUpdatedAtBySymbol[String(sym).trim().toUpperCase()] }
                    : {}),
            });
        }
    }
    return out;
}

/** Drop updates where book notional is unchanged (avoids redundant DataContext writes on quote ticks). */
export function filterNoOpHoldingValueUpdates(
    portfolios: InvestmentPortfolio[],
    updates: HoldingMarketValueUpdate[],
    epsilon = 0.01,
): HoldingMarketValueUpdate[] {
    const currentById = new Map<
        string,
        { currentValue: number; currentPrice?: number; unrealizedPnL?: number }
    >();
    for (const p of portfolios) {
        for (const h of p.holdings ?? []) {
            if (h.id) {
                const unrealized = Number(h.unrealizedPnL);
                currentById.set(h.id, {
                    currentValue: Number(h.currentValue) || 0,
                    currentPrice: Number.isFinite(Number(h.currentPrice)) ? Number(h.currentPrice) : undefined,
                    unrealizedPnL: Number.isFinite(unrealized) ? unrealized : undefined,
                });
            }
        }
    }
    return updates.filter((u) => {
        const prev = currentById.get(u.id);
        if (prev == null) return true;
        const unrealizedChanged =
            u.unrealizedPnL != null &&
            (prev.unrealizedPnL == null || Math.abs(prev.unrealizedPnL - u.unrealizedPnL) > epsilon);
        return (
            Math.abs(prev.currentValue - u.currentValue) > epsilon ||
            prev.currentPrice == null ||
            Math.abs(prev.currentPrice - u.currentPrice) > 1e-8 ||
            unrealizedChanged
        );
    });
}

export function buildCommodityHoldingValueUpdatesFromTrustedSnapshot(
    commodities: { id?: string; symbol?: string; quantity?: number }[],
    trusted: Record<string, LiveQuoteRow>,
): { id: string; currentValue: number }[] {
    const out: { id: string; currentValue: number }[] = [];
    for (const commodity of commodities) {
        const sym = commodity.symbol;
        if (!commodity.id || sym == null) continue;
        const row = lookupLiveQuoteForSymbol(trusted, sym);
        if (!row || !Number.isFinite(row.price) || row.price <= 0) continue;
        const qty = Number(commodity.quantity ?? 0);
        if (!(qty > 0)) continue;
        const notion = row.price * qty;
        if (!Number.isFinite(notion) || notion <= 0 || notion > MAX_HOLDING_BOOK_NOTIONAL) continue;
        out.push({ id: commodity.id, currentValue: notion });
    }
    return out;
}
