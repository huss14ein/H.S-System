
import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
// FIX: Imported the missing 'Line' component from recharts.
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, ComposedChart, Line } from 'recharts';
import Card from '../components/Card';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const Forecast: React.FC = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const { data } = useContext(DataContext)!;

    const averageMonthlySavings = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        data.transactions.filter(t => new Date(t.date) > twelveMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            const currentNet = monthlyNet.get(monthKey) || 0;
            monthlyNet.set(monthKey, currentNet + t.amount);
        });
        
        if (monthlyNet.size === 0) return 7500; // Default if no recent transactions
        
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, net) => sum + net, 0);
        return Math.max(0, totalNet / monthlyNet.size);
    }, [data.transactions]);

    const [horizon, setHorizon] = useState(10);
    const [monthlySavings, setMonthlySavings] = useState(averageMonthlySavings);
    const [investmentGrowth, setInvestmentGrowth] = useState(7);
    const [incomeGrowth, setIncomeGrowth] = useState(3);
    const [isLoading, setIsLoading] = useState(false);

    const [forecastData, setForecastData] = useState<any[]>([]);
    const [summary, setSummary] = useState<{ projectedNetWorth: number, projectedInvestments: number } | null>(null);

    React.useEffect(() => {
        setMonthlySavings(averageMonthlySavings);
    }, [averageMonthlySavings]);

    const initialValues = useMemo(() => {
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0);
        const netWorth = totalAssets + totalLiabilities;
        const investmentValue = data.investments.reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        return { netWorth, investmentValue };
    }, [data]);

    const handleRunForecast = useCallback(() => {
        setIsLoading(true);
        setSummary(null);
        setForecastData([]);

        setTimeout(() => { // Simulate async calculation
            let currentNetWorth = initialValues.netWorth;
            let currentInvestmentValue = initialValues.investmentValue;
            let currentMonthlySavings = monthlySavings;

            const results = [];
            const currentDate = new Date();

            for (let i = 0; i < horizon * 12; i++) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                
                // At the start of each year, increase savings goal by income growth rate
                if (monthDate.getMonth() === 0 && i > 0) {
                    currentMonthlySavings *= (1 + incomeGrowth / 100);
                }

                // Add monthly savings to investments
                currentInvestmentValue += currentMonthlySavings;
                
                // Grow investments
                currentInvestmentValue *= (1 + investmentGrowth / 100 / 12);
                
                // Recalculate Net Worth
                // Simplified: assumes non-investment assets/liabilities are static.
                // Change in net worth is driven by savings and investment growth.
                currentNetWorth += currentMonthlySavings + (currentInvestmentValue - (currentInvestmentValue / (1 + investmentGrowth / 100 / 12)));


                results.push({
                    name: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                    "Net Worth": Math.round(currentNetWorth),
                    "Investment Value": Math.round(currentInvestmentValue),
                });
            }

            setForecastData(results);
            if (results.length > 0) {
                const finalEntry = results[results.length-1];
                setSummary({
                    projectedNetWorth: finalEntry["Net Worth"],
                    projectedInvestments: finalEntry["Investment Value"],
                });
            }
            setIsLoading(false);
        }, 500);
    }, [horizon, monthlySavings, investmentGrowth, incomeGrowth, initialValues]);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Financial Forecast</h1>
                <p className="text-gray-500 mt-1">Project your financial future based on your current savings habits and market assumptions.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow space-y-4 sticky top-24">
                    <h3 className="text-lg font-semibold text-dark border-b pb-2">Forecast Assumptions</h3>
                    <div>
                        <label htmlFor="horizon" className="block text-sm font-medium text-gray-700">Forecast Horizon: {horizon} years</label>
                        <input type="range" id="horizon" min="1" max="30" value={horizon} onChange={e => setHorizon(Number(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                        <label htmlFor="monthly-savings" className="block text-sm font-medium text-gray-700">Monthly Savings Contribution</label>
                        <input type="number" id="monthly-savings" value={monthlySavings} onChange={e => setMonthlySavings(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                        <p className="text-xs text-gray-500 mt-1">Calculated average is {formatCurrencyString(averageMonthlySavings)}.</p>
                    </div>
                    <div>
                        <label htmlFor="investment-growth" className="block text-sm font-medium text-gray-700">Annual Investment Growth (%)</label>
                        <input type="number" id="investment-growth" value={investmentGrowth} onChange={e => setInvestmentGrowth(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                    <div>
                        <label htmlFor="income-growth" className="block text-sm font-medium text-gray-700">Annual Savings Increase (%)</label>
                        <input type="number" id="income-growth" value={incomeGrowth} onChange={e => setIncomeGrowth(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                    <button onClick={handleRunForecast} disabled={isLoading} className="w-full flex items-center justify-center px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors font-semibold">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Calculating...' : 'Run Forecast'}
                    </button>
                </div>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><p className="text-gray-500">Generating your financial forecast...</p></div>}

                    {summary && !isLoading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card title={`Projected Net Worth in ${horizon} Years`} value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} />
                            <Card title={`Projected Investments in ${horizon} Years`} value={summary.projectedInvestments ? formatCurrencyString(summary.projectedInvestments, { digits: 0 }) : 'N/A'} />
                        </div>
                    )}

                    {forecastData.length > 0 && !isLoading ? (
                        <div className="bg-white p-6 rounded-lg shadow h-[600px]">
                            <h3 className="text-lg font-semibold text-dark mb-4">Financial Projections</h3>
                            <ResponsiveContainer width="100%" height="90%">
                                <ComposedChart data={forecastData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" fontSize={12} />
                                    <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} />
                                    <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })}/>
                                    <Legend />
                                    <defs>
                                        <linearGradient id="colorInvest" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1}/></linearGradient>
                                    </defs>
                                    <Area type="monotone" dataKey="Investment Value" stackId="1" stroke="#8b5cf6" fill="url(#colorInvest)" name="Total Investments" />
                                    <Line type="monotone" dataKey="Net Worth" stroke="#1e3a8a" strokeWidth={3} name="Net Worth" dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                         !isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><p className="text-gray-500">Configure your assumptions and click "Run Forecast" to see your projection.</p></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Forecast;