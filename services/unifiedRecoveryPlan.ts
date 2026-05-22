/**
 * Unified Recovery Plan — merges position recycling (no new cash) and buy ladder (deployable cash)
 * with synced conviction, execution tracking, and dynamic strategy selection.
 */

import type {
  FinancialData,
  Holding,
  PlannedTrade,
  RecoveryGlobalConfig,
  RecoveryOrderDraft,
  RecoveryPlanResult,
  RecoveryPositionConfig,
} from '../types';
import type { HoldingFundamentals } from './finnhubService';
import {
  buildRecyclingPlanForHolding,
  recyclingPlanToOrderDrafts,
  summarizeRecyclingPlan,
  type BuildRecyclingInputOptions,
  type RecyclingPlanSummary,
} from './positionRecyclingIntegration';
import type { PositionRecyclingPlan } from './positionRecyclingPlan';
import {
  buildRecoveryPlan,
  buildRecoveryPlanAfterFilledLevels,
  orderDraftGenerator,
} from './recoveryPlan';
import {
  buildWatchlistScoresFromItems,
  resolveSyncedRecoveryConviction,
  type ResolvedRecoveryConviction,
  type WatchlistScoreInput,
} from './recoveryConvictionSync';
import {
  buildTrancheExecutionStates,
  getFilledTrancheIndexes,
  inferHoldingAfterTrancheFills,
  pendingDraftsOnly,
  executionProgressLabel,
  type RecoveryTrancheExecutionState,
} from './recoveryExecutionTracker';

export type UnifiedRecoveryStrategy =
  | 'recycling_only'
  | 'cash_ladder_only'
  | 'hybrid_recycling_first'
  | 'hybrid_parallel';

export interface UnifiedRecoveryPlanInput {
  holding: Holding;
  currentPrice: number;
  positionConfig: RecoveryPositionConfig;
  globalConfig: RecoveryGlobalConfig;
  data?: FinancialData | null;
  fundamentals?: HoldingFundamentals | null;
  plannedTrades?: PlannedTrade[];
  recyclingOpts?: BuildRecyclingInputOptions;
  watchlistScores?: WatchlistScoreInput[];
  includeExitDraft?: boolean;
}

export interface UnifiedRecoveryPlan {
  symbol: string;
  strategy: UnifiedRecoveryStrategy;
  strategyReason: string;
  conviction: ResolvedRecoveryConviction;
  /** Full plan from current holding (before fill simulation). */
  recycling: PositionRecyclingPlan | null;
  recyclingSummary: RecyclingPlanSummary | null;
  cashLadder: RecoveryPlanResult | null;
  /** Plans after applying filled tranches from Investment Plan. */
  recyclingActive: PositionRecyclingPlan | null;
  cashLadderActive: RecoveryPlanResult | null;
  trancheStates: RecoveryTrancheExecutionState[];
  allDrafts: RecoveryOrderDraft[];
  pendingDrafts: RecoveryOrderDraft[];
  executionProgress: string;
  recommendedNextAction: string;
}

function selectStrategy(args: {
  recyclingAvailable: boolean;
  cashQualified: boolean;
  deployableCash: number;
  plPct: number;
}): { strategy: UnifiedRecoveryStrategy; reason: string } {
  const { recyclingAvailable, cashQualified, deployableCash, plPct } = args;
  const loss = Math.abs(plPct);

  if (recyclingAvailable && cashQualified) {
    if (deployableCash >= 3000 && loss < 28) {
      return {
        strategy: 'hybrid_parallel',
        reason:
          'Loss is moderate and deployable cash is available — run recycling tranches and buy ladder together.',
      };
    }
    return {
      strategy: 'hybrid_recycling_first',
      reason:
        'Deep loss or limited cash — prioritize no-cash recycling, then deploy buy ladder on remaining dips.',
    };
  }
  if (recyclingAvailable) {
    return {
      strategy: 'recycling_only',
      reason: 'Buy ladder blocked by guardrails — use sell/rebuy recycling only (no new deposits).',
    };
  }
  if (cashQualified) {
    return {
      strategy: 'cash_ladder_only',
      reason: 'Recycling unavailable — deploy staged buy ladder from deployable cash.',
    };
  }
  return {
    strategy: 'recycling_only',
    reason: 'Default to recycling review; adjust conviction or quality if blocked.',
  };
}

