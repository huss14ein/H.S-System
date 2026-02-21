
import React, { createContext, useState, ReactNode, useContext, useEffect } from 'react';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

interface MarketDataContextType {
  simulatedPrices: SimulatedPrices;
  setSimulatedPrices: (prices: SimulatedPrices) => void;
  isRefreshing: boolean;
  refreshPrices: () => Promise<void>;
  lastUpdated: Date | null;
  isLive: boolean;
  setIsLive: (isLive: boolean) => void;
}

export const MarketDataContext = createContext<MarketDataContextType | null>(null);

export const MarketDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [simulatedPrices, setSimulatedPrices] = useState<SimulatedPrices>({});
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isLive, setIsLive] = useState(false);

    useEffect(() => {
        if (!lastUpdated) {
            setLastUpdated(new Date());
        }
    }, []);

    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const refreshPrices = async () => {
        setIsRefreshing(true);
        setRefreshTrigger(prev => prev + 1);
        // The actual logic is in MarketSimulator which listens to refreshTrigger
        await new Promise(resolve => setTimeout(resolve, 800)); 
        setLastUpdated(new Date());
        setIsRefreshing(false);
    };

    const value = {
        simulatedPrices,
        setSimulatedPrices,
        isRefreshing,
        refreshPrices,
        lastUpdated,
        isLive,
        setIsLive,
        refreshTrigger
    };

    return (
        <MarketDataContext.Provider value={value as any}>
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
