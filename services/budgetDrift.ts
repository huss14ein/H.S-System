import type { FinancialData } from '../types';
import { resolveMonthStartDayFromData, financialMonthKeysEndingAt, financialMonthRangeFromKey } from '../utils/financialMonth';
import { getPersonalTransactions } from '../utils/wealthScope';

export type BudgetDriftRow = {
  category: string;
  baselineSar: number;
  currentSar: number;
  driftPct: number;
};

/** Rolling 3-financial-month average vs current month spend by budget category. */
export function detectBudgetDrift(
  data: FinancialData,
  _exchangeRate: number,
  ref = new Date(),
): BudgetDriftRow[] {
  const msd = resolveMonthStartDayFromData(data);
  const keys = financialMonthKeysEndingAt(ref, 4, msd);
  const currentKey = keys[keys.length - 1]!;
  const baselineKeys = keys.slice(0, 3);
  const txs = getPersonalTransactions(data);
  const sumByCat = (key: typeof currentKey) => {
    const { start, end } = financialMonthRangeFromKey(key, msd);
    const m = new Map<string, number>();
    for (const t of txs) {
      if (t.type !== 'expense') continue;
      const d = new Date(t.date);
      if (d < start || d > end) continue;
      const cat = String(t.budgetCategory ?? t.category ?? 'Other');
      m.set(cat, (m.get(cat) ?? 0) + Math.abs(Number(t.amount) || 0));
    }
    return m;
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
