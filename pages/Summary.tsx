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

interface SummaryProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const Summary: React.FC<SummaryProps> = ({ setActivePage, triggerPageAction }) => {
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
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const transactions = data?.transactions ?? [];
        const recentTransactions = transactions.filter(t => new Date(t.date) >= firstDayOfMonth);

        const monthlyIncome = recentTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const monthlyExpenses = recentTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
        const monthlyPnL = monthlyIncome - monthlyExpenses;

        const liabilities = data?.liabilities ?? [];
        const accounts = data?.accounts ?? [];
        const assets = data?.assets ?? [];
        const commodityHoldings = data?.commodityHoldings ?? [];
        const investments = data?.investments ?? [];
        const cashSavingsAccounts = accounts.filter(a => a.type === 'Checking' || a.type === 'Savings');
        const cashAndSavingsPositive = cashSavingsAccounts.filter(a => (a.balance ?? 0) > 0).reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
        const cashAndSavingsNegative = cashSavingsAccounts.filter(a => (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0);
        const totalDebt = liabilities.filter(l => (l.amount ?? 0) < 0).reduce((sum, liab) => sum + Math.abs(liab.amount ?? 0), 0) + accounts.filter(a => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0) + cashAndSavingsNegative;
        const totalReceivable = liabilities.filter(l => (l.amount ?? 0) > 0).reduce((sum, liab) => sum + (liab.amount ?? 0), 0);
        const totalCommodities = commodityHoldings.reduce((sum, ch) => sum + ch.currentValue, 0);
        const totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, exchangeRate);
        const totalAssets = assets.reduce((sum, asset) => sum + asset.value, 0) +
                           cashAndSavingsPositive +
                           totalCommodities +
                           totalInvestmentsValue;
        const netWorth = totalAssets - totalDebt + totalReceivable;
        const debtToAssetRatio = totalAssets > 0 ? totalDebt / totalAssets : 0;
        
        const netWorthPrevMonth = netWorth - monthlyPnL;
        const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / Math.abs(netWorthPrevMonth)) * 100 : 0;
        
        const allHoldings = investments.flatMap(p => (p.holdings || []).map(h => ({ ...h, portfolioCurrency: p.currency })));
        const investmentTreemapData = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });

        const totalInvestments = investmentTreemapData.reduce((sum, h) => sum + toSAR(h.currentValue, h.portfolioCurrency, exchangeRate), 0);
        const individualStocksValue = investmentTreemapData
            .filter(h => !['ETF', 'Index Fund', 'Bond'].some(type => h.name?.includes(type)))
            .reduce((sum, h) => sum + toSAR(h.currentValue, h.portfolioCurrency, exchangeRate), 0);
        const investmentConcentration = totalInvestments > 0 ? individualStocksValue / totalInvestments : 0;
        let investmentStyle = 'Balanced';
        if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
        else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

        return { 
            financialMetrics: { netWorth, monthlyIncome, monthlyExpenses, savingsRate, debtToAssetRatio, investmentStyle, netWorthTrend },
            investmentTreemapData
        };
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
                    <Card title="This Month's Income" value={formatCurrencyString(financialMetricsWithEf.monthlyIncome)} valueColor="text-success" />
                    <Card title="This Month's Expenses" value={formatCurrencyString(financialMetricsWithEf.monthlyExpenses)} valueColor="text-danger" />
                    <Card title="Savings Rate" value={`${(financialMetricsWithEf.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="The percentage of your income you are saving." />
                    <Card 
                        title="Emergency Fund" 
                        value={`${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months`}
                        tooltip={`Liquid cash covers ${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}`}
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
                <div className="section-card flex flex-col h-[450px]">
                    <h3 className="section-title mb-4">Investment Allocation & Performance</h3>
                    <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                </div>
            </div>
            

            <div className="section-card max-w-full">
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex flex-col"><div className="flex items-center space-x-2"><LightBulbIcon className="h-6 w-6 text-yellow-500" /><h2 className="text-xl font-semibold text-dark">Financial Advisor</h2></div><p className="text-xs text-slate-500 mt-0.5">Direct, summarized guidance with a report card</p></div>
                    <button onClick={handleGenerateAnalysis} disabled={isLoading} className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Analyzing...' : (analysis ? 'Refresh Advisor Summary' : 'Generate Advisor Summary')}
                    </button>
                </div>
                {isLoading && <div className="text-center p-8 text-gray-500">Crafting your personal financial summary...</div>}
                {!isLoading && error && (
                    <div className="alert-error">
                         <h4 className="font-bold">AI Analysis Error</h4>
                         <SafeMarkdownRenderer content={error} />
                         <button type="button" onClick={handleGenerateAnalysis} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200">Retry</button>
                    </div>
                )}
                {!isLoading && !analysis && !error && <div className="text-center p-8 text-gray-500">Click "Generate Advisor Summary" to run the advisor manually.</div>}
                {analysis && !isLoading && !error && (
                    <div className="space-y-8 mt-4">
                        <div className="text-center bg-blue-50 p-6 rounded-lg border border-blue-200">
                             <SparklesIcon className="h-10 w-10 text-primary mx-auto mb-2" />
                             <h3 className="text-2xl font-bold text-dark">{analysis.persona.title}</h3>
                             <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{analysis.persona.description}</p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-dark mb-4 text-center">Financial Health Report Card</h3>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
                                {analysis.reportCard.map(item => (
                                    <div key={item.metric} className={`p-4 rounded-lg border-l-4 ${getRatingColors(item.rating).border} ${getRatingColors(item.rating).bg}`}>
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center space-x-3">
                                                 <MetricIcon metric={item.metric} />
                                                 <div>
                                                    <p className="font-bold text-dark">{item.metric}</p>
                                                    <p className={`text-sm font-semibold ${getRatingColors(item.rating).text}`}>{item.rating} ({item.value})</p>
                                                 </div>
                                            </div>
                                             {getRatingColors(item.rating).icon}
                                        </div>
                                        <div className="mt-3 text-sm text-gray-700 space-y-2">
                                            <p><strong className="font-medium">Analysis:</strong> {item.analysis}</p>
                                            <p><strong className="font-medium">Suggestion:</strong> {item.suggestion}</p>
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
