import React from 'react';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useLiveQuotePrices } from '../hooks/useLiveQuotePrices';
import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';

export type InvestmentsMetrics = UseCanonicalFinancialMetricsResult & {
  extendedReady: boolean;
  showHydrateBanner: boolean;
};

/** Investments sub-views share shell canonical metrics (no extra provider compute). */
export function InvestmentsMetricsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * KPI / headline from canonical bundle; per-symbol quotes always from persisted cache + live session.
 */
export function useInvestmentsCanonicalMetrics(): InvestmentsMetrics {
  const metrics = useExtendedCanonicalMetrics();
  const simulatedPrices = useLiveQuotePrices();
  return { ...metrics, simulatedPrices };
}
