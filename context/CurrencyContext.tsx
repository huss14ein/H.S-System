import React, { createContext, useState, useContext, useCallback, ReactNode } from 'react';
import { DEFAULT_SAR_PER_USD } from '../utils/currencyMath';

type Currency = 'SAR' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  /** SAR per 1 USD — kept in sync with `resolveSarPerUsd(data)` via `ExchangeRateSync` (Wealth Ultra / fallbacks). */
  exchangeRate: number;
  setExchangeRate: (rate: number) => void;
}

export const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currency, setCurrency] = useState<Currency>('SAR');
    const [exchangeRate, setExchangeRateState] = useState<number>(DEFAULT_SAR_PER_USD);
    const setExchangeRate = useCallback((rate: number) => {
        if (Number.isFinite(rate) && rate > 0) setExchangeRateState(rate);
    }, []);

    const value = {
        currency,
        setCurrency,
        exchangeRate,
        setExchangeRate,
    };

    return (
        <CurrencyContext.Provider value={value}>
            {children}
        </CurrencyContext.Provider>
    );
};

export const useCurrency = () => {
    const context = useContext(CurrencyContext);
    if (!context) {
        throw new Error('useCurrency must be used within a CurrencyProvider');
    }
    return context;
};
