import { describe, expect, it } from 'vitest';
import { applyInstallmentEvent, type ReducerState } from '../services/installments/installmentState';

function mkState(): ReducerState {
  return {
    plan: {
      planId: 'p1',
      provider: 'MANUAL',
      status: 'PENDING_ACTIVATION',
      totalAmountMinor: 1000n,
      installmentCount: 3,
      paidCount: 0,
    },
    installmentsBySeq: new Map([
      [1, { installmentId: 'i1', sequence: 1, status: 'SCHEDULED', amountMinor: 400n }],
      [2, { installmentId: 'i2', sequence: 2, status: 'SCHEDULED', amountMinor: 300n }],
      [3, { installmentId: 'i3', sequence: 3, status: 'SCHEDULED', amountMinor: 300n }],
    ]),
  };
}

describe('applyInstallmentEvent', () => {
  it('activates plan on authorization', () => {
    const s = applyInstallmentEvent(mkState(), { type: 'PLAN_AUTHORIZED', atISO: new Date().toISOString() });
    expect(s.plan.status).toBe('ACTIVE');
  });

  it('marks installment paid and completes plan when last paid', () => {
    let s = applyInstallmentEvent(mkState(), { type: 'PLAN_AUTHORIZED', atISO: new Date().toISOString() });
    s = applyInstallmentEvent(s, { type: 'PAYMENT_CAPTURED', atISO: new Date().toISOString(), installmentSequence: 1 });
    s = applyInstallmentEvent(s, { type: 'PAYMENT_CAPTURED', atISO: new Date().toISOString(), installmentSequence: 2 });
    s = applyInstallmentEvent(s, { type: 'PAYMENT_CAPTURED', atISO: new Date().toISOString(), installmentSequence: 3 });
    expect(s.plan.status).toBe('COMPLETED');
    expect(s.plan.paidCount).toBe(3);
  });

  it('ignores illegal events after terminal plan (except refunds)', () => {
    let s = mkState();
    s = applyInstallmentEvent(s, { type: 'PLAN_CANCELLED', atISO: new Date().toISOString() });
    expect(s.plan.status).toBe('CANCELLED');
    const s2 = applyInstallmentEvent(s, { type: 'PAYMENT_CAPTURED', atISO: new Date().toISOString(), installmentSequence: 1 });
    expect(s2.plan.status).toBe('CANCELLED');
  });
});

