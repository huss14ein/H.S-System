import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { EMERGENCY_FUND_TARGET_MONTHS } from '../../hooks/useEmergencyFund';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import type { PersonalHeadlineNetWorthResult } from '../../services/personalNetWorth';
import {
  netWorthSparklineFromSnapshots,
  twoPointTrend,
} from '../../services/executiveKpiSparklines';
import { ExecutiveKpiCard, type ExecutiveKpiStatus } from './ExecutiveKpiCard';

function statusFromSigned(value: number, goodWhenPositive = true): ExecutiveKpiStatus {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return 'neutral';
  if (goodWhenPositive) return value >= 0 ? 'good' : 'bad';
  return value <= 0 ? 'good' : 'bad';
}

export const ExecutiveKpiGrid: React.FC<{
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  emergencyFundMonths: number;
  emergencyFundTargetSar?: number;
  weeklyPnLSar?: number;
  weeklyPnLSparkline?: number[];
  /** Deferred NW history sparkline (Wealth Analytics). Falls back to two-point until ready. */
  netWorthSparklineOverride?: number[];
}> = ({
  headline,
  kpiSnapshot,
  emergencyFundMonths,
  emergencyFundTargetSar,
  weeklyPnLSar = 0,
  weeklyPnLSparkline,
  netWorthSparklineOverride,
}) => {
  const { t } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const cards = useMemo(() => {
    const netWorth = headline.netWorth ?? kpiSnapshot?.netWorth ?? 0;
    const monthlyPnL = kpiSnapshot?.monthlyPnL ?? 0;
    const budgetVariance = kpiSnapshot?.budgetVariance ?? 0;
    const roi = kpiSnapshot?.roi ?? 0;
    const impliedMonthStart = netWorth - monthlyPnL;

    const nwSpark =
      netWorthSparklineOverride !== undefined
        ? netWorthSparklineOverride.length >= 2
          ? netWorthSparklineOverride
          : twoPointTrend(netWorth, impliedMonthStart)
        : netWorthSparklineFromSnapshots();
    const pnlSpark = twoPointTrend(monthlyPnL, 0);
    const roiSpark = twoPointTrend(roi * 100, 0);
    const weekSpark =
      weeklyPnLSparkline && weeklyPnLSparkline.length >= 2
        ? weeklyPnLSparkline
        : twoPointTrend(weeklyPnLSar, 0);

    const efStatus: ExecutiveKpiStatus =
      emergencyFundMonths >= EMERGENCY_FUND_TARGET_MONTHS
        ? 'good'
        : emergencyFundMonths >= EMERGENCY_FUND_TARGET_MONTHS / 2
          ? 'warn'
          : 'bad';

    return [
      {
        key: 'netWorth',
        title: t('netWorth'),
        currentValue: formatCurrencyString(netWorth, { digits: 0 }),
        targetValue: Number.isFinite(impliedMonthStart) ? formatCurrencyString(impliedMonthStart, { digits: 0 }) : undefined,
        targetLabel: t('kpiTargetMonthStart'),
        status: statusFromSigned(kpiSnapshot?.netWorthTrend ?? monthlyPnL),
        statusLabel:
          (kpiSnapshot?.netWorthTrend ?? 0) >= 0 ? t('kpiStatusOnTrack') : t('kpiStatusWatch'),
        sparkline: nwSpark.length >= 2 ? nwSpark : twoPointTrend(netWorth, impliedMonthStart),
        sparklineTarget: Number.isFinite(impliedMonthStart) ? impliedMonthStart : undefined,
        accentStroke: '#6366f1',
      },
      {
        key: 'monthlyPnL',
        title: t('monthlyPnLKpi'),
        currentValue: formatCurrencyString(monthlyPnL, { digits: 0 }),
        targetValue: formatCurrencyString(0, { digits: 0 }),
        targetLabel: t('kpiTargetBreakEven'),
        status: statusFromSigned(monthlyPnL),
        statusLabel: monthlyPnL >= 0 ? t('kpiStatusSurplus') : t('kpiStatusDeficit'),
        sparkline: pnlSpark.length >= 2 ? pnlSpark : [monthlyPnL],
        sparklineTarget: 0,
        accentStroke: '#0ea5e9',
      },
      {
        key: 'emergencyFund',
        title: t('emergencyFund'),
        currentValue: `${emergencyFundMonths.toFixed(1)} ${t('kpiMonthsShort')}`,
        targetValue: `${EMERGENCY_FUND_TARGET_MONTHS} ${t('kpiMonthsShort')}`,
        targetLabel: t('kpiTarget'),
        status: efStatus,
        statusLabel:
          efStatus === 'good' ? t('kpiStatusFunded') : efStatus === 'warn' ? t('kpiStatusBuilding') : t('kpiStatusGap'),
        sparkline: twoPointTrend(emergencyFundMonths, EMERGENCY_FUND_TARGET_MONTHS),
        sparklineTarget: EMERGENCY_FUND_TARGET_MONTHS,
        accentStroke: '#10b981',
      },
      {
        key: 'budgetVariance',
        title: t('budgetVariance'),
        currentValue: formatCurrencyString(budgetVariance, { digits: 0 }),
        targetValue: formatCurrencyString(0, { digits: 0 }),
        targetLabel: t('kpiTargetOnBudget'),
        status: statusFromSigned(budgetVariance),
        statusLabel: budgetVariance >= 0 ? t('kpiStatusUnderBudget') : t('kpiStatusOverBudget'),
        sparkline: twoPointTrend(budgetVariance, 0),
        sparklineTarget: 0,
        accentStroke: '#f59e0b',
      },
      {
        key: 'investmentRoi',
        title: t('investmentRoi'),
        currentValue: `${(roi * 100).toFixed(1)}%`,
        targetValue: '0%',
        targetLabel: t('kpiTargetBreakEven'),
        status: statusFromSigned(roi),
        statusLabel: roi >= 0 ? t('kpiStatusGain') : t('kpiStatusLoss'),
        sparkline: roiSpark,
        sparklineTarget: 0,
        accentStroke: '#8b5cf6',
      },
      {
        key: 'weeklyPnL',
        title: t('weeklyPnLKpi'),
        currentValue: formatCurrencyString(weeklyPnLSar, { digits: 0 }),
        targetValue: formatCurrencyString(0, { digits: 0 }),
        targetLabel: t('kpiTargetBreakEven'),
        status: statusFromSigned(weeklyPnLSar),
        statusLabel: weeklyPnLSar >= 0 ? t('kpiStatusGain') : t('kpiStatusLoss'),
        sparkline: weekSpark,
        sparklineTarget: 0,
        accentStroke: '#06b6d4',
      },
    ];
  }, [
    headline.netWorth,
    kpiSnapshot,
    emergencyFundMonths,
    emergencyFundTargetSar,
    weeklyPnLSar,
    weeklyPnLSparkline,
    netWorthSparklineOverride,
    formatCurrencyString,
    t,
  ]);

  return (
    <section aria-label={t('executiveKpiGridTitle')} className="space-y-3 min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm">
      <div className="border-b border-indigo-100 pb-3">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">{t('executiveKpiGridTitle')}</h2>
        <p className="text-sm text-slate-600">{t('executiveKpiGridSubtitle')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map(({ key, ...card }) => (
          <ExecutiveKpiCard key={key} {...card} />
        ))}
      </div>
    </section>
  );
};

export default ExecutiveKpiGrid;
