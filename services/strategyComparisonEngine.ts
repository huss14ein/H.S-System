/**
 * Strategy comparison engine (spec §32).
 * Invest vs hold cash, house first vs mixed, debt first vs invest, etc.
 */

export interface StrategyScenario {
  id: string;
  label: string;
  projectedNetWorth: number;
  worstCaseDrawdownPct?: number;
  liquidityMonths?: number;
  goalDelayMonths?: number;
  expectedReturnBand?: [number, number];
}

/** Compare two or more strategies; returns ordered by projected NW or by user preference. */
export function compareStrategies(scenarios: StrategyScenario[]): StrategyScenario[] {
  return [...scenarios].sort((a, b) => (b.projectedNetWorth ?? 0) - (a.projectedNetWorth ?? 0));
}

/** Compare allocation models (e.g. aggressive vs balanced). */
export function compareAllocationModels(args: {
  models: { name: string; equityPct: number; projectedReturnPct: number; volatilityPct: number }[];
}): { name: string; equityPct: number; projectedReturnPct: number; volatilityPct: number; rank: number }[] {
  const ranked = args.models
    .map((m) => ({ ...m, rank: m.projectedReturnPct - m.volatilityPct * 0.5 }))
    .sort((a, b) => b.rank - a.rank);
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Compare goal priority rules (e.g. house first vs mixed). */
export function compareGoalPriorityRules(args: {
  rules: { name: string; goalCompletionMonths: number; totalSurplusUsed: number }[];
}): { name: string; goalCompletionMonths: number; totalSurplusUsed: number }[] {
  return [...args.rules].sort((a, b) => a.goalCompletionMonths - b.goalCompletionMonths);
}
