/**
 * Average reduction / position recycling — sell rebound tranches and rebuy lower
 * using only cash from those sales (no new capital, never liquidate full position).
 */

export type ConvictionGrade = 'A' | 'B' | 'C' | 'D';
export type StockQualityStatus = 'Strong' | 'Medium' | 'Weak' | 'Broken';
export type PositionRecyclingPlanStatus = 'active' | 'blocked' | 'exit_review';

export interface PositionRecyclingInput {
  ticker: string;
  companyName: string;
  currentPrice: number;
  averageCost: number;
  sharesOwned: number;
  convictionGrade: ConvictionGrade;
  stockQualityStatus: StockQualityStatus;
  supportPrice?: number;
  resistancePrice?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  allowOptions: boolean;
  hasMinimum100Shares: boolean;
  minRebuyDiscountPercent?: number;
  maxSharesAllowedToRecyclePercent?: number;
  avoidSellingBelowAverage?: boolean;
  allowSellNearLoss?: boolean;
}

export interface PositionRecyclingCurrentPosition {
  sharesOwned: number;
  averageCost: number;
  currentPrice: number;
  totalCost: number;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  priceGapToAveragePercent: number;
}

export interface PositionRecyclingSplit {
  coreShares: number;
  recyclingShares: number;
  maxRecycleShares: number;
  corePercent: number;
  recyclePercent: number;
  minSharesRemainingAfterAllSells: number;
}

export interface PositionRecyclingMarketContext {
  supportPrice?: number;
  resistancePrice?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  /** 0–100 position in 52-week range when both bounds exist. */
  rangePositionPercent?: number;
  near52WeekLow: boolean;
  near52WeekHigh: boolean;
  priceVsSupport?: 'above' | 'at' | 'below';
  priceVsResistance?: 'below' | 'at' | 'above';
  sellCeilingFromResistance?: number;
  notes: string[];
}

export interface SellTranchePlan {
  trancheIndex: 1 | 2 | 3;
  sharesToSell: number;
  sellPrice: number;
  percentOfRecyclingPool: number;
  triggerDescription: string;
  notes?: string;
}

export interface RebuyTranchePlan {
  trancheIndex: 1 | 2 | 3;
  linkedSellTranche: 1 | 2 | 3;
  sellPrice: number;
  rebuyPrice: number;
  rebuyDiscountPercent: number;
  cashFromSale: number;
  sharesToRebuy: number;
  rebuyRecommended: boolean;
  triggerDescription: string;
  leftoverCash: number;
}

export interface RecyclingLadderStep {
  trancheIndex: 1 | 2 | 3;
  sharesToSell: number;
  sellPrice: number;
  rebuyPrice: number;
  rebuyDiscountPercent: number;
  sharesToRebuy: number;
  sharesAfterSell: number;
  sharesAfterRebuy: number;
  newEconomicBreakEven: number;
  breakEvenImprovement: number;
  cumulativeSharesRebought: number;
  cashRecycled: number;
  rebuyRecommended: boolean;
}

export interface ProjectedRecyclingCycle {
  trancheIndex: 1 | 2 | 3;
  sharesSoldThisTranche: number;
  sharesAfterSell: number;
  sharesAfterRebuy: number;
  newEconomicBreakEven: number;
  breakEvenImprovement: number;
  cumulativeSharesRebought: number;
  netShareChangeVsStart: number;
}

export interface ProjectedRecyclingOutcome {
  startingShares: number;
  finalSharesIfAllTranchesComplete: number;
  finalBreakEvenIfAllTranchesComplete: number;
  totalBreakEvenImprovementPerShare: number;
  totalSharesSold: number;
  totalSharesRebought: number;
  netShareChange: number;
  meaningfulImprovement: boolean;
}

export interface PositionRecyclingReadiness {
  score: number;
  checks: Array<{ id: string; ok: boolean; label: string }>;
}

export interface PositionRecyclingPlan {
  ticker: string;
  companyName: string;
  summary: string;
  planStatus: PositionRecyclingPlanStatus;
  planAvailable: boolean;
  currentPosition: PositionRecyclingCurrentPosition;
  positionSplit: PositionRecyclingSplit | null;
  marketContext: PositionRecyclingMarketContext | null;
  readiness: PositionRecyclingReadiness | null;
  sellPlan: SellTranchePlan[];
  rebuyPlan: RebuyTranchePlan[];
  recyclingLadder: RecyclingLadderStep[];
  projectedResults: ProjectedRecyclingCycle[];
  projectedOutcome: ProjectedRecyclingOutcome | null;
  warnings: string[];
  optionsNotes: string[];
  actionMessage: string;
}

