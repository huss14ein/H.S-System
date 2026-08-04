import { describe, expect, it } from 'vitest';
import type { InvestmentPortfolio } from '../types';
import {
    MAX_HOLDING_BOOK_NOTIONAL,
    buildCommodityHoldingValueUpdatesFromTrustedSnapshot,
    buildEquityHoldingValueUpdatesFromTrustedSnapshot,
    filterNoOpHoldingValueUpdates,
} from '../services/marketSimulatorHoldingPersist';

describe('marketSimulatorHoldingPersist', () => {
    const sarPerUsd = 3.75;

    it('returns no equity updates when trusted snapshot is empty (simulated-only pass must not persist)', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h1',
                        symbol: '1150.SR',
                        quantity: 100,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        expect(buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, {}, sarPerUsd)).toEqual([]);
    });

    it('converts USD-listed notion into SAR book via quoteNotionalInBookCurrency', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h-usd',
                        symbol: 'AAPL',
                        quantity: 2,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        const trusted = { AAPL: { price: 10, change: 0, changePercent: 0 } };
        const updates = buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd);
        expect(updates).toEqual([
            { id: 'h-usd', currentValue: 10 * 2 * sarPerUsd, currentPrice: 10 },
        ]);
    });

    it('uses SAR notion as-is for .SR in SAR book', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h-sr',
                        symbol: '1150.SR',
                        quantity: 10,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        const trusted = { '1150.SR': { price: 42, change: 0, changePercent: 0 } };
        expect(buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd)).toEqual([
            { id: 'h-sr', currentValue: 420, currentPrice: 42 },
        ]);
    });

    it('bare Tadawul letters with expanded bare+.SR keys persist SAR notional (no USD FX)', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h-reit',
                        symbol: 'REITF',
                        quantity: 100,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        const trusted = {
            REITF: { price: 20, change: 0, changePercent: 0 },
            'REITF.SR': { price: 20, change: 0, changePercent: 0 },
        };
        expect(buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd)).toEqual([
            { id: 'h-reit', currentValue: 2000, currentPrice: 20 },
        ]);
    });

    it('skips updates above MAX_HOLDING_BOOK_NOTIONAL (corrupt upstream)', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h1',
                        symbol: '1150.SR',
                        quantity: 1,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        const trusted = { '1150.SR': { price: MAX_HOLDING_BOOK_NOTIONAL + 1, change: 0, changePercent: 0 } };
        expect(buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd)).toEqual([]);
    });

    it('skips manual / non-ticker holdings', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'm1',
                        symbol: 'FOO',
                        quantity: 1,
                        holdingType: 'manual_fund',
                    } as any,
                ],
            } as any,
        ];
        const trusted = { FOO: { price: 99, change: 0, changePercent: 0 } };
        expect(buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd)).toEqual([]);
    });

    it('re-sanitizes Tadawul trusted rows with holding avg cost before persisting', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'SAR',
                holdings: [
                    {
                        id: 'h-tdwl',
                        symbol: '2222.SR',
                        quantity: 100,
                        avgCost: 32,
                        currentValue: 3200,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        const trusted = { '2222.SR': { price: 3200, change: 0, changePercent: 0 } };
        const updates = buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfolios, trusted, sarPerUsd);
        expect(updates).toEqual([{ id: 'h-tdwl', currentValue: 3200, currentPrice: 32 }]);
    });

    it('persists a changed unit price even when rounded position value is unchanged', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'USD',
                holdings: [
                    {
                        id: 'h1',
                        symbol: 'AAPL',
                        quantity: 0.001,
                        currentValue: 0.1,
                        currentPrice: 100,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        expect(
            filterNoOpHoldingValueUpdates(portfolios, [
                { id: 'h1', currentValue: 0.1, currentPrice: 100.5 },
            ]),
        ).toHaveLength(1);
    });

    it('carries the original trusted quote retrieval timestamp', () => {
        const portfolios: InvestmentPortfolio[] = [
            {
                id: 'p1',
                currency: 'USD',
                holdings: [
                    {
                        id: 'h1',
                        symbol: 'AAPL',
                        quantity: 2,
                        holdingType: 'ticker',
                    } as any,
                ],
            } as any,
        ];
        expect(
            buildEquityHoldingValueUpdatesFromTrustedSnapshot(
                portfolios,
                { AAPL: { price: 10, change: 0, changePercent: 0 } },
                sarPerUsd,
                { AAPL: '2026-07-25T00:00:00.000Z' },
            ),
        ).toEqual([
            {
                id: 'h1',
                currentValue: 20,
                currentPrice: 10,
                priceUpdatedAt: '2026-07-25T00:00:00.000Z',
            },
        ]);
    });

    it('buildCommodityHoldingValueUpdatesFromTrustedSnapshot skips when trusted lacks commodity row', () => {
        const rows = [{ id: 'c1', symbol: 'XAU', quantity: 1 }];
        expect(buildCommodityHoldingValueUpdatesFromTrustedSnapshot(rows, {})).toEqual([]);
    });

    it('buildCommodityHoldingValueUpdatesFromTrustedSnapshot uses trusted price × qty', () => {
        const rows = [{ id: 'c1', symbol: 'XAU_GRAM_24K', quantity: 2 }];
        const trusted = { XAU_GRAM_24K: { price: 250, change: 0, changePercent: 0 } };
        expect(buildCommodityHoldingValueUpdatesFromTrustedSnapshot(rows, trusted)).toEqual([
            { id: 'c1', currentValue: 500 },
        ]);
    });
});