export function buildUnifiedRecoveryPlan(input: UnifiedRecoveryPlanInput): UnifiedRecoveryPlan {
  const {
    holding,
    currentPrice,
    positionConfig,
    globalConfig,
    data,
    fundamentals,
    plannedTrades = [],
    recyclingOpts = {},
    watchlistScores,
    includeExitDraft = false,
  } = input;

  const sym = String(holding.symbol ?? '').trim().toUpperCase();
  const metricsPlPct =
    Number(holding.avgCost) > 0 && currentPrice > 0
      ? ((currentPrice - Number(holding.avgCost)) / Number(holding.avgCost)) * 100
      : 0;

  const wlScores =
    watchlistScores ??
    buildWatchlistScoresFromItems(data?.watchlist ?? []);

  const conviction = resolveSyncedRecoveryConviction({
    symbol: sym,
    plPct: metricsPlPct,
    riskTier: positionConfig.riskTier,
    universe: data?.portfolioUniverse,
    watchlistItems: wlScores,
    userConvictionGrade: recyclingOpts.convictionGrade,
    userStockQuality: recyclingOpts.stockQualityStatus,
  });

  const recyclingInputOpts: BuildRecyclingInputOptions = {
    ...recyclingOpts,
    convictionGrade: conviction.convictionGrade,
    stockQualityStatus: conviction.stockQualityStatus,
    fundamentals: fundamentals ?? recyclingOpts.fundamentals,
    allowSellNearLoss: recyclingOpts.allowSellNearLoss ?? true,
  };

  let recycling: PositionRecyclingPlan | null = null;
  let recyclingSummary: RecyclingPlanSummary | null = null;
  if (metricsPlPct < 0 && currentPrice > 0) {
    recycling = buildRecyclingPlanForHolding(holding, currentPrice, positionConfig, recyclingInputOpts);
    recyclingSummary = summarizeRecyclingPlan(recycling);
  }

  let cashLadder: RecoveryPlanResult | null = null;
  if (currentPrice > 0) {
    cashLadder = buildRecoveryPlan(holding, currentPrice, positionConfig, globalConfig);
  }

  const { strategy, reason: strategyReason } = selectStrategy({
    recyclingAvailable: Boolean(recycling?.planAvailable),
    cashQualified: Boolean(cashLadder?.qualified),
    deployableCash: globalConfig.deployableCash,
    plPct: metricsPlPct,
  });

  const baseRecyclingDrafts = recycling?.planAvailable ? recyclingPlanToOrderDrafts(recycling) : [];
  const baseLadderDrafts =
    cashLadder?.qualified ? orderDraftGenerator(cashLadder, includeExitDraft) : [];
  const allDrafts = [...baseRecyclingDrafts, ...baseLadderDrafts];

  const trancheStates = buildTrancheExecutionStates(sym, allDrafts, plannedTrades);
  const adjustedHolding = inferHoldingAfterTrancheFills(holding, trancheStates);

  const filledRecycleSells = getFilledTrancheIndexes(trancheStates, 'recycle_sell');
  const filledRecycleRebuys = getFilledTrancheIndexes(trancheStates, 'recycle_rebuy');
  const filledLadder = getFilledTrancheIndexes(trancheStates, 'ladder_buy');
  const anyRecycleFill = filledRecycleSells.size > 0 || filledRecycleRebuys.size > 0;

  let recyclingActive: PositionRecyclingPlan | null = recycling;
  if (recycling && anyRecycleFill && adjustedHolding.quantity > 0) {
    recyclingActive = buildRecyclingPlanForHolding(
      adjustedHolding,
      currentPrice,
      positionConfig,
      recyclingInputOpts,
    );
  }

  let cashLadderActive: RecoveryPlanResult | null = cashLadder;
  if (cashLadder?.qualified && filledLadder.size > 0) {
    cashLadderActive = buildRecoveryPlanAfterFilledLevels(
      adjustedHolding,
      currentPrice,
      positionConfig,
      globalConfig,
      filledLadder,
    );
  }

  const activeRecyclingDrafts = recyclingActive?.planAvailable
    ? recyclingPlanToOrderDrafts(recyclingActive)
    : [];
  const activeLadderDrafts = cashLadderActive?.qualified
    ? orderDraftGenerator(cashLadderActive, includeExitDraft)
    : [];

  const activeAllDrafts = [...activeRecyclingDrafts, ...activeLadderDrafts];
  const activeStates = buildTrancheExecutionStates(sym, activeAllDrafts, plannedTrades);
  const pendingDrafts = pendingDraftsOnly(activeAllDrafts, activeStates);

  let recommendedNextAction = 'Review unified plan and push pending limits to Investment Plan.';
  const nextPending = activeStates.find((s) => s.status === 'pending');
  if (nextPending) {
    recommendedNextAction = `Next: ${nextPending.label} @ ${nextPending.limitPrice.toFixed(2)} (${nextPending.side} ${nextPending.qty} sh).`;
  } else if (activeStates.some((s) => s.status === 'filled')) {
    recommendedNextAction = 'All tracked tranches filled or recomputed — refresh position or export updated plan.';
  } else if (!recycling?.planAvailable && !cashLadder?.qualified) {
    recommendedNextAction = 'Adjust conviction, quality, or deployable cash to unlock a recovery path.';
  }

  return {
    symbol: sym,
    strategy,
    strategyReason,
    conviction,
    recycling,
    recyclingSummary,
    cashLadder,
    recyclingActive,
    cashLadderActive,
    trancheStates: activeStates,
    allDrafts: activeAllDrafts,
    pendingDrafts,
    executionProgress: executionProgressLabel(activeStates),
    recommendedNextAction,
  };
}
