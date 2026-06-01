import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { QuotesAsOfBadge } from './QuotesAsOfBadge';

export const WealthAnalyticsHero: React.FC<{
  netWorthDisplay: string;
  monthlyPnLDisplay: string;
  monthlyPnLPositive: boolean;
  roiDisplay: string;
  roiPositive: boolean;
}> = ({ netWorthDisplay, monthlyPnLDisplay, monthlyPnLPositive, roiDisplay, roiPositive }) => {
  const { t, dir } = useLanguage();

  return (
    <section
      dir={dir}
      aria-label={t('executiveKpiGridTitle')}
      className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 sm:p-6 shadow-sm min-w-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-600">{t('netWorth')}</p>
          <p className="mt-1 text-3xl sm:text-4xl font-bold tabular-nums text-slate-900 truncate">{netWorthDisplay}</p>
          <p className="mt-2 text-sm text-slate-600 max-w-xl">{t('executiveKpiGridSubtitle')}</p>
        </div>
        <QuotesAsOfBadge className="shrink-0" />
      </div>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('monthlyPnLKpi')}</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${monthlyPnLPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
            {monthlyPnLDisplay}
          </p>
          <span
            className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              monthlyPnLPositive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {monthlyPnLPositive ? t('kpiStatusSurplus') : t('kpiStatusDeficit')}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('investmentRoi')}</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${roiPositive ? 'text-violet-700' : 'text-rose-700'}`}>
            {roiDisplay}
          </p>
          <span
            className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              roiPositive ? 'bg-violet-100 text-violet-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {roiPositive ? t('kpiStatusGain') : t('kpiStatusLoss')}
          </span>
        </div>
      </div>
    </section>
  );
};

export default WealthAnalyticsHero;
