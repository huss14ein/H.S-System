import { describe, expect, it } from 'vitest';
import { computeDeductibleLiabilities } from '../services/zakatLiabilityMath';

describe('computeDeductibleLiabilities', () => {
  it('does not double-count manual credit-card liabilities when credit accounts already carry debt', () => {
    const out = computeDeductibleLiabilities({
      accounts: [
        { id: 'cc1', name: 'Visa', type: 'Credit', balance: -1000, currency: 'SAR' },
      ] as any,
      liabilities: [
        { id: 'l1', name: 'Visa', type: 'Credit Card', amount: -1000, status: 'Active' },
      ] as any,
      otherDebts: 0,
      sarPerUsd: 3.75,
    });

    expect(out.shortTermDebts).toBe(1000);
    expect(out.trackedLiabilities).toBe(0);
    expect(out.total).toBe(1000);
  });

  it('still counts non-credit tracked liabilities and clamps otherDebts to non-negative', () => {
    const out = computeDeductibleLiabilities({
      accounts: [],
      liabilities: [
        { id: 'l2', name: 'Personal Loan', type: 'Loan', amount: -2500, status: 'Active' },
        { id: 'l3', name: 'Friend owes me', type: 'Receivable', amount: 500, status: 'Active' },
      ] as any,
      otherDebts: -120,
      sarPerUsd: 3.75,
    });

    expect(out.shortTermDebts).toBe(0);
    expect(out.trackedLiabilities).toBe(2500);
    expect(out.otherDebts).toBe(0);
    expect(out.total).toBe(2500);
  });
});
