import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { DisciplineScoreSummary } from '../../services/disciplineScoreEngine';
import type { LiquidityRunwaySummary } from '../../services/liquidityRunwayEngine';
import type { HeadlineInvestmentAllocationSlices } from '../../services/headlineInvestmentAllocation';

type IndicatorTone = 'good' | 'warn' | 'bad' | 'neutral';

function toneClasses(tone: IndicatorTone): string {
  if (tone === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (tone === 'bad') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

function toneBadgeLabel(tone: IndicatorTone, t: (key: string) => string): string {
  if (tone === 'good') return t('kpiStatusOnTrack');
  if (tone === 'warn') return t('kpiStatusWatch');
  if (tone === 'bad') return t('healthAtRisk');
  return t('kpiStatusLiquid');
}

function toneBadgeClasses(tone: IndicatorTone): string {
  if (tone === 'good') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (tone === 'warn') return 'bg-amber-100 text-amber-900 border-amber-200';
  if (tone === 'bad') return 'bg-rose-100 text-rose-800 border-rose-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function allocationConcentrationPct(allocation: HeadlineInvestmentAllocationSlices): number {
  const rows = allocation.assetClassAllocation.filter((r) => r.value > 0);
  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!(total > 0)) return 0;
  const max = Math.max(...rows.map((r) => r.value));
  return (max / total) * 100;
}

export const WealthHealthIndicators: React.FC<{
  discipline: DisciplineScoreSummary | null | undefined;
  liquidityRunway: LiquidityRunwaySummary | null | undefined;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  budgetDriftTopCategory?: string;
  budgetDriftPct?: number;
}> = ({ discipline, liquidityRunway, investmentAllocation, budgetDriftTopCategory, budgetDriftPct }) => {
  const { t, dir } = useLanguage();

  const items = useMemo(() => {
    const disciplineScore = Number(discipline?.score ?? 0);
    const disciplineTone: IndicatorTone =
      disciplineScore >= 75 ? 'good' : disciplineScore >= 50 ? 'warn' : disciplineScore > 0 ? 'bad' : 'neutral';

    const runwayMonths = Number(liquidityRunway?.monthsOfRunway ?? 0);
    const runwayTone: IndicatorTone =
      runwayMonths >= 6 ? 'good' : runwayMonths >= 3 ? 'warn' : runwayMonths > 0 ? 'bad' : 'neutral';

    const concentration = allocationConcentrationPct(investmentAllocation);
    const driftTone: IndicatorTone = concentration >= 85 ? 'bad' : concentration >= 70 ? 'warn' : 'good';

    const out = [
      {
        key: 'discipline',
        label: t('healthDiscipline'),
        value: disciplineScore > 0 ? `${Math.round(disciplineScore)}/100` : '—',
        detail: discipline?.label ?? t('healthDisciplineDetail'),
        tone: disciplineTone,
      },
      {
        key: 'runway',
        label: t('healthRunway'),
        value: runwayMonths > 0 ? `${runwayMonths.toFixed(1)} ${t('kpiMonthsShort')}` : '—',
        detail:
          liquidityRunway?.monthsOfRunway != null && liquidityRunway.monthsOfRunway > 0
            ? t('healthRunwayDetail')
            : t('healthRunwayDetail'),
        tone: runwayTone,
      },
      {
        key: 'allocation',
        label: t('healthAllocation'),
        value: concentration > 0 ? `${concentration.toFixed(0)}% ${t('healthTopSlice')}` : '—',
        detail:
          budgetDriftTopCategory && budgetDriftPct != null
            ? `${budgetDriftTopCategory}: ${budgetDriftPct.toFixed(0)}% ${t('healthBudgetDrift')}`
            : t('healthAllocationDetail'),
        tone: driftTone,
      },
    ];
    return out;
  }, [
    discipline,
    liquidityRunway,
    investmentAllocation,
    budgetDriftTopCategory,
    budgetDriftPct,
    t,
  ]);

  return (
    <section dir={dir} className="min-w-0 space-y-3" aria-label={t('wealthHealthStripTitle')}>
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">{t('wealthHealthStripTitle')}</h2>
        <p className="text-sm text-slate-600">{t('healthStripSubtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2 min-w-0">
        {items.map((item) => (
          <div
            key={item.key}
            className={`flex-1 min-w-[min(100%,14rem)] rounded-xl border px-3 py-2.5 shadow-sm ${toneClasses(item.tone)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{item.label}</p>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${toneBadgeClasses(item.tone)}`}
              >
                {toneBadgeLabel(item.tone, t)}
              </span>
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums">{item.value}</p>
            <p className="mt-0.5 text-xs opacity-90 line-clamp-2">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default WealthHealthIndicators;
