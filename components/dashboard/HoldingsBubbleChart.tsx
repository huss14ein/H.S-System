import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Holding, InvestmentPortfolio, TradeCurrency } from '../../types';
import { effectiveHoldingValueInBookCurrency } from '../../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../../utils/investmentPortfolioCurrency';
import { toSAR } from '../../utils/currencyMath';
import { DashboardVisualCard } from './DashboardVisualCard';
import { dashboardChartMargin } from './chartLayout';

type Row = { symbol: string; value: number; roi: number | null };

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export const HoldingsBubbleChart: React.FC<{
  portfolios: InvestmentPortfolio[];
  simulatedPrices: Record<string, { price: number }>;
  sarPerUsd: number;
}> = React.memo(function HoldingsBubbleChart({ portfolios, simulatedPrices, sarPerUsd }) {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    for (const p of portfolios ?? []) {
      const book = resolveInvestmentPortfolioCurrency(p) as TradeCurrency;
      for (const h of (p.holdings ?? []) as Holding[]) {
        const sym = String(h.symbol ?? '').trim().toUpperCase();
        if (!sym) continue;
        const qty = safeNum(h.quantity);
        const valueBook = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
        const marketValueSar = toSAR(valueBook, book, sarPerUsd);
        const avg = toSAR(safeNum(h.avgCost), book, sarPerUsd);
        const cost = avg * qty;
        const roi = cost > 1e-6 ? (marketValueSar - cost) / cost : null;
        out.push({ symbol: sym, value: marketValueSar, roi });
      }
    }
    return out.sort((a, b) => b.value - a.value).slice(0, 12);
  }, [portfolios, sarPerUsd, simulatedPrices]);

  const maxVal = useMemo(() => Math.max(1, ...rows.map((r) => r.value)), [rows]);

  return (
    <DashboardVisualCard
      dir={dir}
      accent="amber"
      title={t('holdingsMap')}
      subtitle={language === 'ar' ? 'طول الشريط = القيمة · اللون = العائد' : 'Bar length = value · color = return'}
    >
      {!rows.length ? (
        <p className="text-sm text-slate-500 py-8 text-center">{language === 'ar' ? 'لا توجد مقتنيات.' : 'No holdings to chart.'}</p>
      ) : (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={dashboardChartMargin(dir)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, maxVal * 1.08]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${Math.round(Number(v))}`)}
              />
              <YAxis type="category" dataKey="symbol" width={56} tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as Row;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <p className="font-bold text-slate-800">{p.symbol}</p>
                      <p className="tabular-nums">{formatCurrencyString(p.value, { digits: 0 })}</p>
                      {p.roi != null && (
                        <p className={`tabular-nums font-semibold ${p.roi >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          ROI {(p.roi * 100).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={22}>
                {rows.map((r) => {
                  const roi = r.roi ?? 0;
                  const fill = roi >= 0.15 ? '#10b981' : roi >= 0 ? '#6366f1' : roi >= -0.1 ? '#f59e0b' : '#f43f5e';
                  return <Cell key={r.symbol} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardVisualCard>
  );
});
