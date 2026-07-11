import { useCallback } from 'react';
import { useMetricPassport } from '../context/MetricPassportContext';
import { buildMetricPassportModel } from '../services/metricPassportModel';
import type { WealthAnalyticsReportModel } from '../services/wealthAnalyticsReportModel';
import type { MetricPassportModel } from '../services/metricPassportModel';

export function useOpenMetricPassport(report: WealthAnalyticsReportModel | null | undefined) {
  const { openPassport } = useMetricPassport();

  return useCallback(
    (key: MetricPassportModel['key'], fallback?: { valueDisplay?: string; statusLabel?: string }) => {
      const model = buildMetricPassportModel(report, key, fallback);
      if (model) openPassport(model);
    },
    [openPassport, report],
  );
}
