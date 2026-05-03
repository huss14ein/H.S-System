import { financialMonthKey } from '../utils/financialMonth';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';
import { budgetTransactionAmountSar } from './smartFillBudgetHistory';

export interface BudgetAdjustmentSpendRow {
    totalSar: number;
    /** Distinct financial months (1–12 in `currentYear`) that contributed spend, through `currentMonth` inclusive. */
    monthIds: Set<number>;
}

function monthKeyId(year: number, month1to12: number): number {
    return year * 100 + month1to12;
}

/**
 * Approved expense totals in SAR by budget category, Jan–`currentMonth` of `currentYear` (financial months),
 * aligned with budget cards (allocations, splits, FX). Excludes financial months after `currentMonth` in that year.
 */
export function aggregateSpendThroughMonthByBudgetCategorySar(
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
    args: {
        currentYear: number;
        currentMonth: number;
        monthStartDay: unknown;
        sarPerUsd: number;
        accountCurrencyById: Map<string, 'SAR' | 'USD'>;
        /** Ignore transactions dated after this (local end-of-day). */
        refNow?: Date;
    },
): Map<string, BudgetAdjustmentSpendRow> {
    const { currentYear, currentMonth, monthStartDay, sarPerUsd, accountCurrencyById } = args;
    const cap = args.refNow ? new Date(args.refNow.getTime()) : new Date();
    cap.setHours(23, 59, 59, 999);

    const out = new Map<string, BudgetAdjustmentSpendRow>();
    const bump = (category: string, amountSar: number, fkYear: number, fkMonth: number) => {
        const cat = String(category ?? '').trim();
        if (!cat || !(amountSar > 0)) return;
        if (fkYear !== currentYear || fkMonth > currentMonth) return;
        let row = out.get(cat);
        if (!row) {
            row = { totalSar: 0, monthIds: new Set<number>() };
            out.set(cat, row);
        }
        row.totalSar += amountSar;
        row.monthIds.add(monthKeyId(fkYear, fkMonth));
    };

    personalTransactions
        .filter((t) => countsAsExpenseForCashflowKpi(t as any) && ((t as { status?: string }).status ?? 'Approved') === 'Approved')
        .forEach((t) => {
            const row = t as { date: string };
            const d = new Date(row.date);
            if (Number.isNaN(d.getTime()) || d.getTime() > cap.getTime()) return;
            const fk = financialMonthKey(d, monthStartDay);
            const allocations = getTransactionBudgetAllocations(t as any);
            allocations.forEach((allocation) => {
                bump(
                    allocation.category,
                    budgetTransactionAmountSar({ ...(t as any), amount: allocation.amount }, sarPerUsd, accountCurrencyById),
                    fk.year,
                    fk.month,
                );
            });
        });

    ownerSharedTransactions.forEach((tx) => {
        if ((tx.status ?? 'Approved') !== 'Approved') return;
        const d = new Date(tx.transaction_date || tx.date || '');
        if (Number.isNaN(d.getTime()) || d.getTime() > cap.getTime()) return;
        const fk = financialMonthKey(d, monthStartDay);
        const cat = String(tx.budget_category || '').trim();
        bump(cat, budgetTransactionAmountSar(tx as any, sarPerUsd, accountCurrencyById), fk.year, fk.month);
    });

    return out;
}

/** Distinct month count for averaging (financial months in-window). */
export function distinctMonthCount(row: BudgetAdjustmentSpendRow | undefined): number {
    if (!row) return 0;
    return Math.max(0, row.monthIds.size);
}
