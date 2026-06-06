
import React, { createContext, useState, useCallback, ReactNode, useContext, useEffect, useRef, useMemo } from 'react';
import { cacheRowsToSimulatedMap, loadQuoteCacheRows } from '../services/quotePriceCache';
import { latestQuoteCacheTimestamp, symbolTimestampsFromCacheRows } from '../services/cachedQuoteRestore';
import { isQuoteRefreshInCooldown, quoteRefreshCooldownRemainingMs } from '../services/quoteRefreshCooldown';
import { mergePriceRefreshScope } from '../services/quoteRefreshQueue';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

/** ISO timestamp when each symbol’s quote was last refreshed this session. */
export type SymbolQuoteTimestamps = Record<string, string>;

/** `all` = every tracked symbol (header refresh). `platform` = one investment account’s holdings only (saves API quota). */
export type PriceRefreshScope =
    | { kind: 'all'; forceFetch?: boolean; manual?: boolean }
    | { kind: 'platform'; platformId: string; forceFetch?: boolean; manual?: boolean }
    /** Pending overflow / targeted drain — fetches only listed symbols (no full portfolio rescan). */
    | { kind: 'symbols'; symbols: string[]; forceFetch?: boolean; manual?: boolean };

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
    const debouncedPrices = useDebouncedValue(simulatedPrices, 1500);
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
        if (refreshQueueRef.current.length > 0) {
            setRefreshTrigger((prev) => prev + 1);
        }
    }, []);

    const bumpPriceRefresh = useCallback((scope: PriceRefreshScope = { kind: 'all', manual: true }) => {
        quoteRefreshAbortRef.current = false;
        if (scope.manual === true) {
            manualRefreshSessionRef.current = true;
        } else {
            return;
        }
        if (isBackgroundWorkPaused() && scope.forceFetch !== true) {
            return;
        }
        if (isQuoteRefreshInCooldown()) {
            const scopedForce = scope.forceFetch === true;
            if (scopedForce) return;
        }
        const merged = mergePriceRefreshScope(refreshQueueRef.current, scope);
        refreshQueueRef.current = merged.queue;
        if (merged.changed) {
            setIsRefreshing(true);
            setRefreshTrigger((prev) => prev + 1);
        }
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
        setQuotesRefreshUIScope({ mode: 'all' });
        setIsRefreshing(true);
        manualRefreshSessionRef.current = true;
        if (isQuoteRefreshInCooldown() && options?.forceFetch === true) {
            finishQuotesRefresh();
            return;
        }
        bumpPriceRefresh({ kind: 'all', forceFetch: true, manual: true });
    }, [bumpPriceRefresh, finishQuotesRefresh]);

    const refreshPricesForPlatform = useCallback(
        async (platformId: string) => {
            if (!platformId?.trim()) return;
            const id = platformId.trim();
            setQuotesRefreshUIScope({ mode: 'platform', accountId: id });
            setIsRefreshing(true);
            manualRefreshSessionRef.current = true;
            bumpPriceRefresh({ kind: 'platform', platformId: id, forceFetch: true, manual: true });
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
