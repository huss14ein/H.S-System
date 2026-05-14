import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import type { InvestmentPortfolio } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';
import { getLivePrices, getAICommodityPrices } from '../services/geminiService';
import {
    expandLiveQuotesForRequestedSymbols,
    lookupLiveQuoteForSymbol,
    type LiveQuoteRow,
} from '../services/finnhubService';
import {
    cacheRowsToSimulatedMap,
    loadQuoteCacheRows,
    saveQuoteCacheRows,
    symbolsNeedingLiveFetch,
    upsertCacheFromLiveQuotes,
} from '../services/quotePriceCache';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { getRefreshableHoldingQuoteSymbols } from '../services/quoteRefreshSymbols';
import {
    buildCommodityHoldingValueUpdatesFromTrustedSnapshot,
    buildEquityHoldingValueUpdatesFromTrustedSnapshot,
} from '../services/marketSimulatorHoldingPersist';

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);
    const { exchangeRate } = useCurrency();

    const contextRef = useRef({ dataContext, marketContext, exchangeRate });
    contextRef.current = { dataContext, marketContext, exchangeRate };

    const previousPricesRef = useRef<Record<string, number>>({});
    const didInitialPricePassRef = useRef(false);

    /** When portfolio data first loads, run one price pass (live if API key present). */
    useEffect(() => {
        const { data } = dataContext ?? {};
        if (!data || !marketContext?.bumpPriceRefresh) return;
        const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const holdings = inv.flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
        const refreshableHoldingSymbols = getRefreshableHoldingQuoteSymbols(
            holdings as { symbol?: string; holdingType?: string; holding_type?: string }[],
        );
        const watch = data?.watchlist ?? [];
        const planned = data?.plannedTrades ?? [];
        const comm = (data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? [];
        const hasSymbols =
            refreshableHoldingSymbols.length > 0 || watch.length > 0 || planned.length > 0 || comm.length > 0;
        if (!hasSymbols || didInitialPricePassRef.current) return;
        didInitialPricePassRef.current = true;
        marketContext.bumpPriceRefresh();
    }, [dataContext?.data, marketContext?.bumpPriceRefresh]);

    useEffect(() => {
        if (!marketContext) return;
        if (marketContext.refreshTrigger === 0) return;
        
        const runSimulationTick = async (isRealFetch: boolean = false) => {
            const { dataContext, marketContext } = contextRef.current;
            if (!dataContext || !marketContext || !dataContext.data) {
                marketContext?.finishQuotesRefresh();
                return;
            }

            const priceScope = marketContext.consumePriceRefreshScope();
            const platformIdOnly = priceScope.kind === 'platform' ? priceScope.platformId : null;
            const scopeIsPlatform = platformIdOnly != null;

            const { data, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices, setIsLive, setLastUpdated, touchQuoteTimestamps } = marketContext;
            const sarPerUsd = resolveSarPerUsd(data, contextRef.current.exchangeRate);

            const allInvestments = ((data as any)?.personalInvestments ?? data?.investments ?? []) as InvestmentPortfolio[];
            const portfoliosInScope = platformIdOnly
                ? allInvestments.filter((p) => p.accountId === platformIdOnly)
                : allInvestments;
            const allHoldings = portfoliosInScope.flatMap((p) => p.holdings ?? []);
            const holdingSymbols = getRefreshableHoldingQuoteSymbols(
                allHoldings as { symbol?: string; holdingType?: string; holding_type?: string }[],
            );
            const allWatchlistItems = scopeIsPlatform ? [] : (data?.watchlist ?? []);
            const allPlannedTrades = scopeIsPlatform ? [] : (data?.plannedTrades ?? []);
            const allCommodities = scopeIsPlatform
                ? []
                : ((data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? []);
            
            const uniqueSymbols = Array.from(new Set([
                ...holdingSymbols,
                ...allWatchlistItems.map((w: { symbol?: string }) => w.symbol).filter((s: string | undefined): s is string => s != null && s !== ''),
                ...allPlannedTrades.map((t: { symbol?: string }) => t.symbol).filter((s: string | undefined): s is string => s != null && s !== '')
            ]));

            const commoditySymbols = (allCommodities as { symbol?: string }[]).map((c: { symbol?: string }) => c.symbol).filter((s: string | undefined): s is string => s != null && s !== '');

            let newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            /** Equity + commodity quotes from cache/API only — never RNG `simulateSymbol` fills (those must not mutate stored `currentValue`). */
            let trustedQuoteSnapshot: Record<string, LiveQuoteRow> = {};
            let liveStatus = false;

            const getInitialPrice = (symbol: string) => {
                if (previousPricesRef.current[symbol]) return previousPricesRef.current[symbol];
                let hash = 0;
                for (let i = 0; i < symbol.length; i++) {
                    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
                }
                const price = (hash % 450) + 50;
                previousPricesRef.current[symbol] = price;
                return price;
            };

            const simulateSymbol = (symbol: string) => {
                const oldPrice = currentSimulatedPrices[symbol]?.price || getInitialPrice(symbol);
                const changePercentRaw = (Math.random() - 0.495) * 0.03;
                const newPrice = Math.max(oldPrice * (1 + changePercentRaw), 0.01);
                const change = newPrice - oldPrice;
                const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                newPrices[symbol] = { price: newPrice, change, changePercent };
            };

            if (isRealFetch) {
                try {
                    let cacheRows = loadQuoteCacheRows();
                    const cacheSim = cacheRowsToSimulatedMap(cacheRows);
                    let mergedEquity: Record<string, LiveQuoteRow> =
                        uniqueSymbols.length > 0
                            ? expandLiveQuotesForRequestedSymbols(
                                  uniqueSymbols,
                                  cacheSim as Record<string, LiveQuoteRow>,
                              )
                            : {};
                    const toFetch = symbolsNeedingLiveFetch(uniqueSymbols, cacheRows);

                    /** Equity and commodities are independent: a thrown/rejected equity batch must not discard commodity quotes. */
                    const equityFetchPromise: Promise<Record<string, LiveQuoteRow>> =
                        uniqueSymbols.length > 0 && toFetch.length > 0
                            ? getLivePrices(toFetch)
                            : Promise.resolve({} as Record<string, LiveQuoteRow>);
                    const commodityFetchPromise =
                        allCommodities.length > 0
                            ? getAICommodityPrices(allCommodities, { sarPerUsd })
                            : Promise.resolve({ prices: [], groundingChunks: [] as unknown[] });

                    const [equitySettled, commoditySettled] = await Promise.allSettled([
                        equityFetchPromise,
                        commodityFetchPromise,
                    ]);

                    let rawApi: Record<string, LiveQuoteRow> = {};
                    if (equitySettled.status === 'fulfilled') {
                        rawApi = equitySettled.value;
                    } else {
                        console.error('Equity live price fetch failed:', equitySettled.reason);
                    }

                    const commodityData =
                        commoditySettled.status === 'fulfilled'
                            ? commoditySettled.value
                            : { prices: [] as { symbol: string; price: number }[], groundingChunks: [] as unknown[] };
                    if (commoditySettled.status === 'rejected') {
                        console.error('Commodity price fetch failed:', commoditySettled.reason);
                    }

                    if (uniqueSymbols.length > 0 && toFetch.length > 0) {
                        const raw = rawApi as Record<string, LiveQuoteRow>;
                        cacheRows = upsertCacheFromLiveQuotes(cacheRows, toFetch, raw);
                        saveQuoteCacheRows(cacheRows);
                        const apiExpanded = expandLiveQuotesForRequestedSymbols(toFetch, raw);
                        mergedEquity = { ...mergedEquity, ...apiExpanded };
                    }

                    newPrices = { ...mergedEquity };

                    commodityData.prices.forEach((cp) => {
                        const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                        const change = cp.price - oldPrice;
                        const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                        newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                    });

                    trustedQuoteSnapshot = { ...newPrices };

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        simulateSymbol(symbol);
                        if (uniqueSymbols.includes(symbol)) anyEquitySimulated = true;
                    }

                    /** Live = equity quotes came from cache or API this pass, not RNG fallback. */
                    liveStatus =
                        uniqueSymbols.length === 0 ||
                        (!anyEquitySimulated &&
                            uniqueSymbols.every((s) => {
                                const r = lookupLiveQuoteForSymbol(newPrices, s);
                                return r != null && r.price > 0;
                            }));
                } catch (error) {
                    console.error('Failed to fetch real prices, falling back to cache then simulation:', error);
                    const cacheRows = loadQuoteCacheRows();
                    const cacheSim = cacheRowsToSimulatedMap(cacheRows);
                    newPrices =
                        uniqueSymbols.length > 0
                            ? expandLiveQuotesForRequestedSymbols(
                                  uniqueSymbols,
                                  cacheSim as Record<string, LiveQuoteRow>,
                              )
                            : {};

                    try {
                        if (allCommodities.length > 0) {
                            const commodityData = await getAICommodityPrices(allCommodities, { sarPerUsd });
                            commodityData.prices.forEach((cp) => {
                                const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                                const change = cp.price - oldPrice;
                                const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                                newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                            });
                        }
                    } catch (commodityErr) {
                        console.error('Commodity price fetch failed during fallback:', commodityErr);
                    }

                    trustedQuoteSnapshot = { ...newPrices };

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        simulateSymbol(symbol);
                        if (uniqueSymbols.includes(symbol)) anyEquitySimulated = true;
                    }

                    liveStatus =
                        uniqueSymbols.length === 0 ||
                        (!anyEquitySimulated &&
                            uniqueSymbols.every((s) => {
                                const r = lookupLiveQuoteForSymbol(newPrices, s);
                                return r != null && r.price > 0;
                            }));
                }
            }

            if (Object.keys(newPrices).length === 0 && (uniqueSymbols.length > 0 || commoditySymbols.length > 0)) {
                liveStatus = false;
                trustedQuoteSnapshot = {};
                Array.from(new Set([...uniqueSymbols, ...commoditySymbols])).forEach((symbol) =>
                    simulateSymbol(symbol),
                );
            }

            const holdingUpdates: { id: string, currentValue: number }[] = [];
            const commodityUpdates: { id: string, currentValue: number }[] = [];
            const activeAlertsBySymbol = new Map<string, PriceAlert[]>();
            (data?.priceAlerts ?? []).filter(a => a.status === 'active').forEach(alert => {
                const sym = alert.symbol;
                if (sym == null) return;
                if (!activeAlertsBySymbol.has(sym)) {
                    activeAlertsBySymbol.set(sym, []);
                }
                activeAlertsBySymbol.get(sym)!.push(alert);
            });
            const triggeredAlerts: PriceAlert[] = [];

            const allProcessedSymbols = Object.keys(newPrices);
            allProcessedSymbols.forEach(symbol => {
                const { price: newPrice } = newPrices[symbol];
                const oldPrice = currentSimulatedPrices[symbol]?.price || newPrice;
                
                previousPricesRef.current[symbol] = newPrice;

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
            
            if (scopeIsPlatform) {
                setSimulatedPrices({ ...currentSimulatedPrices, ...newPrices });
            } else {
                setSimulatedPrices(newPrices);
                setIsLive(liveStatus);
            }
            touchQuoteTimestamps(Object.keys(newPrices));
            // Only bump the global "last updated" clock on a full refresh.
            // Platform-scoped refreshes intentionally update a subset of symbols and must not make the header look fresh.
            if (!scopeIsPlatform && liveStatus && setLastUpdated) setLastUpdated(new Date());

            // Persist market value only from trusted (cache/API) quotes. RNG `simulateSymbol` fills must not
            // overwrite `currentValue` — that caused inflated/wrong platform totals when live feeds failed.
            holdingUpdates.push(
                ...buildEquityHoldingValueUpdatesFromTrustedSnapshot(portfoliosInScope, trustedQuoteSnapshot, sarPerUsd),
            );
            commodityUpdates.push(
                ...buildCommodityHoldingValueUpdatesFromTrustedSnapshot(
                    allCommodities as { id?: string; symbol?: string; quantity?: number }[],
                    trustedQuoteSnapshot,
                ),
            );
            
            if (holdingUpdates.length > 0) {
                batchUpdateHoldingValues(holdingUpdates);
            }

            if (commodityUpdates.length > 0) {
                batchUpdateCommodityHoldingValues(commodityUpdates);
            }
            
            if (triggeredAlerts.length > 0) {
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }
        };

        void (async () => {
            try {
                await runSimulationTick(true);
            } catch (e) {
                console.error('MarketSimulator tick failed:', e);
            } finally {
                contextRef.current.marketContext?.finishQuotesRefresh();
            }
        })();

    }, [marketContext?.refreshTrigger]);

    return null;
};

export default MarketSimulator;
