import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { FinancialData, Goal } from '../../types';
import { computeGoalResolvedAmountsSar } from '../../services/goalResolvedTotals';
import { DashboardVisualCard } from './DashboardVisualCard';

function yearFromDeadline(deadline: string): number | null {
  const y = new Date(deadline).getFullYear();
  return Number.isFinite(y) ? y : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Horizontal roadmap with milestone nodes — Summary-only goals visual. */
export const Goals2030JourneyMap: React.FC<{
  data: FinancialData | null | undefined;
  goals: Goal[];
  sarPerUsd: number;
  onOpenGoals?: () => void;
}> = React.memo(function Goals2030JourneyMap({ data, goals, sarPerUsd, onOpenGoals }) {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const goalRows = useMemo(() => {
    const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
    return (goals ?? [])
      .filter((g) => (yearFromDeadline(g.deadline) ?? 0) >= 2029)
      .map((g) => {
        const target = Math.max(0, Number(g.targetAmount) || 0);
        const current = Math.max(0, resolved.get(g.id) ?? (Number(g.currentAmount) || 0));
        const pct = target > 0 ? clamp01(current / target) : 0;
        return { id: g.id, name: g.name, deadline: (g.deadline || '').slice(0, 10), target, current, pct };
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 5);
  }, [data, goals, sarPerUsd]);

  return (
    <DashboardVisualCard
      dir={dir}
      accent="emerald"
      title={t('goalsForecast')}
      subtitle={t('goalsRoadmapHint')}
      action={
        onOpenGoals ? (
          <button type="button" onClick={onOpenGoals} className="text-xs font-semibold text-primary hover:underline shrink-0">
            {language === 'ar' ? 'الأهداف ←' : 'Goals →'}
          </button>
        ) : undefined
      }
    >
      {!goalRows.length ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          {language === 'ar' ? 'أضف أهداف 2030 من صفحة الأهداف.' : 'Add 2030 goals on the Goals page.'}
        </p>
      ) : (
        <div className="relative mt-2 pb-2">
          <div className="absolute top-8 start-4 end-4 h-1 rounded-full bg-gradient-to-r from-violet-200 via-emerald-300 to-amber-200" aria-hidden />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 relative">
            {goalRows.map((g, i) => {
              const ring = g.pct >= 1 ? 'border-emerald-500' : g.pct >= 0.7 ? 'border-amber-400' : 'border-violet-400';
              return (
                <div key={g.id} className="flex flex-col items-center text-center">
                  <div
                    className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-full border-[3px] bg-white shadow-md ${ring}`}
                    style={{
                      background: `conic-gradient(#6366f1 ${g.pct * 360}deg, #e2e8f0 0deg)`,
                    }}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-800">
                      {Math.round(g.pct * 100)}%
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-800 line-clamp-2 min-h-[2.5rem]">{g.name}</p>
                  <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">{g.deadline}</p>
                  <p className="text-xs text-slate-600 tabular-nums mt-1">
                    {formatCurrencyString(g.current, { digits: 0 })} / {formatCurrencyString(g.target, { digits: 0 })}
                  </p>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">M{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DashboardVisualCard>
  );
});
