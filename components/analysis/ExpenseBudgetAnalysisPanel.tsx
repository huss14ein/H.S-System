import React, { useMemo, useState, useEffect, startTransition } from 'react';
import type { ExpenseBudgetCategoryRow, ExpenseBudgetAnalysisModel } from '../../services/expenseBudgetAnalysisModel';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_COLORS, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber } from '../charts/chartTheme';
import ChartContainer from '../charts/ChartContainer';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, Line } from 'recharts';
import { SectionLoadingPlaceholder } from '../shared/SectionLoadingPlaceholder';
import { scheduleIdleWork } from '../../utils/runWhenIdle';

const TOOLTIP_STYLE = {
  backgroundColor: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  padding: '10px 14px',
};

function statusBadge(status: ExpenseBudgetCategoryRow['status']) {
  switch (status) {
    case 'over':
      return 'bg-red-100 text-red-900 ring-red-200';
    case 'critical':
      return 'bg-orange-100 text-orange-900 ring-orange-200';
    case 'watch':
      return 'bg-amber-100 text-amber-900 ring-amber-200';
    case 'healthy':
      return 'bg-emerald-100 text-emerald-900 ring-emerald-200';
    default:
      return 'bg-slate-100 text-slate-700 ring-slate-200';
  }
}

function priorityDot(p: 'high' | 'medium' | 'low') {
  if (p === 'high') return 'bg-red-500';
  if (p === 'medium') return 'bg-amber-500';
  return 'bg-emerald-500';
}

type Props = {
  model: ExpenseBudgetAnalysisModel | null;
  ready: boolean;
};

