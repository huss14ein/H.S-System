import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { FinancialData, Goal } from '../../types';
import { computeGoalResolvedAmountsSar } from '../../services/goalResolvedTotals';

function yearFromDeadline(deadline: string): number | null {
  const d = new Date(deadline);
  const y = d.getFullYear();
  return Number.isFinite(y) ? y : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export const Goals2030Timeline: React.FC<{
  data: FinancialData | null | undefined;
  goals: Goal[];
  sarPerUsd: number;
  onOpenGoals?: () => void;
}> = React.memo(function Goals2030Timeline({ data, goals, sarPerUsd, onOpenGoals }) {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const goalRows = useMemo(() => {
    const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
    const list = (goals ?? [])
      .filter((g) => (yearFromDeadline(g.deadline) ?? 0) >= 2029)
      .map((g) => {
        const target = Math.max(0, Number(g.targetAmount) || 0);
        const current = Math.max(0, resolved.get(g.id) ?? (Number(g.currentAmount) || 0));
        const pct = target > 0 ? clamp01(current / target) : 0;
        return { id: g.id, name: g.name, deadline: g.deadline, target, current, pct };
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
    return list.slice(0, 6);
  }, [data, goals, sarPerUsd]);

  return (
    <div dir={dir} className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('goalsForecast')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('progress')}</p>
        </div>
        {onOpenGoals && (
          <button type="button" onClick={onOpenGoals} className="text-xs font-semibold text-primary hover:underline">
            {language === 'ar' ? 'فتح الأهداف ←' : 'Open Goals →'}
          </button>
        )}
      </div>

      {!goalRows.length ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {t('apply') === 'تطبيق'
            ? 'لم يتم العثور على أهداف 2030. أضف أهداف (منزل/سيارة) من صفحة الأهداف.'
            : 'No 2030 goals found. Add your house/car goals in the Goals page.'}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {goalRows.map((g) => {
            const status = g.pct >= 1 ? 'bg-emerald-500' : g.pct >= 0.7 ? 'bg-amber-500' : 'bg-violet-500';
            return (
              <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{g.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {formatCurrencyString(g.current, { digits: 0 })} / {formatCurrencyString(g.target, { digits: 0 })} ·{' '}
                      {(g.deadline || '').slice(0, 10)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-700 tabular-nums">{Math.round(g.pct * 100)}%</span>
                </div>
                <div className="mt-2 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${status}`} style={{ width: `${Math.min(100, g.pct * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
