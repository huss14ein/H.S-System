import { describe, expect, it } from 'vitest';
import { deltaForInvestmentTrade, netInvestmentBalanceFromTransactions } from '../services/investmentBalanceDelta';

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

  it('computes net investment balance from transaction ledger', () => {
    const txs = [
      { accountId: 'inv-1', type: 'deposit', total: 1000 },
      { accountId: 'inv-1', type: 'buy', total: 300 },
      { accountId: 'inv-1', type: 'sell', total: 120 },
      { accountId: 'inv-1', type: 'dividend', total: 10 },
      { accountId: 'inv-1', type: 'withdrawal', total: 30 },
      { accountId: 'other', type: 'deposit', total: 5000 },
    ];
    expect(netInvestmentBalanceFromTransactions('inv-1', txs)).toBe(800);
  });
});
