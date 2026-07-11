import React from 'react';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useLiveQuotePrices } from '../hooks/useLiveQuotePrices';
import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';
import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';

export type InvestmentsMetrics = UseCanonicalFinancialMetricsResult & {
  extendedReady: boolean;
  showHydrateBanner: boolean;
  /** Live session quotes for holdings cells and spot anchors — not the debounced KPI map. */
  liveQuotePrices: SimulatedPriceMap;
};

/** Investments sub-views share shell canonical metrics (no extra provider compute). */
export function InvestmentsMetricsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * Headline KPIs use debounced `simulatedPrices` from the canonical bundle; holdings cells use `liveQuotePrices`.
 */
export function useInvestmentsCanonicalMetrics(): InvestmentsMetrics {
  const metrics = useExtendedCanonicalMetrics();
  const liveQuotePrices = useLiveQuotePrices();
  return { ...metrics, liveQuotePrices };
}
