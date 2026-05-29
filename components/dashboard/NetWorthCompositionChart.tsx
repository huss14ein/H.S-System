import React, { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { PersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';
import { DashboardVisualCard } from './DashboardVisualCard';

type Slice = { name: string; value: number; color: string };

export const NetWorthCompositionChart: React.FC<{
  buckets: PersonalNetWorthChartBucketsSAR;
  netWorthSar: number;
}> = React.memo(function NetWorthCompositionChart({ buckets, netWorthSar }) {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const slices = useMemo((): Slice[] => {
    const rows: Slice[] = [
      { name: language === 'ar' ? 'نقد' : 'Cash', value: Math.max(0, buckets.cash), color: '#0ea5e9' },
      { name: language === 'ar' ? 'استثمارات' : 'Investments', value: Math.max(0, buckets.investments), color: '#6366f1' },
      { name: language === 'ar' ? 'عقارات ومشتقات' : 'Physical & commodities', value: Math.max(0, buckets.physicalAndCommodities), color: '#f59e0b' },
      { name: language === 'ar' ? 'مستحقات' : 'Receivables', value: Math.max(0, buckets.receivables), color: '#10b981' },
    ].filter((s) => s.value > 0);
    return rows;
  }, [buckets, language]);

  const debt = Math.max(0, buckets.liabilities);

  return (
    <DashboardVisualCard
      dir={dir}
      accent="violet"
      title={t('wealthComposition')}
      subtitle={t('wealthCompositionHint')}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="h-[260px]">
          {slices.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload as Slice;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                        <p className="font-semibold text-slate-800">{p.name}</p>
                        <p className="tabular-nums text-slate-700">{formatCurrencyString(p.value, { digits: 0 })}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">—</div>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl bg-violet-600/90 text-white px-4 py-3 shadow-md">
            <p className="text-xs uppercase tracking-wider opacity-90">{t('netWorth')}</p>
            <p className="text-2xl font-extrabold tabular-nums">{formatCurrencyString(netWorthSar, { digits: 0 })}</p>
          </div>
          <ul className="space-y-2">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate text-slate-700">{s.name}</span>
                </span>
                <span className="tabular-nums font-semibold text-slate-900">{formatCurrencyString(s.value, { digits: 0 })}</span>
              </li>
            ))}
            {debt > 0 && (
              <li className="flex items-center justify-between gap-2 text-sm border-t border-slate-200 pt-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <span className="text-rose-800">{language === 'ar' ? 'الديون' : 'Liabilities'}</span>
                </span>
                <span className="tabular-nums font-semibold text-rose-700">−{formatCurrencyString(debt, { digits: 0 })}</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </DashboardVisualCard>
  );
});
