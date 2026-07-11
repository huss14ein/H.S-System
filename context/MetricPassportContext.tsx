import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { MetricPassportModel } from '../services/metricPassportModel';
import MetricPassportDrawer from '../components/metrics/MetricPassportDrawer';

type MetricPassportContextValue = {
  openPassport: (model: MetricPassportModel) => void;
  closePassport: () => void;
};

const MetricPassportContext = createContext<MetricPassportContextValue | null>(null);

export const MetricPassportProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [model, setModel] = useState<MetricPassportModel | null>(null);

  const openPassport = useCallback((m: MetricPassportModel) => setModel(m), []);
  const closePassport = useCallback(() => setModel(null), []);

  const value = useMemo(() => ({ openPassport, closePassport }), [openPassport, closePassport]);

  return (
    <MetricPassportContext.Provider value={value}>
      {children}
      {model ? <MetricPassportDrawer model={model} onClose={closePassport} /> : null}
    </MetricPassportContext.Provider>
  );
};

export function useMetricPassport(): MetricPassportContextValue {
  const ctx = useContext(MetricPassportContext);
  if (!ctx) {
    return {
      openPassport: () => {},
      closePassport: () => {},
    };
  }
  return ctx;
}
