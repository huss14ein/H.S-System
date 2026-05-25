import type { Transaction } from '../types';
import { countsAsIncomeForCashflowKpi } from './transactionFilters';

export type IncomeTaxonomyLabel =
  | 'salary'
  | 'bonus'
  | 'dividend'
  | 'interest'
  | 'rental'
  | 'business'
  | 'refund'
  | 'other';

const LABEL_HINTS: Record<IncomeTaxonomyLabel, string[]> = {
  salary: ['salary', 'payroll', 'wage', 'راتب'],
  bonus: ['bonus', 'incentive', 'مكافأة'],
  dividend: ['dividend', 'توزيع'],
  interest: ['interest', 'فائدة'],
  rental: ['rent', 'rental', 'إيجار'],
  business: ['business', 'consult', 'freelance', 'عمولة'],
  refund: ['refund', 'reimburse', 'استرداد'],
  other: [],
};

export function classifyIncomeTransaction(t: Transaction): IncomeTaxonomyLabel | null {
  if (!countsAsIncomeForCashflowKpi(t)) return null;
  const hay = `${t.description ?? ''} ${t.budgetCategory ?? ''} ${t.category ?? ''}`.toLowerCase();
  for (const [label, hints] of Object.entries(LABEL_HINTS) as [IncomeTaxonomyLabel, string[]][]) {
    if (label === 'other') continue;
    if (hints.some((h) => hay.includes(h))) return label;
  }
  return 'other';
}

export function summarizeIncomeTaxonomy(
  transactions: Transaction[],
): { label: IncomeTaxonomyLabel; count: number; totalSar: number }[] {
  const m = new Map<IncomeTaxonomyLabel, { count: number; totalSar: number }>();
  for (const t of transactions) {
    const label = classifyIncomeTransaction(t);
    if (!label) continue;
    const cur = m.get(label) ?? { count: 0, totalSar: 0 };
    cur.count += 1;
    cur.totalSar += Math.abs(Number(t.amount) || 0);
    m.set(label, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.totalSar - a.totalSar);
}
