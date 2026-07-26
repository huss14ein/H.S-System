import { describe, expect, it } from 'vitest';
import type { FinancialData } from '../types';
import {
  computeAvailableLiquiditySar,
  computeEmergencyFundFloorSar,
  sumGoalReservesSar,
  buildAvailableLiquiditySnapshot,
} from '../services/availableLiquidity';

describe('computeAvailableLiquiditySar', () => {
  it('subtracts emergency floor and reserves from liquid cash', () => {
    expect(
      computeAvailableLiquiditySar({ liquidCashSar: 10000, reservedSar: 2000, emergencyFundFloorSar: 3000 }),
    ).toBe(5000);
  });

  it('never returns negative (clamps to 0)', () => {
    expect(
      computeAvailableLiquiditySar({ liquidCashSar: 1000, reservedSar: 2000, emergencyFundFloorSar: 3000 }),
    ).toBe(0);
  });

  it('treats negative / NaN inputs as zero', () => {
    expect(
      computeAvailableLiquiditySar({ liquidCashSar: -50, reservedSar: -10, emergencyFundFloorSar: Number.NaN }),
    ).toBe(0);
    expect(
      computeAvailableLiquiditySar({ liquidCashSar: 500, reservedSar: 0, emergencyFundFloorSar: 0 }),
    ).toBe(500);
  });
});

describe('computeEmergencyFundFloorSar', () => {
  it('is monthly essential expense x months target, capped by liquid cash', () => {
    expect(computeEmergencyFundFloorSar(50000, 4000, 6)).toBe(24000);
  });

  it('never exceeds liquid cash on hand', () => {
    expect(computeEmergencyFundFloorSar(10000, 4000, 6)).toBe(10000);
  });

  it('returns 0 when no essential expense is known', () => {
    expect(computeEmergencyFundFloorSar(10000, 0, 6)).toBe(0);
  });
});

describe('sumGoalReservesSar', () => {
  it('sums positive reservedAmount across goals', () => {
    const data = {
      goals: [
        { id: 'a', name: 'Car', targetAmount: 100, currentAmount: 0, deadline: '', reservedAmount: 1500 },
        { id: 'b', name: 'Trip', targetAmount: 100, currentAmount: 0, deadline: '', reservedAmount: 500 },
        { id: 'c', name: 'None', targetAmount: 100, currentAmount: 0, deadline: '' },
        { id: 'd', name: 'Neg', targetAmount: 100, currentAmount: 0, deadline: '', reservedAmount: -200 },
      ],
    } as unknown as FinancialData;
    expect(sumGoalReservesSar(data)).toBe(2000);
  });

  it('handles null data', () => {
    expect(sumGoalReservesSar(null)).toBe(0);
  });
});

describe('buildAvailableLiquiditySnapshot', () => {
  it('composes reserves + floor + available together', () => {
    const data = {
      goals: [{ id: 'a', name: 'Car', targetAmount: 100, currentAmount: 0, deadline: '', reservedAmount: 2000 }],
    } as unknown as FinancialData;
    const snap = buildAvailableLiquiditySnapshot({
      data,
      liquidCashSar: 30000,
      monthlyEssentialExpenseSar: 4000,
      monthsTarget: 6,
    });
    expect(snap.reservedLiquiditySar).toBe(2000);
    expect(snap.emergencyFundFloorSar).toBe(24000);
    expect(snap.availableLiquiditySar).toBe(4000);
  });
});
