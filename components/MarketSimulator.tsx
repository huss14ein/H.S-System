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
import { getRefreshableHoldingQuoteSymbols } from '../services/quoteRefreshSymbols';
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
    setQuoteRefreshCooldownEndListener,
} from '../services/quoteRefreshCooldown';
import { isBackgroundWorkPaused, backgroundWorkPauseRemainingMs } from '../utils/backgroundWorkGate';
import { scheduleIdleWork, scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';
import { computeRestoreCachedQuotesPatch, collectTrackedQuoteSymbols, sessionTimestampsForTrackedSymbols } from '../services/cachedQuoteRestore';
import type { CachedQuoteRow } from '../services/quotePriceCache';
import { registerQuoteRefreshKick } from '../utils/quoteRefreshBridge';

const MAX_LIVE_FETCH_PER_TICK = 25;
const PARTIAL_LIVE_RATIO = 0.8;
const INTER_SCOPE_DELAY_MS = 250;
/** During market hours, poll stale quotes via idle work (no header spinner, no nav cancel). */
const MARKET_SESSION_POLL_MS = 5 * 60 * 1000;
const MARKET_SESSION_POLL_INITIAL_MS = 60_000;
/** Clear stuck "Updating…" if pause/retry never drains the queue. */
const STUCK_REFRESH_GUARD_MS = 25_000;

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
    const didRestoreCachedHoldingsRef = useRef(false);
    const tickInFlightRef = useRef(false);
    /** Symbols left after per-tick cap — drained via queued refresh scopes. */
    const pendingLiveFetchSymbolsRef = useRef<string[]>([]);
    const didScheduleStaleRefreshRef = useRef(false);
    const refreshRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRefreshWhileInFlightRef = useRef(false);

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
                const rows = loadQuoteCacheRows();
                const tracked = data ? collectTrackedQuoteSymbols(data) : Object.keys(patch.trusted);
                marketContext?.touchQuoteTimestamps([
                    ...Object.keys(patch.trusted),
                    ...Object.keys(sessionTimestampsForTrackedSymbols(tracked, rows)),
                ]);
            });
            if (patch.equityUpdates.length > 0 && batchUpdateHoldingValues) {
                batchUpdateHoldingValues(patch.equityUpdates);
            }
            if (patch.commodityUpdates.length > 0 && batchUpdateCommodityHoldingValues) {
                batchUpdateCommodityHoldingValues(patch.commodityUpdates);
            }
        }, 1500);
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
            const holdingSymbols = getRefreshableHoldingQuoteSymbols(
                allInvestments.flatMap((p) => p.holdings ?? []) as {
                    symbol?: string;
                    holdingType?: string;
                    holding_type?: string;
                }[],
            );
            if (holdingSymbols.length === 0) {
                didScheduleStaleRefreshRef.current = true;
                return;
            }

            const stale = symbolsNeedingLiveFetch(holdingSymbols, loadQuoteCacheRows());
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

    /** Resume pending symbol batches after provider cooldown — manual refresh sessions only. */
    useEffect(() => {
        const bump = marketContext?.bumpPriceRefresh;
        const isManual = marketContext?.isManualRefreshSession;
        if (!bump || !isManual) return;
        setQuoteRefreshCooldownEndListener(() => {
            if (!isManual()) return;
            const pending = pendingLiveFetchSymbolsRef.current;
            if (pending.length === 0) return;
            pendingLiveFetchSymbolsRef.current = [];
            bump({
                kind: 'symbols',
                symbols: [...pending],
                forceFetch: true,
                manual: true,
            });
        });
        return () => setQuoteRefreshCooldownEndListener(null);
    }, [marketContext?.bumpPriceRefresh, marketContext?.isManualRefreshSession]);

    /** If pause/retry never drains, clear header "Updating…" and re-nudge the queue. */
    useEffect(() => {
        if (!marketContext?.isRefreshing) return;
        const timer = setTimeout(() => {
            const ctx = contextRef.current.marketContext;
            if (!ctx?.isRefreshing || tickInFlightRef.current) return;
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
                    marketContext.notifyQueuedPriceRefresh();
                }
                return;
            }
            if (isBackgroundWorkPaused() && priceScope.manual !== true) {
                await waitUntilBackgroundWorkResumed();
                if (marketContext.isQuoteRefreshCancelled() || isBackgroundWorkPaused()) return;
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
                        if (priceScope.manual === true && Object.keys(sanitizedApi).length > 0) {
                            setQuotesPriceSource('live');
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

                    trustedQuoteSnapshot = { ...newPrices };

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (applyStoredQuoteFallback(symbol, newPrices, cacheRows)) continue;
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
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (applyStoredQuoteFallback(symbol, newPrices, cacheRows)) continue;
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
            
            const newKeys = Object.keys(newPrices);
            const urgentApply = priceScope.manual === true;
            // Apply quote updates — manual refresh paints immediately; background ticks stay low priority.
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
                    if (priceScope.manual === true && Object.keys(trustedQuoteSnapshot).length > 0) {
                        setQuotesPriceSource('live');
                    }
                    if (liveStatus && setLastUpdated) setLastUpdated(new Date());
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
                (!isQuoteRefreshInCooldown() || (priceScope.manual === true && forceFetch)) &&
                (priceScope.manual === true || !isBackgroundWorkPaused()) &&
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
                } else if (pendingSymbols && after?.isManualRefreshSession?.()) {
                    if (!isQuoteRefreshInCooldown()) {
                        const pending = [...pendingLiveFetchSymbolsRef.current];
                        pendingLiveFetchSymbolsRef.current = [];
                        after.bumpPriceRefresh({ kind: 'symbols', symbols: pending, forceFetch: true, manual: true });
                    }
                    // During cooldown: keep isRefreshing + manual session until listener drains pending.
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
