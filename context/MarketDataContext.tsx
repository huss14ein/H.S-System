
import React, { createContext, useState, useCallback, ReactNode, useContext, useEffect, useRef, useMemo } from 'react';
import { cacheRowsToSimulatedMap, loadQuoteCacheRows } from '../services/quotePriceCache';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

/** ISO timestamp when each symbol’s quote was last refreshed this session. */
export type SymbolQuoteTimestamps = Record<string, string>;

/** `all` = every tracked symbol (header refresh). `platform` = one investment account’s holdings only (saves API quota). */
export type PriceRefreshScope =
    | { kind: 'all'; forceFetch?: boolean }
    | { kind: 'platform'; platformId: string; forceFetch?: boolean };

/** Drives spinners: full refresh updates header + every platform card; platform refresh only touches one card + omits header “Updating…”. */
export type QuotesRefreshUIScope =
    | { mode: 'idle' }
    | { mode: 'all' }
    | { mode: 'platform'; accountId: string };

interface MarketDataContextType {
  simulatedPrices: SimulatedPrices;
  setSimulatedPrices: React.Dispatch<React.SetStateAction<SimulatedPrices>>;
  isRefreshing: boolean;
  setIsRefreshing: (v: boolean) => void;
  /** Which UX surfaces should show busy state while `isRefreshing` is true. */
  quotesRefreshUIScope: QuotesRefreshUIScope;
  /** Clears refreshing state and UI scope (call when a quote tick completes). */
  finishQuotesRefresh: () => void;
  refreshPrices: () => Promise<void>;
  /** Refresh live quotes for holdings under one investment platform only (skips watchlist, planned trades, commodities). */
  refreshPricesForPlatform: (platformId: string) => Promise<void>;
  /** Increment refresh counter so MarketSimulator runs a live/simulated price pass. */
  bumpPriceRefresh: (scope?: PriceRefreshScope) => void;
  /** Dequeue the next refresh scope (FIFO). Returns null when the queue is empty. */
  consumePriceRefreshScope: () => PriceRefreshScope | null;
  /** True when more refresh scopes are waiting after the current tick. */
  hasQueuedPriceRefresh: () => boolean;
  /** Re-run MarketSimulator when scopes were enqueued during an in-flight tick (does not add a scope). */
  notifyQueuedPriceRefresh: () => void;
  lastUpdated: Date | null;
  /** Set last updated time (e.g. when live fetch completes). */
  setLastUpdated: (date: Date | null) => void;
  isLive: boolean;
  setIsLive: (isLive: boolean) => void;
  refreshTrigger: number;
  symbolQuoteUpdatedAt: SymbolQuoteTimestamps;
  /** Mark symbols as freshly quoted (call after each price tick). */
  touchQuoteTimestamps: (symbols: string[]) => void;
}

export const MarketDataContext = createContext<MarketDataContextType | null>(null);

export const MarketDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [simulatedPrices, setSimulatedPrices] = useState<SimulatedPrices>(() => {
        const m = cacheRowsToSimulatedMap(loadQuoteCacheRows());
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
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [quotesRefreshUIScope, setQuotesRefreshUIScope] = useState<QuotesRefreshUIScope>({ mode: 'idle' });
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isLive, setIsLive] = useState(() => Object.keys(loadQuoteCacheRows()).length > 0);
    const [symbolQuoteUpdatedAt, setSymbolQuoteUpdatedAt] = useState<SymbolQuoteTimestamps>({});

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
        if (!lastUpdated) {
            setLastUpdated(new Date());
        }
    }, []);

    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const refreshQueueRef = useRef<PriceRefreshScope[]>([]);

    const consumePriceRefreshScope = useCallback((): PriceRefreshScope | null => {
        return refreshQueueRef.current.shift() ?? null;
    }, []);

    const hasQueuedPriceRefresh = useCallback((): boolean => {
        return refreshQueueRef.current.length > 0;
    }, []);

    const notifyQueuedPriceRefresh = useCallback(() => {
        if (refreshQueueRef.current.length > 0) {
            setRefreshTrigger((prev) => prev + 1);
        }
    }, []);

    const bumpPriceRefresh = useCallback((scope: PriceRefreshScope = { kind: 'all' }) => {
        refreshQueueRef.current.push(scope);
        setRefreshTrigger((prev) => prev + 1);
    }, []);

    const finishQuotesRefresh = useCallback(() => {
        setIsRefreshing(false);
        setQuotesRefreshUIScope({ mode: 'idle' });
    }, []);

    const refreshPrices = useCallback(async () => {
        setQuotesRefreshUIScope({ mode: 'all' });
        setIsRefreshing(true);
        bumpPriceRefresh({ kind: 'all', forceFetch: true });
        // MarketSimulator performs fetch + calls finishQuotesRefresh when done
    }, [bumpPriceRefresh]);

    const refreshPricesForPlatform = useCallback(
        async (platformId: string) => {
            if (!platformId?.trim()) return;
            const id = platformId.trim();
            setQuotesRefreshUIScope({ mode: 'platform', accountId: id });
            setIsRefreshing(true);
            bumpPriceRefresh({ kind: 'platform', platformId: id, forceFetch: true });
        },
        [bumpPriceRefresh],
    );

    const value = useMemo(
        (): MarketDataContextType => ({
            simulatedPrices,
            setSimulatedPrices,
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
            refreshTrigger,
            symbolQuoteUpdatedAt,
            touchQuoteTimestamps,
        }),
        [
            simulatedPrices,
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
            refreshTrigger,
            symbolQuoteUpdatedAt,
            touchQuoteTimestamps,
        ],
    );

    return (
        <MarketDataContext.Provider value={value}>
            {children}
        </MarketDataContext.Provider>
    );
};

export const useMarketData = () => {
    const context = useContext(MarketDataContext);
    if (!context) {
        throw new Error('useMarketData must be used within a MarketDataProvider');
    }
    return context;
};
