import { describe, expect, it } from 'vitest';
import {
  aggregateCreditCardStatementActivity,
  estimateMinimumCardPaymentDue,
  estimateMinimumDueSar,
} from '../services/creditCardLedger';
import type { Transaction } from '../types';

describe('creditCardLedger', () => {
  it('aggregates purchases, transfer payments, interest, and refunds in-range', () => {
    const txs: Transaction[] = [
      { id: '1', date: '2026-05-02', amount: -100, type: 'expense', category: 'Food', accountId: 'cc' } as Transaction,
      { id: '2', date: '2026-05-03', amount: 50, type: 'income', category: 'Transfer', accountId: 'cc', transferRole: 'principal_in' } as Transaction,
      { id: '3', date: '2026-05-04', amount: -10, type: 'expense', category: 'Interest', accountId: 'cc' } as Transaction,
      { id: '4', date: '2026-05-05', amount: 20, type: 'income', category: 'Refund', accountId: 'cc' } as Transaction,
    ];
    const a = aggregateCreditCardStatementActivity(txs, 'cc', '2026-05-01', '2026-05-31');
    expect(a.purchaseFlow).toBe(-100);
    expect(a.paymentPrincipalIn).toBe(50);
    expect(a.interestAndFees).toBe(10);
    expect(a.refundFlow).toBe(20);
  });

  it('estimateMinimumCardPaymentDue uses issuer-style SAR floor and 1%', () => {
    expect(estimateMinimumCardPaymentDue(0, 'SAR')).toBe(25);
    expect(estimateMinimumCardPaymentDue(5000, 'SAR')).toBe(50);
    expect(estimateMinimumDueSar(0)).toBe(25);
    expect(estimateMinimumDueSar(5000)).toBe(50);
  });

  it('estimateMinimumCardPaymentDue uses small USD floor so 1% is not drowned out', () => {
    expect(estimateMinimumCardPaymentDue(100, 'USD')).toBe(1);
    expect(estimateMinimumCardPaymentDue(0, 'USD')).toBe(1);
    expect(estimateMinimumCardPaymentDue(5000, 'USD')).toBe(50);
  });
});
