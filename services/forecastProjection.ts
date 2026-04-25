/**
 * Deterministic wealth projection for the Forecast page.
 * Investment balance receives monthly contributions and compound growth;
 * net worth = (non-investment slice of opening NW) + projected investment balance.
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const forecastToMonthlyRate = (annualPct: number) =>
  Math.pow(1 + annualPct / 100, 1 / 12) - 1;

export type ForecastProjectionInput = {
  initialNetWorth: number;
  initialInvestmentValue: number;
  monthlySavings: number;
  horizonYears: number;
  investmentGrowthAnnualPct: number;
  savingsGrowthAnnualPct: number;
};

export type ForecastMonthRow = {
  name: string;
  'Net Worth': number;
  'Investment Value': number;
};

export function projectForecastSeries(input: ForecastProjectionInput): {
  rows: ForecastMonthRow[];
  finalNetWorth: number;
  finalInvestmentValue: number;
  nonInvestmentOpening: number;
} {
  const {
    initialNetWorth,
    initialInvestmentValue,
    monthlySavings,
    horizonYears,
    investmentGrowthAnnualPct,
    savingsGrowthAnnualPct,
  } = input;

  const horizonMonths = Math.max(1, Math.round(horizonYears * 12));
  const inv0 = Math.max(0, Number(initialInvestmentValue) || 0);
  const nw0 = Number(initialNetWorth) || 0;
  /** Everything in opening NW that is not modeled inside the investment pile (property, cash, etc.). */
  const nonInvestmentOpening = nw0 - inv0;

  let inv = inv0;
  let currentMonthlySavings = Math.max(0, Number(monthlySavings) || 0);
  const monthlySavingsRate = forecastToMonthlyRate(clamp(savingsGrowthAnnualPct, -20, 40));
  const monthlyReturn = forecastToMonthlyRate(clamp(investmentGrowthAnnualPct, -40, 40));

  const rows: ForecastMonthRow[] = [];
  const currentDate = new Date();

  for (let i = 0; i < horizonMonths; i++) {
    const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    if (i > 0) {
      currentMonthlySavings *= 1 + monthlySavingsRate;
    }
    const contrib = Math.max(0, currentMonthlySavings);
    inv += contrib;
    inv += inv * monthlyReturn;
    const nw = nonInvestmentOpening + inv;

    rows.push({
      name: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      'Net Worth': Math.round(nw),
      'Investment Value': Math.round(inv),
    });
  }

  const last = rows[rows.length - 1];
  return {
    rows,
    finalNetWorth: last ? last['Net Worth'] : Math.round(nw0),
    finalInvestmentValue: last ? last['Investment Value'] : Math.round(inv0),
    nonInvestmentOpening,
  };
}

/** Downsample time series for chart readability (max N points). */
export function downsampleForecastRows(rows: ForecastMonthRow[], maxPoints = 72): ForecastMonthRow[] {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  const out: ForecastMonthRow[] = [];
  for (let i = 0; i < rows.length; i += step) {
    out.push(rows[i]!);
  }
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
