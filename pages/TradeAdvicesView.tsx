
import React, { useState, useContext, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { getAITradeAnalysis } from '../services/geminiService';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';

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
                <h2 className="text-2xl font-bold text-dark">AI Trade Analysis</h2>
                <p className="text-gray-500 mt-1">Get educational feedback on your recent trading activity.</p>
                <p className="text-xs text-red-600 mt-2 font-semibold">Disclaimer: This is not financial advice. For educational purposes only.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Recent Transactions List */}
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold text-dark mb-4">Recent Transactions for Analysis</h3>
                    {recentTransactions.length > 0 ? (
                        <ul className="space-y-4">
                            {recentTransactions.map(t => (
                                <li key={t.id} className="flex justify-between items-center border-b pb-2 last:border-b-0">
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
                        <p className="text-gray-500 text-center py-8">No investment transactions found.</p>
                    )}
                </div>

                {/* AI Analysis Panel */}
                <div className="bg-white p-6 rounded-lg shadow">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                            <BookOpenIcon className="h-6 w-6 text-primary" />
                            <h3 className="text-xl font-semibold text-dark">AI Educational Feedback</h3>
                        </div>
                        <button
                            onClick={handleGetAnalysis}
                            disabled={isLoading || recentTransactions.length === 0}
                            className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"
                        >
                            <SparklesIcon className="h-5 w-5 mr-2" />
                            {isLoading ? 'Analyzing...' : 'Analyze Trades'}
                        </button>
                    </div>
                    {isLoading ? (
                        <div className="text-center p-8 text-gray-500">Generating educational feedback...</div>
                    ) : aiAnalysis ? (
                        <div
                            className="prose prose-sm max-w-none text-gray-700"
                            dangerouslySetInnerHTML={{ __html: aiAnalysis.replace(/### (.*)/g, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }}
                        />
                    ) : (
                        <div className="text-center p-8 text-gray-500">
                            Click "Analyze Trades" to get AI-powered educational insights on your recent investment activity.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TradeAdvicesView;
