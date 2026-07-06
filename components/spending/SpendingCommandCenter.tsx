import React from 'react';
import type { Page } from '../../types';
import type { ExpenseBudgetAnalysisModel } from '../../services/expenseBudgetAnalysisModel';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { buildBudgetDrillDownAction, triggerSpendingDrillDown } from '../../services/spendingDrillDown';
import { useAnalyticsWorkspaceOptional } from '../../context/AnalyticsWorkspaceContext';
import { financialMonthDaysRemaining } from '../../utils/financialMonth';
import { DeferredMount } from '../dashboard/DeferredMount';
import ExpenseBudgetAnalysisPanel from '../analysis/ExpenseBudgetAnalysisPanel';

type Props = {
  model: ExpenseBudgetAnalysisModel | null;
  ready: boolean;
  compact?: boolean;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
};

export const SpendingCommandCenter: React.FC<Props> = ({
  model,
  ready,
  compact = false,
  setActivePage,
  triggerPageAction,
}) => {
  const { formatCurrencyString } = useFormatCurrency();
  const workspace = useAnalyticsWorkspaceOptional();
  const summary = model?.summary;

  const monthStartDay = model?.monthStartDay ?? 1;
  const { daysTotal, daysElapsed, daysLeft } = financialMonthDaysRemaining(new Date(), monthStartDay);
  const burnPace =
    summary && daysElapsed > 0 ? (summary.expenseSar / daysElapsed) * daysTotal : 0;

  const kpis = (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiCard label="Spent FMTD" value={formatCurrencyString(summary?.expenseSar ?? 0, { digits: 0 })} />
      <KpiCard label="Envelope" value={formatCurrencyString(summary?.budgetedSar ?? 0, { digits: 0 })} />
      <KpiCard
        label="Variance"
        value={formatCurrencyString(summary?.budgetVarianceSar ?? 0, { digits: 0 })}
        tone={(summary?.budgetVarianceSar ?? 0) >= 0 ? 'good' : 'bad'}
      />
      <KpiCard label="Burn pace" value={formatCurrencyString(burnPace, { digits: 0 })} sub="proj. month-end" />
      <KpiCard
        label="Savings rate"
        value={summary?.savingsRatePct != null ? `${summary.savingsRatePct.toFixed(1)}%` : '—'}
      />
      <KpiCard
        label="Categorized"
        value={summary ? `${summary.categorizedSharePct.toFixed(0)}%` : '—'}
      />
    </div>
  );

  if (compact) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Spending command center</h2>
            <p className="text-xs text-slate-500">
              {model?.periodLabel ?? 'Current financial month'}
              {model?.periodPreset && model.periodPreset !== 'MTD' ? ` · ${model.periodPreset}` : ''}
              {' · SAR · tx-dated FX'}
              {model?.scope === 'household' ? ' · Household' : ' · Personal'}
              {daysLeft > 0 ? ` · ${daysLeft} days left` : ''}
            </p>
          </div>
          {setActivePage && (
            <button type="button" className="btn-secondary text-sm" onClick={() => setActivePage('Analysis')}>
              Full analysis
            </button>
          )}
        </div>
        {!ready ? (
          <p className="text-sm text-slate-500">Computing spending model…</p>
        ) : (
          kpis
        )}
        {ready && model && model.overBudgetCategories.length > 0 && (
          <ul className="text-sm space-y-1">
            {model.overBudgetCategories.slice(0, 4).map((c: { category: string; utilizationPct: number }) => (
              <li key={c.category} className="flex justify-between gap-2">
                <button
                  type="button"
                  className="text-primary hover:underline text-left truncate"
                  onClick={() =>
                    triggerSpendingDrillDown(
                      triggerPageAction,
                      setActivePage,
                      buildBudgetDrillDownAction({ budgetCategory: c.category, monthStartDay: model.monthStartDay }),
                      { setSelectedCategory: workspace?.setSelectedCategory },
                    )
                  }
                >
                  {c.category}
                </button>
                <span className="tabular-nums font-medium text-rose-700">{c.utilizationPct.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-white p-4 shadow-sm space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Spending command center</h2>
        <p className="text-xs text-slate-600">
          Amounts in SAR (transaction-dated FX). Scope: <strong>{model?.scope === 'household' ? 'Household ledger' : 'Personal'}</strong>.
        </p>
        {kpis}
      </div>
      {ready && model && model.driftRows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Budget drift vs 3-month baseline</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {model.driftRows.slice(0, 6).map((d) => (
              <li key={d.category} className="flex justify-between gap-3 py-2">
                <button
                  type="button"
                  className="text-primary hover:underline text-left truncate"
                  onClick={() =>
                    triggerSpendingDrillDown(
                      triggerPageAction,
                      setActivePage,
                      buildBudgetDrillDownAction({ budgetCategory: d.category, monthStartDay: model.monthStartDay }),
                      { setSelectedCategory: workspace?.setSelectedCategory },
                    )
                  }
                >
                  {d.category}
                </button>
                <span className={`tabular-nums font-medium ${d.driftPct > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {d.driftPct > 0 ? '+' : ''}
                  {d.driftPct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <DeferredMount minHeight="12rem" staggerIndex={0}>
        <ExpenseBudgetAnalysisPanel
          model={model}
          ready={ready}
          setActivePage={setActivePage}
          triggerPageAction={triggerPageAction}
        />
      </DeferredMount>
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string; sub?: string; tone?: 'good' | 'bad' }> = ({
  label,
  value,
  sub,
  tone,
}) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p
      className={`text-lg font-bold tabular-nums ${
        tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900'
      }`}
    >
      {value}
    </p>
    {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
  </div>
);

export default SpendingCommandCenter;
