import type { Account, Transaction } from '../types';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';

export function transactionApprovalStatus(t: Pick<Transaction, 'status'>): 'Approved' | 'Pending' | 'Rejected' {
  const s = String(t.status ?? 'Approved').trim().toLowerCase();
  if (s === 'pending') return 'Pending';
  if (s === 'rejected') return 'Rejected';
  return 'Approved';
}

export function expenseGroupLabel(t: Pick<Transaction, 'budgetCategory' | 'category'>): string {
  const raw = String(t.budgetCategory ?? t.category ?? '').trim();
  return raw || 'Uncategorized';
}

export function cashTransactionAmountSar(args: {
  tx: Pick<Transaction, 'amount' | 'accountId'>;
  accountsById: Map<string, Pick<Account, 'currency'>>;
  sarPerUsd: number;
}): number {
  const { tx, accountsById } = args;
  const acc = accountsById.get(String(tx.accountId ?? ''));
  const cur = acc?.currency === 'USD' ? 'USD' : 'SAR';
  return toSAR(Number(tx.amount) || 0, cur, args.sarPerUsd);
}

export function computeMonthlyCashflowKpisSar(args: {
  data: { wealthUltraConfig?: { fxRate?: number | null } | null } | null | undefined;
  uiSarPerUsd?: number;
  accounts: Account[];
  transactions: Transaction[];
}): {
  sarPerUsd: number;
  incomeSar: number;
  expenseSar: number;
  netSar: number;
  expenseBreakdown: Array<{ name: string; value: number }>;
} {
  const sarPerUsd = resolveSarPerUsd(args.data, args.uiSarPerUsd);
  const accountsById = new Map<string, Pick<Account, 'currency'>>(args.accounts.map((a) => [a.id, { currency: a.currency }]));
  const approved = (args.transactions ?? []).filter((t) => transactionApprovalStatus(t) === 'Approved');
  const incomeSar = approved
    .filter((t) => countsAsIncomeForCashflowKpi(t))
    .reduce((s, t) => s + Math.abs(cashTransactionAmountSar({ tx: t, accountsById, sarPerUsd })), 0);
  const expenseSar = approved
    .filter((t) => countsAsExpenseForCashflowKpi(t))
    .reduce((s, t) => s + Math.abs(cashTransactionAmountSar({ tx: t, accountsById, sarPerUsd })), 0);

  const spending = new Map<string, number>();
  approved
    .filter((t) => countsAsExpenseForCashflowKpi(t))
    .forEach((t) => {
      const key = expenseGroupLabel(t);
      spending.set(key, (spending.get(key) || 0) + Math.abs(cashTransactionAmountSar({ tx: t, accountsById, sarPerUsd })));
    });

  const expenseBreakdown = Array.from(spending, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  return { sarPerUsd, incomeSar, expenseSar, netSar: incomeSar - expenseSar, expenseBreakdown };
}

