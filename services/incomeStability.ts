import { countsAsIncomeForCashflowKpi } from './transactionFilters';
import { financialMonthKeysEndingAt, financialMonthRangeFromKey, resolveMonthStartDayFromData } from '../utils/financialMonth';
import type { FinancialData } from '../types';
import { getPersonalTransactions } from '../utils/wealthScope';

export type IncomeStabilityResult = {
  score: number;
  label: 'stable' | 'moderate' | 'volatile';
  monthlyTotals: { key: string; amount: number }[];
  cvPct: number;
};

export function computeIncomeStability(data: FinancialData, ref = new Date(), months = 6): IncomeStabilityResult {
  const msd = resolveMonthStartDayFromData(data);
  const keys = financialMonthKeysEndingAt(ref, months, msd);
  const txs = getPersonalTransactions(data);
  const monthlyTotals = keys.map((key) => {
    const { start, end } = financialMonthRangeFromKey(key, msd);
    let amount = 0;
    for (const t of txs) {
      if (!countsAsIncomeForCashflowKpi(t)) continue;
      const d = new Date(t.date);
      if (d >= start && d <= end) amount += Number(t.amount) || 0;
    }
    return { key: `${key.year}-${String(key.month).padStart(2, '0')}`, amount };
  });
  const vals = monthlyTotals.map((m) => m.amount).filter((v) => v > 0);
  if (vals.length < 2) {
    return { score: 50, label: 'moderate', monthlyTotals, cvPct: 0 };
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);
  const cvPct = avg > 0 ? (std / avg) * 100 : 100;
  const score = Math.max(0, Math.min(100, Math.round(100 - cvPct)));
  const label = score >= 70 ? 'stable' : score >= 40 ? 'moderate' : 'volatile';
  return { score, label, monthlyTotals, cvPct };
}
