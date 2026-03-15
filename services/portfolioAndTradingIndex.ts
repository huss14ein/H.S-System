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
