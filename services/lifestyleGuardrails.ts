import type { FinancialData, Transaction } from '../types';
import { getPersonalTransactions } from '../utils/wealthScope';

export type LifestyleGuardrailHit = {
  code: 'ef_incomplete' | 'low_savings' | 'discretionary_cap';
  message: string;
  severity: 'info' | 'warn' | 'block';
};

export function evaluateLifestyleGuardrails(input: {
  emergencyFundMonths: number;
  emergencyFundTargetMonths: number;
  savingsRate: number;
  transactions?: Transaction[];
  discretionaryCategories?: string[];
}): LifestyleGuardrailHit[] {
  const hits: LifestyleGuardrailHit[] = [];
  if (input.emergencyFundMonths < input.emergencyFundTargetMonths) {
    hits.push({
      code: 'ef_incomplete',
      severity: 'block',
      message: `Complete emergency fund first (${input.emergencyFundMonths.toFixed(1)} / ${input.emergencyFundTargetMonths} months).`,
    });
  }
  if (input.savingsRate < 0.05) {
    hits.push({
      code: 'low_savings',
      severity: 'warn',
      message: 'Savings rate below 5% — pause discretionary upgrades.',
    });
  }
  const disc = new Set((input.discretionaryCategories ?? ['Travel', 'Entertainment', 'Shopping', 'Luxury']).map((c) => c.toLowerCase()));
  const txs = input.transactions ?? [];
  const discSpend = txs
    .filter((t) => t.type === 'expense' && disc.has(String(t.budgetCategory ?? t.category ?? '').toLowerCase()))
    .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  if (discSpend > 0 && input.emergencyFundMonths < input.emergencyFundTargetMonths) {
    hits.push({
      code: 'discretionary_cap',
      severity: 'warn',
      message: `Discretionary spend (${Math.round(discSpend)} SAR) while EF incomplete.`,
    });
  }
  return hits;
}

export function evaluateLifestyleGuardrailsFromData(
  data: FinancialData,
  emergencyFundMonths: number,
  emergencyFundTargetMonths: number,
  savingsRate: number,
): LifestyleGuardrailHit[] {
  return evaluateLifestyleGuardrails({
    emergencyFundMonths,
    emergencyFundTargetMonths,
    savingsRate,
    transactions: getPersonalTransactions(data),
  });
}
