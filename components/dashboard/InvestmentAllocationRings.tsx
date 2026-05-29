import React, { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { HeadlineInvestmentAllocationSlices } from '../../services/headlineInvestmentAllocation';
import { DashboardVisualCard } from './DashboardVisualCard';

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6'];

export const InvestmentAllocationRings: React.FC<{
  allocation: HeadlineInvestmentAllocationSlices;
  investmentsTotalSar: number;
}> = React.memo(function InvestmentAllocationRings({ allocation, investmentsTotalSar }) {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const assetSlices = useMemo(
    () =>
      (allocation.assetClassAllocation ?? [])
        .filter((r) => r.value > 0)
        .map((r, i) => ({ name: r.name, value: r.value, color: PALETTE[i % PALETTE.length]! })),
    [allocation.assetClassAllocation],
  );

  const platformSlices = useMemo(
    () =>
      (allocation.portfolioAllocation ?? [])
        .filter((r) => r.value > 0)
        .slice(0, 8)
        .map((r, i) => ({ name: r.name, value: r.value, color: PALETTE[(i + 2) % PALETTE.length]! })),
    [allocation.portfolioAllocation],
  );

  const renderRing = (data: { name: string; value: number; color: string }[], label: string) => (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-2 text-center">{label}</p>
      <div className="h-[200px]">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={72} paddingAngle={2}>
                {data.map((s) => (
                  <Cell key={s.name} fill={s.color} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as { name: string; value: number };
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <p className="font-semibold">{p.name}</p>
                      <p className="tabular-nums">{formatCurrencyString(p.value, { digits: 0 })}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">—</div>
        )}
      </div>
    </div>
  );

  return (
    <DashboardVisualCard
      dir={dir}
      accent="sky"
      title={t('allocationRings')}
      subtitle={`${t('investedCapital')}: ${formatCurrencyString(investmentsTotalSar, { digits: 0 })}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {renderRing(assetSlices, language === 'ar' ? 'فئات الأصول' : 'Asset classes')}
        {renderRing(platformSlices, language === 'ar' ? 'منصات / محافظ' : 'Platforms & portfolios')}
      </div>
    </DashboardVisualCard>
  );
});
