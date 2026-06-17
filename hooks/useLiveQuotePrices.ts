import { useMarketPrices } from '../context/MarketDataContext';
import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';

/**
 * Live equity/commodity quotes — subscribe here for holdings tables and price cells.
 * Headline KPIs use throttled canonical metrics so quote ticks do not block navigation.
 */
export function useLiveQuotePrices(): SimulatedPriceMap {
  return useMarketPrices().simulatedPrices;
}
