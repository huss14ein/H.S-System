/**
 * Return measurement logic (spec §7).
 * Cash return views, performance views, attribution.
 */

/** Simple (holding-period) return: (end - start) / start. */
export function simpleReturn(startValue: number, endValue: number): number {
  if (!Number.isFinite(startValue) || startValue <= 0) return 0;
  return ((endValue - startValue) / startValue) * 100;
}

/** Annualize a return over a period in years. */
export function annualizedReturn(periodReturnPct: number, years: number): number {
  if (!Number.isFinite(years) || years <= 0) return 0;
  const r = periodReturnPct / 100;
  return (Math.pow(1 + r, 1 / years) - 1) * 100;
}

/** Money-weighted return: delegate to IRR-style calculator (caller passes flows + terminal). */
export function moneyWeightedReturn(
  flows: { date: string; amount: number }[],
  terminalValue: number,
  terminalDate: string,
  irrFn: (flows: { date: string; amount: number }[], tv: number, td: string) => number | null
): number | null {
  return irrFn(flows, terminalValue, terminalDate);
}

/** Time-weighted return (simplified): geometric linking of sub-period returns. */
export function timeWeightedReturn(periodReturnsPct: number[]): number {
  if (!periodReturnsPct.length) return 0;
  let g = 1;
  for (const r of periodReturnsPct) {
    g *= 1 + (Number(r) || 0) / 100;
  }
  return (g - 1) * 100;
}

/** Portfolio return minus benchmark return (excess). */
export function benchmarkExcessReturn(portfolioReturnPct: number, benchmarkReturnPct: number): number {
  return (Number(portfolioReturnPct) || 0) - (Number(benchmarkReturnPct) || 0);
}

/** Attribution: price return + dividend return + FX + contribution (simplified buckets). */
export function totalReturnAttribution(args: {
  priceReturnPct?: number;
  dividendReturnPct?: number;
  fxReturnPct?: number;
  contributionReturnPct?: number;
}): { price: number; dividend: number; fx: number; contribution: number; total: number } {
  const price = Number(args.priceReturnPct) || 0;
  const dividend = Number(args.dividendReturnPct) || 0;
  const fx = Number(args.fxReturnPct) || 0;
  const contribution = Number(args.contributionReturnPct) || 0;
  return { price, dividend, fx, contribution, total: price + dividend + fx + contribution };
}
