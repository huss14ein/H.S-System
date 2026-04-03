import { describe, expect, it } from 'vitest';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

describe('getInvestmentTransactionCashAmount', () => {
  it('prefers total when present', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'buy', total: 1200 })).toBe(1200);
  });

  it('falls back to legacy amount', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'deposit', amount: 5000 } as any)).toBe(5000);
  });

  it('derives buy amount from quantity*price plus fees when total is missing', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'buy', quantity: 10, price: 100, fees: 5 } as any)).toBe(1005);
  });

  it('derives sell amount from quantity*price minus fees when total is missing', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'sell', quantity: 10, price: 100, fees: 5 } as any)).toBe(995);
  });

  it('does not derive deposit from quantity*price noise when total/amount are missing', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'deposit', quantity: 10, price: 100 } as any)).toBe(0);
  });

  it('does not derive withdrawal from quantity*price noise when total/amount are missing', () => {
    expect(getInvestmentTransactionCashAmount({ type: 'withdrawal', quantity: 10, price: 100 } as any)).toBe(0);
  });
});
