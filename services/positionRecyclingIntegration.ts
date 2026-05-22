/**
 * Maps holdings / recovery config → recycling plan input and planned-trade drafts.
 */

import type { Holding, RecoveryOrderDraft, RecoveryPositionConfig } from '../types';
import type { HoldingFundamentals } from './finnhubService';
import type { WealthUltraRiskTier } from '../types';
import {
  generatePositionRecyclingPlan,
  type ConvictionGrade,
  type PositionRecyclingInput,
  type PositionRecyclingPlan,
  type StockQualityStatus,
} from './positionRecyclingPlan';

export function inferConvictionGradeFromRiskTier(tier: WealthUltraRiskTier): ConvictionGrade {
  switch (tier) {
    case 'Low':
      return 'A';
    case 'Med':
      return 'B';
    case 'High':
      return 'C';
    case 'Spec':
    default:
      return 'D';
  }
}

export function inferStockQualityFromPlPct(plPct: number): StockQualityStatus {
  if (plPct <= -40) return 'Broken';
  if (plPct <= -25) return 'Weak';
  if (plPct >= 0) return 'Strong';
  return 'Medium';
}

/** Portfolio universe row status → default conviction when user has not overridden. */
export function inferConvictionFromUniverseStatus(status?: string): ConvictionGrade | undefined {
  switch (status) {
    case 'Core':
      return 'A';
    case 'High-Upside':
      return 'B';
    case 'Speculative':
      return 'D';
    default:
      return undefined;
  }
}

export function resolveUniverseStatusForSymbol(
  symbol: string,
  universe: Array<{ ticker?: string; status?: string }>,
): string | undefined {
  const sym = symbol.toUpperCase();
  return universe.find((u) => (u.ticker ?? '').toUpperCase() === sym)?.status;
}

export type RecyclingPlanSummary = {
  symbol: string;
  planAvailable: boolean;
  planStatus: PositionRecyclingPlan['planStatus'];
  coreShares: number;
  maxRecycleShares: number;
  trancheCount: number;
  finalBreakEven?: number;
  breakEvenImprovement?: number;
};

export function summarizeRecyclingPlan(plan: PositionRecyclingPlan): RecyclingPlanSummary {
  return {
    symbol: plan.ticker,
    planAvailable: plan.planAvailable,
    planStatus: plan.planStatus,
    coreShares: plan.positionSplit?.coreShares ?? 0,
    maxRecycleShares: plan.positionSplit?.maxRecycleShares ?? 0,
    trancheCount: plan.recyclingLadder.length,
    finalBreakEven: plan.projectedOutcome?.finalBreakEvenIfAllTranchesComplete,
    breakEvenImprovement: plan.projectedOutcome?.totalBreakEvenImprovementPerShare,
  };
}

export interface BuildRecyclingInputOptions {
  convictionGrade?: ConvictionGrade;
  stockQualityStatus?: StockQualityStatus;
  fundamentals?: HoldingFundamentals | null;
  allowOptions?: boolean;
  minRebuyDiscountPercent?: number;
  avoidSellingBelowAverage?: boolean;
  allowSellNearLoss?: boolean;
}

/** Build recycling input from a live holding row + price. */
export function buildPositionRecyclingInputFromHolding(
  holding: Holding,
  currentPrice: number,
  positionConfig?: RecoveryPositionConfig | null,
  opts: BuildRecyclingInputOptions = {},
): PositionRecyclingInput {
  const sharesOwned = Math.floor(Number(holding.quantity) || 0);
  const avg = Number(holding.avgCost) || 0;
  const plPct = avg > 0 && currentPrice > 0 ? ((currentPrice - avg) / avg) * 100 : 0;
  const tier = positionConfig?.riskTier ?? 'Med';

  const f = opts.fundamentals;
  const w52Low = f?.priceContext?.week52Low;
  const w52High = f?.priceContext?.week52High;
  return {
    ticker: String(holding.symbol || '').trim().toUpperCase(),
    companyName: String(holding.name || holding.symbol || '').trim(),
    currentPrice,
    averageCost: avg,
    sharesOwned,
    convictionGrade: opts.convictionGrade ?? inferConvictionGradeFromRiskTier(tier),
    stockQualityStatus: opts.stockQualityStatus ?? inferStockQualityFromPlPct(plPct),
    supportPrice: w52Low != null ? w52Low * 0.98 : undefined,
    resistancePrice: w52High != null ? w52High * 0.98 : undefined,
    fiftyTwoWeekLow: w52Low,
    fiftyTwoWeekHigh: w52High,
    allowOptions: opts.allowOptions ?? false,
    hasMinimum100Shares: sharesOwned >= 100,
    minRebuyDiscountPercent: opts.minRebuyDiscountPercent,
    avoidSellingBelowAverage: opts.avoidSellingBelowAverage,
    allowSellNearLoss: opts.allowSellNearLoss,
  };
}

export function buildRecyclingPlanForHolding(
  holding: Holding,
  currentPrice: number,
  positionConfig?: RecoveryPositionConfig | null,
  opts?: BuildRecyclingInputOptions,
): PositionRecyclingPlan {
  return generatePositionRecyclingPlan(
    buildPositionRecyclingInputFromHolding(holding, currentPrice, positionConfig, opts),
  );
}

/** Sell/rebuy limit drafts for Investment Plan (same shape as recovery drafts). */
export function recyclingPlanToOrderDrafts(plan: PositionRecyclingPlan): RecoveryOrderDraft[] {
  if (!plan.planAvailable) return [];
  const sym = plan.ticker;
  const drafts: RecoveryOrderDraft[] = [];
  for (const step of plan.recyclingLadder) {
    if (step.sharesToSell > 0) {
      drafts.push({
        type: 'SELL',
        symbol: sym,
        qty: step.sharesToSell,
        limitPrice: step.sellPrice,
        orderType: 'LIMIT',
        label: `Recycle sell T${step.trancheIndex}`,
        trancheKind: 'recycle_sell',
        trancheIndex: step.trancheIndex,
      });
    }
    if (step.rebuyRecommended && step.sharesToRebuy > 0) {
      drafts.push({
        type: 'BUY',
        symbol: sym,
        qty: step.sharesToRebuy,
        limitPrice: step.rebuyPrice,
        orderType: 'LIMIT',
        label: `Recycle rebuy T${step.trancheIndex}`,
        trancheKind: 'recycle_rebuy',
        trancheIndex: step.trancheIndex,
      });
    }
  }
  return drafts;
}
