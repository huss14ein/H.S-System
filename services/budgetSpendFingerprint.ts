import { countsAsExpenseForCashflowKpi } from './transactionFilters';

type SpendWindowKeys = {
  rangeStart: string | Date;
  rangeEnd: string | Date;
  previousRangeStart: string | Date;
  previousRangeEnd: string | Date;
  ytdStart?: string | Date | null;
  ytdEnd?: string | Date | null;
};

function windowDateKey(d: string | Date | null | undefined): string {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

/** Stable key for budget spend recompute — avoids rebuilding cards when unrelated `data` fields change. */
export function buildBudgetSpendFingerprint(
  transactions: Array<{ date?: string; amount?: number; type?: string; status?: string }> | undefined,
  windows: SpendWindowKeys,
  extras?: {
    budgetCount?: number;
    budgetLimitSum?: number;
    requestPendingCount?: number;
    installmentCount?: number;
    sharedTxCount?: number;
  },
): string {
  let count = 0;
  let sumCents = 0;
  let maxDate = '';
  for (const t of transactions ?? []) {
    if (!countsAsExpenseForCashflowKpi(t)) continue;
    if ((t.status ?? 'Approved') !== 'Approved') continue;
    count += 1;
    sumCents += Math.round(Math.abs(Number(t.amount) || 0) * 100);
    const d = String(t.date ?? '');
    if (d > maxDate) maxDate = d;
  }
  const w = windows;
  return [
    count,
    maxDate,
    sumCents,
    windowDateKey(w.rangeStart),
    windowDateKey(w.rangeEnd),
    windowDateKey(w.previousRangeStart),
    windowDateKey(w.previousRangeEnd),
    windowDateKey(w.ytdStart),
    windowDateKey(w.ytdEnd),
    extras?.budgetCount ?? 0,
    Math.round(extras?.budgetLimitSum ?? 0),
    extras?.requestPendingCount ?? 0,
    extras?.installmentCount ?? 0,
    extras?.sharedTxCount ?? 0,
  ].join('|');
}

/** Notification rules that only need budget/goal/tx summaries — not full data object identity. */
export function buildNotificationsDataFingerprint(data: {
  budgets?: Array<{ limit?: number; spent?: number; used?: number }>;
  goals?: Array<{ id?: string; deadline?: string; targetDate?: string; target_date?: string }>;
  transactions?: unknown[];
  budgetRequests?: Array<{ id?: string; status?: string }>;
  settings?: { budgetThreshold?: number };
  investmentPlan?: { monthlyBudget?: number };
  plannedTrades?: unknown[];
  executionLogs?: unknown[];
} | null | undefined): string {
  if (!data) return 'empty';
  const budgets = data.budgets ?? [];
  const goals = data.goals ?? [];
  const txs = data.transactions ?? [];
  const budgetSum = budgets.reduce((s, b) => s + (Number(b.limit) || 0), 0);
  let budgetSpendPctCents = 0;
  for (const b of budgets) {
    const spent = Number(b.spent ?? b.used ?? 0);
    const limit = Number(b.limit ?? 0);
    if (limit > 0) budgetSpendPctCents += Math.round((spent / limit) * 10000);
  }
  const goalIds = goals.map((g) => String(g.id ?? '')).sort().join(',');
  const now = Date.now();
  let nearestGoalDays = 9999;
  for (const g of goals) {
    const raw = g.deadline ?? g.targetDate ?? g.target_date;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const days = Math.ceil((d.getTime() - now) / 86400000);
    if (days >= 0 && days < nearestGoalDays) nearestGoalDays = days;
  }
  const requests = data.budgetRequests ?? [];
  const requestStatusKey = requests
    .map((r) => `${r.id ?? ''}:${r.status ?? ''}`)
    .sort()
    .join(',')
    .slice(0, 300);
  return [
    budgets.length,
    Math.round(budgetSum),
    budgetSpendPctCents,
    goals.length,
    goalIds.slice(0, 200),
    nearestGoalDays === 9999 ? '' : nearestGoalDays,
    txs.length,
    data.settings?.budgetThreshold ?? 90,
    Number((data.investmentPlan as { monthlyBudget?: number } | undefined)?.monthlyBudget ?? 0),
    (data.plannedTrades ?? []).length,
    (data.executionLogs ?? []).length,
    requests.length,
    requestStatusKey,
  ].join('|');
}
