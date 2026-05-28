import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { Account, Budget, FinancialData, Transaction } from '../../types';
import { resolveMonthStartDayFromData, financialMonthRange } from '../../utils/financialMonth';
import { aggregatePersonalBudgetCategorySpendSar } from '../../services/budgetSpendMath';
import { budgetMonthlyEquivalentSar } from '../../services/goalProjectionFunding';

type BurnRow = { key: string; label: string; spentSar: number; limitSar: number; pct: number };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function statusForPct(pct: number): 'ok' | 'near' | 'over' {
  if (pct >= 1) return 'over';
  if (pct >= 0.85) return 'near';
  return 'ok';
}

export const BudgetBurnRatePanel: React.FC<{
  data: FinancialData | null | undefined;
  budgets: Budget[];
  transactions: Transaction[];
  accounts: Account[];
  uiExchangeRate: number;
}> = ({ data, budgets, transactions, accounts, uiExchangeRate }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const rows = useMemo((): BurnRow[] => {
    if (!data) return [];
    const monthStartDay = resolveMonthStartDayFromData(data);
    const { start, end, key } = financialMonthRange(new Date(), monthStartDay);
    const activeBudgets = (budgets ?? []).filter((b) => Number(b.month) === key.month && Number(b.year) === key.year);
    if (!activeBudgets.length) return [];

    const accountCurrencyById = new Map<string, 'SAR' | 'USD'>(
      accounts.map((a) => [a.id, a.currency === 'USD' ? 'USD' : 'SAR']),
    );
    const spentByBudgetCat = aggregatePersonalBudgetCategorySpendSar(
      transactions,
      start,
      end,
      accountCurrencyById,
      data,
      uiExchangeRate,
    );

    return activeBudgets
      .map((b) => {
        const cat = String(b.category ?? '').trim() || 'Other';
        const spent = spentByBudgetCat.get(cat) ?? 0;
        const lim = Math.max(0, budgetMonthlyEquivalentSar(b));
        const pct = lim > 0 ? spent / lim : 0;
        return { key: b.id ?? cat, label: cat, spentSar: spent, limitSar: lim, pct };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [accounts, budgets, data, transactions, uiExchangeRate]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('burnRate')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('budgetIntel')}</p>
        </div>
      </div>

      {!rows.length ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {t('budgetIntel')} — {t('apply') === 'تطبيق' ? 'لا توجد ميزانيات لهذا الشهر.' : 'No budgets for this month.'}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((r) => {
            const s = statusForPct(r.pct);
            const bar = clamp01(r.pct);
            const color =
              s === 'over' ? 'bg-rose-500' : s === 'near' ? 'bg-amber-500' : 'bg-emerald-500';
            const badge =
              s === 'over'
                ? { text: t('overLimit'), cls: 'border-rose-200 bg-rose-50 text-rose-800' }
                : s === 'near'
                  ? { text: t('nearLimit'), cls: 'border-amber-200 bg-amber-50 text-amber-800' }
                  : null;
            return (
              <div
                key={r.key}
                className={`rounded-xl border p-3 transition-shadow hover:shadow-sm ${
                  s === 'over'
                    ? 'border-rose-200 bg-rose-50/30'
                    : s === 'near'
                      ? 'border-amber-200 bg-amber-50/30'
                      : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{r.label}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {formatCurrencyString(r.spentSar, { digits: 0 })} / {formatCurrencyString(r.limitSar, { digits: 0 })}
                    </p>
                  </div>
                  {badge && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                      {badge.text}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${Math.min(100, bar * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
