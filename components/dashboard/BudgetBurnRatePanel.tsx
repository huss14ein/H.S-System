import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Account, Budget, FinancialData, Transaction } from '../../types';
import {
  budgetsForFinancialMonthView,
  financialMonthLabel,
  financialMonthRange,
  resolveMonthStartDayFromData,
} from '../../utils/financialMonth';
import { aggregatePersonalBudgetCategorySpendSar } from '../../services/budgetSpendMath';
import { budgetMonthlyEquivalentSar } from '../../services/goalProjectionFunding';
import { DashboardVisualCard } from './DashboardVisualCard';
import { dashboardChartMargin } from './chartLayout';

type ChartRow = {
  label: string;
  spent: number;
  remaining: number;
  pct: number;
  status: 'ok' | 'near' | 'over' | 'unbudgeted';
  hasLimit: boolean;
};

const BudgetBurnRatePanelInner: React.FC<{
  data: FinancialData | null | undefined;
  budgets: Budget[];
  transactions: Transaction[];
  accounts: Account[];
  uiExchangeRate: number;
}> = ({ data, budgets, transactions, accounts, uiExchangeRate }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const { rows, periodLabel, mode } = useMemo((): {
    rows: ChartRow[];
    periodLabel: string;
    mode: 'budgeted' | 'spend_only';
  } => {
    if (!data) return { rows: [], periodLabel: '', mode: 'budgeted' };
    const monthStartDay = resolveMonthStartDayFromData(data);
    const { start, end, key } = financialMonthRange(new Date(), monthStartDay);
    const periodLabel = financialMonthLabel(key, monthStartDay);

    const accountCurrencyById = new Map<string, 'SAR' | 'USD'>(
      accounts.map((a) => [a.id, a.currency === 'USD' ? 'USD' : 'SAR']),
    );
    const spentByBudgetCat = aggregatePersonalBudgetCategorySpendSar(
      transactions,
      start,
      end,
      accountCurrencyById,
      data,
      uiExchangeRate,
    );

    const activeBudgets = budgetsForFinancialMonthView(budgets ?? [], key, monthStartDay);

    if (activeBudgets.length > 0) {
      const budgetedRows = activeBudgets
        .map((b) => {
          const cat = String(b.category ?? '').trim() || 'Other';
          const spent = spentByBudgetCat.get(cat) ?? 0;
          const lim = Math.max(0, budgetMonthlyEquivalentSar(b));
          const pct = lim > 0 ? spent / lim : spent > 0 ? 1 : 0;
          const status: ChartRow['status'] = pct >= 1 ? 'over' : pct >= 0.85 ? 'near' : 'ok';
          return {
            label: cat.length > 14 ? `${cat.slice(0, 14)}…` : cat,
            spent,
            remaining: Math.max(0, lim - spent),
            pct,
            status,
            hasLimit: lim > 0,
          };
        })
        .filter((r) => r.spent > 0 || r.hasLimit)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);
      return { rows: budgetedRows, periodLabel, mode: 'budgeted' };
    }

    const spendOnlyRows = [...spentByBudgetCat.entries()]
      .filter(([, spent]) => spent > 0)
      .map(([cat, spent]) => ({
        label: cat.length > 14 ? `${cat.slice(0, 14)}…` : cat,
        spent,
        remaining: 0,
        pct: 1,
        status: 'unbudgeted' as const,
        hasLimit: false,
      }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 8);

    return { rows: spendOnlyRows, periodLabel, mode: 'spend_only' };
  }, [accounts, budgets, data, transactions, uiExchangeRate]);

  const statusColor = (s: ChartRow['status']) =>
    s === 'over' ? '#f43f5e' : s === 'near' ? '#f59e0b' : s === 'unbudgeted' ? '#6366f1' : '#10b981';

  const emptyMessage =
    t('apply') === 'تطبيق'
      ? 'لا توجد مصروفات في الشهر المالي الحالي.'
      : 'No expenses in the current financial month.';

  return (
    <DashboardVisualCard
      dir={dir}
      accent="rose"
      title={t('burnRate')}
      subtitle={periodLabel ? `${t('budgetIntel')} · ${periodLabel}` : t('budgetIntel')}
    >
      {!rows.length ? (
        <p className="text-sm text-slate-500 py-6 text-center">{emptyMessage}</p>
      ) : mode === 'spend_only' ? (
        <div className="space-y-3">
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {t('apply') === 'تطبيق'
              ? 'لا توجد ميزانيات لهذا الشهر المالي — يعرض أعلى فئات الصرف.'
              : 'No budget envelopes for this financial month — showing top spend categories.'}
          </p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="flex justify-between gap-2 text-sm">
                <span className="text-slate-700 truncate">{r.label}</span>
                <span className="font-semibold tabular-nums text-slate-900 shrink-0">
                  {formatCurrencyString(r.spent, { digits: 0 })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={dashboardChartMargin(dir)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={72} tick={{ fontSize: 10, fill: '#475569' }} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const spent = Number(payload.find((p) => p.dataKey === 'spent')?.value ?? 0);
                  const rem = Number(payload.find((p) => p.dataKey === 'remaining')?.value ?? 0);
                  const row = rows.find((r) => r.label === label);
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <p className="font-semibold text-slate-800">{label}</p>
                      <p className="text-rose-700 tabular-nums">
                        {t('burnRate')}: {formatCurrencyString(spent, { digits: 0 })}
                      </p>
                      {row?.hasLimit ? (
                        <p className="text-emerald-700 tabular-nums">{formatCurrencyString(rem, { digits: 0 })} left</p>
                      ) : null}
                    </div>
                  );
                }}
              />
              <Bar dataKey="spent" stackId="a" radius={[0, 0, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={`s-${r.label}`} fill={statusColor(r.status)} />
                ))}
              </Bar>
              <Bar dataKey="remaining" stackId="a" fill="#e2e8f0" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardVisualCard>
  );
};

export const BudgetBurnRatePanel = React.memo(BudgetBurnRatePanelInner);
