import type { Holding, HoldingAssetClass, TickerStatus } from '../types';

/**
 * Canonical sleeve bucket for Wealth Ultra / engine (lowercase keys match `buildFinancialWealthUltraConfig`).
 */
export type EngineSleeveKey = 'core' | 'high-upside' | 'speculative';

const CORE_CLASSES: ReadonlySet<HoldingAssetClass> = new Set([
  'ETF',
  'Mutual Fund',
  'REIT',
  'CD',
  'Savings Bond',
  'Sukuk',
]);

const SPEC_CLASSES: ReadonlySet<HoldingAssetClass> = new Set([
  'Cryptocurrency',
  'NFT',
  'Venture Capital',
  'Private Equity',
]);

/**
 * Fully automated sleeve label for an equity holding — no manual universe row required.
 * Uses `assetClass` first, then name/symbol heuristics when class is missing.
 */
export function inferEngineSleeveKeyFromHolding(h: Pick<Holding, 'symbol' | 'name' | 'assetClass'>): EngineSleeveKey {
  const ac = h.assetClass;
  if (ac && CORE_CLASSES.has(ac)) return 'core';
  if (ac && SPEC_CLASSES.has(ac)) return 'speculative';
  if (ac === 'Commodity') return 'speculative';

  const n = `${h.name || ''} ${h.symbol || ''}`.toUpperCase();
  if (/\b(ETF|INDEX FUND|MUTUAL|REIT)\b/.test(n)) return 'core';
  if (/\b(WARRANT|W \d)\b/.test(n)) return 'speculative';

  if (ac === 'Stock' || ac === 'Other' || !ac) return 'high-upside';

  return 'high-upside';
}

export function engineSleeveKeyToTickerStatus(key: EngineSleeveKey): TickerStatus {
  if (key === 'core') return 'Core';
  if (key === 'speculative') return 'Speculative';
  return 'High-Upside';
}
