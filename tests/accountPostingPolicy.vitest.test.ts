import { describe, expect, it } from 'vitest';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';

describe('canPostTransactionToAccount', () => {
  it('allows credit accounts even when type casing is inconsistent and balance is zero', () => {
    const out = canPostTransactionToAccount({
      id: 'cc-1',
      type: 'credit' as any,
      balance: 0,
    });
    expect(out.allowed).toBe(true);
  });

  it('keeps non-credit zero-balance accounts blocked', () => {
    const out = canPostTransactionToAccount({
      id: 'chk-1',
      type: 'Checking',
      balance: 0,
    });
    expect(out.allowed).toBe(false);
  });
});
