
import React, { createContext, useState, useCallback, ReactNode, useContext, useEffect } from 'react';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

/** ISO timestamp when each symbol’s quote was last refreshed this session. */
export type SymbolQuoteTimestamps = Record<string, string>;

interface MarketDataContextType {
  simulatedPrices: SimulatedPrices;
  setSimulatedPrices: (prices: SimulatedPrices) => void;
  isRefreshing: boolean;
  setIsRefreshing: (v: boolean) => void;
  refreshPrices: () => Promise<void>;
  /** Increment refresh counter so MarketSimulator runs a live/simulated price pass. */
  bumpPriceRefresh: () => void;
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
    const [simulatedPrices, setSimulatedPrices] = useState<SimulatedPrices>({});
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isLive, setIsLive] = useState(false);
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

    const bumpPriceRefresh = useCallback(() => {
        setRefreshTrigger((prev) => prev + 1);
    }, []);

    const refreshPrices = useCallback(async () => {
        setIsRefreshing(true);
        bumpPriceRefresh();
        // MarketSimulator performs fetch + sets isRefreshing false when done
    }, [bumpPriceRefresh]);

    const value: MarketDataContextType = {
        simulatedPrices,
        setSimulatedPrices,
        isRefreshing,
        setIsRefreshing,
        refreshPrices,
        bumpPriceRefresh,
        lastUpdated,
        setLastUpdated,
        isLive,
        setIsLive,
        refreshTrigger,
        symbolQuoteUpdatedAt,
        touchQuoteTimestamps,
    };

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
