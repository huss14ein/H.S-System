import React from 'react';
import { useCurrency } from '../context/CurrencyContext';
import type { TradeCurrency } from '../types';

/**
 * Currency display helpers.
 *
 * When `inCurrency` is omitted, values are interpreted as **SAR-normalized** (same basis as KPIs and
 * cross-account totals): the hook applies the user’s display currency (SAR vs USD) by converting from that basis.
 * For raw fields stored in a **specific account’s book currency** (e.g. `transaction.amount`, `account.balance`
 * for cash/credit), pass `{ inCurrency: 'SAR' | 'USD' }` so the figure is not double-converted.
 */

interface FormatCurrencyOptions {
    digits?: number;
    colorize?: boolean;
    showSecondary?: boolean; // Show the other currency in parentheses
    /** Force display in USD (e.g. for market data / research that is always in USD). */
    forceUSD?: boolean;
    /** Display value in this currency; value is assumed to be stored in this currency (e.g. portfolio base currency). */
    inCurrency?: TradeCurrency;
}

export const useFormatCurrency = () => {
    const { currency, exchangeRate } = useCurrency();

    const formatCurrencyString = (value: number, options: Omit<FormatCurrencyOptions, 'colorize'> = {}) => {
        const { digits = 2, showSecondary = false, forceUSD = false, inCurrency } = options;
        const locale = 'en-US';

        // When inCurrency is set, value is in that currency — display as-is in that currency.
        if (inCurrency != null) {
            const displayValue = value;
            const displayCurrency = inCurrency;
            let formattedString = new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: displayCurrency,
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }).format(displayValue);
            if (showSecondary) {
                const otherCurrency: TradeCurrency = displayCurrency === 'USD' ? 'SAR' : 'USD';
                const secondaryValue = displayCurrency === 'USD' ? value * exchangeRate : value / exchangeRate;
                const secondaryFormatted = new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: otherCurrency,
                    minimumFractionDigits: digits,
                    maximumFractionDigits: digits,
                }).format(secondaryValue);
                formattedString += ` (≈ ${secondaryFormatted})`;
            }
            return formattedString;
        }

        const displayCurrency = forceUSD ? 'USD' : currency;
        const displayValue = forceUSD ? value : (currency === 'USD' ? value / exchangeRate : value);

        let formattedString = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: displayCurrency,
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(displayValue);

        if (showSecondary && !forceUSD) {
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

    /**
     * The other-currency equivalent for tooltips / hover (primary is from formatCurrencyString without showSecondary).
     * When `inCurrency` is set, value is in that currency and the equivalent is the paired currency.
     */
    const formatSecondaryEquivalent = (value: number, options: Omit<FormatCurrencyOptions, 'colorize' | 'showSecondary'> = {}) => {
        const locale = 'en-US';
        const { digits = 2, forceUSD = false, inCurrency } = options;
        if (forceUSD) {
            const secondaryValue = value / exchangeRate;
            if (!Number.isFinite(secondaryValue)) return null;
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }).format(secondaryValue);
        }
        if (inCurrency != null) {
            const otherCurrency: TradeCurrency = inCurrency === 'USD' ? 'SAR' : 'USD';
            const secondaryValue = inCurrency === 'USD' ? value * exchangeRate : value / exchangeRate;
            if (!Number.isFinite(secondaryValue)) return null;
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: otherCurrency,
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }).format(secondaryValue);
        }
        const secondaryCurrency = currency === 'SAR' ? 'USD' : 'SAR';
        const secondaryValue = currency === 'SAR' ? value / exchangeRate : value * exchangeRate;
        if (!Number.isFinite(secondaryValue)) return null;
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: secondaryCurrency,
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(secondaryValue);
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

    return { formatCurrency, formatCurrencyString, formatSecondaryEquivalent };
};