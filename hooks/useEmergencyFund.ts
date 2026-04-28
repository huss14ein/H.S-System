import { useMemo } from 'react';
import type { FinancialData, Account, Transaction, Budget } from '../types';
import { getPersonalWealthData } from '../utils/wealthScope';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { brokerCashBucketsFromInvestmentAccount } from '../services/investmentCashLedger';
import { getSarPerUsdForCalendarDay } from '../services/fxDailySeries';
import { useCurrency } from '../context/CurrencyContext';

/** Recommended months of expenses to hold as emergency cash (3–6 is common; 6 is conservative). */
export const EMERGENCY_FUND_TARGET_MONTHS = 6;

/** Budget categories treated as essential for emergency fund calculation. */
const CORE_BUDGET_CATEGORIES = [
    'Food',
    'Housing',
    'Housing Rent',
    'Housing Rent (Monthly)',
    'Housing Rent (Semi-Annual)',
    'Groceries & Supermarket',
    'Utilities',
    'Transportation',
    'Health',
    'Insurance',
    'Insurance Co-pay',
    'Debt/Loans',
    'Savings & Investments',
];

function budgetToMonthly(limit: number, period?: string): number {
    const n = Number(limit) || 0;
    if (period === 'yearly') return n / 12;
    if (period === 'weekly') return n * (52 / 12);
    if (period === 'daily') return n * (365 / 12);
    return n;
}

export interface EmergencyFundMetrics {
    /** Liquid cash: Checking + Savings + Investment platform cash (Accounts balance per broker), SAR. */
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
    /** 0–1+ coverage vs target months (e.g. 1 = fully funded). */
    emergencyFundCoverage: number;
    /** False when we could not estimate monthly core expenses (avoid “target met” false positives). */
    hasEssentialExpenseEstimate: boolean;
}

function txExpenseSar(
    t: Transaction,
    accById: Map<string, Account>,
    sarPerUsd: number,
    data: FinancialData,
    useDailyFx: boolean,
    uiExchangeRate: number,
): number {
    const acc = accById.get(t.accountId);
    const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
    const r =
        useDailyFx && t.date
            ? getSarPerUsdForCalendarDay(t.date.slice(0, 10), data, uiExchangeRate)
            : sarPerUsd;
    return toSAR(Math.abs(Number(t.amount) || 0), c, r);
}

/**
 * Computes emergency fund metrics from financial data.
 * Uses: (1) rolling 6‑month average of core expenses from transactions, or
 *       (2) sum of current month budgets for essential categories if no core transactions.
 * Liquid cash = Checking + Savings (positive only) + tradable cash on Investment accounts (same as `getAvailableCashForAccount`), normalized to **SAR**.
 */
