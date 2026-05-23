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
import type { RecoveryPathMode } from './recoveryPathMode';
import { suggestDefaultRecoveryPathMode } from './recoveryPathSummaries';

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
  /** User picks one path — recycling OR buy ladder (not hybrid). */
  userPathMode?: RecoveryPathMode;
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
  activePathMode: RecoveryPathMode;
  suggestedPathMode: RecoveryPathMode;
  recyclingReady: boolean;
  ladderReady: boolean;
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
    userPathMode,
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

  const recyclingReady = Boolean(recyclingActive?.planAvailable);
  const ladderReady = Boolean(cashLadderActive?.qualified);

  const suggestedPathMode = suggestDefaultRecoveryPathMode({
    recyclingReady,
    ladderReady,
    plPct: metricsPlPct,
  });

  const activePathMode: RecoveryPathMode =
    userPathMode === 'recycling' || userPathMode === 'recovery_ladder'
      ? userPathMode
      : suggestedPathMode;

  let pathRecyclingActive = recyclingActive;
  let pathCashLadderActive = cashLadderActive;
  let pathAllDrafts = [...activeRecyclingDrafts, ...activeLadderDrafts];

  if (activePathMode === 'recycling') {
    pathCashLadderActive = null;
    pathAllDrafts = activeRecyclingDrafts;
  } else {
    pathRecyclingActive = null;
    pathAllDrafts = activeLadderDrafts;
  }

  const activeStates = buildTrancheExecutionStates(sym, pathAllDrafts, plannedTrades);
  const pendingDrafts = pendingDraftsOnly(pathAllDrafts, activeStates);

  let recommendedNextAction =
    activePathMode === 'recycling'
      ? 'Review recycling steps and push sell/rebuy limits to Investment Plan.'
      : 'Review buy ladder and push limit buys to Investment Plan.';
  const nextPending = activeStates.find((s) => s.status === 'pending');
  if (nextPending) {
    recommendedNextAction = `Next: ${nextPending.label} @ ${nextPending.limitPrice.toFixed(2)} (${nextPending.side} ${nextPending.qty} sh).`;
  } else if (activeStates.some((s) => s.status === 'filled')) {
    recommendedNextAction = 'All tracked tranches filled or recomputed — refresh position or export updated plan.';
  } else if (activePathMode === 'recycling' && !recyclingReady) {
    recommendedNextAction = 'Recycling blocked — check conviction/quality or try the buy ladder tab.';
  } else if (activePathMode === 'recovery_ladder' && !ladderReady) {
    recommendedNextAction = 'Buy ladder blocked — check loss trigger, deployable cash, or try recycling.';
  }

  const pathStrategy: UnifiedRecoveryStrategy =
    activePathMode === 'recycling' ? 'recycling_only' : 'cash_ladder_only';
  const pathStrategyReason =
    activePathMode === 'recycling'
      ? 'You chose position recycling — sell/rebuy using sale proceeds only (no new deposits).'
      : 'You chose recovery buy ladder — staged limit buys from deployable cash.';

  return {
    symbol: sym,
    strategy: pathStrategy,
    strategyReason: pathStrategyReason,
    conviction,
    recycling,
    recyclingSummary,
    cashLadder,
    recyclingActive: pathRecyclingActive,
    cashLadderActive: pathCashLadderActive,
    trancheStates: activeStates,
    allDrafts: pathAllDrafts,
    pendingDrafts,
    executionProgress: executionProgressLabel(activeStates),
    recommendedNextAction,
    activePathMode,
    suggestedPathMode,
    recyclingReady,
    ladderReady,
  };
}
