import React, { useMemo } from 'react';
import type { Page } from '../../types';
import type { VisitDelta } from '../../services/analyticsVisitSnapshot';
import type { BudgetDriftRow } from '../../services/budgetDrift';
import type { ExpenseBudgetAnalysisModel } from '../../services/expenseBudgetAnalysisModel';
import { buildAnalyticsInsightFeed } from '../../services/analyticsInsightEngine';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { buildBudgetDrillDownAction, triggerSpendingDrillDown } from '../../services/spendingDrillDown';
import { useAnalyticsWorkspaceOptional } from '../../context/AnalyticsWorkspaceContext';

const PRIORITY_DOT: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
};

type Props = {
  model: ExpenseBudgetAnalysisModel | null;
  driftRows?: BudgetDriftRow[];
  visitDelta?: VisitDelta | null;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  className?: string;
};

/** Ranked insight feed for Wealth Analytics — model insights + visit delta headline. */
export const AnalyticsInsightRail: React.FC<Props> = ({
  model,
  driftRows = [],
  visitDelta,
  setActivePage,
  triggerPageAction,
  className = '',
}) => {
  const { formatCurrencyString } = useFormatCurrency();
  const workspace = useAnalyticsWorkspaceOptional();

  const feed = useMemo(
    () => buildAnalyticsInsightFeed({ model, driftRows }),
    [model, driftRows],
  );

  const drillCategory = (category: string) =>
    triggerSpendingDrillDown(
      triggerPageAction,
      setActivePage,
      buildBudgetDrillDownAction({ budgetCategory: category }),
      { setSelectedCategory: workspace?.setSelectedCategory },
    );

  if (!visitDelta && feed.length === 0) return null;

  return (
    <aside
      className={`rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-4 shadow-sm space-y-3 ${className}`}
      aria-label="Analytics insight rail"
    >
      <header>
        <h2 className="text-sm font-bold text-slate-900">Insight rail</h2>
        <p className="text-xs text-slate-500">Ranked signals from spending model and budget drift.</p>
      </header>

      {visitDelta && (
        <div className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold text-sky-900">Visit delta · {visitDelta.daysSince}d</span>
          {' · '}
          NW{' '}
          <span className={visitDelta.netWorthDeltaSar >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
            {visitDelta.netWorthDeltaSar >= 0 ? '+' : ''}
            {formatCurrencyString(visitDelta.netWorthDeltaSar, { digits: 0 })}
          </span>
          {' · '}
          spend pace{' '}
          <span className="font-semibold">
            {visitDelta.expenseDeltaSar >= 0 ? '+' : ''}
            {formatCurrencyString(visitDelta.expenseDeltaSar, { digits: 0 })}
          </span>
        </div>
      )}

      {feed.length > 0 ? (
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {feed.map((ins) => (
            <li key={ins.id}>
              <button
                type="button"
                className="w-full text-left rounded-lg border border-slate-100 bg-white px-3 py-2 hover:border-violet-200 hover:bg-violet-50/40 transition-colors"
                onClick={() => ins.category && drillCategory(ins.category)}
                disabled={!ins.category}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[ins.priority]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{ins.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{ins.body}</p>
                    {ins.amountSar != null && (
                      <p className="text-xs tabular-nums text-slate-500 mt-1">
                        {formatCurrencyString(ins.amountSar, { digits: 0 })}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No ranked insights for this period yet.</p>
      )}
    </aside>
  );
};

export default AnalyticsInsightRail;
