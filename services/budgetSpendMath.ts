import type { FinancialData, Transaction } from '../types';
import { getSarPerUsdForCalendarDay } from './fxDailySeries';
import { toSAR } from '../utils/currencyMath';
import { calendarDayStartMs } from '../utils/financialMonth';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';

/** Inclusive calendar-day range check (avoids UTC shift on `YYYY-MM-DD` strings). */
export function transactionDateInSpendWindow(
  dateInput: string | Date | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const ms = calendarDayStartMs(dateInput ?? '');
  if (!Number.isFinite(ms)) return false;
  return ms >= rangeStart.getTime() && ms <= rangeEnd.getTime();
}

/**
 * Approved expense amount in SAR for budget cards — transaction-dated FX when a calendar day is known.
 */
export function expenseAmountSarForBudget(
  tx: {
    amount?: number;
    currency?: string;
    date?: string;
    accountId?: string;
    account_id?: string;
  },
  accountCurrencyById: Map<string, 'SAR' | 'USD'>,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): number {
  const raw = Math.abs(Number(tx?.amount) || 0);
  if (!(raw > 0)) return 0;
  const txCur = tx?.currency === 'USD' ? 'USD' : tx?.currency === 'SAR' ? 'SAR' : undefined;
  const accId = String(tx?.accountId ?? tx?.account_id ?? '');
  const fallbackCur = accountCurrencyById.get(accId) ?? 'SAR';
  const cur = txCur ?? fallbackCur;
  const day = String(tx?.date ?? '').slice(0, 10);
  const rate =
    day.length === 10 && data
      ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate)
      : uiExchangeRate;
  return toSAR(raw, cur, rate);
}

/**
 * Personal-scope budget category spend in SAR for a date window — same rules as Budgets page cards
 * (approved expenses, split allocations, transaction-dated FX).
 */
export function aggregatePersonalBudgetCategorySpendSar(
  transactions: Transaction[],
  rangeStart: Date,
  rangeEnd: Date,
  accountCurrencyById: Map<string, 'SAR' | 'USD'>,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): Map<string, number> {
  const spending = new Map<string, number>();
  for (const t of transactions ?? []) {
    if (!countsAsExpenseForCashflowKpi(t) || (t.status ?? 'Approved') !== 'Approved') continue;
    const allocations = getTransactionBudgetAllocations(t);
    for (const allocation of allocations) {
      if (!transactionDateInSpendWindow(t.date, rangeStart, rangeEnd)) continue;
      const amount = expenseAmountSarForBudget(
        { ...t, amount: allocation.amount },
        accountCurrencyById,
        data,
        uiExchangeRate,
      );
      if (!(amount > 0)) continue;
      const cat = String(allocation.category ?? '').trim() || 'Other';
      spending.set(cat, (spending.get(cat) ?? 0) + amount);
    }
  }
  return spending;
}
