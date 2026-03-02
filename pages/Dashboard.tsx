import React, { useMemo, useContext, useState, useCallback, useEffect } from 'react';
import Card from '../components/Card';
import DraggableResizableGrid from '../components/DraggableResizableGrid';
import { Transaction, Page, Budget, Account } from '../types';
import ProgressBar from '../components/ProgressBar';
import CashflowChart from '../components/charts/CashflowChart';
import { DataContext } from '../context/DataContext';
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
import { useAI } from '../context/AiContext';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';

interface ExtendedBudget extends Budget {
    spent: number;
    percentage: number;
    monthlyLimit?: number;
}

const AIExecutiveSummary: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const [summary, setSummary] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setSummary('');
        try {
            const result = await getAIExecutiveSummary(data);
            setSummary(result);
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [data]);

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
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Summarizing...' : 'Generate Summary'}
                </button>
            </div>
            
            {isLoading && <div className="text-center p-8 text-gray-500">Analyzing your financial picture...</div>}
            
            {!isLoading && error && (
                <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-r-lg">
                    <h4 className="font-bold">Summary Error</h4>
                    <SafeMarkdownRenderer content={error} />
                    <button type="button" onClick={handleGenerate} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200">Retry</button>
                </div>
            )}

            {!isAiAvailable ? (
                <div className="text-center p-4 text-gray-500 bg-gray-50 rounded-md">
                    <p className="font-semibold">AI Features Disabled</p>
                    <p className="text-sm">Please set your Gemini API key to enable this feature.</p>
                </div>
            ) : (
                !summary && !isLoading && !error && (
                    <div className="text-center p-8 text-gray-500">
                        Click "Generate Summary" for a high-level overview and strategic advice from your expert advisor.
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
    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
            <h3 className="section-title"><BuildingLibraryIcon className="h-5 w-5 text-primary"/> Accounts Overview</h3>
            <ul className="space-y-3">
                {accounts.map(acc => (
                    <li key={acc.id} className="flex justify-between items-center text-sm">
                        <div>
                            <p className="font-medium text-dark">{acc.name}</p>
                            <p className="text-xs text-gray-500">{acc.type}</p>
                        </div>
                        <p className={`font-semibold ${acc.balance >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrencyString(acc.balance)}</p>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const UpcomingBills: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const upcomingBills = useMemo(() => {
        const recurringExpenses = new Map<string, { amount: number; lastDate: Date; count: number }>();
        const now = new Date();

        // Find recurring fixed expenses from the last year
        data.transactions
            .filter(t => t.type === 'expense' && t.transactionNature === 'Fixed' && new Date(t.date) > new Date(now.getFullYear() -1, now.getMonth(), now.getDate()))
            .forEach(t => {
                const existing = recurringExpenses.get(t.description) || { amount: 0, lastDate: new Date(0), count: 0 };
                recurringExpenses.set(t.description, {
                    amount: Math.abs(t.amount),
                    lastDate: new Date(Math.max(existing.lastDate.getTime(), new Date(t.date).getTime())),
                    count: existing.count + 1
                });
            });

        const bills = [];
        for (const [name, { amount, lastDate, count }] of recurringExpenses.entries()) {
            if (count > 1) { // Consider it recurring if it happened more than once
                const nextDueDate = new Date(lastDate);
                // Simple assumption of monthly recurrence for this example
                nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                
                if (nextDueDate > now && nextDueDate < new Date(now.getFullYear(), now.getMonth() + 2, 0)) { // If due in the next ~month
                     bills.push({ name, date: nextDueDate, amount });
                }
            }
        }
        return bills.sort((a,b) => a.date.getTime() - b.date.getTime()).slice(0, 3);
    }, [data.transactions]);

    return (
        <div className="section-card">
            <h3 className="text-lg font-semibold mb-4 text-dark flex items-center"><CalendarDaysIcon className="h-5 w-5 mr-2 text-primary"/> Upcoming Bills</h3>
            {upcomingBills.length > 0 ? (
                <ul className="space-y-3">
                    {upcomingBills.map(bill => (
                        <li key={bill.name} className="flex justify-between items-center text-sm">
                            <div>
                                <p className="font-medium text-dark">{bill.name}</p>
                                <p className="text-xs text-gray-500">Due: {formatDate(bill.date)}</p>
                            </div>
                            <p className="font-semibold text-dark">{formatCurrencyString(bill.amount)}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-center text-gray-500 py-4">No upcoming recurring bills detected this month.</p>
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
                            <p className="font-medium text-dark">{t.description}</p>
                            <p className="text-sm text-gray-500">{formatDate(t.date)}</p>
                        </div>
                        <p className="font-semibold">
                            {formatCurrency(t.amount, { colorize: true })}
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
        if (percentage > 100) return { text: 'Over Budget', colorClass: 'bg-danger', textColorClass: 'text-danger' };
        if (percentage > 75) return { text: 'Nearing Limit', colorClass: 'bg-warning', textColorClass: 'text-warning' };
        return { text: 'On Track', colorClass: 'bg-success', textColorClass: 'text-success' };
    };

    return (
        <div className="section-card-hover" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
            <h3 className="text-lg font-semibold mb-4 text-dark">Budget Health (This Month)</h3>
            <div className="space-y-4">
                {budgets.slice(0, 4).map(budget => {
                    const status = getStatus(budget.percentage);
                    return (
                        <div key={budget.category} className="border-t pt-3 first:border-t-0">
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-bold text-dark">{budget.category}</span>
                                <span className={`text-sm font-semibold flex items-center gap-1.5 ${status.textColorClass}`}>
                                    <span className={`w-2 h-2 rounded-full ${status.colorClass}`}></span>
                                    {status.text}
                                </span>
                            </div>
                            <ProgressBar value={budget.spent} max={budget.monthlyLimit ?? budget.limit} color={status.colorClass} />
                            <div className="flex justify-between items-baseline text-xs text-gray-500 mt-1">
                                <span>
                                    <span className="font-semibold text-dark">{formatCurrencyString(budget.spent, { digits: 0 })}</span> / {formatCurrencyString(budget.monthlyLimit ?? budget.limit, { digits: 0 })}
                                    <span className="font-medium text-gray-600"> ({budget.percentage.toFixed(0)}%)</span>
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

type KpiCardKey = 'netWorth' | 'monthlyPnL' | 'emergencyFund' | 'budgetVariance' | 'investmentRoi' | 'investmentPlan';

const KPI_CARD_ORDER: KpiCardKey[] = ['netWorth', 'monthlyPnL', 'emergencyFund', 'budgetVariance', 'investmentRoi', 'investmentPlan'];

const Dashboard: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const kpiDensity = 'compact' as const;

    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0 };
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const monthlyInvested = data.investmentTransactions
            .filter(t => {
                const d = new Date(t.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy';
            })
            .reduce((sum, t) => sum + t.total, 0);
        
        return {
            percent: Math.min((monthlyInvested / (data.investmentPlan.monthlyBudget || 1)) * 100, 100),
            amount: monthlyInvested,
            target: data.investmentPlan.monthlyBudget
        };
    }, [data]);


    const { kpiSummary, monthlyBudgets, investmentTreemapData, monthlyCashflowData, uncategorizedTransactions, recentTransactions, projectedCash30d, currentCash } = useMemo(() => {
        try {
            if (!data) return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [], projectedCash30d: 0, currentCash: 0 };

            const now = new Date();
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

            // Current Month Calculations
            const monthlyTransactions = (data.transactions || []).filter(t => new Date(t.date) >= firstDayOfMonth);
            const monthlyIncome = monthlyTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
            const monthlyExpenses = monthlyTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
            const monthlyPnL = monthlyIncome - monthlyExpenses;
            const budgetToMonthly = (b: { limit: number; period?: string }) => b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
            const totalBudget = (data.budgets || []).reduce((sum, b) => sum + budgetToMonthly(b), 0);
            const budgetVariance = totalBudget - monthlyExpenses;
            
            // Previous Month P&L for trend
            const lastMonthTransactions = (data.transactions || []).filter(t => {
                const date = new Date(t.date);
                return date >= firstDayOfLastMonth && date < firstDayOfMonth;
            });
            const lastMonthPnL = lastMonthTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0) - lastMonthTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
            
            // Net Worth and Trend — include investment value only via totalInvestmentsValue; exclude Investment accounts from balance sum to avoid double-counting (their balance may reflect portfolio value in some flows)
            const totalCommodities = (data.commodityHoldings || []).reduce((sum, ch) => sum + ch.currentValue, 0);
            const totalInvestmentsValue = (data.investments || []).reduce((sum, p) => sum + (p.holdings ?? []).reduce((hSum, h) => hSum + h.currentValue, 0), 0);
            const cashSavingsAccounts = (data.accounts || []).filter(a => a.type === 'Checking' || a.type === 'Savings');
            const cashAndSavingsPositive = cashSavingsAccounts.filter(a => (a.balance ?? 0) > 0).reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
            const cashAndSavingsNegative = cashSavingsAccounts.filter(a => (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0);
            const totalAssets = (data.assets || []).reduce((sum, asset) => sum + asset.value, 0) +
                               cashAndSavingsPositive +
                               totalCommodities +
                               totalInvestmentsValue;
            const totalDebt = (data.liabilities || []).filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((sum: number, liab: { amount?: number }) => sum + Math.abs(liab.amount ?? 0), 0) + (data.accounts || []).filter(a => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0) + cashAndSavingsNegative;
            const totalReceivable = (data.liabilities || []).filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((sum: number, liab: { amount?: number }) => sum + (liab.amount ?? 0), 0);
            const netWorth = totalAssets - totalDebt + totalReceivable;
            const netWorthPrevMonth = netWorth - monthlyPnL; // Simplified: assumes NW change is only P&L
            const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / netWorthPrevMonth) * 100 : 0;
            
            // Investment data
            const allHoldings = (data.investments || []).flatMap(p => p.holdings || []);
            const investmentTreemapData = allHoldings.map(h => {
                 const totalCost = h.avgCost * h.quantity;
                 const gainLoss = h.currentValue - totalCost;
                 const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
                 return { ...h, gainLoss, gainLossPercent };
            });
            const totalInvested = (data.investmentTransactions || []).filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
            const totalWithdrawn = Math.abs((data.investmentTransactions || []).filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
            const netCapital = totalInvested - totalWithdrawn;
            const totalGainLoss = totalInvestmentsValue - netCapital;
            const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
            
            const monthlySpending = new Map<string, number>();
            monthlyTransactions.filter(t => t.type === 'expense' && t.budgetCategory).forEach(t => {
                    const currentSpend = monthlySpending.get(t.budgetCategory!) || 0;
                    monthlySpending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
                });

            const monthlyBudgets = (data.budgets || [])
                .map(budget => {
                    const spent = monthlySpending.get(budget.category) || 0;
                    const monthlyLimit = budgetToMonthly(budget);
                    const percentage = monthlyLimit > 0 ? (spent / monthlyLimit) * 100 : 0;
                    return { ...budget, spent, percentage, monthlyLimit };
                })
                .sort((a, b) => b.percentage - a.percentage);
            
            // Cashflow Chart Data
            const monthlyCashflowMap = new Map<string, { income: number, expenses: number }>();
            const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
            (data.transactions || []).filter(t => new Date(t.date) >= twelveMonthsAgo).forEach(t => {
                const monthKey = t.date.slice(0, 7); // YYYY-MM
                const current = monthlyCashflowMap.get(monthKey) || { income: 0, expenses: 0 };
                if(t.type === 'income') current.income += t.amount;
                else current.expenses += Math.abs(t.amount);
                monthlyCashflowMap.set(monthKey, current);
            });
            const monthlyCashflowData = Array.from(monthlyCashflowMap.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ name: new Date(key + '-02').toLocaleString('default', { month: 'short' }), ...value }));

            const uncategorizedTransactions = (data.transactions || []).filter(t => t.type === 'expense' && !t.budgetCategory);
            
            const recentTransactions = [...(data.transactions || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            // 30-day projected cash: current cash + average monthly net (last 6 months)
            const cashAccounts = (data.accounts || []).filter(a => ['Checking', 'Savings'].includes(a.type));
            const currentCash = cashAccounts.reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
            const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            const recentTx = (data.transactions || []).filter(t => new Date(t.date) >= sixMonthsAgo);
            const monthlyNets = new Map<string, number>();
            recentTx.forEach(t => {
                const key = t.date.slice(0, 7);
                monthlyNets.set(key, (monthlyNets.get(key) || 0) + t.amount);
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
    }, [data, data?.commodityHoldings]);
    

    const getTrendString = (trend: number = 0) => trend.toFixed(1) + '%';

    const kpiCards = useMemo(() => {
        const cardProps = { density: kpiDensity as 'compact' | 'comfortable' };
        const efTrend = emergencyFund.status === 'healthy' ? `${EMERGENCY_FUND_TARGET_MONTHS} mo target met` : emergencyFund.status === 'adequate' ? 'Adequate' : emergencyFund.status === 'low' ? 'Build more' : 'Critical';
        const efColor = emergencyFund.status === 'healthy' ? 'green' : emergencyFund.status === 'adequate' ? 'green' : emergencyFund.status === 'low' ? 'yellow' : 'red';
        return {
            netWorth: <Card {...cardProps} title="Net Worth" value={formatCurrencyString(kpiSummary.netWorth || 0)} trend={`${(kpiSummary.netWorthTrend || 0) >= 0 ? '+' : ''}${getTrendString(kpiSummary.netWorthTrend)}`} indicatorColor={(kpiSummary.netWorthTrend || 0) >= 0 ? 'green' : 'red'} onClick={() => setActivePage('Summary')} icon={<ScaleIcon className="h-5 w-5 text-slate-400" />} />,
            monthlyPnL: <Card {...cardProps} title="This Month's P&L" value={formatCurrency(kpiSummary.monthlyPnL || 0, { colorize: true })} trend={(kpiSummary.monthlyPnL || 0) >= 0 ? 'Surplus' : 'Deficit'} indicatorColor={(kpiSummary.monthlyPnL || 0) >= 0 ? 'green' : 'red'} tooltip="Income minus expenses for the current month." onClick={() => setActivePage('Transactions')} icon={<BanknotesIcon className="h-5 w-5 text-slate-400" />} />,
            emergencyFund: <Card {...cardProps} title="Emergency Fund" value={`${emergencyFund.monthsCovered.toFixed(1)} mo`} trend={efTrend} indicatorColor={efColor} tooltip={`Liquid cash (Checking + Savings) covers ${emergencyFund.monthsCovered.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}`} onClick={() => setActivePage('Summary')} icon={<ShieldCheckIcon className="h-5 w-5 text-slate-400" />} />,
            budgetVariance: <Card {...cardProps} title="Budget Variance" value={formatCurrency(kpiSummary.budgetVariance || 0, { colorize: true })} trend={(kpiSummary.budgetVariance || 0) >= 0 ? 'Under budget' : 'Over budget'} indicatorColor={(kpiSummary.budgetVariance || 0) >= 0 ? 'green' : 'red'} tooltip="Money saved from budget this month (positive = under budget). Over budget is shown in red." onClick={() => setActivePage('Budgets')} icon={<PiggyBankIcon className="h-5 w-5 text-slate-400" />} />,
            investmentRoi: <Card {...cardProps} title="Investment ROI" value={`${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} valueColor={(kpiSummary.roi || 0) >= 0 ? 'text-success' : 'text-danger'} trend={`${(kpiSummary.roi || 0) >= 0 ? '+' : ''}${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} indicatorColor={(kpiSummary.roi || 0) >= 0 ? 'green' : 'red'} tooltip="Return on Investment based on total capital invested." onClick={() => setActivePage('Investments')} icon={<ArrowTrendingUpIcon className="h-5 w-5 text-slate-400" />} />,
            investmentPlan: <Card {...cardProps} title="Investment Plan" value={`${investmentProgress.percent.toFixed(0)}%`} trend={investmentProgress.percent >= 100 ? 'Target met' : `${investmentProgress.percent.toFixed(0)}% of target`} indicatorColor={investmentProgress.percent >= 100 ? 'green' : 'yellow'} tooltip={`Progress: ${formatCurrencyString(investmentProgress.amount, { digits: 0 })} / ${formatCurrencyString(investmentProgress.target, { digits: 0 })} monthly.`} onClick={() => setActivePage('Investments')} icon={<ArrowPathIcon className="h-5 w-5 text-primary" />} />,
        };
    }, [formatCurrencyString, formatCurrency, kpiSummary, investmentProgress, emergencyFund, setActivePage, kpiDensity]);
    
    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="page-container">
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
                            <button type="button" onClick={() => setActivePage('Transactions')} className="text-primary font-medium hover:underline ml-1">
                                View in Transactions →
                            </button>
                        )}
                    </div>
                );
            })()}
            
            <DraggableResizableGrid
                layoutKey="dashboard-kpi"
                items={KPI_CARD_ORDER.map((cardKey) => ({
                    id: cardKey,
                    content: <div className="min-h-[132px] flex flex-col h-full">{kpiCards[cardKey]}</div>,
                    defaultW: 2,
                    defaultH: 2,
                    minW: 1,
                    minH: 1,
                }))}
                cols={12}
                rowHeight={72}
            />

            {data?.accounts?.length > 0 && (
                <div className="section-card border-l-4 border-primary/40">
                    <h3 className="section-title text-base">Cash & emergency fund</h3>
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(projectedCash30d ?? currentCash ?? 0)}</p>
                    <p className="text-xs text-slate-500 mt-1">Projected cash in 30 days (current + average monthly flow).</p>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-sm text-slate-700"><strong>Emergency fund:</strong> {formatCurrencyString(emergencyFund.emergencyCash)} liquid cash = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses (target {EMERGENCY_FUND_TARGET_MONTHS} months). {emergencyFund.shortfall > 0 ? `Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : 'Target met.'}</p>
                    </div>
                </div>
            )}

            <AIFeed />
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3">
                <div className="lg:col-span-3 section-card flex flex-col h-[400px]">
                    <h3 className="section-title mb-4">Net Worth Composition</h3>
                    <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                        <NetWorthCompositionChart title="Net Worth Composition" />
                    </div>
                </div>
            </div>

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
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                <AccountsOverview accounts={data.accounts} onClick={() => setActivePage('Accounts')} />
                <UpcomingBills />
            </div>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                <BudgetHealth budgets={monthlyBudgets} onClick={() => setActivePage('Budgets')} />
                <RecentTransactions transactions={recentTransactions} onClick={() => setActivePage('Transactions')} />
            </div>

            {setActivePage && (
                <div className="section-card border border-slate-200/80 bg-slate-50/50">
                    <h3 className="section-title text-base mb-2">Quick next steps</h3>
                    <ul className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <li><button type="button" onClick={() => setActivePage('Transactions')} className="text-primary hover:underline font-medium">Categorize transactions</button> to keep budgets accurate</li>
                        <li><button type="button" onClick={() => setActivePage('Plan')} className="text-primary hover:underline font-medium">Update your Plan</button> to reflect income and expenses</li>
                        <li><button type="button" onClick={() => setActivePage('Summary')} className="text-primary hover:underline font-medium">View Summary</button> for AI persona and report card</li>
                    </ul>
                </div>
            )}
            
            <TransactionReviewModal 
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                transactions={uncategorizedTransactions}
                budgetCategories={data.budgets.map(b => b.category)}
            />
        </div>
    );
};

export default Dashboard;