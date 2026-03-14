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

/** Maps sleeve to risk tier for risk distribution and capital efficiency (return % × risk weight).
 * Core → Med (1.25), Upside → High (1.5), Spec → Spec (2.0). Keeps risk weights and alert severity appropriate. */
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
    const qty = Number(h.quantity) || 0;
    const avgCost = Number(h.avgCost) || 0;
    const currentPrice = priceMap[sym] ?? (qty > 0 && h.currentValue != null ? (Number(h.currentValue) || 0) / qty : avgCost);
    const marketValue = qty * currentPrice;
    const costBasis = qty * avgCost;
    const plDollar = marketValue - costBasis;
    const plPctRaw = costBasis > 0 ? (plDollar / costBasis) * 100 : 0;
    const plPct = Number.isFinite(plPctRaw) ? plPctRaw : 0;
    let strategyMode: WealthUltraStrategyMode = 'Hold';
    if (plPct >= 40) strategyMode = 'Trim';
    else if (plPct <= -30) strategyMode = 'Exit';
    else if (plPct <= -15 && sleeve !== 'Spec') strategyMode = 'DipBuy';

    // Simple composite risk score (0–100). Can be refined later with richer inputs.
    const normalizedVolProxy = Math.min(1, Math.max(0, Math.abs(plPct) / 60)); // 0 at 0%, 1 at |60%+|
    const tierWeight =
      riskTier === 'Low' ? 0.2 :
      riskTier === 'Med' ? 0.5 :
      riskTier === 'High' ? 0.75 :
      1;
    const lossPenalty = plPct < -20 ? Math.min(1, Math.abs(plPct + 20) / 40) : 0; // kicks in after -20%
    const rawRiskScore = 100 * (0.5 * normalizedVolProxy + 0.3 * tierWeight + 0.2 * lossPenalty);
    const riskScore = Math.round(Math.min(100, Math.max(0, rawRiskScore)));

    return {
      ticker: sym,
      sleeveType: sleeve,
      riskTier,
      strategyMode,
      riskScore,
      currentShares: qty,
      avgCost,
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
