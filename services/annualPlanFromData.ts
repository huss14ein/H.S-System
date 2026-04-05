/**
 * Annual Financial Plan — single source of truth for planned vs actual rows.
 * All amounts are derived from DataContext-fed data (budgets, transactions, recurring, investment plan, household profile).
 * Do not duplicate this logic in pages; import `buildAnnualPlanRows` instead.
 */

import type {
  Account,
  Budget,
  FinancialData,
  InvestmentPlanSettings,
  InvestmentPortfolio,
  InvestmentTransaction,
  RecurringTransaction,
} from '../types';
import { getSarPerUsdForCalendarDay } from './fxDailySeries';
import { inferInvestmentTransactionCurrency, resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { toSAR } from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi, isInternalTransferTransaction } from './transactionFilters';
import type { HouseholdMonthlyOverride } from './householdBudgetEngine';

export type AnnualPlanRow = {
  type: 'income' | 'expense';
  category: string;
  monthly_planned: number[];
  monthly_actual: number[];
};

export type AnnualPlanIncomeMeta = {
  expectedMonthlySalary?: number;
  recurringIncomeMonthlySum: number;
  budgetIncomeMax: number;
  incomeAvg: number;
  suggestedMonthlySalary: number;
};

export type BuildAnnualPlanRowsInput = {
  year: number;
  budgets: Budget[];
  /** Personal-scope transactions (same as Plan page). */
  transactions: Array<{ date: string; type?: string; amount?: number; category?: string; budgetCategory?: string }>;
  recurringTransactions: RecurringTransaction[];
  investmentPlan: InvestmentPlanSettings | null | undefined;
  investmentTransactions: InvestmentTransaction[];
  accounts: Account[];
  investments: InvestmentPortfolio[];
  personalAccountIds: Set<string>;
  data: FinancialData | null | undefined;
  exchangeRate: number;
  sarPerUsd: number;
  expectedMonthlySalary: number | undefined;
  householdOverrides: HouseholdMonthlyOverride[];
};

/** Budget rows that represent planned income — not spending; excluded from expense aggregation. */
export function isIncomeLikeBudgetCategory(category: string): boolean {
  const c = String(category ?? '').trim().toLowerCase();
  if (!c) return false;
  return (
    c === 'salary' ||
    c === 'income' ||
    c === 'wages' ||
    c === 'pay' ||
    c === 'net income' ||
    c === 'gross income' ||
    c === 'compensation'
  );
}

function budgetToMonthly(limit: number, period?: string): number {
  return period === 'yearly' ? limit / 12 : period === 'weekly' ? limit * (52 / 12) : period === 'daily' ? limit * (365 / 12) : limit;
}

function normalizeCategory(cat: string): string {
  const c = String(cat ?? '').trim().toLowerCase();
  return c === 'transfers' ? 'Transfer' : cat;
}

/**
 * Planned income for a month when there is no posted actual: single priority chain (no double-counting).
 */
export function resolvePlannedIncomeForMonth(args: {
  monthIndex: number;
  incomeActuals: number[];
  overrideByMonth: Map<number, number>;
  expectedMonthlySalary: number | undefined;
  budgetIncomePlanned: number[];
  recurringIncomeMonthlySum: number;
  incomeAvg: number;
  suggestedMonthlySalary: number;
}): number {
  const m = args.monthIndex;
  const actual = args.incomeActuals[m] ?? 0;
  const ovr = args.overrideByMonth.get(m);
  if (ovr != null && ovr > 0) return ovr;
  if (actual > 0) return actual;
  if (typeof args.expectedMonthlySalary === 'number' && args.expectedMonthlySalary > 0) return args.expectedMonthlySalary;
  const budgetM = args.budgetIncomePlanned[m] ?? 0;
  if (budgetM > 0) return budgetM;
  if (args.recurringIncomeMonthlySum > 0) return args.recurringIncomeMonthlySum;
  if (args.incomeAvg > 0) return args.incomeAvg;
  if (args.suggestedMonthlySalary > 0) return args.suggestedMonthlySalary;
  return 0;
}

