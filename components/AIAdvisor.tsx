import React, { useState, useCallback, useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIAnalysis, getInvestmentAIAnalysis, getAIPlanAnalysis, getAIHouseholdEngineAnalysis, getAITransactionAnalysis, getAIGoalStrategyAnalysis, getAIAnalysisPageInsights, formatAiError } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { FinancialData } from '../types';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';
import { computeLiquidNetWorth } from '../services/liquidNetWorth';

type AIContext = 'dashboard' | 'investments' | 'plan' | 'summary' | 'cashflow' | 'goals' | 'analysis';

interface AIAdvisorProps {
    pageContext: AIContext;
    contextData?: any;
    title?: string;
    subtitle?: string;
    buttonLabel?: string;
}

// This is a simplified router for demonstration. A real app might have more complex logic.
const getAnalysisForPage = (context: AIContext, data: FinancialData, contextData: any, sarPerUsd: number): Promise<string> => {
    switch (context) {
        case 'dashboard': {
            const { netWorth, totalDebt } = computePersonalNetWorthBreakdownSAR(data, sarPerUsd);
            const { liquidNetWorth } = computeLiquidNetWorth(data);
            const d = data as any;
            const accounts = d?.personalAccounts ?? data?.accounts ?? [];
            const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));
            const investments = d?.personalInvestments ?? data?.investments ?? [];
            const totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, sarPerUsd);
            const invTx = (data?.investmentTransactions ?? []).filter((t: { accountId?: string }) => personalAccountIds.has(t.accountId ?? ''));
            const totalInvested = invTx.filter((t: { type?: string }) => t.type === 'buy').reduce((sum: number, t: { total?: number }) => sum + (t.total ?? 0), 0);
            const totalWithdrawn = Math.abs(invTx.filter((t: { type?: string }) => t.type === 'sell').reduce((sum: number, t: { total?: number }) => sum + (t.total ?? 0), 0));
            const netCapital = totalInvested - totalWithdrawn;
            const totalGainLoss = totalInvestmentsValue - netCapital;
            const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
            const summary = { netWorth, roi, assetMix: [], liquidNetWorth, liabilitiesCoverage: totalDebt, monthlyIncome: 0, monthlyExpenses: 0, monthlyPnL: 0, budgetVariance: 0 };
            return getAIAnalysis(summary);
        }
        case 'investments':
            return getInvestmentAIAnalysis(((data as any)?.personalInvestments ?? data?.investments ?? []).flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []));
        case 'plan':
             if (contextData?.householdEngine) {
                return getAIHouseholdEngineAnalysis(contextData.householdEngine, contextData?.scenarios);
             }
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


const AIAdvisor: React.FC<AIAdvisorProps> = ({ pageContext, contextData, title = 'Financial Advisor', subtitle = 'Expert financial & investment insights', buttonLabel = 'Get AI Insights' }) => {
    const [insight, setInsight] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { isAiAvailable } = useAI();

    const insightSource = useMemo(() => {
        const text = (insight || '').toLowerCase();
        if (!insight) return null;
        if (text.includes('deterministic') || text.includes('fallback') || text.includes('provider unavailable')) return 'Deterministic fallback';
        return 'AI provider';
    }, [insight]);

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setInsight('');
        try {
            const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
            const result = await getAnalysisForPage(pageContext, data, contextData, sarPerUsd);
            setInsight(result);
        } catch (error) {
            console.error("AI analysis failed:", error);
            setInsight(formatAiError(error));
        }
        setIsLoading(false);
    }, [pageContext, data, contextData, exchangeRate]);



    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center space-x-2">
                        <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                        <h2 className="text-xl font-semibold text-dark">{title}</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                </div>
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!isAiAvailable || isLoading}
                    title={!isAiAvailable ? "AI features are disabled. Please configure your API key." : "Get AI Insights"}
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                >
                    <SparklesIcon className="h-5 w-5 mr-2" />
                    {isLoading ? 'Analyzing...' : buttonLabel}
                </button>
            </div>
            {isLoading && <div className="text-center p-4 text-slate-500">Generating personalized insights...</div>}
            
            {insight && !isLoading && (
                 <div className="bg-indigo-50 border-l-4 border-indigo-400 p-4 rounded-r-lg">
                    {insightSource && (
                        <div className="mb-2">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${insightSource === 'AI provider' ? 'bg-indigo-100 border-indigo-200 text-indigo-700' : 'bg-amber-100 border-amber-200 text-amber-700'}`}>
                                Source: {insightSource}
                            </span>
                        </div>
                    )}
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
                        Click &quot;Get AI Insights&quot; for an analysis of your {pageContext} data.
                    </div>
                )
            )}
        </div>
    );
};

export default AIAdvisor;
