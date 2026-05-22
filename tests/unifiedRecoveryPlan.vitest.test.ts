import { describe, expect, it } from 'vitest';
import type { FinancialData, Holding, PlannedTrade } from '../types';
import { convictionGradeFromWatchlistBlend, resolveSyncedRecoveryConviction } from '../services/recoveryConvictionSync';
import {
  buildTrancheExecutionStates,
  parseTrancheFromLabel,
} from '../services/recoveryExecutionTracker';
import { buildUnifiedRecoveryPlan } from '../services/unifiedRecoveryPlan';
import { buildRecoveryPlanAfterFilledLevels, DEFAULT_RECOVERY_GLOBAL_CONFIG } from '../services/recoveryPlan';

describe('recoveryConvictionSync', () => {
  it('maps high watchlist blend to grade A', () => {
    expect(convictionGradeFromWatchlistBlend(80)).toBe('A');
    expect(convictionGradeFromWatchlistBlend(50)).toBe('C');
  });

  it('blends universe Core with watchlist', () => {
    const r = resolveSyncedRecoveryConviction({
      symbol: 'INSP',
      plPct: -30,
      riskTier: 'Med',
      universe: [{ ticker: 'INSP', status: 'Core' }],
      watchlistItems: [{ symbol: 'INSP', userScore: 70, signalScore: 65 }],
    });
    expect(r.convictionGrade).toBe('A');
    expect(r.sources.some((s) => s.includes('Universe'))).toBe(true);
  });
});

describe('recoveryExecutionTracker', () => {
  it('parses recycle and ladder labels', () => {
    expect(parseTrancheFromLabel('Recycle sell T1')?.kind).toBe('recycle_sell');
    expect(parseTrancheFromLabel('Recovery L2')?.index).toBe(2);
  });

  it('marks executed planned trades as filled', () => {
    const drafts = [
      {
        type: 'BUY' as const,
        symbol: 'INSP',
        qty: 10,
        limitPrice: 100,
        orderType: 'LIMIT' as const,
        label: 'Recovery L1',
        trancheKind: 'ladder_buy' as const,
        trancheIndex: 1 as const,
      },
    ];
    const trades: PlannedTrade[] = [
      {
        id: 'p1',
        symbol: 'INSP',
        name: 'Inspire',
        tradeType: 'buy',
        conditionType: 'price',
        targetValue: 100,
        quantity: 10,
        priority: 'High',
        status: 'Executed',
        notes: 'Recovery engine: Recovery L1.',
      },
    ];
    const states = buildTrancheExecutionStates('INSP', drafts, trades);
    expect(states[0]?.status).toBe('filled');
  });
});

describe('unifiedRecoveryPlan', () => {
  const holding: Holding = {
    id: 'h1',
    symbol: 'INSP',
    name: 'Inspire',
    quantity: 200,
    avgCost: 200,
    currentValue: 14000,
  };

  const positionConfig = {
    symbol: 'INSP',
    recoveryEnabled: true,
    lossTriggerPct: 15,
    cashCap: 5000,
    sleeveType: 'Upside' as const,
    riskTier: 'Med' as const,
    maxAddShares: 50,
    maxAddCost: 3000,
  };

  it('merges recycling and cash ladder strategies for underwater positions', () => {
    const data = {
      portfolioUniverse: [{ ticker: 'INSP', status: 'High-Upside' }],
      watchlist: [{ symbol: 'INSP', name: 'Inspire' }],
    } as unknown as FinancialData;

    const plan = buildUnifiedRecoveryPlan({
      holding,
      currentPrice: 70,
      positionConfig,
      globalConfig: { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 10000 },
      data,
    });

    expect(plan.symbol).toBe('INSP');
    expect(plan.recycling?.planAvailable || plan.cashLadder?.qualified).toBe(true);
    expect(plan.allDrafts.length).toBeGreaterThan(0);
    expect(plan.conviction.sources.length).toBeGreaterThan(0);
  });
});

describe('buildRecoveryPlanAfterFilledLevels', () => {
  it('skips filled ladder levels', () => {
    const holding: Holding = {
      id: 'h2',
      symbol: 'X',
      quantity: 100,
      avgCost: 50,
    };
    const positionConfig = {
      symbol: 'X',
      recoveryEnabled: true,
      lossTriggerPct: 10,
      cashCap: 2000,
      sleeveType: 'Core' as const,
      riskTier: 'Low' as const,
    };
    const full = buildRecoveryPlanAfterFilledLevels(
      holding,
      40,
      positionConfig,
      { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 5000 },
      new Set(),
    );
    const partial = buildRecoveryPlanAfterFilledLevels(
      holding,
      40,
      positionConfig,
      { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 5000 },
      new Set([1]),
    );
    expect(partial.state).toBe('PARTIAL_FILL');
    expect(partial.ladder.length).toBeLessThanOrEqual(full.ladder.length);
    expect(partial.ladder.every((l) => l.level !== 1)).toBe(true);
  });
});
