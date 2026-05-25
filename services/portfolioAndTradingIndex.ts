/**
 * Central export for Portfolio Construction, Trading Execution, Risk & Compliance, and Technical Indicators.
 * Use these modules where allocation, order validation, risk, or technical signals are needed.
 */

export {
  getTargetAllocationForProfile,
  dollarToShareQuantity,
  meanVarianceOptimization,
  monteCarloGoalSuccess,
  type RiskProfile,
  type TargetAssetMix,
  type FractionalShareOptions,
  type MVOInput,
  type MVOResult,
  type MonteCarloGoalInput,
  type MonteCarloGoalResult,
} from './portfolioConstruction';

export {
  isWithinRegularHoursET,
  checkExtendedHoursGuardrail,
  getTIFLabel,
  getNBBOStub,
  getSORStub,
  getVWAPSlices,
  type TIF,
  type OrderType,
  type NBBOQuote,
  type SORResult,
  type VWAPSlice,
} from './tradingExecution';

export {
  wouldViolatePDT,
  getPDTStatus,
  valueAtRiskHistorical,
  getSettlementDate,
  isSettled,
  volatilityAdjustedWeights,
  isNYSEHolidayOrWeekend,
  getMarketHoursGuardrail,
  type PDTState,
  type SettlementState,
} from './riskCompliance';

export {
  generatePositionRecyclingPlan,
  type PositionRecyclingInput,
  type PositionRecyclingPlan,
  type ConvictionGrade,
  type StockQualityStatus,
  type RecyclingLadderStep,
  type ProjectedRecyclingOutcome,
} from './positionRecyclingPlan';

export {
  buildPositionRecyclingInputFromHolding,
  buildRecyclingPlanForHolding,
  recyclingPlanToOrderDrafts,
  inferConvictionGradeFromRiskTier,
  inferStockQualityFromPlPct,
  inferConvictionFromUniverseStatus,
  summarizeRecyclingPlan,
} from './positionRecyclingIntegration';

export {
  loadRecyclingPrefs,
  saveRecyclingPrefs,
  saveRecyclingExecutionFromPlan,
  exportRecyclingPlanJson,
  getRecyclingExecutionsBySymbol,
} from './positionRecyclingPersistence';

export {
  resolveSyncedRecoveryConviction,
  convictionGradeFromWatchlistBlend,
  buildWatchlistScoresFromItems,
} from './recoveryConvictionSync';

export {
  buildTrancheExecutionStates,
  inferHoldingAfterTrancheFills,
  executionProgressLabel,
  parseTrancheFromLabel,
} from './recoveryExecutionTracker';

export { buildUnifiedRecoveryPlan, type UnifiedRecoveryPlan, type UnifiedRecoveryStrategy } from './unifiedRecoveryPlan';

export { buildRecoveryPlanAfterFilledLevels, reconcileAfterFill } from './recoveryPlan';

export {
  sma,
  ema,
  crossover,
  smaCrossoverSignal,
  shortTermCrossoverSignal,
  rsi,
  rsiSignal,
  bollingerBands,
  zScore,
  zScoreSignal,
  type PriceSeries,
} from './technicalIndicators';
