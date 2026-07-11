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
    persistCommodityQuotePrices,
    buildDisplayMapFromCachedRows,
    resolveSymbolsToLiveFetch,
    symbolsNeedingLiveFetch,
} from '../services/quotePriceCache';
import { useCanonicalSpotFx } from '../hooks/useCanonicalFinancialMetrics';
import { portfolioBelongsToAccount, resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getRefreshableHoldingQuoteSymbolsFromPortfolios } from '../services/quoteRefreshSymbols';
import { isTadawulQuoteSymbol } from '../services/marketQuoteRouting';
import { isAnyEquityMarketRegularSessionOpen } from '../services/marketSessionLocal';
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
    subscribeQuoteRefreshCooldownEnd,
} from '../services/quoteRefreshCooldown';
import { isBackgroundWorkPaused, backgroundWorkPauseRemainingMs } from '../utils/backgroundWorkGate';
import { scheduleIdleWork, scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';
import { computeRestoreCachedQuotesPatch, collectTrackedQuoteSymbols, sessionTimestampsForTrackedSymbols, rehydrateSessionPricesFromQuoteCache, latestQuoteCacheTimestamp, symbolTimestampsFromCacheRows } from '../services/cachedQuoteRestore';
import type { CachedQuoteRow } from '../services/quotePriceCache';
import { registerQuoteRefreshKick } from '../utils/quoteRefreshBridge';
import { nextQuotesPriceSourceAfterTick, quotesPriceSourceAfterCacheRehydrate } from '../services/quoteSessionStatus';

const MAX_LIVE_FETCH_PER_TICK = 25;
const PARTIAL_LIVE_RATIO = 0.8;
const INTER_SCOPE_DELAY_MS = 250;
/** During market hours, poll stale quotes via idle work (no header spinner, no nav cancel). */
const MARKET_SESSION_POLL_MS = 5 * 60 * 1000;
const MARKET_SESSION_POLL_INITIAL_MS = 60_000;
/** Clear stuck "Updating…" if pause/retry never drains the queue. */
const STUCK_REFRESH_GUARD_MS = 35_000;
const COMMODITY_FETCH_TIMEOUT_MS = 25_000;

const withFetchTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([
        promise,
        new Promise<T>((resolve) => {
            setTimeout(() => resolve(fallback), ms);
        }),
    ]);

const applyPricesInBackground = (apply: () => void, urgent = false) => {
    if (urgent) {
        startTransition(apply);
        return;
    }
    scheduleIdleWork(() => startTransition(apply), 200);
};

const applyStoredQuoteFallback = (
    symbol: string,
    target: Record<string, { price: number; change: number; changePercent: number }>,
    cacheRows: Record<string, CachedQuoteRow>,
): boolean => {
    const patch = buildDisplayMapFromCachedRows([symbol], cacheRows);
    let applied = false;
    for (const [k, v] of Object.entries(patch)) {
        if (!v?.price || v.price <= 0) continue;
        target[k] = {
            price: v.price,
            change: v.change ?? 0,
            changePercent: v.changePercent ?? 0,
        };
        applied = true;
    }
    return applied || lookupLiveQuoteForSymbol(target, symbol) != null;
};

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);
    const sarPerUsd = useCanonicalSpotFx();

    const contextRef = useRef({ dataContext, marketContext, sarPerUsd });
    contextRef.current = { dataContext, marketContext, sarPerUsd };

    const previousPricesRef = useRef<Record<string, number>>({});
    const didBootstrapSessionCacheRef = useRef(false);
    const didAlignHoldingsFromCacheRef = useRef(false);
    const tickInFlightRef = useRef(false);
    /** Symbols left after per-tick cap — drained via queued refresh scopes. */
    const pendingLiveFetchSymbolsRef = useRef<string[]>([]);
    const didScheduleStaleRefreshRef = useRef(false);
    const refreshRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRefreshWhileInFlightRef = useRef(false);

    /** Restore cached quotes into session immediately — no Supabase hydrate required. */
    useEffect(() => {
        const marketContext = contextRef.current.marketContext;
        if (!marketContext || didBootstrapSessionCacheRef.current) return;
        const rows = loadQuoteCacheRows();
        if (Object.keys(rows).length === 0) return;
        didBootstrapSessionCacheRef.current = true;
        return scheduleIdleWork(() => {
            marketContext.setSimulatedPrices((prev) => {
                const { prices, changed } = rehydrateSessionPricesFromQuoteCache(prev, rows);
                return changed ? prices : prev;
            });
            const ts = latestQuoteCacheTimestamp(rows);
            if (ts) marketContext.setLastUpdated(ts);
            marketContext.setQuotesPriceSource((prev) => quotesPriceSourceAfterCacheRehydrate(prev));
            marketContext.mergeSymbolQuoteTimestamps(symbolTimestampsFromCacheRows(rows));
        }, 0);
    }, [marketContext]);

    /** After hydrate, align holding marks with persisted quotes — no live API fetch. */
    useEffect(() => {
        const { data, showHydrateBanner, batchUpdateCommodityHoldingValues } = dataContext ?? {};
        if (!data || showHydrateBanner || didAlignHoldingsFromCacheRef.current) return;

        let cancelled = false;
        const cancelIdle = scheduleIdleWorkAsync(async () => {
            await waitUntilBackgroundWorkResumed();
            if (cancelled || didAlignHoldingsFromCacheRef.current) return;
            const patch = computeRestoreCachedQuotesPatch(data, sarPerUsd);
            if (!patch.hasCache) {
                didAlignHoldingsFromCacheRef.current = true;
                return;
            }
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
                const rows = loadQuoteCacheRows();
                const tracked = data ? collectTrackedQuoteSymbols(data) : Object.keys(patch.trusted);
                marketContext?.mergeSymbolQuoteTimestamps(sessionTimestampsForTrackedSymbols(tracked, rows));
            });
            // Holding notionals are updated only from manual/live sync ticks — not cache hydrate
            // (avoids stale Tadawul cache overwriting fresh SAHMK quotes).
            if (patch.commodityUpdates.length > 0 && batchUpdateCommodityHoldingValues) {
                batchUpdateCommodityHoldingValues(patch.commodityUpdates);
            }
            didAlignHoldingsFromCacheRef.current = true;
        }, 1500);

        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [dataContext?.data, dataContext?.showHydrateBanner, sarPerUsd, marketContext]);

    /** One-shot after hydrate: refresh symbols with stale/missing cache (no interval polling). */
    useEffect(() => {
        const { data, showHydrateBanner } = dataContext ?? {};
        if (!data || showHydrateBanner || !marketContext?.bumpPriceRefresh) return;
        if (didScheduleStaleRefreshRef.current) return;

        let cancelled = false;
        const cancelIdle = scheduleIdleWorkAsync(async () => {
            await waitUntilBackgroundWorkResumed();
            if (cancelled || didScheduleStaleRefreshRef.current) return;

            const allInvestments = ((data as { personalInvestments?: InvestmentPortfolio[] }).personalInvestments ??
                data.investments ??
                []) as InvestmentPortfolio[];
            const holdingSymbols = getRefreshableHoldingQuoteSymbolsFromPortfolios(allInvestments);
            const watchSymbols = (data.watchlist ?? [])
                .map((w) => w.symbol)
                .filter((s): s is string => Boolean(s));
            const symbolsToCheck = Array.from(new Set([...holdingSymbols, ...watchSymbols]));
            if (symbolsToCheck.length === 0) {
                didScheduleStaleRefreshRef.current = true;
                return;
            }

            const stale = symbolsNeedingLiveFetch(symbolsToCheck, loadQuoteCacheRows());
            if (stale.length === 0) {
                didScheduleStaleRefreshRef.current = true;
                return;
            }

            didScheduleStaleRefreshRef.current = true;
            marketContext.bumpPriceRefresh({
                kind: 'symbols',
                symbols: stale,
                manual: true,
                forceFetch: true,
                silent: true,
            });
        }, 2500);

        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [dataContext?.data, dataContext?.showHydrateBanner, marketContext?.bumpPriceRefresh]);

    /** Market-hours session poll — stale symbols only, idle-scheduled, skipped while tab hidden or nav paused. */
    useEffect(() => {
        const { data, showHydrateBanner } = dataContext ?? {};
        const bump = marketContext?.bumpPriceRefresh;
        if (!data || showHydrateBanner || !bump) return;

        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | undefined;

        const poll = () => {
            if (cancelled || isBackgroundWorkPaused()) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            if (!isAnyEquityMarketRegularSessionOpen()) return;
            bump({ kind: 'all', manual: true, forceFetch: false, silent: true });
        };

        const schedulePoll = () => scheduleIdleWorkAsync(() => poll(), 0);

        const initialTimer = setTimeout(() => {
            void schedulePoll();
            interval = setInterval(() => {
                void schedulePoll();
            }, MARKET_SESSION_POLL_MS);
        }, MARKET_SESSION_POLL_INITIAL_MS);

        return () => {
            cancelled = true;
            clearTimeout(initialTimer);
            if (interval) clearInterval(interval);
        };
    }, [dataContext?.data, dataContext?.showHydrateBanner, marketContext?.bumpPriceRefresh]);

    /** Resume pending symbol batches after provider cooldown (manual or silent overflow). */
    useEffect(() => {
        const bump = marketContext?.bumpPriceRefresh;
        if (!bump) return;
        return subscribeQuoteRefreshCooldownEnd(() => {
            const pending = pendingLiveFetchSymbolsRef.current;
            if (pending.length === 0) return;
            pendingLiveFetchSymbolsRef.current = [];
            bump({
                kind: 'symbols',
                symbols: [...pending],
                forceFetch: true,
                manual: true,
                silent: true,
            });
        });
    }, [marketContext?.bumpPriceRefresh]);

    /** If pause/retry never drains, clear header "Updating…" and re-nudge the queue. */
    useEffect(() => {
        if (!marketContext?.isRefreshing) return;
        const timer = setTimeout(() => {
            const ctx = contextRef.current.marketContext;
            if (!ctx?.isRefreshing) return;
            if (tickInFlightRef.current) return;
            if (ctx.hasQueuedPriceRefresh() || pendingLiveFetchSymbolsRef.current.length > 0) {
                ctx.notifyQueuedPriceRefresh();
            } else {
                ctx.finishQuotesRefresh();
            }
        }, STUCK_REFRESH_GUARD_MS);
        return () => clearTimeout(timer);
    }, [marketContext?.isRefreshing]);

    useEffect(() => {
        if (!marketContext) return;
        if (marketContext.refreshTrigger === 0) return;

        const scheduleRefreshRetry = () => {
            if (refreshRetryTimerRef.current) clearTimeout(refreshRetryTimerRef.current);
            const waitMs = Math.min(Math.max(backgroundWorkPauseRemainingMs(), 32), 500);
            refreshRetryTimerRef.current = setTimeout(() => {
                refreshRetryTimerRef.current = null;
                void waitUntilBackgroundWorkResumed().then(() => {
                    marketContext.notifyQueuedPriceRefresh();
                });
            }, waitMs);
        };

        if (tickInFlightRef.current) {
            pendingRefreshWhileInFlightRef.current = true;
            return;
        }
        const manualKick = marketContext.isManualRefreshSession?.() === true;
        if (isBackgroundWorkPaused() && !manualKick) {
            scheduleRefreshRetry();
            return;
        }

        const runSimulationTick = async (priceScope: NonNullable<ReturnType<typeof marketContext.consumePriceRefreshScope>>) => {
            const { dataContext, marketContext } = contextRef.current;
            if (
                !dataContext ||
                !marketContext ||
                marketContext.isQuoteRefreshCancelled()
            ) {
                return;
            }
            if (!dataContext.data) {
                if (priceScope.manual === true) {
                    marketContext.bumpPriceRefresh(priceScope);
                }
                return;
            }
            if (isBackgroundWorkPaused() && priceScope.manual !== true) {
                await waitUntilBackgroundWorkResumed();
                if (marketContext.isQuoteRefreshCancelled() || isBackgroundWorkPaused()) return;
            }

            const platformIdOnly =
                priceScope.kind === 'platform' ? resolveCanonicalAccountId(priceScope.platformId, dataContext.data.accounts ?? []) : null;
            const portfolioIdOnly =
                priceScope.kind === 'portfolio' ? priceScope.portfolioId.trim() : '';
            const scopeIsPlatform = platformIdOnly != null;
            const scopeIsPortfolio = portfolioIdOnly.length > 0;
            const scopeIsNarrow = scopeIsPlatform || scopeIsPortfolio;
            const scopeIsSymbolsOnly = priceScope.kind === 'symbols';
            const forceFetch = priceScope.forceFetch === true;

            const { data, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices, setIsLive, setLastUpdated, touchQuoteTimestamps, mergeSymbolQuoteTimestamps, setQuotesPriceSource } = marketContext;
            const sarPerUsd = contextRef.current.sarPerUsd;

            const accounts = data.accounts ?? [];
            const allInvestments = ((data as any)?.personalInvestments ?? data?.investments ?? []) as InvestmentPortfolio[];
            const portfoliosInScope = portfolioIdOnly
                ? allInvestments.filter((p) => p.id === portfolioIdOnly)
                : platformIdOnly
                  ? allInvestments.filter((p) => portfolioBelongsToAccount(p, { id: platformIdOnly }, accounts))
                  : allInvestments;

            let uniqueSymbols: string[];
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
                allWatchlistItems = [];
                allPlannedTrades = [];
                allCommodities = [];
            } else {
                const holdingSymbols = getRefreshableHoldingQuoteSymbolsFromPortfolios(portfoliosInScope);
                allWatchlistItems = scopeIsNarrow ? [] : (data?.watchlist ?? []);
                allPlannedTrades = scopeIsNarrow ? [] : (data?.plannedTrades ?? []);
                allCommodities = scopeIsNarrow
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
            let networkFetchedThisTick = false;

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
                    let mergedEquity: Record<string, LiveQuoteRow> = {};
                    const skipCacheSeed = forceFetch && priceScope.manual === true;
                    if (!skipCacheSeed && uniqueSymbols.length > 0) {
                        mergedEquity = expandLiveQuotesForRequestedSymbols(uniqueSymbols, cacheForEquity);
                    }
                    const toFetchAll = resolveSymbolsToLiveFetch(uniqueSymbols, cacheRows, { forceFetch });
                    const mergedFetch = Array.from(
                        new Set([...pendingLiveFetchSymbolsRef.current, ...toFetchAll]),
                    );
                    pendingLiveFetchSymbolsRef.current = [];
                    const toFetch = mergedFetch.slice(0, MAX_LIVE_FETCH_PER_TICK);
                    pendingLiveFetchSymbolsRef.current = mergedFetch.slice(MAX_LIVE_FETCH_PER_TICK);
                    const rateLimited =
                        isQuoteRefreshInCooldown() && !(priceScope.manual === true && forceFetch);
                    if (rateLimited && forceFetch && toFetch.length > 0) {
                        pendingLiveFetchSymbolsRef.current = Array.from(
                            new Set([...pendingLiveFetchSymbolsRef.current, ...toFetch]),
                        );
                    }

                    /** Equity and commodities are independent: a thrown/rejected equity batch must not discard commodity quotes. */
                    const equityFetchPromise: Promise<Record<string, LiveQuoteRow>> =
                        uniqueSymbols.length > 0 && toFetch.length > 0 && !rateLimited
                            ? getLivePricesDeduped(toFetch, { forceFetch }).catch((err) => {
                                  if (isRateLimitError(err)) startQuoteRefreshCooldown();
                                  throw err;
                              })
                            : Promise.resolve({} as Record<string, LiveQuoteRow>);
                    const commodityFetchPromise =
                        !scopeIsSymbolsOnly && allCommodities.length > 0
                            ? withFetchTimeout(
                                  getAICommodityPrices(allCommodities, { sarPerUsd }),
                                  COMMODITY_FETCH_TIMEOUT_MS,
                                  { prices: [], groundingChunks: [] as unknown[] },
                              )
                            : Promise.resolve({ prices: [], groundingChunks: [] as unknown[] });

                    const [equitySettled, commoditySettled] = await Promise.allSettled([
                        equityFetchPromise,
                        commodityFetchPromise,
                    ]);

                    if (marketContext.isQuoteRefreshCancelled()) return;
                    const manualScope = priceScope.manual === true;
                    if (!manualScope && isBackgroundWorkPaused()) return;

                    let rawApi: Record<string, LiveQuoteRow> = {};
                    if (equitySettled.status === 'fulfilled') {
                        rawApi = equitySettled.value;
                        cacheRows = loadQuoteCacheRows();
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
                        const sanitizedApi = rawApi as Record<string, LiveQuoteRow>;
                        const apiExpanded = expandLiveQuotesForRequestedSymbols(toFetch, sanitizedApi);
                        mergedEquity = { ...mergedEquity, ...apiExpanded };
                        if (Object.keys(sanitizedApi).length > 0) {
                            networkFetchedThisTick = true;
                        }
                    }

                    newPrices = { ...mergedEquity };

                    if (commodityData.prices.length > 0) {
                        cacheRows = persistCommodityQuotePrices(cacheRows, commodityData.prices);
                    }
                    commodityData.prices.forEach((cp) => {
                        const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                        const change = cp.price - oldPrice;
                        const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                        newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                    });
                    if (commodityData.prices.length > 0) {
                        networkFetchedThisTick = true;
                    }

                    trustedQuoteSnapshot = { ...newPrices };

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    const allowCacheFallback = !(forceFetch && priceScope.manual === true);
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (allowCacheFallback && applyStoredQuoteFallback(symbol, newPrices, cacheRows)) continue;
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
                    let cacheRows = loadQuoteCacheRows();
                    newPrices = {};
                    for (const [k, v] of Object.entries(buildDisplayMapFromCachedRows(uniqueSymbols, cacheRows))) {
                        if (!v?.price || v.price <= 0) continue;
                        newPrices[k] = {
                            price: v.price,
                            change: v.change ?? 0,
                            changePercent: v.changePercent ?? 0,
                        };
                    }

                    try {
                        if (allCommodities.length > 0) {
                            const commodityData = await getAICommodityPrices(allCommodities, { sarPerUsd });
                            if (commodityData.prices.length > 0) {
                                cacheRows = persistCommodityQuotePrices(cacheRows, commodityData.prices);
                            }
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
                    const allowCacheFallback = !(forceFetch && priceScope.manual === true);
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (allowCacheFallback && applyStoredQuoteFallback(symbol, newPrices, cacheRows)) continue;
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
                const cacheRows = loadQuoteCacheRows();
                const fromCache = buildDisplayMapFromCachedRows(
                    Array.from(new Set([...uniqueSymbols, ...commoditySymbols])),
                    cacheRows,
                );
                for (const [k, v] of Object.entries(fromCache)) {
                    if (!v?.price || v.price <= 0) continue;
                    newPrices[k] = {
                        price: v.price,
                        change: v.change ?? 0,
                        changePercent: v.changePercent ?? 0,
                    };
                }
                trustedQuoteSnapshot = { ...newPrices };
                liveStatus = Object.keys(fromCache).length > 0;
                if (!liveStatus) {
                    Array.from(new Set([...uniqueSymbols, ...commoditySymbols])).forEach((symbol) => {
                        if (applyStoredQuoteFallback(symbol, newPrices, cacheRows)) return;
                        if (isTadawulQuoteSymbol(symbol)) return;
                        simulateSymbol(symbol);
                    });
                }
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
            
            const applySessionQuoteSource = () => {
                const hasTrustedQuotes =
                    Object.keys(trustedQuoteSnapshot).length > 0 || Object.keys(newPrices).length > 0;
                if (networkFetchedThisTick) {
                    if (!scopeIsNarrow || priceScope.manual === true) {
                        setQuotesPriceSource('live');
                        setIsLive(true);
                    }
                    return;
                }
                if (scopeIsNarrow) return;
                setQuotesPriceSource((prev) =>
                    nextQuotesPriceSourceAfterTick(prev, false, hasTrustedQuotes),
                );
            };

            const newKeys = Object.keys(newPrices);
            const urgentApply = priceScope.manual === true;
            const applyQuoteTimestamps = () => {
                if (networkFetchedThisTick) {
                    touchQuoteTimestamps(newKeys);
                    return;
                }
                const cachedTs = sessionTimestampsForTrackedSymbols(newKeys, loadQuoteCacheRows());
                if (Object.keys(cachedTs).length > 0) mergeSymbolQuoteTimestamps(cachedTs);
            };
            const applyGlobalLastUpdated = () => {
                if (!setLastUpdated || scopeIsNarrow) return;
                if (networkFetchedThisTick) {
                    setLastUpdated(new Date());
                    return;
                }
                if (liveStatus) {
                    const cacheTs = latestQuoteCacheTimestamp(loadQuoteCacheRows());
                    if (cacheTs) setLastUpdated(cacheTs);
                }
            };
            // Apply quote updates — manual refresh paints immediately; background ticks stay low priority.
            applyPricesInBackground(() => {
                if (marketContext.isQuoteRefreshCancelled()) return;
                if (scopeIsNarrow) {
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
                    if (
                        networkFetchedThisTick ||
                        (priceScope.manual === true && Object.keys(trustedQuoteSnapshot).length > 0)
                    ) {
                        applySessionQuoteSource();
                    }
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
                    applySessionQuoteSource();
                    applyGlobalLastUpdated();
                }
                applyQuoteTimestamps();
            }, urgentApply);

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
            const allowHoldingPersist = (manual: boolean) =>
                !marketContext.isQuoteRefreshCancelled() && (manual || !isBackgroundWorkPaused());
            if (holdingUpdatesFiltered.length > 0 && allowHoldingPersist(priceScope.manual === true)) {
                await yieldToMain();
                if (!allowHoldingPersist(priceScope.manual === true)) return;
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
            if (commodityUpdatesFiltered.length > 0 && allowHoldingPersist(priceScope.manual === true)) {
                batchUpdateCommodityHoldingValues(commodityUpdatesFiltered);
            }
            
            if (triggeredAlerts.length > 0) {
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }

            if (
                pendingLiveFetchSymbolsRef.current.length > 0 &&
                !isQuoteRefreshInCooldown() &&
                marketContext &&
                priceScope.manual === true
            ) {
                const pending = [...pendingLiveFetchSymbolsRef.current];
                pendingLiveFetchSymbolsRef.current = [];
                marketContext.bumpPriceRefresh({ kind: 'symbols', symbols: pending, forceFetch: true, manual: true, silent: true });
            }
        };

        tickInFlightRef.current = true;
        void (async () => {
            const ctx = contextRef.current.marketContext;
            try {
                if (!ctx?.isManualRefreshSession?.()) {
                    await waitUntilBackgroundWorkResumed();
                }
                while (ctx && !ctx.isQuoteRefreshCancelled()) {
                    if (isBackgroundWorkPaused() && !ctx.isManualRefreshSession?.()) {
                        await waitUntilBackgroundWorkResumed();
                        if (ctx.isQuoteRefreshCancelled()) break;
                    }
                    const scope = ctx.consumePriceRefreshScope();
                    if (!scope) break;
                    try {
                        await runSimulationTick(scope);
                    } catch (e) {
                        console.error('MarketSimulator tick failed:', e);
                    }
                    if (ctx.isQuoteRefreshCancelled()) break;
                    if (isBackgroundWorkPaused() && !ctx.isManualRefreshSession?.()) break;
                    if (ctx.hasQueuedPriceRefresh()) {
                        await new Promise((r) => setTimeout(r, INTER_SCOPE_DELAY_MS));
                    }
                }
            } finally {
                tickInFlightRef.current = false;
                const after = contextRef.current.marketContext;
                const pendingSymbols = pendingLiveFetchSymbolsRef.current.length > 0;
                if (after?.hasQueuedPriceRefresh()) {
                    after.notifyQueuedPriceRefresh();
                } else if (pendingSymbols && after) {
                    if (!isQuoteRefreshInCooldown()) {
                        const pending = [...pendingLiveFetchSymbolsRef.current];
                        pendingLiveFetchSymbolsRef.current = [];
                        after.bumpPriceRefresh({ kind: 'symbols', symbols: pending, forceFetch: true, manual: true, silent: true });
                    }
                } else {
                    after?.finishQuotesRefresh();
                }
                if (pendingRefreshWhileInFlightRef.current) {
                    pendingRefreshWhileInFlightRef.current = false;
                    after?.notifyQueuedPriceRefresh();
                }
            }
        })();

        return () => {
            if (refreshRetryTimerRef.current) {
                clearTimeout(refreshRetryTimerRef.current);
                refreshRetryTimerRef.current = null;
            }
        };

    }, [marketContext?.refreshTrigger]);

    useEffect(() => {
        const kick = () => {
            const ctx = contextRef.current.marketContext;
            if (!ctx) return;
            if (tickInFlightRef.current) {
                pendingRefreshWhileInFlightRef.current = true;
                return;
            }
            ctx.notifyQueuedPriceRefresh();
        };
        registerQuoteRefreshKick(kick);
        return () => registerQuoteRefreshKick(null);
    }, []);

    return null;
};

export default MarketSimulator;