export function computeEmergencyFundMetrics(
    data: FinancialData | null | undefined,
    opts?: { sarPerUsd?: number; exchangeRate?: number }
): EmergencyFundMetrics {
    const defaultResult: EmergencyFundMetrics = {
        emergencyCash: 0,
        monthlyCoreExpenses: 0,
        monthsCovered: 0,
        targetMonths: EMERGENCY_FUND_TARGET_MONTHS,
        status: 'critical',
        shortfall: 0,
        targetAmount: 0,
        emergencyFundCoverage: 0,
        hasEssentialExpenseEstimate: false,
    };

    if (!data) return defaultResult;
    const { personalAccounts, personalTransactions } = getPersonalWealthData(data);
    if (!personalAccounts.length) return defaultResult;
    const accounts = personalAccounts as Account[];
    const transactions = personalTransactions as Transaction[];
    const budgets = (data.budgets ?? []) as Budget[];

    const uiEx = opts?.exchangeRate;
    const useDailyFx = uiEx != null && Number.isFinite(uiEx) && uiEx > 0;

    const spotSarPerUsd =
        opts?.sarPerUsd != null && Number.isFinite(opts.sarPerUsd) && opts.sarPerUsd > 0
            ? opts.sarPerUsd
            : resolveSarPerUsd(data, useDailyFx ? uiEx : undefined);

    const accById = new Map(accounts.map((a) => [a.id, a]));

    const bankCashSar = accounts
        .filter((a) => a.type === 'Checking' || a.type === 'Savings')
        .reduce((sum, a) => {
            const cur = a.currency === 'USD' ? 'USD' : 'SAR';
            return sum + toSAR(Math.max(0, a.balance ?? 0), cur, spotSarPerUsd);
        }, 0);
    let platformCashSar = 0;
    for (const a of accounts) {
        if (a.type !== 'Investment') continue;
        platformCashSar += tradableCashBucketToSAR(brokerCashBucketsFromInvestmentAccount(a), spotSarPerUsd);
    }
    const emergencyCash = bankCashSar + platformCashSar;

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const coreExpenseTx = transactions.filter((t) => {
        const budgetCategory = String(
            (t as Transaction & { budgetCategory?: string }).budgetCategory ??
                (t as Transaction & { category?: string }).category ??
                ''
        ).trim();
        return (
            countsAsExpenseForCashflowKpi(t) &&
            (t.expenseType === 'Core' || (budgetCategory !== '' && CORE_BUDGET_CATEGORIES.includes(budgetCategory)))
        );
    });
    const byMonth = new Map<string, number>();
    coreExpenseTx.forEach((t) => {
        const d = new Date(t.date);
        if (d >= sixMonthsAgo) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth.set(
                key,
                (byMonth.get(key) ?? 0) + txExpenseSar(t, accById, spotSarPerUsd, data, useDailyFx, uiEx ?? 0),
            );
        }
    });

    let monthlyCoreExpenses: number;
    if (byMonth.size > 0) {
        monthlyCoreExpenses = Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size;
    } else {
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const monthBudgets = budgets.filter((b) => b.month === currentMonth && b.year === currentYear);
        const essentialSum = monthBudgets
            .filter((b) => CORE_BUDGET_CATEGORIES.includes(String(b.category ?? '').trim()))
            .reduce((sum, b) => sum + budgetToMonthly(b.limit ?? 0, (b as Budget).period), 0);
        if (essentialSum > 0) {
            monthlyCoreExpenses = essentialSum;
        } else {
            const allExpenses = transactions.filter(
                (t) => countsAsExpenseForCashflowKpi(t) && new Date(t.date) >= sixMonthsAgo
            );
            const allByMonth = new Map<string, number>();
            allExpenses.forEach((t) => {
                const key = t.date.slice(0, 7);
                allByMonth.set(
                    key,
                    (allByMonth.get(key) ?? 0) + txExpenseSar(t, accById, spotSarPerUsd, data, useDailyFx, uiEx ?? 0),
                );
            });
            monthlyCoreExpenses =
                allByMonth.size > 0
                    ? Array.from(allByMonth.values()).reduce((a, b) => a + b, 0) / allByMonth.size
                    : 0;
        }
    }

    const targetMonths = EMERGENCY_FUND_TARGET_MONTHS;
    const hasEssentialExpenseEstimate = monthlyCoreExpenses > 0;
    /** Only meaningful when `hasEssentialExpenseEstimate` (avoid fake “99 months” when essential spend is unknown). */
    const monthsCovered = monthlyCoreExpenses > 0 ? emergencyCash / monthlyCoreExpenses : 0;
    const targetAmount = monthlyCoreExpenses * targetMonths;
    const shortfall = Math.max(0, targetAmount - emergencyCash);

    let status: EmergencyFundMetrics['status'] = 'critical';
    if (hasEssentialExpenseEstimate) {
        if (monthsCovered >= targetMonths) status = 'healthy';
        else if (monthsCovered >= 3) status = 'adequate';
        else if (monthsCovered >= 1) status = 'low';
    }

    const emergencyFundCoverage = targetMonths > 0 ? monthsCovered / targetMonths : 0;
    return {
        emergencyCash,
        monthlyCoreExpenses,
        monthsCovered,
        targetMonths,
        status,
        shortfall,
        targetAmount,
        emergencyFundCoverage,
        hasEssentialExpenseEstimate,
    };
}

export function emergencyFundCoverage(data: FinancialData | null | undefined): number {
    return computeEmergencyFundMetrics(data).emergencyFundCoverage;
}

/**
 * Hook: returns emergency fund metrics from DataContext-style data.
 * Use across Dashboard, Summary, Accounts, Goals, and Forecast for consistent emergency cash handling.
 */
export function useEmergencyFund(data: FinancialData | null | undefined): EmergencyFundMetrics {
    const { exchangeRate } = useCurrency();
    return useMemo(
        () => computeEmergencyFundMetrics(data, { exchangeRate }),
        [data, exchangeRate]
    );
}
