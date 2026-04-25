import { describe, expect, it } from 'vitest';
import { downsampleForecastRows, forecastToMonthlyRate, projectForecastSeries } from '../services/forecastProjection';

describe('forecastProjection', () => {
  it('keeps net worth aligned as non-investment slice plus investment balance each month', () => {
    const inv0 = 50_000;
    const nw0 = 200_000;
    const nonInv = nw0 - inv0;
    const r = projectForecastSeries({
      initialNetWorth: nw0,
      initialInvestmentValue: inv0,
      monthlySavings: 2_000,
      horizonYears: 1,
      investmentGrowthAnnualPct: 6,
      savingsGrowthAnnualPct: 0,
    });
    expect(r.rows.length).toBe(12);
    r.rows.forEach((row) => {
      expect(row['Net Worth']).toBe(nonInv + row['Investment Value']);
    });
    expect(r.finalNetWorth).toBe(r.nonInvestmentOpening + r.finalInvestmentValue);
  });

  it('matches zero-growth closed form for flat contributions', () => {
    const inv0 = 10_000;
    const nw0 = 100_000;
    const m = 5_000;
    const months = 24;
    const r = projectForecastSeries({
      initialNetWorth: nw0,
      initialInvestmentValue: inv0,
      monthlySavings: m,
      horizonYears: months / 12,
      investmentGrowthAnnualPct: 0,
      savingsGrowthAnnualPct: 0,
    });
    expect(r.finalInvestmentValue).toBe(inv0 + m * months);
    expect(r.finalNetWorth).toBe(nw0 - inv0 + r.finalInvestmentValue);
  });

  it('forecastToMonthlyRate compounds annual to monthly', () => {
    const mr = forecastToMonthlyRate(12);
    expect(Math.pow(1 + mr, 12)).toBeCloseTo(1.12, 6);
  });

  it('downsampleForecastRows preserves last row and caps length', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      name: `m${i}`,
      'Net Worth': i,
      'Investment Value': i,
    }));
    const ds = downsampleForecastRows(rows, 20);
    expect(ds.length).toBeLessThanOrEqual(21);
    expect(ds[ds.length - 1]).toEqual(rows[rows.length - 1]);
  });
});
