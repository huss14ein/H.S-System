import { addMonthsToKey, financialMonthRangeFromKey } from '../utils/financialMonth';
import { toSAR } from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';

export interface SmartFillFinancialMonthSegment {
    start: Date;
    end: Date;
}

/**
 * Last three financial months ending at the budget view month (inclusive).
 * Each segment's end is capped to `refNow` so partial current real-time month matches budget cards.
 */
export function buildSmartFillThreeFinancialMonthSegments(
    viewYear: number,
    viewMonth: number,
    monthStartDay: unknown,
    refNow: Date = new Date(),
): SmartFillFinancialMonthSegment[] {
    const base: { year: number; month: number } = { year: viewYear, month: viewMonth };
    const keys = [addMonthsToKey(base, -2), addMonthsToKey(base, -1), base];
    const cap = new Date(refNow.getTime());
    cap.setHours(23, 59, 59, 999);

    return keys
        .map((key) => {
            let { start, end } = financialMonthRangeFromKey(key, monthStartDay);
            if (end.getTime() > cap.getTime()) end = cap;
            return { start, end };
        })
        .filter((s) => s.start.getTime() <= s.end.getTime());
}

/** Same SAR rules as Budgets cards (`txAmountSar`). */
export function budgetTransactionAmountSar(
    tx: { amount?: number; currency?: string; accountId?: string; account_id?: string },
    sarPerUsd: number,
    accountCurrencyById: Map<string, 'SAR' | 'USD'>,
): number {
    const raw = Math.abs(Number(tx?.amount) || 0);
    if (!(raw > 0)) return 0;
    const txCur = tx?.currency === 'USD' ? 'USD' : tx?.currency === 'SAR' ? 'SAR' : undefined;
    const accId = String(tx?.accountId ?? (tx as { account_id?: string }).account_id ?? '');
    const fallbackCur = accountCurrencyById.get(accId) ?? 'SAR';
    return toSAR(raw, txCur ?? fallbackCur, sarPerUsd);
}

function dateInAnySegment(d: Date, segments: SmartFillFinancialMonthSegment[]): boolean {
    return segments.some(({ start, end }) => d >= start && d <= end);
}

/** Total SAR spend per budget category across the given window (sums all matching segments). */
export function aggregateSmartFillSpendByCategorySar(
    segments: SmartFillFinancialMonthSegment[],
    personalTransactions: Array<Record<string, unknown>>,
    ownerSharedTransactions: Array<{
        status?: string;
        transaction_date?: string;
        date?: string;
        budget_category?: string;
        amount?: number;
        currency?: string;
        accountId?: string;
        account_id?: string;
    }>,
    sarPerUsd: number,
    accountCurrencyById: Map<string, 'SAR' | 'USD'>,
): Map<string, number> {
    const totals = new Map<string, number>();
    const add = (category: string, amountSar: number) => {
        const cat = String(category ?? '').trim();
        if (!cat || !(amountSar > 0)) return;
        totals.set(cat, (totals.get(cat) || 0) + amountSar);
    };

    personalTransactions
        .filter((t) => countsAsExpenseForCashflowKpi(t as any) && ((t as { status?: string }).status ?? 'Approved') === 'Approved')
        .forEach((t) => {
            const row = t as { date: string };
            const d = new Date(row.date);
            if (!dateInAnySegment(d, segments)) return;
            const allocations = getTransactionBudgetAllocations(t as any);
            allocations.forEach((allocation) => {
                add(allocation.category, budgetTransactionAmountSar({ ...(t as any), amount: allocation.amount }, sarPerUsd, accountCurrencyById));
            });
        });

    ownerSharedTransactions.forEach((tx) => {
        if ((tx.status ?? 'Approved') !== 'Approved') return;
        const d = new Date(tx.transaction_date || tx.date || '');
        if (Number.isNaN(d.getTime()) || !dateInAnySegment(d, segments)) return;
        const cat = String(tx.budget_category || '').trim();
        add(cat, budgetTransactionAmountSar(tx as any, sarPerUsd, accountCurrencyById));
    });

    return totals;
}

export function monthlySuggestionsFromCategoryTotals(
    totals: Map<string, number>,
    segmentCount: number,
): { category: string; monthly: number }[] {
    const divisor = Math.max(1, segmentCount);
    const out: { category: string; monthly: number }[] = [];
    totals.forEach((total, category) => {
        const monthly = Math.round(total / divisor);
        if (monthly > 0) out.push({ category, monthly });
    });
    return out;
}
