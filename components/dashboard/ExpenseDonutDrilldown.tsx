import React, { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import type { Transaction } from '../../types';
import { countsAsExpenseForCashflowKpi, isInternalTransferTransaction } from '../../services/transactionFilters';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

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

export const ExpenseDonutDrilldown: React.FC<{
  transactions: Transaction[];
}> = ({ transactions }) => {
  const { t, dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();
  const [mapping, setMapping] = useState<Mapping>(() => loadMapping());
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const expenseCats = useMemo(() => {
    const set = new Set<string>();
    (transactions ?? []).forEach((tx) => {
      if (!tx) return;
      if (!countsAsExpenseForCashflowKpi(tx) || isInternalTransferTransaction(tx)) return;
      const cat = String(tx.budgetCategory ?? tx.category ?? '').trim();
      if (cat) set.add(cat);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const slices = useMemo((): { fixedVar: Slice[]; household: Slice[] } => {
    let fixed = 0;
    let variable = 0;
    let spouse = 0;
    let education = 0;
    let other = 0;
    const spouseSet = new Set(mapping.spouseCats);
    const eduSet = new Set(mapping.educationCats);

    for (const tx of transactions ?? []) {
      if (!tx) continue;
      if (!countsAsExpenseForCashflowKpi(tx) || isInternalTransferTransaction(tx)) continue;
      const amt = Math.abs(Number(tx.amount) || 0);
      const nature = String(tx.transactionNature ?? '').toLowerCase();
      if (nature === 'fixed') fixed += amt;
      else variable += amt;
      const cat = String(tx.budgetCategory ?? tx.category ?? '').trim();
      if (cat && spouseSet.has(cat)) spouse += amt;
      else if (cat && eduSet.has(cat)) education += amt;
      else other += amt;
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
    };
  }, [mapping.educationCats, mapping.spouseCats, t, transactions]);

  const toggle = (kind: keyof Mapping, cat: string) => {
    const next: Mapping = { ...mapping, [kind]: mapping[kind].includes(cat) ? mapping[kind].filter((c) => c !== cat) : [...mapping[kind], cat] };
    setMapping(next);
    saveMapping(next);
  };

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('fixedVsVariable')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('budgetIntel')}</p>
        </div>
        <button type="button" onClick={() => setIsConfigOpen((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
          {t('apply') === 'تطبيق' ? 'تخصيص' : 'Configure'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
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
                {expenseCats.map((cat) => (
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
                {expenseCats.map((cat) => (
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
    </div>
  );
};

