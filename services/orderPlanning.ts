/**
 * Order planning logic (logic layer).
 *
 * Note: This project primarily uses heuristic scores and guardrails.
 * These helpers provide a deterministic way to translate intent into
 * staged BUY/SELL ladders and average-cost math.
 */

export type RoundingRule = 'round' | 'floor' | 'ceil';

export interface PlannedOrderLine {
  label?: string;
  limitPrice: number;
  amount: number; // in plan currency for totals/logs
  /** Optional: derived shares when fractional is not allowed. */
  shares?: number;
}

export interface BuyTrancheInput {
  currentPrice: number;
  /** Total amount to deploy across all buy tranches. */
  totalAmount: number;
  /**
   * Buy ladder steps as percentages below current price.
   * Example: [0, 5, 10] means tranche at current, 5% down, 10% down.
   */
  downStepsPct: number[];
  /** Optional weights per tranche; defaults to equal weights. */
  weights?: number[];
  allowFractionalShares?: boolean;
  roundingRule?: RoundingRule;
}

export function generateBuyTranches(input: BuyTrancheInput): PlannedOrderLine[] {
  const {
    currentPrice,
    totalAmount,
    downStepsPct,
    weights,
    allowFractionalShares = true,
    roundingRule = 'round',
  } = input;

  const steps = [...downStepsPct].sort((a, b) => a - b);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];
  const total = Math.max(0, totalAmount);
  if (total <= 0 || steps.length === 0) return [];

  const w = (weights && weights.length === steps.length ? weights : steps.map(() => 1)).map((x) =>
    Number.isFinite(x) && x > 0 ? x : 1
  );
  const wSum = w.reduce((s, x) => s + x, 0);
  const normalized = wSum > 0 ? w.map((x) => x / wSum) : w.map(() => 1 / steps.length);

  return steps.map((stepPct, idx) => {
    const limitPrice = currentPrice * (1 - stepPct / 100);
    const amount = total * normalized[idx];
    const shares = allowFractionalShares ? undefined : roundShares(amount / Math.max(1e-9, limitPrice), roundingRule);
    return { label: `Buy @ ${stepPct.toFixed(0)}%`, limitPrice, amount, shares };
  });
}

export interface SellTrancheInput {
  /** Current price used as baseline for sell ladder levels. */
  currentPrice: number;
  totalAmount?: number;
  /** Total quantity to plan sells for; if provided, shares are derived. */
  totalShares?: number;
  /**
   * Profit targets as percentages above current price.
   * Example: [5, 10, 20] means sell portions at +5%, +10%, +20%.
   */
  upStepsPct: number[];
  weights?: number[];
  allowFractionalShares?: boolean;
  roundingRule?: RoundingRule;
}

export function generateSellTranches(input: SellTrancheInput): PlannedOrderLine[] {
  const {
    currentPrice,
    upStepsPct,
    weights,
    totalAmount,
    totalShares,
    allowFractionalShares = true,
    roundingRule = 'round',
  } = input;

  const steps = [...upStepsPct].sort((a, b) => a - b);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];
  if (steps.length === 0) return [];

  const w = (weights && weights.length === steps.length ? weights : steps.map(() => 1)).map((x) =>
    Number.isFinite(x) && x > 0 ? x : 1
  );
  const wSum = w.reduce((s, x) => s + x, 0);
  const normalized = wSum > 0 ? w.map((x) => x / wSum) : w.map(() => 1 / steps.length);

  const canQty = Number.isFinite(totalShares) && (totalShares as number) > 0;
  const canAmt = Number.isFinite(totalAmount) && (totalAmount as number) > 0;
  // If neither quantity nor amount is provided, we still return ladder prices with amount=0.
  const amountTotal = canAmt ? Math.max(0, totalAmount as number) : 0;
  const sharesTotal = canQty ? Math.max(0, totalShares as number) : 0;

  return steps.map((stepPct, idx) => {
    const limitPrice = currentPrice * (1 + stepPct / 100);
    const weight = normalized[idx];

    const shares = canQty
      ? allowFractionalShares
        ? sharesTotal * weight
        : roundShares(sharesTotal * weight, roundingRule)
      : undefined;

    const amount = canQty
      ? (shares ?? 0) * limitPrice
      : canAmt
        ? amountTotal * weight
        : 0;

    return { label: `Sell @ +${stepPct.toFixed(0)}%`, limitPrice, amount, shares };
  });
}

function roundShares(shares: number, rule: RoundingRule): number {
  const x = Number.isFinite(shares) ? shares : 0;
  if (rule === 'floor') return Math.floor(x);
  if (rule === 'ceil') return Math.ceil(x);
  return Math.round(x);
}

export interface AverageCostAfterAddsInput {
  /** Existing position average cost. */
  avgCost: number;
  /** Existing shares/units. */
  currentShares: number;
  /** Planned adds as {shares, price}. */
  plannedAdds: { shares: number; price: number }[];
}

export function computeAverageEntryAfterPlannedAdds(input: AverageCostAfterAddsInput): number {
  const currentShares = Math.max(0, input.currentShares);
  const avgCost = Math.max(0, input.avgCost);
  if (currentShares <= 0 && input.plannedAdds.length === 0) return avgCost;

  const currentCost = currentShares * avgCost;
  const addCost = input.plannedAdds.reduce((s, a) => s + Math.max(0, a.shares) * Math.max(0, a.price), 0);
  const totalShares = currentShares + input.plannedAdds.reduce((s, a) => s + Math.max(0, a.shares), 0);
  if (totalShares <= 0) return 0;
  return (currentCost + addCost) / totalShares;
}

export interface StagedExitPlanInput {
  currentPrice: number;
  /** Profit targets as percentages above current price. */
  takeProfitUpStepsPct: number[];
  /** Stop-loss as percentage below current price (e.g. 15 means -15%). */
  stopLossDownPct: number;
  /** Optional weights across take-profit steps (sum ~= 1). */
  takeProfitWeights?: number[];
}

export interface StagedExitPlan {
  takeProfits: PlannedOrderLine[];
  stopLoss: PlannedOrderLine;
}

export function stagedExitPlan(input: StagedExitPlanInput): StagedExitPlan {
  const tp = generateSellTranches({
    currentPrice: input.currentPrice,
    upStepsPct: input.takeProfitUpStepsPct,
    weights: input.takeProfitWeights,
  });
  const stopPrice = input.currentPrice * (1 - input.stopLossDownPct / 100);
  return {
    takeProfits: tp,
    stopLoss: {
      label: 'Stop loss',
      limitPrice: stopPrice,
      amount: 0,
    },
  };
}

