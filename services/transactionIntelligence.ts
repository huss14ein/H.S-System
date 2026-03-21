import type { Transaction } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi, isInternalTransferTransaction } from './transactionFilters';

/** Normalize merchant from bank-style descriptions. */
export function normalizeMerchant(description: string): string {
  const d = (description || '').trim();
  if (!d) return 'Unknown';
  let s = d.replace(/\s+/g, ' ');
  s = s.replace(/^(POS|PURCHASE|DEBIT|CARD\*?|VISA|MC)\s*/i, '');
  s = s.replace(/\s*#\d+.*$/i, '');
  s = s.replace(/\d{2}\/\d{2}\s*$/, '').trim();
  const words = s.split(/\s+/).slice(0, 4);
  return words.join(' ') || 'Unknown';
}

export function spendByMerchant(
  transactions: Transaction[],
  opts?: { months?: number }
): { merchant: string; total: number }[] {
  const months = opts?.months ?? 6;
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const map = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t)) return;
    if (new Date(t.date) < start) return;
    const m = normalizeMerchant(t.description);
    map.set(m, (map.get(m) || 0) + Math.abs(Number(t.amount) || 0));
  });
  return [...map.entries()]
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a, b) => b.total - a.total);
}

export interface SalaryDetection {
  detected: boolean;
  estimatedMonthly: number;
  label: string;
  confidence: 'low' | 'medium' | 'high';
}

export function detectSalaryIncome(transactions: Transaction[], monthsLookback = 6): SalaryDetection {
  const start = new Date();
  start.setMonth(start.getMonth() - monthsLookback);
  const income = transactions.filter(
    (t) => t.type === 'income' && !isInternalTransferTransaction(t) && new Date(t.date) >= start
  );
  const byMonth = new Map<string, number[]>();
  income.forEach((t) => {
    const d = new Date(t.date);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    const arr = byMonth.get(k) || [];
    arr.push(Math.abs(Number(t.amount) || 0));
    byMonth.set(k, arr);
  });
  const salaries: number[] = [];
  byMonth.forEach((amounts) => {
    const sorted = [...amounts].sort((a, b) => b - a);
    if (sorted[0] >= 2000) salaries.push(sorted[0]);
  });
  if (salaries.length < 2) {
    return { detected: false, estimatedMonthly: 0, label: 'Not enough recurring large credits', confidence: 'low' };
  }
  const avg = salaries.reduce((a, b) => a + b, 0) / salaries.length;
  const variance = salaries.reduce((s, x) => s + (x - avg) ** 2, 0) / salaries.length;
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
  const confidence = cv < 0.15 ? 'high' : cv < 0.35 ? 'medium' : 'low';
  return {
    detected: true,
    estimatedMonthly: Math.round(avg),
    label: `~${Math.round(avg).toLocaleString()}/mo from largest monthly credits`,
    confidence,
  };
}

const SUBSCRIPTION_KEYWORDS = /netflix|spotify|apple\.com|google|youtube|prime|disney|hulu|adobe|microsoft|dropbox|icloud|gym|fitness|subscription|saas|hosting|vpn/i;

export function tagSubscriptionLikeExpenses(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (t) => t.type === 'expense' && SUBSCRIPTION_KEYWORDS.test(t.description || '')
  );
}

export function subscriptionSpendMonthly(
  transactions: Transaction[],
  months = 3
): { monthlyEstimate: number; count: number } {
  const subs = tagSubscriptionLikeExpenses(transactions);
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const recent = subs.filter((t) => new Date(t.date) >= start);
  const total = recent.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  return { monthlyEstimate: months > 0 ? total / months : 0, count: recent.length };
}

export interface RefundPair {
  expenseId: string;
  incomeId: string;
  amount: number;
  daysApart: number;
}

export function findRefundPairs(transactions: Transaction[], windowDays = 14): RefundPair[] {
  const expenses = transactions.filter((t) => countsAsExpenseForCashflowKpi(t));
  const incomes = transactions.filter((t) => countsAsIncomeForCashflowKpi(t));
  const pairs: RefundPair[] = [];
  const used = new Set<string>();
  for (const e of expenses) {
    if (used.has(e.id)) continue;
    const ea = Math.abs(Number(e.amount) || 0);
    if (ea < 1) continue;
    for (const i of incomes) {
      if (used.has(i.id)) continue;
      const ia = Math.abs(Number(i.amount) || 0);
      if (Math.abs(ea - ia) > 0.5) continue;
      const de = new Date(e.date).getTime();
      const di = new Date(i.date).getTime();
      const days = Math.abs(di - de) / 86400000;
      if (days > windowDays) continue;
      const ed = (e.description || '').slice(0, 20).toLowerCase();
      const id = (i.description || '').slice(0, 20).toLowerCase();
      if (ed && id && !ed.includes('refund') && !id.includes('refund') && ed !== id) continue;
      pairs.push({ expenseId: e.id, incomeId: i.id, amount: ea, daysApart: days });
      used.add(i.id);
      used.add(e.id);
      break;
    }
  }
  return pairs.slice(0, 50);
}

/** BNPL: suggest marking liability when description matches. */
export function detectBnplMentions(transactions: Transaction[]): { description: string; date: string; amount: number }[] {
  const re = /tabby|tamara|klarna|afterpay|affirm|spotii|postpay/i;
  return transactions
    .filter((t) => countsAsExpenseForCashflowKpi(t) && re.test(t.description || ''))
    .slice(0, 20)
    .map((t) => ({
      description: t.description,
      date: t.date,
      amount: Math.abs(Number(t.amount) || 0),
    }));
}

export interface SplitLine {
  category: string;
  amount: number;
}

/** Validate split lines sum to parent expense amount. */
export function validateSplitTotal(parentAmount: number, lines: SplitLine[]): { ok: boolean; message: string } {
  const sum = lines.reduce((s, l) => s + Math.abs(l.amount), 0);
  const pa = Math.abs(parentAmount);
  if (Math.abs(sum - pa) < 0.01) return { ok: true, message: '' };
  return { ok: false, message: `Split total ${sum.toFixed(2)} ≠ transaction ${pa.toFixed(2)}` };
}
