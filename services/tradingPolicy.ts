const KEY = 'finova_trading_policy_v1';

export interface TradingPolicy {
  minRunwayMonthsToAllowBuys: number;
  maxPositionWeightPct: number;
  blockBuysIfMonthlyNetNegative: boolean;
  requireAckLargeSellNotional: number;
}

export const DEFAULT_TRADING_POLICY: TradingPolicy = {
  minRunwayMonthsToAllowBuys: 1,
  maxPositionWeightPct: 35,
  blockBuysIfMonthlyNetNegative: false,
  requireAckLargeSellNotional: 25000,
};

export function loadTradingPolicy(): TradingPolicy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TRADING_POLICY };
    const p = JSON.parse(raw) as Partial<TradingPolicy>;
    return { ...DEFAULT_TRADING_POLICY, ...p };
  } catch {
    return { ...DEFAULT_TRADING_POLICY };
  }
}

export function saveTradingPolicy(p: TradingPolicy): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

export function evaluateBuyAgainstPolicy(input: {
  policy: TradingPolicy;
  runwayMonths: number;
  monthlyNetLast30d: number;
  positionWeightAfterBuyPct: number;
}): { allowed: boolean; reason?: string } {
  const { policy, runwayMonths, monthlyNetLast30d, positionWeightAfterBuyPct } = input;
  if (runwayMonths < policy.minRunwayMonthsToAllowBuys) {
    return {
      allowed: false,
      reason: `Cash runway (${runwayMonths.toFixed(1)} mo) below policy minimum (${policy.minRunwayMonthsToAllowBuys} mo).`,
    };
  }
  if (policy.blockBuysIfMonthlyNetNegative && monthlyNetLast30d < 0) {
    return { allowed: false, reason: 'Policy blocks buys while last-30d net cashflow is negative.' };
  }
  if (positionWeightAfterBuyPct > policy.maxPositionWeightPct) {
    return {
      allowed: false,
      reason: `Position would be ${positionWeightAfterBuyPct.toFixed(1)}% of portfolio; max ${policy.maxPositionWeightPct}%.`,
    };
  }
  return { allowed: true };
}
