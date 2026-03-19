/** v1: split period delta into deposits, withdrawals, and residual (market). */
export function attributePeriodChange(input: {
  startValue: number;
  endValue: number;
  netDeposits: number;
}): { marketEffect: number; flowEffect: number; headline: string } {
  const { startValue, endValue, netDeposits } = input;
  const flowEffect = netDeposits;
  const marketEffect = endValue - startValue - netDeposits;
  return {
    marketEffect,
    flowEffect,
    headline: `ΔNW ≈ ${marketEffect >= 0 ? '+' : ''}${marketEffect.toFixed(0)} market vs ${flowEffect >= 0 ? '+' : ''}${flowEffect.toFixed(0)} net flows (illustrative).`,
  };
}

/** v2: same math with explicit delta + residual labels for UI. */
export function attributeNetWorthWithFlows(input: {
  startNw: number;
  endNw: number;
  externalCashflow: number;
}): {
  deltaNw: number;
  externalCashflow: number;
  residual: string;
  bullets: string[];
} {
  const deltaNw = input.endNw - input.startNw;
  const residualNum = deltaNw - input.externalCashflow;
  const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(0);
  return {
    deltaNw,
    externalCashflow: input.externalCashflow,
    residual: fmt(residualNum),
    bullets: [
      `Net worth change: ${fmt(deltaNw)}`,
      `External cashflow (income − expenses, excl. transfers): ${fmt(input.externalCashflow)}`,
      `Residual (investment marks, FX, new debt/assets, etc.): ${fmt(residualNum)}`,
    ],
  };
}
