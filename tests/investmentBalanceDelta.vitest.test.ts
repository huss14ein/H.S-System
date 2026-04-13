import { describe, it, expect } from 'vitest';
import { deltaForInvestmentTrade } from '../services/investmentBalanceDelta';

describe('deltaForInvestmentTrade', () => {
  it('uses total as authoritative cash impact sign mapping', () => {
    expect(deltaForInvestmentTrade('buy', 101)).toBe(-101);
    expect(deltaForInvestmentTrade('sell', 803.25)).toBe(803.25);
    expect(deltaForInvestmentTrade('deposit', 500)).toBe(500);
    expect(deltaForInvestmentTrade('withdrawal', 500)).toBe(-500);
    expect(deltaForInvestmentTrade('dividend', 25)).toBe(25);
    expect(deltaForInvestmentTrade('fee', 2.9546)).toBe(-2.9546);
    expect(deltaForInvestmentTrade('vat', 0.17728)).toBe(-0.17728);
  });
});

