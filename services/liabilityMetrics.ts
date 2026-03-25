/** Annual debt service / gross monthly income (use same currency). */
export function debtServiceRatio(annualDebtPayments: number, grossMonthlyIncome: number): number {
  const annualIncome = Math.max(1, grossMonthlyIncome * 12);
  return annualDebtPayments / annualIncome;
}

/**
 * Liquid assets ÷ current liabilities.
 * Returns null when there is no debt (avoid fake “huge ratio” from dividing by a placeholder).
 */
export function liquidityRatio(liquidAssets: number, currentLiabilities: number): number | null {
  const liab = Number(currentLiabilities);
  if (!Number.isFinite(liab) || liab <= 0) return null;
  const liq = Number(liquidAssets);
  if (!Number.isFinite(liq)) return null;
  return liq / liab;
}
