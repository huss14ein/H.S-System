import { describe, expect, it } from 'vitest';
import {
  buildRecyclingPathBrief,
  buildRecoveryLadderPathBrief,
  suggestDefaultRecoveryPathMode,
} from '../services/recoveryPathSummaries';
import { buildUnifiedRecoveryPlan } from '../services/unifiedRecoveryPlan';
import { DEFAULT_RECOVERY_GLOBAL_CONFIG } from '../services/recoveryPlan';
import type { Holding } from '../types';

describe('recoveryPathSummaries', () => {
  it('suggests recycling when only recycling is ready', () => {
    expect(
      suggestDefaultRecoveryPathMode({ recyclingReady: true, ladderReady: false, plPct: -30 }),
    ).toBe('recycling');
  });

  it('builds plain-language ladder brief when qualified', () => {
    const brief = buildRecoveryLadderPathBrief({
      plPct: -22,
      lossTriggerPct: 15,
      deployableCash: 5000,
      bookCurrency: 'SAR',
      ladder: {
        qualified: true,
        plPct: -22,
        currentPrice: 80,
        newAvgCost: 95,
        newShares: 120,
        totalPlannedCost: 2000,
        ladder: [{ level: 1, qty: 10, price: 75, cost: 750 }],
        state: 'ACTIVE',
      } as any,
    });
    expect(brief.readiness).toBe('ready');
    expect(brief.headline).toContain('Staged buys');
    expect(brief.bullets.length).toBeGreaterThan(0);
  });
});

describe('unifiedRecoveryPlan path mode', () => {
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

  it('filters drafts to recycling only when userPathMode is recycling', () => {
    const plan = buildUnifiedRecoveryPlan({
      holding,
      currentPrice: 70,
      positionConfig,
      globalConfig: { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 10000 },
      data: {
        portfolioUniverse: [{ ticker: 'INSP', status: 'High-Upside' }],
        watchlist: [{ symbol: 'INSP', name: 'Inspire' }],
      } as any,
      userPathMode: 'recycling',
    });

    expect(plan.activePathMode).toBe('recycling');
    expect(plan.strategy).toBe('recycling_only');
    expect(plan.allDrafts.every((d) => d.trancheKind === 'recycle_sell' || d.trancheKind === 'recycle_rebuy')).toBe(
      true,
    );
    expect(plan.cashLadderActive).toBeNull();
  });

  it('filters drafts to ladder only when userPathMode is recovery_ladder', () => {
    const plan = buildUnifiedRecoveryPlan({
      holding,
      currentPrice: 70,
      positionConfig,
      globalConfig: { ...DEFAULT_RECOVERY_GLOBAL_CONFIG, deployableCash: 10000 },
      data: {
        portfolioUniverse: [{ ticker: 'INSP', status: 'High-Upside' }],
        watchlist: [{ symbol: 'INSP', name: 'Inspire' }],
      } as any,
      userPathMode: 'recovery_ladder',
    });

    expect(plan.activePathMode).toBe('recovery_ladder');
    expect(plan.strategy).toBe('cash_ladder_only');
    expect(plan.allDrafts.every((d) => d.trancheKind === 'ladder_buy')).toBe(true);
    expect(plan.recyclingActive).toBeNull();
  });
});
