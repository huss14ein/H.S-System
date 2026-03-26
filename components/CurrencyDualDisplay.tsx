import React from 'react';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { TradeCurrency } from '../types';
import { useCurrency } from '../context/CurrencyContext';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

type Props = {
    value: number;
    /** Amount is stored in this currency (e.g. SAR for portfolio KPIs). */
    inCurrency?: TradeCurrency;
    digits?: number;
    /** Color positive/negative (for P/L). */
    colorize?: boolean;
    /** Match Card metric sizes. */
    size?: '2xl' | 'xl' | 'lg' | 'base';
    /** Default extrabold; use bold for dense platform metric grids. */
    weight?: 'bold' | 'extrabold';
    className?: string;
};

/**
 * Primary amount in the book currency (usually SAR on Investments); USD equivalent appears on hover
 * so cards stay clean for non-financial users.
 */
const CurrencyDualDisplay: React.FC<Props> = ({
    value,
    inCurrency = 'SAR',
    digits = 2,
    colorize = false,
    size = '2xl',
    weight = 'extrabold',
    className = '',
}) => {
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const { exchangeRate } = useCurrency();

    const primary = formatCurrencyString(value, { inCurrency, digits });
    const secondary = formatSecondaryEquivalent(value, { inCurrency, digits });
    const rateNote =
        Number.isFinite(exchangeRate) && exchangeRate > 0
            ? `Approx. rate used: 1 USD ≈ ${exchangeRate.toFixed(4)} SAR (from your settings).`
            : 'FX rate unavailable — SAR line is from your saved amounts.';

    const sizeClass =
        size === '2xl'
            ? 'text-2xl'
            : size === 'xl'
              ? 'text-xl'
              : size === 'lg'
                ? 'text-lg'
                : 'text-base';

    const tone =
        colorize && value > 0
            ? 'text-emerald-700'
            : colorize && value < 0
              ? 'text-rose-700'
              : 'text-inherit';

    return (
        <span className={`inline-flex max-w-full min-w-0 flex-nowrap items-baseline gap-1.5 ${className}`}>
            <span className={`${weight === 'bold' ? 'font-bold' : 'font-extrabold'} shrink whitespace-nowrap tabular-nums ${sizeClass} ${tone}`}>{primary}</span>
            {secondary && (
                <span className="relative inline-flex items-center shrink-0 group/currency-hint">
                    <span className="sr-only">Other currency — hover the arrow for USD or SAR equivalent</span>
                    <ChevronDownIcon
                        className="h-4 w-4 text-slate-400 group-hover/currency-hint:text-primary transition-colors cursor-help"
                        aria-hidden
                    />
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-2 w-max max-w-[min(18rem,90vw)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg opacity-0 transition-opacity group-hover/currency-hint:opacity-100"
                    >
                        <span className="font-semibold tabular-nums text-slate-900 block">{secondary}</span>
                        <span className="text-[11px] text-slate-500 mt-1 block leading-snug">{rateNote}</span>
                    </span>
                </span>
            )}
        </span>
    );
};

export default CurrencyDualDisplay;
