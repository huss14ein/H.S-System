import React, { useState, useContext, useCallback, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { getAITradeAnalysis } from '../services/geminiService';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

const formatCurrency = (value: number) => `SAR ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TradeAdvicesView: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const recentTransactions = (data.investmentTransactions ?? []).slice(0, 10);

    const analysisContext = useMemo(() => {
        const holdings = (data.investments ?? []).flatMap(p => p.holdings ?? []);
        const bySymbol = new Map<string, number>();
        holdings.forEach(h => bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + h.currentValue));
        const summary = Array.from(bySymbol.entries()).map(([s, v]) => `${s}: ${formatCurrency(v)}`).join('; ') || 'None';
        const watchlistSymbols = (data.watchlist ?? []).map(w => w.symbol);
        const plan = data.investmentPlan;
        return {
            holdingsSummary: summary,
            watchlistSymbols: watchlistSymbols.length > 0 ? watchlistSymbols : undefined,
            planBudget: plan?.monthlyBudget,
            corePct: plan?.coreAllocation,
            upsidePct: plan?.upsideAllocation,
        };
    }, [data.investments, data.watchlist, data.investmentPlan]);

    const handleGetAnalysis = useCallback(async () => {
        if (recentTransactions.length === 0) {
            setAiAnalysis("No recent transactions to analyze. Record trades from the Investments page first.");
            setErrorMessage(null);
            return;
        }
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const analysis = await getAITradeAnalysis(recentTransactions, analysisContext);
            setAiAnalysis(analysis);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setErrorMessage(msg);
            setAiAnalysis('');
        } finally {
            setIsLoading(false);
        }
    }, [recentTransactions, analysisContext]);

    return (
        <div className="mt-6 space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-dark">AI Trade Insights</h2>
                <p className="text-gray-500 mt-1">Get educational feedback on your recent trading activity, patterns, and portfolio impact.</p>
                <p className="text-xs text-red-600 mt-2 font-semibold">Disclaimer: This is not financial advice. For educational purposes only.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
                    <h3 className="text-lg font-semibold text-dark mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary" /> Recent Transactions
                    </h3>
                    {recentTransactions.length > 0 ? (
                        <ul className="space-y-2">
                            {recentTransactions.map(t => (
                                <li key={t.id} className={`flex justify-between items-center p-3 rounded-lg border ${t.type === 'buy' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100'}`}>
                                    <div>
                                        <p className={`font-semibold ${t.type === 'buy' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {t.type.toUpperCase()} {t.symbol}
                                        </p>
                                        <p className="text-sm text-gray-500">{new Date(t.date).toLocaleDateString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-medium text-dark">{formatCurrency(t.total)}</p>
                                        <p className="text-sm text-gray-500">{t.quantity} shares @ {formatCurrency(t.price)}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="text-center py-10 text-gray-500 rounded-lg bg-slate-50 border border-dashed border-slate-200">
                            <p className="font-medium">No investment transactions yet</p>
                            <p className="text-sm mt-1">Record trades from the Investments page to get AI feedback here.</p>
                        </div>
                    )}
                </div>

                <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div className="flex flex-col">
                            <div className="flex items-center space-x-2">
                                <BookOpenIcon className="h-6 w-6 text-primary" />
                                <h3 className="text-xl font-semibold text-dark">Educational Feedback</h3>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">Patterns, impact, and concepts to research</p>
                        </div>
                        <button
                            onClick={handleGetAnalysis}
                            disabled={isLoading || recentTransactions.length === 0}
                            className="flex items-center justify-center px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium shrink-0"
                        >
                            <SparklesIcon className="h-5 w-5 mr-2" />
                            {isLoading ? 'Analyzing...' : 'Analyze Trades'}
                        </button>
                    </div>
                    {errorMessage && (
                        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">{errorMessage}</div>
                    )}
                    {isLoading ? (
                        <div className="text-center p-10 text-gray-500 rounded-lg bg-violet-50/50 border border-violet-100">
                            <p className="font-medium">Generating insights...</p>
                            <p className="text-sm mt-1">Analyzing transactions, holdings, and plan context.</p>
                        </div>
                    ) : aiAnalysis ? (
                        <div className="prose prose-sm max-w-none rounded-xl bg-gradient-to-br from-violet-50/80 to-indigo-50/50 p-4 border border-violet-100">
                            <SafeMarkdownRenderer content={aiAnalysis} />
                        </div>
                    ) : (
                        <div className="text-center p-10 text-gray-500 rounded-lg bg-slate-50 border border-dashed border-slate-200">
                            <p className="font-medium">No analysis yet</p>
                            <p className="text-sm mt-1">Click &quot;Analyze Trades&quot; to get expert insights on your recent activity and portfolio.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TradeAdvicesView;