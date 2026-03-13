import React, { useState, useMemo, useCallback, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { getAIFinancialPersona, formatAiError } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import Card from '../components/Card';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import NetWorthCompositionChart from '../components/charts/NetWorthCompositionChart';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { PersonaAnalysis, ReportCardItem } from '../types';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import PageLayout from '../components/PageLayout';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, toSAR } from '../utils/currencyMath';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import type { Page } from '../types';
import { useMarketData } from '../context/MarketDataContext';
import { InvestmentPortfolio, HoldingAssetClass } from '../types';
import Modal from '../components/Modal';
import { InformationCircleIcon as InfoIcon } from '../components/icons/InformationCircleIcon';
import { ChartBarIcon } from '../components/icons/ChartBarIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';
import { buildHouseholdBudgetPlan, buildHouseholdEngineInputFromData } from '../services/householdBudgetEngine';
import { deriveCashflowStressSummary } from '../services/householdBudgetStress';
import { computeRiskLaneFromData } from '../services/riskLaneEngine';
import { computeLiquidityRunwayFromData } from '../services/liquidityRunwayEngine';
import { computeDisciplineScore } from '../services/disciplineScoreEngine';
import { runShockDrill, SHOCK_TEMPLATES } from '../services/shockDrillEngine';

const getRatingColors = (rating: ReportCardItem['rating']) => {
    switch (rating) {
        case 'Excellent': return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-500', icon: <CheckCircleIcon className="h-6 w-6 text-green-500" /> };
        case 'Good': return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-500', icon: <CheckCircleIcon className="h-6 w-6 text-blue-500" /> };
        case 'Needs Improvement': return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-500', icon: <InformationCircleIcon className="h-6 w-6 text-yellow-500" /> };
        default: return { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-500', icon: null };
    }
};

const MetricIcon: React.FC<{ metric: string }> = ({ metric }) => {
    const iconClass = "h-8 w-8 text-primary";
    switch (metric) {
        case 'Savings Rate': return <PiggyBankIcon className={iconClass} />;
        case 'Debt Management': return <ShieldCheckIcon className={iconClass} />;
        case 'Emergency Fund': return <BanknotesIcon className={iconClass} />;
        case 'Investment Strategy': return <ArrowTrendingUpIcon className={iconClass} />;
        default: return <LightBulbIcon className={iconClass} />;
    }
};

const CheckCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const InformationCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

type InvestmentViewMode = 'all' | 'portfolio' | 'assetClass';

interface EnhancedHoldingSummary {
    id: string;
    symbol: string;
    name?: string;
    quantity: number;
    avgCost: number;
    currentValue: number;
    valueInSAR: number;
    portfolio_id?: string;
    portfolioName?: string;
    portfolioCurrency?: string;
    assetClass?: HoldingAssetClass;
    gainLoss: number;
    gainLossPercent: number;
}

const EnhancedInvestmentChart: React.FC<{
    holdings: EnhancedHoldingSummary[];
    portfolios: InvestmentPortfolio[];
    exchangeRate: number;
    formatCurrencyString: (value: number, options?: { digits?: number }) => string;
    setActivePage?: (page: Page) => void;
}> = ({ holdings, portfolios, exchangeRate, formatCurrencyString, setActivePage }) => {
    const { lastUpdated, refreshPrices, isRefreshing } = useMarketData();
    const [viewMode, setViewMode] = useState<InvestmentViewMode>('all');
    const [selectedHolding, setSelectedHolding] = useState<EnhancedHoldingSummary | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const portfolioMap = new Map(portfolios.map(p => [p.id, p]));

    const processedData = useMemo(() => {
        if (viewMode === 'portfolio') {
            const byPortfolio = new Map<string, EnhancedHoldingSummary[]>();
            holdings.forEach(h => {
                const portfolioName = h.portfolioName || 'Unassigned';
                if (!byPortfolio.has(portfolioName)) {
                    byPortfolio.set(portfolioName, []);
                }
                byPortfolio.get(portfolioName)!.push(h);
            });

            return Array.from(byPortfolio.entries()).map(([portfolioName, portfolioHoldings]) => {
                const totalValue = portfolioHoldings.reduce((sum, h) => sum + h.valueInSAR, 0);
                const totalCost = portfolioHoldings.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
                const totalQuantity = portfolioHoldings.reduce((sum, h) => sum + h.quantity, 0);
                const totalGainLoss = totalValue - totalCost;
                const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
                return {
                    id: `portfolio-${portfolioName}`,
                    symbol: portfolioName,
                    name: portfolioName,
                    currentValue: totalValue,
                    valueInSAR: totalValue,
                    quantity: totalQuantity,
                    avgCost: totalQuantity > 0 ? totalCost / totalQuantity : 0,
                    gainLoss: totalGainLoss,
                    gainLossPercent: totalGainLossPercent,
                    portfolioName,
                } as EnhancedHoldingSummary;
            });
        } else if (viewMode === 'assetClass') {
            const byAssetClass = new Map<HoldingAssetClass | 'Other', EnhancedHoldingSummary[]>();
            holdings.forEach(h => {
                const assetClass = h.assetClass || 'Other';
                if (!byAssetClass.has(assetClass)) {
                    byAssetClass.set(assetClass, []);
                }
                byAssetClass.get(assetClass)!.push(h);
            });

            return Array.from(byAssetClass.entries()).map(([assetClass, classHoldings]) => {
                const totalValue = classHoldings.reduce((sum, h) => sum + h.valueInSAR, 0);
                const totalCost = classHoldings.reduce((sum, h) => sum + (h.avgCost * h.quantity), 0);
                const totalQuantity = classHoldings.reduce((sum, h) => sum + h.quantity, 0);
                const totalGainLoss = totalValue - totalCost;
                const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
                return {
                    id: `assetclass-${assetClass}`,
                    symbol: assetClass,
                    name: assetClass,
                    currentValue: totalValue,
                    valueInSAR: totalValue,
                    quantity: totalQuantity,
                    avgCost: totalQuantity > 0 ? totalCost / totalQuantity : 0,
                    gainLoss: totalGainLoss,
                    gainLossPercent: totalGainLossPercent,
                    assetClass,
                } as EnhancedHoldingSummary;
            });
        }

        return holdings;
    }, [holdings, viewMode, portfolioMap]);

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
            <div className="section-card flex flex-col h-[450px]">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <h3 className="section-title">Investment Allocation & Performance</h3>
                        {lastUpdated && (
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                                <InfoIcon className="h-3 w-3" />
                                Updated {formatTimeAgo(lastUpdated)}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => refreshPrices()}
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
                    <div className="flex items-center gap-2 mb-2">
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                            <button
                                type="button"
                                onClick={() => setViewMode('all')}
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
                                onClick={() => setViewMode('portfolio')}
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
                                onClick={() => setViewMode('assetClass')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                    viewMode === 'assetClass' ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                }`}
                                title="Group by asset class"
                            >
                                <ChartBarIcon className="h-3 w-3 inline mr-1" />
                                Asset Class
                            </button>
                        </div>
                    </div>
                )}

                {/* Chart */}
                <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                    {processedData.length > 0 ? (
                        <div className="h-full relative group">
                            <div 
                                className="h-full cursor-pointer"
                                onClick={() => setActivePage && setActivePage('Investments')}
                                title="Click to view in Investments page"
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
                            {/* Holdings List for Click-Through */}
                            {processedData.length > 0 && processedData.length <= 15 && (
                                <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-slate-200 p-2 max-h-24 overflow-y-auto">
                                    <p className="text-xs text-slate-500 mb-1 font-semibold">Quick View:</p>
                                    <div className="flex flex-wrap gap-1">
                                        {processedData.slice(0, 10).map((h, idx) => (
                                            <button
                                                key={h.id || idx}
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedHolding(h);
                                                    setIsModalOpen(true);
                                                }}
                                                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 hover:border-primary transition-colors flex items-center gap-1"
                                                title={`Click for details: ${h.name || h.symbol} - ${formatCurrencyString(h.valueInSAR, { digits: 0 })} (${h.gainLossPercent >= 0 ? '+' : ''}${h.gainLossPercent.toFixed(1)}%)`}
                                            >
                                                <span className="font-medium truncate max-w-[80px]">{h.name || h.symbol}</span>
                                                <span className={`text-xs font-semibold ${h.gainLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {h.gainLossPercent >= 0 ? '+' : ''}{h.gainLossPercent.toFixed(1)}%
                                                </span>
                                            </button>
                                        ))}
                                        {processedData.length > 10 && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActivePage && setActivePage('Investments');
                                                }}
                                                className="text-xs px-2 py-1 rounded border border-primary text-primary hover:bg-primary/10 transition-colors"
                                            >
                                                +{processedData.length - 10} more →
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="empty-state h-full flex flex-col items-center justify-center p-6 text-center">
                            <ArrowTrendingUpIcon className="h-12 w-12 text-slate-300 mb-3" />
                            <p className="text-sm font-medium text-slate-600 mb-1">No investment holdings yet</p>
                            <p className="text-xs text-slate-500 mb-4">Add portfolios and holdings in the Investments page to see allocation and performance.</p>
                            {setActivePage && (
                                <button 
                                    type="button" 
                                    onClick={() => setActivePage('Investments')}
                                    className="btn-primary text-sm px-4 py-2"
                                >
                                    Go to Investments →
                                </button>
                            )}
                        </div>
                    )}
                </div>
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
                        {setActivePage && (
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
                        )}
                    </div>
                )}
            </Modal>
        </>
    );
};

