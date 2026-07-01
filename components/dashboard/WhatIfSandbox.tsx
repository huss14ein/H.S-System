import React, { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { FinancialData, Goal } from '../../types';
import {
  averageRollingMonthlyNetSurplus,
  computeGoalResolvedAmountsSar,
  GOAL_NET_CASHFLOW_LOOKBACK_MONTHS,
} from '../../services/goalResolvedTotals';
import { normalizedMonthlyExpenseSar } from '../../services/financeMetrics';
import { getPersonalAccounts, getPersonalTransactions } from '../../utils/wealthScope';
import { dashboardChartMargin } from './chartLayout';
import { DashboardVisualCard } from './DashboardVisualCard';

type Point = { month: string; base: number; scenario: number };

function addMonths(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + delta);
  return d;
}

const WhatIfSandboxInner: React.FC<{
  data: FinancialData | null | undefined;
  goals: Goal[];
  sarPerUsd: number;
  liquidCashSar: number;
  investmentsTotalSar: number;
}> = ({ data, goals, sarPerUsd, liquidCashSar, investmentsTotalSar }) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const [allocPct, setAllocPct] = useState(25);
  const [eduBumpPct, setEduBumpPct] = useState(0);

  const baseMonthlyNetSar = useMemo(() => {
    if (!data) return 0;
    return averageRollingMonthlyNetSurplus(data, GOAL_NET_CASHFLOW_LOOKBACK_MONTHS, sarPerUsd);
  }, [data, sarPerUsd]);

  const eduExpenseMonthly = useMemo(() => {
    if (!data) return 0;
    const accounts = getPersonalAccounts(data);
    const txs = getPersonalTransactions(data);
    const avg = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1, data });
    const eduTagged = txs.filter((tx) => {
      const cat = String(tx.budgetCategory ?? tx.category ?? '').toLowerCase();
      return /(edu|school|tuition|university|college|kids|child)/i.test(cat);
    });
    if (!eduTagged.length) return avg * 0.15;
    return avg;
  }, [data, sarPerUsd]);

  const scenarioMonthlyNetSar = useMemo(() => {
    const bump = (eduExpenseMonthly * Math.max(0, eduBumpPct)) / 100;
    return Math.max(0, baseMonthlyNetSar - bump);
  }, [baseMonthlyNetSar, eduBumpPct, eduExpenseMonthly]);

  const chart = useMemo(() => {
    if (!data) return [] as Point[];
    const g = (goals ?? []).filter((x) => Number(x.targetAmount) > 0);
    const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
    const currentTotal = g.reduce((s, x) => s + Math.max(0, resolved.get(x.id) ?? (Number(x.currentAmount) || 0)), 0);

    const alloc = Math.max(0, Math.min(100, allocPct)) / 100;
    const shiftToInvest = liquidCashSar * alloc;
    const scenarioStart = currentTotal + shiftToInvest;

    const now = new Date();
    const out: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const m = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), i);
      const label = m.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', year: '2-digit' });
      const base = Math.max(0, currentTotal + baseMonthlyNetSar * i);
      const scenario = Math.max(0, scenarioStart + scenarioMonthlyNetSar * i);
      out.push({ month: label, base, scenario });
    }
    return out;
  }, [allocPct, baseMonthlyNetSar, data, goals, language, liquidCashSar, sarPerUsd, scenarioMonthlyNetSar]);

  return (
    <DashboardVisualCard
      dir={dir}
      accent="violet"
      title={t('whatIf')}
      subtitle={language === 'ar' ? 'اضبط التخصيص والمصروفات لرؤية الأثر على مسار الأهداف.' : 'Slide allocation & expenses to see goal trajectory impact.'}
      action={
        <span className="text-xs text-slate-500 tabular-nums">
          {t('investedCapital')}: {formatCurrencyString(investmentsTotalSar, { digits: 0 })}
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="text-xs font-semibold text-slate-700">{t('allocationToInvestments')}</label>
          <input
            type="range"
            min={0}
            max={100}
            value={allocPct}
            onChange={(e) => setAllocPct(Number(e.target.value))}
            className="mt-2 w-full accent-violet-600"
          />
          <p className="mt-1 text-xs text-slate-600 tabular-nums">
            {allocPct}% · {formatCurrencyString(liquidCashSar * (allocPct / 100), { digits: 0 })}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="text-xs font-semibold text-slate-700">{t('educationExpenseBump')}</label>
          <input
            type="range"
            min={0}
            max={50}
            value={eduBumpPct}
            onChange={(e) => setEduBumpPct(Number(e.target.value))}
            className="mt-2 w-full accent-amber-500"
          />
          <p className="mt-1 text-xs text-slate-600 tabular-nums">
            +{eduBumpPct}% · {language === 'ar' ? 'صافي شهري' : 'Monthly net'}:{' '}
            <span className={scenarioMonthlyNetSar >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
              {formatCurrencyString(scenarioMonthlyNetSar, { digits: 0 })}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={dashboardChartMargin(dir)}>
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
                      {language === 'ar' ? 'أساس' : 'Base'}: <span className="font-semibold">{formatCurrencyString(p.base, { digits: 0 })}</span>
                    </p>
                    <p className="mt-0.5 tabular-nums text-violet-800">
                      {t('whatIf')}: <span className="font-semibold">{formatCurrencyString(p.scenario, { digits: 0 })}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="base" stroke="#94a3b8" fill="#cbd5e1" fillOpacity={0.25} strokeWidth={2} />
            <Area type="monotone" dataKey="scenario" stroke="#7c3aed" fill="#c4b5fd" fillOpacity={0.45} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardVisualCard>
  );
};

export const WhatIfSandbox = React.memo(WhatIfSandboxInner);
