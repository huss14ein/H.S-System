import React, { createContext, useState, useContext, ReactNode } from 'react';

type Currency = 'SAR' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number; // SAR to USD
}

export const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currency, setCurrency] = useState<Currency>('SAR');
    const exchangeRate = 3.75; // 1 USD = 3.75 SAR

    const value = {
        currency,
        setCurrency,
        exchangeRate
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
