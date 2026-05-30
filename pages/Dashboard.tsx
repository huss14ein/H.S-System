import React, { useMemo, useContext, useState, useCallback, useEffect, Suspense, lazy, useDeferredValue } from 'react';
import Card from '../components/Card';
import LoadingSpinner from '../components/LoadingSpinner';

const DraggableResizableGrid = lazy(() => import('../components/DraggableResizableGrid'));
import { Transaction, Page, Budget, Account } from '../types';
import ProgressBar from '../components/ProgressBar';
import CashflowChart from '../components/charts/CashflowChart';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import NetWorthCockpit from '../components/charts/NetWorthCockpit';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { CalendarDaysIcon } from '../components/icons/CalendarDaysIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import TransactionReviewModal from '../components/TransactionReviewModal';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { DocumentArrowUpIcon } from '../components/icons/DocumentArrowUpIcon';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { UsersIcon } from '../components/icons/UsersIcon';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { useCanonicalSpotFx, useDashboardCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { getSarPerUsdForCalendarDay } from '../services/fxDailySeries';
import { supabase } from '../services/supabaseClient';
import { captureExtendedNetWorthSnapshot } from '../services/netWorthSnapshotExtended';
import {
    canAutoCaptureNetWorthSnapshot,
    getTrackedQuoteSymbolsFromData,
    quoteRefreshFingerprint,
} from '../services/netWorthSnapshotReadiness';
import { markAutoNetWorthSnapshotCaptured, shouldThrottleAutoNetWorthSnapshot } from '../services/netWorthSnapshotThrottle';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { subscriptionSpendMonthlySar } from '../services/transactionIntelligence';
import InfoHint from '../components/InfoHint';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { resolveInvestmentTransactionAccountId, inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';
import { useTodosOptional } from '../context/TodosContext';
import { computeTaskCounts, compareActionableTodos, isTaskSnoozed, todayIsoDate } from '../services/todoModel';
import type { TodoItem } from '../types';
import { usePrivacyMask } from '../context/PrivacyContext';
import type { InvestmentCapitalSource } from '../services/investmentKpiCore';
import { accountBookCurrency, transactionBookCurrency } from '../utils/cashAccountDisplay';
import { getTransactionBudgetAllocations } from '../services/transactionBudgetAllocations';
import {
    financialMonthRange,
    financialMonthKeysEndingAt,
    financialMonthIsoKey,
    financialMonthColumnHeaderLabel,
    financialMonthRangeFromKey,
    resolveMonthStartDayFromData,
    dateInRange,
} from '../utils/financialMonth';
import { buildPersonalInvestmentTreemapRows } from '../services/wealthSummaryReportModel';
import { PAGE_INTROS, GETTING_STARTED_STEPS } from '../content/plainLanguage';
import PlanCompareContextBanner from '../components/PlanCompareContextBanner';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { useLanguage } from '../context/LanguageContext';

interface ExtendedBudget extends Budget {
    spent: number;
    percentage: number;
    monthlyLimit?: number;
}

const AccountsOverview: React.FC<{ accounts: Account[], onClick: () => void }> = ({ accounts, onClick }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const safeAccounts = accounts ?? [];
    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()} aria-label="Accounts overview, click to open Accounts page">
            <h3 className="section-title"><BuildingLibraryIcon className="h-5 w-5 text-primary"/> Accounts Overview</h3>
            {safeAccounts.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">Add your bank accounts, savings, or investment platforms to see your balances here.</p>
            ) : (
            <ul className="space-y-3">
                {safeAccounts.map(acc => (
                    <li key={acc.id} className="flex justify-between items-center text-sm">
                        <div>
                            <p className="font-medium text-dark">{acc.name}</p>
                            <p className="text-xs text-slate-500">{acc.type}</p>
                        </div>
                        <p className={`font-semibold ${(acc.balance ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                            {formatCurrencyString(acc.balance ?? 0, acc.type === 'Investment' ? { showSecondary: true } : { inCurrency: accountBookCurrency(acc), showSecondary: true })}
                        </p>
                    </li>
                ))}
            </ul>
            )}
        </div>
    );
};

const UpcomingBills: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const headlineFx = useCanonicalSpotFx();
    const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const accountsById = useMemo(() => {
        const list = getPersonalAccounts(data);
        return new Map<string, Account>(list.map((a: Account) => [a.id, a]));
    }, [data]);

    const upcomingBills = useMemo(() => {
        const sarPerUsd = headlineFx;
        const recurringExpenses = new Map<string, { totalSAR: number; lastAmount: number; lastDate: Date; count: number; lastAccountId?: string }>();
        const now = new Date();

        // Find recurring fixed expenses from the last year (personal accounts only)
        getPersonalTransactions(data)
            .filter((t) => countsAsExpenseForCashflowKpi(t) && t.transactionNature === 'Fixed' && new Date(t.date) > new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()))
            .forEach((t: { description?: string; amount?: number; date: string; accountId?: string }) => {
                const existing = recurringExpenses.get(t.description ?? '') || { totalSAR: 0, lastAmount: 0, lastDate: new Date(0), count: 0, lastAccountId: undefined as string | undefined };
                const thisAmount = Math.abs(Number(t.amount) ?? 0);
                const book = accountBookCurrency(accountsById.get(t.accountId ?? ''));
                const thisSAR = toSAR(thisAmount, book, sarPerUsd);
                recurringExpenses.set(t.description ?? '', {
                    totalSAR: existing.totalSAR + thisSAR,
                    lastAmount: thisAmount,
                    lastDate: new Date(Math.max(existing.lastDate.getTime(), new Date(t.date).getTime())),
                    count: existing.count + 1,
                    lastAccountId: t.accountId ?? existing.lastAccountId,
                });
            });

        const bills: { name: string; date: Date; lastAmount: number; avgAmountSAR: number; lastAccountId?: string }[] = [];
        for (const [name, { totalSAR, lastAmount, lastDate, count, lastAccountId }] of recurringExpenses.entries()) {
            if (count > 1) { // Consider it recurring if it happened more than once
                const nextDueDate = new Date(lastDate);
                // Simple assumption of monthly recurrence for this example
                nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                
                if (nextDueDate > now && nextDueDate < new Date(now.getFullYear(), now.getMonth() + 2, 0)) { // If due in the next ~month
                     const avgAmountSAR = totalSAR / count;
                     bills.push({ name, date: nextDueDate, lastAmount, avgAmountSAR, lastAccountId });
                }
            }
        }
        return bills.sort((a,b) => a.date.getTime() - b.date.getTime()).slice(0, 3);
    }, [data, accountsById, headlineFx]);

    return (
        <div className="section-card">
            <h3 className="text-lg font-semibold mb-4 text-dark flex items-center"><CalendarDaysIcon className="h-5 w-5 mr-2 text-primary"/> Upcoming Bills</h3>
            {upcomingBills.length > 0 ? (
                <ul className="space-y-3">
                    {upcomingBills.map(bill => (
                        <li key={bill.name} className="flex justify-between items-center text-sm">
                            <div>
                                <p className="font-medium text-dark">{bill.name}</p>
                                <p className="text-xs text-slate-500">
                                    Due: {formatDate(bill.date)} • Typical (SAR eq.): {formatCurrencyString(bill.avgAmountSAR, { showSecondary: true })}
                                </p>
                            </div>
                            <p className="font-semibold text-dark">
                                {formatCurrencyString(bill.lastAmount, { inCurrency: transactionBookCurrency({ accountId: bill.lastAccountId ?? '' }, accountsById), showSecondary: true })}
                            </p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-center text-slate-500 py-4">No upcoming recurring bills detected this month.</p>
            )}
        </div>
    );
};


const RecentTransactions: React.FC<{ transactions: Transaction[], accounts: Account[], onClick: () => void }> = ({ transactions, accounts, onClick }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const accountsById = useMemo(() => new Map<string, Account>(accounts.map((a) => [a.id, a])), [accounts]);
    const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
            <h3 className="text-lg font-semibold mb-4 text-dark">Recent Transactions</h3>
            <ul className="space-y-4">
                {transactions.slice(0, 5).map((t, index) => {
                    const amt = t.amount ?? 0;
                    const tone = amt > 0 ? 'text-success' : amt < 0 ? 'text-danger' : 'text-dark';
                    return (
                    <li 
                      key={t.id} 
                      className="flex justify-between items-center animate-slideInUp"
                      style={{ animationDelay: `${index * 100}ms`, opacity: 0 }}
                    >
                        <div>
                            <p className="font-medium text-dark">{t.description ?? '—'}</p>
                            <p className="text-sm text-slate-500">{formatDate(t.date)}</p>
                        </div>
                        <p className={`font-semibold ${tone}`}>
                            {formatCurrencyString(amt, { inCurrency: transactionBookCurrency(t, accountsById), showSecondary: true })}
                        </p>
                    </li>
                    );
                })}
            </ul>
        </div>
    );
};

const BudgetHealth: React.FC<{ budgets: ExtendedBudget[], onClick: () => void }> = ({ budgets, onClick }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();

    const getStatus = (percentage: number) => {
        const p = Number(percentage) || 0;
        if (p > 100) return { text: 'Over Budget', colorClass: 'bg-danger', textColorClass: 'text-danger' };
        if (p > 75) return { text: 'Nearing Limit', colorClass: 'bg-warning', textColorClass: 'text-warning' };
        return { text: 'On Track', colorClass: 'bg-success', textColorClass: 'text-success' };
    };

    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
            <h3 className="text-lg font-semibold mb-4 text-dark">Budget Health (This Month)</h3>
            <div className="space-y-4">
                {(budgets ?? []).slice(0, 4).map((budget, index) => {
                    const status = getStatus(budget?.percentage ?? 0);
                    return (
                        <div key={budget?.category ?? `budget-${index}`} className="border-t pt-3 first:border-t-0">
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-bold text-dark">{budget?.category ?? '—'}</span>
                                <span className={`text-sm font-semibold flex items-center gap-1.5 ${status.textColorClass}`}>
                                    <span className={`w-2 h-2 rounded-full ${status.colorClass}`}></span>
                                    {status.text}
                                </span>
                            </div>
                            <ProgressBar value={budget?.spent ?? 0} max={budget?.monthlyLimit ?? budget?.limit ?? 1} color={status.colorClass} />
                            <div className="flex justify-between items-baseline text-xs text-slate-500 mt-1">
                                <span>
                                    <span className="font-semibold text-dark">{formatCurrencyString(budget?.spent ?? 0, { digits: 0 })}</span> / {formatCurrencyString(budget?.monthlyLimit ?? budget?.limit ?? 0, { digits: 0 })}
                                    <span className="font-medium text-slate-600"> ({(budget?.percentage ?? 0).toFixed(0)}%)</span>
                                </span>
                                <span>
                                    {daysLeft} days left
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

type KpiCardKey = 'netWorth' | 'monthlyPnL' | 'emergencyFund' | 'budgetVariance' | 'investmentRoi' | 'investmentPlan' | 'wealthUltra' | 'marketEvents';

const KPI_CARD_ORDER: KpiCardKey[] = ['netWorth', 'monthlyPnL', 'emergencyFund', 'budgetVariance', 'investmentRoi', 'investmentPlan'];

const SYSTEM_HEALTH_PAGE = 'System & APIs Health' as Page;

const DashboardContent: React.FC<{
    setActivePage: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
    pageAction?: string | null;
    clearPageAction?: () => void;
}> = ({ setActivePage, triggerPageAction, pageAction, clearPageAction }) => {
    const { data, getAvailableCashForAccount, showHydrateBanner } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const {
        headline,
        kpiSnapshot,
        todaySnapshot: dashboardTodaySnapshot,
        investableCashBars: dashboardInvestableCashBars,
        sarPerUsd: canonicalSarPerUsd,
        simulatedPrices: dashboardDebouncedPrices,
    } = useDashboardCanonicalMetrics();
    const { isRefreshing, hasQueuedPriceRefresh, symbolQuoteUpdatedAt, isLive } = useMarketQuoteMeta();
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const { maskBalance } = usePrivacyMask();
    const { dir } = useLanguage();
    const deferredData = useDeferredValue(showHydrateBanner ? null : data);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const kpiDensity = 'compact' as const;

    useEffect(() => {
        if (pageAction !== 'plan-compare-dashboard') return;
        const scrollToKpis = () => {
            document.getElementById('dashboard-kpi-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        const t = window.setTimeout(scrollToKpis, 120);
        clearPageAction?.();
        return () => window.clearTimeout(t);
    }, [pageAction, clearPageAction]);
    const todosOpt = useTodosOptional();
    const dashboardTasksPreview = useMemo(() => {
        const list = todosOpt?.todos;
        if (!list?.length) {
            return { items: [] as TodoItem[], overdue: 0, dueToday: 0, open: 0 };
        }
        const today = todayIsoDate();
        const counts = computeTaskCounts(list, today);
        const actionable = list.filter((t) => t.status === 'open' && !isTaskSnoozed(t, today));
        const items = [...actionable].sort(compareActionableTodos).slice(0, 5);
        return { items, overdue: counts.overdue, dueToday: counts.dueToday, open: counts.active };
    }, [todosOpt?.todos]);

    /** Investment rows: tradable platform cash (Accounts balance → SAR), not holdings value. */
    const accountsForOverview = useMemo(() => {
        const list = getPersonalAccounts(data);
        const sarPerUsd = canonicalSarPerUsd;
        return list.map((acc: Account) => {
            if (acc.type === 'Investment') {
                return { ...acc, balance: tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd) };
            }
            return acc;
        });
    }, [data, canonicalSarPerUsd, getAvailableCashForAccount]);

    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0, planCurrency: 'SAR' as const };
        const plan = data.investmentPlan;
        const planCurrency = (plan.budgetCurrency === 'SAR' || plan.budgetCurrency === 'USD' ? plan.budgetCurrency : 'SAR') as 'SAR' | 'USD';
        const spotRate = canonicalSarPerUsd;
        const monthStartDay = resolveMonthStartDayFromData(data);
        const { start: finStart, end: finEnd } = financialMonthRange(new Date(), monthStartDay);
        const accounts = getPersonalAccounts(data) as Account[];
        const investments = getPersonalInvestments(data) as any[];
        const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));
        const monthlyInvested = (data?.investmentTransactions ?? [])
            .filter((t: { date: string; type?: string; accountId?: string; account_id?: string; portfolioId?: string; portfolio_id?: string }) => {
                const aid = resolveInvestmentTransactionAccountId(t as any, accounts as any, investments as any);
                return dateInRange(t.date, finStart, finEnd) && t.type === 'buy' && personalAccountIds.has(aid);
            })
            .reduce((sum, t) => {
                const txCurrency = inferInvestmentTransactionCurrency(t as any, accounts as any, investments as any);
                const day = (t.date ?? '').slice(0, 10);
                const dayRate = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, exchangeRate) : spotRate;
                const sar = toSAR(getInvestmentTransactionCashAmount(t as any), txCurrency, dayRate);
                const inPlanCurrency = planCurrency === 'SAR' ? sar : sar / spotRate;
                return sum + inPlanCurrency;
            }, 0);
        const target = plan.monthlyBudget ?? 0;
        return {
            percent: target > 0 ? Math.min((monthlyInvested / target) * 100, 100) : 0,
            amount: monthlyInvested,
            target,
            planCurrency,
        };
    }, [data, exchangeRate, canonicalSarPerUsd]);


    const { kpiSummary, monthlyBudgets, investmentTreemapData, monthlyCashflowData, uncategorizedTransactions, recentTransactions, projectedCash30d, currentCash } = useMemo(() => {
        try {
            if (!deferredData || showHydrateBanner || !kpiSnapshot) {
                return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [], projectedCash30d: 0, currentCash: 0 };
            }

            const sarPerUsd = canonicalSarPerUsd;

            const now = new Date();
            const monthStartDay = resolveMonthStartDayFromData(deferredData);
            const currentFinMonth = financialMonthRange(now, monthStartDay);
            const rawTransactions = getPersonalTransactions(deferredData);
            const transactions = (rawTransactions as Array<Transaction & { account_id?: string; budget_category?: string }>).map((t) => ({
                ...t,
                accountId: t.accountId ?? t.account_id ?? '',
                budgetCategory: t.budgetCategory ?? t.budget_category ?? '',
            }));
            const accounts = getPersonalAccounts(deferredData);
            const accountsById = new Map(accounts.map((a: Account) => [a.id, a]));
            const txCashflowSar = (t: { accountId?: string; amount?: number; date: string }) => {
                const acc = accountsById.get(t.accountId ?? '') as Account | undefined;
                const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
                const raw = Math.abs(Number(t.amount) || 0);
                if (c === 'SAR') return raw;
                const day = t.date.slice(0, 10);
                const r = getSarPerUsdForCalendarDay(day, deferredData, exchangeRate);
                return toSAR(raw, 'USD', r);
            };

            // Current financial month (same window as `computeDashboardKpiSnapshot` P&L) + KPI snapshot
            const monthlyTransactions = transactions.filter((t: { date: string }) => {
                const d0 = new Date(t.date);
                return d0 >= currentFinMonth.start && d0 <= currentFinMonth.end;
            });
            const budgetToMonthly = (b: { limit: number; period?: string }) => b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
            const currentMonthBudgets = (deferredData?.budgets ?? []).filter(
                (b) => b.month === currentFinMonth.key.month && b.year === currentFinMonth.key.year,
            );
            const snap = kpiSnapshot;
            if (!snap) {
                return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [], projectedCash30d: 0, currentCash: 0 };
            }
            const {
                netWorth,
                monthlyPnL,
                budgetVariance,
                roi,
                netWorthTrend,
                pnlTrend,
                liquidCashSar,
                avgMonthlyIncomeSar6Mo,
                investmentCapitalSource,
            } = snap;

            const investmentTreemapData = buildPersonalInvestmentTreemapRows(deferredData, sarPerUsd, dashboardDebouncedPrices);
            const monthlySpending = new Map<string, number>();
            monthlyTransactions
                .filter((t: { type?: string }) => countsAsExpenseForCashflowKpi(t))
                .forEach((t: Transaction) => {
                    const allocations = getTransactionBudgetAllocations(t);
                    allocations.forEach((allocation) => {
                        const key = allocation.category;
                        const currentSpend = monthlySpending.get(key) || 0;
                        monthlySpending.set(
                            key,
                            currentSpend + txCashflowSar({ accountId: t.accountId, amount: allocation.amount, date: t.date }),
                        );
                    });
                });

            const monthlyBudgets = currentMonthBudgets
                .map(budget => {
                    const spent = monthlySpending.get(budget.category) || 0;
                    const monthlyLimit = budgetToMonthly(budget);
                    const percentage = monthlyLimit > 0 ? (spent / monthlyLimit) * 100 : 0;
                    return { ...budget, spent, percentage, monthlyLimit };
                })
                .sort((a, b) => b.percentage - a.percentage);
            
            // Cashflow Chart Data (personal only) — last 12 financial months
            const finMonthKeys12 = financialMonthKeysEndingAt(now, 12, monthStartDay);
            const earliestCashflow = financialMonthRangeFromKey(finMonthKeys12[0], monthStartDay).start;
            const monthlyCashflowMap = new Map<string, { income: number; expenses: number }>();
            finMonthKeys12.forEach((k) => monthlyCashflowMap.set(financialMonthIsoKey(k), { income: 0, expenses: 0 }));
            transactions
                .filter((t: { date: string }) => {
                    const d0 = new Date(t.date);
                    return !Number.isNaN(d0.getTime()) && d0 >= earliestCashflow;
                })
                .forEach((t: Transaction) => {
                    const monthKey = financialMonthIsoKey(financialMonthRange(new Date(t.date), monthStartDay).key);
                    if (!monthlyCashflowMap.has(monthKey)) return;
                    const current = monthlyCashflowMap.get(monthKey)!;
                    if (countsAsIncomeForCashflowKpi(t)) current.income += txCashflowSar(t);
                    if (countsAsExpenseForCashflowKpi(t)) current.expenses += txCashflowSar(t);
                });
            const monthlyCashflowData = finMonthKeys12.map((k) => {
                const key = financialMonthIsoKey(k);
                const value = monthlyCashflowMap.get(key) ?? { income: 0, expenses: 0 };
                const name =
                    monthStartDay === 1
                        ? new Date(k.year, k.month - 1, 15).toLocaleString('default', { month: 'short' })
                        : financialMonthColumnHeaderLabel(k.year, k.month, monthStartDay);
                return { name, ...value };
            });

            const uncategorizedTransactions = transactions.filter((t: Transaction) => {
                if (!countsAsExpenseForCashflowKpi(t)) return false;
                const allocations = getTransactionBudgetAllocations(t);
                return allocations.length === 0;
            });

            const recentTransactions = [...transactions]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 40);

            // 30-day projected cash: canonical KPI liquid cash (bank + platform tradable cash).
            const currentCash = liquidCashSar;
            const finMonthKeys6 = financialMonthKeysEndingAt(now, 6, monthStartDay);
            const earliestProj = financialMonthRangeFromKey(finMonthKeys6[0], monthStartDay).start;
            const recentTx = transactions.filter((t: { date: string }) => new Date(t.date) >= earliestProj);
            const monthlyNets = new Map<string, number>();
            finMonthKeys6.forEach((k) => monthlyNets.set(financialMonthIsoKey(k), 0));
            recentTx.forEach((t: Transaction) => {
                const key = financialMonthIsoKey(financialMonthRange(new Date(t.date), monthStartDay).key);
                if (!monthlyNets.has(key)) return;
                let delta = 0;
                if (countsAsIncomeForCashflowKpi(t)) delta += txCashflowSar(t);
                else if (countsAsExpenseForCashflowKpi(t)) delta -= txCashflowSar(t);
                monthlyNets.set(key, (monthlyNets.get(key) || 0) + delta);
            });
            const avgMonthlyNet = monthlyNets.size > 0
                ? Array.from(monthlyNets.values()).reduce((a, b) => a + b, 0) / monthlyNets.size
                : monthlyPnL;
            const projectedCash30d = currentCash + avgMonthlyNet;

            return {
                kpiSummary: {
                    netWorth,
                    monthlyPnL,
                    budgetVariance,
                    roi,
                    netWorthTrend,
                    pnlTrend,
                    liquidCashSar,
                    avgMonthlyIncomeSar6Mo,
                    investmentCapitalSource,
                },
                projectedCash30d,
                currentCash,
                monthlyBudgets,
                investmentTreemapData,
                monthlyCashflowData,
                uncategorizedTransactions,
                recentTransactions
            };
        } catch (e) {
            console.error("Dashboard calculation error:", e);
            return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [], projectedCash30d: 0, currentCash: 0 };
        }
    }, [deferredData, exchangeRate, getAvailableCashForAccount, kpiSnapshot, canonicalSarPerUsd, dashboardDebouncedPrices, showHydrateBanner]);

    useEffect(() => {
        if (!auth?.user?.id || !data) return;
        const nw = typeof headline.netWorth === 'number' && Number.isFinite(headline.netWorth) ? headline.netWorth : (kpiSummary as { netWorth?: number }).netWorth;
        if (typeof nw !== 'number' || !Number.isFinite(nw)) return;
        const snapshotReady = canAutoCaptureNetWorthSnapshot({
            showHydrateBanner,
            isRefreshing,
            hasQueuedPriceRefresh,
            symbolQuoteUpdatedAt,
            isLive,
            data,
        });
        if (!snapshotReady) return;
        const quoteFp = quoteRefreshFingerprint(
            getTrackedQuoteSymbolsFromData(data),
            symbolQuoteUpdatedAt,
        );
        if (shouldThrottleAutoNetWorthSnapshot(auth.user.id, nw, undefined, quoteFp)) return;
        captureExtendedNetWorthSnapshot(
            data,
            exchangeRate,
            getAvailableCashForAccount,
            supabase ? { supabase, userId: auth.user.id } : null,
            dashboardDebouncedPrices,
        );
        markAutoNetWorthSnapshotCaptured(auth.user.id, nw, quoteFp);
    }, [
        auth?.user?.id,
        data,
        headline.netWorth,
        kpiSummary,
        exchangeRate,
        getAvailableCashForAccount,
        showHydrateBanner,
        dashboardDebouncedPrices,
        isRefreshing,
        hasQueuedPriceRefresh,
        symbolQuoteUpdatedAt,
        isLive,
    ]);

    const subsIntel = useMemo(() => {
        if (!data) return { monthlyEstimate: 0, count: 0 };
        const txs = getPersonalTransactions(data);
        const accounts = getPersonalAccounts(data) as Account[];
        const sarPerUsd = canonicalSarPerUsd;
        return subscriptionSpendMonthlySar(txs, accounts, sarPerUsd, 3);
    }, [data, exchangeRate, canonicalSarPerUsd]);

    const getTrendString = (trend: number = 0) => trend.toFixed(1) + '%';
    const visibleKpiOrder: KpiCardKey[] = KPI_CARD_ORDER;

    const goToInvestmentKpiReconciliation = useCallback(() => {
        setActivePage(SYSTEM_HEALTH_PAGE);
        window.location.hash = 'investment-kpi-reconciliation';
        window.setTimeout(() => {
            document.getElementById('investment-kpi-reconciliation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 480);
    }, [setActivePage]);

    const kpiCards = useMemo(() => {
        const cardProps = { density: kpiDensity as 'compact' | 'comfortable' };
        const invCapitalSrc = (kpiSummary as { investmentCapitalSource?: InvestmentCapitalSource }).investmentCapitalSource;
        const efTrend = !emergencyFund.hasEssentialExpenseEstimate
            ? 'Add expense data'
            : emergencyFund.status === 'healthy'
              ? `${EMERGENCY_FUND_TARGET_MONTHS} mo target met`
              : emergencyFund.status === 'adequate'
                ? 'Adequate'
                : emergencyFund.status === 'low'
                  ? 'Build more'
                  : 'Critical';
        const efColor = emergencyFund.status === 'healthy' ? 'green' : emergencyFund.status === 'adequate' ? 'green' : emergencyFund.status === 'low' ? 'yellow' : 'red';
        return {
            netWorth: <Card
                {...cardProps}
                title="My Net Worth"
                value={maskBalance(formatCurrencyString(kpiSummary.netWorth || 0))}
                trend={`${(kpiSummary.netWorthTrend || 0) >= 0 ? '+' : ''}${getTrendString(kpiSummary.netWorthTrend)} vs implied month start`}
                indicatorColor={(kpiSummary.netWorthTrend || 0) >= 0 ? 'green' : 'red'}
                tooltip="Personal wealth only; other Owner tags are excluded. The % is this financial month’s net cashflow (income − expenses, KPI rules) as a share of implied net worth at month start — same idea as Summary, not investment time-weighted return."
                footer={<span className="text-slate-600">Matches Summary’s net worth momentum line; open Summary or Net worth cockpit for history.</span>}
                onClick={() => setActivePage('Summary')}
                icon={<ScaleIcon className="h-5 w-5 text-slate-400" />}
            />,
            monthlyPnL: <Card {...cardProps} title="This Month's P&L" value={formatCurrency(kpiSummary.monthlyPnL || 0, { colorize: true })} trend={(kpiSummary.monthlyPnL || 0) >= 0 ? 'Surplus' : 'Deficit'} indicatorColor={(kpiSummary.monthlyPnL || 0) >= 0 ? 'green' : 'red'} tooltip="Income minus expenses for the current month." onClick={() => setActivePage('Transactions')} icon={<BanknotesIcon className="h-5 w-5 text-slate-400" />} />,
            emergencyFund: <Card {...cardProps} title="Emergency Fund" value={emergencyFund.hasEssentialExpenseEstimate ? `${emergencyFund.monthsCovered.toFixed(1)} mo` : '—'} trend={efTrend} indicatorColor={efColor} tooltip={emergencyFund.hasEssentialExpenseEstimate ? `Liquid cash (bank + idle cash on investment platforms from Accounts) covers ${emergencyFund.monthsCovered.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}` : 'Categorize essential spending or add budgets so we can estimate months of coverage.'} onClick={() => setActivePage('Summary')} icon={<ShieldCheckIcon className="h-5 w-5 text-slate-400" />} />,
            budgetVariance: <Card {...cardProps} title="Budget Variance" value={formatCurrency(kpiSummary.budgetVariance || 0, { colorize: true })} trend={(kpiSummary.budgetVariance || 0) >= 0 ? 'Under budget' : 'Over budget'} indicatorColor={(kpiSummary.budgetVariance || 0) >= 0 ? 'green' : 'red'} tooltip="Money saved from budget this month (positive = under budget). Over budget is shown in red." onClick={() => setActivePage('Budgets')} icon={<PiggyBankIcon className="h-5 w-5 text-slate-400" />} />,
            investmentRoi: <Card {...cardProps} title="Investment ROI" value={`${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} valueColor={(kpiSummary.roi || 0) >= 0 ? 'text-success' : 'text-danger'} trend={`${(kpiSummary.roi || 0) >= 0 ? '+' : ''}${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} indicatorColor={(kpiSummary.roi || 0) >= 0 ? 'green' : 'red'} tooltip="Same formula as Investments: platform value (live rollup) + commodities + Sukuk vs net capital (deposits or fallback) including commodity and Sukuk cost. Uses your live quote feed when available." onClick={() => setActivePage('Investments')} icon={<ArrowTrendingUpIcon className="h-5 w-5 text-slate-400" />} footer={invCapitalSrc === 'ledger_inferred' ? (
                <button type="button" className="text-left w-full font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); goToInvestmentKpiReconciliation(); }}>
                    Ledger-inferred capital — open Investment KPI reconciliation →
                </button>
            ) : undefined} />,
            investmentPlan: <Card {...cardProps} title="Investment Plan" value={`${investmentProgress.percent.toFixed(0)}%`} trend={investmentProgress.percent >= 100 ? 'Target met' : `${investmentProgress.percent.toFixed(0)}% of target`} indicatorColor={investmentProgress.percent >= 100 ? 'green' : 'yellow'} tooltip={`Progress: ${formatCurrencyString(investmentProgress.amount, { digits: 0, inCurrency: investmentProgress.planCurrency })} / ${formatCurrencyString(investmentProgress.target, { digits: 0, inCurrency: investmentProgress.planCurrency })} monthly.`} onClick={() => setActivePage('Investment Plan')} icon={<ArrowPathIcon className="h-5 w-5 text-primary" />} />,
            wealthUltra: <Card {...cardProps} title="Wealth Ultra" value="Engine" trend="Active" indicatorColor="green" tooltip="Automated portfolio allocation and order generation with performance tracking." onClick={() => setActivePage('Wealth Ultra')} icon={<ScaleIcon className="h-5 w-5 text-primary" />} />,
            marketEvents: <Card {...cardProps} title="Market Events" value="Calendar" trend="Upcoming" indicatorColor="yellow" tooltip="View upcoming FOMC meetings, earnings, and market-impacting events with AI insights." onClick={() => setActivePage('Market Events')} icon={<CalendarDaysIcon className="h-5 w-5 text-indigo-500" />} />,
        };
    }, [formatCurrencyString, formatCurrency, kpiSummary, investmentProgress, emergencyFund, setActivePage, kpiDensity, maskBalance, goToInvestmentKpiReconciliation]);
    
    const accounts = getPersonalAccounts(data);
    const goals = data?.goals ?? [];
    const isNewUser = accounts.length === 0 || (accounts.length <= 1 && recentTransactions.length === 0 && goals.length === 0);

    return (
        <div className="page-container" dir={dir}>
            {showHydrateBanner && (
                <div
                    className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm"
                    role="status"
                    aria-live="polite"
                    aria-label="Loading dashboard data"
                >
                    <div className="h-8 w-8 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden />
                    <p className="text-sm font-medium text-slate-700">Loading your dashboard…</p>
                </div>
            )}
            <PlanCompareContextBanner
                dashboardNetWorthSar={headline.netWorth}
                dashboardMonthlyPnLSar={kpiSnapshot?.monthlyPnL ?? 0}
                onOpenPlan={() => setActivePage('Plan')}
            />

            {isNewUser && (
                <div className="mb-6 p-5 rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-white">
                    <h2 className="text-lg font-semibold text-slate-800">{PAGE_INTROS.Dashboard.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">{PAGE_INTROS.Dashboard.description}</p>
                    <p className="mt-3 text-sm font-medium text-slate-700">Get started in 4 steps:</p>
                    <ul className="mt-2 space-y-2">
                        {GETTING_STARTED_STEPS.map((step, i) => (
                            <li key={step.page} className="flex items-center gap-3 text-sm">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-semibold">{i + 1}</span>
                                <span className="text-slate-600">{step.label}</span>
                                <button type="button" onClick={() => setActivePage(step.page)} className="ms-auto text-primary font-medium hover:underline shrink-0">
                                    {step.action} →
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {uncategorizedTransactions.length > 0 && (
                <div 
                    className="alert-warning cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setIsReviewModalOpen(true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setIsReviewModalOpen(true)}
                >
                    <div className="flex items-center">
                        <div className="py-1"><ExclamationTriangleIcon className="h-6 w-6 text-yellow-500 mr-3"/></div>
                        <div>
                            <p className="font-bold">Action Required</p>
                            <p>You have {uncategorizedTransactions.length} uncategorized transaction(s) that need your review to keep your budget accurate.</p>
                        </div>
                    </div>
                </div>
            )}

            {(() => {
                const today = new Date().getDate();
                const isDueToday = (r: { dayOfMonth: number }) =>
                    r.dayOfMonth === today || (today >= 28 && r.dayOfMonth === 28);
                const dueToday = (data?.recurringTransactions ?? []).filter((r: { enabled: boolean; dayOfMonth: number; addManually?: boolean }) => r.enabled && isDueToday(r) && !r.addManually);
                return dueToday.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                        <CalendarDaysIcon className="h-5 w-5 text-slate-500" />
                        <span className="text-slate-700"><strong>{dueToday.length}</strong> recurring {dueToday.length === 1 ? 'item' : 'items'} due today</span>
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Transactions')} className="text-primary font-medium hover:underline ml-1 inline-flex items-center gap-1.5">
                                <CreditCardIcon className="h-4 w-4" />
                                View in Transactions →
                            </button>
                        )}
                    </div>
                );
            })()}

            {subsIntel.count > 0 && (
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-violet-50/80 border border-violet-100 text-sm mb-2">
                    <span className="text-slate-700 inline-flex flex-wrap items-center gap-1.5">
                        <strong>Subscriptions (heuristic):</strong> ~{formatCurrencyString(subsIntel.monthlyEstimate, { digits: 0 })}/mo SAR · {subsIntel.count} keyword-matched expense(s), last 3 calendar months
                        <InfoHint text="Same rules as Analysis: expenses whose description matches common subscription merchants/SaaS keywords. Amounts use each account’s currency and your FX settings (not raw statement numbers in USD treated as SAR)." />
                    </span>
                    <button type="button" onClick={() => setActivePage('Analysis')} className="text-primary font-medium hover:underline text-sm">
                        Details in Analysis →
                    </button>
                </div>
            )}

            <p className="text-xs text-slate-500 mb-1">
                Key metrics first — drag cards to reorder; click a card to open that page.
            </p>

            {dashboardTasksPreview.open > 0 && (
                <div className="section-card border-l-4 border-violet-400 mb-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <h3 className="section-title text-base inline-flex items-center gap-2">
                                <ClipboardDocumentListIcon className="h-5 w-5 text-violet-600" aria-hidden />
                                My tasks
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {dashboardTasksPreview.overdue > 0 && (
                                    <span className="text-rose-600 font-semibold tabular-nums">{dashboardTasksPreview.overdue} overdue</span>
                                )}
                                {dashboardTasksPreview.overdue > 0 && dashboardTasksPreview.dueToday > 0 && <span> · </span>}
                                {dashboardTasksPreview.dueToday > 0 && (
                                    <span className="text-amber-700 font-semibold tabular-nums">{dashboardTasksPreview.dueToday} due today</span>
                                )}
                                {dashboardTasksPreview.overdue === 0 && dashboardTasksPreview.dueToday === 0 && (
                                    <span className="tabular-nums">{dashboardTasksPreview.open} open</span>
                                )}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="btn-outline text-sm shrink-0"
                            onClick={() =>
                                (triggerPageAction ? triggerPageAction('Notifications', 'notifications-tab:tasks') : setActivePage('Notifications'))
                            }
                        >
                            View all
                        </button>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                        {dashboardTasksPreview.items.map((t) => (
                            <li key={t.id} className="text-sm text-slate-700 flex items-baseline gap-2 min-w-0">
                                <span className="text-slate-300 shrink-0">•</span>
                                <span className="min-w-0 truncate flex-1">{t.title}</span>
                                {t.dueDate && <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{t.dueDate}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div id="dashboard-kpi-row" className="scroll-mt-20">
            <Suspense fallback={<LoadingSpinner className="min-h-[16rem]" message="Loading dashboard layout…" />}>
                <DraggableResizableGrid
                    layoutKey="dashboard-kpi"
                    itemOverflowY="visible"
                    items={visibleKpiOrder.map((cardKey) => ({
                        id: cardKey,
                        content: (
                            <div className="min-h-[132px] flex flex-col h-full">
                                <div className="flex-1 min-h-0">
                                    {kpiCards[cardKey]}
                                </div>
                            </div>
                        ),
                        defaultW: 4,
                        defaultH: 2,
                        minW: 2,
                        minH: 1,
                    }))}
                    cols={12}
                    rowHeight={72}
                />
            </Suspense>
            </div>

            <section aria-label="Net worth" className="mb-6">
                <div className="section-card flex flex-col min-h-[420px] overflow-hidden border-l-4 border-l-primary/30">
                    <h2 className="section-title text-base mb-2">Net worth</h2>
                    <div className="flex-1 min-h-0">
                        <NetWorthCockpit
                            title="Balance sheet"
                            metricsOverride={{
                                headline,
                                todaySnapshot: dashboardTodaySnapshot,
                                investableCashBars: dashboardInvestableCashBars,
                                sarPerUsd: canonicalSarPerUsd,
                                simulatedPrices: dashboardDebouncedPrices,
                            }}
                            onOpenSummary={() => setActivePage('Summary')}
                            onOpenInvestments={() => setActivePage('Investments')}
                            onOpenAccounts={() => setActivePage('Accounts')}
                            onOpenAssets={() => setActivePage('Assets')}
                            onOpenDataReconciliation={() => {
                                window.location.hash = 'data-reconciliation';
                            }}
                        />
                    </div>
                </div>
            </section>

            {data?.accounts?.length > 0 && (
                <div className="section-card border-l-4 border-primary/40">
                    <h3 className="section-title text-base">Cash & emergency fund</h3>
                    <p className="text-2xl font-bold text-dark tabular-nums">{maskBalance(formatCurrencyString(projectedCash30d ?? currentCash ?? 0))}</p>
                    <p className="text-xs text-slate-500 mt-1">Projected cash in 30 days (current liquid + average monthly net flow). Current liquid = bank balances + cash sitting on each investment platform (Accounts), same as headline KPI liquid cash.</p>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-sm text-slate-700"><strong>Emergency fund:</strong> {maskBalance(formatCurrencyString(emergencyFund.emergencyCash))} liquid cash (Checking, Savings, and idle broker cash per Investment account in Accounts — holdings/market value are separate)
                            {emergencyFund.hasEssentialExpenseEstimate ? (
                                <> = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses (target {EMERGENCY_FUND_TARGET_MONTHS} months). {emergencyFund.shortfall > 0 ? `Shortfall: ${maskBalance(formatCurrencyString(emergencyFund.shortfall))}.` : 'Target met.'}</>
                            ) : (
                                <>. Add essential expense categories or budgets to estimate months covered.</>
                            )}
                        </p>
                    </div>
                </div>
            )}

            <section aria-label="This month" className="mb-6 space-y-4">
            <div className="cards-grid grid grid-cols-1 gap-4">
                 <div className="section-card-hover flex flex-col min-h-[300px]" onClick={() => setActivePage('Transactions')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivePage('Transactions')}>
                    <h3 className="section-title">Monthly Cash Flow</h3>
                    <div className="flex-1 min-h-[280px] rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                        <CashflowChart data={monthlyCashflowData} />
                    </div>
                 </div>
                 <div className="section-card-hover flex flex-col min-h-[320px]" onClick={() => setActivePage('Investments')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivePage('Investments')}>
                    <h3 className="section-title">Investment Allocation & Performance</h3>
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden w-full" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                 </div>
            </div>

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                <BudgetHealth budgets={monthlyBudgets} onClick={() => setActivePage('Budgets')} />
                <RecentTransactions transactions={recentTransactions} accounts={getPersonalAccounts(data)} onClick={() => setActivePage('Transactions')} />
            </div>
            </section>

            <section aria-label="Accounts and bills" className="mb-6">
            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                <AccountsOverview accounts={accountsForOverview} onClick={() => setActivePage('Accounts')} />
                <UpcomingBills />
            </div>
            </section>

            {setActivePage && (
                <div className="section-card border border-slate-200/80 bg-slate-50/50">
                    <h3 className="section-title text-base mb-2">Quick next steps</h3>
                    <ul className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <li><button type="button" onClick={() => setActivePage('Transactions')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><CreditCardIcon className="h-4 w-4" />Categorize transactions</button> to keep budgets accurate</li>
                        <li><button type="button" onClick={() => setActivePage('Statement Upload')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><DocumentArrowUpIcon className="h-4 w-4" />Import from statements</button> (bank, SMS, or trading)</li>
                        <li><button type="button" onClick={() => setActivePage('Assets')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><GoldBarIcon className="h-4 w-4" />Manage assets</button> (property, commodities, metals)</li>
                        <li><button type="button" onClick={() => setActivePage('Plan')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><ClipboardDocumentListIcon className="h-4 w-4" />Update your Plan</button> to reflect income and expenses</li>
                        <li><button type="button" onClick={() => setActivePage('Summary')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><UsersIcon className="h-4 w-4" />View Summary</button> for headline wealth &amp; advisor</li>
                        <li><button type="button" onClick={() => setActivePage('Wealth Analytics')} className="text-primary hover:underline font-medium">Wealth Analytics</button> for charts, health score &amp; cashflow tools</li>
                    </ul>
                </div>
            )}
            
            <TransactionReviewModal 
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                transactions={uncategorizedTransactions}
                budgetCategories={(data?.budgets ?? []).map(b => b.category)}
            />
        </div>
    );
};

const Dashboard: React.FC<{
    setActivePage: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
    pageAction?: string | null;
    clearPageAction?: () => void;
}> = (props) => <DashboardContent {...props} />;

export default Dashboard;
