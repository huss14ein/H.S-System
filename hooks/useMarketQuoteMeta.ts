import { useContext } from 'react';
import { MarketDataControlContext } from '../context/MarketDataContext';

/** Quote refresh meta (freshness, cooldown, controls) without subscribing to live price ticks. */
export function useMarketQuoteMeta() {
  const ctx = useContext(MarketDataControlContext);
  if (!ctx) {
    throw new Error('useMarketQuoteMeta must be used within MarketDataProvider');
  }
  return ctx;
}
