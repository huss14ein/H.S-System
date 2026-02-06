
import React, { createContext, useState, ReactNode, useContext } from 'react';

interface SimulatedPrices {
    [symbol: string]: { price: number; change: number; changePercent: number };
}

interface MarketDataContextType {
  simulatedPrices: SimulatedPrices;
  setSimulatedPrices: (prices: SimulatedPrices) => void;
}

export const MarketDataContext = createContext<MarketDataContextType | null>(null);

export const MarketDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [simulatedPrices, setSimulatedPrices] = useState<SimulatedPrices>({});

    const value = {
        simulatedPrices,
        setSimulatedPrices,
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
