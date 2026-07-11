/**
 * Budget category slide-over — last 20 txs + MoM sparkline for Budgets cards.
 */
import type { Account, FinancialData, Transaction } from '../types';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';
import { expenseAmountSarForBudget } from './budgetSpendMath';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import { resolveMonthStartDayFromData, financialMonthRangeFromKey, financialMonthKey, addMonthsToKey, dateInRange, type FinancialMonthKey } from '../utils/financialMonth';

export type BudgetCategorySlideOverModel = {
  category: string;
  transactions: {
    id: string;
    date: string;
    description: string;
    amountSar: number;
    accountName: string;
  }[];
  momSparkline: { monthKey: string; spentSar: number }[];
  totalSpentSar: number;
};

export function buildBudgetCategorySlideOverModel(args: {
  data: FinancialData;
  category: string;
  exchangeRate: number;
  ref?: Date;
  month?: number;
  year?: number;
}): BudgetCategorySlideOverModel {
  const ref = args.ref ?? new Date();
  const monthStartDay = resolveMonthStartDayFromData(args.data);
  const finKey: FinancialMonthKey =
    args.month != null && args.year != null
      ? { year: args.year, month: args.month }
      : financialMonthKey(ref, monthStartDay);
  const range = financialMonthRangeFromKey(finKey, monthStartDay);
  const accounts = getPersonalAccounts(args.data) as Account[];
  const accountCurrencyById = new Map(
    accounts.map((a) => [String(a.id), (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD']),
  );
  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name || 'Account']));
  const txs = getPersonalTransactions(args.data) as Transaction[];

  const inCategory = (t: Transaction, cat: string) =>
    getTransactionBudgetAllocations(t).some((a) => a.category === cat);

  const periodTxsAll = txs
    .filter(
      (t) =>
        t.type === 'expense' &&
        (t.status ?? 'Approved') === 'Approved' &&
        String(t.date).slice(0, 10) >= range.start.toISOString().slice(0, 10) &&
        String(t.date).slice(0, 10) <= range.end.toISOString().slice(0, 10) &&
        inCategory(t, args.category),
    )
    .map((t) => ({
      id: t.id,
      date: String(t.date).slice(0, 10),
      description: t.description || '—',
      amountSar: expenseAmountSarForBudget(t, accountCurrencyById, args.data, args.exchangeRate),
      accountName: accountNameById.get(String(t.accountId)) ?? '—',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amountSar - a.amountSar);

  const periodTxs = periodTxsAll.slice(0, 20);

  const momSparkline: { monthKey: string; spentSar: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const key = addMonthsToKey(finKey, -i);
    const keyLabel = `${key.year}-${String(key.month).padStart(2, '0')}`;
    const r = financialMonthRangeFromKey(key, monthStartDay);
    let spent = 0;
    for (const t of txs) {
      if (
        t.type !== 'expense' ||
        (t.status ?? 'Approved') !== 'Approved' ||
        !inCategory(t, args.category)
      )
        continue;
      if (!dateInRange(t.date, r.start, r.end)) continue;
      spent += expenseAmountSarForBudget(t, accountCurrencyById, args.data, args.exchangeRate);
    }
    momSparkline.push({ monthKey: keyLabel, spentSar: spent });
  }

  return {
    category: args.category,
    transactions: periodTxs,
    momSparkline,
    totalSpentSar: periodTxsAll.reduce((s, t) => s + t.amountSar, 0),
  };
}
