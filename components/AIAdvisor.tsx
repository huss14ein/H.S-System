import React, { useState, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIAnalysis, getInvestmentAIAnalysis, getAIPlanAnalysis, getAITransactionAnalysis, getAIGoalStrategyAnalysis, getAIAnalysisPageInsights, formatAiError } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { FinancialData } from '../types';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';

type AIContext = 'dashboard' | 'investments' | 'plan' | 'summary' | 'cashflow' | 'goals' | 'analysis';

interface AIAdvisorProps {
    pageContext: AIContext;
    contextData?: any;
}

// This is a simplified router for demonstration. A real app might have more complex logic.
const getAnalysisForPage = (context: AIContext, data: FinancialData, contextData: any): Promise<string> => {
    switch (context) {
        case 'dashboard': {
            const assets = data.assets ?? [];
            const accounts = data.accounts ?? [];
            const liabilities = data.liabilities ?? [];
            const totalCommodities = (data.commodityHoldings ?? []).reduce((sum, ch) => sum + ch.currentValue, 0);
            const totalInvestmentsValue = (data.investments ?? []).reduce((sum, p) => sum + (p.holdings ?? []).reduce((hSum, h) => hSum + h.currentValue, 0), 0);
            const cashSavings = accounts.filter(a => a.type === 'Checking' || a.type === 'Savings');
            const cashPositive = cashSavings.filter(a => (a.balance ?? 0) > 0).reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
            const cashNegative = cashSavings.filter(a => (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0);
            const totalAssets = assets.reduce((sum, asset) => sum + asset.value, 0) + cashPositive + totalCommodities + totalInvestmentsValue;
            const totalDebt = liabilities.filter(l => (l.amount ?? 0) < 0).reduce((sum, l) => sum + Math.abs(l.amount ?? 0), 0) + accounts.filter(a => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0) + cashNegative;
            const totalReceivable = liabilities.filter(l => (l.amount ?? 0) > 0).reduce((sum, l) => sum + (l.amount ?? 0), 0);
            const netWorth = totalAssets - totalDebt + totalReceivable;
            const totalInvested = (data.investmentTransactions ?? []).filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
            const totalWithdrawn = Math.abs((data.investmentTransactions ?? []).filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
            const netCapital = totalInvested - totalWithdrawn;
            const totalGainLoss = totalInvestmentsValue - netCapital;
            const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
            const summary = { netWorth, roi, assetMix: [], liquidNetWorth: cashPositive, liabilitiesCoverage: totalDebt, monthlyIncome: 0, monthlyExpenses: 0, monthlyPnL: 0, budgetVariance: 0 };
            return getAIAnalysis(summary);
        }
        case 'investments':
            return getInvestmentAIAnalysis(data.investments.flatMap(p => p.holdings));
        case 'plan':
             if (contextData?.totals && contextData?.scenarios) {
                return getAIPlanAnalysis(contextData.totals, contextData.scenarios);
             }
             return Promise.resolve("Not enough data for plan analysis.");
        case 'cashflow':
            if (contextData?.transactions && contextData?.budgets) {
                return getAITransactionAnalysis(contextData.transactions, contextData.budgets);
            }
            return Promise.resolve("Not enough data for cashflow analysis.");
        case 'goals':
            if (contextData?.goals && typeof contextData?.monthlySavings !== 'undefined') {
                return getAIGoalStrategyAnalysis(contextData.goals, contextData.monthlySavings, data);
            }
            return Promise.resolve("Not enough data for goal strategy analysis.");
        case 'analysis':
            if (contextData?.spendingData && contextData?.trendData && contextData?.compositionData) {
                return getAIAnalysisPageInsights(contextData.spendingData, contextData.trendData, contextData.compositionData);
            }
            return Promise.resolve("Not enough data for a full analysis.");
        default:
            return Promise.resolve("AI analysis for this section is not configured yet.");
    }
};


const AIAdvisor: React.FC<AIAdvisorProps> = ({ pageContext, contextData }) => {
    const [insight, setInsight] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const { data } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setInsight('');
        try {
            const result = await getAnalysisForPage(pageContext, data, contextData);
            setInsight(result);
        } catch (error) {
            console.error("AI analysis failed:", error);
            setInsight(formatAiError(error));
        }
        setIsLoading(false);
    }, [pageContext, data, contextData]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center space-x-2">
                        <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                        <h2 className="text-xl font-semibold text-dark">Financial Advisor</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">Expert financial & investment insights</p>
                </div>
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!isAiAvailable || isLoading}
                    title={!isAiAvailable ? "AI features are disabled. Please configure your API key." : "Get AI Insights"}
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                >
                    <SparklesIcon className="h-5 w-5 mr-2" />
                    {isLoading ? 'Analyzing...' : 'Get AI Insights'}
                </button>
            </div>
            {isLoading && <div className="text-center p-4 text-slate-500">Generating personalized insights...</div>}
            
            {insight && !isLoading && (
                 <div className="bg-indigo-50 border-l-4 border-indigo-400 p-4 rounded-r-lg">
                    <SafeMarkdownRenderer content={insight} />
                </div>
            )}
            
            {!isAiAvailable ? (
                 <div className="text-center p-4 text-slate-500 bg-slate-50 rounded-md">
                    <p className="font-semibold">AI Features Disabled</p>
                    <p className="text-sm">Please set your Gemini API key in the environment variables to enable this feature.</p>
                </div>
            ) : (
                !insight && !isLoading && (
                    <div className="text-center p-4 text-slate-500">
                        Click "Get AI Insights" for an analysis of your {pageContext} data.
                    </div>
                )
            )}
        </div>
    );
};

export default AIAdvisor;