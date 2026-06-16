import React from 'react';
import { SectionLoadingPlaceholder } from './SectionLoadingPlaceholder';

/** Renders children only once phase-2 canonical metrics are merged. */
export const ExtendedMetricGate: React.FC<{
  ready: boolean;
  children?: React.ReactNode;
  compact?: boolean;
  className?: string;
  labelKey?: string;
}> = ({ ready, children, compact = false, className = '', labelKey = 'analyticsMetricsLoading' }) => {
  if (!ready) {
    return <SectionLoadingPlaceholder compact={compact} className={className} labelKey={labelKey} />;
  }
  return <>{children}</>;
};
