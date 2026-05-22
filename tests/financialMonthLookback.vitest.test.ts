import { describe, expect, it } from 'vitest';
import { financialMonthLookbackStart, currentFinancialMonthIso } from '../utils/financialMonth';

describe('financialMonthLookbackStart', () => {
  it('respects month start day for 6-month window', () => {
    const ref = new Date('2026-05-15T12:00:00');
    const startCal = financialMonthLookbackStart(ref, 6, 1);
    const startFin = financialMonthLookbackStart(ref, 6, 15);
    expect(startFin.getTime()).toBeGreaterThan(startCal.getTime());
  });

  it('currentFinancialMonthIso uses fiscal key', () => {
    const ref = new Date('2026-05-20T12:00:00');
    expect(currentFinancialMonthIso(ref, 15)).toBe('2026-05');
    expect(currentFinancialMonthIso(ref, 1)).toBe('2026-05');
  });
});