interface SummaryProps {
  setActivePage?: (page: Page) => void;
}

const Summary: React.FC<SummaryProps> = ({ setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

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

    const { financialMetrics, investmentTreemapData } = useMemo(() => {
        try {
            const now = new Date();
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const transactions = data?.transactions ?? [];
            const recentTransactions = transactions.filter(t => {
                try {
                    return new Date(t.date) >= firstDayOfMonth;
                } catch {
                    return false;
                }
            });

            const monthlyIncome = Math.max(0, recentTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + (Number(t.amount) || 0), 0));
            const monthlyExpenses = Math.max(0, recentTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0));
            const savingsRate = monthlyIncome > 0 ? Math.max(0, Math.min(1, (monthlyIncome - monthlyExpenses) / monthlyIncome)) : 0;
            const monthlyPnL = monthlyIncome - monthlyExpenses;

            const liabilities = data?.liabilities ?? [];
            const accounts = data?.accounts ?? [];
            const assets = data?.assets ?? [];
            const commodityHoldings = data?.commodityHoldings ?? [];
            const investments = data?.investments ?? [];
            const cashSavingsAccounts = accounts.filter(a => a.type === 'Checking' || a.type === 'Savings');
            const cashAndSavingsPositive = Math.max(0, cashSavingsAccounts
                .filter(a => (Number(a.balance) || 0) > 0)
                .reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0));
            const cashAndSavingsNegative = Math.max(0, cashSavingsAccounts
                .filter(a => (Number(a.balance) || 0) < 0)
                .reduce((sum, acc) => sum + Math.abs(Number(acc.balance) || 0), 0));
            const totalDebt = Math.max(0, liabilities
                .filter(l => (Number(l.amount) || 0) < 0)
                .reduce((sum, liab) => sum + Math.abs(Number(liab.amount) || 0), 0) + 
                accounts
                    .filter(a => a.type === 'Credit' && (Number(a.balance) || 0) < 0)
                    .reduce((sum, acc) => sum + Math.abs(Number(acc.balance) || 0), 0) + 
                cashAndSavingsNegative);
            const totalReceivable = Math.max(0, liabilities
                .filter(l => (Number(l.amount) || 0) > 0)
                .reduce((sum, liab) => sum + (Number(liab.amount) || 0), 0));
            const totalCommodities = Math.max(0, commodityHoldings
                .reduce((sum, ch) => sum + (Number(ch.currentValue) || 0), 0));
            const totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, exchangeRate);
            const totalAssets = Math.max(0, assets.reduce((sum, asset) => sum + (Number(asset.value) || 0), 0)) +
                               cashAndSavingsPositive +
                               totalCommodities +
                               totalInvestmentsValue;
            const netWorth = totalAssets - totalDebt + totalReceivable;
            const debtToAssetRatio = totalAssets > 0 ? Math.min(1, Math.max(0, totalDebt / totalAssets)) : 0;
            
            const netWorthPrevMonth = netWorth - monthlyPnL;
            const netWorthTrend = netWorthPrevMonth !== 0 && Math.abs(netWorthPrevMonth) > 0.01 
                ? ((netWorth - netWorthPrevMonth) / Math.abs(netWorthPrevMonth)) * 100 
                : 0;
        
            const allHoldings = investments.flatMap(p => 
                (p.holdings || []).map(h => ({
                    ...h,
                    portfolio_id: p.id,
                    portfolioName: p.name,
                    portfolioCurrency: p.currency || 'USD',
                }))
            );
            const investmentTreemapData = allHoldings
                .filter(h => {
                    const qty = Number(h.quantity) || 0;
                    const currVal = Number(h.currentValue) || 0;
                    const avgCost = Number(h.avgCost) || 0;
                    return qty > 0 && (currVal > 0 || (avgCost > 0 && qty > 0));
                })
                .map(h => {
                    const qty = Number(h.quantity) || 0;
                    const avgCost = Number(h.avgCost) || 0;
                    const currVal = Number(h.currentValue) || 0;
                    const totalCost = avgCost * qty;
                    const marketValue = currVal > 0 ? currVal : totalCost;
                    const valueInSAR = toSAR(marketValue, h.portfolioCurrency || 'USD', exchangeRate);
                    const costInSAR = toSAR(totalCost, h.portfolioCurrency || 'USD', exchangeRate);
                    const gainLoss = valueInSAR - costInSAR;
                    const gainLossPercent = costInSAR > 0.01 ? (gainLoss / costInSAR) * 100 : 0;
                    return { 
                        ...h, 
                        quantity: qty,
                        avgCost,
                        currentValue: marketValue,
                        valueInSAR,
                        gainLoss, 
                        gainLossPercent 
                    };
                });

            // Use valueInSAR which is already converted, don't convert again
            const totalInvestments = Math.max(0, investmentTreemapData.reduce((sum, h) => sum + h.valueInSAR, 0));
            const individualStocksValue = Math.max(0, investmentTreemapData
                .filter(h => !['ETF', 'Index Fund', 'Bond'].some(type => h.name?.includes(type)))
                .reduce((sum, h) => sum + h.valueInSAR, 0));
            const investmentConcentration = totalInvestments > 0.01 ? Math.min(1, Math.max(0, individualStocksValue / totalInvestments)) : 0;
            let investmentStyle = 'Balanced';
            if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
            else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

            return { 
                financialMetrics: { netWorth, monthlyIncome, monthlyExpenses, savingsRate, debtToAssetRatio, investmentStyle, netWorthTrend },
                investmentTreemapData
            };
        } catch (error) {
            console.error('Error calculating financial metrics:', error);
            return {
                financialMetrics: { 
                    netWorth: 0, 
                    monthlyIncome: 0, 
                    monthlyExpenses: 0, 
                    savingsRate: 0, 
                    debtToAssetRatio: 0, 
                    investmentStyle: 'Balanced', 
                    netWorthTrend: 0 
                },
                investmentTreemapData: []
            };
        }
    }, [data, exchangeRate]);

    const emergencyFund = useEmergencyFund(data);
    const efStatus = emergencyFund.status === 'healthy' ? 'green' : emergencyFund.status === 'adequate' ? 'green' : emergencyFund.status === 'low' ? 'yellow' : 'red';
    const efTrend = emergencyFund.status === 'healthy' ? 'Healthy' : emergencyFund.status === 'adequate' ? 'Adequate' : emergencyFund.status === 'low' ? 'Low' : 'Critical';
    const financialMetricsWithEf = useMemo(() => ({
        ...financialMetrics,
        emergencyFundMonths: emergencyFund.monthsCovered,
        efStatus,
        efTrend,
        emergencyShortfall: emergencyFund.shortfall,
        emergencyTargetAmount: emergencyFund.targetAmount,
    }), [financialMetrics, emergencyFund.monthsCovered, emergencyFund.shortfall, emergencyFund.targetAmount, efStatus, efTrend]);

    const householdStress = useMemo(() => {
        if (!data) return null;
        const year = new Date().getFullYear();
        const input = buildHouseholdEngineInputFromData(
            (data.transactions ?? []) as Array<{ date: string; type?: string; amount?: number }>,
            (data.accounts ?? []) as Array<{ type?: string; balance?: number }>,
            (data.goals ?? []) as any[],
            {
                year,
                expectedMonthlySalary: undefined,
                adults: 2,
                kids: 0,
                profile: 'Moderate',
                monthlyOverrides: [],
            }
        );
        const result = buildHouseholdBudgetPlan(input);
        return deriveCashflowStressSummary(result);
    }, [data]);

    const riskLane = useMemo(
        () => computeRiskLaneFromData(data, emergencyFund.monthsCovered),
        [data, emergencyFund.monthsCovered]
    );

    const liquidityRunway = useMemo(
        () => computeLiquidityRunwayFromData(data),
        [data]
    );

    const discipline = useMemo(
        () => computeDisciplineScore(data),
        [data]
    );

    const shockDrill = useMemo(
        () => (data ? runShockDrill(data, 'job_loss') : null),
        [data]
    );

    const handleGenerateAnalysis = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setAnalysis(null);
        try {
            const result = await getAIFinancialPersona(
                financialMetricsWithEf.savingsRate, 
                financialMetricsWithEf.debtToAssetRatio, 
                financialMetricsWithEf.emergencyFundMonths, 
                financialMetricsWithEf.investmentStyle
            );
            setAnalysis(result);
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [financialMetricsWithEf]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout 
            title="Financial Summary" 
            description="Key metrics and AI-generated financial persona with report card and suggestions."
            action={
                setActivePage && (
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setActivePage('Wealth Ultra')}
                            className="text-xs px-3 py-1.5 border border-violet-300 text-violet-700 rounded-lg hover:bg-violet-50"
                        >
                            Wealth Ultra
                        </button>
                        <button
                            type="button"
                            onClick={() => setActivePage('Market Events')}
                            className="text-xs px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50"
                        >
                            Market Events
                        </button>
                        <button
                            type="button"
                            onClick={() => setActivePage('Investments')}
                            className="text-xs px-3 py-1.5 border border-primary/30 text-primary rounded-lg hover:bg-primary/5"
                        >
                            Investments
                        </button>
                        <button
                            type="button"
                            onClick={() => setActivePage('Budgets')}
                            className="text-xs px-3 py-1.5 border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50"
                        >
                            Budgets
                        </button>
                    </div>
                )
            }
        >
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3">
                {isAdmin ? (
                    <div className="lg:col-span-1 section-card flex flex-col justify-center items-center text-center border-t-4 border-primary">
                        <h2 className="text-lg font-medium text-gray-500">Net Worth</h2>
                        <p className="text-5xl font-extrabold text-dark my-2">{formatCurrencyString(financialMetricsWithEf.netWorth, { digits: 0 })}</p>
                        <p className={`${financialMetricsWithEf.netWorthTrend >= 0 ? 'text-success' : 'text-danger'} font-semibold`}>
                            {financialMetricsWithEf.netWorthTrend >= 0 ? '+' : ''}{financialMetricsWithEf.netWorthTrend.toFixed(1)}% vs last month
                        </p>
                    </div>
                ) : (
                    <div className="lg:col-span-1 section-card border-l-4 border-amber-400">
                        <h2 className="text-lg font-medium text-gray-700">Net Worth</h2>
                        <p className="text-sm text-slate-600 mt-2">Net worth visibility is restricted to Admin only.</p>
                    </div>
                )}

                <div className="lg:col-span-2 cards-grid grid grid-cols-1 sm:grid-cols-2">
                    <Card 
                        title="This Month's Income" 
                        value={formatCurrencyString(Math.max(0, financialMetricsWithEf.monthlyIncome))} 
                        valueColor="text-success"
                        tooltip="Total income from all transactions this month."
                    />
                    <Card 
                        title="This Month's Expenses" 
                        value={formatCurrencyString(Math.max(0, financialMetricsWithEf.monthlyExpenses))} 
                        valueColor="text-danger"
                        tooltip="Total expenses from all transactions this month."
                    />
                    <Card 
                        title="Savings Rate" 
                        value={`${Math.max(0, Math.min(100, financialMetricsWithEf.savingsRate * 100)).toFixed(1)}%`} 
                        valueColor={financialMetricsWithEf.savingsRate >= 0.2 ? 'text-success' : financialMetricsWithEf.savingsRate >= 0.1 ? 'text-yellow-600' : 'text-danger'}
                        tooltip={`The percentage of your income you are saving. ${financialMetricsWithEf.savingsRate >= 0.2 ? 'Excellent!' : financialMetricsWithEf.savingsRate >= 0.1 ? 'Good, but could be better.' : 'Consider increasing your savings rate.'}`}
                        trend={financialMetricsWithEf.savingsRate >= 0.2 ? 'Excellent' : financialMetricsWithEf.savingsRate >= 0.1 ? 'Good' : 'Low'}
                        indicatorColor={financialMetricsWithEf.savingsRate >= 0.2 ? 'green' : financialMetricsWithEf.savingsRate >= 0.1 ? 'yellow' : 'red'}
                    />
                    <Card 
                        title="Emergency Fund" 
                        value={`${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months`}
                        tooltip={`Liquid cash covers ${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ' Target met!'}`}
                        trend={financialMetricsWithEf.efTrend}
                        indicatorColor={financialMetricsWithEf.efStatus as 'green' | 'yellow' | 'red'}
                    />
                </div>
            </div>
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                {isAdmin ? (
                    <div className="section-card flex flex-col h-[450px]">
                        <NetWorthCompositionChart title="Historical Net Worth" />
                    </div>
                ) : (
                    <div className="section-card flex flex-col h-[450px] justify-center">
                        <p className="text-sm text-slate-600 text-center px-6">Historical net worth chart is available for Admin only.</p>
                    </div>
                )}
                <EnhancedInvestmentChart
                    holdings={investmentTreemapData}
                    portfolios={investments}
                    exchangeRate={exchangeRate}
                    formatCurrencyString={formatCurrencyString}
                    setActivePage={setActivePage}
                />
            </div>
            
            {householdStress && (
                <div className={`section-card mt-6 border-l-4 ${
                    householdStress.level === 'Low' ? 'border-green-500' :
                    householdStress.level === 'Moderate' ? 'border-yellow-500' :
                    householdStress.level === 'High' ? 'border-orange-500' :
                    'border-red-500'
                }`}>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="section-title">Household Cashflow Stress</h3>
                        <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${
                            householdStress.level === 'Low' ? 'bg-green-100 text-green-800' :
                            householdStress.level === 'Moderate' ? 'bg-yellow-100 text-yellow-800' :
                            householdStress.level === 'High' ? 'bg-orange-100 text-orange-800' :
                            'bg-red-100 text-red-800'
                        }`}>
                            {householdStress.level}
                        </span>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">
                        {householdStress.summary}
                    </p>
                    {householdStress.flags.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Key Indicators:</p>
                            <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
                                {householdStress.flags.slice(0, 5).map((flag, idx) => (
                                    <li key={idx}>{flag}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3 mt-6">
                <div className="section-card border-l-4 border-blue-500">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="section-title">Risk Lane</h3>
                        <ShieldCheckIcon className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="mb-3">
                        <p className="text-sm text-slate-700">
                            Current lane: <span className="font-semibold text-blue-700">{riskLane.lane}</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                            Suggested profile: <span className="font-semibold">{riskLane.suggestedProfile}</span>
                        </p>
                    </div>
                    {riskLane.reasons.length > 0 && (
                        <div className="pt-2 border-t border-slate-200">
                            <p className="text-xs font-semibold text-slate-600 mb-1">Analysis:</p>
                            <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5">
                                {riskLane.reasons.slice(0, 3).map((r, idx) => <li key={idx}>{r}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
                <div className="section-card border-l-4 border-emerald-500">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="section-title">Liquidity Runway</h3>
                        <BanknotesIcon className="h-5 w-5 text-emerald-500" />
                    </div>
                    {liquidityRunway ? (
                        <>
                            <div className="mb-3">
                                <p className="text-sm text-slate-700">
                                    Runway: <span className={`font-semibold text-lg ${
                                        liquidityRunway.monthsOfRunway >= 12 ? 'text-emerald-600' :
                                        liquidityRunway.monthsOfRunway >= 6 ? 'text-yellow-600' :
                                        'text-red-600'
                                    }`}>{liquidityRunway.monthsOfRunway.toFixed(1)} months</span>
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    Portfolio drawdown: <span className="font-semibold">{liquidityRunway.drawdownPct.toFixed(1)}%</span>
                                </p>
                            </div>
                            {liquidityRunway.reasons.length > 0 && (
                                <div className="pt-2 border-t border-slate-200">
                                    <p className="text-xs text-slate-600">{liquidityRunway.reasons[0]}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="p-3 bg-slate-50 rounded-lg">
                            <p className="text-sm text-slate-500">Not enough data.</p>
                            <p className="text-xs text-slate-400 mt-1">Add accounts and transactions to calculate liquidity runway.</p>
                        </div>
                    )}
                </div>
                <div className="section-card border-l-4 border-purple-500">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="section-title">Discipline Score</h3>
                        <PiggyBankIcon className="h-5 w-5 text-purple-500" />
                    </div>
                    <div className="mb-3">
                        <div className="flex items-baseline gap-2">
                            <p className="text-2xl font-bold text-purple-600">{discipline.score}</p>
                            <p className="text-sm text-slate-500">/100</p>
                        </div>
                        <p className="text-xs text-slate-600 mt-1 font-semibold">{discipline.label}</p>
                    </div>
                    {discipline.reasons.length > 0 && (
                        <div className="pt-2 border-t border-slate-200">
                            <p className="text-xs font-semibold text-slate-600 mb-1">Factors:</p>
                            <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5">
                                {discipline.reasons.slice(0, 3).map((r, idx) => <li key={idx}>{r}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            <div className="section-card mt-6">
                <h3 className="section-title mb-2">Shock Drill (Auto)</h3>
                <p className="text-xs text-slate-500 mb-2">
                    Default template: <span className="font-semibold">{SHOCK_TEMPLATES.find(t => t.id === 'job_loss')?.label || 'Job Loss Scenario'}</span>
                </p>
                {shockDrill ? (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                            <div className="p-3 bg-slate-50 rounded-lg">
                                <p className="text-xs text-slate-500 mb-1">Household Year-End Delta</p>
                                <p className={`text-lg font-bold ${shockDrill.householdProjectedYearEndDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {shockDrill.householdProjectedYearEndDelta >= 0 ? '+' : ''}{formatCurrencyString(shockDrill.householdProjectedYearEndDelta, { digits: 0 })}
                                </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-lg">
                                <p className="text-xs text-slate-500 mb-1">Wealth Ultra Portfolio Delta</p>
                                <p className={`text-lg font-bold ${shockDrill.wealthUltraPortfolioValueDeltaPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {shockDrill.wealthUltraPortfolioValueDeltaPct >= 0 ? '+' : ''}{shockDrill.wealthUltraPortfolioValueDeltaPct.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-600 mt-2 p-2 bg-amber-50 border-l-4 border-amber-400 rounded">{shockDrill.combinedRiskNote}</p>
                    </>
                ) : (
                    <div className="p-4 bg-slate-50 rounded-lg text-center">
                        <p className="text-sm text-slate-500">Not enough data to run a drill.</p>
                        <p className="text-xs text-slate-400 mt-1">Add transactions, accounts, and investments to enable shock drill analysis.</p>
                    </div>
                )}
            </div>

            <div className="section-card max-w-full border-t-4 border-primary">
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex flex-col">
                        <div className="flex items-center space-x-2">
                            <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                            <h2 className="text-xl font-semibold text-dark">Financial Advisor</h2>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">AI-powered financial analysis with personalized recommendations</p>
                    </div>
                    <button 
                        onClick={handleGenerateAnalysis} 
                        disabled={isLoading} 
                        className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                        <SparklesIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        {isLoading ? 'Analyzing...' : (analysis ? 'Refresh Advisor Summary' : 'Generate Advisor Summary')}
                    </button>
                </div>
                {isLoading && (
                    <div className="text-center p-8">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-3"></div>
                        <p className="text-gray-500">Crafting your personal financial summary...</p>
                        <p className="text-xs text-gray-400 mt-1">This may take a few moments</p>
                    </div>
                )}
                {!isLoading && error && (
                    <div className="alert-error border-l-4 border-red-500">
                         <h4 className="font-bold text-red-800 mb-2">AI Analysis Error</h4>
                         <SafeMarkdownRenderer content={error} />
                         <button 
                             type="button" 
                             onClick={handleGenerateAnalysis} 
                             className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors"
                         >
                             Retry Analysis
                         </button>
                    </div>
                )}
                {!isLoading && !analysis && !error && (
                    <div className="text-center p-8 bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
                        <LightBulbIcon className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                        <p className="text-gray-600 font-medium mb-1">Ready to analyze your financial health</p>
                        <p className="text-sm text-gray-500">Click "Generate Advisor Summary" to get personalized insights and recommendations.</p>
                    </div>
                )}
                {analysis && !isLoading && !error && (
                    <div className="space-y-8 mt-4">
                        <div className="text-center bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-blue-200 shadow-sm">
                             <SparklesIcon className="h-12 w-12 text-primary mx-auto mb-3" />
                             <h3 className="text-2xl font-bold text-dark mb-2">{analysis.persona.title}</h3>
                             <p className="text-gray-700 mt-2 max-w-2xl mx-auto leading-relaxed">{analysis.persona.description}</p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-dark mb-4 text-center flex items-center justify-center gap-2">
                                <ShieldCheckIcon className="h-6 w-6 text-primary" />
                                Financial Health Report Card
                            </h3>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                                {analysis.reportCard.map((item, idx) => (
                                    <div 
                                        key={item.metric} 
                                        className={`p-5 rounded-lg border-l-4 shadow-sm transition-all hover:shadow-md ${getRatingColors(item.rating).border} ${getRatingColors(item.rating).bg}`}
                                        style={{ animationDelay: `${idx * 100}ms` }}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center space-x-3 flex-1">
                                                 <MetricIcon metric={item.metric} />
                                                 <div className="flex-1 min-w-0">
                                                    <p className="font-bold text-dark text-base">{item.metric}</p>
                                                    <p className={`text-sm font-semibold mt-0.5 ${getRatingColors(item.rating).text}`}>
                                                        {item.rating} <span className="text-xs opacity-75">({item.value})</span>
                                                    </p>
                                                 </div>
                                            </div>
                                             <div className="flex-shrink-0">{getRatingColors(item.rating).icon}</div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-slate-200/50 text-sm text-gray-700 space-y-2">
                                            <div>
                                                <strong className="font-semibold text-slate-800">Analysis:</strong>
                                                <p className="mt-1">{item.analysis}</p>
                                            </div>
                                            <div>
                                                <strong className="font-semibold text-slate-800">Suggestion:</strong>
                                                <p className="mt-1 text-primary font-medium">{item.suggestion}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

export default Summary;
