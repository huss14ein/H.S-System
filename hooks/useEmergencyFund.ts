import { useMemo } from 'react';
import type { FinancialData, Account, Transaction, Budget } from '../types';
import { getPersonalWealthData } from '../utils/wealthScope';

/** Recommended months of expenses to hold as emergency cash (3–6 is common; 6 is conservative). */
export const EMERGENCY_FUND_TARGET_MONTHS = 6;

/** Budget categories treated as essential for emergency fund calculation. */
const CORE_BUDGET_CATEGORIES = ['Food', 'Housing', 'Utilities', 'Transportation', 'Health', 'Insurance', 'Savings & Investments'];

export interface EmergencyFundMetrics {
    /** Liquid cash: Checking + Savings (positive balances only). */
    emergencyCash: number;
    /** Estimated monthly core/essential expenses (SAR). */
    monthlyCoreExpenses: number;
    /** How many months current cash covers. */
    monthsCovered: number;
    /** Target months (e.g. 6). */
    targetMonths: number;
    /** Status for UI. */
    status: 'healthy' | 'adequate' | 'low' | 'critical';
    /** Shortfall to reach target (0 if already at or above target). */
    shortfall: number;
    /** Amount needed to reach target (shortfall = targetAmount - emergencyCash). */
    targetAmount: number;
}

/**
 * Computes emergency fund metrics from financial data.
 * Uses: (1) rolling 6‑month average of core expenses from transactions, or
 *       (2) sum of current month budgets for essential categories if no core transactions.
 * Liquid cash = Checking + Savings (positive only).
 */
export function computeEmergencyFundMetrics(data: FinancialData | null | undefined): EmergencyFundMetrics {
    const defaultResult: EmergencyFundMetrics = {
        emergencyCash: 0,
        monthlyCoreExpenses: 0,
        monthsCovered: 0,
        targetMonths: EMERGENCY_FUND_TARGET_MONTHS,
        status: 'critical',
        shortfall: 0,
        targetAmount: 0,
    };

    if (!data) return defaultResult;
    const { personalAccounts, personalTransactions } = getPersonalWealthData(data);
    if (!personalAccounts.length) return defaultResult;
    const accounts = personalAccounts as Account[];
    const transactions = personalTransactions as Transaction[];
    const budgets = (data.budgets ?? []) as Budget[];

    const emergencyCash = accounts
        .filter(a => a.type === 'Checking' || a.type === 'Savings')
        .reduce((sum, a) => sum + Math.max(0, a.balance ?? 0), 0);

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const coreExpenseTx = transactions.filter(
        t => t.type === 'expense' && (t.expenseType === 'Core' || (t as Transaction & { budgetCategory?: string }).budgetCategory && CORE_BUDGET_CATEGORIES.includes((t as Transaction & { budgetCategory: string }).budgetCategory))
    );
    const byMonth = new Map<string, number>();
    coreExpenseTx.forEach(t => {
        const d = new Date(t.date);
        if (d >= sixMonthsAgo) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(t.amount));
        }
    });

    let monthlyCoreExpenses: number;
    if (byMonth.size > 0) {
        monthlyCoreExpenses = Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size;
    } else {
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const monthBudgets = budgets.filter(b => b.month === currentMonth && b.year === currentYear);
        const essentialSum = monthBudgets
            .filter(b => CORE_BUDGET_CATEGORIES.includes(b.category ?? ''))
            .reduce((sum, b) => sum + (b.limit ?? 0), 0);
        if (essentialSum > 0) {
            monthlyCoreExpenses = essentialSum;
        } else {
            const allExpenses = transactions.filter(t => t.type === 'expense' && new Date(t.date) >= sixMonthsAgo);
            const allByMonth = new Map<string, number>();
            allExpenses.forEach(t => {
                const key = t.date.slice(0, 7);
                allByMonth.set(key, (allByMonth.get(key) ?? 0) + Math.abs(t.amount));
            });
            monthlyCoreExpenses = allByMonth.size > 0
                ? Array.from(allByMonth.values()).reduce((a, b) => a + b, 0) / allByMonth.size
                : 0;
        }
    }

    const targetMonths = EMERGENCY_FUND_TARGET_MONTHS;
    const monthsCovered = monthlyCoreExpenses > 0 ? emergencyCash / monthlyCoreExpenses : (emergencyCash > 0 ? 99 : 0);
    const targetAmount = monthlyCoreExpenses * targetMonths;
    const shortfall = Math.max(0, targetAmount - emergencyCash);

    let status: EmergencyFundMetrics['status'] = 'critical';
    if (monthsCovered >= targetMonths) status = 'healthy';
    else if (monthsCovered >= 3) status = 'adequate';
    else if (monthsCovered >= 1) status = 'low';

    return {
        emergencyCash,
        monthlyCoreExpenses,
        monthsCovered,
        targetMonths,
        status,
        shortfall,
        targetAmount,
    };
}

/**
 * Hook: returns emergency fund metrics from DataContext-style data.
 * Use across Dashboard, Summary, Accounts, Goals, and Forecast for consistent emergency cash handling.
 */
export function useEmergencyFund(data: FinancialData | null | undefined): EmergencyFundMetrics {
    return useMemo(() => computeEmergencyFundMetrics(data), [data]);
}
