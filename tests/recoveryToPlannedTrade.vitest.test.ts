import { describe, expect, it } from 'vitest';
import { recoveryOrderDraftToPlannedTrade, plannedTradeMatchesRecoveryDraft } from '../services/recoveryToPlannedTrade';
import type { PlannedTrade, RecoveryOrderDraft } from '../types';

describe('recoveryOrderDraftToPlannedTrade', () => {
  it('maps BUY ladder draft with USD instrument and SAR plan currency', () => {
    const draft: RecoveryOrderDraft = {
      type: 'BUY',
      symbol: 'AAPL',
      qty: 10,
      limitPrice: 180,
      orderType: 'LIMIT',
      label: 'Recovery L1',
    };
    const out = recoveryOrderDraftToPlannedTrade(draft, {
      displayName: 'Apple Inc.',
      planCurrency: 'SAR',
      sarPerUsd: 3.75,
      limitPriceCurrency: 'USD',
    });
    expect(out.symbol).toBe('AAPL');
    expect(out.name).toBe('Apple Inc.');
    expect(out.tradeType).toBe('buy');
    expect(out.conditionType).toBe('price');
    expect(out.targetValue).toBe(180);
    expect(out.quantity).toBe(10);
    expect(out.amount).toBeCloseTo(180 * 10 * 3.75, 2);
    expect(out.priority).toBe('High');
    expect(out.status).toBe('Planned');
  });

  it('maps SAR-listed symbol without FX on amount when plan is SAR', () => {
    const draft: RecoveryOrderDraft = {
      type: 'BUY',
      symbol: '2222.SR',
      qty: 100,
      limitPrice: 42,
      orderType: 'LIMIT',
    };
    const out = recoveryOrderDraftToPlannedTrade(draft, {
      displayName: 'Test',
      planCurrency: 'SAR',
      sarPerUsd: 3.75,
      limitPriceCurrency: 'SAR',
    });
    expect(out.targetValue).toBe(42);
    expect(out.amount).toBeCloseTo(4200, 2);
  });
});

describe('plannedTradeMatchesRecoveryDraft', () => {
  const base: PlannedTrade = {
    id: '1',
    symbol: 'AAPL',
    name: 'Apple',
    tradeType: 'buy',
    conditionType: 'price',
    targetValue: 180,
    quantity: 10,
    amount: 1000,
    priority: 'High',
    status: 'Planned',
  };

  it('detects duplicate', () => {
    const candidate = {
      symbol: 'AAPL',
      name: 'Apple',
      tradeType: 'buy' as const,
      conditionType: 'price' as const,
      targetValue: 180,
      quantity: 10,
      amount: 999,
      priority: 'High' as const,
      status: 'Planned' as const,
    };
    expect(plannedTradeMatchesRecoveryDraft([base], candidate)).toBe(true);
  });

  it('ignores executed plans', () => {
    const candidate = {
      symbol: 'AAPL',
      name: 'Apple',
      tradeType: 'buy' as const,
      conditionType: 'price' as const,
      targetValue: 180,
      quantity: 10,
      amount: 999,
      priority: 'High' as const,
      status: 'Planned' as const,
    };
    expect(plannedTradeMatchesRecoveryDraft([{ ...base, status: 'Executed' }], candidate)).toBe(false);
  });
});
