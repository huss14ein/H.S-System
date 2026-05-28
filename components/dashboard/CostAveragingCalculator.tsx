import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { SearchableSymbolPicker } from './SearchableSymbolPicker';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Holding, InvestmentPortfolio } from '../../types';

type Option = { symbol: string; name: string; qty: number; avg: number };

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export const CostAveragingCalculator: React.FC<{
  portfolios: InvestmentPortfolio[];
}> = React.memo(function CostAveragingCalculator({ portfolios }) {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const options = useMemo((): Option[] => {
    const out: Option[] = [];
    for (const p of portfolios ?? []) {
      for (const h of (p.holdings ?? []) as Holding[]) {
        const symbol = String(h.symbol ?? '').trim().toUpperCase();
        if (!symbol) continue;
        out.push({
          symbol,
          name: String(h.name ?? p.name ?? symbol),
          qty: safeNum(h.quantity),
          avg: safeNum(h.avgCost),
        });
      }
    }
    return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [portfolios]);

  const [symbol, setSymbol] = useState(options[0]?.symbol ?? '');
  const pickerOptions = useMemo(
    () => options.map((o) => ({ symbol: o.symbol, label: `${o.symbol} — ${o.name}` })),
    [options],
  );
  const base = useMemo(() => options.find((o) => o.symbol === symbol) ?? null, [options, symbol]);
  const [addQty, setAddQty] = useState('0');
  const [addPrice, setAddPrice] = useState('');

  const calc = useMemo(() => {
    const q0 = base?.qty ?? 0;
    const p0 = base?.avg ?? 0;
    const q1 = Math.max(0, safeNum(addQty));
    const p1 = Math.max(0, safeNum(addPrice));
    const denom = q0 + q1;
    const newAvg = denom > 0 ? (q0 * p0 + q1 * p1) / denom : 0;
    return { q0, p0, q1, p1, newAvg };
  }, [addPrice, addQty, base]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('costAveraging')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('investmentsAnalytics')}</p>
        </div>
      </div>

      {!options.length ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {t('apply') === 'تطبيق' ? 'لا توجد مقتنيات لحساب متوسط التكلفة.' : 'No holdings available for cost averaging.'}
        </div>
      ) : (
      <>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-1">
          <label className="block text-xs font-medium text-slate-600">{t('holdings')}</label>
          <div className="mt-1">
            <SearchableSymbolPicker
              options={pickerOptions}
              value={symbol}
              onChange={setSymbol}
              placeholder={t('apply') === 'تطبيق' ? 'بحث بالرمز…' : 'Search symbol…'}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">{t('shares')}</label>
          <input value={addQty} onChange={(e) => setAddQty(e.target.value)} type="number" min={0} className="mt-1 input-base w-full" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">{t('marketPrice')}</label>
          <input value={addPrice} onChange={(e) => setAddPrice(e.target.value)} type="number" min={0} className="mt-1 input-base w-full" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs text-slate-500">{t('avgEntry')}</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatCurrencyString(calc.p0, { digits: 2 })}</p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">{t('shares')}: {calc.q0.toFixed(calc.q0 % 1 === 0 ? 0 : 2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs text-slate-500">{t('apply') === 'تطبيق' ? 'إضافة' : 'Add'}</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatCurrencyString(calc.p1, { digits: 2 })}</p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">{t('shares')}: {calc.q1.toFixed(calc.q1 % 1 === 0 ? 0 : 2)}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
          <p className="text-xs text-violet-700">{t('apply') === 'تطبيق' ? 'متوسط جديد' : 'New avg'}</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums text-violet-900">{formatCurrencyString(calc.newAvg, { digits: 2 })}</p>
          <p className="mt-1 text-xs text-violet-700 tabular-nums">{t('shares')}: {(calc.q0 + calc.q1).toFixed((calc.q0 + calc.q1) % 1 === 0 ? 0 : 2)}</p>
        </div>
      </div>
      </>
      )}
    </div>
  );
});

