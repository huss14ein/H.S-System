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
    buildDisplayMapFromCachedRows,
    resolveSymbolsToLiveFetch,
    saveQuoteCacheRows,
} from '../services/quotePriceCache';
import { useCanonicalSpotFx } from '../hooks/useCanonicalFinancialMetrics';
import { portfolioBelongsToAccount, resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getRefreshableHoldingQuoteSymbolsFromPortfolios } from '../services/quoteRefreshSymbols';
import { isTadawulQuoteSymbol } from '../services/marketQuoteRouting';
import { sanitizeLiveQuoteRow } from '../services/tadawulQuoteSanity';
import {
    buildCommodityHoldingValueUpdatesFromTrustedSnapshot,
    buildEquityHoldingValueUpdatesFromTrustedSnapshot,
    filterNoOpHoldingValueUpdates,
    type HoldingMarketValueUpdate,
} from '../services/marketSimulatorHoldingPersist';
import {
    isQuoteRefreshInCooldown,
    isRateLimitError,
    startQuoteRefreshCooldown,
    subscribeQuoteRefreshCooldownEnd,
    SAHMK_RATE_LIMIT_COOLDOWN_MS,
} from '../services/quoteRefreshCooldown';
import { consumeSahmkBatchDeferredSymbols, SAHMK_MAX_CODES_PER_BATCH } from '../services/sahmkQuote';
import { isBackgroundWorkPaused, backgroundWorkPauseRemainingMs } from '../utils/backgroundWorkGate';
import { scheduleIdleWork, scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';
import { computeRestoreCachedQuotesPatch, collectTrackedQuoteSymbols, sessionTimestampsForTrackedSymbols, rehydrateSessionPricesFromQuoteCache, latestQuoteCacheTimestamp, symbolTimestampsFromCacheRows } from '../services/cachedQuoteRestore';
import type { CachedQuoteRow } from '../services/quotePriceCache';
import {
    buildQuoteCacheRowsFromPersistedHoldingPrices,
    seedQuoteCacheFromPersistedHoldingPrices,
} from '../services/persistedHoldingQuoteSeed';
import {
    seedQuoteCacheFromMarketQuoteDb,
    upsertMarketQuotesToDb,
} from '../services/marketQuoteDbCache';
import { getPersonalInvestments } from '../utils/wealthScope';
import { registerQuoteRefreshKick, registerClearPendingLiveFetch } from '../utils/quoteRefreshBridge';
import { nextQuotesPriceSourceAfterTick, quotesPriceSourceAfterCacheRehydrate } from '../services/quoteSessionStatus';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import { applyManualCommodityQuotes } from '../services/applyManualCommodityQuotes';

/** Cap per tick for US / mixed books — large books continue via queued scopes after a *manual* refresh. */
const MAX_LIVE_FETCH_PER_TICK = 12;
const PARTIAL_LIVE_RATIO = 0.8;
/** Delay between queued scopes; manual drains stay tight so Tadawul batches don't idle. */
const INTER_SCOPE_DELAY_MS = 250;
const MANUAL_INTER_SCOPE_DELAY_MS = 40;
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
    const auth = useContext(AuthContext);
    const sarPerUsd = useCanonicalSpotFx();

    const contextRef = useRef({ dataContext, marketContext, sarPerUsd, auth });
    contextRef.current = { dataContext, marketContext, sarPerUsd, auth };

    const previousPricesRef = useRef<Record<string, number>>({});
    const didBootstrapSessionCacheRef = useRef(false);
    const didAlignHoldingsFromCacheRef = useRef(false);
    /** User id used for the last market_quote_cache seed — null means local-only (retry when auth ready). */
    const lastQuoteDbSeedUserIdRef = useRef<string | null>(null);
    const tickInFlightRef = useRef(false);
    /** Symbols left after per-tick cap — drained via queued refresh scopes (manual refresh only). */
    const pendingLiveFetchSymbolsRef = useRef<string[]>([]);
    const refreshRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRefreshWhileInFlightRef = useRef(false);
    /** Serialize holding persists without blocking the next quote batch. */
    const holdingPersistChainRef = useRef(Promise.resolve());

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

    /** After hydrate, restore quotes from DB + local cache — never auto-hit live APIs. */
    useEffect(() => {
        const { data, showHydrateBanner } = dataContext ?? {};
        const authUserId = auth?.user?.id ?? null;
        if (!data || showHydrateBanner) return;
        // Re-run when auth becomes ready so market_quote_cache can merge (local-only seed must not lock out DB).
        if (
            didAlignHoldingsFromCacheRef.current &&
            lastQuoteDbSeedUserIdRef.current === authUserId
        ) {
            return;
        }

        let cancelled = false;
        const cancelIdle = scheduleIdleWorkAsync(async () => {
            await waitUntilBackgroundWorkResumed();
            if (cancelled) return;
            if (
                didAlignHoldingsFromCacheRef.current &&
                lastQuoteDbSeedUserIdRef.current === (contextRef.current.auth?.user?.id ?? null)
            ) {
                return;
            }
            // 1) Holdings.current_price from Supabase → localStorage
            let rows = seedQuoteCacheFromPersistedHoldingPrices(getPersonalInvestments(data)).rows;
            // 2) market_quote_cache (watchlist / prior manual syncs) → localStorage
            const userId = contextRef.current.auth?.user?.id ?? null;
            if (supabase && userId) {
                const fromDb = await seedQuoteCacheFromMarketQuoteDb(supabase as any, userId);
                if (!cancelled && fromDb.changed) rows = fromDb.rows;
            }
            if (cancelled) return;
            const patch = computeRestoreCachedQuotesPatch(data, sarPerUsd, rows);
            if (!patch.hasCache) {
                didAlignHoldingsFromCacheRef.current = true;
                lastQuoteDbSeedUserIdRef.current = userId;
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
                const tracked = data ? collectTrackedQuoteSymbols(data) : Object.keys(patch.trusted);
                marketContext?.mergeSymbolQuoteTimestamps(sessionTimestampsForTrackedSymbols(tracked, rows));
            });
            // Holding notionals are updated only from manual live sync ticks — not cache hydrate.
            // Session simulatedPrices (above) is enough for canonical KPI read of commodities.
            didAlignHoldingsFromCacheRef.current = true;
            lastQuoteDbSeedUserIdRef.current = userId;
        }, 1500);

        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [dataContext?.data, dataContext?.showHydrateBanner, sarPerUsd, marketContext, auth?.user?.id]);

    /** Resume pending symbol batches after provider cooldown (continuation of a *manual* refresh). */
    useEffect(() => {
        const bump = marketContext?.bumpPriceRefresh;
        if (!bump) return;
        return subscribeQuoteRefreshCooldownEnd(() => {
            const ctx = contextRef.current.marketContext;
            if (!ctx || ctx.isQuoteRefreshCancelled()) {
                pendingLiveFetchSymbolsRef.current = [];
                return;
            }
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
            /** Original provider/cache retrieval time per symbol (stale cache must retain its age). */
            let trustedQuoteUpdatedAt: Record<string, string | undefined> = {};
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
                    await yieldToMain(0);
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
                    // Tadawul-only books: align outer slice with SAHMK batch cap (avoid fetching 12 then
                    // re-queuing 4–7 that SAHMK already deferred).
                    const tadawulOnly =
                        mergedFetch.length > 0 && mergedFetch.every((s) => isTadawulQuoteSymbol(s));
                    const tickCap = tadawulOnly ? SAHMK_MAX_CODES_PER_BATCH : MAX_LIVE_FETCH_PER_TICK;
                    const toFetch = mergedFetch.slice(0, tickCap);
                    pendingLiveFetchSymbolsRef.current = mergedFetch.slice(tickCap);
                    // Finnhub/generic cooldown blocks the whole equity batch; SAHMK cooldown must not.
                    const rateLimited = isQuoteRefreshInCooldown('default');
                    const sahmkCooling = isQuoteRefreshInCooldown('sahmk');
                    if (rateLimited && toFetch.length > 0) {
                        pendingLiveFetchSymbolsRef.current = Array.from(
                            new Set([...pendingLiveFetchSymbolsRef.current, ...toFetch]),
                        );
                    } else if (sahmkCooling && toFetch.length > 0) {
                        // Keep Tadawul symbols queued while SAHMK alone is cooling — US providers still run.
                        const tadawulPending = toFetch.filter((s) => isTadawulQuoteSymbol(s));
                        if (tadawulPending.length > 0) {
                            pendingLiveFetchSymbolsRef.current = Array.from(
                                new Set([...pendingLiveFetchSymbolsRef.current, ...tadawulPending]),
                            );
                        }
                    }
                    const isManualForceFetch = forceFetch && priceScope.manual === true;
                    // Manual Sync must never invent RNG prices.
                    const allowSimulate = !isManualForceFetch;

                    /** Equity and commodities are independent: a thrown/rejected equity batch must not discard commodity quotes. */
                    const equityFetchPromise: Promise<Record<string, LiveQuoteRow>> =
                        uniqueSymbols.length > 0 && toFetch.length > 0 && !rateLimited
                            ? getLivePricesDeduped(toFetch, { forceFetch }).catch((err) => {
                                  if (isRateLimitError(err)) {
                                      const msg = err instanceof Error ? err.message : String(err ?? '');
                                      if (/SAHMK/i.test(msg)) {
                                          startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk');
                                      } else {
                                          startQuoteRefreshCooldown(45_000, 'default');
                                      }
                                  }
                                  throw err;
                              })
                            : Promise.resolve({} as Record<string, LiveQuoteRow>);
                    const skipCommodityForRateLimit = rateLimited && priceScope.silent === true;
                    const commodityFetchPromise =
                        !scopeIsSymbolsOnly && allCommodities.length > 0 && !skipCommodityForRateLimit
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
                    } else if (!isRateLimitError(equitySettled.reason)) {
                        console.error('Equity live price fetch failed:', equitySettled.reason);
                    } else {
                        console.warn('Equity live price fetch rate-limited — using cache');
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
                            // Durable DB cache — survives cleared localStorage / new device (manual fetch only).
                            void upsertMarketQuotesToDb(supabase as any, sanitizedApi);
                        }
                        // SAHMK batch cap / mid-batch 429 — requeue omitted Tadawul symbols for a later tick.
                        const deferredSahmk = consumeSahmkBatchDeferredSymbols();
                        if (deferredSahmk.length > 0) {
                            pendingLiveFetchSymbolsRef.current = Array.from(
                                new Set([...pendingLiveFetchSymbolsRef.current, ...deferredSahmk]),
                            );
                        }
                    }

                    newPrices = { ...mergedEquity };

                    if (commodityData.prices.length > 0) {
                        cacheRows = applyManualCommodityQuotes({
                            prices: commodityData.prices,
                            priorCacheRows: cacheRows,
                            db: supabase as any,
                            // Session map is applied via newPrices below (same tick).
                        });
                        for (const cp of commodityData.prices) {
                            if (!cp?.symbol || !(Number(cp.price) > 0)) continue;
                            const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                            const change = cp.price - oldPrice;
                            const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                            newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                        }
                        networkFetchedThisTick = true;
                    }

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    /**
                     * Manual force skips *pre-fetch* cache seed so every symbol is attempted live.
                     * After the live attempt, always fill misses from cache (+ DB-seeded rows) so
                     * holdings do not stick on the "Stored" badge when a last trusted quote exists.
                     */
                    {
                        const holdingSeed = buildQuoteCacheRowsFromPersistedHoldingPrices(
                            portfoliosInScope,
                            cacheRows,
                        );
                        if (holdingSeed.changed) {
                            cacheRows = holdingSeed.rows;
                            saveQuoteCacheRows(cacheRows);
                        }
                    }
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        applyStoredQuoteFallback(symbol, newPrices, cacheRows);
                    }

                    // Trusted marks = network/cache only (before RNG simulation fills).
                    trustedQuoteSnapshot = { ...newPrices };
                    trustedQuoteUpdatedAt = sessionTimestampsForTrackedSymbols(uniqueSymbols, cacheRows);

                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (isTadawulQuoteSymbol(symbol)) continue;
                        if (!allowSimulate) continue;
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
                                cacheRows = applyManualCommodityQuotes({
                                    prices: commodityData.prices,
                                    priorCacheRows: cacheRows,
                                    db: supabase as any,
                                });
                                commodityData.prices.forEach((cp) => {
                                    const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                                    const change = cp.price - oldPrice;
                                    const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                                    newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                                });
                            }
                        }
                    } catch (commodityErr) {
                        console.error('Commodity price fetch failed during fallback:', commodityErr);
                    }

                    const allTickerSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));
                    {
                        const holdingSeed = buildQuoteCacheRowsFromPersistedHoldingPrices(
                            portfoliosInScope,
                            cacheRows,
                        );
                        if (holdingSeed.changed) {
                            cacheRows = holdingSeed.rows;
                            saveQuoteCacheRows(cacheRows);
                        }
                    }
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        applyStoredQuoteFallback(symbol, newPrices, cacheRows);
                    }

                    trustedQuoteSnapshot = { ...newPrices };
                    trustedQuoteUpdatedAt = sessionTimestampsForTrackedSymbols(uniqueSymbols, cacheRows);

                    const isManualForceFetch = forceFetch && priceScope.manual === true;
                    const allowSimulate = !isManualForceFetch;
                    let anyEquitySimulated = false;
                    for (const symbol of allTickerSymbols) {
                        const row = lookupLiveQuoteForSymbol(newPrices, symbol);
                        if (row && row.price > 0) continue;
                        if (isTadawulQuoteSymbol(symbol)) continue;
                        if (!allowSimulate) continue;
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
                trustedQuoteUpdatedAt = sessionTimestampsForTrackedSymbols(uniqueSymbols, cacheRows);
                liveStatus = Object.keys(fromCache).length > 0;
                const allowSimulateEmpty = !(forceFetch && priceScope.manual === true);
                if (!liveStatus && allowSimulateEmpty) {
                    Array.from(new Set([...uniqueSymbols, ...commoditySymbols])).forEach((symbol) => {
                        if (applyStoredQuoteFallback(symbol, newPrices, cacheRows)) return;
                        if (isTadawulQuoteSymbol(symbol)) return;
                        simulateSymbol(symbol);
                    });
                }
            }

            const holdingUpdates: HoldingMarketValueUpdate[] = [];
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
                ...buildEquityHoldingValueUpdatesFromTrustedSnapshot(
                    portfoliosInScope,
                    trustedQuoteSnapshot,
                    sarPerUsd,
                    trustedQuoteUpdatedAt,
                ),
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
                // Do not await persist before draining the next quote batch — was the main multi-minute
                // amplifier for large Tadawul books (Awaed). Chain keeps writes ordered.
                const manual = priceScope.manual === true;
                const updates = holdingUpdatesFiltered;
                holdingPersistChainRef.current = holdingPersistChainRef.current
                    .then(async () => {
                        await yieldToMain();
                        if (!allowHoldingPersist(manual)) return;
                        await batchUpdateHoldingValues(updates);
                    })
                    .catch((persistErr) => {
                        console.warn('Holding market value persist failed:', persistErr);
                    });
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
                !isQuoteRefreshInCooldown('default') &&
                marketContext &&
                priceScope.manual === true &&
                !marketContext.isQuoteRefreshCancelled()
            ) {
                // While SAHMK alone is cooling, only drain non-Tadawul pending (avoid tight requeue loops).
                const pendingAll = [...pendingLiveFetchSymbolsRef.current];
                const drainNow = isQuoteRefreshInCooldown('sahmk')
                    ? pendingAll.filter((s) => !isTadawulQuoteSymbol(s))
                    : pendingAll;
                if (drainNow.length > 0) {
                    pendingLiveFetchSymbolsRef.current = pendingAll.filter((s) => !drainNow.includes(s));
                    marketContext.bumpPriceRefresh({
                        kind: 'symbols',
                        symbols: drainNow,
                        forceFetch: true,
                        manual: true,
                        silent: true,
                    });
                }
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
                        const delayMs = ctx.isManualRefreshSession?.()
                            ? MANUAL_INTER_SCOPE_DELAY_MS
                            : INTER_SCOPE_DELAY_MS;
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }
            } finally {
                tickInFlightRef.current = false;
                const after = contextRef.current.marketContext;
                const pendingSymbols = pendingLiveFetchSymbolsRef.current.length > 0;
                if (after?.hasQueuedPriceRefresh()) {
                    after.notifyQueuedPriceRefresh();
                } else if (pendingSymbols && after) {
                    if (after.isQuoteRefreshCancelled()) {
                        pendingLiveFetchSymbolsRef.current = [];
                        after.finishQuotesRefresh();
                    } else if (!isQuoteRefreshInCooldown('default')) {
                        const pendingAll = [...pendingLiveFetchSymbolsRef.current];
                        const drainNow = isQuoteRefreshInCooldown('sahmk')
                            ? pendingAll.filter((s) => !isTadawulQuoteSymbol(s))
                            : pendingAll;
                        if (drainNow.length === 0) {
                            // Tadawul-only while SAHMK cools — keep pending for cooldown-end drain.
                            after.finishQuotesRefresh();
                        } else {
                            pendingLiveFetchSymbolsRef.current = pendingAll.filter((s) => !drainNow.includes(s));
                            after.bumpPriceRefresh({
                                kind: 'symbols',
                                symbols: drainNow,
                                forceFetch: true,
                                manual: true,
                                silent: true,
                            });
                        }
                    } else {
                        // Keep pending for cooldown-end drain; clear Updating… so the UI is not stuck for minutes.
                        after.finishQuotesRefresh();
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
        registerClearPendingLiveFetch(() => {
            pendingLiveFetchSymbolsRef.current = [];
        });
        return () => {
            registerQuoteRefreshKick(null);
            registerClearPendingLiveFetch(null);
        };
    }, []);

    return null;
};

export default MarketSimulator;
