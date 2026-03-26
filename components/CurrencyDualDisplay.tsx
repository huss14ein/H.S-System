import React from 'react';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { TradeCurrency } from '../types';

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

    const primary = formatCurrencyString(value, { inCurrency, digits });
    const secondary = formatSecondaryEquivalent(value, { inCurrency, digits });

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
            <span className="relative inline-flex items-center group/currency-value">
                <span
                    className={`${weight === 'bold' ? 'font-bold' : 'font-extrabold'} shrink whitespace-nowrap tabular-nums ${sizeClass} ${tone} ${secondary ? 'cursor-help' : ''}`}
                    title={secondary || undefined}
                >
                    {primary}
                </span>
                {secondary ? (
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-2 w-max max-w-[min(18rem,90vw)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg opacity-0 transition-opacity group-hover/currency-value:opacity-100"
                    >
                        <span className="font-semibold tabular-nums text-slate-900 block">{secondary}</span>
                    </span>
                ) : null}
            </span>
        </span>
    );
};

export default CurrencyDualDisplay;
