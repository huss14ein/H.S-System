import type { Transaction } from '../types';
import { detectSalaryIncome } from './transactionIntelligence';
import { normalizedMonthlyExpense } from './financeMetrics';

/** Salary signal vs typical monthly spend (external expenses only). */
export function salaryToExpenseCoverage(transactions: Transaction[], monthsExpense = 6): {
  ratio: number | null;
  salaryMonthly: number;
  expenseMonthly: number;
  label: string;
  healthy: boolean | null;
} {
  const sal = detectSalaryIncome(transactions, 6);
  const exp = normalizedMonthlyExpense(transactions, { monthsLookback: monthsExpense });
  if (!sal.detected || exp <= 0) {
    return {
      ratio: null,
      salaryMonthly: sal.estimatedMonthly,
      expenseMonthly: exp,
      label: !sal.detected
        ? 'Salary pattern not detected (need recurring large credits).'
        : 'Add expense history to compare.',
      healthy: null,
    };
  }
  const ratio = sal.estimatedMonthly / exp;
  const healthy = ratio >= 1.05;
  return {
    ratio,
    salaryMonthly: sal.estimatedMonthly,
    expenseMonthly: exp,
    label: `${ratio.toFixed(2)}× (salary ~${Math.round(sal.estimatedMonthly).toLocaleString()} / mo vs ~${Math.round(exp).toLocaleString()} avg spend)`,
    healthy,
  };
}
