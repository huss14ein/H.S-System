import { useContext } from 'react';
import { MarketDebouncedPricesContext, useMarketDebouncedPrices as useMarketDebouncedPricesFromContext } from '../context/MarketDataContext';

/** Shell-debounced live quotes (1500ms) — does not re-render on every raw quote tick. */
export function useDebouncedMarketPrices(): Record<string, { price: number; change?: number; changePercent?: number }> {
  const ctx = useContext(MarketDebouncedPricesContext);
  if (!ctx) {
    throw new Error('useDebouncedMarketPrices must be used within MarketDataProvider');
  }
  return ctx.debouncedPrices;
}

export { useMarketDebouncedPricesFromContext as useMarketDebouncedPrices };
