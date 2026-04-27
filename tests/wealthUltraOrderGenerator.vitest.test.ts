import { describe, it, expect } from 'vitest';
import { generateOrders } from '../wealth-ultra/orderGenerator';
import type { WealthUltraConfig, WealthUltraPosition } from '../types';

const baseConfig = {
  fxRate: 3.75,
  targetCorePct: 65,
  targetUpsidePct: 28,
  targetSpecPct: 7,
  defaultTarget1Pct: 14,
  defaultTarget2Pct: 27,
  defaultTrailingPct: 11,
  monthlyDeposit: 0,
  cashAvailable: 0,
  cashReservePct: 12,
  maxPerTickerPct: 16,
  riskWeightLow: 1,
  riskWeightMed: 1.3,
  riskWeightHigh: 1.65,
  riskWeightSpec: 2.2,
} satisfies WealthUltraConfig;

function pos(p: Partial<WealthUltraPosition> & Pick<WealthUltraPosition, 'ticker' | 'strategyMode' | 'currentShares'>): WealthUltraPosition {
  return {
    sleeveType: 'Core',
    riskTier: 'Med',
    avgCost: 10,
    currentPrice: 10,
    marketValue: 1000,
    plDollar: 0,
    plPct: 0,
    applyTarget1: true,
    applyTarget2: false,
    applyTrailing: true,
    target1Price: 11,
    trailingStopPrice: 9,
    ...p,
  } as WealthUltraPosition;
}

describe('generateOrders sell semantics', () => {
  it('does not emit sells for Hold positions (most holdings)', () => {
    const orders = generateOrders(
      [
        pos({
          ticker: 'X',
          strategyMode: 'Hold',
          currentShares: 100,
          plPct: 10,
          target1Price: 12,
        }),
      ],
      baseConfig,
    );
    expect(orders.filter((o) => o.type === 'SELL')).toHaveLength(0);
  });

  it('Trim mode: partial qty (~33%), not full position', () => {
    const orders = generateOrders(
      [
        pos({
          ticker: 'WIN',
          strategyMode: 'Trim',
          currentShares: 100,
          plPct: 45,
          marketValue: 1450,
          plDollar: 450,
        }),
      ],
      baseConfig,
    );
    const sell = orders.find((o) => o.type === 'SELL');
    expect(sell?.qty).toBe(33);
    expect(sell?.rationale).toMatch(/33% trim/i);
  });

  it('Exit mode: full position', () => {
    const orders = generateOrders(
      [
        pos({
          ticker: 'LOSE',
          strategyMode: 'Exit',
          currentShares: 3021,
          plPct: -35,
          marketValue: 2000,
          plDollar: -1000,
        }),
      ],
      baseConfig,
    );
    const sell = orders.find((o) => o.type === 'SELL');
    expect(sell?.qty).toBe(3021);
  });

  it('DipBuy: no sell row', () => {
    const orders = generateOrders(
      [
        pos({
          ticker: 'DIP',
          strategyMode: 'DipBuy',
          currentShares: 50,
          plPct: -18,
        }),
      ],
      baseConfig,
    );
    expect(orders.filter((o) => o.type === 'SELL')).toHaveLength(0);
  });
});
