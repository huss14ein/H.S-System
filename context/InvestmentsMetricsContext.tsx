import React from 'react';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';

export type InvestmentsMetrics = UseCanonicalFinancialMetricsResult;

/** Investments sub-views share shell canonical metrics (no extra provider compute). */
export function InvestmentsMetricsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useInvestmentsCanonicalMetrics(): InvestmentsMetrics {
  return useCanonicalFinancialMetrics();
}
