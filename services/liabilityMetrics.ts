/** Annual debt service / gross monthly income (use same currency). */
export function debtServiceRatio(annualDebtPayments: number, grossMonthlyIncome: number): number {
  const annualIncome = Math.max(1, grossMonthlyIncome * 12);
  return annualDebtPayments / annualIncome;
}

/** Liquid assets / current liabilities (simplified). */
export function liquidityRatio(liquidAssets: number, currentLiabilities: number): number {
  const liab = Math.max(1, currentLiabilities);
  return liquidAssets / liab;
}
