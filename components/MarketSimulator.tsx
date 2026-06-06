import React, { useEffect, useContext, useRef, startTransition } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import type { InvestmentPortfolio, CommodityHolding } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';
import { getAICommodityPrices } from '../services/geminiService';
import { getLivePricesDeduped } from '../services/quoteLiveFetchCoordinator';
import {
    expandLiveQuotesForRequestedSymbols,
    lookupLiveQuoteForSymbol,
    type LiveQuoteRow,
} from '../services/finnhubService';
import {
    cacheRowsToSimulatedMap,
    loadQuoteCacheRows,
    resolveSymbolsToLiveFetch,
    saveQuoteCacheRows,
    upsertCacheFromLiveQuotes,
} from '../services/quotePriceCache';
import { useCanonicalSpotFx } from '../hooks/useCanonicalFinancialMetrics';
import { portfolioBelongsToAccount, resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getRefreshableHoldingQuoteSymbols } from '../services/quoteRefreshSymbols';
import { isTadawulQuoteSymbol } from '../services/marketQuoteRouting';
import { sanitizeLiveQuoteRow } from '../services/tadawulQuoteSanity';
import {
    buildCommodityHoldingValueUpdatesFromTrustedSnapshot,
    buildEquityHoldingValueUpdatesFromTrustedSnapshot,
    filterNoOpHoldingValueUpdates,
} from '../services/marketSimulatorHoldingPersist';
import {
    isQuoteRefreshInCooldown,
    isRateLimitError,
    startQuoteRefreshCooldown,
    setQuoteRefreshCooldownEndListener,
} from '../services/quoteRefreshCooldown';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';
import { computeRestoreCachedQuotesPatch } from '../services/cachedQuoteRestore';

const MAX_LIVE_FETCH_PER_TICK = 15;
const PARTIAL_LIVE_RATIO = 0.8;
const INTER_SCOPE_DELAY_MS = 400;

