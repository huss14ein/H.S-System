/**
 * Computes the projected monthly contribution for a goal from monthly savings and allocation percent.
 * Values are sanitized to keep routing deterministic (NaN/negative => 0, percent clamped to 0..100).
 */
export function computeGoalMonthlyAllocation(monthlySavings: number, savingsAllocationPercent: number): number {
  const savingsRaw = Number(monthlySavings);
  const savings = Number.isFinite(savingsRaw) ? Math.max(0, savingsRaw) : 0;
  const pctNumber = Number(savingsAllocationPercent);
  const pctRaw = Number.isFinite(pctNumber) ? pctNumber : 0;
  const pct = Math.max(0, Math.min(100, pctRaw));
  return savings * (pct / 100);
}
