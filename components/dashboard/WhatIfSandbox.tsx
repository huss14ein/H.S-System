import React, { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Account, Goal, Transaction } from '../../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi, isInternalTransferTransaction } from '../../services/transactionFilters';
import { getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { toSAR } from '../../utils/currencyMath';
import { accountBookCurrency } from '../../utils/cashAccountDisplay';

type Point = { month: string; base: number; scenario: number };

function addMonths(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + delta);
  return d;
}

export const WhatIfSandbox: React.FC<{
  goals: Goal[];
  transactions: Transaction[];
  accounts: Account[];
  data: any;
  uiExchangeRate: number;
  liquidCashSar: number;
  investedSar: number;
}> = ({ goals, transactions, accounts, data, uiExchangeRate, liquidCashSar, investedSar }) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const [allocPct, setAllocPct] = useState(25);
  const [eduBumpPct, setEduBumpPct] = useState(0);

  const baseMonthlyNetSar = useMemo(() => {
    const now = new Date();
    const start = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -6);
    const accById = new Map(accounts.map((a) => [a.id, a]));
    let income = 0;
    let expenses = 0;
    for (const tx of transactions ?? []) {
      if (!tx?.date) continue;
      const ts = new Date(tx.date).getTime();
      if (!Number.isFinite(ts) || ts < start.getTime()) continue;
      if (isInternalTransferTransaction(tx)) continue;
      const day = String(tx.date).slice(0, 10);
      const rate = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : uiExchangeRate;
      const cur = accountBookCurrency(accById.get(tx.accountId) as any) as 'SAR' | 'USD';
      const amtSar = toSAR(Math.abs(Number(tx.amount) || 0), cur, rate);
      if (countsAsIncomeForCashflowKpi(tx)) income += amtSar;
      if (countsAsExpenseForCashflowKpi(tx)) expenses += amtSar;
    }
    return (income - expenses) / 6;
  }, [accounts, data, transactions, uiExchangeRate]);

  const eduExpenseMonthly = useMemo(() => {
    const now = new Date();
    const start = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -1);
    const end = new Date();
    const accById = new Map(accounts.map((a) => [a.id, a]));
    let edu = 0;
    for (const tx of transactions ?? []) {
      if (!tx?.date) continue;
      const ts = new Date(tx.date).getTime();
      if (!Number.isFinite(ts) || ts < start.getTime() || ts > end.getTime()) continue;
      if (!countsAsExpenseForCashflowKpi(tx) || isInternalTransferTransaction(tx)) continue;
      const cat = String(tx.budgetCategory ?? tx.category ?? '').toLowerCase();
      if (!/(edu|school|tuition|university|college|kids|child)/i.test(cat)) continue;
      const day = String(tx.date).slice(0, 10);
      const rate = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : uiExchangeRate;
      const cur = accountBookCurrency(accById.get(tx.accountId) as any) as 'SAR' | 'USD';
      edu += toSAR(Math.abs(Number(tx.amount) || 0), cur, rate);
    }
    return edu;
  }, [accounts, data, transactions, uiExchangeRate]);

  const scenarioMonthlyNetSar = useMemo(() => {
    const bump = (eduExpenseMonthly * Math.max(0, eduBumpPct)) / 100;
    return baseMonthlyNetSar - bump;
  }, [baseMonthlyNetSar, eduBumpPct, eduExpenseMonthly]);

  const chart = useMemo(() => {
    const g = (goals ?? []).filter((x) => Number(x.targetAmount) > 0);
    const currentTotal = g.reduce((s, x) => s + Math.max(0, Number(x.currentAmount) || 0), 0);

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
  }, [allocPct, baseMonthlyNetSar, goals, language, liquidCashSar, scenarioMonthlyNetSar]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('whatIf')}</p>
          <p className="mt-1 text-sm text-slate-700">
            {language === 'ar'
              ? 'اضبط التخصيص والمصروفات لرؤية الأثر على مسار الأهداف.'
              : 'Adjust allocation and expenses to see impact on your goal trajectory.'}
          </p>
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {t('investedCapital')}: {formatCurrencyString(investedSar, { digits: 0 })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <AreaChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
    </div>
  );
};
