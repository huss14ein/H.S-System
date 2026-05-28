import React from 'react';
import SectionCard from '../SectionCard';
import { ExclamationTriangleIcon } from '../icons/ExclamationTriangleIcon';
import type { PlanExpenseOutlier } from '../../services/planExpenseOutliers';
import { planExpenseOutlierPageAction } from '../../services/planExpenseOutliers';

type Props = {
  year: number;
  outliers: PlanExpenseOutlier[];
  formatCurrencyString: (value: number, opts?: { digits?: number; inCurrency?: 'SAR' | 'USD' }) => string;
  onViewInTransactions?: (action: string) => void;
};

const PlanExpenseSpikePanel: React.FC<Props> = ({ year, outliers, formatCurrencyString, onViewInTransactions }) => {
  if (outliers.length === 0) return null;

  return (
    <SectionCard
      title="Large expenses affecting this plan"
      className="mt-4 border-rose-200 bg-rose-50/40"
      collapsible
      collapsibleSummary="Outlier transactions — fix or exclude in Transactions"
      defaultExpanded
    >
      <p className="text-sm text-rose-950/90 leading-relaxed flex items-start gap-2">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" aria-hidden />
        <span>
          One or more expense lines are unusually large for this year. They can swing YTD net (e.g. a −451k spike).
          Review each row in Transactions — correct the amount, category, or delete if it was imported in error.
        </span>
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {outliers.slice(0, 6).map((o) => (
          <li
            key={o.transactionId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200/80 bg-white/80 px-3 py-2"
          >
            <div className="min-w-0">
              <span className="font-semibold text-slate-900">{o.category}</span>
              <span className="text-slate-600"> · {o.monthLabel} · {o.date}</span>
              {o.description && o.description !== o.category && (
                <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">{o.description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="font-semibold tabular-nums text-rose-800">
                {formatCurrencyString(o.amountSar, { inCurrency: 'SAR', digits: 0 })}
              </span>
              <span className="text-xs text-rose-700">{(o.shareOfYtdExpenses * 100).toFixed(0)}% of YTD expenses</span>
              {onViewInTransactions && (
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => onViewInTransactions(planExpenseOutlierPageAction(year, o.monthIndex, o.category))}
                >
                  Open in Transactions →
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
};

export default React.memo(PlanExpenseSpikePanel);
