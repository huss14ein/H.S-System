/**
 * Unified budget drift — same SAR + cashflow rules as expenseBudgetAnalysisModel.
 */
import type { Account, FinancialData } from '../types';
import {
  financialMonthKeysEndingAt,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { aggregatePersonalBudgetCategorySpendSar } from './budgetSpendMath';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';

export type BudgetDriftRow = {
  category: string;
  baselineSar: number;
  currentSar: number;
  driftPct: number;
};

/** Rolling 3-financial-month average vs current month spend by budget category (SAR, approved expenses). */
export function detectBudgetDrift(
  data: FinancialData,
  exchangeRate: number,
  ref = new Date(),
): BudgetDriftRow[] {
  const msd = resolveMonthStartDayFromData(data);
  const keys = financialMonthKeysEndingAt(ref, 4, msd);
  const currentKey = keys[keys.length - 1]!;
  const baselineKeys = keys.slice(0, 3);
  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data) as Account[];
  const accountCurrencyById = new Map(
    accounts.map((a) => [String(a.id), (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD']),
  );

  const sumByCat = (key: (typeof keys)[number]) => {
    const { start, end } = financialMonthRangeFromKey(key, msd);
    return aggregatePersonalBudgetCategorySpendSar(
      transactions,
      start,
      end,
      accountCurrencyById,
      data,
      exchangeRate,
    );
  };

  const current = sumByCat(currentKey);
  const baselineTotals = new Map<string, number[]>();
  for (const k of baselineKeys) {
    for (const [cat, v] of sumByCat(k)) {
      const arr = baselineTotals.get(cat) ?? [];
      arr.push(v);
      baselineTotals.set(cat, arr);
    }
  }

  const rows: BudgetDriftRow[] = [];
  for (const [cat, cur] of current) {
    const hist = baselineTotals.get(cat) ?? [];
    const baseline = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    if (baseline <= 0) continue;
    const driftPct = ((cur - baseline) / baseline) * 100;
    if (Math.abs(driftPct) >= 15) {
      rows.push({ category: cat, baselineSar: baseline, currentSar: cur, driftPct });
    }
  }
  return rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}
