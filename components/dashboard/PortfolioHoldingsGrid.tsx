import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Holding, InvestmentPortfolio } from '../../types';
import { lookupLiveQuoteForSymbol } from '../../services/finnhubService';

type Row = {
  key: string;
  symbol: string;
  name: string;
  shares: number;
  avgEntry: number;
  marketPrice: number | null;
  marketValue: number;
  roi: number | null;
  gainLoss: number | null;
};

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export const PortfolioHoldingsGrid: React.FC<{
  portfolios: InvestmentPortfolio[];
  simulatedPrices: Record<string, { price: number; change?: number; changePercent?: number }>;
}> = ({ portfolios, simulatedPrices }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString, formatCurrency } = useFormatCurrency();
  const [query, setQuery] = useState('');

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    for (const p of portfolios ?? []) {
      for (const h of (p.holdings ?? []) as Holding[]) {
        const sym = String(h.symbol ?? '').trim().toUpperCase();
        if (!sym) continue;
        const qty = safeNum(h.quantity);
        const avg = safeNum(h.avgCost);
        const live = lookupLiveQuoteForSymbol(simulatedPrices as any, sym);
        const px = live?.price != null && Number.isFinite(Number(live.price)) ? Number(live.price) : null;
        const mv = px != null ? px * qty : safeNum(h.currentValue);
        const cost = avg * qty;
        const gainLoss = px != null ? mv - cost : null;
        const roi = px != null && cost > 1e-6 ? gainLoss! / cost : null;
        out.push({
          key: `${p.id}:${h.id}`,
          symbol: sym,
          name: String(h.name ?? p.name ?? sym),
          shares: qty,
          avgEntry: avg,
          marketPrice: px,
          marketValue: mv,
          roi,
          gainLoss,
        });
      }
    }
    const q = query.trim().toUpperCase();
    const filtered = q
      ? out.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q))
      : out;
    return filtered.sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0)).slice(0, 50);
  }, [portfolios, query, simulatedPrices]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('holdings')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('investmentsAnalytics')}</p>
        </div>
        <div className="w-full sm:w-64">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('apply') === 'تطبيق' ? 'بحث بالرمز…' : 'Search symbol…'}
            className="input-base w-full"
          />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold text-slate-600">
              <th className="px-3 py-2">{t('holdings')}</th>
              <th className="px-3 py-2">{t('shares')}</th>
              <th className="px-3 py-2">{t('avgEntry')}</th>
              <th className="px-3 py-2">{t('marketPrice')}</th>
              <th className="px-3 py-2">{t('investedCapital')}</th>
              <th className="px-3 py-2">{t('gainLoss')}</th>
              <th className="px-3 py-2">{t('roi')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pl = r.gainLoss;
              const roi = r.roi;
              const plCls = pl == null ? 'text-slate-500' : pl >= 0 ? 'text-emerald-700' : 'text-rose-700';
              return (
                <tr key={r.key} className="border-t border-slate-200 hover:bg-slate-50/60 transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{r.symbol}</div>
                    <div className="text-xs text-slate-500 truncate max-w-[320px]">{r.name}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.shares.toFixed(r.shares % 1 === 0 ? 0 : 2)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatCurrencyString(r.avgEntry, { digits: 2, inCurrency: 'SAR' as any })}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.marketPrice == null ? '—' : formatCurrencyString(r.marketPrice, { digits: 2, inCurrency: 'SAR' as any })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatCurrencyString(r.marketValue, { digits: 0 })}</td>
                  <td className={`px-3 py-2 tabular-nums font-semibold ${plCls}`}>
                    {pl == null ? '—' : formatCurrency(pl, { colorize: true })}
                  </td>
                  <td className={`px-3 py-2 tabular-nums font-semibold ${roi == null ? 'text-slate-500' : roi >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {roi == null ? '—' : `${(roi * 100).toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

