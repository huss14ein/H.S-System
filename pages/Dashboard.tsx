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
import { useAI } from '../context/AiContext';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, getPortfolioHoldingsValueInSAR } from '../utils/currencyMath';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import { loadDemoData } from '../services/demoDataService';
import { useMarketData } from '../context/MarketDataContext';
import { Holding, InvestmentPortfolio, HoldingAssetClass } from '../types';
import Modal from '../components/Modal';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { ChartBarIcon } from '../components/icons/ChartBarIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';

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
                    disabled={isLoading}
                    title="Generate a new summary"
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Summarizing...' : (summary ? 'Refresh Summary' : 'Generate Summary')}
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

            {!summary && !isLoading && !error && (
                <div className="text-center p-8 text-gray-500">
                    Click "Generate Summary" to run the executive summary.
                    {!isAiAvailable && <p className="mt-1 text-xs text-amber-700">AI provider unavailable right now — deterministic executive summary fallback remains active.</p>}
                </div>
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
        const recurringExpenses = new Map<string, { totalAmount: number; lastAmount: number; lastDate: Date; count: number }>();
        const now = new Date();

        // Find recurring fixed expenses from the last year
        data.transactions
            .filter(t => t.type === 'expense' && t.transactionNature === 'Fixed' && new Date(t.date) > new Date(now.getFullYear() -1, now.getMonth(), now.getDate()))
            .forEach(t => {
                const existing = recurringExpenses.get(t.description) || { totalAmount: 0, lastAmount: 0, lastDate: new Date(0), count: 0 };
                const thisAmount = Math.abs(t.amount);
                recurringExpenses.set(t.description, {
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
                                <p className="text-xs text-gray-500">
                                    Due: {formatDate(bill.date)} • Typical: {formatCurrencyString(bill.avgAmount)}
                                </p>
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

type KpiCardKey = 'netWorth' | 'monthlyPnL' | 'emergencyFund' | 'budgetVariance' | 'investmentRoi' | 'investmentPlan' | 'wealthUltra' | 'marketEvents';

const KPI_CARD_ORDER: KpiCardKey[] = ['netWorth', 'monthlyPnL', 'emergencyFund', 'budgetVariance', 'investmentRoi', 'investmentPlan', 'wealthUltra', 'marketEvents'];

type InvestmentViewMode = 'all' | 'portfolio' | 'assetClass';
type InvestmentTimePeriod = 'current' | '1M' | '3M' | '6M' | '1Y';

interface EnhancedHolding extends Holding {
    portfolioName?: string;
    portfolioCurrency?: string;
    gainLoss: number;
    gainLossPercent: number;
    valueInSAR: number;
}

const InvestmentChartEnhanced: React.FC<{ 
    holdings: EnhancedHolding[];
    portfolios: InvestmentPortfolio[];
    exchangeRate: number;
    formatCurrencyString: (value: number, options?: { digits?: number }) => string;
    setActivePage: (page: Page) => void;
}> = ({ holdings, portfolios, exchangeRate, formatCurrencyString, setActivePage }) => {
    const { lastUpdated, refreshPrices, isRefreshing } = useMarketData();
    const [viewMode, setViewMode] = useState<InvestmentViewMode>('all');
    const [timePeriod, setTimePeriod] = useState<InvestmentTimePeriod>('current');
    const [selectedHolding, setSelectedHolding] = useState<EnhancedHolding | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const portfolioMap = new Map(portfolios.map(p => [p.id, p]));

    const processedData = useMemo(() => {
        let dataToShow = holdings;

        // Filter by time period (for now, we only have current data, but structure is ready)
        if (timePeriod !== 'current') {
            // Future: filter by transaction dates
            dataToShow = holdings;
        }

        // Group by view mode
        if (viewMode === 'portfolio') {
            const byPortfolio = new Map<string, EnhancedHolding[]>();
            dataToShow.forEach(h => {
                const portfolioId = h.portfolio_id || 'unassigned';
                const portfolio = portfolioMap.get(portfolioId);
                const portfolioName = portfolio?.name || 'Unassigned';
                if (!byPortfolio.has(portfolioName)) {
                    byPortfolio.set(portfolioName, []);
                }
                byPortfolio.get(portfolioName)!.push(h);
            });

            // Aggregate holdings by portfolio
            return Array.from(byPortfolio.entries()).map(([portfolioName, portfolioHoldings]) => {
                const totalValue = portfolioHoldings.reduce((sum, h) => sum + h.valueInSAR, 0);
                const totalCost = portfolioHoldings.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
                const totalQuantity = portfolioHoldings.reduce((sum, h) => sum + h.quantity, 0);
                const totalGainLoss = totalValue - totalCost;
                const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
                return {
                    symbol: portfolioName,
                    name: portfolioName,
                    currentValue: totalValue,
                    valueInSAR: totalValue,
                    quantity: totalQuantity,
                    avgCost: totalQuantity > 0 ? totalCost / totalQuantity : 0,
                    gainLoss: totalGainLoss,
                    gainLossPercent: totalGainLossPercent,
                    portfolioName,
                    assetClass: undefined as HoldingAssetClass | undefined,
                } as EnhancedHolding;
            });
        } else if (viewMode === 'assetClass') {
            const byAssetClass = new Map<HoldingAssetClass | 'Other', EnhancedHolding[]>();
            dataToShow.forEach(h => {
                const assetClass = h.assetClass || 'Other';
                if (!byAssetClass.has(assetClass)) {
                    byAssetClass.set(assetClass, []);
                }
                byAssetClass.get(assetClass)!.push(h);
            });

            return Array.from(byAssetClass.entries()).map(([assetClass, classHoldings]) => {
                const totalValue = classHoldings.reduce((sum, h) => sum + h.valueInSAR, 0);
                const totalCost = classHoldings.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
                const totalGainLoss = totalValue - totalCost;
                const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
                return {
                    symbol: assetClass,
                    name: assetClass,
                    currentValue: totalValue,
                    valueInSAR: totalValue,
                    quantity: classHoldings.reduce((sum, h) => sum + h.quantity, 0),
                    avgCost: totalCost / classHoldings.reduce((sum, h) => sum + h.quantity, 0),
                    gainLoss: totalGainLoss,
                    gainLossPercent: totalGainLossPercent,
                    assetClass,
                } as EnhancedHolding;
            });
        }

        return dataToShow;
    }, [holdings, viewMode, timePeriod, portfolioMap]);

    const totalValue = processedData.reduce((sum, h) => sum + h.valueInSAR, 0);
    const totalCost = processedData.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

    const formatTimeAgo = (date: Date | null) => {
        if (!date) return 'Never';
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <>
            <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <h3 className="section-title">Investment Allocation & Performance</h3>
                        {lastUpdated && (
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                                <InformationCircleIcon className="h-3 w-3" />
                                Updated {formatTimeAgo(lastUpdated)}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); refreshPrices(); }}
                            disabled={isRefreshing}
                            className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                            title="Refresh prices"
                        >
                            {isRefreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {/* Summary Stats */}
                {processedData.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-3 p-2 bg-slate-50 rounded-lg">
                        <div className="text-center">
                            <p className="text-xs text-slate-500">Portfolio Value</p>
                            <p className="text-sm font-semibold text-dark">{formatCurrencyString(totalValue, { digits: 0 })}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500">Total Gain/Loss</p>
                            <p className={`text-sm font-semibold ${totalGainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {totalGainLoss >= 0 ? '+' : ''}{formatCurrencyString(totalGainLoss, { digits: 0 })}
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500">ROI</p>
                            <p className={`text-sm font-semibold ${totalGainLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {totalGainLossPercent >= 0 ? '+' : ''}{totalGainLossPercent.toFixed(1)}%
                            </p>
                        </div>
                    </div>
                )}

                {/* View Mode Toggle */}
                {processedData.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setViewMode('all'); }}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                    viewMode === 'all' ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                }`}
                                title="Show all holdings"
                            >
                                <Squares2X2Icon className="h-3 w-3 inline mr-1" />
                                All
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setViewMode('portfolio'); }}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                    viewMode === 'portfolio' ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                }`}
                                title="Group by portfolio"
                            >
                                <ChartBarIcon className="h-3 w-3 inline mr-1" />
                                Portfolio
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setViewMode('assetClass'); }}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                    viewMode === 'assetClass' ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                }`}
                                title="Group by asset class"
                            >
                                <ChartBarIcon className="h-3 w-3 inline mr-1" />
                                Asset Class
                            </button>
                        </div>
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                            {(['current', '1M', '3M', '6M', '1Y'] as InvestmentTimePeriod[]).map(period => (
                                <button
                                    key={period}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setTimePeriod(period); }}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        timePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title={`${period === 'current' ? 'Current' : period} view`}
                                >
                                    {period === 'current' ? 'Now' : period}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Chart */}
                <div className="flex-1 min-h-[280px] rounded-lg overflow-hidden">
                    {processedData.length > 0 ? (
                        <div 
                            className="h-full cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                // Allow clicking on chart to go to Investments page
                                setActivePage('Investments');
                            }}
                        >
                            <PerformanceTreemap 
                                data={processedData.map(h => ({
                                    ...h,
                                    symbol: h.symbol || h.name || 'Unknown',
                                    name: h.name || h.symbol || 'Unknown',
                                    currentValue: h.valueInSAR,
                                    gainLossPercent: h.gainLossPercent,
                                }))}
                            />
                        </div>
                    ) : (
                        <div className="empty-state h-full flex flex-col items-center justify-center p-6 text-center">
                            <ArrowTrendingUpIcon className="h-12 w-12 text-slate-300 mb-3" />
                            <p className="text-sm font-medium text-slate-600 mb-1">No investment holdings yet</p>
                            <p className="text-xs text-slate-500 mb-4">Add portfolios and holdings in the Investments page to see allocation and performance.</p>
                            <button 
                                type="button" 
                                onClick={(e) => { e.stopPropagation(); setActivePage('Investments'); }}
                                className="btn-primary text-sm px-4 py-2"
                            >
                                Go to Investments →
                            </button>
                        </div>
                    )}
                </div>

                {/* Holdings List (for click-through) */}
                {processedData.length > 0 && processedData.length <= 10 && (
                    <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {processedData.map((h, idx) => (
                            <div
                                key={idx}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedHolding(h);
                                    setIsModalOpen(true);
                                }}
                                className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer text-xs"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-800 truncate">{h.name || h.symbol}</p>
                                    {h.portfolioName && <p className="text-slate-500 text-xs">{h.portfolioName}</p>}
                                </div>
                                <div className="text-right ml-2">
                                    <p className="font-semibold text-slate-800">{formatCurrencyString(h.valueInSAR, { digits: 0 })}</p>
                                    <p className={`text-xs ${h.gainLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {h.gainLossPercent >= 0 ? '+' : ''}{h.gainLossPercent.toFixed(1)}%
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Holding Details Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={selectedHolding ? `${selectedHolding.name || selectedHolding.symbol} Details` : 'Holding Details'}
            >
                {selectedHolding && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs text-slate-500">Symbol</p>
                                <p className="font-semibold">{selectedHolding.symbol}</p>
                            </div>
                            {selectedHolding.portfolioName && (
                                <div>
                                    <p className="text-xs text-slate-500">Portfolio</p>
                                    <p className="font-semibold">{selectedHolding.portfolioName}</p>
                                </div>
                            )}
                            {selectedHolding.assetClass && (
                                <div>
                                    <p className="text-xs text-slate-500">Asset Class</p>
                                    <p className="font-semibold">{selectedHolding.assetClass}</p>
                                </div>
                            )}
                            {selectedHolding.portfolioCurrency && (
                                <div>
                                    <p className="text-xs text-slate-500">Currency</p>
                                    <p className="font-semibold">{selectedHolding.portfolioCurrency}</p>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs text-slate-500">Quantity</p>
                                <p className="font-semibold">{selectedHolding.quantity.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500">Avg Cost</p>
                                <p className="font-semibold">{formatCurrencyString(selectedHolding.avgCost, { digits: 2 })}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500">Current Value</p>
                                <p className="font-semibold">{formatCurrencyString(selectedHolding.valueInSAR, { digits: 2 })}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500">Total Cost</p>
                                <p className="font-semibold">{formatCurrencyString(selectedHolding.avgCost * selectedHolding.quantity, { digits: 2 })}</p>
                            </div>
                        </div>
                        <div className="border-t pt-4">
                            <div className="flex justify-between items-center">
                                <p className="text-sm font-medium text-slate-700">Gain/Loss</p>
                                <div className="text-right">
                                    <p className={`text-lg font-bold ${selectedHolding.gainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {selectedHolding.gainLoss >= 0 ? '+' : ''}{formatCurrencyString(selectedHolding.gainLoss, { digits: 2 })}
                                    </p>
                                    <p className={`text-sm ${selectedHolding.gainLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {selectedHolding.gainLossPercent >= 0 ? '+' : ''}{selectedHolding.gainLossPercent.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsModalOpen(false);
                                    setActivePage('Investments');
                                }}
                                className="btn-primary flex-1 text-sm"
                            >
                                View in Investments →
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );
};

const Dashboard: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const kpiDensity = 'compact' as const;


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
            const totalInvestmentsValue = getAllInvestmentsValueInSAR(data.investments || [], exchangeRate);
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
            
            // Investment data with portfolio and currency info
            const portfolioMap = new Map((data.investments || []).map(p => [p.id, p]));
            const allHoldings = (data.investments || []).flatMap(p => 
                (p.holdings || []).map(h => ({
                    ...h,
                    portfolio_id: p.id,
                    portfolioName: p.name,
                    portfolioCurrency: p.currency || 'USD',
                }))
            );
            const investmentTreemapData: EnhancedHolding[] = allHoldings
                .filter(h => h.quantity > 0 && (h.currentValue > 0 || (h.avgCost > 0 && h.quantity > 0))) // Filter out invalid holdings
                .map(h => {
                    const totalCost = (h.avgCost || 0) * (h.quantity || 0);
                    // Use currentValue if available, otherwise fallback to cost basis
                    const marketValue = h.currentValue > 0 ? h.currentValue : totalCost;
                    // Convert to SAR if needed
                    const valueInSAR = h.portfolioCurrency === 'SAR' ? marketValue : marketValue * exchangeRate;
                    const costInSAR = h.portfolioCurrency === 'SAR' ? totalCost : totalCost * exchangeRate;
                    const gainLoss = valueInSAR - costInSAR;
                    const gainLossPercent = costInSAR > 0 ? (gainLoss / costInSAR) * 100 : 0;
                    return { 
                        ...h, 
                        currentValue: marketValue,
                        valueInSAR,
                        gainLoss, 
                        gainLossPercent 
                    };
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
    }, [data, data?.commodityHoldings, exchangeRate]);
    

    const getTrendString = (trend: number = 0) => trend.toFixed(1) + '%';
    const visibleKpiOrder: KpiCardKey[] = isAdmin ? KPI_CARD_ORDER : KPI_CARD_ORDER.filter((k) => k !== 'netWorth');

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
            wealthUltra: <Card {...cardProps} title="Wealth Ultra" value="Engine" trend="Active" indicatorColor="green" tooltip="Automated portfolio allocation and order generation with performance tracking." onClick={() => setActivePage('Wealth Ultra')} icon={<ScaleIcon className="h-5 w-5 text-primary" />} />,
            marketEvents: <Card {...cardProps} title="Market Events" value="Calendar" trend="Upcoming" indicatorColor="yellow" tooltip="View upcoming FOMC meetings, earnings, federal tax policy, and market-impacting events with AI insights." onClick={() => setActivePage('Market Events')} icon={<CalendarDaysIcon className="h-5 w-5 text-indigo-500" />} />,
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
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(projectedCash30d ?? currentCash ?? 0)}</p>
                    <p className="text-xs text-slate-500 mt-1">Projected cash in 30 days (current + average monthly flow).</p>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-sm text-slate-700"><strong>Emergency fund:</strong> {formatCurrencyString(emergencyFund.emergencyCash)} liquid cash = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses (target {EMERGENCY_FUND_TARGET_MONTHS} months). {emergencyFund.shortfall > 0 ? `Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : 'Target met.'}</p>
                    </div>
                </div>
            )}

            <AIFeed />
            
            <div className="section-card border-l-4 border-slate-300">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="section-title text-base">Demo Data</h3>
                        <p className="text-xs text-slate-500 mt-1">Load demo data for testing all features</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            loadDemoData({ includeAll: true });
                            window.location.reload();
                        }}
                        className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                    >
                        Load All Demo Data
                    </button>
                </div>
            </div>
            
            {isAdmin ? (
                <div className="cards-grid grid grid-cols-1 lg:grid-cols-3">
                    <div className="lg:col-span-3 section-card flex flex-col h-[400px]">
                        <h3 className="section-title mb-4">Net Worth Composition</h3>
                        <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
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
                 <div className="lg:col-span-2 section-card flex flex-col">
                    <InvestmentChartEnhanced
                        holdings={investmentTreemapData}
                        portfolios={data.investments || []}
                        exchangeRate={exchangeRate}
                        formatCurrencyString={formatCurrencyString}
                        setActivePage={setActivePage}
                    />
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
