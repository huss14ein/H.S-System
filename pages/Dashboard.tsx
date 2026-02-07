import React, { useMemo, useContext, useState } from 'react';
import Card from '../components/Card';
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

interface ExtendedBudget extends Budget {
    spent: number;
}

const AccountsOverview: React.FC<{ accounts: Account[], onClick: () => void }> = ({ accounts, onClick }) => {
    const { formatCurrencyString } = useFormatCurrency();
    return (
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out cursor-pointer" onClick={onClick}>
            <h3 className="text-lg font-semibold mb-4 text-dark flex items-center"><BuildingLibraryIcon className="h-5 w-5 mr-2 text-primary"/> Accounts Overview</h3>
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
        <div className="bg-white p-6 rounded-lg shadow-md">
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
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out cursor-pointer" onClick={onClick}>
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
    return (
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out cursor-pointer" onClick={onClick}>
            <h3 className="text-lg font-semibold mb-4 text-dark">Budget Health (This Month)</h3>
            <div className="space-y-4">
                {budgets.slice(0, 4).map(budget => (
                    <div key={budget.category}>
                        <div className="flex justify-between items-baseline mb-1">
                            <span className="font-medium text-sm text-dark">{budget.category}</span>
                            <span className={`text-sm font-medium ${budget.spent > budget.limit ? 'text-danger' : 'text-gray-600'}`}>
                                {formatCurrencyString(budget.spent, { digits: 0 })} / {formatCurrencyString(budget.limit, { digits: 0 })}
                            </span>
                        </div>
                        <ProgressBar value={budget.spent} max={budget.limit} />
                        <p className={`text-right text-xs mt-1 font-medium ${budget.limit - budget.spent >= 0 ? 'text-gray-500' : 'text-danger'}`}>
                          {budget.limit - budget.spent >= 0 
                              ? `${formatCurrencyString(budget.limit - budget.spent, { digits: 0 })} left`
                              : `${formatCurrencyString(Math.abs(budget.limit - budget.spent), { digits: 0 })} over`
                          }
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
};

const Dashboard: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    const { kpiSummary, monthlyBudgets, investmentTreemapData, monthlyCashflowData, uncategorizedTransactions, recentTransactions } = useMemo(() => {
        if (!data) return { kpiSummary: {}, monthlyBudgets: [], investmentTreemapData: [], monthlyCashflowData: [], uncategorizedTransactions: [], recentTransactions: [] };

        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        // Current Month Calculations
        const monthlyTransactions = data.transactions.filter(t => new Date(t.date) >= firstDayOfMonth);
        const monthlyIncome = monthlyTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const monthlyExpenses = monthlyTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const monthlyPnL = monthlyIncome - monthlyExpenses;
        const totalBudget = data.budgets.reduce((sum, b) => sum + b.limit, 0);
        const budgetVariance = totalBudget - monthlyExpenses;
        
        // Previous Month P&L for trend
        const lastMonthTransactions = data.transactions.filter(t => {
            const date = new Date(t.date);
            return date >= firstDayOfLastMonth && date < firstDayOfMonth;
        });
        const lastMonthPnL = lastMonthTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0) - lastMonthTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        
        // Net Worth and Trend
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0) + data.accounts.filter(a => a.balance < 0).reduce((sum, acc) => sum + acc.balance, 0);
        const netWorth = totalAssets + totalLiabilities;
        const netWorthPrevMonth = netWorth - monthlyPnL; // Simplified: assumes NW change is only P&L
        const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / netWorthPrevMonth) * 100 : 0;
        
        // Investment data
        const allHoldings = data.investments.flatMap(p => p.holdings);
        const investmentTreemapData = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });
        const totalInvestmentsValue = investmentTreemapData.reduce((sum, h) => sum + h.currentValue, 0);
        const totalInvested = data.investmentTransactions.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
        const totalWithdrawn = Math.abs(data.investmentTransactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
        const netCapital = totalInvested - totalWithdrawn;
        const totalGainLoss = totalInvestmentsValue - netCapital;
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
        
        const monthlySpending = new Map<string, number>();
        monthlyTransactions.filter(t => t.type === 'expense' && t.budgetCategory).forEach(t => {
                const currentSpend = monthlySpending.get(t.budgetCategory!) || 0;
                monthlySpending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        const monthlyBudgets = data.budgets.map(budget => ({ ...budget, spent: monthlySpending.get(budget.category) || 0, }));
        
        // Cashflow Chart Data
        const monthlyCashflowMap = new Map<string, { income: number, expenses: number }>();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        data.transactions.filter(t => new Date(t.date) >= twelveMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            const current = monthlyCashflowMap.get(monthKey) || { income: 0, expenses: 0 };
            if(t.type === 'income') current.income += t.amount;
            else current.expenses += Math.abs(t.amount);
            monthlyCashflowMap.set(monthKey, current);
        });
        const monthlyCashflowData = Array.from(monthlyCashflowMap.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ name: new Date(key + '-02').toLocaleString('default', { month: 'short' }), ...value }));

        const uncategorizedTransactions = data.transactions.filter(t => t.type === 'expense' && !t.budgetCategory);
        
        const recentTransactions = [...data.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
            kpiSummary: {
                netWorth, monthlyPnL, budgetVariance, roi, netWorthTrend,
                pnlTrend: lastMonthPnL !== 0 ? ((monthlyPnL - lastMonthPnL) / Math.abs(lastMonthPnL)) * 100 : monthlyPnL > 0 ? 100 : 0,
            },
            monthlyBudgets,
            investmentTreemapData,
            monthlyCashflowData,
            uncategorizedTransactions,
            recentTransactions
        };
    }, [data]);
    
    const getTrendString = (trend: number = 0) => trend.toFixed(1) + '%';
    
    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-dark">Dashboard</h1>

            {uncategorizedTransactions.length > 0 && (
                <div 
                    className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 p-4 rounded-r-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() => setIsReviewModalOpen(true)}
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
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card title="Net Worth" value={formatCurrencyString(kpiSummary.netWorth || 0)} trend={`${(kpiSummary.netWorthTrend || 0) >= 0 ? '+' : ''}${getTrendString(kpiSummary.netWorthTrend)}`} onClick={() => setActivePage('Summary')} icon={<ScaleIcon className="h-5 w-5 text-gray-400" />} />
                <Card title="This Month's P&L" value={formatCurrencyString(kpiSummary.monthlyPnL || 0)} trend={(kpiSummary.monthlyPnL || 0) >= 0 ? 'SURPLUS' : 'DEFICIT'} tooltip="Income minus expenses for the current month." onClick={() => setActivePage('Transactions')} icon={<BanknotesIcon className="h-5 w-5 text-gray-400" />} />
                <Card title="Budget Variance" value={formatCurrencyString(kpiSummary.budgetVariance || 0)} trend={(kpiSummary.budgetVariance || 0) >= 0 ? 'UNDER' : 'OVER'} tooltip="How much you are under or over your total monthly budget." onClick={() => setActivePage('Transactions')} icon={<PiggyBankIcon className="h-5 w-5 text-gray-400" />} />
                <Card title="Total Investment ROI" value={`${((kpiSummary.roi || 0) * 100).toFixed(1)}%`} tooltip="Return on Investment based on total capital invested." onClick={() => setActivePage('Investments')} icon={<ArrowTrendingUpIcon className="h-5 w-5 text-gray-400" />} />
            </div>

            <AIFeed />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-3 bg-white p-6 rounded-lg shadow-md h-[400px]">
                    <NetWorthCompositionChart title="Net Worth Composition" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                 <div className="lg:col-span-3 bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out cursor-pointer" onClick={() => setActivePage('Transactions')}>
                    <h3 className="text-lg font-semibold text-dark mb-4">Monthly Cash Flow</h3>
                    <div className="h-80"><CashflowChart data={monthlyCashflowData} /></div>
                 </div>
                 <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out cursor-pointer" onClick={() => setActivePage('Investments')}>
                    <h3 className="text-lg font-semibold text-dark mb-4">Investment Allocation & Performance</h3>
                    <div className="h-80"><PerformanceTreemap data={investmentTreemapData} /></div>
                 </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AccountsOverview accounts={data.accounts} onClick={() => setActivePage('Accounts')} />
                <UpcomingBills />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BudgetHealth budgets={monthlyBudgets} onClick={() => setActivePage('Transactions')} />
                <RecentTransactions transactions={recentTransactions} onClick={() => setActivePage('Transactions')} />
            </div>
            
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