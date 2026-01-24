
import React from 'react';
import { useCurrency } from '../context/CurrencyContext';

interface FormatCurrencyOptions {
    digits?: number;
    colorize?: boolean;
}

export const useFormatCurrency = () => {
    const { currency, exchangeRate } = useCurrency();

    const formatCurrencyString = (value: number, options: Omit<FormatCurrencyOptions, 'colorize'> = {}) => {
        const { digits = 2 } = options;
        const displayValue = currency === 'USD' ? value / exchangeRate : value;
        const locale = 'en-US';
        
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(displayValue);
    };
    
    const formatCurrency = (value: number, options: FormatCurrencyOptions = {}) => {
        const { digits = 2, colorize = false } = options;
        
        const formattedString = formatCurrencyString(value, { digits });

        if (!colorize) {
            return formattedString;
        }

        const colorClass = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-dark';
        
        // FIX: Replaced JSX with React.createElement to avoid syntax errors in a .ts file.
        // TypeScript does not parse JSX in .ts files by default, which caused the compiler to misinterpret the JSX tags.
        return React.createElement('span', { className: colorClass }, formattedString);
    };


    return { formatCurrency, formatCurrencyString };
};