const TRANCHE_WEIGHTS = [0.25, 0.35, 0.4] as const;
const MIN_MEANINGFUL_BREAK_EVEN_IMPROVEMENT = 0.25;
const NEAR_AVERAGE_BAND_PCT = 2;

const DEFAULT_MAX_RECYCLE_PERCENT: Record<ConvictionGrade, number> = {
  A: 30,
  B: 50,
  C: 40,
  D: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function getGradeSplit(
  grade: ConvictionGrade,
  quality: StockQualityStatus,
): { corePercent: number; recyclePercent: number } | null {
  if (grade === 'D' || quality === 'Broken') return null;
  switch (grade) {
    case 'A':
      return { corePercent: 70, recyclePercent: 30 };
    case 'B':
      return { corePercent: 50, recyclePercent: 50 };
    case 'C':
      return { corePercent: 60, recyclePercent: 40 };
    default:
      return null;
  }
}

function isNearAverage(currentPrice: number, averageCost: number): boolean {
  if (averageCost <= 0) return false;
  const gapPct = Math.abs((currentPrice - averageCost) / averageCost) * 100;
  return gapPct <= NEAR_AVERAGE_BAND_PCT;
}

function resolveRebuyDiscountPercent(
  input: PositionRecyclingInput,
  priceGapToAveragePercent: number,
): number {
  const base = input.minRebuyDiscountPercent ?? 10;
  let discount = Math.max(8, base);
  if (input.stockQualityStatus === 'Weak' || priceGapToAveragePercent >= 20) {
    discount = Math.max(discount, 12);
  }
  if (input.stockQualityStatus === 'Weak' && priceGapToAveragePercent >= 30) {
    discount = Math.max(discount, 15);
  }
  return discount;
}

function allocateTrancheShares(totalRecycleShares: number): [number, number, number] {
  if (totalRecycleShares <= 0) return [0, 0, 0];
  const t1 = Math.floor(totalRecycleShares * TRANCHE_WEIGHTS[0]);
  const t2 = Math.floor(totalRecycleShares * TRANCHE_WEIGHTS[1]);
  const t3 = totalRecycleShares - t1 - t2;
  return [t1, t2, t3];
}

function buildSellPrices(
  currentPrice: number,
  averageCost: number,
  belowAverage: boolean,
  nearAverage: boolean,
): [number, number, number] {
  if (belowAverage) {
    return [
      round2(currentPrice * 1.05),
      round2(currentPrice * 1.1),
      round2(Math.min(averageCost, currentPrice * 1.16)),
    ];
  }
  if (nearAverage) {
    return [
      round2(averageCost),
      round2(Math.max(averageCost, currentPrice * 1.03)),
      round2(averageCost * 1.05),
    ];
  }
  return [
    round2(Math.max(averageCost, currentPrice)),
    round2(averageCost * 1.05),
    round2(averageCost * 1.1),
  ];
}

function applySellGuards(
  prices: [number, number, number],
  averageCost: number,
  avoidSellingBelowAverage: boolean,
  allowSellNearLoss: boolean,
): [number, number, number] {
  return prices.map((p) => {
    let next = p;
    if (avoidSellingBelowAverage && next < averageCost) next = averageCost;
    if (!allowSellNearLoss && next < averageCost) next = averageCost;
    return round2(next);
  }) as [number, number, number];
}

function capSellPricesToResistance(
  prices: [number, number, number],
  resistancePrice: number | undefined,
  currentPrice: number,
): [number, number, number] {
  if (resistancePrice == null || resistancePrice <= 0 || resistancePrice <= currentPrice) {
    return prices;
  }
  return prices.map((p) => round2(Math.min(p, resistancePrice))) as [number, number, number];
}

function buildMarketContext(input: PositionRecyclingInput): PositionRecyclingMarketContext {
  const notes: string[] = [];
  const low = input.fiftyTwoWeekLow;
  const high = input.fiftyTwoWeekHigh;
  const near52WeekLow =
    low != null && low > 0 && input.currentPrice <= low * 1.05;
  const near52WeekHigh =
    high != null && high > 0 && input.currentPrice >= high * 0.95;

  let rangePositionPercent: number | undefined;
  if (low != null && high != null && high > low) {
    rangePositionPercent = round2(((input.currentPrice - low) / (high - low)) * 100);
  }

  let priceVsSupport: PositionRecyclingMarketContext['priceVsSupport'];
  if (input.supportPrice != null && input.supportPrice > 0) {
    const diff = (input.currentPrice - input.supportPrice) / input.supportPrice;
    if (diff > 0.02) priceVsSupport = 'above';
    else if (diff < -0.02) priceVsSupport = 'below';
    else priceVsSupport = 'at';
  }

  let priceVsResistance: PositionRecyclingMarketContext['priceVsResistance'];
  let sellCeilingFromResistance: number | undefined;
  if (input.resistancePrice != null && input.resistancePrice > 0) {
    const diff = (input.currentPrice - input.resistancePrice) / input.resistancePrice;
    if (diff > 0.02) priceVsResistance = 'above';
    else if (diff < -0.02) priceVsResistance = 'below';
    else priceVsResistance = 'at';
    if (input.resistancePrice > input.currentPrice) {
      sellCeilingFromResistance = input.resistancePrice;
      notes.push(`Sell ladder capped near resistance $${input.resistancePrice.toFixed(2)}.`);
    }
  }

  if (near52WeekLow) notes.push('Trading near 52-week low — rebound sells should be conservative.');
  if (near52WeekHigh) notes.push('Trading near 52-week high — favorable zone for staged profit-taking on recycle pool.');

  return {
    supportPrice: input.supportPrice,
    resistancePrice: input.resistancePrice,
    fiftyTwoWeekLow: low,
    fiftyTwoWeekHigh: high,
    rangePositionPercent,
    near52WeekLow,
    near52WeekHigh,
    priceVsSupport,
    priceVsResistance,
    sellCeilingFromResistance,
    notes,
  };
}

function buildReadiness(
  input: PositionRecyclingInput,
  current: PositionRecyclingCurrentPosition,
  split: PositionRecyclingSplit | null,
  sellCount: number,
): PositionRecyclingReadiness {
  const checks: PositionRecyclingReadiness['checks'] = [
    {
      id: 'shares',
      ok: current.sharesOwned >= 2,
      label: 'At least 2 shares to split core vs recycle',
    },
    {
      id: 'fx',
      ok: Number.isFinite(input.currentPrice) && input.currentPrice > 0,
      label: 'Valid live price',
    },
    {
      id: 'quality',
      ok: input.stockQualityStatus !== 'Broken' && input.convictionGrade !== 'D',
      label: 'Quality/conviction allow recycling',
    },
    {
      id: 'ladder',
      ok: sellCount > 0,
      label: 'At least one sell tranche generated',
    },
    {
      id: 'core_floor',
      ok: split != null && split.coreShares > 0 && split.maxRecycleShares <= split.recyclingShares,
      label: 'Core floor and recycle cap consistent',
    },
    {
      id: 'no_full_exit',
      ok: split != null && split.minSharesRemainingAfterAllSells >= split.coreShares,
      label: 'Ladder never liquidates below core',
    },
  ];
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { score, checks };
}

function buildNoPlan(
  input: PositionRecyclingInput,
  current: PositionRecyclingCurrentPosition,
  reason: string,
  status: PositionRecyclingPlanStatus = 'exit_review',
): PositionRecyclingPlan {
  return {
    ticker: input.ticker,
    companyName: input.companyName,
    summary: reason,
    planStatus: status,
    planAvailable: false,
    currentPosition: current,
    positionSplit: null,
    marketContext: buildMarketContext(input),
    readiness: buildReadiness(input, current, null, 0),
    sellPlan: [],
    rebuyPlan: [],
    recyclingLadder: [],
    projectedResults: [],
    projectedOutcome: null,
    warnings: [reason],
    optionsNotes: [],
    actionMessage: reason,
  };
}

function buildActionMessage(params: {
  ticker: string;
  coreShares: number;
  sellPlan: SellTranchePlan[];
  rebuyPlan: RebuyTranchePlan[];
  minDiscount: number;
  projectedOutcome: ProjectedRecyclingOutcome | null;
}): string {
  const { ticker, coreShares, sellPlan, rebuyPlan, minDiscount, projectedOutcome } = params;
  if (sellPlan.length === 0) {
    return `No recycling plan for ${ticker}. Keep core shares; review exit or recovery options instead of averaging down.`;
  }
  const sellParts = sellPlan
    .filter((t) => t.sharesToSell > 0)
    .map((t) => `${t.sharesToSell} shares at $${t.sellPrice.toFixed(2)}`);
  const rebuyThresholds = rebuyPlan
    .filter((r) => r.rebuyRecommended && r.sharesToRebuy > 0)
    .map((r) => `$${r.rebuyPrice.toFixed(2)} (${r.rebuyDiscountPercent.toFixed(0)}% below sell)`);
  const improve =
    projectedOutcome && projectedOutcome.meaningfulImprovement
      ? ` If all tranches complete, break-even could improve by ~$${projectedOutcome.totalBreakEvenImprovementPerShare.toFixed(2)}/share.`
      : '';
  return [
    `Hold now. Keep ${coreShares} shares as core for ${ticker}.`,
    `Sell ${sellParts.join(', ')} on rebounds.`,
    rebuyThresholds.length > 0
      ? `Rebuy only if price drops to ${rebuyThresholds.join(' or ')} — same cash only, no new money.`
      : `Rebuy needs at least ${minDiscount}% below each sell — widen discount or wait for volatility.`,
    `Never sell below ${coreShares} remaining shares; no margin and no new deposits.${improve}`,
  ].join(' ');
}

/**
 * Generate a position recycling plan: core hold + sell/rebuy ladder without new cash.
 */
export function generatePositionRecyclingPlan(input: PositionRecyclingInput): PositionRecyclingPlan {
  assertPositiveFinite(input.currentPrice, 'currentPrice');
  assertPositiveFinite(input.averageCost, 'averageCost');
  assertPositiveFinite(input.sharesOwned, 'sharesOwned');

  const sharesOwned = Math.floor(input.sharesOwned);
  if (sharesOwned < 1) throw new Error('sharesOwned must be at least 1');

  const totalCost = input.averageCost * sharesOwned;
  const currentValue = input.currentPrice * sharesOwned;
  const unrealizedPnL = currentValue - totalCost;
  const unrealizedPnLPercent = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;
  const priceGapToAveragePercent =
    input.currentPrice > 0 ? (input.averageCost / input.currentPrice - 1) * 100 : 0;

  const currentPosition: PositionRecyclingCurrentPosition = {
    sharesOwned,
    averageCost: round2(input.averageCost),
    currentPrice: round2(input.currentPrice),
    totalCost: round2(totalCost),
    currentValue: round2(currentValue),
    unrealizedPnL: round2(unrealizedPnL),
    unrealizedPnLPercent: round2(unrealizedPnLPercent),
    priceGapToAveragePercent: round2(priceGapToAveragePercent),
  };

  const marketContext = buildMarketContext(input);
  const warnings: string[] = [...marketContext.notes];
  const optionsNotes: string[] = [];

  if (input.stockQualityStatus === 'Broken' || input.convictionGrade === 'D') {
    return buildNoPlan(
      input,
      currentPosition,
      'Do not average down / review exit plan — recycling is disabled for Broken quality or D conviction.',
    );
  }

  const splitPercents = getGradeSplit(input.convictionGrade, input.stockQualityStatus);
  if (!splitPercents) {
    return buildNoPlan(input, currentPosition, 'Do not average down / review exit plan.');
  }

  const maxRecyclePercent =
    input.maxSharesAllowedToRecyclePercent ?? DEFAULT_MAX_RECYCLE_PERCENT[input.convictionGrade];

  const coreShares = Math.floor((sharesOwned * splitPercents.corePercent) / 100);
  const recyclingShares = sharesOwned - coreShares;
  let maxRecycleShares = Math.min(
    recyclingShares,
    Math.floor((sharesOwned * maxRecyclePercent) / 100),
    sharesOwned - coreShares,
  );

  if (maxRecycleShares <= 0 || recyclingShares <= 0 || coreShares < 1) {
    return buildNoPlan(
      input,
      currentPosition,
      'Position too small or grade limits prevent recycling — hold core only.',
      'blocked',
    );
  }

  const deepUnderwater = priceGapToAveragePercent > 25;
  if (deepUnderwater) {
    warnings.push(
      `Price is ${priceGapToAveragePercent.toFixed(1)}% below average — high-risk; recycle pool reduced 25%.`,
    );
    maxRecycleShares = Math.max(1, Math.floor(maxRecycleShares * 0.75));
  }

  if (marketContext.near52WeekLow) {
    maxRecycleShares = Math.max(1, Math.floor(maxRecycleShares * 0.8));
  }

  let [t1Shares, t2Shares, t3Shares] = allocateTrancheShares(maxRecycleShares);

  const belowAverage = input.currentPrice < input.averageCost;
  const nearAverage = !belowAverage && isNearAverage(input.currentPrice, input.averageCost);
  let sellPrices = buildSellPrices(input.currentPrice, input.averageCost, belowAverage, nearAverage);
  sellPrices = applySellGuards(
    sellPrices,
    input.averageCost,
    input.avoidSellingBelowAverage ?? false,
    input.allowSellNearLoss ?? true,
  );
  sellPrices = capSellPricesToResistance(sellPrices, input.resistancePrice, input.currentPrice);

  const rebuyDiscountPercent = resolveRebuyDiscountPercent(input, priceGapToAveragePercent);
  const trancheShares = [t1Shares, t2Shares, t3Shares];

  const sellPlan: SellTranchePlan[] = [];
  const rebuyPlan: RebuyTranchePlan[] = [];
  const recyclingLadder: RecyclingLadderStep[] = [];
  const projectedResults: ProjectedRecyclingCycle[] = [];

  let runningShares = sharesOwned;
  let cumulativeRebought = 0;
  const fixedTotalCost = totalCost;
  const allowSellNearLoss = input.allowSellNearLoss ?? true;

  for (let i = 0; i < 3; i++) {
    const trancheIndex = (i + 1) as 1 | 2 | 3;
    const sharesToSell = trancheShares[i];
    if (sharesToSell <= 0) continue;

    let sellPrice = sellPrices[i];
    if (!allowSellNearLoss && sellPrice < input.averageCost) {
      warnings.push(`Tranche ${trancheIndex} skipped — sell near/below average blocked (allowSellNearLoss=false).`);
      continue;
    }

    const remainingAfterSell = runningShares - sharesToSell;
    if (remainingAfterSell < coreShares) {
      warnings.push(`Tranche ${trancheIndex} skipped — would leave ${remainingAfterSell} shares, below ${coreShares} core.`);
      continue;
    }

    let rebuyPrice = round2(sellPrice * (1 - rebuyDiscountPercent / 100));
    if (input.supportPrice != null && input.supportPrice > 0 && rebuyPrice > input.supportPrice) {
      warnings.push(
        `Tranche ${trancheIndex}: rebuy $${rebuyPrice.toFixed(2)} is above support $${input.supportPrice.toFixed(2)} — may need deeper pullback.`,
      );
    }

    const effectiveDiscount = sellPrice > 0 ? ((sellPrice - rebuyPrice) / sellPrice) * 100 : 0;
    const rebuyRecommended = effectiveDiscount >= 8 && rebuyPrice > 0;

    const cashFromSale = sharesToSell * sellPrice;
    const sharesToRebuy = rebuyRecommended ? Math.floor(cashFromSale / rebuyPrice) : 0;
    const leftoverCash = round2(cashFromSale - sharesToRebuy * rebuyPrice);

    sellPlan.push({
      trancheIndex,
      sharesToSell,
      sellPrice,
      percentOfRecyclingPool: TRANCHE_WEIGHTS[i] * 100,
      triggerDescription: `Limit sell ≥ $${sellPrice.toFixed(2)}`,
      notes: marketContext.sellCeilingFromResistance != null ? 'Capped by resistance' : undefined,
    });

    rebuyPlan.push({
      trancheIndex,
      linkedSellTranche: trancheIndex,
      sellPrice,
      rebuyPrice,
      rebuyDiscountPercent: round2(effectiveDiscount),
      cashFromSale: round2(cashFromSale),
      sharesToRebuy,
      rebuyRecommended,
      triggerDescription: rebuyRecommended
        ? `Rebuy ≤ $${rebuyPrice.toFixed(2)} (${round2(effectiveDiscount)}% below sell)`
        : 'Rebuy not recommended — discount under 8%',
      leftoverCash,
    });

    runningShares = remainingAfterSell + sharesToRebuy;
    cumulativeRebought += sharesToRebuy;
    const newEconomicBreakEven = runningShares > 0 ? round2(fixedTotalCost / runningShares) : input.averageCost;
    const breakEvenImprovement = round2(input.averageCost - newEconomicBreakEven);

    const cycle: ProjectedRecyclingCycle = {
      trancheIndex,
      sharesSoldThisTranche: sharesToSell,
      sharesAfterSell: remainingAfterSell,
      sharesAfterRebuy: runningShares,
      newEconomicBreakEven,
      breakEvenImprovement,
      cumulativeSharesRebought: cumulativeRebought,
      netShareChangeVsStart: runningShares - sharesOwned,
    };
    projectedResults.push(cycle);

    recyclingLadder.push({
      trancheIndex,
      sharesToSell,
      sellPrice,
      rebuyPrice,
      rebuyDiscountPercent: round2(effectiveDiscount),
      sharesToRebuy,
      sharesAfterSell: remainingAfterSell,
      sharesAfterRebuy: runningShares,
      newEconomicBreakEven,
      breakEvenImprovement,
      cumulativeSharesRebought: cumulativeRebought,
      cashRecycled: round2(cashFromSale),
      rebuyRecommended,
    });

    if (breakEvenImprovement < MIN_MEANINGFUL_BREAK_EVEN_IMPROVEMENT && sharesToRebuy > 0) {
      warnings.push(
        `Tranche ${trancheIndex}: break-even improvement $${breakEvenImprovement.toFixed(2)}/sh may not cover fees/slippage.`,
      );
    }
  }

  const totalSharesSold = sellPlan.reduce((s, t) => s + t.sharesToSell, 0);
  const minSharesRemainingAfterAllSells = sharesOwned - totalSharesSold;

  if (totalSharesSold >= sharesOwned) {
    warnings.push('Safety block: ladder would sell entire position — plan invalid.');
  }

  const positionSplit: PositionRecyclingSplit = {
    coreShares,
    recyclingShares,
    maxRecycleShares,
    corePercent: splitPercents.corePercent,
    recyclePercent: splitPercents.recyclePercent,
    minSharesRemainingAfterAllSells,
  };

  const lastCycle = projectedResults[projectedResults.length - 1];
  const projectedOutcome: ProjectedRecyclingOutcome | null = lastCycle
    ? {
        startingShares: sharesOwned,
        finalSharesIfAllTranchesComplete: lastCycle.sharesAfterRebuy,
        finalBreakEvenIfAllTranchesComplete: lastCycle.newEconomicBreakEven,
        totalBreakEvenImprovementPerShare: lastCycle.breakEvenImprovement,
        totalSharesSold,
        totalSharesRebought: cumulativeRebought,
        netShareChange: lastCycle.sharesAfterRebuy - sharesOwned,
        meaningfulImprovement: lastCycle.breakEvenImprovement >= MIN_MEANINGFUL_BREAK_EVEN_IMPROVEMENT,
      }
    : null;

  if (projectedOutcome && !projectedOutcome.meaningfulImprovement) {
    warnings.push('Full-cycle break-even improvement is small — confirm spreads/fees before executing.');
  }

  if (input.allowOptions && input.hasMinimum100Shares) {
    optionsNotes.push('Covered calls allowed on core shares only — no naked options, no margin.');
  } else if (input.allowOptions) {
    optionsNotes.push('Options: need ≥100 shares for standard covered-call sizing.');
  }
  warnings.push('No margin, no new cash deposits — recycle sale proceeds only.');

  const readiness = buildReadiness(input, currentPosition, positionSplit, sellPlan.length);
  const actionMessage = buildActionMessage({
    ticker: input.ticker,
    coreShares,
    sellPlan,
    rebuyPlan,
    minDiscount: rebuyDiscountPercent,
    projectedOutcome,
  });

  const improve = projectedOutcome?.totalBreakEvenImprovementPerShare.toFixed(2) ?? '0';
  const summary =
    sellPlan.length > 0
      ? `${input.ticker}: ${coreShares} core + ${maxRecycleShares} recycle shares; ` +
        `${sellPlan.length} tranches; max break-even improvement ≈ $${improve}/sh.`
      : `${input.ticker}: recycling blocked — see warnings.`;

  return {
    ticker: input.ticker,
    companyName: input.companyName,
    summary,
    planStatus: sellPlan.length > 0 ? 'active' : 'blocked',
    planAvailable: sellPlan.length > 0,
    currentPosition,
    positionSplit,
    marketContext,
    readiness,
    sellPlan,
    rebuyPlan,
    recyclingLadder,
    projectedResults,
    projectedOutcome,
    warnings,
    optionsNotes,
    actionMessage,
  };
}
