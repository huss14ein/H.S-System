import React, { useState, useContext, useCallback } from 'react';
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

    const recentTransactions = data.investmentTransactions.slice(0, 5);

    const handleGetAnalysis = useCallback(async () => {
        if (recentTransactions.length === 0) {
            setAiAnalysis("No recent transactions to analyze.");
            return;
        }
        setIsLoading(true);
        const analysis = await getAITradeAnalysis(recentTransactions);
        setAiAnalysis(analysis);
        setIsLoading(false);
    }, [recentTransactions]);

    return (
        <div className="mt-6 space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-dark">AI Trade Advices</h2>
                <p className="text-gray-500 mt-1">Get educational feedback on your recent trading activity and patterns.</p>
                <p className="text-xs text-red-600 mt-2 font-semibold">Disclaimer: This is not financial advice. For educational purposes only.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Recent Transactions – card layout */}
                <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100">
                    <h3 className="text-lg font-semibold text-dark mb-3">Recent Transactions for Analysis</h3>
                    {recentTransactions.length > 0 ? (
                        <ul className="space-y-3">
                            {recentTransactions.map(t => (
                                <li key={t.id} className="flex justify-between items-center p-3 rounded-lg bg-gray-50 border border-gray-100">
                                    <div>
                                        <p className={`font-semibold ${t.type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
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
                        <div className="text-center py-10 text-gray-500 rounded-lg bg-gray-50 border border-dashed border-gray-200">
                            <p className="font-medium">No investment transactions yet</p>
                            <p className="text-sm mt-1">Record trades from the Investments page to get AI feedback here.</p>
                        </div>
                    )}
                </div>

                {/* AI Analysis Panel – card with clear sections */}
                <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div className="flex flex-col">
                            <div className="flex items-center space-x-2">
                                <BookOpenIcon className="h-6 w-6 text-primary" />
                                <h3 className="text-xl font-semibold text-dark">Educational Feedback</h3>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p>
                        </div>
                        <button
                            onClick={handleGetAnalysis}
                            disabled={isLoading || recentTransactions.length === 0}
                            className="flex items-center justify-center px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                        >
                            <SparklesIcon className="h-5 w-5 mr-2" />
                            {isLoading ? 'Analyzing...' : 'Analyze Trades'}
                        </button>
                    </div>
                    {isLoading ? (
                        <div className="text-center p-10 text-gray-500 rounded-lg bg-gray-50 border border-gray-100">
                            <p className="font-medium">Generating educational feedback...</p>
                            <p className="text-sm mt-1">Analyzing patterns and suggestions.</p>
                        </div>
                    ) : aiAnalysis ? (
                        <div className="prose prose-sm max-w-none rounded-lg bg-violet-50/50 p-4 border border-violet-100">
                            <SafeMarkdownRenderer content={aiAnalysis} />
                        </div>
                    ) : (
                        <div className="text-center p-10 text-gray-500 rounded-lg bg-gray-50 border border-dashed border-gray-200">
                            <p className="font-medium">No analysis yet</p>
                            <p className="text-sm mt-1">Click &quot;Analyze Trades&quot; to get expert insights on your recent activity.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TradeAdvicesView;