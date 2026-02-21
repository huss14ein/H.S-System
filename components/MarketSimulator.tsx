import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';

const YAHOO_QUOTE_API = 'https://query1.finance.yahoo.com/v7/finance/quote';
const LIVE_REFRESH_MS = 60_000;
const FALLBACK_TICK_MS = 6_000;

const isUsTicker = (symbol: string) => !symbol.includes('.');

const chunk = <T,>(arr: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
};

const fetchYahooQuotes = async (symbols: string[]): Promise<Record<string, number>> => {
    if (symbols.length === 0) return {};

    const responses = await Promise.all(
        chunk(symbols, 40).map(async (group) => {
            const url = `${YAHOO_QUOTE_API}?symbols=${encodeURIComponent(group.join(','))}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Yahoo quote request failed with status ${response.status}`);
            }
            return response.json();
        })
    );

    const prices: Record<string, number> = {};
    responses.forEach((payload) => {
        const results = payload?.quoteResponse?.result || [];
        results.forEach((item: any) => {
            const symbol = item?.symbol;
            const price = item?.regularMarketPrice;
            if (symbol && typeof price === 'number' && price > 0) {
                prices[symbol.toUpperCase()] = price;
            }
        });
    });

    return prices;
};

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);

    const contextRef = useRef({ dataContext, marketContext });
    contextRef.current = { dataContext, marketContext };

    const previousPricesRef = useRef<Record<string, number>>({});
    const lastLiveFetchRef = useRef<number>(0);

    useEffect(() => {
        let intervalId: number | null = null;

        const runTick = async () => {
            const { dataContext, marketContext } = contextRef.current;
            if (!dataContext || !marketContext || !dataContext.data) return;

            const { data, batchUpdateHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices } = marketContext;

            const allHoldings = data.investments.flatMap(p => p.holdings);
            const allWatchlistItems = data.watchlist;

            const uniqueSymbols = Array.from(new Set([
                ...allHoldings.map(h => h.symbol.toUpperCase()),
                ...allWatchlistItems.map(w => w.symbol.toUpperCase())
            ]));

            if (uniqueSymbols.length === 0) return;

            const usSymbols = uniqueSymbols.filter(isUsTicker);
            const now = Date.now();
            let livePrices: Record<string, number> = {};

            if (usSymbols.length > 0 && now - lastLiveFetchRef.current >= LIVE_REFRESH_MS) {
                try {
                    livePrices = await fetchYahooQuotes(usSymbols);
                    lastLiveFetchRef.current = now;
                } catch (error) {
                    console.warn('Live Yahoo price fetch failed, using fallback simulation tick.', error);
                }
            }

            const newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            const holdingUpdates: { id: string, currentValue: number }[] = [];

            const activeAlertsBySymbol = new Map<string, PriceAlert[]>();
            data.priceAlerts.filter(a => a.status === 'active').forEach(alert => {
                const symbol = alert.symbol.toUpperCase();
                if (!activeAlertsBySymbol.has(symbol)) {
                    activeAlertsBySymbol.set(symbol, []);
                }
                activeAlertsBySymbol.get(symbol)!.push({ ...alert, symbol });
            });

            const triggeredAlerts: PriceAlert[] = [];
            const previousPrices = previousPricesRef.current;

            const getInitialPrice = (symbol: string) => {
                if (previousPrices[symbol]) return previousPrices[symbol];
                let hash = 0;
                for (let i = 0; i < symbol.length; i++) {
                    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
                }
                const price = Math.abs(hash % 450) + 50;
                previousPrices[symbol] = price;
                return price;
            };

            uniqueSymbols.forEach(symbol => {
                const oldPrice = currentSimulatedPrices[symbol]?.price || previousPrices[symbol] || getInitialPrice(symbol);
                const livePrice = livePrices[symbol];

                let newPrice: number;
                if (typeof livePrice === 'number' && livePrice > 0) {
                    newPrice = livePrice;
                } else {
                    const changePercentRaw = (Math.random() - 0.495) * 0.02;
                    newPrice = Math.max(oldPrice * (1 + changePercentRaw), 0.01);
                }

                const change = newPrice - oldPrice;
                const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;

                newPrices[symbol] = { price: newPrice, change, changePercent };
                previousPrices[symbol] = newPrice;

                const relevantAlerts = activeAlertsBySymbol.get(symbol);
                if (relevantAlerts) {
                    relevantAlerts.forEach(relevantAlert => {
                        const hasTriggered = (newPrice >= relevantAlert.targetPrice && oldPrice < relevantAlert.targetPrice) || (newPrice <= relevantAlert.targetPrice && oldPrice > relevantAlert.targetPrice);
                        if (hasTriggered) {
                            triggeredAlerts.push({ ...relevantAlert, status: 'triggered' });
                        }
                    });
                }
            });

            setSimulatedPrices(newPrices);

            allHoldings.forEach(holding => {
                const symbol = holding.symbol.toUpperCase();
                if (holding.id && newPrices[symbol]) {
                    holdingUpdates.push({
                        id: holding.id,
                        currentValue: newPrices[symbol].price * holding.quantity
                    });
                }
            });

            if (holdingUpdates.length > 0) {
                batchUpdateHoldingValues(holdingUpdates);
            }

            if (triggeredAlerts.length > 0) {
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }
        };

        const start = () => {
            if (intervalId === null) {
                runTick();
                intervalId = window.setInterval(runTick, FALLBACK_TICK_MS);
            }
        };

        const stop = () => {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) stop();
            else start();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        start();

        return () => {
            stop();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return null;
};

export default MarketSimulator;
