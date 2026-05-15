import React, { useEffect, useState } from 'react';

export type BudgetSplitProgressBarProps = {
    /** Amount consumed (spent) toward the cap. */
    value: number;
    /** Budget cap; used to compute segment widths. */
    max: number;
    /** Left segment (consumed) — gradient or solid Tailwind classes. */
    consumedClassName: string;
    /** Right segment (remaining capacity) — gradient or solid Tailwind classes. */
    remainingClassName: string;
    heightClass?: string;
    className?: string;
};

/**
 * Two-segment bar: consumed (left) vs remaining (right). Makes “spent” vs “left” obvious at a glance.
 */
const BudgetSplitProgressBar: React.FC<BudgetSplitProgressBarProps> = ({
    value,
    max,
    consumedClassName,
    remainingClassName,
    heightClass = 'h-3.5',
    className = '',
}) => {
    const [consumedPct, setConsumedPct] = useState(0);

    useEffect(() => {
        const safeMax = Math.max(max, 1);
        const over = value > max;
        const pct = over ? 100 : Math.min(100, Math.max(0, (value / safeMax) * 100));
        const t = setTimeout(() => setConsumedPct(pct), 50);
        return () => clearTimeout(t);
    }, [value, max]);

    const remainingPct = Math.max(0, 100 - consumedPct);

    return (
        <div
            className={`flex w-full overflow-hidden rounded-full shadow-inner ring-1 ring-slate-200/70 ${heightClass} ${className}`}
            role="progressbar"
            aria-valuenow={Math.round(consumedPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Budget use ${Math.round(consumedPct)} percent consumed`}
        >
            <div
                className={`${consumedClassName} ${heightClass} shrink-0 transition-all duration-700 ease-out`}
                style={{ width: `${consumedPct}%` }}
            />
            <div
                className={`${remainingClassName} ${heightClass} shrink-0 transition-all duration-700 ease-out`}
                style={{ width: `${remainingPct}%` }}
            />
        </div>
    );
};

export default BudgetSplitProgressBar;
