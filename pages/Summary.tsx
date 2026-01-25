
import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIFinancialPersona } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import Card from '../components/Card';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import NetWorthCompositionChart from '../components/charts/NetWorthCompositionChart';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';

interface ReportCardItem {
    metric: string;
    value: string;
    rating: 'Excellent' | 'Good' | 'Needs Improvement';
    analysis: string;
    suggestion: string;
}

interface PersonaAnalysis {
    persona: {
        title: string;
        description: string;
    };
    reportCard: ReportCardItem[];
}

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

const Summary: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const { financialMetrics, investmentTreemapData } = useMemo(() => {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const recentTransactions = data.transactions.filter(t => new Date(t.date) >= firstDayOfMonth);

        const monthlyIncome = recentTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const monthlyExpenses = recentTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
        const monthlyPnL = monthlyIncome - monthlyExpenses;

        const totalDebt = data.liabilities.reduce((sum, liab) => sum + Math.abs(liab.amount), 0) + data.accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const netWorth = totalAssets - totalDebt;
        const debtToAssetRatio = totalAssets > 0 ? totalDebt / totalAssets : 0;
        
        const netWorthPrevMonth = netWorth - monthlyPnL;
        const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / Math.abs(netWorthPrevMonth)) * 100 : 0;
        
        const cash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + acc.balance, 0);
        const coreExpenses = data.transactions.filter(t => t.expenseType === 'Core').reduce((sum, t) => sum + Math.abs(t.amount), 0) / 12; // Average monthly core
        const emergencyFundMonths = coreExpenses > 0 ? cash / coreExpenses : savingsRate >= 0 ? 99 : 0;

        const allHoldings = data.investments.flatMap(p => p.holdings);
        const investmentTreemapData = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });

        const totalInvestments = investmentTreemapData.reduce((sum, h) => sum + h.currentValue, 0);
        const individualStocksValue = investmentTreemapData.filter(h => !['ETF', 'Index Fund', 'Bond'].some(type => h.name?.includes(type))).reduce((sum, h) => sum + h.currentValue, 0);
        const investmentConcentration = totalInvestments > 0 ? individualStocksValue / totalInvestments : 0;
        let investmentStyle = 'Balanced';
        if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
        else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

        let efStatus: 'red' | 'yellow' | 'green' = 'red';
        let efTrend = 'Critical';
        if (emergencyFundMonths >= 3) {
            efStatus = 'green';
            efTrend = 'Healthy';
        } else if (emergencyFundMonths >= 1) {
            efStatus = 'yellow';
            efTrend = 'Low';
        }

        return { 
            financialMetrics: { netWorth, monthlyIncome, monthlyExpenses, savingsRate, debtToAssetRatio, emergencyFundMonths, investmentStyle, efStatus, efTrend, netWorthTrend },
            investmentTreemapData
        };
    }, [data]);

    const handleGenerateAnalysis = useCallback(async () => {
        setIsLoading(true);
        const resultString = await getAIFinancialPersona(financialMetrics.savingsRate, financialMetrics.debtToAssetRatio, financialMetrics.emergencyFundMonths, financialMetrics.investmentStyle);
        try {
            const parsedResult = JSON.parse(resultString);
            setAnalysis(parsedResult);
        } catch (error) {
            console.error("Failed to parse AI response:", error);
            setAnalysis(null);
        }
        setIsLoading(false);
    }, [financialMetrics]);

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-dark">Financial Summary</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow-lg flex flex-col justify-center items-center text-center border-t-4 border-primary">
                    <h2 className="text-lg font-medium text-gray-500">Net Worth</h2>
                    <p className="text-5xl font-extrabold text-dark my-2">{formatCurrencyString(financialMetrics.netWorth, { digits: 0 })}</p>
                    <p className={`${financialMetrics.netWorthTrend >= 0 ? 'text-success' : 'text-danger'} font-semibold`}>
                        {financialMetrics.netWorthTrend >= 0 ? '+' : ''}{financialMetrics.netWorthTrend.toFixed(1)}% vs last month
                    </p>
                </div>

                <div className="lg:col-span-2 grid grid-cols-2 gap-6">
                    <Card title="This Month's Income" value={formatCurrencyString(financialMetrics.monthlyIncome)} valueColor="text-success" />
                    <Card title="This Month's Expenses" value={formatCurrencyString(financialMetrics.monthlyExpenses)} valueColor="text-danger" />
                    <Card title="Savings Rate" value={`${(financialMetrics.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="The percentage of your income you are saving." />
                    <Card 
                        title="Emergency Fund" 
                        value={`${financialMetrics.emergencyFundMonths.toFixed(1)} months`}
                        tooltip="Covers months of core expenses. 3-6 months is recommended."
                        trend={financialMetrics.efTrend}
                        indicatorColor={financialMetrics.efStatus}
                    />
                </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="h-[450px] bg-white rounded-lg shadow-lg">
                    <NetWorthCompositionChart title="Historical Net Worth" />
                </div>
                 <div className="bg-white p-6 rounded-lg shadow h-[450px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Investment Allocation & Performance</h3>
                    <PerformanceTreemap data={investmentTreemapData} />
                </div>
            </div>
            

            <div className="bg-white p-6 rounded-lg shadow max-w-full mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex items-center space-x-2"><LightBulbIcon className="h-6 w-6 text-yellow-500" /><h2 className="text-xl font-semibold text-dark">Your Financial Persona</h2></div>
                    <button onClick={handleGenerateAnalysis} disabled={isLoading} className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Analyzing...' : (analysis ? 'Regenerate Analysis' : 'Generate My Analysis')}
                    </button>
                </div>
                {isLoading && <div className="text-center p-8 text-gray-500">Crafting your personal financial summary...</div>}
                {!isLoading && !analysis && <div className="text-center p-8 text-gray-500">Click the button to generate your AI-powered financial persona and report card.</div>}
                {analysis && !isLoading && (
                    <div className="space-y-8 mt-4">
                        <div className="text-center bg-blue-50 p-6 rounded-lg border border-blue-200">
                             <SparklesIcon className="h-10 w-10 text-primary mx-auto mb-2" />
                             <h3 className="text-2xl font-bold text-dark">{analysis.persona.title}</h3>
                             <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{analysis.persona.description}</p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-dark mb-4 text-center">Financial Health Report Card</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>
    );
};

export default Summary;
