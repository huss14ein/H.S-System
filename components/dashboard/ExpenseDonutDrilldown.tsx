import React, { useMemo, useState } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import type { Account, FinancialData, Transaction } from '../../types';
import { countsAsExpenseForCashflowKpi, isInternalTransferTransaction } from '../../services/transactionFilters';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { expenseAmountSarForBudget } from '../../services/budgetSpendMath';
import { getTransactionBudgetAllocations } from '../../services/transactionBudgetAllocations';
import { financialMonthLabel, financialMonthRange, resolveMonthStartDayFromData, dateInRange } from '../../utils/financialMonth';
import { DashboardVisualCard } from './DashboardVisualCard';

const STORAGE_KEY = 'finova_expense_intel_mapping_v1';

type Mapping = { spouseCats: string[]; educationCats: string[] };

function loadMapping(): Mapping {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Mapping>) : {};
    return {
      spouseCats: Array.isArray(parsed.spouseCats) ? parsed.spouseCats.filter(Boolean) : [],
      educationCats: Array.isArray(parsed.educationCats) ? parsed.educationCats.filter(Boolean) : [],
    };
  } catch {
    return { spouseCats: [], educationCats: [] };
  }
}

function saveMapping(m: Mapping) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // ignore
  }
}

type Slice = { name: string; value: number; color: string };

function isFixedExpense(tx: Transaction): boolean {
  const nature = String(tx.transactionNature ?? '').toLowerCase();
  if (nature === 'fixed') return true;
  if (nature === 'variable') return false;
  const expenseType = String(tx.expenseType ?? '').toLowerCase();
  if (expenseType === 'core') return true;
  return false;
}

