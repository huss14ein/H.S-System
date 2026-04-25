import { describe, expect, it } from 'vitest';
import { buildInstallmentSchedule } from '../services/installments/installmentMath';

describe('buildInstallmentSchedule', () => {
  it('splits evenly and preserves sum', () => {
    const s = buildInstallmentSchedule({ totalAmountMinor: 1000n, installmentCount: 4 });
    expect(s.amountsMinor).toEqual([250n, 250n, 250n, 250n]);
    expect(s.amountsMinor.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  it('distributes remainder deterministically', () => {
    const s = buildInstallmentSchedule({ totalAmountMinor: 1001n, installmentCount: 4 });
    expect(s.amountsMinor).toEqual([251n, 250n, 250n, 250n]);
    expect(s.amountsMinor.reduce((a, b) => a + b, 0n)).toBe(1001n);
  });

  it('supports first installment higher than the rest', () => {
    const s = buildInstallmentSchedule({ totalAmountMinor: 1000n, installmentCount: 4, firstInstallmentAmountMinor: 400n });
    expect(s.amountsMinor).toEqual([400n, 200n, 200n, 200n]);
    expect(s.amountsMinor.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  it('rejects invalid first installment', () => {
    expect(() =>
      buildInstallmentSchedule({ totalAmountMinor: 1000n, installmentCount: 4, firstInstallmentAmountMinor: 1000n })
    ).toThrow();
    expect(() =>
      buildInstallmentSchedule({ totalAmountMinor: 1000n, installmentCount: 4, firstInstallmentAmountMinor: 0n })
    ).toThrow();
  });

  it('single installment forces first=total', () => {
    const s = buildInstallmentSchedule({ totalAmountMinor: 999n, installmentCount: 1 });
    expect(s.amountsMinor).toEqual([999n]);
    expect(() => buildInstallmentSchedule({ totalAmountMinor: 999n, installmentCount: 1, firstInstallmentAmountMinor: 1n })).toThrow();
  });
});

