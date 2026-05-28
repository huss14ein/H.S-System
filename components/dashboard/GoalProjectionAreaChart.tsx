import React, { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { FinancialData, Goal } from '../../types';
import {
  averageRollingMonthlyNetSurplus,
  computeGoalResolvedAmountsSar,
  GOAL_NET_CASHFLOW_LOOKBACK_MONTHS,
} from '../../services/goalResolvedTotals';

type Point = { month: string; projected: number; targetTotal: number };

function addMonths(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + delta);
  return d;
}

export const GoalProjectionAreaChart: React.FC<{
  data: FinancialData | null | undefined;
  goals: Goal[];
  sarPerUsd: number;
}> = ({ data, goals, sarPerUsd }) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const model = useMemo(() => {
    const g = (goals ?? []).filter((x) => Number(x.targetAmount) > 0);
    if (!g.length || !data) return { points: [] as Point[], monthlyNetSar: 0, targetTotal: 0 };

    const monthlyNetSar = averageRollingMonthlyNetSurplus(
      data,
      GOAL_NET_CASHFLOW_LOOKBACK_MONTHS,
      sarPerUsd,
    );
    const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
    const currentTotal = g.reduce((s, x) => s + Math.max(0, resolved.get(x.id) ?? (Number(x.currentAmount) || 0)), 0);
    const targetTotal = g.reduce((s, x) => s + Math.max(0, Number(x.targetAmount) || 0), 0);

    const now = new Date();
    const points: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const m = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), i);
      const projected = Math.max(0, currentTotal + monthlyNetSar * i);
      points.push({
        month: m.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', year: '2-digit' }),
        projected,
        targetTotal,
      });
    }
    return { points, monthlyNetSar, targetTotal };
  }, [data, goals, language, sarPerUsd]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('projection')}</p>
          <p className="mt-1 text-sm text-slate-700">
            {t('apply') === 'تطبيق'
              ? `توقع مساهمة شهرية مبنية على متوسط صافي التدفق (${GOAL_NET_CASHFLOW_LOOKBACK_MONTHS} أشهر — نفس صفحة الأهداف).`
              : `Monthly projection from rolling net cashflow (${GOAL_NET_CASHFLOW_LOOKBACK_MONTHS} mo avg — same as Goals page).`}
          </p>
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {t('apply') === 'تطبيق' ? 'متوسط صافي شهري' : 'Avg monthly net'}:{' '}
          <span className={model.monthlyNetSar >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
            {formatCurrencyString(model.monthlyNetSar, { digits: 0 })}
          </span>
        </div>
      </div>

      <div className="mt-3 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={model.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} interval={5} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v) => (Math.abs(Number(v)) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${Math.round(Number(v))}`)}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as Point | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                    <p className="font-semibold text-slate-800">{label}</p>
                    <p className="mt-1 tabular-nums text-slate-700">
                      {t('projection')}: <span className="font-semibold">{formatCurrencyString(p.projected, { digits: 0 })}</span>
                    </p>
                    <p className="mt-0.5 tabular-nums text-slate-700">
                      {t('apply') === 'تطبيق' ? 'إجمالي الأهداف' : 'Targets total'}:{' '}
                      <span className="font-semibold">{formatCurrencyString(p.targetTotal, { digits: 0 })}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="projected" stroke="#6366f1" fill="#a5b4fc" fillOpacity={0.45} strokeWidth={2} />
            <Area type="monotone" dataKey="targetTotal" stroke="#10b981" fill="#bbf7d0" fillOpacity={0.18} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
