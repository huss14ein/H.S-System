import React, { useMemo } from 'react';
import type { Page } from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { buildBudgetDrillDownAction, triggerSpendingDrillDown } from '../../services/spendingDrillDown';
import { buildAnalyticsInsightFeed } from '../../services/analyticsInsightEngine';
import type { BudgetDriftRow } from '../../services/budgetDrift';
import type { ExpenseBudgetAnalysisModel } from '../../services/expenseBudgetAnalysisModel';
import type { SalaryDetection } from '../../services/transactionIntelligence';

type Props = {
  salaryCoverage: { ratio: number | null; label: string; healthy: boolean | null };
  salary: SalaryDetection;
  subs: { monthlyEstimate: number; count: number };
  incomeStability: { score: number; label: string; cvPct: number };
  driftRows: BudgetDriftRow[];
  model?: ExpenseBudgetAnalysisModel | null;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
};

export const AnalyticsInsightCards: React.FC<Props> = ({
  salaryCoverage,
  salary,
  subs,
  incomeStability,
  driftRows,
  model,
  setActivePage,
  triggerPageAction,
}) => {
  const { formatCurrencyString } = useFormatCurrency();

  const insightFeed = useMemo(
    () => buildAnalyticsInsightFeed({ model: model ?? null, driftRows }),
    [model, driftRows],
  );

  const drill = (category: string) =>
    triggerSpendingDrillDown(
      triggerPageAction,
      setActivePage,
      buildBudgetDrillDownAction({ budgetCategory: category }),
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">Salary vs spend</p>
          <p className="text-2xl font-bold tabular-nums mt-1">
            {salaryCoverage.ratio != null ? `${salaryCoverage.ratio.toFixed(2)}×` : '—'}
          </p>
          <p className="text-sm text-slate-600 mt-1">{salaryCoverage.label}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">Income stability</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{incomeStability.score}/100</p>
          <p className="text-sm text-slate-600">{incomeStability.label} · CV {incomeStability.cvPct.toFixed(0)}%</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">Subscriptions (est.)</p>
          <p className="text-2xl font-bold tabular-nums mt-1">
            {formatCurrencyString(subs.monthlyEstimate, { digits: 0 })}/mo
          </p>
          <p className="text-sm text-slate-600">{subs.count} matching transactions</p>
        </div>
        {salary.detected && (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4 shadow-sm md:col-span-2">
            <p className="text-xs font-bold uppercase text-violet-800">Salary pattern</p>
            <p className="text-sm text-slate-800 mt-1">{salary.label}</p>
          </div>
        )}
        {driftRows.slice(0, 2).map((d) => (
          <button
            key={d.category}
            type="button"
            className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm text-left hover:border-amber-300"
            onClick={() => drill(d.category)}
          >
            <p className="text-xs font-bold uppercase text-amber-900">Drift spotlight</p>
            <p className="font-semibold text-slate-900 mt-1">{d.category}</p>
            <p className="text-sm text-amber-950">
              {d.driftPct >= 0 ? '+' : ''}
              {d.driftPct.toFixed(0)}% vs 3-mo avg
            </p>
          </button>
        ))}
      </div>
      {insightFeed.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insightFeed.map((insight) => (
            <button
              key={insight.id}
              type="button"
              className={`rounded-xl border p-4 text-left shadow-sm hover:border-slate-300 ${
                insight.priority === 'high'
                  ? 'border-rose-200 bg-rose-50/50'
                  : insight.priority === 'medium'
                    ? 'border-amber-200 bg-amber-50/40'
                    : 'border-slate-200 bg-white'
              }`}
              onClick={() => insight.category && drill(insight.category)}
              disabled={!insight.category}
            >
              <p className="text-xs font-bold uppercase text-slate-500">{insight.source}</p>
              <p className="font-semibold text-slate-900 mt-1">{insight.title}</p>
              <p className="text-sm text-slate-600 mt-0.5">{insight.body}</p>
              {insight.amountSar != null && (
                <p className="text-sm font-medium tabular-nums text-slate-800 mt-1">
                  {formatCurrencyString(insight.amountSar, { digits: 0 })}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnalyticsInsightCards;
