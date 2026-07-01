import { describe, expect, it } from 'vitest';
import {
  applyPrincipalPaymentToSukukPosition,
  buildMaturityPrincipalEventDraft,
  resolveMaturityPrincipalAmount,
} from '../services/sukuk/sukukPayoutLifecycle';
import type { SukukPosition } from '../types';

const basePosition: SukukPosition = {
  id: 'pos1',
  name: 'Gov Sukuk',
  investmentAccountId: 'acc1',
  currency: 'SAR',
  faceValue: 10000,
  outstandingPrincipal: 10000,
  issueDate: '2024-01-01',
  maturityDate: '2026-12-31',
  status: 'active',
};

describe('sukukPayoutLifecycle', () => {
  it('reduces outstanding principal and completes when fully paid', () => {
    const update = applyPrincipalPaymentToSukukPosition(basePosition, 10000, '2026-12-31');
    expect(update.outstandingPrincipal).toBe(0);
    expect(update.status).toBe('completed');
  });

  it('amortizes partial principal without completing', () => {
    const update = applyPrincipalPaymentToSukukPosition(basePosition, 2500, '2025-06-01');
    expect(update.outstandingPrincipal).toBe(7500);
    expect(update.status).toBe('active');
  });

  it('defaults maturity principal to outstanding when not configured', () => {
    expect(resolveMaturityPrincipalAmount(basePosition, null)).toBe(10000);
    expect(resolveMaturityPrincipalAmount(basePosition, 0)).toBe(10000);
    expect(resolveMaturityPrincipalAmount(basePosition, 3000)).toBe(3000);
  });

  it('builds maturity principal draft for overdue active positions', () => {
    const draft = buildMaturityPrincipalEventDraft(
      { ...basePosition, maturityDate: '2020-01-01' },
      '2026-06-27',
    );
    expect(draft?.amount).toBe(10000);
    expect(draft?.kind).toBe('principal');
    expect(draft?.sukukPositionId).toBe('pos1');
  });
});
