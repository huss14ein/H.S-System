import { describe, expect, it } from 'vitest';
import { buildTranchePlansFromParent, recomputeTrancheAfterFill } from '../services/plannedTradeTranches';
import type { PlannedTrade } from '../types';

describe('plannedTradeTranches', () => {
  it('splits quantity across tranches', () => {
    const parent = {
      symbol: 'AAPL',
      name: 'Apple',
      tradeType: 'buy' as const,
      conditionType: 'price' as const,
      targetValue: 100,
      quantity: 30,
      priority: 'Medium' as const,
      status: 'Planned' as const,
    };
    const batch = buildTranchePlansFromParent(parent, 3);
    expect(batch).toHaveLength(3);
    expect(batch[0].trancheIndex).toBe(1);
    expect(batch[2].trancheIndex).toBe(3);
    expect(batch[0].trancheGroupId).toBe(batch[1].trancheGroupId);
    expect(batch.reduce((s, t) => s + (t.quantity ?? 0), 0)).toBeCloseTo(30, 5);
  });

  it('recomputes next tranche after fill', () => {
    const g = 'g1';
    const trades: PlannedTrade[] = [
      { id: '1', symbol: 'X', name: 'X', tradeType: 'buy', conditionType: 'price', targetValue: 1, priority: 'Low', status: 'Planned', trancheGroupId: g, trancheIndex: 1, targetQty: 10 },
      { id: '2', symbol: 'X', name: 'X', tradeType: 'buy', conditionType: 'price', targetValue: 1, priority: 'Low', status: 'Planned', trancheGroupId: g, trancheIndex: 2, targetQty: 10 },
    ];
    const next = recomputeTrancheAfterFill(trades, '1', 4);
    const t2 = next.find((t) => t.id === '2');
    expect(t2?.targetQty).toBe(6);
  });
});
