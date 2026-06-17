
import React, { createContext, useState, useCallback, ReactNode, useContext, useEffect, useRef, useMemo } from 'react';
import { cacheRowsToSimulatedMap, loadQuoteCacheRows, QUOTE_CACHE_STORAGE_KEY } from '../services/quotePriceCache';
import {
  latestQuoteCacheTimestamp,
  rehydrateSessionPricesFromQuoteCache,
  symbolTimestampsFromCacheRows,
} from '../services/cachedQuoteRestore';
import { quoteRefreshCooldownRemainingMs } from '../services/quoteRefreshCooldown';
import { mergePriceRefreshScope } from '../services/quoteRefreshQueue';
import { kickQuoteRefreshNow } from '../utils/quoteRefreshBridge';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

/** ISO timestamp when each symbol’s quote was last refreshed this session. */
export type SymbolQuoteTimestamps = Record<string, string>;

/** `all` = every tracked symbol (header refresh). `platform` = one investment account’s holdings only (saves API quota). */
export type PriceRefreshScope =
    | { kind: 'all'; forceFetch?: boolean; manual?: boolean; /** Skip header/platform spinners (session poll). */ silent?: boolean }
    | { kind: 'platform'; platformId: string; forceFetch?: boolean; manual?: boolean; silent?: boolean }
    /** Pending overflow / targeted drain — fetches only listed symbols (no full portfolio rescan). */
    | { kind: 'symbols'; symbols: string[]; forceFetch?: boolean; manual?: boolean; silent?: boolean };

/** Drives spinners: full refresh updates header + every platform card; platform refresh only touches one card + omits header “Updating…”. */
export type QuotesRefreshUIScope =
    | { mode: 'idle' }
    | { mode: 'all' }
    | { mode: 'platform'; accountId: string };

/** Where displayed quotes came from this session (cache restore vs manual live fetch). */
export type QuotesPriceSource = 'none' | 'cached' | 'live';

export type MarketPricesContextType = {
  simulatedPrices: SimulatedPrices;
  setSimulatedPrices: React.Dispatch<React.SetStateAction<SimulatedPrices>>;
};

export type MarketDebouncedPricesContextType = {
  debouncedPrices: SimulatedPrices;
};

export type MarketDataControlContextType = {
  isRefreshing: boolean;
  setIsRefreshing: (v: boolean) => void;
  quotesRefreshUIScope: QuotesRefreshUIScope;
  finishQuotesRefresh: () => void;
  refreshPrices: (options?: { forceFetch?: boolean }) => Promise<void>;
  refreshPricesForPlatform: (platformId: string) => Promise<void>;
  bumpPriceRefresh: (scope?: PriceRefreshScope) => void;
  consumePriceRefreshScope: () => PriceRefreshScope | null;
  hasQueuedPriceRefresh: () => boolean;
  notifyQueuedPriceRefresh: () => void;
  lastUpdated: Date | null;
  setLastUpdated: (date: Date | null) => void;
  isLive: boolean;
  setIsLive: (isLive: boolean) => void;
  quotesPriceSource: QuotesPriceSource;
  setQuotesPriceSource: (source: QuotesPriceSource) => void;
  refreshTrigger: number;
  symbolQuoteUpdatedAt: SymbolQuoteTimestamps;
  touchQuoteTimestamps: (symbols: string[]) => void;
  cancelQuoteRefresh: () => void;
  isQuoteRefreshCancelled: () => boolean;
  quoteRefreshQueueLength: () => number;
  quoteRefreshCooldownRemainingMs: () => number;
  isManualRefreshSession: () => boolean;
};

/** @deprecated Prefer `useMarketPrices` / `useMarketQuoteMeta` to avoid quote-tick re-renders. */
export type MarketDataContextType = MarketPricesContextType & MarketDataControlContextType;

export const MarketPricesContext = createContext<MarketPricesContextType | null>(null);
export const MarketDebouncedPricesContext = createContext<MarketDebouncedPricesContextType | null>(null);
export const MarketDataControlContext = createContext<MarketDataControlContextType | null>(null);
/** Combined context — re-renders on every quote tick. */
export const MarketDataContext = createContext<MarketDataContextType | null>(null);

