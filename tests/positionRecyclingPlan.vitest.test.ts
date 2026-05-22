import { describe, expect, it } from 'vitest';
import {
  generatePositionRecyclingPlan,
  type PositionRecyclingInput,
} from '../services/positionRecyclingPlan';
import {
  buildPositionRecyclingInputFromHolding,
  recyclingPlanToOrderDrafts,
} from '../services/positionRecyclingIntegration';
import type { Holding } from '../types';

const INSP_BASE: PositionRecyclingInput = {
  ticker: 'INSP',
  companyName: 'Inspire Medical Systems',
  currentPrice: 44.74,
  averageCost: 51.61,
  sharesOwned: 80,
  convictionGrade: 'B',
  stockQualityStatus: 'Medium',
  minRebuyDiscountPercent: 10,
  allowOptions: false,
  hasMinimum100Shares: false,
};

describe('generatePositionRecyclingPlan', () => {
  it('returns no plan for Broken quality or D grade', () => {
    const broken = generatePositionRecyclingPlan({
      ...INSP_BASE,
      stockQualityStatus: 'Broken',
    });
    expect(broken.planAvailable).toBe(false);
    expect(broken.planStatus).toBe('exit_review');

    const gradeD = generatePositionRecyclingPlan({
      ...INSP_BASE,
      convictionGrade: 'D',
    });
    expect(gradeD.planAvailable).toBe(false);
  });

  it('INSP B-grade: core 40, recycle 40, sell ladder and break-even path', () => {
    const plan = generatePositionRecyclingPlan(INSP_BASE);

    expect(plan.planAvailable).toBe(true);
    expect(plan.planStatus).toBe('active');
    expect(plan.positionSplit).toMatchObject({
      coreShares: 40,
      recyclingShares: 40,
      maxRecycleShares: 40,
      minSharesRemainingAfterAllSells: 40,
    });

    expect(plan.sellPlan).toHaveLength(3);
    expect(plan.rebuyPlan).toHaveLength(3);
    expect(plan.recyclingLadder).toHaveLength(3);

    const sells = plan.sellPlan;
    expect(sells[0].sharesToSell).toBe(10);
    expect(sells[1].sharesToSell).toBe(14);
    expect(sells[2].sharesToSell).toBe(16);

    expect(sells[0].sellPrice).toBeGreaterThan(46.5);
    expect(sells[0].sellPrice).toBeLessThan(47.5);
    expect(sells[1].sellPrice).toBeGreaterThan(48.5);
    expect(sells[1].sellPrice).toBeLessThan(50);
    expect(sells[2].sellPrice).toBeCloseTo(51.61, 2);

    for (const row of plan.recyclingLadder) {
      expect(row.sharesAfterSell).toBeGreaterThanOrEqual(40);
      expect(row.rebuyRecommended).toBe(true);
      expect(row.rebuyDiscountPercent).toBeGreaterThanOrEqual(8);
    }

    expect(plan.projectedOutcome?.meaningfulImprovement).toBe(true);
    expect(plan.projectedOutcome?.finalSharesIfAllTranchesComplete).toBeGreaterThan(80);
    expect(plan.readiness?.score).toBeGreaterThanOrEqual(80);
    expect(plan.actionMessage).toMatch(/Keep 40 shares as core/i);
  });

  it('uses resistance cap on sell prices', () => {
    const plan = generatePositionRecyclingPlan({
      ...INSP_BASE,
      resistancePrice: 48,
      fiftyTwoWeekHigh: 55,
      fiftyTwoWeekLow: 40,
    });
    expect(plan.marketContext?.sellCeilingFromResistance).toBe(48);
    for (const s of plan.sellPlan) {
      expect(s.sellPrice).toBeLessThanOrEqual(48);
    }
  });

  it('reduces recycle pool when >25% below average', () => {
    const plan = generatePositionRecyclingPlan({
      ...INSP_BASE,
      currentPrice: 38,
      averageCost: 51.61,
    });
    expect(plan.warnings.some((w) => w.includes('25%'))).toBe(true);
    const totalSell = plan.sellPlan.reduce((s, t) => s + t.sharesToSell, 0);
    expect(totalSell).toBeLessThan(40);
  });

  it('never recommends selling entire position', () => {
    const plan = generatePositionRecyclingPlan({
      ...INSP_BASE,
      sharesOwned: 30,
      convictionGrade: 'B',
    });
    const totalSell = plan.sellPlan.reduce((s, t) => s + t.sharesToSell, 0);
    expect(totalSell).toBeLessThan(30);
    expect(plan.positionSplit!.minSharesRemainingAfterAllSells).toBeGreaterThanOrEqual(plan.positionSplit!.coreShares);
  });

  it('maps to recovery order drafts (sell + rebuy per tranche)', () => {
    const plan = generatePositionRecyclingPlan(INSP_BASE);
    const drafts = recyclingPlanToOrderDrafts(plan);
    expect(drafts.length).toBeGreaterThanOrEqual(4);
    expect(drafts.filter((d) => d.type === 'SELL').length).toBe(3);
    expect(drafts.some((d) => d.label?.includes('Recycle sell'))).toBe(true);
  });
});

describe('buildPositionRecyclingInputFromHolding', () => {
  it('builds input from holding row', () => {
    const h: Holding = {
      id: '1',
      symbol: 'INSP',
      name: 'Inspire',
      quantity: 80,
      avgCost: 51.61,
      currentValue: 3579,
      zakahClass: 'Non-Zakatable',
      realizedPnL: 0,
    };
    const input = buildPositionRecyclingInputFromHolding(h, 44.74, {
      symbol: 'INSP',
      recoveryEnabled: true,
      lossTriggerPct: 15,
      cashCap: 5000,
      sleeveType: 'Core',
      riskTier: 'Med',
    });
    expect(input.ticker).toBe('INSP');
    expect(input.convictionGrade).toBe('B');
    expect(input.sharesOwned).toBe(80);
  });
});
