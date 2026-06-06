import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Holding, InvestmentPortfolio, TradeCurrency } from '../../types';
import { effectiveHoldingUnitPriceInBookCurrency, effectiveHoldingValueInBookCurrency } from '../../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../../utils/investmentPortfolioCurrency';
import { toSAR } from '../../utils/currencyMath';

type Row = {
  key: string;
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name: string;
  shares: number;
  avgEntrySar: number;
  marketPriceSar: number | null;
  marketValueSar: number;
  roi: number | null;
  gainLossSar: number | null;
};

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

const PortfolioHoldingsGridInner: React.FC<{
  portfolios: InvestmentPortfolio[];
  simulatedPrices: Record<string, { price: number; change?: number; changePercent?: number }>;
  sarPerUsd: number;
  /** When set, only holdings from this portfolio are shown (required on Wealth Analytics). */
  portfolioId?: string | null;
}> = ({ portfolios, simulatedPrices, sarPerUsd, portfolioId = null }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString, formatCurrency } = useFormatCurrency();
  const [query, setQuery] = useState('');

  const scopedPortfolios = useMemo(() => {
    const list = portfolios ?? [];
    if (!portfolioId) return list;
    return list.filter((p) => p.id === portfolioId);
  }, [portfolios, portfolioId]);

  const activePortfolio = scopedPortfolios[0] ?? null;

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    for (const p of scopedPortfolios) {
      const book = resolveInvestmentPortfolioCurrency(p) as TradeCurrency;
      for (const h of (p.holdings ?? []) as Holding[]) {
        const sym = String(h.symbol ?? '').trim().toUpperCase();
        if (!sym) continue;
        const qty = safeNum(h.quantity);
        const avgBook = safeNum(h.avgCost);
        const avgEntrySar = toSAR(avgBook, book, sarPerUsd);
        const valueBook = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
        const marketValueSar = toSAR(valueBook, book, sarPerUsd);
        const unitBook = effectiveHoldingUnitPriceInBookCurrency(h, book, simulatedPrices, sarPerUsd);
        const marketPriceSar = unitBook > 0 ? toSAR(unitBook, book, sarPerUsd) : null;
        const costSar = avgEntrySar * qty;
        const gainLossSar = marketPriceSar != null ? marketValueSar - costSar : null;
        const roi = gainLossSar != null && costSar > 1e-6 ? gainLossSar / costSar : null;
        out.push({
          key: `${p.id}:${h.id}`,
          portfolioId: p.id,
          portfolioName: String(p.name ?? p.id),
          symbol: sym,
          name: String(h.name ?? p.name ?? sym),
          shares: qty,
          avgEntrySar,
          marketPriceSar,
          marketValueSar,
          roi,
          gainLossSar,
        });
      }
    }
    const q = query.trim().toUpperCase();
    const filtered = q
      ? out.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q))
      : out;
    return filtered.sort((a, b) => b.marketValueSar - a.marketValueSar);
  }, [scopedPortfolios, query, sarPerUsd, simulatedPrices]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('holdings')}</p>
          <p className="mt-1 text-sm text-slate-700">
            {activePortfolio
              ? `${t('portfolioLabel')}: ${activePortfolio.name ?? activePortfolio.id}`
              : t('investmentsAnalytics')}
          </p>
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
            <tr className="text-xs font-semibold text-slate-600">
              <th className="px-3 py-2 text-start">{t('holdings')}</th>
              <th className="px-3 py-2 text-end">{t('shares')}</th>
              <th className="px-3 py-2 text-end">{t('avgEntry')}</th>
              <th className="px-3 py-2 text-end">{t('marketPrice')}</th>
              <th className="px-3 py-2 text-end">{t('investedCapital')}</th>
              <th className="px-3 py-2 text-end">{t('gainLoss')}</th>
              <th className="px-3 py-2 text-end">{t('roi')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  {portfolioId
                    ? t('apply') === 'تطبيق'
                      ? 'لا توجد مقتنيات في هذه المحفظة.'
                      : 'No holdings in this portfolio.'
                    : t('apply') === 'تطبيق'
                      ? 'لا توجد مقتنيات لعرضها.'
                      : 'No holdings to display.'}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const pl = r.gainLossSar;
              const roi = r.roi;
              const plCls = pl == null ? 'text-slate-500' : pl >= 0 ? 'text-emerald-700' : 'text-rose-700';
              return (
                <tr key={r.key} className="border-t border-slate-200 hover:bg-slate-50/60 transition-colors">
                  <td className="px-3 py-2 text-start">
                    <div className="font-semibold text-slate-800">{r.symbol}</div>
                    <div className="text-xs text-slate-500 truncate max-w-[320px]">{r.name}</div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.shares.toFixed(r.shares % 1 === 0 ? 0 : 2)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatCurrencyString(r.avgEntrySar, { digits: 2 })}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {r.marketPriceSar == null ? '—' : formatCurrencyString(r.marketPriceSar, { digits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatCurrencyString(r.marketValueSar, { digits: 0 })}</td>
                  <td className={`px-3 py-2 text-end tabular-nums font-semibold ${plCls}`}>
                    {pl == null ? '—' : formatCurrency(pl, { colorize: true })}
                  </td>
                  <td className={`px-3 py-2 text-end tabular-nums font-semibold ${roi == null ? 'text-slate-500' : roi >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
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

export const PortfolioHoldingsGrid = React.memo(PortfolioHoldingsGridInner);
