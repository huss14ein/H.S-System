import { useMarketData } from '../context/MarketDataContext';
import { useDebouncedValue } from './useDebouncedValue';

/** Live quotes debounced to match shell canonical metrics (default 1500ms). */
export function useDebouncedMarketPrices(delayMs = 1500): Record<string, { price: number; change?: number; changePercent?: number }> {
  const { simulatedPrices } = useMarketData();
  return useDebouncedValue(simulatedPrices, delayMs);
}
