export function normalizeGoalAllocationPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

export function computeGoalMonthlyAllocation(monthlySavings: number, savingsAllocationPercent: unknown): number {
  const normalizedSavings = Number(monthlySavings);
  if (!Number.isFinite(normalizedSavings) || normalizedSavings <= 0) return 0;
  const pct = normalizeGoalAllocationPercent(savingsAllocationPercent);
  return normalizedSavings * (pct / 100);
}
