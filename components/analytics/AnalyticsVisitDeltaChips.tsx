import React from 'react';
import type { Page } from '../../types';
import type { VisitDelta } from '../../services/analyticsVisitSnapshot';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

type Props = {
  delta: VisitDelta;
  formatCurrencyString?: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  onReviewNetWorth?: () => void;
  onReviewSpending?: () => void;
  className?: string;
};

/** Action chips summarizing change since last analytics visit. */
export const AnalyticsVisitDeltaChips: React.FC<Props> = ({
  delta,
  formatCurrencyString: fmtProp,
  setActivePage,
  onReviewNetWorth,
  onReviewSpending,
  className = '',
}) => {
  const { formatCurrencyString: fmtHook } = useFormatCurrency();
  const fmt = fmtProp ?? fmtHook;

  const nwPositive = delta.netWorthDeltaSar >= 0;
  const spendPositive = delta.expenseDeltaSar >= 0;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-slate-800 ${className}`}
      role="status"
    >
      <span className="text-sky-900 font-medium shrink-0">Since last visit ({delta.daysSince}d)</span>
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums transition-colors ${
          nwPositive
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            : 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
        }`}
        onClick={() => {
          onReviewNetWorth?.();
          setActivePage?.('Wealth Analytics');
        }}
      >
        Net worth {nwPositive ? '+' : ''}
        {fmt(delta.netWorthDeltaSar, { digits: 0 })}
      </button>
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums transition-colors ${
          spendPositive
            ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
        }`}
        onClick={() => {
          onReviewSpending?.();
          setActivePage?.('Analysis');
        }}
      >
        Spending pace {spendPositive ? '+' : ''}
        {fmt(delta.expenseDeltaSar, { digits: 0 })}
      </button>
    </div>
  );
};

export default AnalyticsVisitDeltaChips;
