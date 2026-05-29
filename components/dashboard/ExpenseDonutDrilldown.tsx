import React, { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import type { Account, FinancialData, Transaction } from '../../types';
import { countsAsExpenseForCashflowKpi, isInternalTransferTransaction } from '../../services/transactionFilters';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { expenseAmountSarForBudget } from '../../services/budgetSpendMath';
import { getTransactionBudgetAllocations } from '../../services/transactionBudgetAllocations';
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

  const slices = useMemo((): { fixedVar: Slice[]; household: Slice[]; categories: string[] } => {
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
      const nature = String(tx.transactionNature ?? '').toLowerCase();
      const allocations = getTransactionBudgetAllocations(tx);
      for (const allocation of allocations) {
        const amtSar = expenseAmountSarForBudget(
          { ...tx, amount: allocation.amount },
          accountCurrencyById,
          data,
          uiExchangeRate,
        );
        if (!(amtSar > 0)) continue;
        if (nature === 'fixed') fixed += amtSar;
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
    const next: Mapping = { ...mapping, [kind]: mapping[kind].includes(cat) ? mapping[kind].filter((c) => c !== cat) : [...mapping[kind], cat] };
    setMapping(next);
    saveMapping(next);
  };

  return (
    <DashboardVisualCard
      dir={dir}
      accent="emerald"
      title={t('fixedVsVariable')}
      subtitle={t('budgetIntel')}
      action={
        <button type="button" onClick={() => setIsConfigOpen((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
          {t('apply') === 'تطبيق' ? 'تخصيص' : 'Configure'}
        </button>
      }
    >
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {!slices.fixedVar.length && !slices.household.length ? (
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {t('apply') === 'تطبيق' ? 'لا توجد مصروفات معتمدة لعرضها.' : 'No approved expenses to display.'}
          </div>
        ) : (
          <>
        <div className="h-[240px] rounded-xl border border-slate-200 bg-slate-50/40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices.fixedVar} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {slices.fixedVar.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as Slice | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                      <p className="font-semibold text-slate-800">{p.name}</p>
                      <p className="mt-1 tabular-nums text-slate-700">{formatCurrencyString(p.value, { digits: 0 })}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="h-[240px] rounded-xl border border-slate-200 bg-slate-50/40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices.household} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {slices.household.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as Slice | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                      <p className="font-semibold text-slate-800">{p.name}</p>
                      <p className="mt-1 tabular-nums text-slate-700">{formatCurrencyString(p.value, { digits: 0 })}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
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
                {slices.categories.map((cat) => (
                  <label key={`s:${cat}`} className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={mapping.spouseCats.includes(cat)} onChange={() => toggle('spouseCats', cat)} />
                    <span className="truncate">{cat}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">{t('educationKids')}</p>
              <div className="mt-1 max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 space-y-1">
                {slices.categories.map((cat) => (
                  <label key={`e:${cat}`} className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={mapping.educationCats.includes(cat)} onChange={() => toggle('educationCats', cat)} />
                    <span className="truncate">{cat}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardVisualCard>
  );
};

export const ExpenseDonutDrilldown = React.memo(ExpenseDonutDrilldownInner);