const ExpenseBudgetAnalysisPanel: React.FC<Props> = ({ model, ready }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const [chartsReady, setChartsReady] = useState(false);

  useEffect(() => {
    if (!ready || !model) {
      setChartsReady(false);
      return;
    }
    return scheduleIdleWork(() => {
      startTransition(() => setChartsReady(true));
    }, 80);
  }, [ready, model]);

  const budgetVsActualChart = useMemo(() => {
    if (!model) return [];
    return model.categories
      .filter((c) => c.spentSar > 0 || c.limitSar > 0)
      .slice(0, 10)
      .map((c) => ({
        name: c.category.length > 18 ? `${c.category.slice(0, 16)}…` : c.category,
        spent: Math.round(c.spentSar),
        limit: Math.round(c.limitSar),
        fullName: c.category,
      }));
  }, [model]);

  if (!ready || !model) {
    return (
      <div id="expense-budget-analysis" className="min-h-[12rem]">
        <SectionLoadingPlaceholder labelKey="sectionLoading" minHeight="12rem" />
      </div>
    );
  }

  const { summary, categories, insights, monthlyTrend, topTransactions, dataQuality } = model;
  const fmt = (n: number, digits = 0) => formatCurrencyString(n, { digits });
  const hasExpenses = summary.expenseSar > 0 || categories.some((c) => c.spentSar > 0);

  return (
    <div className="space-y-5" id="expense-budget-analysis">
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Expense & budget cockpit</p>
            <h2 className="text-xl font-bold text-slate-900 mt-1">Decision-ready spend analysis</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Built from your transaction tags (category, budget group, fixed/variable, core/discretionary, splits) and
              current financial-month envelopes — same math as Budgets and Dashboard KPIs.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-600 bg-white/80 border border-slate-200 rounded-lg px-3 py-1.5">
            Period: <strong className="text-slate-900">{model.periodLabel}</strong>
            {model.monthStartDay !== 1 && (
              <span className="block text-[10px] text-slate-500 mt-0.5">Month starts day {model.monthStartDay}</span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-sm">
            <p className="text-xs text-slate-500">Expenses (period)</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{fmt(summary.expenseSar)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{summary.transactionCount} approved lines</p>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-sm">
            <p className="text-xs text-slate-500">Budget envelopes</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{fmt(summary.budgetedSar)}</p>
            <p
              className={`text-[11px] mt-0.5 font-medium ${summary.budgetVarianceSar >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {summary.budgetVarianceSar >= 0 ? 'Under by ' : 'Over by '}
              {fmt(Math.abs(summary.budgetVarianceSar))}
            </p>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-sm">
            <p className="text-xs text-slate-500">Income (period)</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{fmt(summary.incomeSar)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Net {fmt(summary.netSar)}</p>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-sm">
            <p className="text-xs text-slate-500">Savings rate</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">
              {summary.savingsRatePct != null ? `${summary.savingsRatePct.toFixed(1)}%` : '—'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{summary.categorizedSharePct.toFixed(0)}% categorized</p>
          </div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Recommended actions</h3>
          <ul className="space-y-2">
            {insights.map((ins, i) => (
              <li
                key={`ins-${i}`}
                className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-sm"
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityDot(ins.priority)}`} aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{ins.title}</p>
                  <p className="text-slate-600 mt-0.5">{ins.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dataQuality.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-amber-950 mb-2">Data quality — fix for sharper limits</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-amber-950">
            {dataQuality.map((dq) => (
              <li key={dq.code} className="rounded-lg bg-white/70 border border-amber-100 px-3 py-2">
                <span className="font-semibold">{dq.label}</span>
                <span className="block tabular-nums">
                  {dq.count} tx · {fmt(dq.amountSar)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-h-[360px] flex flex-col">
          <h3 className="text-base font-semibold text-slate-900 mb-1">Budget vs actual (top categories)</h3>
          <p className="text-xs text-slate-500 mb-3">Spent vs envelope limit for the current financial month.</p>
          {chartsReady ? (
            <ChartContainer
              height={280}
              isEmpty={budgetVsActualChart.length === 0}
              emptyMessage="Set budget envelopes and record expenses to compare."
              className="flex-1"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={budgetVsActualChart} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                  <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} angle={-20} textAnchor="end" height={56} />
                  <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={11} />
                  <Tooltip
                    formatter={(v, name) => [fmt(Number(v)), name === 'spent' ? 'Spent' : 'Limit']}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="spent" name="Spent" fill={CHART_COLORS.negative} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="limit" name="Limit" fill={CHART_COLORS.primary} radius={[3, 3, 0, 0]} opacity={0.55} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <SectionLoadingPlaceholder labelKey="sectionLoading" minHeight="280px" />
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-h-[360px] flex flex-col">
          <h3 className="text-base font-semibold text-slate-900 mb-1">6-month cashflow vs budget</h3>
          <p className="text-xs text-slate-500 mb-3">Income, expenses, and total envelopes by financial month.</p>
          {chartsReady ? (
            <ChartContainer height={280} isEmpty={!hasExpenses} emptyMessage="No expense history yet." className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                  <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={11} />
                  <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={11} />
                  <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={TOOLTIP_STYLE} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="expenseSar" name="Expenses" fill={CHART_COLORS.negative} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="budgetedSar" name="Budgeted" fill={CHART_COLORS.primary} radius={[2, 2, 0, 0]} opacity={0.45} />
                  <Line type="monotone" dataKey="incomeSar" name="Income" stroke={CHART_COLORS.positive} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <SectionLoadingPlaceholder labelKey="sectionLoading" minHeight="280px" />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm overflow-hidden">
        <h3 className="text-base font-semibold text-slate-900 mb-3">Category detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3 font-semibold">Category</th>
                <th className="py-2 pr-3 font-semibold text-right">Spent</th>
                <th className="py-2 pr-3 font-semibold text-right">Limit</th>
                <th className="py-2 pr-3 font-semibold text-right">Left</th>
                <th className="py-2 pr-3 font-semibold text-right">Use %</th>
                <th className="py-2 pr-3 font-semibold text-right">vs prior mo</th>
                <th className="py-2 font-semibold">Tier</th>
              </tr>
            </thead>
            <tbody>
              {categories.filter((c) => c.spentSar > 0 || c.limitSar > 0).map((c) => (
                <tr key={c.category} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2 pr-3 font-medium text-slate-900">{c.category}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.spentSar)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                    {c.limitSar > 0 ? fmt(c.limitSar) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {c.limitSar > 0 ? (
                      <span className={c.remainingSar < 0 ? 'text-red-700 font-semibold' : 'text-slate-700'}>
                        {fmt(c.remainingSar)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${statusBadge(c.status)}`}
                    >
                      {c.limitSar > 0 ? `${c.utilizationPct.toFixed(0)}%` : 'No cap'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                    {c.momChangePct != null ? (
                      <span className={c.momChangePct > 10 ? 'text-amber-700 font-medium' : ''}>
                        {c.momChangePct >= 0 ? '+' : ''}
                        {c.momChangePct.toFixed(0)}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-600">{c.tier ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { title: 'By tier', rows: model.byTier },
          { title: 'Core vs discretionary', rows: model.byExpenseType },
          { title: 'Fixed vs variable', rows: model.byTransactionNature },
          { title: 'By account', rows: model.byAccount },
        ].map((block) => (
          <div key={block.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-slate-900 mb-2">{block.title}</h4>
            {block.rows.length === 0 ? (
              <p className="text-xs text-slate-500">No tagged spend in this period.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {block.rows.slice(0, 8).map((r) => (
                  <li key={r.label} className="flex justify-between gap-2">
                    <span className="text-slate-700 truncate">{r.label}</span>
                    <span className="font-semibold tabular-nums shrink-0">
                      {fmt(r.spentSar)} <span className="text-slate-400 font-normal">({r.sharePct.toFixed(0)}%)</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {topTransactions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-1">Largest transactions this period</h3>
          <p className="text-xs text-slate-500 mb-3">Full metadata you entered — use this to spot outliers and recategorize.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 text-right">Amount</th>
                  <th className="py-2 pr-2">Budget cat.</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Nature</th>
                  <th className="py-2">Account</th>
                </tr>
              </thead>
              <tbody>
                {topTransactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-2 pr-2 text-slate-600 whitespace-nowrap">{t.date.slice(0, 10)}</td>
                    <td className="py-2 pr-2 text-slate-800 max-w-[200px] truncate" title={t.description}>
                      {t.description}
                      {t.isSplit && <span className="ml-1 text-violet-600 font-medium">split</span>}
                    </td>
                    <td className="py-2 pr-2 text-right font-semibold tabular-nums">{fmt(t.amountSar)}</td>
                    <td className="py-2 pr-2">{t.budgetCategory || t.category || '—'}</td>
                    <td className="py-2 pr-2">{t.expenseType || '—'}</td>
                    <td className="py-2 pr-2">{t.transactionNature || '—'}</td>
                    <td className="py-2 truncate max-w-[100px]">{t.accountName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseBudgetAnalysisPanel;
