import type { InvestmentPortfolio } from '../types';
import { quoteNotionalInBookCurrency } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { lookupLiveQuoteForSymbol, type LiveQuoteRow } from './finnhubService';
import { holdingCanUseQuoteRefresh } from './quoteRefreshSymbols';

/** Skip persisting nonsense totals if upstream data is corrupt (protects DB / UI aggregates). */
export const MAX_HOLDING_BOOK_NOTIONAL = 1e12;

/**
 * Persisted `currentValue` for equity holdings: only from **trusted** (cache/API) quotes, converted to each portfolio's book currency.
 * Simulated RNG fills must not be passed in `trusted` — they would corrupt stored notionals when live feeds fail.
 */
export function buildEquityHoldingValueUpdatesFromTrustedSnapshot(
    portfolios: InvestmentPortfolio[],
    trusted: Record<string, LiveQuoteRow>,
    sarPerUsd: number,
): { id: string; currentValue: number }[] {
    const out: { id: string; currentValue: number }[] = [];
    for (const p of portfolios) {
        const book = resolveInvestmentPortfolioCurrency(p);
        for (const holding of p.holdings ?? []) {
            if (!holdingCanUseQuoteRefresh(holding)) continue;
            const sym = holding.symbol;
            if (sym == null || !holding.id) continue;
            const row = lookupLiveQuoteForSymbol(trusted, sym);
            if (!row || !Number.isFinite(row.price) || row.price <= 0) continue;
            const qty = Number(holding.quantity ?? 0);
            if (!(qty > 0)) continue;
            const notion = quoteNotionalInBookCurrency(row.price, qty, sym, book, sarPerUsd);
            if (!Number.isFinite(notion) || notion <= 0 || notion > MAX_HOLDING_BOOK_NOTIONAL) continue;
            out.push({ id: holding.id, currentValue: notion });
        }
    }
    return out;
}

/** Drop updates where book notional is unchanged (avoids redundant DataContext writes on quote ticks). */
export function filterNoOpHoldingValueUpdates(
    portfolios: InvestmentPortfolio[],
    updates: { id: string; currentValue: number }[],
    epsilon = 0.01,
): { id: string; currentValue: number }[] {
    const currentById = new Map<string, number>();
    for (const p of portfolios) {
        for (const h of p.holdings ?? []) {
            if (h.id) currentById.set(h.id, Number(h.currentValue) || 0);
        }
    }
    return updates.filter((u) => {
        const prev = currentById.get(u.id);
        if (prev == null) return true;
        return Math.abs(prev - u.currentValue) > epsilon;
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
