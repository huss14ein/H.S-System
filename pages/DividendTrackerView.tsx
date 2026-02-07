import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../components/Card';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const DividendTrackerView: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    const { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions } = useMemo(() => {
        const dividendTransactions = data.investmentTransactions.filter(t => t.type === 'dividend');

        const now = new Date();
        const dividendIncomeYTD = dividendTransactions
            .filter(t => new Date(t.date).getFullYear() === now.getFullYear())
            .reduce((sum, t) => sum + t.total, 0);

        const monthlyDividends = new Map<string, number>();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dividendTransactions
            .filter(t => new Date(t.date) >= twelveMonthsAgo)
            .forEach(t => {
                const monthKey = t.date.slice(0, 7); // YYYY-MM
                const currentTotal = monthlyDividends.get(monthKey) || 0;
                monthlyDividends.set(monthKey, currentTotal + t.total);
            });
        
        const monthlyDividendsChartData = Array.from(monthlyDividends.entries())
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(([key, value]) => ({ 
                name: new Date(key + '-02').toLocaleString('default', { month: 'short', year: '2-digit' }), 
                "Dividend Income": value 
            }));

        const recentDividendTransactions = dividendTransactions
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10);

        return { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions };
    }, [data.investmentTransactions]);

    return (
        <div className="mt-6 space-y-6">
             <div className="text-center">
                <h2 className="text-2xl font-bold text-dark">Dividend Tracker</h2>
                <p className="text-gray-500 mt-1">Monitor your passive income from dividend-paying investments.</p>
            </div>
            <Card title="Dividend Income (YTD)" value={formatCurrencyString(dividendIncomeYTD)} />
            
            <div className="bg-white p-6 rounded-lg shadow h-[400px]">
                <h3 className="text-lg font-semibold text-dark mb-4">Monthly Dividend Income</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={monthlyDividendsChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis tickFormatter={(val) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(val)} />
                        <Tooltip formatter={(val: number) => formatCurrencyString(val, { digits: 2 })} />
                        <Legend />
                        <Bar dataKey="Dividend Income" fill="#8b5cf6" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-dark mb-4">Recent Dividend Payments</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50"><tr className="text-left text-xs font-medium text-gray-500 uppercase">
                            <th className="px-4 py-2">Date</th><th className="px-4 py-2">Symbol</th><th className="px-4 py-2 text-right">Amount</th>
                        </tr></thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {recentDividendTransactions.map(t => (
                                <tr key={t.id}>
                                    <td className="px-4 py-2">{new Date(t.date).toLocaleDateString()}</td>
                                    <td className="px-4 py-2 font-semibold">{t.symbol}</td>
                                    <td className="px-4 py-2 text-right font-medium text-green-600">{formatCurrencyString(t.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                 {recentDividendTransactions.length === 0 && <p className="text-center text-gray-500 py-8">No dividend transactions recorded.</p>}
            </div>
        </div>
    );
};

export default DividendTrackerView;