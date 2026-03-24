import React, { useMemo, useContext, useState, useCallback, useEffect } from 'react';
import Card from '../components/Card';
import DraggableResizableGrid from '../components/DraggableResizableGrid';
import { Transaction, Page, Budget, Account } from '../types';
import ProgressBar from '../components/ProgressBar';
import CashflowChart from '../components/charts/CashflowChart';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import NetWorthCompositionChart from '../components/charts/NetWorthCompositionChart';
import AIFeed from '../components/AIFeed';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { CalendarDaysIcon } from '../components/icons/CalendarDaysIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import TransactionReviewModal from '../components/TransactionReviewModal';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { getAIExecutiveSummary, formatAiError } from '../services/geminiService';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { useAI } from '../context/AiContext';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { DocumentArrowUpIcon } from '../components/icons/DocumentArrowUpIcon';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import { UsersIcon } from '../components/icons/UsersIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, toSAR, tradableCashBucketToSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import { pushNetWorthSnapshot, listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { subscriptionSpendMonthly } from '../services/transactionIntelligence';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { usePrivacyMask } from '../context/PrivacyContext';
import { savingsRate } from '../services/financeMetrics';
import { debtStressScore } from '../services/debtEngines';
import { personalFinanceHealthScore } from '../services/decisionScoringEngine';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { PAGE_INTROS, GETTING_STARTED_STEPS } from '../content/plainLanguage';
import { useSelfLearning } from '../context/SelfLearningContext';
import { BoltIcon } from '../components/icons/BoltIcon';

interface ExtendedBudget extends Budget {
    spent: number;
    percentage: number;
    monthlyLimit?: number;
}

const AIExecutiveSummary: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const { trackAction } = useSelfLearning();
    const [summary, setSummary] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = useCallback(async () => {
        if (!data) return;
        trackAction('generate-ai-summary', 'Dashboard');
        setIsLoading(true);
        setError(null);
        setSummary('');
        try {
            const result = await getAIExecutiveSummary(data);
            setSummary(result ?? '');
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [data, trackAction]);

    return (
        <div className="section-card border-t-4 border-secondary">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center space-x-3">
                        <SparklesIcon className="h-7 w-7 text-secondary" />
                        <h2 className="text-xl font-semibold text-dark">Executive Summary</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 ml-10">From your expert financial & investment advisor</p>
                </div>
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!isAiAvailable || isLoading}
                    title={!isAiAvailable ? "AI features are disabled" : "Generate a new summary"}
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                >
                    <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Summarizing...' : (summary ? 'Refresh Summary' : 'Generate Summary')}
                </button>
            </div>
            
            {isLoading && <div className="text-center p-8 text-slate-500">Analyzing your financial picture...</div>}
            
            {!isLoading && error && (
                <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-r-lg">
                    <h4 className="font-bold">Summary Error</h4>
                    <SafeMarkdownRenderer content={error} />
                    <button type="button" onClick={handleGenerate} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200">Retry</button>
                </div>
            )}

            {!isAiAvailable ? (
                <div className="text-center p-4 text-slate-500 bg-slate-50 rounded-md">
                    <p className="font-semibold">AI Features Disabled</p>
                    <p className="text-sm">Please set your Gemini API key to enable this feature.</p>
                </div>
            ) : (
                !summary && !isLoading && !error && (
                    <div className="text-center p-8 text-slate-500">
                        Click &quot;Generate Summary&quot; for a high-level overview and strategic advice from your expert advisor.
                    </div>
                )
            )}
            
            {summary && !isLoading && !error && (
                <div className="bg-violet-50/50 p-4 rounded-lg">
                    <SafeMarkdownRenderer content={summary} />
                </div>
            )}
        </div>
    );
};

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
                        <p className={`font-semibold ${(acc.balance ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrencyString(acc.balance ?? 0)}</p>
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
    const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const upcomingBills = useMemo(() => {
        const recurringExpenses = new Map<string, { totalAmount: number; lastAmount: number; lastDate: Date; count: number }>();
        const now = new Date();

        // Find recurring fixed expenses from the last year (personal accounts only)
        ((data as any)?.personalTransactions ?? data?.transactions ?? [])
            .filter((t: { type?: string; transactionNature?: string; date: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && t.transactionNature === 'Fixed' && new Date(t.date) > new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()))
            .forEach((t: { description?: string; amount?: number; date: string }) => {
                const existing = recurringExpenses.get(t.description ?? '') || { totalAmount: 0, lastAmount: 0, lastDate: new Date(0), count: 0 };
                const thisAmount = Math.abs(Number(t.amount) ?? 0);
                recurringExpenses.set(t.description ?? '', {
                    totalAmount: existing.totalAmount + thisAmount,
                    lastAmount: thisAmount,
                    lastDate: new Date(Math.max(existing.lastDate.getTime(), new Date(t.date).getTime())),
                    count: existing.count + 1
                });
            });

        const bills = [];
        for (const [name, { totalAmount, lastAmount, lastDate, count }] of recurringExpenses.entries()) {
            if (count > 1) { // Consider it recurring if it happened more than once
                const nextDueDate = new Date(lastDate);
                // Simple assumption of monthly recurrence for this example
                nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                
                if (nextDueDate > now && nextDueDate < new Date(now.getFullYear(), now.getMonth() + 2, 0)) { // If due in the next ~month
                     const avgAmount = totalAmount / count;
                     bills.push({ name, date: nextDueDate, amount: lastAmount, avgAmount });
                }
            }
        }
        return bills.sort((a,b) => a.date.getTime() - b.date.getTime()).slice(0, 3);
    }, [data?.transactions, (data as any)?.personalTransactions]);

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
                                    Due: {formatDate(bill.date)} • Typical: {formatCurrencyString(bill.avgAmount)}
                                </p>
                            </div>
                            <p className="font-semibold text-dark">{formatCurrencyString(bill.amount)}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-center text-slate-500 py-4">No upcoming recurring bills detected this month.</p>
            )}
        </div>
    );
};


const RecentTransactions: React.FC<{ transactions: Transaction[], onClick: () => void }> = ({ transactions, onClick }) => {
    const { formatCurrency } = useFormatCurrency();
    const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
            <h3 className="text-lg font-semibold mb-4 text-dark">Recent Transactions</h3>
            <ul className="space-y-4">
                {transactions.slice(0, 5).map((t, index) => (
                    <li 
                      key={t.id} 
                      className="flex justify-between items-center animate-slideInUp"
                      style={{ animationDelay: `${index * 100}ms`, opacity: 0 }}
                    >
                        <div>
                            <p className="font-medium text-dark">{t.description ?? '—'}</p>
                            <p className="text-sm text-slate-500">{formatDate(t.date)}</p>
                        </div>
                        <p className="font-semibold">
                            {formatCurrency(t.amount ?? 0, { colorize: true })}
                        </p>
                    </li>
                ))}
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

const KPI_CARD_ORDER: KpiCardKey[] = ['netWorth', 'monthlyPnL', 'emergencyFund', 'budgetVariance', 'investmentRoi', 'investmentPlan', 'wealthUltra', 'marketEvents'];

const Dashboard: React.FC<{ setActivePage: (page: Page) => void; triggerPageAction?: (page: Page, action: string) => void }> = ({ setActivePage, triggerPageAction }) => {
    const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { actionQueue, analysis, ready } = useFinancialEnginesIntegration();
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const { maskBalance } = usePrivacyMask();
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const kpiDensity = 'compact' as const;

    /** Investment rows: tradable cash (ledger), not DB balance or holdings. */
    const accountsForOverview = useMemo(() => {
        const list = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
        return list.map((acc: Account) => {
            if (acc.type === 'Investment') {
                return { ...acc, balance: tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd) };
            }
            return acc;
        });
    }, [data, exchangeRate, getAvailableCashForAccount]);

    useEffect(() => {
        const loadRole = async () => {
            if (!auth?.user || !supabase) {
                setIsAdmin(false);
                return;
            }
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            setIsAdmin(inferIsAdmin(auth.user, userRecord?.role ?? null));
        };
        loadRole();
    }, [auth?.user?.id]);

    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0, planCurrency: 'SAR' as const };
        const plan = data.investmentPlan;
        const planCurrency = (plan.budgetCurrency === 'SAR' || plan.budgetCurrency === 'USD' ? plan.budgetCurrency : 'SAR') as 'SAR' | 'USD';
        const rate = resolveSarPerUsd(data, exchangeRate);
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const personalAccountIds = new Set(((data as any)?.personalAccounts ?? data?.accounts ?? []).map((a: { id: string }) => a.id));
        const monthlyInvested = (data?.investmentTransactions ?? [])
            .filter((t: { date: string; type?: string; accountId?: string }) => {
                const d = new Date(t.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy' && personalAccountIds.has(t.accountId ?? '');
            })
            .reduce((sum, t) => {
                const txCurrency = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as 'SAR' | 'USD';
                const sar = toSAR(t.total ?? 0, txCurrency, rate);
                const inPlanCurrency = planCurrency === 'SAR' ? sar : sar / rate;
                return sum + inPlanCurrency;
            }, 0);
        const target = plan.monthlyBudget ?? 0;
        return {
            percent: target > 0 ? Math.min((monthlyInvested / target) * 100, 100) : 0,
            amount: monthlyInvested,
            target,
            planCurrency,
        };
    }, [data, exchangeRate]);


    const { kpiSummary, monthlyBudgets, investmentTreemapData, monthlyCashflowData, uncategorizedTransactions, recentTransactions, projectedCash30d, currentCash } = useMemo(() => {
        try {
            if (!data) return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [], projectedCash30d: 0, currentCash: 0 };

            const sarPerUsd = resolveSarPerUsd(data, exchangeRate);

            const now = new Date();
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

            const d = data as any;
            const transactions = d?.personalTransactions ?? data?.transactions ?? [];
            const accounts = d?.personalAccounts ?? data?.accounts ?? [];
            const investments = d?.personalInvestments ?? data?.investments ?? [];
            const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));

            // Current Month Calculations (personal only)
            const monthlyTransactions = transactions.filter((t: { date: string }) => new Date(t.date) >= firstDayOfMonth);
            const monthlyIncome = monthlyTransactions.filter((t: { type?: string; category?: string }) => countsAsIncomeForCashflowKpi(t)).reduce((sum: number, t: { amount?: number }) => sum + (Number(t.amount) ?? 0), 0);
            const monthlyExpenses = monthlyTransactions.filter((t: { type?: string; category?: string }) => countsAsExpenseForCashflowKpi(t)).reduce((sum: number, t: { amount?: number }) => sum + Math.abs(Number(t.amount) ?? 0), 0);
            const monthlyPnL = monthlyIncome - monthlyExpenses;
            const budgetToMonthly = (b: { limit: number; period?: string }) => b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
            const totalBudget = (data?.budgets ?? []).reduce((sum, b) => sum + budgetToMonthly(b), 0);
            const budgetVariance = totalBudget - monthlyExpenses;

            // Previous Month P&L for trend
            const lastMonthTransactions = transactions.filter((t: { date: string }) => {
                const date = new Date(t.date);
                return date >= firstDayOfLastMonth && date < firstDayOfMonth;
            });
            const lastMonthIncome = lastMonthTransactions
                .filter((t: { type?: string; category?: string }) => countsAsIncomeForCashflowKpi(t))
                .reduce((sum: number, t: { amount?: number }) => sum + (Number(t.amount) ?? 0), 0);
            const lastMonthExpenses = lastMonthTransactions
                .filter((t: { type?: string; category?: string }) => countsAsExpenseForCashflowKpi(t))
                .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(Number(t.amount) ?? 0), 0);
            const lastMonthPnL = lastMonthIncome - lastMonthExpenses;

            // Net worth — shared with Summary / Risk hub (`services/personalNetWorth.ts`)
            const netWorth = computePersonalNetWorthSAR(data, sarPerUsd, { getAvailableCashForAccount });
            const holdingsValueSAR = getAllInvestmentsValueInSAR(investments, sarPerUsd);
            /** Cash at broker (deposits not yet invested) must count toward portfolio value or ROI reads as -100% with deposits only. */
            let brokerageCashSAR = 0;
            accounts.forEach((acc: Account) => {
                if (acc.type === 'Investment' && personalAccountIds.has(acc.id)) {
                    brokerageCashSAR += tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd);
                }
            });
            const totalInvestmentsValue = holdingsValueSAR + brokerageCashSAR;
            const netWorthPrevMonth = netWorth - monthlyPnL;
            const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / netWorthPrevMonth) * 100 : 0;

            // Investment data (personal portfolios only)
            const allHoldings = investments.flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
            const investmentTreemapData = allHoldings.map((h: { avgCost?: number; quantity?: number; currentValue?: number; [k: string]: unknown }) => {
                 const totalCost = (h.avgCost ?? 0) * (h.quantity ?? 0);
                 const gainLoss = (h.currentValue ?? 0) - totalCost;
                 const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
                 return { ...h, gainLoss, gainLossPercent };
            });
            const invTx = (data?.investmentTransactions ?? []).filter((t: { accountId?: string }) => personalAccountIds.has(t.accountId ?? ''));
            const totalInvestedSar = invTx
                .filter((t: { type?: string }) => t.type === 'deposit')
                .reduce((sum: number, t: { total?: number; currency?: string }) => sum + toSAR(t.total ?? 0, t.currency as any, sarPerUsd), 0);
            const totalWithdrawnSar = invTx
                .filter((t: { type?: string }) => t.type === 'withdrawal')
                .reduce((sum: number, t: { total?: number; currency?: string }) => sum + toSAR(t.total ?? 0, t.currency as any, sarPerUsd), 0);
            const netCapital = totalInvestedSar - totalWithdrawnSar;
            const totalGainLoss = totalInvestmentsValue - netCapital;
            const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
            
            const monthlySpending = new Map<string, number>();
            monthlyTransactions.filter((t: { type?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && t.budgetCategory).forEach((t: { budgetCategory?: string; amount?: number }) => {
                    const currentSpend = monthlySpending.get(t.budgetCategory!) || 0;
                    monthlySpending.set(t.budgetCategory!, currentSpend + Math.abs(Number(t.amount) ?? 0));
                });

            const monthlyBudgets = (data?.budgets ?? [])
                .map(budget => {
                    const spent = monthlySpending.get(budget.category) || 0;
                    const monthlyLimit = budgetToMonthly(budget);
                    const percentage = monthlyLimit > 0 ? (spent / monthlyLimit) * 100 : 0;
                    return { ...budget, spent, percentage, monthlyLimit };
                })
                .sort((a, b) => b.percentage - a.percentage);
            
            // Cashflow Chart Data (personal only)
            const monthlyCashflowMap = new Map<string, { income: number, expenses: number }>();
            const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
            transactions.filter((t: { date: string }) => new Date(t.date) >= twelveMonthsAgo).forEach((t: { date: string; type?: string; category?: string; amount?: number }) => {
                const monthKey = t.date.slice(0, 7);
                const current = monthlyCashflowMap.get(monthKey) || { income: 0, expenses: 0 };
                if (countsAsIncomeForCashflowKpi(t)) current.income += (Number(t.amount) ?? 0);
                if (countsAsExpenseForCashflowKpi(t)) current.expenses += Math.abs(Number(t.amount) ?? 0);
                monthlyCashflowMap.set(monthKey, current);
            });
            const monthlyCashflowData = Array.from(monthlyCashflowMap.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ name: new Date(key + '-02').toLocaleString('default', { month: 'short' }), ...value }));

            const uncategorizedTransactions = transactions.filter((t: { type?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && !t.budgetCategory);

            const recentTransactions = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            // 30-day projected cash (personal only)
            const cashAccounts = accounts.filter((a: { type?: string }) => ['Checking', 'Savings'].includes(a.type ?? ''));
            const currentCash = cashAccounts.reduce((sum: number, acc: { balance?: number }) => sum + Math.max(0, acc.balance ?? 0), 0);
            const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            const recentTx = transactions.filter((t: { date: string }) => new Date(t.date) >= sixMonthsAgo);
            const monthlyNets = new Map<string, number>();
            recentTx.forEach((t: Transaction) => {
                const key = t.date.slice(0, 7);
                let delta = 0;
                if (countsAsIncomeForCashflowKpi(t)) delta += Number(t.amount) ?? 0;
                else if (countsAsExpenseForCashflowKpi(t)) delta += Number(t.amount) ?? 0;
                monthlyNets.set(key, (monthlyNets.get(key) || 0) + delta);
            });
            const avgMonthlyNet = monthlyNets.size > 0
                ? Array.from(monthlyNets.values()).reduce((a, b) => a + b, 0) / monthlyNets.size
                : monthlyPnL;
            const projectedCash30d = currentCash + avgMonthlyNet;

            return {
                kpiSummary: {
                    netWorth, monthlyPnL, budgetVariance, roi, netWorthTrend,
                    pnlTrend: lastMonthPnL !== 0 ? ((monthlyPnL - lastMonthPnL) / Math.abs(lastMonthPnL)) * 100 : monthlyPnL > 0 ? 100 : 0,
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
    }, [data, exchangeRate, getAvailableCashForAccount]);

    useEffect(() => {
        if (!isAdmin) return;
        const nw = (kpiSummary as { netWorth?: number }).netWorth;
        if (typeof nw === 'number' && Number.isFinite(nw)) pushNetWorthSnapshot(nw);
    }, [isAdmin, kpiSummary]);

    const subsIntel = useMemo(() => {
        if (!data) return { monthlyEstimate: 0, count: 0 };
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        return subscriptionSpendMonthly(txs as import('../types').Transaction[], 3);
    }, [data]);

    const nextBestActions = useMemo(() => {
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const salaryCov = salaryToExpenseCoverage(txs as import('../types').Transaction[], 6);
        const goalAlerts = (data?.goals ?? []).map((g: { id: string; name: string; savingsAllocationPercent?: number }) => ({
            goalId: g.id,
            name: g.name,
            allocPct: Number(g.savingsAllocationPercent) || 0,
        }));
        return generateNextBestActions({
            emergencyFundMonths: emergencyFund.monthsCovered,
            runwayMonths: emergencyFund.monthsCovered,
            goalAlerts,
            salaryCoverageRatio: salaryCov?.ratio ?? undefined,
            nwSnapshotCount: listNetWorthSnapshots().length,
        });
    }, [data, emergencyFund.monthsCovered]);

    const financialHealthScore = useMemo(() => {
        if (!data) return null;
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const liabilities = (data as any)?.personalLiabilities ?? data?.liabilities ?? [];
        const goals = data?.goals ?? [];
        const sixMoAgo = new Date(); sixMoAgo.setMonth(sixMoAgo.getMonth() - 6);
        const incomeTx = txs.filter((t: { date: string; type?: string; category?: string; amount?: number }) =>
            countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= sixMoAgo);
        const liquidAssets = accounts
            .filter((a: { type?: string }) => ['Checking', 'Savings'].includes(a.type ?? ''))
            .reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
        const goalTotalTarget = goals.reduce((s: number, g: { targetAmount?: number }) => s + (g.targetAmount ?? 0), 0);

        const hasSufficientData = liquidAssets > 0 || incomeTx.length > 0 || goalTotalTarget > 0;
        if (!hasSufficientData) return null;

        const liquidityScore = Math.min(100, (emergencyFund.monthsCovered / EMERGENCY_FUND_TARGET_MONTHS) * 100);
        const savingsRatePct = savingsRate(txs);
        const totalMonthlyDebt = liabilities.reduce((s: number, l: { monthlyPayment?: number }) => s + (l.monthlyPayment ?? 0), 0);
        const grossMonthlyIncome = incomeTx.length > 0
            ? incomeTx.reduce((s: number, t: { amount?: number }) => s + (Number(t.amount) ?? 0), 0) / 6
            : 1;
        const debtResult = debtStressScore(totalMonthlyDebt, grossMonthlyIncome, liquidAssets);
        const goalTotalCurrent = goals.reduce((s: number, g: { currentAmount?: number }) => s + (g.currentAmount ?? 0), 0);
        const goalProgressScore = goalTotalTarget > 0 ? Math.min(100, (goalTotalCurrent / goalTotalTarget) * 100) : 100;
        const budgetVariance = (kpiSummary as { budgetVariance?: number }).budgetVariance ?? 0;
        const expenseControlScore = budgetVariance >= 0 ? Math.min(100, 50 + budgetVariance / 100) : Math.max(0, 50 + budgetVariance / 100);
        return personalFinanceHealthScore({
            liquidityScore,
            savingsRatePct,
            debtPressureScore: debtResult.score,
            goalProgressScore,
            expenseControlScore: Number.isFinite(expenseControlScore) ? expenseControlScore : 50,
        });
    }, [data, emergencyFund.monthsCovered, kpiSummary]);

    const getTrendString = (trend: number = 0) => trend.toFixed(1) + '%';
    const visibleKpiOrder: KpiCardKey[] = isAdmin ? KPI_CARD_ORDER : KPI_CARD_ORDER.filter((k) => k !== 'netWorth');

    const kpiCards = useMemo(() => {
        const cardProps = { density: kpiDensity as 'compact' | 'comfortable' };
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
            netWorth: <Card {...cardProps} title="My Net Worth" value={maskBalance(formatCurrencyString(kpiSummary.netWorth || 0))} trend={`${(kpiSummary.netWorthTrend || 0) >= 0 ? '+' : ''}${getTrendString(kpiSummary.netWorthTrend)}`} indicatorColor={(kpiSummary.netWorthTrend || 0) >= 0 ? 'green' : 'red'} tooltip="Personal wealth only. Items with Owner set (e.g. Father) are excluded." onClick={() => setActivePage('Summary')} icon={<ScaleIcon className="h-5 w-5 text-slate-400" />} />,
            monthlyPnL: <Card {...cardProps} title="This Month's P&L" value={formatCurrency(kpiSummary.monthlyPnL || 0, { colorize: true })} trend={(kpiSummary.monthlyPnL || 0) >= 0 ? 'Surplus' : 'Deficit'} indicatorColor={(kpiSummary.monthlyPnL || 0) >= 0 ? 'green' : 'red'} tooltip="Income minus expenses for the current month." onClick={() => setActivePage('Transactions')} icon={<BanknotesIcon className="h-5 w-5 text-slate-400" />} />,
            emergencyFund: <Card {...cardProps} title="Emergency Fund" value={emergencyFund.hasEssentialExpenseEstimate ? `${emergencyFund.monthsCovered.toFixed(1)} mo` : '—'} trend={efTrend} indicatorColor={efColor} tooltip={emergencyFund.hasEssentialExpenseEstimate ? `Liquid cash (Checking + Savings) covers ${emergencyFund.monthsCovered.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}` : 'Categorize essential spending or add budgets so we can estimate months of coverage.'} onClick={() => setActivePage('Summary')} icon={<ShieldCheckIcon className="h-5 w-5 text-slate-400" />} />,
            budgetVariance: <Card {...cardProps} title="Budget Variance" value={formatCurrency(kpiSummary.budgetVariance || 0, { colorize: true })} trend={(kpiSummary.budgetVariance || 0) >= 0 ? 'Under budget' : 'Over budget'} indicatorColor={(kpiSummary.budgetVariance || 0) >= 0 ? 'green' : 'red'} tooltip="Money saved from budget this month (positive = under budget). Over budget is shown in red." onClick={() => setActivePage('Budgets')} icon={<PiggyBankIcon className="h-5 w-5 text-slate-400" />} />,
            investmentRoi: <Card {...cardProps} title="Investment ROI" value={`${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} valueColor={(kpiSummary.roi || 0) >= 0 ? 'text-success' : 'text-danger'} trend={`${(kpiSummary.roi || 0) >= 0 ? '+' : ''}${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} indicatorColor={(kpiSummary.roi || 0) >= 0 ? 'green' : 'red'} tooltip="(Holdings + cash at broker) vs net deposits/withdrawals. Cash waiting to be invested counts as portfolio value." onClick={() => setActivePage('Investments')} icon={<ArrowTrendingUpIcon className="h-5 w-5 text-slate-400" />} />,
            investmentPlan: <Card {...cardProps} title="Investment Plan" value={`${investmentProgress.percent.toFixed(0)}%`} trend={investmentProgress.percent >= 100 ? 'Target met' : `${investmentProgress.percent.toFixed(0)}% of target`} indicatorColor={investmentProgress.percent >= 100 ? 'green' : 'yellow'} tooltip={`Progress: ${formatCurrencyString(investmentProgress.amount, { digits: 0, inCurrency: investmentProgress.planCurrency })} / ${formatCurrencyString(investmentProgress.target, { digits: 0, inCurrency: investmentProgress.planCurrency })} monthly.`} onClick={() => setActivePage('Investment Plan')} icon={<ArrowPathIcon className="h-5 w-5 text-primary" />} />,
            wealthUltra: <Card {...cardProps} title="Wealth Ultra" value="Engine" trend="Active" indicatorColor="green" tooltip="Automated portfolio allocation and order generation with performance tracking." onClick={() => setActivePage('Wealth Ultra')} icon={<ScaleIcon className="h-5 w-5 text-primary" />} />,
            marketEvents: <Card {...cardProps} title="Market Events" value="Calendar" trend="Upcoming" indicatorColor="yellow" tooltip="View upcoming FOMC meetings, earnings, and market-impacting events with AI insights." onClick={() => setActivePage('Market Events')} icon={<CalendarDaysIcon className="h-5 w-5 text-indigo-500" />} />,
        };
    }, [formatCurrencyString, formatCurrency, kpiSummary, investmentProgress, emergencyFund, setActivePage, kpiDensity, maskBalance]);
    
    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading dashboard" />
            </div>
        );
    }

    const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
    const goals = data?.goals ?? [];
    const isNewUser = accounts.length === 0 || (accounts.length <= 1 && recentTransactions.length === 0 && goals.length === 0);

    return (
        <div className="page-container">
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
                                <button type="button" onClick={() => setActivePage(step.page)} className="ml-auto text-primary font-medium hover:underline shrink-0">
                                    {step.action} →
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <AIExecutiveSummary />

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
                    <span className="text-slate-700">
                        <strong>Subscriptions (heuristic):</strong> ~{formatCurrencyString(subsIntel.monthlyEstimate, { digits: 0 })}/mo · {subsIntel.count} matching txs (3 mo)
                    </span>
                    <button type="button" onClick={() => setActivePage('Analysis')} className="text-primary font-medium hover:underline text-sm">
                        Details in Analysis →
                    </button>
                </div>
            )}

            {ready && (actionQueue.length > 0 || (analysis?.alerts?.length ?? 0) > 0) && (
                <div
                    className="mb-4 relative overflow-hidden rounded-2xl border-2 border-amber-400/90 bg-gradient-to-br from-amber-50 via-white to-orange-50/60 shadow-[0_4px_24px_-4px_rgba(245,158,11,0.35)] ring-1 ring-amber-200/70"
                    role="region"
                    aria-label="Cross-engine actions and alerts"
                >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-amber-500 via-orange-500 to-rose-500" aria-hidden />
                    <div className="pl-6 pr-4 py-4 sm:pl-7">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30">
                                <BoltIcon className="h-5 w-5" aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-bold tracking-tight text-slate-900">Cross-engine actions & alerts</h3>
                                <p className="text-xs text-slate-600 mt-0.5">Budget, cashflow, risk, and Wealth Ultra engines combined—review these first.</p>
                            </div>
                            <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end">
                                {(analysis?.alerts?.length ?? 0) > 0 && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-rose-900 shadow-sm">
                                        <ExclamationTriangleIcon className="h-3.5 w-3.5 text-rose-600" aria-hidden />
                                        {analysis!.alerts!.length} alert{analysis!.alerts!.length === 1 ? '' : 's'}
                                    </span>
                                )}
                                {actionQueue.length > 0 && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-900 shadow-sm">
                                        <ClipboardDocumentListIcon className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                                        {actionQueue.length} action{actionQueue.length === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>
                        </div>

                        {analysis?.alerts && analysis.alerts.length > 0 && (
                            <div className="mb-4 rounded-xl border-2 border-amber-300/80 bg-amber-50/95 p-3 shadow-inner">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900/90 mb-2 flex items-center gap-2">
                                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none" aria-hidden />
                                    Alerts
                                </p>
                                <ul className="space-y-2">
                                    {analysis.alerts.slice(0, 3).map((a, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2.5 rounded-lg border border-amber-200/60 bg-white/80 px-3 py-2.5 text-sm font-medium text-amber-950 shadow-sm"
                                        >
                                            <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
                                            <span>{a.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {actionQueue.length > 0 && (
                            <div className="rounded-xl border-2 border-sky-300/80 bg-sky-50/95 p-3 shadow-inner">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-sky-900/90 mb-2 flex items-center gap-2">
                                    <span className="inline-block h-2 w-2 rounded-full bg-sky-500" aria-hidden />
                                    Prioritized actions
                                </p>
                                <ul className="space-y-2">
                                    {actionQueue.slice(0, 5).map((item, i) => {
                                        const p = Math.round(item.priority);
                                        const priorityClass =
                                            p <= 2
                                                ? 'border-red-300 bg-red-100 text-red-900'
                                                : p <= 4
                                                  ? 'border-amber-300 bg-amber-100 text-amber-950'
                                                  : 'border-slate-200 bg-slate-100 text-slate-800';
                                        return (
                                            <li
                                                key={i}
                                                className="flex items-start justify-between gap-3 rounded-lg border border-sky-200/70 bg-white/90 px-3 py-2.5 text-sm text-slate-800 shadow-sm"
                                            >
                                                <span className="min-w-0 flex-1 leading-snug font-medium">{item.action}</span>
                                                <span
                                                    className={`shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums ${priorityClass}`}
                                                    title={`Priority ${p} (lower = more urgent)`}
                                                >
                                                    P{p}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {nextBestActions.length > 0 && (
                <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800 mb-2">Suggested actions</h3>
                    <ul className="space-y-2">
                        {nextBestActions.slice(0, 5).map((action) => (
                            <li key={action.id} className="flex flex-wrap items-start gap-2 text-sm">
                                <span className="text-slate-700 flex-1 min-w-0">{action.title}</span>
                                {action.link && (setActivePage || triggerPageAction) && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const page = action.link as Page;
                                            const subAction = (action as { data?: { action?: string } }).data?.action;
                                            if (subAction && triggerPageAction) triggerPageAction(page, subAction);
                                            else setActivePage?.(page);
                                        }}
                                        className="text-primary font-medium hover:underline shrink-0"
                                    >
                                        {action.linkLabel ?? action.link} →
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                <span className="font-medium text-slate-700">Financial health score:</span>
                {financialHealthScore != null ? (
                    <>
                        <span className={`font-bold tabular-nums ${financialHealthScore >= 70 ? 'text-green-700' : financialHealthScore >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                            {financialHealthScore}/100
                        </span>
                        <span className="text-slate-500 text-xs" title="Liquidity, savings rate, debt pressure, goal progress, expense control">
                            (liquidity, savings, debt, goals, expenses)
                        </span>
                    </>
                ) : (
                    <span className="text-slate-500 text-xs">
                        Add account balances, transactions, or goals to see your score.
                    </span>
                )}
            </div>

            <p className="text-xs text-slate-500 mb-1">
                Drag cards to reorder them; click a card to open that page.
            </p>
            <DraggableResizableGrid
                layoutKey="dashboard-kpi"
                itemOverflowY="visible"
                items={visibleKpiOrder.map((cardKey) => ({
                    id: cardKey,
                    content: (
                        <div className="min-h-[132px] flex flex-col h-full">
                            <div className="flex-1 min-h-0">{kpiCards[cardKey]}</div>
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

            {data?.accounts?.length > 0 && (
                <div className="section-card border-l-4 border-primary/40">
                    <h3 className="section-title text-base">Cash & emergency fund</h3>
                    <p className="text-2xl font-bold text-dark tabular-nums">{maskBalance(formatCurrencyString(projectedCash30d ?? currentCash ?? 0))}</p>
                    <p className="text-xs text-slate-500 mt-1">Projected cash in 30 days (current + average monthly flow).</p>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-sm text-slate-700"><strong>Emergency fund:</strong> {maskBalance(formatCurrencyString(emergencyFund.emergencyCash))} liquid cash (Checking + Savings only; money moved to investments is not double-counted here)
                            {emergencyFund.hasEssentialExpenseEstimate ? (
                                <> = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses (target {EMERGENCY_FUND_TARGET_MONTHS} months). {emergencyFund.shortfall > 0 ? `Shortfall: ${maskBalance(formatCurrencyString(emergencyFund.shortfall))}.` : 'Target met.'}</>
                            ) : (
                                <>. Add essential expense categories or budgets to estimate months covered.</>
                            )}
                        </p>
                    </div>
                </div>
            )}

            <AIFeed />
            
            
            {isAdmin ? (
                <div className="cards-grid grid grid-cols-1 lg:grid-cols-3">
                    <div
                        className="lg:col-span-3 section-card-hover section-card flex flex-col h-[400px] cursor-pointer"
                        onClick={() => setActivePage('Summary')}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setActivePage('Summary')}
                    >
                        <div className="flex-1 min-h-0 rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <NetWorthCompositionChart title="Net Worth Composition" />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="section-card border-l-4 border-amber-400">
                    <h3 className="section-title text-base">Admin-only metric</h3>
                    <p className="text-sm text-slate-600">Net worth visibility is restricted to Admin accounts. Your own budgets, transactions, and goals remain fully available.</p>
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-5">
                 <div className="lg:col-span-3 section-card-hover flex flex-col" onClick={() => setActivePage('Transactions')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivePage('Transactions')}>
                    <h3 className="section-title">Monthly Cash Flow</h3>
                    <div className="flex-1 min-h-[280px] rounded-lg overflow-hidden"><CashflowChart data={monthlyCashflowData} /></div>
                 </div>
                 <div className="lg:col-span-2 section-card-hover flex flex-col" onClick={() => setActivePage('Investments')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActivePage('Investments')}>
                    <h3 className="section-title">Investment Allocation & Performance</h3>
                    <div className="flex-1 min-h-[280px] rounded-lg overflow-hidden">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                 </div>
            </div>
            
            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                <AccountsOverview accounts={accountsForOverview} onClick={() => setActivePage('Accounts')} />
                <UpcomingBills />
            </div>

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                <BudgetHealth budgets={monthlyBudgets} onClick={() => setActivePage('Budgets')} />
                <RecentTransactions transactions={recentTransactions} onClick={() => setActivePage('Transactions')} />
            </div>

            {setActivePage && (
                <div className="section-card border border-slate-200/80 bg-slate-50/50">
                    <h3 className="section-title text-base mb-2">Quick next steps</h3>
                    <ul className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <li><button type="button" onClick={() => setActivePage('Transactions')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><CreditCardIcon className="h-4 w-4" />Categorize transactions</button> to keep budgets accurate</li>
                        <li><button type="button" onClick={() => setActivePage('Statement Upload')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><DocumentArrowUpIcon className="h-4 w-4" />Import from statements</button> (bank, SMS, or trading)</li>
                        <li><button type="button" onClick={() => setActivePage('Assets')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><GoldBarIcon className="h-4 w-4" />Manage assets</button> (property, commodities, metals)</li>
                        <li><button type="button" onClick={() => setActivePage('Plan')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><ClipboardDocumentListIcon className="h-4 w-4" />Update your Plan</button> to reflect income and expenses</li>
                        <li><button type="button" onClick={() => setActivePage('Summary')} className="text-primary hover:underline font-medium inline-flex items-center gap-1.5"><UsersIcon className="h-4 w-4" />View Summary</button> for AI persona and report card</li>
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

export default Dashboard;
