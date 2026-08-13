import { describe, expect, it } from 'vitest';
import type { RecoveryPlanResult, RecoveryPositionConfig } from '../types';
import type { RecyclingPlanSummary } from '../services/positionRecyclingIntegration';
import {
  allocateRecoveryBudget,
  computeRecoveryInvestorMetrics,
  decideRecoveryAction,
  rankRecoveryDecisions,
} from '../services/recoveryDecisionEngine';

const emptyExit = {
  applyTarget1: false,
  target1Pct: 0,
  applyTarget2: false,
  target2Pct: 0,
  applyTrailing: false,
  trailPct: 0,
};

function makePlan(over: Partial<RecoveryPlanResult> = {}): RecoveryPlanResult {
  return {
    symbol: 'CORE',
    state: 'QUALIFIED',
    qualified: true,
    costBasis: 10000,
    marketValue: 7000,
    plUsd: -3000,
    plPct: -30,
    currentPrice: 70,
    shares: 100,
    avgCost: 100,
    ladder: [{ level: 1, qty: 20, price: 63, cost: 1260 }],
    totalPlannedCost: 1260,
    newShares: 120,
    newAvgCost: 93.83,
    exitPlan: emptyExit,
    budgetImpact: 1260,
    capCheckOk: true,
    ...over,
  };
}

function cfg(over: Partial<RecoveryPositionConfig> = {}): RecoveryPositionConfig {
  return {
    symbol: 'CORE',
    recoveryEnabled: true,
    lossTriggerPct: 15,
    cashCap: 5000,
    sleeveType: 'Core',
    riskTier: 'Low',
    maxAddShares: 40,
    maxAddCost: 2000,
    ...over,
  };
}

function recycling(available = true, status: RecyclingPlanSummary['planStatus'] = 'active'): RecyclingPlanSummary {
  return {
    symbol: 'CORE',
    planAvailable: available,
    planStatus: status,
    coreShares: 70,
    maxRecycleShares: 30,
    trancheCount: available ? 2 : 0,
    finalBreakEven: 90,
    breakEvenImprovement: 10,
  };
}

describe('computeRecoveryInvestorMetrics', () => {
  it('computes rebound-to-breakeven vs holding without an add', () => {
    const m = computeRecoveryInvestorMetrics(
      makePlan({ currentPrice: 70, avgCost: 100, newAvgCost: 90, totalPlannedCost: 2000 }),
    );
    expect(m.reboundToOldBreakevenPct).toBeCloseTo(((100 - 70) / 70) * 100, 5);
    expect(m.reboundToNewBreakevenPct).toBeCloseTo(((90 - 70) / 70) * 100, 5);
    expect(m.reboundReductionPct).toBeCloseTo(m.reboundToOldBreakevenPct - m.reboundToNewBreakevenPct, 5);
    expect(m.avgImprovementPct).toBeCloseTo(10, 5);
    expect(m.extraLossIfDown10).toBeCloseTo(200, 5);
    expect(m.firstBuyPrice).toBe(63);
    expect(m.firstBuyDiscountPct).toBeCloseTo(((70 - 63) / 70) * 100, 5);
  });
});

describe('decideRecoveryAction', () => {
  it('ranks Core A ladder above Spec freeze', () => {
    const core = decideRecoveryAction({
      holdingId: 'h-core',
      symbol: 'CORE',
      plan: makePlan({ symbol: 'CORE', plPct: -22 }),
      positionConfig: cfg({ sleeveType: 'Core' }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'A', stockQualityStatus: 'Strong' },
    });
    const spec = decideRecoveryAction({
      holdingId: 'h-spec',
      symbol: 'SPEC',
      plan: makePlan({ symbol: 'SPEC', plPct: -40, qualified: true }),
      positionConfig: cfg({ symbol: 'SPEC', sleeveType: 'Spec', recoveryEnabled: false }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'C', stockQualityStatus: 'Medium' },
    });
    expect(core.action).toBe('add_ladder');
    expect(spec.action).toBe('do_not_add');
    expect(core.priority).toBeGreaterThan(spec.priority);
  });

  it('sends broken quality to review_exit instead of adding cash', () => {
    const d = decideRecoveryAction({
      holdingId: 'h-brk',
      symbol: 'BRK',
      plan: makePlan({ symbol: 'BRK', qualified: true }),
      positionConfig: cfg(),
      recyclingSummary: recycling(true),
      conviction: { convictionGrade: 'B', stockQualityStatus: 'Broken' },
    });
    expect(d.action).toBe('review_exit');
    expect(d.suggestedPath).toBe('recycling');
  });

  it('waits on a stale quote when recycling is not available', () => {
    const d = decideRecoveryAction({
      holdingId: 'h-stale',
      symbol: 'STALE',
      plan: makePlan({ symbol: 'STALE' }),
      positionConfig: cfg(),
      recyclingSummary: null,
      conviction: { convictionGrade: 'A', stockQualityStatus: 'Strong' },
      quoteStale: true,
    });
    expect(d.action).toBe('wait');
    expect(d.confidence).toBe('low');
  });

  it('prefers recycle on a deep loss when a winner sale is ready', () => {
    const d = decideRecoveryAction({
      holdingId: 'h-deep',
      symbol: 'DEEP',
      plan: makePlan({ symbol: 'DEEP', plPct: -32, qualified: true }),
      positionConfig: cfg({ sleeveType: 'Upside' }),
      recyclingSummary: recycling(true),
      conviction: { convictionGrade: 'C', stockQualityStatus: 'Medium' },
    });
    expect(d.action).toBe('recycle');
    expect(d.suggestedPath).toBe('recycling');
  });
});

