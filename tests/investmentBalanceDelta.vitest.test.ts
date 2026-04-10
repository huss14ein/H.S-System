import { describe, expect, it } from 'vitest';
import { deltaForInvestmentTrade } from '../services/investmentBalanceDelta';

describe('deltaForInvestmentTrade', () => {
  it('deducts balance on buy and withdrawal', () => {
    expect(deltaForInvestmentTrade('buy', 250)).toBe(-250);
    expect(deltaForInvestmentTrade('withdrawal', 99.5)).toBe(-99.5);
  });

  it('adds balance on sell, deposit, and dividend', () => {
    expect(deltaForInvestmentTrade('sell', 250)).toBe(250);
    expect(deltaForInvestmentTrade('deposit', 100)).toBe(100);
    expect(deltaForInvestmentTrade('dividend', 7.25)).toBe(7.25);
  });

  it('is resilient to sign/noise and unsupported types', () => {
    expect(deltaForInvestmentTrade('buy', -250)).toBe(-250);
    expect(deltaForInvestmentTrade('other', 100)).toBe(0);
    expect(deltaForInvestmentTrade('sell', Number.NaN)).toBe(0);
  });
});