const applyPricesInBackground = (apply: () => void) => {
    scheduleIdleWork(() => startTransition(apply), 200);
};

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);
    const sarPerUsd = useCanonicalSpotFx();

    const contextRef = useRef({ dataContext, marketContext, sarPerUsd });
    contextRef.current = { dataContext, marketContext, sarPerUsd };

    const previousPricesRef = useRef<Record<string, number>>({});
    const didRestoreCachedHoldingsRef = useRef(false);
    const tickInFlightRef = useRef(false);
    /** Symbols left after per-tick cap — drained via queued refresh scopes. */
    const pendingLiveFetchSymbolsRef = useRef<string[]>([]);

    /** After hydrate, restore persisted quotes into holdings locally — no live API fetch. */
    useEffect(() => {
        const { data, showHydrateBanner, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues } =
            dataContext ?? {};
        if (!data || showHydrateBanner || didRestoreCachedHoldingsRef.current) return;
        didRestoreCachedHoldingsRef.current = true;
        return scheduleIdleWork(() => {
            if (isBackgroundWorkPaused()) return;
            const patch = computeRestoreCachedQuotesPatch(data, sarPerUsd);
            if (!patch.hasCache) return;
            applyPricesInBackground(() => {
                marketContext?.setSimulatedPrices((prev) => {
                    const next = { ...prev };
                    let changed = false;
                    for (const [k, row] of Object.entries(patch.trusted)) {
                        if (!row?.price) continue;
                        const prevRow = prev[k];
                        const mapped = {
                            price: row.price,
                            change: row.change ?? 0,
                            changePercent: row.changePercent ?? 0,
                        };
                        if (
                            !prevRow ||
                            prevRow.price !== mapped.price ||
                            prevRow.change !== mapped.change ||
                            prevRow.changePercent !== mapped.changePercent
                        ) {
                            next[k] = mapped;
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
                if (patch.lastUpdated && marketContext?.setLastUpdated) {
                    marketContext.setLastUpdated(patch.lastUpdated);
                }
                marketContext?.setIsLive(true);
                marketContext?.setQuotesPriceSource('cached');
                marketContext?.touchQuoteTimestamps(Object.keys(patch.trusted));
            });
            if (patch.equityUpdates.length > 0 && batchUpdateHoldingValues) {
                batchUpdateHoldingValues(patch.equityUpdates);
            }
            if (patch.commodityUpdates.length > 0 && batchUpdateCommodityHoldingValues) {
                batchUpdateCommodityHoldingValues(patch.commodityUpdates);
            }
        }, 1500);
    }, [dataContext?.data, dataContext?.showHydrateBanner, sarPerUsd, marketContext]);

    /** Resume pending symbol batches after provider cooldown — manual refresh sessions only. */
    useEffect(() => {
        const bump = marketContext?.bumpPriceRefresh;
        const isManual = marketContext?.isManualRefreshSession;
        if (!bump || !isManual) return;
        setQuoteRefreshCooldownEndListener(() => {
            if (!isManual()) return;
            if (pendingLiveFetchSymbolsRef.current.length === 0) return;
            bump({
                kind: 'symbols',
                symbols: [...pendingLiveFetchSymbolsRef.current],
                forceFetch: true,
                manual: true,
            });
        });
        return () => setQuoteRefreshCooldownEndListener(null);
    }, [marketContext?.bumpPriceRefresh, marketContext?.isManualRefreshSession]);

    useEffect(() => {
        if (!marketContext) return;
        if (marketContext.refreshTrigger === 0) return;
        if (tickInFlightRef.current) return;
        if (isBackgroundWorkPaused()) return;

        const runSimulationTick = async (priceScope: NonNullable<ReturnType<typeof marketContext.consumePriceRefreshScope>>) => {
            const { dataContext, marketContext } = contextRef.current;
            if (
                !dataContext ||
                !marketContext ||
                !dataContext.data ||
                marketContext.isQuoteRefreshCancelled() ||
                isBackgroundWorkPaused()
            ) {
                return;
            }

            const platformIdOnly =
                priceScope.kind === 'platform' ? resolveCanonicalAccountId(priceScope.platformId, dataContext.data.accounts ?? []) : null;
            const scopeIsPlatform = platformIdOnly != null;
            const scopeIsSymbolsOnly = priceScope.kind === 'symbols';
            const forceFetch = priceScope.forceFetch === true;

            const { data, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices, setIsLive, setLastUpdated, touchQuoteTimestamps, setQuotesPriceSource } = marketContext;
            const sarPerUsd = contextRef.current.sarPerUsd;

            const accounts = data.accounts ?? [];
            const allInvestments = ((data as any)?.personalInvestments ?? data?.investments ?? []) as InvestmentPortfolio[];
            const portfoliosInScope = platformIdOnly
                ? allInvestments.filter((p) => portfolioBelongsToAccount(p, { id: platformIdOnly }, accounts))
                : allInvestments;

            let uniqueSymbols: string[];
            let allHoldings: unknown[];
            let allWatchlistItems: { symbol?: string }[];
            let allPlannedTrades: { symbol?: string }[];
            let allCommodities: CommodityHolding[];

            if (scopeIsSymbolsOnly) {
                uniqueSymbols = Array.from(
                    new Set(
                        priceScope.symbols
                            .map((s) => (s || '').trim())
                            .filter(Boolean),
                    ),
                );
                allHoldings = portfoliosInScope.flatMap((p) => p.holdings ?? []);
                allWatchlistItems = [];
                allPlannedTrades = [];
                allCommodities = [];
            } else {
                allHoldings = portfoliosInScope.flatMap((p) => p.holdings ?? []);
                const holdingSymbols = getRefreshableHoldingQuoteSymbols(
                    allHoldings as { symbol?: string; holdingType?: string; holding_type?: string }[],
                );
                allWatchlistItems = scopeIsPlatform ? [] : (data?.watchlist ?? []);
                allPlannedTrades = scopeIsPlatform ? [] : (data?.plannedTrades ?? []);
                allCommodities = scopeIsPlatform
                    ? []
                    : (((data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? []) as CommodityHolding[]);

                uniqueSymbols = Array.from(new Set([
                    ...holdingSymbols,
                    ...allWatchlistItems.map((w) => w.symbol).filter((s): s is string => s != null && s !== ''),
                    ...allPlannedTrades.map((t) => t.symbol).filter((s): s is string => s != null && s !== ''),
                ]));
            }

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

            {
                try {
                    let cacheRows = loadQuoteCacheRows();
                    const cacheSim = cacheRowsToSimulatedMap(cacheRows);
                    const cacheForEquity: Record<string, LiveQuoteRow> = {};
                    for (const [k, row] of Object.entries(cacheSim as Record<string, LiveQuoteRow>)) {
                        if (!row) continue;
                        const safe = isTadawulQuoteSymbol(k) ? sanitizeLiveQuoteRow(k, row) : row;
                        if (safe) cacheForEquity[k] = safe;
                    }
                    let mergedEquity: Record<string, LiveQuoteRow> =
                        uniqueSymbols.length > 0
                            ? expandLiveQuotesForRequestedSymbols(uniqueSymbols, cacheForEquity)
                            : {};
                    const toFetchAll = resolveSymbolsToLiveFetch(uniqueSymbols, cacheRows, { forceFetch });
                    const mergedFetch = Array.from(
                        new Set([...pendingLiveFetchSymbolsRef.current, ...toFetchAll]),
                    );
                    pendingLiveFetchSymbolsRef.current = [];
                    const toFetch = mergedFetch.slice(0, MAX_LIVE_FETCH_PER_TICK);
                    pendingLiveFetchSymbolsRef.current = mergedFetch.slice(MAX_LIVE_FETCH_PER_TICK);
                    const rateLimited = isQuoteRefreshInCooldown();

                    /** Equity and commodities are independent: a thrown/rejected equity batch must not discard commodity quotes. */
                    const equityFetchPromise: Promise<Record<string, LiveQuoteRow>> =
                        uniqueSymbols.length > 0 && toFetch.length > 0 && !rateLimited
                            ? getLivePricesDeduped(toFetch).catch((err) => {
                                  if (isRateLimitError(err)) startQuoteRefreshCooldown();
                                  throw err;
                              })
                            : Promise.resolve({} as Record<string, LiveQuoteRow>);
                    const commodityFetchPromise =
                        !scopeIsSymbolsOnly && allCommodities.length > 0
                            ? getAICommodityPrices(allCommodities, { sarPerUsd })
                            : Promise.resolve({ prices: [], groundingChunks: [] as unknown[] });

                    const [equitySettled, commoditySettled] = await Promise.allSettled([
                        equityFetchPromise,
                        commodityFetchPromise,
                    ]);

                    if (marketContext.isQuoteRefreshCancelled() || isBackgroundWorkPaused()) {
                        return;
                    }

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
                        const sanitizedApi: Record<string, LiveQuoteRow> = {};
                        for (const [k, row] of Object.entries(raw)) {
                            if (!row) continue;
                            const safe = isTadawulQuoteSymbol(k) ? sanitizeLiveQuoteRow(k, row) : row;
                            if (safe) sanitizedApi[k] = safe;
                        }
                        cacheRows = upsertCacheFromLiveQuotes(cacheRows, toFetch, sanitizedApi);
                        saveQuoteCacheRows(cacheRows);
                        const apiExpanded = expandLiveQuotesForRequestedSymbols(toFetch, sanitizedApi);
                        mergedEquity = { ...mergedEquity, ...apiExpanded };
                        if (priceScope.manual === true && Object.keys(sanitizedApi).length > 0) {
                            setQuotesPriceSource('live');
                        }
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
                        if (isTadawulQuoteSymbol(symbol)) continue;
                        simulateSymbol(symbol);
                        if (uniqueSymbols.includes(symbol)) anyEquitySimulated = true;
                    }

                    const liveSymbolCount = uniqueSymbols.filter((s) => {
                        const r = lookupLiveQuoteForSymbol(newPrices, s);
                        return r != null && r.price > 0;
                    }).length;
                    /** Live when most holding symbols have real quotes (watchlist gaps may stay simulated). */
                    liveStatus =
                        uniqueSymbols.length === 0 ||
                        (!anyEquitySimulated &&
                            (liveSymbolCount / uniqueSymbols.length >= PARTIAL_LIVE_RATIO ||
                                liveSymbolCount === uniqueSymbols.length));
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
                        if (isTadawulQuoteSymbol(symbol)) continue;
                        simulateSymbol(symbol);
                        if (uniqueSymbols.includes(symbol)) anyEquitySimulated = true;
                    }

                    const liveSymbolCountFallback = uniqueSymbols.filter((s) => {
                        const r = lookupLiveQuoteForSymbol(newPrices, s);
                        return r != null && r.price > 0;
                    }).length;
                    liveStatus =
                        uniqueSymbols.length === 0 ||
                        (!anyEquitySimulated &&
                            (liveSymbolCountFallback / uniqueSymbols.length >= PARTIAL_LIVE_RATIO ||
                                liveSymbolCountFallback === uniqueSymbols.length));
                }
            }

            if (Object.keys(newPrices).length === 0 && (uniqueSymbols.length > 0 || commoditySymbols.length > 0)) {
                liveStatus = false;
                trustedQuoteSnapshot = {};
                Array.from(new Set([...uniqueSymbols, ...commoditySymbols])).forEach((symbol) => {
                    if (isTadawulQuoteSymbol(symbol)) return;
                    simulateSymbol(symbol);
                });
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
            
            const newKeys = Object.keys(newPrices);
            // Apply quote updates at low priority (idle + transition) to avoid blocking navigation/typing.
            applyPricesInBackground(() => {
                if (marketContext.isQuoteRefreshCancelled()) return;
                if (scopeIsPlatform) {
                    setSimulatedPrices((prev) => {
                        let changed = false;
                        const next = { ...prev };
                        for (const k of newKeys) {
                            const nextRow = newPrices[k];
                            const prevRow = prev[k];
                            if (
                                !prevRow ||
                                prevRow.price !== nextRow.price ||
                                prevRow.change !== nextRow.change ||
                                prevRow.changePercent !== nextRow.changePercent
                            ) {
                                next[k] = nextRow;
                                changed = true;
                            }
                        }
                        return changed ? next : prev;
                    });
                } else {
                    setSimulatedPrices((prev) => {
                        let changed = false;
                        const next = { ...prev };
                        for (const k of newKeys) {
                            const nextRow = newPrices[k];
                            const prevRow = prev[k];
                            if (
                                !prevRow ||
                                prevRow.price !== nextRow.price ||
                                prevRow.change !== nextRow.change ||
                                prevRow.changePercent !== nextRow.changePercent
                            ) {
                                next[k] = nextRow;
                                changed = true;
                            }
                        }
                        return changed ? next : prev;
                    });
                    setIsLive(liveStatus);
                    // Only bump the global "last updated" clock on a full refresh.
                    // Platform-scoped refreshes intentionally update a subset of symbols and must not make the header look fresh.
                    if (liveStatus && setLastUpdated) setLastUpdated(new Date());
                }
                touchQuoteTimestamps(newKeys);
            });

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
            
            const holdingUpdatesFiltered = filterNoOpHoldingValueUpdates(portfoliosInScope, holdingUpdates);
            if (holdingUpdatesFiltered.length > 0 && !marketContext.isQuoteRefreshCancelled() && !isBackgroundWorkPaused()) {
                await yieldToMain();
                if (marketContext.isQuoteRefreshCancelled() || isBackgroundWorkPaused()) return;
                batchUpdateHoldingValues(holdingUpdatesFiltered);
            }

            const commodityPrevById = new Map(
                (allCommodities as { id?: string; currentValue?: number }[])
                    .filter((c) => c.id)
                    .map((c) => [c.id!, Number(c.currentValue) || 0]),
            );
            const commodityUpdatesFiltered = commodityUpdates.filter((u) => {
                const prev = commodityPrevById.get(u.id);
                return prev == null || Math.abs(prev - u.currentValue) > 0.01;
            });
            if (commodityUpdatesFiltered.length > 0 && !marketContext.isQuoteRefreshCancelled() && !isBackgroundWorkPaused()) {
                batchUpdateCommodityHoldingValues(commodityUpdatesFiltered);
            }
            
            if (triggeredAlerts.length > 0) {
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }

            if (
                pendingLiveFetchSymbolsRef.current.length > 0 &&
                !isQuoteRefreshInCooldown() &&
                !isBackgroundWorkPaused() &&
                marketContext &&
                priceScope.manual === true
            ) {
                const pending = [...pendingLiveFetchSymbolsRef.current];
                pendingLiveFetchSymbolsRef.current = [];
                marketContext.bumpPriceRefresh({ kind: 'symbols', symbols: pending, forceFetch: true, manual: true });
            }
        };

        tickInFlightRef.current = true;
        void (async () => {
            const ctx = contextRef.current.marketContext;
            try {
                while (ctx && !ctx.isQuoteRefreshCancelled()) {
                    if (isBackgroundWorkPaused()) break;
                    const scope = ctx.consumePriceRefreshScope();
                    if (!scope) break;
                    try {
                        await runSimulationTick(scope);
                    } catch (e) {
                        console.error('MarketSimulator tick failed:', e);
                    }
                    if (ctx.isQuoteRefreshCancelled() || isBackgroundWorkPaused()) break;
                    if (ctx.hasQueuedPriceRefresh()) {
                        await new Promise((r) => setTimeout(r, INTER_SCOPE_DELAY_MS));
                    }
                }
            } finally {
                tickInFlightRef.current = false;
                const after = contextRef.current.marketContext;
                if (after?.hasQueuedPriceRefresh()) {
                    after.notifyQueuedPriceRefresh();
                } else {
                    after?.finishQuotesRefresh();
                }
            }
        })();

    }, [marketContext?.refreshTrigger]);

    return null;
};

export default MarketSimulator;