function DonutLegend({ slices, format }: { slices: Slice[]; format: (n: number) => string }) {
  if (!slices.length) return null;
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <ul className="mt-2 space-y-1 px-1">
      {slices.map((s) => (
        <li key={s.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-slate-700 truncate">{s.name}</span>
          </span>
          <span className="tabular-nums font-semibold text-slate-800 shrink-0">
            {format(s.value)}
            {total > 0 ? <span className="text-slate-400 font-normal ml-1">({((s.value / total) * 100).toFixed(0)}%)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const ExpenseDonutDrilldownInner: React.FC<{
  data: FinancialData | null | undefined;
  transactions: Transaction[];
  accounts: Account[];
  uiExchangeRate: number;
}> = ({ data, transactions, accounts, uiExchangeRate }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();
  const [mapping, setMapping] = useState<Mapping>(() => loadMapping());
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const accountCurrencyById = useMemo(
    () => new Map<string, 'SAR' | 'USD'>(accounts.map((a) => [a.id, a.currency === 'USD' ? 'USD' : 'SAR'])),
    [accounts],
  );

  const periodLabel = useMemo(() => {
    if (!data) return '';
    const monthStartDay = resolveMonthStartDayFromData(data);
    const { key } = financialMonthRange(new Date(), monthStartDay);
    return financialMonthLabel(key, monthStartDay);
  }, [data]);

  const slices = useMemo((): { fixedVar: Slice[]; household: Slice[]; categories: string[] } => {
    if (!data) return { fixedVar: [], household: [], categories: [] };
    const monthStartDay = resolveMonthStartDayFromData(data);
    const { start, end } = financialMonthRange(new Date(), monthStartDay);

    let fixed = 0;
    let variable = 0;
    let spouse = 0;
    let education = 0;
    let other = 0;
    const spouseSet = new Set(mapping.spouseCats);
    const eduSet = new Set(mapping.educationCats);
    const categorySet = new Set<string>();

    for (const tx of transactions ?? []) {
      if (!tx) continue;
      if (!countsAsExpenseForCashflowKpi(tx) || isInternalTransferTransaction(tx)) continue;
      if ((tx.status ?? 'Approved') !== 'Approved') continue;
      if (!dateInRange(tx.date, start, end)) continue;

      const allocations = getTransactionBudgetAllocations(tx);
      for (const allocation of allocations) {
        const amtSar = expenseAmountSarForBudget(
          { ...tx, amount: allocation.amount },
          accountCurrencyById,
          data,
          uiExchangeRate,
        );
        if (!(amtSar > 0)) continue;
        if (isFixedExpense(tx)) fixed += amtSar;
        else variable += amtSar;
        const cat = String(allocation.category ?? '').trim();
        if (cat) categorySet.add(cat);
        if (cat && spouseSet.has(cat)) spouse += amtSar;
        else if (cat && eduSet.has(cat)) education += amtSar;
        else other += amtSar;
      }
    }

    return {
      fixedVar: [
        { name: t('apply') === 'تطبيق' ? 'ثابت' : 'Fixed', value: fixed, color: '#6366f1' },
        { name: t('apply') === 'تطبيق' ? 'متغير' : 'Variable', value: variable, color: '#f59e0b' },
      ].filter((s) => s.value > 0.01),
      household: [
        { name: t('spouse'), value: spouse, color: '#10b981' },
        { name: t('educationKids'), value: education, color: '#0ea5e9' },
        { name: t('apply') === 'تطبيق' ? 'أخرى' : 'Other', value: other, color: '#94a3b8' },
      ].filter((s) => s.value > 0.01),
      categories: Array.from(categorySet).sort((a, b) => a.localeCompare(b)),
    };
  }, [accountCurrencyById, data, mapping.educationCats, mapping.spouseCats, t, transactions, uiExchangeRate]);

  const toggle = (kind: keyof Mapping, cat: string) => {
    const next: Mapping = {
      ...mapping,
      [kind]: mapping[kind].includes(cat) ? mapping[kind].filter((c) => c !== cat) : [...mapping[kind], cat],
    };
    setMapping(next);
    saveMapping(next);
  };

  const fmt = (n: number) => formatCurrencyString(n, { digits: 0 });

  return (
    <DashboardVisualCard
      dir={dir}
      accent="emerald"
      title={t('fixedVsVariable')}
      subtitle={periodLabel ? `${t('budgetIntel')} · ${periodLabel}` : t('budgetIntel')}
      action={
        <button type="button" onClick={() => setIsConfigOpen((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
          {t('apply') === 'تطبيق' ? 'تخصيص' : 'Configure'}
        </button>
      }
    >
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {!slices.fixedVar.length && !slices.household.length ? (
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {t('apply') === 'تطبيق'
              ? 'لا توجد مصروفات معتمدة في الشهر المالي الحالي.'
              : 'No approved expenses in the current financial month.'}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1 mb-1">
                {t('apply') === 'تطبيق' ? 'ثابت / متغير' : 'Fixed / variable'}
              </p>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={slices.fixedVar} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                      {slices.fixedVar.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Legend verticalAlign="bottom" height={0} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <DonutLegend slices={slices.fixedVar} format={fmt} />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1 mb-1">
                {t('apply') === 'تطبيق' ? 'الأسرة' : 'Household split'}
              </p>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={slices.household} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                      {slices.household.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <DonutLegend slices={slices.household} format={fmt} />
            </div>
          </>
        )}
      </div>

      {isConfigOpen && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-700">
            {t('apply') === 'تطبيق'
              ? 'اختر فئات الميزانية التي تُحسب ضمن (الزوج/الزوجة) وتعليم الأطفال.'
              : 'Select budget categories that should count toward Spouse and Education (kids).'}
          </p>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-600">{t('spouse')}</p>
              <div className="mt-1 max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 space-y-1">
                {slices.categories.length === 0 ? (
                  <p className="text-xs text-slate-500">{t('apply') === 'تطبيق' ? 'لا فئات بعد' : 'No categories yet'}</p>
                ) : (
                  slices.categories.map((cat) => (
                    <label key={`s:${cat}`} className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={mapping.spouseCats.includes(cat)} onChange={() => toggle('spouseCats', cat)} />
                      <span className="truncate">{cat}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">{t('educationKids')}</p>
              <div className="mt-1 max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 space-y-1">
                {slices.categories.length === 0 ? (
                  <p className="text-xs text-slate-500">{t('apply') === 'تطبيق' ? 'لا فئات بعد' : 'No categories yet'}</p>
                ) : (
                  slices.categories.map((cat) => (
                    <label key={`e:${cat}`} className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={mapping.educationCats.includes(cat)} onChange={() => toggle('educationCats', cat)} />
                      <span className="truncate">{cat}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardVisualCard>
  );
};

export const ExpenseDonutDrilldown = React.memo(ExpenseDonutDrilldownInner);
