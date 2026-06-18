import React, { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { DashboardCanonicalMetrics } from '../../services/canonicalFinancialMetrics';
import { pickHeadlineInvestmentsExposureSar } from '../../services/extendedMetricsPresentation';
import { ScaleIcon } from '../icons/ScaleIcon';
import { BanknotesIcon } from '../icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../icons/ArrowTrendingUpIcon';

type MetricCardProps = {
  title: string;
  value: string;
  sub?: string;
  accent: 'emerald' | 'violet' | 'amber';
  icon: React.ReactNode;
};

function accentClasses(accent: MetricCardProps['accent']): { border: string; bg: string; text: string } {
  if (accent === 'emerald') return { border: 'border-emerald-200', bg: 'from-emerald-50 to-white', text: 'text-emerald-800' };
  if (accent === 'violet') return { border: 'border-violet-200', bg: 'from-violet-50 to-white', text: 'text-violet-800' };
  return { border: 'border-amber-200', bg: 'from-amber-50 to-white', text: 'text-amber-800' };
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, sub, accent, icon }) => {
  const a = accentClasses(accent);
  return (
    <div
      className={`group rounded-2xl border ${a.border} bg-gradient-to-br ${a.bg} p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-[1px]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-600">{sub}</p>}
        </div>
        <div className={`shrink-0 rounded-xl bg-white/70 p-2 ring-1 ring-slate-200 ${a.text}`}>{icon}</div>
      </div>
    </div>
  );
};

export const ExecutiveStatusRow: React.FC<{
  metrics: Pick<DashboardCanonicalMetrics, 'headline' | 'kpiSnapshot'>;
  showLanguageToggle?: boolean;
  className?: string;
}> = ({ metrics, showLanguageToggle = true, className = '' }) => {
  const { t, dir, language, setLanguage } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();

  const cards = useMemo(() => {
    /** Headline path: `computePersonalHeadlineNetWorthSar` + `computeDashboardKpiSnapshot`. */
    const netWorthSar = metrics.headline.netWorth ?? 0;
    const liquidSar = metrics.kpiSnapshot?.liquidCashSar ?? 0;
    /** Same as Investments hub Total Value (`pickHeadlineInvestmentExposure`). */
    const investedSar = pickHeadlineInvestmentsExposureSar(metrics);
    return [
      {
        title: t('netWorth'),
        value: formatCurrencyString(netWorthSar, { digits: 0 }),
        sub: t('executiveStatus'),
        accent: 'violet' as const,
        icon: <ScaleIcon className="h-6 w-6" />,
      },
      {
        title: t('liquidAssets'),
        value: formatCurrencyString(liquidSar, { digits: 0 }),
        sub: t('lastUpdated'),
        accent: 'emerald' as const,
        icon: <BanknotesIcon className="h-6 w-6" />,
      },
      {
        title: t('investedCapital'),
        value: formatCurrencyString(investedSar, { digits: 0 }),
        sub: t('investmentsAnalytics'),
        accent: 'amber' as const,
        icon: <ArrowTrendingUpIcon className="h-6 w-6" />,
      },
    ];
  }, [formatCurrencyString, metrics.headline, metrics.kpiSnapshot, t]);

  return (
    <div dir={dir} className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{t('executiveStatus')}</h2>
          <p className="text-sm text-slate-600">{t('executiveStatusSubtitle')}</p>
        </div>
        {showLanguageToggle && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-slate-500">{t('language')}</span>
            <div className="rounded-full border border-slate-200 bg-white p-1 shadow-sm" dir="ltr">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                  language === 'en' ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                  language === 'ar' ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                AR
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <MetricCard key={c.title} {...c} />
        ))}
      </div>
    </div>
  );
};

