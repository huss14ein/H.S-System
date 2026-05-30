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
    <div dir={dir} className="flex flex-wrap gap-2 min-w-0" aria-label={t('wealthHealthStripTitle')}>
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex-1 min-w-[min(100%,14rem)] rounded-xl border px-3 py-2.5 ${toneClasses(item.tone)}`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{item.label}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums">{item.value}</p>
          <p className="mt-0.5 text-xs opacity-90 line-clamp-2">{item.detail}</p>
        </div>
      ))}
    </div>
  );
};

export default WealthHealthIndicators;