export const MarketDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const initialCacheRows = loadQuoteCacheRows();
    const [simulatedPrices, setSimulatedPrices] = useState<SimulatedPrices>(() => {
        const m = cacheRowsToSimulatedMap(initialCacheRows);
        const out: SimulatedPrices = {};
        for (const [k, v] of Object.entries(m)) {
            out[k] = {
                price: v.price,
                change: v.change ?? 0,
                changePercent: v.changePercent ?? 0,
            };
        }
        return out;
    });
    const debouncedPrices = useDebouncedValue(simulatedPrices, 800);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [quotesRefreshUIScope, setQuotesRefreshUIScope] = useState<QuotesRefreshUIScope>({ mode: 'idle' });
    const [lastUpdated, setLastUpdated] = useState<Date | null>(() => latestQuoteCacheTimestamp(initialCacheRows));
    const [isLive, setIsLive] = useState(() => Object.keys(initialCacheRows).length > 0);
    const [quotesPriceSource, setQuotesPriceSource] = useState<QuotesPriceSource>(() =>
        Object.keys(initialCacheRows).length > 0 ? 'cached' : 'none',
    );
    const [symbolQuoteUpdatedAt, setSymbolQuoteUpdatedAt] = useState<SymbolQuoteTimestamps>(() =>
        symbolTimestampsFromCacheRows(initialCacheRows),
    );

    const touchQuoteTimestamps = useCallback((symbols: string[]) => {
        if (!symbols.length) return;
        const t = new Date().toISOString();
        setSymbolQuoteUpdatedAt((prev) => {
            const next = { ...prev };
            for (const raw of symbols) {
                const u = (raw || '').trim().toUpperCase();
                if (u) next[u] = t;
            }
            return next;
        });
    }, []);

    useEffect(() => {
        if (lastUpdated) return;
        const cached = latestQuoteCacheTimestamp(loadQuoteCacheRows());
        if (cached) setLastUpdated(cached);
    }, [lastUpdated]);

    const applyPersistedQuoteCacheToSession = useCallback(() => {
        const rows = loadQuoteCacheRows();
        if (Object.keys(rows).length === 0) return;
        setSimulatedPrices((prev) => {
            const { prices, changed } = rehydrateSessionPricesFromQuoteCache(prev, rows);
            return changed ? prices : prev;
        });
        const ts = latestQuoteCacheTimestamp(rows);
        if (ts) setLastUpdated(ts);
        setIsLive(true);
        setSymbolQuoteUpdatedAt(symbolTimestampsFromCacheRows(rows));
    }, []);

    /** Cross-tab + return-to-tab: keep session prices aligned with localStorage cache. */
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onStorage = (e: StorageEvent) => {
            if (e.key !== QUOTE_CACHE_STORAGE_KEY) return;
            applyPersistedQuoteCacheToSession();
        };
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            applyPersistedQuoteCacheToSession();
        };
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [applyPersistedQuoteCacheToSession]);

    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const refreshQueueRef = useRef<PriceRefreshScope[]>([]);
    const quoteRefreshAbortRef = useRef(false);
    /** True while a user-initiated refresh is draining its queue — blocks auto-resume paths. */
    const manualRefreshSessionRef = useRef(false);

    const isQuoteRefreshCancelled = useCallback(() => quoteRefreshAbortRef.current, []);

    const consumePriceRefreshScope = useCallback((): PriceRefreshScope | null => {
        if (quoteRefreshAbortRef.current) {
            refreshQueueRef.current = [];
            return null;
        }
        return refreshQueueRef.current.shift() ?? null;
    }, []);

    const hasQueuedPriceRefresh = useCallback((): boolean => {
        return refreshQueueRef.current.length > 0;
    }, []);

    const quoteRefreshQueueLength = useCallback((): number => {
        return refreshQueueRef.current.length;
    }, []);

    const quoteRefreshCooldownRemainingMsSafe = useCallback((): number => {
        return quoteRefreshCooldownRemainingMs();
    }, []);

    const isManualRefreshSession = useCallback((): boolean => {
        return manualRefreshSessionRef.current;
    }, []);

    const notifyQueuedPriceRefresh = useCallback(() => {
        setRefreshTrigger((prev) => prev + 1);
    }, []);

    const bumpPriceRefresh = useCallback((scope: PriceRefreshScope = { kind: 'all', manual: true }) => {
        quoteRefreshAbortRef.current = false;
        if (scope.manual !== true) {
            return;
        }
        manualRefreshSessionRef.current = true;
        const merged = mergePriceRefreshScope(refreshQueueRef.current, scope);
        refreshQueueRef.current = merged.queue;
        if (scope.silent !== true) {
            setIsRefreshing(true);
        }
        setRefreshTrigger((prev) => prev + 1);
    }, []);

    const finishQuotesRefresh = useCallback(() => {
        setIsRefreshing(false);
        setQuotesRefreshUIScope({ mode: 'idle' });
        if (refreshQueueRef.current.length === 0) {
            manualRefreshSessionRef.current = false;
        }
    }, []);

    const cancelQuoteRefresh = useCallback(() => {
        quoteRefreshAbortRef.current = true;
        refreshQueueRef.current = [];
        manualRefreshSessionRef.current = false;
        finishQuotesRefresh();
    }, [finishQuotesRefresh]);

    const refreshPrices = useCallback(async (options?: { forceFetch?: boolean }) => {
        const force = options?.forceFetch === true;
        quoteRefreshAbortRef.current = false;
        setQuotesRefreshUIScope({ mode: 'all' });
        setIsRefreshing(true);
        manualRefreshSessionRef.current = true;
        bumpPriceRefresh({ kind: 'all', forceFetch: force, manual: true });
        kickQuoteRefreshNow();
    }, [bumpPriceRefresh]);

    const refreshPricesForPlatform = useCallback(
        async (platformId: string) => {
            if (!platformId?.trim()) return;
            const id = platformId.trim();
            quoteRefreshAbortRef.current = false;
            setQuotesRefreshUIScope({ mode: 'platform', accountId: id });
            setIsRefreshing(true);
            manualRefreshSessionRef.current = true;
            bumpPriceRefresh({ kind: 'platform', platformId: id, forceFetch: true, manual: true });
            kickQuoteRefreshNow();
        },
        [bumpPriceRefresh],
    );

    const pricesValue = useMemo(
        (): MarketPricesContextType => ({
            simulatedPrices,
            setSimulatedPrices,
        }),
        [simulatedPrices],
    );

    const debouncedValue = useMemo(
        (): MarketDebouncedPricesContextType => ({
            debouncedPrices,
        }),
        [debouncedPrices],
    );

    const controlValue = useMemo(
        (): MarketDataControlContextType => ({
            isRefreshing,
            setIsRefreshing,
            quotesRefreshUIScope,
            finishQuotesRefresh,
            refreshPrices,
            refreshPricesForPlatform,
            bumpPriceRefresh,
            consumePriceRefreshScope,
            hasQueuedPriceRefresh,
            notifyQueuedPriceRefresh,
            lastUpdated,
            setLastUpdated,
            isLive,
            setIsLive,
            quotesPriceSource,
            setQuotesPriceSource,
            refreshTrigger,
            symbolQuoteUpdatedAt,
            touchQuoteTimestamps,
            cancelQuoteRefresh,
            isQuoteRefreshCancelled,
            quoteRefreshQueueLength,
            quoteRefreshCooldownRemainingMs: quoteRefreshCooldownRemainingMsSafe,
            isManualRefreshSession,
        }),
        [
            isRefreshing,
            quotesRefreshUIScope,
            finishQuotesRefresh,
            refreshPrices,
            refreshPricesForPlatform,
            bumpPriceRefresh,
            consumePriceRefreshScope,
            hasQueuedPriceRefresh,
            notifyQueuedPriceRefresh,
            lastUpdated,
            isLive,
            quotesPriceSource,
            refreshTrigger,
            symbolQuoteUpdatedAt,
            touchQuoteTimestamps,
            cancelQuoteRefresh,
            isQuoteRefreshCancelled,
            quoteRefreshQueueLength,
            quoteRefreshCooldownRemainingMsSafe,
            isManualRefreshSession,
        ],
    );

    const combinedValue = useMemo(
        (): MarketDataContextType => ({
            ...pricesValue,
            ...controlValue,
        }),
        [pricesValue, controlValue],
    );

    return (
        <MarketDataControlContext.Provider value={controlValue}>
            <MarketPricesContext.Provider value={pricesValue}>
                <MarketDebouncedPricesContext.Provider value={debouncedValue}>
                    <MarketDataContext.Provider value={combinedValue}>{children}</MarketDataContext.Provider>
                </MarketDebouncedPricesContext.Provider>
            </MarketPricesContext.Provider>
        </MarketDataControlContext.Provider>
    );
};

export function useMarketPrices(): MarketPricesContextType {
    const context = useContext(MarketPricesContext);
    if (!context) {
        throw new Error('useMarketPrices must be used within a MarketDataProvider');
    }
    return context;
}

export function useMarketDebouncedPrices(): MarketDebouncedPricesContextType {
    const context = useContext(MarketDebouncedPricesContext);
    if (!context) {
        throw new Error('useMarketDebouncedPrices must be used within a MarketDataProvider');
    }
    return context;
}

export const useMarketData = () => {
    const context = useContext(MarketDataContext);
    if (!context) {
        throw new Error('useMarketData must be used within a MarketDataProvider');
    }
    return context;
};