export function buildAnnualPlanRows(input: BuildAnnualPlanRowsInput): {
  rows: AnnualPlanRow[];
  incomeMeta: AnnualPlanIncomeMeta;
} {
  const {
    year,
    budgets,
    transactions,
    recurringTransactions,
    investmentPlan,
    investmentTransactions,
    accounts,
    investments,
    personalAccountIds,
    data,
    exchangeRate,
    sarPerUsd,
    expectedMonthlySalary,
    householdOverrides,
  } = input;

  const yearTx = transactions.filter((t) => new Date(t.date).getFullYear() === year);

  const planYearIncomeByMonth = Array(12).fill(0);
  yearTx.forEach((t) => {
    if (!countsAsIncomeForCashflowKpi(t)) return;
    const d = new Date((t as { date: string }).date);
    planYearIncomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
  });
  const planYearWithData = planYearIncomeByMonth.filter((v) => v > 0);
  let suggestedMonthlySalary =
    planYearWithData.length > 0 ? Math.round(planYearWithData.reduce((a, b) => a + b, 0) / planYearWithData.length) : 0;
  if (suggestedMonthlySalary === 0 && transactions.length > 0) {
    const anyYearIncome = Array(12).fill(0);
    transactions.forEach((t) => {
      if (!countsAsIncomeForCashflowKpi(t)) return;
      const d = new Date(t.date);
      anyYearIncome[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
    });
    const anyWithData = anyYearIncome.filter((v) => v > 0);
    suggestedMonthlySalary =
      anyWithData.length > 0 ? Math.round(anyWithData.reduce((a, b) => a + b, 0) / anyWithData.length) : 0;
  }

  const incomeActuals = Array(12).fill(0);
  yearTx.forEach((t) => {
    if (countsAsIncomeForCashflowKpi(t)) {
      const monthIndex = new Date(t.date).getMonth();
      incomeActuals[monthIndex] += Number(t.amount) || 0;
    }
  });
  const incomeTotal = incomeActuals.reduce((a, b) => a + b, 0);
  const incomeMonthsWithData = incomeActuals.filter((x) => x > 0).length;
  const incomeAvg = incomeMonthsWithData > 0 ? incomeTotal / incomeMonthsWithData : 0;

  const recurringIncomeMonthlySum = recurringTransactions
    .filter(
      (r) =>
        r.enabled &&
        r.type === 'income' &&
        !isInternalTransferTransaction({ category: r.budgetCategory || r.category }),
    )
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const overrideByMonth = new Map(
    (householdOverrides ?? []).map((o) => [((o.month ?? o.monthIndex ?? 1) - 1), Number(o.salary ?? 0)]),
  );

  const yearBudgets = budgets.filter((b) => !(b as { year?: number }).year || (b as { year?: number }).year === year);
  const byCategory = new Map<string, { planned: number[]; actual: number[] }>();

  const budgetIncomePlanned = Array(12).fill(0);
  yearBudgets.forEach((b) => {
    if (!isIncomeLikeBudgetCategory(b.category)) return;
    const limit = Number(b.limit) || 0;
    const period = (b as { period?: string }).period;
    const monthly = budgetToMonthly(limit, period);
    const monthIndex = ((b as { month?: number }).month ?? 1) - 1;
    const appliesAllYear = period === 'yearly' || period === 'weekly' || period === 'daily';
    if (appliesAllYear) {
      for (let m = 0; m < 12; m++) budgetIncomePlanned[m] += monthly;
    } else {
      budgetIncomePlanned[monthIndex] += monthly;
    }
  });

  const incomePlanned = Array.from({ length: 12 }, (_, m) =>
    resolvePlannedIncomeForMonth({
      monthIndex: m,
      incomeActuals,
      overrideByMonth,
      expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
      budgetIncomePlanned,
      recurringIncomeMonthlySum,
      incomeAvg,
      suggestedMonthlySalary,
    }),
  );

  const incomeRow: AnnualPlanRow = {
    type: 'income',
    category: 'Income',
    monthly_planned: incomePlanned,
    monthly_actual: incomeActuals,
  };

  const incomeMeta: AnnualPlanIncomeMeta = {
    expectedMonthlySalary: typeof expectedMonthlySalary === 'number' && expectedMonthlySalary > 0 ? expectedMonthlySalary : undefined,
    recurringIncomeMonthlySum,
    budgetIncomeMax: Math.max(...budgetIncomePlanned, 0),
    incomeAvg,
    suggestedMonthlySalary,
  };

  yearBudgets.forEach((b) => {
    if (isIncomeLikeBudgetCategory(b.category)) return;
    const limit = Number(b.limit) || 0;
    const period = (b as { period?: string }).period;
    const monthly = budgetToMonthly(limit, period);
    const monthIndex = ((b as { month?: number }).month ?? 1) - 1;
    const key = normalizeCategory(b.category);
    if (!byCategory.has(key)) {
      byCategory.set(key, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
    }
    const planned = byCategory.get(key)!.planned;
    const appliesAllYear = period === 'yearly' || period === 'weekly' || period === 'daily';
    if (appliesAllYear) {
      for (let mm = 0; mm < 12; mm++) planned[mm] += monthly;
    } else {
      planned[monthIndex] += monthly;
    }
  });

  yearTx.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t)) return;
    const monthIndex = new Date(t.date).getMonth();
    const raw = (t.budgetCategory || t.category || 'Other').trim() || 'Other';
    const category = normalizeCategory(raw);
    if (!byCategory.has(category)) {
      byCategory.set(category, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
    }
    byCategory.get(category)!.actual[monthIndex] += Math.abs(Number(t.amount)) || 0;
  });

  recurringTransactions
    .filter(
      (r) =>
        r.enabled &&
        r.type === 'expense' &&
        !isInternalTransferTransaction({ category: r.budgetCategory || r.category }),
    )
    .forEach((r) => {
      const raw = (r.budgetCategory || r.category || 'Other').trim() || 'Other';
      const cat = normalizeCategory(raw);
      if (!byCategory.has(cat)) byCategory.set(cat, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
      const row = byCategory.get(cat)!;
      const amt = Number(r.amount) || 0;
      for (let m = 0; m < 12; m++) row.planned[m] += amt;
    });

  const expenseRows: AnnualPlanRow[] = Array.from(byCategory.entries())
    .filter(([, { planned, actual }]) => planned.some((x) => x > 0) || actual.some((x) => x > 0))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, { planned, actual }]) => ({
      type: 'expense' as const,
      category,
      monthly_planned: planned.some((x) => x > 0) ? planned : Array(12).fill(0),
      monthly_actual: actual,
    }));

  const monthlyInvestment = Number(investmentPlan?.monthlyBudget) || 0;
  const investmentActuals = Array(12).fill(0);
  const invTxFiltered = investmentTransactions.filter((t) => {
    const aid = resolveInvestmentTransactionAccountId(
      t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
      accounts,
      investments as InvestmentPortfolio[],
    );
    return personalAccountIds.has(aid);
  });

  invTxFiltered.forEach((tx) => {
    const date = new Date(tx.date);
    if (date.getFullYear() === year && isInvestmentTransactionType(tx.type, 'buy')) {
      const cur = inferInvestmentTransactionCurrency(
        {
          accountId: tx.accountId,
          account_id: (tx as { account_id?: string }).account_id,
          portfolioId: tx.portfolioId,
          portfolio_id: (tx as { portfolio_id?: string }).portfolio_id,
          currency: tx.currency as 'SAR' | 'USD' | undefined,
        },
        accounts,
        investments as InvestmentPortfolio[],
      );
      const day = (tx.date ?? '').slice(0, 10);
      const dayRate = data && day.length === 10 ? getSarPerUsdForCalendarDay(day, data, exchangeRate) : sarPerUsd;
      investmentActuals[date.getMonth()] += toSAR(getInvestmentTransactionCashAmount(tx as any), cur, dayRate);
    }
  });

  const investmentRow: AnnualPlanRow = {
    type: 'expense',
    category: 'Monthly investment',
    monthly_planned: Array(12).fill(monthlyInvestment),
    monthly_actual: investmentActuals,
  };

  return {
    rows: [incomeRow, ...expenseRows, investmentRow],
    incomeMeta,
  };
}

