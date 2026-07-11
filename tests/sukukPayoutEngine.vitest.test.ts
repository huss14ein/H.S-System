import { describe, expect, it } from 'vitest';
import { materializeSukukPayoutEvents } from '../services/sukuk/sukukPayoutEngine';

describe('sukukPayoutEngine', () => {
  const baseSchedule = {
    id: 'sch1',
    sukukPositionId: 'pos1',
    investmentAccountId: 'acc1',
    currency: 'SAR' as const,
    enabled: true,
  };

  it('materializes bullet maturity principal from outstanding when principalAmount is null', () => {
    const events = materializeSukukPayoutEvents({
      schedule: {
        ...baseSchedule,
        cadence: 'maturity_only',
        couponAmount: 100,
        principalAmount: null,
      },
      positionDates: { issueDate: '2024-01-01', maturityDate: '2026-06-01' },
      outstandingPrincipal: 50000,
    });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.kind === 'coupon')?.amount).toBe(100);
    const principal = events.find((e) => e.kind === 'principal');
    expect(principal?.amount).toBe(50000);
    expect(principal?.payoutDate).toBe('2026-06-01');
  });

  it('materializes amortizing installments plus maturity remainder', () => {
    const events = materializeSukukPayoutEvents({
      schedule: {
        ...baseSchedule,
        cadence: 'quarterly',
        dayOfMonth: 1,
        couponAmount: 50,
        principalInstallmentAmount: 1000,
        startDate: '2025-01-01',
        endDate: '2025-07-01',
      },
      positionDates: { issueDate: '2025-01-01', maturityDate: '2025-07-01' },
      outstandingPrincipal: 5000,
    });
    const principals = events.filter((e) => e.kind === 'principal');
    const installmentSum = principals
      .filter((e) => e.payoutDate !== '2025-07-01')
      .reduce((s, e) => s + e.amount, 0);
    const maturityPrincipal = principals.find((e) => e.payoutDate === '2025-07-01');
    expect(installmentSum).toBeGreaterThan(0);
    expect(maturityPrincipal?.amount).toBeCloseTo(5000 - installmentSum, 4);
  });
});
