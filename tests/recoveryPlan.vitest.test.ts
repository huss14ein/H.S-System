import { describe, expect, it } from 'vitest';
import {
  allocateLadderQty,
  allocateQtyForLadderPrice,
  buildRecoveryPlan,
  DEFAULT_RECOVERY_GLOBAL_CONFIG,
} from '../services/recoveryPlan';
import {
  buildRecoveryGlobalConfig,
  deriveRecoveryPositionConfig,
  withRecoveryAddBounds,
} from '../services/recoveryPositionSetup';
import type { Holding } from '../types';

describe('allocateQtyForLadderPrice', () => {
  it('uses whole shares when the slice can buy at least one', () => {
    expect(allocateQtyForLadderPrice(800, 65)).toBe(12);
  });

  it('uses a fractional slice for expensive names instead of qty 0', () => {
    expect(allocateQtyForLadderPrice(200, 500)).toBeCloseTo(0.4, 6);
  });

  it('returns 0 when budget cannot buy a 0.01 slice', () => {
    expect(allocateQtyForLadderPrice(0.001, 500)).toBe(0);
  });
});

describe('allocateLadderQty', () => {
  it('does not emit empty 0-share rows as the only outcome for a usable budget', () => {
    const levels = allocateLadderQty(1500, [600, 550, 500], [0.4, 0.35, 0.25]);
    expect(levels.some((l) => l.qty > 0)).toBe(true);
    expect(levels.reduce((s, l) => s + l.cost, 0)).toBeLessThanOrEqual(1500 + 1e-6);
  });
});

describe('buildRecoveryPlan practical eligibility', () => {
  const holding: Holding = {
    id: 'h1',
    symbol: 'UNH',
    quantity: 4,
    avgCost: 700,
    currentValue: 1600,
    zakahClass: 'Zakatable',
  };

  it('does not qualify a zero-share ladder', () => {
    const plan = buildRecoveryPlan(
      holding,
      500,
      {
        symbol: 'UNH',
        recoveryEnabled: true,
        lossTriggerPct: 10,
        cashCap: 1,
        sleeveType: 'Core',
        riskTier: 'Low',
        maxAddCost: 1,
      },
      { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 10000, minDeployableThreshold: 50 },
    );
    expect(plan.ladder.every((l) => l.qty > 0) || plan.ladder.length === 0).toBe(true);
    expect(plan.qualified).toBe(false);
    expect(plan.reason).toMatch(/too small/i);
  });

  it('qualifies a fractional add when cash can only buy part of an expensive share', () => {
    const plan = buildRecoveryPlan(
      holding,
      400,
      {
        symbol: 'UNH',
        recoveryEnabled: true,
        lossTriggerPct: 10,
        cashCap: 250,
        sleeveType: 'Core',
        riskTier: 'Low',
        maxAddCost: 250,
      },
      { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 2000, recoveryBudgetPct: 0.2, minDeployableThreshold: 50 },
    );
    expect(plan.qualified).toBe(true);
    expect(plan.totalPlannedCost).toBeGreaterThan(0);
    expect(plan.ladder.some((l) => l.qty > 0 && l.qty < 1)).toBe(true);
  });
});

describe('recoveryPositionSetup', () => {
  it('never sets a ticker cash cap above deployable cash', () => {
    const cfg = deriveRecoveryPositionConfig({
      symbol: 'RETIRE1',
      sleeveType: 'Core',
      riskTier: 'Med',
      deployableCash: 200,
      plPct: -25,
      recoveryBudgetPct: 0.18,
    });
    expect(cfg.cashCap).toBeLessThanOrEqual(200);
    expect(cfg.cashCap).toBeLessThan(1200);
  });

  it('lowers the min cash floor when the book has little cash', () => {
    const g = buildRecoveryGlobalConfig(180);
    expect(g.minDeployableThreshold).toBeLessThanOrEqual(180);
    expect(g.deployableCash).toBe(180);
  });

  it('does not force a +1 share add on a zero-qty row', () => {
    const bounded = withRecoveryAddBounds(
      {
        symbol: 'X',
        recoveryEnabled: true,
        lossTriggerPct: 12,
        cashCap: 500,
        sleeveType: 'Core',
        riskTier: 'Low',
      },
      { quantity: 0, marketValue: 0, deployableCash: 5000, recoveryBudgetPct: 0.2 },
    );
    expect(bounded.maxAddShares).toBe(0);
  });
});
