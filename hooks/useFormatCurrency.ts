import React from 'react';
import { useCurrency } from '../context/CurrencyContext';

interface FormatCurrencyOptions {
    digits?: number;
    colorize?: boolean;
    showSecondary?: boolean; // New option to show the other currency
}

export const useFormatCurrency = () => {
    const { currency, exchangeRate } = useCurrency();

    const formatCurrencyString = (value: number, options: Omit<FormatCurrencyOptions, 'colorize'> = {}) => {
        const { digits = 2, showSecondary = false } = options;
        const displayValue = currency === 'USD' ? value / exchangeRate : value;
        const locale = 'en-US';
        
        let formattedString = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(displayValue);

        if (showSecondary) {
            const secondaryCurrency = currency === 'SAR' ? 'USD' : 'SAR';
            const secondaryValue = currency === 'SAR' ? value / exchangeRate : value * exchangeRate;
            const secondaryFormatted = new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: secondaryCurrency,
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }).format(secondaryValue);
            formattedString += ` (${secondaryFormatted})`;
        }
        
        return formattedString;
    };
    
    const formatCurrency = (value: number, options: FormatCurrencyOptions = {}) => {
        const { colorize = false, ...restOptions } = options;
        
        const formattedString = formatCurrencyString(value, restOptions);

        if (!colorize) {
            return formattedString;
        }

        const colorClass = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-dark';
        
        return React.createElement('span', { className: colorClass }, formattedString);
    };


    return { formatCurrency, formatCurrencyString };
};