import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Account, Transaction } from '../../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi, isInternalTransferTransaction } from '../../services/transactionFilters';
import { getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { toSAR } from '../../utils/currencyMath';
import { accountBookCurrency } from '../../utils/cashAccountDisplay';

type Row = { key: string; label: string; inflow: number; outflow: number; net: number };

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string, lang: 'en' | 'ar'): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', year: '2-digit' });
}

function inRange(iso: string, start?: string, end?: string): boolean {
  const day = (iso || '').slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

export const MomCashflowTrendChart: React.FC<{
  transactions: Transaction[];
  accounts: Account[];
  data: any;
  uiExchangeRate: number;
  startIso?: string;
  endIso?: string;
}> = ({ transactions, accounts, data, uiExchangeRate, startIso, endIso }) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const rows = useMemo(() => {
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const bucket = new Map<string, { inflow: number; outflow: number }>();
    const push = (k: string, inflow: number, outflow: number) => {
      const prev = bucket.get(k) ?? { inflow: 0, outflow: 0 };
      bucket.set(k, { inflow: prev.inflow + inflow, outflow: prev.outflow + outflow });
    };

    for (const tx of transactions) {
      if (!tx?.date) continue;
      if (!inRange(tx.date, startIso, endIso)) continue;
      if (isInternalTransferTransaction(tx)) continue;
      const key = monthKey(new Date(tx.date));
      const day = String(tx.date).slice(0, 10);
      const rate = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : uiExchangeRate;
      const cur = accountBookCurrency(accById.get(tx.accountId) as any) as 'SAR' | 'USD';
      const amtSar = toSAR(Math.abs(Number(tx.amount) || 0), cur, rate);
      if (countsAsIncomeForCashflowKpi(tx)) push(key, amtSar, 0);
      if (countsAsExpenseForCashflowKpi(tx)) push(key, 0, amtSar);
    }

    const keys = Array.from(bucket.keys()).sort((a, b) => a.localeCompare(b)).slice(-12);
    const out: Row[] = keys.map((k) => {
      const v = bucket.get(k)!;
      const net = v.inflow - v.outflow;
      return { key: k, label: monthLabel(k, language), inflow: v.inflow, outflow: v.outflow, net };
    });
    return out;
  }, [accounts, data, language, startIso, endIso, transactions, uiExchangeRate]);

  const maxVal = useMemo(() => {
    const m = rows.reduce((mx, r) => Math.max(mx, r.inflow, r.outflow), 0);
    return Math.max(1, m);
  }, [rows]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('cashflowTrend')}</p>
          <p className="mt-1 text-sm text-slate-700">
            {t('inflow')} vs {t('outflow')} ({t('executiveStatus')})
          </p>
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {rows.length ? `${rows[0]!.label} → ${rows[rows.length - 1]!.label}` : '—'}
        </div>
      </div>

      <div className="mt-3 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              domain={[0, maxVal * 1.15]}
              tickFormatter={(v) => (Math.abs(Number(v)) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${Math.round(Number(v))}`)}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as Row | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                    <p className="font-semibold text-slate-800">{label}</p>
                    <p className="mt-1 text-emerald-700 tabular-nums">
                      {t('inflow')}: <span className="font-semibold">{formatCurrencyString(p.inflow, { digits: 0 })}</span>
                    </p>
                    <p className="mt-0.5 text-rose-700 tabular-nums">
                      {t('outflow')}: <span className="font-semibold">{formatCurrencyString(p.outflow, { digits: 0 })}</span>
                    </p>
                    <p className={`mt-1 tabular-nums font-medium ${p.net >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                      Net: <span className="font-semibold">{formatCurrencyString(p.net, { digits: 0 })}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="inflow" name={t('inflow')} fill="#10b981" radius={[8, 8, 0, 0]} />
            <Bar dataKey="outflow" name={t('outflow')} fill="#fb7185" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