describe('allocateRecoveryBudget / rankRecoveryDecisions', () => {
  it('only funds the first add_ladder when the recovery budget cannot cover both', () => {
    const a = decideRecoveryAction({
      holdingId: 'h-a',
      symbol: 'AAA',
      plan: makePlan({ symbol: 'AAA', totalPlannedCost: 800, plPct: -22 }),
      positionConfig: cfg({ sleeveType: 'Core' }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'A', stockQualityStatus: 'Strong' },
    });
    const b = decideRecoveryAction({
      holdingId: 'h-b',
      symbol: 'BBB',
      plan: makePlan({
        symbol: 'BBB',
        totalPlannedCost: 800,
        plPct: -18,
        ladder: [
          { level: 1, qty: 1, price: 90, cost: 90 },
          { level: 2, qty: 8, price: 80, cost: 640 },
        ],
      }),
      positionConfig: cfg({ sleeveType: 'Upside' }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'B', stockQualityStatus: 'Medium' },
    });
    expect(a.action).toBe('add_ladder');
    expect(b.action).toBe('add_ladder');
    const out = allocateRecoveryBudget({
      decisions: [a, b],
      recoveryBudgetSar: 900,
      cashToSar: (_id, cash) => cash,
    });
    const funded = out.filter((d) => d.action === 'add_ladder');
    expect(funded.length).toBe(2);
    expect(funded[0].symbol).toBe('AAA');
    // Remaining budget (~100) funds BBB's first rung (90) even when the full ladder (800) does not fit.
    const bbb = out.find((d) => d.symbol === 'BBB')!;
    expect(bbb.action).toBe('add_ladder');
    expect(bbb.metrics.cashToDeploy).toBeCloseTo(90, 5);
    expect(bbb.metrics.fundedLadderLevels).toBe(1);
    expect(bbb.metrics.budgetDeferred).toBe(false);
    // First-rung break-even must recompute (not keep the full-ladder newAvg).
    expect(bbb.metrics.breakEvenAfter).toBeCloseTo((100 * 100 + 90) / 101, 5);
  });

  it('defers to wait when even the first rung exceeds remaining budget', () => {
    const a = decideRecoveryAction({
      holdingId: 'h-a',
      symbol: 'AAA',
      plan: makePlan({ symbol: 'AAA', totalPlannedCost: 800, plPct: -22 }),
      positionConfig: cfg({ sleeveType: 'Core' }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'A', stockQualityStatus: 'Strong' },
    });
    const b = decideRecoveryAction({
      holdingId: 'h-b',
      symbol: 'BBB',
      plan: makePlan({ symbol: 'BBB', totalPlannedCost: 800, plPct: -18 }),
      positionConfig: cfg({ sleeveType: 'Upside' }),
      recyclingSummary: null,
      conviction: { convictionGrade: 'B', stockQualityStatus: 'Medium' },
    });
    const out = allocateRecoveryBudget({
      decisions: [a, b],
      recoveryBudgetSar: 850,
      cashToSar: (_id, cash) => cash,
    });
    const deferred = out.filter((d) => d.metrics.budgetDeferred);
    expect(deferred).toHaveLength(1);
    expect(deferred[0].symbol).toBe('BBB');
    expect(deferred[0].action).toBe('wait');
  });

  it('ranks Core A above Spec across a shared SAR budget', () => {
    const ranked = rankRecoveryDecisions(
      [
        {
          holdingId: 'h-spec',
          symbol: 'SPEC',
          plan: makePlan({ symbol: 'SPEC', plPct: -40, totalPlannedCost: 500 }),
          positionConfig: cfg({ symbol: 'SPEC', sleeveType: 'Spec', recoveryEnabled: false }),
          recyclingSummary: null,
          conviction: { convictionGrade: 'C', stockQualityStatus: 'Medium' },
          bookCurrency: 'SAR',
        },
        {
          holdingId: 'h-core',
          symbol: 'CORE',
          plan: makePlan({ symbol: 'CORE', plPct: -20, totalPlannedCost: 500 }),
          positionConfig: cfg({ sleeveType: 'Core' }),
          recyclingSummary: null,
          conviction: { convictionGrade: 'A', stockQualityStatus: 'Strong' },
          bookCurrency: 'SAR',
        },
      ],
      { recoveryBudgetSar: 2000, sarPerUsd: 3.75 },
    );
    expect(ranked[0].symbol).toBe('CORE');
    expect(ranked[0].action).toBe('add_ladder');
    expect(ranked[1].action).toBe('do_not_add');
  });
});