export function formatAnnualPlanIncomeHint(
  meta: AnnualPlanIncomeMeta,
  fmt: (amount: number, options?: { digits?: number }) => string,
): string {
  const exStr = meta.expectedMonthlySalary != null && meta.expectedMonthlySalary > 0 ? fmt(meta.expectedMonthlySalary, { digits: 0 }) : '—';
  const recStr = meta.recurringIncomeMonthlySum > 0 ? fmt(meta.recurringIncomeMonthlySum, { digits: 0 }) : '—';
  const budStr = meta.budgetIncomeMax > 0 ? fmt(meta.budgetIncomeMax, { digits: 0 }) : '—';
  const yAvgStr = meta.incomeAvg > 0 ? fmt(Math.round(meta.incomeAvg), { digits: 0 }) : '—';
  const histStr = meta.suggestedMonthlySalary > 0 ? fmt(meta.suggestedMonthlySalary, { digits: 0 }) : '—';
  return `Planned income (bold row) when that month has no actual income: month salary override (set on Budgets → household / Salary & Planning Experts) → expected monthly salary (${exStr}) → income-type budgets max/month (${budStr}) → recurring income rules total (${recStr}) → this-year average from posted income (${yAvgStr}) → historical monthly average (${histStr}). Gray row = actual income from Transactions. This page does not edit ledger data—use Budgets, Transactions, and Investment Plan.`;
}
