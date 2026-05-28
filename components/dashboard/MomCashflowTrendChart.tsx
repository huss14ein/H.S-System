import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { FinancialData } from '../../types';
import { personalMonthlyInflowOutflowByFinancialMonthSar } from '../../services/financeMetrics';
import { dashboardChartMargin, formatDashboardRangeLabel } from './chartLayout';

type Row = { key: string; label: string; inflow: number; outflow: number; net: number };

function monthLabel(key: string, lang: 'en' | 'ar'): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', year: '2-digit' });
}

function inRange(monthKey: string, start?: string, end?: string): boolean {
  if (start && monthKey < start.slice(0, 7)) return false;
  if (end && monthKey > end.slice(0, 7)) return false;
  return true;
}

const MomCashflowTrendChartInner: React.FC<{
  data: FinancialData | null | undefined;
  uiExchangeRate: number;
  startIso?: string;
  endIso?: string;
  monthsBack?: number;
}> = ({ data, uiExchangeRate, startIso, endIso, monthsBack = 12 }) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const rows = useMemo(() => {
    if (!data) return [] as Row[];
    const series = personalMonthlyInflowOutflowByFinancialMonthSar(data, uiExchangeRate, monthsBack);
    const out: Row[] = [];
    series.monthKeys.forEach((key, i) => {
      if (!inRange(key, startIso, endIso)) return;
      out.push({
        key,
        label: monthLabel(key, language),
        inflow: series.inflow[i] ?? 0,
        outflow: series.outflow[i] ?? 0,
        net: series.net[i] ?? 0,
      });
    });
    return out.slice(-12);
  }, [data, endIso, language, monthsBack, startIso, uiExchangeRate]);

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
          {rows.length ? formatDashboardRangeLabel(rows[0]!.label, rows[rows.length - 1]!.label) : '—'}
        </div>
      </div>

      <div className="mt-3 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={dashboardChartMargin(dir)}>
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

export const MomCashflowTrendChart = React.memo(MomCashflowTrendChartInner);
