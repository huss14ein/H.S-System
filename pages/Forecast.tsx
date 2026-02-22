import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, ComposedChart, Line, ReferenceLine } from 'recharts';
import Card from '../components/Card';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { FlagIcon } from '../components/icons/FlagIcon';

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
    const [scenarioPreset, setScenarioPreset] = useState<'Conservative' | 'Base' | 'Aggressive' | 'Custom'>('Base');

    const [forecastData, setForecastData] = useState<any[]>([]);
    const [summary, setSummary] = useState<{ projectedNetWorth: number, projectedInvestments: number } | null>(null);
    const [goalProjections, setGoalProjections] = useState<{ name: string; years: number; months: number; met: boolean }[]>([]);
    const [comparisonResults, setComparisonResults] = useState<Record<'Conservative' | 'Base' | 'Aggressive', { projectedNetWorth: number; projectedInvestments: number } | null>>({
        Conservative: null,
        Base: null,
        Aggressive: null,
    });


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


    const applyScenarioPreset = (preset: 'Conservative' | 'Base' | 'Aggressive') => {
        setScenarioPreset(preset);
        if (preset === 'Conservative') {
            setInvestmentGrowth(4);
            setIncomeGrowth(1);
        } else if (preset === 'Aggressive') {
            setInvestmentGrowth(10);
            setIncomeGrowth(5);
        } else {
            setInvestmentGrowth(7);
            setIncomeGrowth(3);
        }
    };


    const handleManualInvestmentGrowthChange = (value: number) => {
        setInvestmentGrowth(value);
        setScenarioPreset('Custom');
    };

    const handleManualIncomeGrowthChange = (value: number) => {
        setIncomeGrowth(value);
        setScenarioPreset('Custom');
    };

    const handleRunForecast = useCallback(() => {
        setIsLoading(true);
        setSummary(null);
        setForecastData([]);
        setGoalProjections([]);

        setTimeout(() => { // Simulate async calculation
            let currentNetWorth = initialValues.netWorth;
            let currentInvestmentValue = initialValues.investmentValue;
            let currentMonthlySavings = monthlySavings;
            
            const goalsWithProjections = data.goals.map(g => ({ ...g, metMonth: null as number | null }));

            const results = [];
            const currentDate = new Date();

            for (let i = 0; i < horizon * 12; i++) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                
                if (monthDate.getMonth() === 0 && i > 0) {
                    currentMonthlySavings *= (1 + incomeGrowth / 100);
                }

                currentInvestmentValue += currentMonthlySavings;
                currentInvestmentValue *= (1 + investmentGrowth / 100 / 12);
                
                const investmentGain = (currentInvestmentValue * (investmentGrowth / 100 / 12));
                currentNetWorth += currentMonthlySavings + investmentGain;

                goalsWithProjections.forEach(goal => {
                    if (goal.metMonth === null) {
                        const netWorthNeededForGoal = initialValues.netWorth - goal.currentAmount + goal.targetAmount;
                        if (currentNetWorth >= netWorthNeededForGoal) {
                            goal.metMonth = i + 1;
                        }
                    }
                });

                results.push({
                    name: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                    "Net Worth": Math.round(currentNetWorth),
                    "Investment Value": Math.round(currentInvestmentValue),
                });
            }

            setForecastData(results);
            if (results.length > 0) {
                const finalEntry = results[results.length-1];
                const computedSummary = {
                    projectedNetWorth: finalEntry["Net Worth"],
                    projectedInvestments: finalEntry["Investment Value"],
                };
                setSummary(computedSummary);
                if (scenarioPreset !== 'Custom') {
                    setComparisonResults(prev => ({
                        ...prev,
                        [scenarioPreset]: computedSummary,
                    }));
                }
            }
            
            setGoalProjections(goalsWithProjections.map(g => {
                const met = g.metMonth !== null;
                return {
                    name: g.name,
                    met: met,
                    years: met ? Math.floor(g.metMonth! / 12) : 0,
                    months: met ? g.metMonth! % 12 : 0,
                }
            }));

            setIsLoading(false);
        }, 500);
    }, [horizon, monthlySavings, investmentGrowth, incomeGrowth, initialValues, data.goals, scenarioPreset]);

    const goalReferenceLines = useMemo(() => {
        return data.goals.map(goal => {
            const yValue = initialValues.netWorth - goal.currentAmount + goal.targetAmount;
            return {
                y: yValue,
                label: goal.name
            };
        });
    }, [data.goals, initialValues.netWorth]);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Financial Forecast</h1>
                <p className="text-gray-500 mt-1">Project your financial future based on your current savings habits and market assumptions.</p>
            </div>


            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <h2 className="text-base font-semibold text-blue-900 mb-2">How Scenario Planning Works</h2>
                <ul className="text-sm text-blue-800 space-y-1 list-disc pl-5">
                    <li>The model compounds monthly savings into investment value using your annual growth assumption.</li>
                    <li>At the start of each year, monthly savings increase by your “Annual Savings Increase (%)”.</li>
                    <li>Goal projection marks are estimated by comparing forecasted net worth against each goal target gap.</li>
                </ul>
                <p className="text-xs text-blue-700 mt-3">Assumptions are deterministic and educational (not financial advice). Use multiple runs (conservative/base/aggressive) to compare outcomes.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow space-y-4 sticky top-24">
                    <h3 className="text-lg font-semibold text-dark border-b pb-2">Forecast Assumptions</h3>
                    <div className="flex flex-wrap gap-2">
                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => (
                            <button
                                key={preset}
                                onClick={() => applyScenarioPreset(preset)}
                                className={`px-2.5 py-1 text-xs rounded-full border ${scenarioPreset === preset ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-300 hover:border-primary'}`}
                            >
                                {preset}
                            </button>
                        ))}
                    </div>
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
                        <input type="number" id="investment-growth" value={investmentGrowth} onChange={e => handleManualInvestmentGrowthChange(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                    <div>
                        <label htmlFor="income-growth" className="block text-sm font-medium text-gray-700">Annual Savings Increase (%)</label>
                        <input type="number" id="income-growth" value={incomeGrowth} onChange={e => handleManualIncomeGrowthChange(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                    <button onClick={handleRunForecast} disabled={isLoading} className="w-full flex items-center justify-center px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors font-semibold">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Calculating...' : 'Run Forecast'}
                    </button>
                </div>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><p className="text-gray-500">Generating your financial forecast...</p></div>}

                    {summary && !isLoading && (
                        <>
                        <p className="text-sm text-gray-600">Scenario preset used: <span className="font-semibold text-dark">{scenarioPreset}</span></p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card title={`Projected Net Worth in ${horizon} Years`} value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} />
                            <Card title={`Projected Investments in ${horizon} Years`} value={summary.projectedInvestments ? formatCurrencyString(summary.projectedInvestments, { digits: 0 }) : 'N/A'} />
                        </div>
                        </>
                    )}


                    {Object.values(comparisonResults).some(Boolean) && !isLoading && (
                        <div className="bg-white p-6 rounded-lg shadow">
                            <h3 className="text-lg font-semibold text-dark mb-4">Scenario Comparison ({horizon}-Year Horizon)</h3>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-600 border-b">
                                            <th className="py-2 pr-4 font-semibold">Preset</th>
                                            <th className="py-2 pr-4 font-semibold">Projected Net Worth</th>
                                            <th className="py-2 pr-4 font-semibold">Projected Investments</th>
                                            <th className="py-2 pr-4 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => {
                                            const row = comparisonResults[preset];
                                            const isActive = preset === scenarioPreset;
                                            return (
                                                <tr key={preset} className={`border-b last:border-b-0 ${isActive ? 'bg-blue-50/50' : ''}`}>
                                                    <td className="py-2 pr-4 font-medium text-dark">{preset}</td>
                                                    <td className="py-2 pr-4">{row ? formatCurrencyString(row.projectedNetWorth, { digits: 0 }) : '—'}</td>
                                                    <td className="py-2 pr-4">{row ? formatCurrencyString(row.projectedInvestments, { digits: 0 }) : '—'}</td>
                                                    <td className="py-2 pr-4">{row ? (isActive ? 'Current run' : 'Completed') : 'Run pending'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-500 mt-3">Tip: Run all three presets to compare conservative, base, and aggressive outcomes side-by-side.</p>
                        </div>
                    )}
                    
                    {goalProjections.length > 0 && !isLoading && (
                        <div className="bg-white p-6 rounded-lg shadow">
                            <h3 className="text-lg font-semibold text-dark mb-4">Goal Projections</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {goalProjections.map(proj => (
                                    <div key={proj.name} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg border">
                                        <FlagIcon className={`h-6 w-6 flex-shrink-0 ${proj.met ? 'text-green-500' : 'text-gray-400'}`} />
                                        <div>
                                            <p className="font-semibold text-dark">{proj.name}</p>
                                            {proj.met ? (
                                                <p className="text-sm text-green-700">Projected to be met in <span className="font-bold">{proj.years} years</span> and <span className="font-bold">{proj.months} months</span>.</p>
                                            ) : (
                                                <p className="text-sm text-gray-500">Not met within {horizon} years at current rate.</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
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
                                    {goalReferenceLines.map(line => (
                                         <ReferenceLine key={line.label} y={line.y} stroke="#e11d48" strokeDasharray="4 4" >
                                             <Legend payload={[{ value: line.label, type: 'line', color: '#e11d48' }]} />
                                         </ReferenceLine>
                                    ))}
                                    <Area type="monotone" dataKey="Investment Value" stackId="1" stroke="#8b5cf6" fill="url(#colorInvest)" name="Total Investments" />
                                    <Line type="monotone" dataKey="Net Worth" stroke="#1e3a8a" strokeWidth={3} name="Net Worth" dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                         !isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><p className="text-gray-500">Configure assumptions, run a base case, then adjust growth/savings to compare conservative vs aggressive scenarios.</p></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Forecast;
