import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Account, Budget, FinancialData, Transaction } from '../../types';
import { resolveMonthStartDayFromData, financialMonthRange } from '../../utils/financialMonth';
import { aggregatePersonalBudgetCategorySpendSar } from '../../services/budgetSpendMath';
import { budgetMonthlyEquivalentSar } from '../../services/goalProjectionFunding';
import { DashboardVisualCard } from './DashboardVisualCard';
import { dashboardChartMargin } from './chartLayout';

type ChartRow = { label: string; spent: number; remaining: number; pct: number; status: 'ok' | 'near' | 'over' };

const BudgetBurnRatePanelInner: React.FC<{
  data: FinancialData | null | undefined;
  budgets: Budget[];
  transactions: Transaction[];
  accounts: Account[];
  uiExchangeRate: number;
}> = ({ data, budgets, transactions, accounts, uiExchangeRate }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const rows = useMemo((): ChartRow[] => {
    if (!data) return [];
    const monthStartDay = resolveMonthStartDayFromData(data);
    const { start, end, key } = financialMonthRange(new Date(), monthStartDay);
    const activeBudgets = (budgets ?? []).filter((b) => Number(b.month) === key.month && Number(b.year) === key.year);
    if (!activeBudgets.length) return [];

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

    return activeBudgets
      .map((b) => {
        const cat = String(b.category ?? '').trim() || 'Other';
        const spent = spentByBudgetCat.get(cat) ?? 0;
        const lim = Math.max(0, budgetMonthlyEquivalentSar(b));
        const pct = lim > 0 ? spent / lim : 0;
        const status = pct >= 1 ? 'over' : pct >= 0.85 ? 'near' : 'ok';
        return {
          label: cat.length > 14 ? `${cat.slice(0, 14)}…` : cat,
          spent,
          remaining: Math.max(0, lim - spent),
          pct,
          status: status as ChartRow['status'],
        };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [accounts, budgets, data, transactions, uiExchangeRate]);

  const statusColor = (s: ChartRow['status']) => (s === 'over' ? '#f43f5e' : s === 'near' ? '#f59e0b' : '#10b981');

  return (
    <DashboardVisualCard dir={dir} accent="rose" title={t('burnRate')} subtitle={t('budgetIntel')}>
      {!rows.length ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          {t('apply') === 'تطبيق' ? 'لا توجد ميزانيات لهذا الشهر.' : 'No budgets for this month.'}
        </p>
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
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <p className="font-semibold text-slate-800">{label}</p>
                      <p className="text-rose-700 tabular-nums">{t('burnRate')}: {formatCurrencyString(spent, { digits: 0 })}</p>
                      <p className="text-emerald-700 tabular-nums">{formatCurrencyString(rem, { digits: 0 })} left</p>
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
