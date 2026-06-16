import React from 'react';
import { useExtendedCanonicalMetrics } from '../../hooks/useCanonicalFinancialMetrics';
import { useLanguage } from '../../context/LanguageContext';

/** App-wide: headline KPIs are ready; allocation / wealth summary still computing. */
const CanonicalMetricsExtendedBanner: React.FC = () => {
  const { extendedReady, showHydrateBanner } = useExtendedCanonicalMetrics();
  const { t } = useLanguage();

  if (showHydrateBanner || extendedReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/90 px-4 py-2.5 text-sm text-indigo-950"
    >
      <span
        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-400 border-t-indigo-700"
        aria-hidden
      />
      <span>{t('analyticsMetricsLoading')}</span>
    </div>
  );
};

export default CanonicalMetricsExtendedBanner;
