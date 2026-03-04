import React, { useEffect, useRef } from 'react';
import { useMarketData } from '../context/MarketDataContext';

export const SystemActivityGuard: React.FC = () => {
  const { refreshPrices, isRefreshing } = useMarketData();
  const lastWakeRefreshRef = useRef(0);

  useEffect(() => {
    const maybeRefresh = () => {
      const now = Date.now();
      if (isRefreshing) return;
      if (now - lastWakeRefreshRef.current < 15000) return;
      lastWakeRefreshRef.current = now;
      refreshPrices().catch(() => undefined);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshPrices, isRefreshing]);

  return null;
};

export default SystemActivityGuard;
