import type { Holding } from '../types';
import type { WealthUltraPosition, WealthUltraSleeve, WealthUltraRiskTier, WealthUltraStrategyMode } from '../types';
import type { WealthUltraConfig } from '../types';

export type PriceMap = Record<string, number>;

function buildTickerSets(config?: Pick<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'>) {
  const core = new Set((config?.coreTickers ?? []).map(t => t.toUpperCase()));
  const upside = new Set((config?.upsideTickers ?? []).map(t => t.toUpperCase()));
  const spec = new Set((config?.specTickers ?? []).map(t => t.toUpperCase()));
  return { core, upside, spec };
}

export function tickerToSleeve(ticker: string, config?: Pick<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'>): WealthUltraSleeve {
  const { core, upside, spec } = buildTickerSets(config);
  const t = ticker.toUpperCase();
  if (core.has(t)) return 'Core';
  if (upside.has(t)) return 'Upside';
  if (spec.has(t)) return 'Spec';
  return 'Core';
}

export function tickerToRiskTier(ticker: string, config?: Pick<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'>): WealthUltraRiskTier {
  const sleeve = tickerToSleeve(ticker, config);
  if (sleeve === 'Spec') return 'Spec';
  if (sleeve === 'Upside') return 'High';
  return 'Med';
}

export function buildWealthUltraPositions(
  holdings: Holding[],
  priceMap: PriceMap,
  sleeveOverrides?: Record<string, WealthUltraSleeve>,
  config?: Pick<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'>
): WealthUltraPosition[] {
  return holdings.map(h => {
    const sym = (h.symbol || '').toUpperCase();
    const sleeve = sleeveOverrides?.[sym] ?? tickerToSleeve(sym, config);
    const riskTier = tickerToRiskTier(sym, config);
    const currentPrice = priceMap[sym] ?? (h.quantity > 0 ? h.currentValue / h.quantity : h.avgCost);
    const marketValue = h.quantity * currentPrice;
    const plDollar = marketValue - h.quantity * h.avgCost;
    const costBasis = h.quantity * h.avgCost;
    const plPct = costBasis > 0 ? (plDollar / costBasis) * 100 : 0;
    let strategyMode: WealthUltraStrategyMode = 'Hold';
    if (plPct >= 40) strategyMode = 'Trim';
    else if (plPct <= -30) strategyMode = 'Exit';
    else if (plPct <= -15 && sleeve !== 'Spec') strategyMode = 'DipBuy';

    return {
      ticker: sym,
      sleeveType: sleeve,
      riskTier,
      strategyMode,
      currentShares: h.quantity,
      avgCost: h.avgCost,
      currentPrice,
      marketValue,
      plDollar,
      plPct,
      applyTarget1: true,
      applyTarget2: false,
      applyTrailing: true,
    };
  });
}
