/**
 * Liability and debt intelligence (logic layer).
 * Payoff strategies, effective cost, prepayment savings, stress score.
 */

export interface DebtItem {
  id: string;
  balance: number;
  annualRatePct: number;
  monthlyPayment: number;
  remainingMonths?: number;
}

export type PayoffStrategy = 'avalanche' | 'snowball' | 'hybrid' | 'liquidity_preserving';

/** Compare payoff order by strategy. Returns ordered list of debt ids. */
export function debtPayoffPlan(
  debts: DebtItem[],
  strategy: PayoffStrategy
): string[] {
  if (strategy === 'avalanche')
    return [...debts].sort((a, b) => (b.annualRatePct ?? 0) - (a.annualRatePct ?? 0)).map((d) => d.id);
  if (strategy === 'snowball')
    return [...debts].sort((a, b) => a.balance - b.balance).map((d) => d.id);
  if (strategy === 'hybrid') {
    const byRate = [...debts].sort((a, b) => (b.annualRatePct ?? 0) - (a.annualRatePct ?? 0));
    return byRate.map((d) => d.id);
  }
  return [...debts].map((d) => d.id);
}

/** Effective annual cost (interest) for a debt. */
export function effectiveDebtCost(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number
): { annualInterest: number; totalPayable: number; effectiveRatePct: number } {
  const r = annualRatePct / 100 / 12;
  let remaining = balance;
  let totalInterest = 0;
  let months = 0;
  const maxMonths = 600;
  while (remaining > 0.01 && months < maxMonths) {
    const interest = remaining * r;
    totalInterest += interest;
    remaining = remaining + interest - monthlyPayment;
    months++;
  }
  const totalPayable = balance + totalInterest;
  const effectiveRatePct = balance > 0 ? (totalInterest / balance) * 100 : 0;
  return { annualInterest: totalInterest * (12 / Math.max(1, months)), totalPayable, effectiveRatePct };
}

/** Savings from prepayment: reduce total interest by paying extra. */
export function prepaymentSavings(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number,
  extraOneTime: number
): { newTotalInterest: number; savingsVsNoPrepay: number } {
  const r = annualRatePct / 100 / 12;
  let remain = balance;
  let totalNoPrepay = 0;
  let months = 0;
  const maxMonths = 600;
  while (remain > 0.01 && months < maxMonths) {
    totalNoPrepay += remain * r;
    remain = remain + remain * r - monthlyPayment;
    months++;
  }
  let remainWith = balance - extraOneTime;
  let totalWithPrepay = 0;
  months = 0;
  while (remainWith > 0.01 && months < maxMonths) {
    totalWithPrepay += remainWith * r;
    remainWith = remainWith + remainWith * r - monthlyPayment;
    months++;
  }
  const totalWithPrepayInterest = totalWithPrepay;
  return {
    newTotalInterest: totalWithPrepayInterest,
    savingsVsNoPrepay: Math.max(0, totalNoPrepay - totalWithPrepayInterest),
  };
}

/** Debt stress: payment coverage and pressure (0–100, higher = more stress). */
export function debtStressScore(
  totalMonthlyDebtPayments: number,
  grossMonthlyIncome: number,
  liquidAssets: number
): { score: number; label: string; paymentToIncomeRatio: number } {
  const paymentToIncomeRatio = grossMonthlyIncome > 0 ? totalMonthlyDebtPayments / grossMonthlyIncome : 1;
  let score = Math.min(100, Math.round(paymentToIncomeRatio * 100));
  if (liquidAssets < totalMonthlyDebtPayments * 3) score = Math.min(100, score + 15);
  const label = score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low';
  return { score, label, paymentToIncomeRatio };
}
