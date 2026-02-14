import React, { useMemo, useContext, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../components/Card';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { getAIDividendAnalysis } from '../services/geminiService';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { TrophyIcon } from '../components/icons/TrophyIcon';

const DividendTrackerView: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions, projectedAnnualIncome, averageYield, topPayers } = useMemo(() => {
        const dividendTransactions = data.investmentTransactions.filter(t => t.type === 'dividend');
        const now = new Date();

        const dividendIncomeYTD = dividendTransactions
            .filter(t => new Date(t.date).getFullYear() === now.getFullYear())
            .reduce((sum, t) => sum + t.total, 0);

        const monthlyDividends = new Map<string, number>();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dividendTransactions.filter(t => new Date(t.date) >= twelveMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            monthlyDividends.set(monthKey, (monthlyDividends.get(monthKey) || 0) + t.total);
        });
        
        const monthlyDividendsChartData = Array.from(monthlyDividends.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ 
            name: new Date(key + '-02').toLocaleString('default', { month: 'short', year: '2-digit' }), 
            "Dividend Income": value 
        }));

        const recentDividendTransactions = dividendTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

        const allHoldings = data.investments.flatMap(p => p.holdings);
        const totalInvestmentValue = allHoldings.reduce((sum, h) => sum + h.currentValue, 0);

        const holdingsWithProjectedDividends = allHoldings
            .filter(h => h.dividendYield && h.dividendYield > 0)
            .map(h => ({ name: h.name || h.symbol, projected: h.currentValue * (h.dividendYield! / 100) }));

        const projectedAnnualIncome = holdingsWithProjectedDividends.reduce((sum, h) => sum + h.projected, 0);
        const averageYield = totalInvestmentValue > 0 ? (projectedAnnualIncome / totalInvestmentValue) * 100 : 0;
        const topPayers = holdingsWithProjectedDividends.sort((a,b) => b.projected - a.projected).slice(0, 5);

        return { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions, projectedAnnualIncome, averageYield, topPayers };
    }, [data]);

    const handleGetAnalysis = useCallback(async () => {
        setIsLoading(true);
        const analysis = await getAIDividendAnalysis(dividendIncomeYTD, projectedAnnualIncome, topPayers);
        setAiAnalysis(analysis);
        setIsLoading(false);
    }, [dividendIncomeYTD, projectedAnnualIncome, topPayers]);

    return (
        <div className="mt-6 space-y-6">
             <div className="text-center">
                <h2 className="text-2xl font-bold text-dark">Dividend Tracker</h2>
                <p className="text-gray-500 mt-1">Monitor your passive income from dividend-paying investments.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Dividend Income (YTD)" value={formatCurrencyString(dividendIncomeYTD)} />
                <Card title="Projected Annual Income" value={formatCurrencyString(projectedAnnualIncome)} tooltip="Based on current holdings and their dividend yields." />
                <Card title="Average Portfolio Yield" value={`${averageYield.toFixed(2)}%`} tooltip="Projected annual dividend income as a percentage of your total investment value."/>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-dark flex items-center"><LightBulbIcon className="h-5 w-5 mr-2 text-yellow-500"/>AI Dividend Advisor</h3>
                    <button onClick={handleGetAnalysis} disabled={isLoading} className="flex items-center px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">
                        <SparklesIcon className="h-4 w-4 mr-2"/>
                        {isLoading ? 'Analyzing...' : 'Generate Analysis'}
                    </button>
                </div>
                 {isLoading && <p className="text-sm text-center text-gray-500 py-4">Analyzing your dividend strategy...</p>}
                 {!isLoading && aiAnalysis && <SafeMarkdownRenderer content={aiAnalysis} />}
                 {!isLoading && !aiAnalysis && <p className="text-sm text-center text-gray-500 py-4">Click "Generate Analysis" for an AI-powered summary of your dividend income.</p>}
            </div>

            <div className="bg-white p-6 rounded-lg shadow h-[400px]">
                <h3 className="text-lg font-semibold text-dark mb-4">Monthly Dividend Income (Last 12 Months)</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={monthlyDividendsChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis tickFormatter={(val) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(val as number)} />
                        <Tooltip formatter={(val: number) => formatCurrencyString(val, { digits: 2 })} />
                        <Legend />
                        <Bar dataKey="Dividend Income" fill="#8b5cf6" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold text-dark mb-4">Recent Dividend Payments</h3>
                    <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50"><tr className="text-left text-xs font-medium text-gray-500 uppercase">
                            <th className="px-4 py-2">Date</th><th className="px-4 py-2">Symbol</th><th className="px-4 py-2 text-right">Amount</th>
                        </tr></thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {recentDividendTransactions.map(t => (
                                <tr key={t.id}><td className="px-4 py-2">{new Date(t.date).toLocaleDateString()}</td><td className="px-4 py-2 font-semibold">{t.symbol}</td><td className="px-4 py-2 text-right font-medium text-green-600">{formatCurrencyString(t.total)}</td></tr>
                            ))}
                        </tbody>
                    </table></div>
                    {recentDividendTransactions.length === 0 && <p className="text-center text-gray-500 py-8">No dividend transactions recorded.</p>}
                </div>

                <div className="bg-white p-6 rounded-lg shadow">
                     <h3 className="text-lg font-semibold text-dark mb-4 flex items-center"><TrophyIcon className="h-5 w-5 mr-2 text-yellow-500"/>Top 5 Dividend Payers</h3>
                     <p className="text-sm text-gray-500 -mt-3 mb-4">Based on projected annual income.</p>
                     <ul className="space-y-3">
                        {topPayers.map(payer => (
                            <li key={payer.name} className="flex justify-between items-center text-sm border-b pb-2">
                                <span className="font-semibold text-dark">{payer.name}</span>
                                <span className="font-medium text-gray-700">{formatCurrencyString(payer.projected)}/yr</span>
                            </li>
                        ))}
                     </ul>
                     {topPayers.length === 0 && <p className="text-center text-gray-500 py-8">No holdings with dividend yields found.</p>}
                </div>
            </div>
        </div>
    );
};

export default DividendTrackerView;