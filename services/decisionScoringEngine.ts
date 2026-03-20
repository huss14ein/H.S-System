/**
 * Decision scoring frameworks (spec §31).
 * Personal finance score, investment score, trading score.
 */

/** Personal finance health: liquidity, savings, debt, goal progress, expense control. */
export function personalFinanceHealthScore(args: {
  liquidityScore: number;   // 0-100
  savingsRatePct: number;
  debtPressureScore: number; // 0-100, high = bad
  goalProgressScore: number; // 0-100
  expenseControlScore: number; // 0-100
}): number {
  const l = Math.max(0, Math.min(100, args.liquidityScore ?? 50));
  const s = Math.max(0, Math.min(100, (args.savingsRatePct ?? 0) * 2)); // 50% savings = 100
  const d = Math.max(0, Math.min(100, 100 - (args.debtPressureScore ?? 0)));
  const g = Math.max(0, Math.min(100, args.goalProgressScore ?? 50));
  const e = Math.max(0, Math.min(100, args.expenseControlScore ?? 50));
  return Math.round((l * 0.25 + s * 0.2 + d * 0.2 + g * 0.2 + e * 0.15));
}

/** Investment composite: quality, valuation, growth, financial strength, risk, timing, portfolio fit. */
export function investmentCompositeScore(args: {
  qualityScore: number;
  valuationScore: number;
  growthScore: number;
  financialStrengthScore: number;
  riskScore: number; // lower is better
  timingScore: number;
  portfolioFitScore: number;
}): number {
  const q = Math.max(0, Math.min(100, args.qualityScore ?? 50));
  const v = Math.max(0, Math.min(100, args.valuationScore ?? 50));
  const g = Math.max(0, Math.min(100, args.growthScore ?? 50));
  const f = Math.max(0, Math.min(100, args.financialStrengthScore ?? 50));
  const r = Math.max(0, Math.min(100, 100 - (args.riskScore ?? 50)));
  const t = Math.max(0, Math.min(100, args.timingScore ?? 50));
  const p = Math.max(0, Math.min(100, args.portfolioFitScore ?? 50));
  return Math.round((q + v + g + f + r + t + p) / 7);
}

/** Trading setup: setup quality, reward/risk, trend, catalyst, position sizing. */
export function tradingSetupScore(args: {
  setupQualityScore: number;
  rewardRiskScore: number;
  trendScore: number;
  catalystScore: number;
  positionSizingScore: number;
}): number {
  const a = Math.max(0, Math.min(100, args.setupQualityScore ?? 50));
  const b = Math.max(0, Math.min(100, args.rewardRiskScore ?? 50));
  const c = Math.max(0, Math.min(100, args.trendScore ?? 50));
  const d = Math.max(0, Math.min(100, args.catalystScore ?? 50));
  const e = Math.max(0, Math.min(100, args.positionSizingScore ?? 50));
  return Math.round((a + b + c + d + e) / 5);
}
