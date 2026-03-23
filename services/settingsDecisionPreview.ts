import type { FinancialData, Holding } from '../types';
import { getPersonalInvestments } from '../utils/wealthScope';
import {
  buildFinancialWealthUltraConfig,
  validateWealthUltraConfig,
  buildWealthUltraPositions,
  getTotalPortfolioValue,
  computeSleeveAllocations,
} from '../wealth-ultra';
import type { PriceMap } from '../wealth-ultra/position';

/**
 * Max absolute sleeve drift % (current vs target allocation) using the same rules as Wealth Ultra.
 * Returns null when there are no holdings or config cannot be validated.
 */
export function computeMaxAbsSleeveDriftPercent(data: FinancialData | null): number | null {
  if (!data) return null;
  try {
    const config = buildFinancialWealthUltraConfig(data);
    const validation = validateWealthUltraConfig(config);
    if (!validation.valid) return null;

    const investments = getPersonalInvestments(data);
    const holdings: Holding[] = [];
    for (const p of investments) {
      for (const h of p.holdings ?? []) {
        holdings.push(h);
      }
    }
    if (holdings.length === 0) return null;

    const priceMap: PriceMap = {};
    for (const h of holdings) {
      const sym = (h.symbol || '').toUpperCase();
      if (!sym) continue;
      const qty = Number(h.quantity) || 0;
      const cv = Number(h.currentValue ?? 0);
      priceMap[sym] = qty > 0 ? cv / qty : Number(h.avgCost) || 0;
    }

    const positions = buildWealthUltraPositions(holdings, priceMap, undefined, config);
    const total = getTotalPortfolioValue(positions);
    if (!Number.isFinite(total) || total <= 0) return null;

    const allocations = computeSleeveAllocations(positions, config, total);
    let maxAbs = 0;
    for (const a of allocations) {
      maxAbs = Math.max(maxAbs, Math.abs(a.driftPct));
    }
    return Math.round(maxAbs * 10) / 10;
  } catch {
    return null;
  }
}
