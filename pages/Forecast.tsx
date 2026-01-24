import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, ComposedChart } from 'recharts';
import Card from '../components/Card';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const Forecast: React.FC = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const [horizon, setHorizon] = useState(10);
    const [growthRate, setGrowthRate] = useState(7);
    const [efPolicy, setEfPolicy] = useState(true);
    const [travelBudget, setTravelBudget] = useState(16000);
    const [isLoading, setIsLoading] = useState(false);

    const [forecastData, setForecastData] = useState<any[]>([]);
    const [summary, setSummary] = useState<{
        houseGoalDate: string | null;
        carGoalDate: string | null;
        projectedNetWorth: number | null;
    } | null>(null);

    const { data } = useContext(DataContext)!;

    const initialValues = useMemo(() => {
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0) + data.accounts.filter(a => a.balance < 0).reduce((sum, acc) => sum + acc.balance, 0);
        const netWorth = totalAssets + totalLiabilities;
        const investmentValue = data.investments.reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        const cashValue = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + acc.balance, 0);

        const houseGoal = JSON.parse(JSON.stringify(data.goals.find(g => g.name === 'House Purchase')!));
        const carGoal = JSON.parse(JSON.stringify(data.goals.find(g => g.name === 'New Car')!));

        return { totalAssets, totalLiabilities, netWorth, investmentValue, cashValue, houseGoal, carGoal };
    }, [data]);

    const handleRunForecast = useCallback(() => {
        setIsLoading(true);
        setSummary(null);
        setForecastData([]);

        setTimeout(() => { // Simulate async calculation
            let { investmentValue, cashValue, houseGoal, carGoal } = JSON.parse(JSON.stringify(initialValues));
            
            let netWorth = initialValues.netWorth;
            const coreExpenses = 7000 + 500; // Essentials + Wife
            const efTarget = coreExpenses * 3;
            let efBalance = Math.min(initialValues.cashValue, efTarget);

            const sinkingFunds = { rent: 0, dependents: 0, education: 0 };

            const results = [];
            let houseGoalDate: string | null = null;
            let carGoalDate: string | null = null;
            
            const currentDate = new Date();

            for (let i = 0; i < horizon * 12; i++) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                const year = monthDate.getFullYear();
                const month = monthDate.getMonth();

                // 1. Income
                const salary = year >= 2026 ? 15106 : 30000;
                let monthIncome = salary;
                if (month === 0) monthIncome += 12000; // Tickets
                if (month === 3) monthIncome += salary * 3; // Bonus

                // 2. Sinking Fund Contributions (autopilot)
                sinkingFunds.rent += 18000 / 6;
                sinkingFunds.dependents += 19200 / 12;
                sinkingFunds.education += (13500 * 2 + 5500) / 12;

                // 3. Expenses
                let monthExpense = coreExpenses + 2500; // + personal saving
                if (month === 0 || month === 6) { monthExpense += 18000; sinkingFunds.rent = 0; }
                if (month === 0 && year >= 2026) { monthExpense += 19200; sinkingFunds.dependents = 0; }
                if (month === 7) { monthExpense += (13500 * 2 + 5500); sinkingFunds.education = 0; }
                if (month === 5 || month === 10) monthExpense += travelBudget / 2;
                if (year === 2026 && month === 5) monthExpense += 22000; // Hajj

                // 4. Net Cash Flow
                let netFlow = monthIncome - monthExpense;
                cashValue += netFlow;

                // 5. EF Contribution
                const efGap = efTarget - efBalance;
                if (efPolicy && efGap > 0) {
                    const contribution = Math.min(cashValue, efGap);
                    efBalance += contribution;
                    cashValue -= contribution;
                }
                
                // 6. Goal & Investment Allocation
                const investableCash = cashValue;
                let cashToInvest = investableCash;

                // Priority 1: House
                if (houseGoal.currentAmount < houseGoal.targetAmount && cashToInvest > 0) {
                    const contribution = Math.min(cashToInvest, houseGoal.targetAmount - houseGoal.currentAmount);
                    houseGoal.currentAmount += contribution;
                    cashToInvest -= contribution;
                    if (houseGoal.currentAmount >= houseGoal.targetAmount && !houseGoalDate) {
                        houseGoalDate = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    }
                }
                // Priority 2: Car
                if (carGoal.currentAmount < carGoal.targetAmount && cashToInvest > 0) {
                    const contribution = Math.min(cashToInvest, carGoal.targetAmount - carGoal.currentAmount);
                    carGoal.currentAmount += contribution;
                    cashToInvest -= contribution;
                     if (carGoal.currentAmount >= carGoal.targetAmount && !carGoalDate) {
                        carGoalDate = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    }
                }
                
                // Leftover cash goes to investments
                investmentValue += cashToInvest;
                cashValue -= cashToInvest;

                // 7. Investment Growth
                investmentValue *= (1 + growthRate / 100 / 12);

                // 8. Update Net Worth
                netWorth = cashValue + efBalance + investmentValue + houseGoal.currentAmount + carGoal.currentAmount + initialValues.totalAssets - initialValues.investmentValue - initialValues.cashValue + initialValues.totalLiabilities;

                results.push({
                    name: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                    "Net Worth": Math.round(netWorth),
                    "Investments": Math.round(investmentValue),
                    "House Goal": Math.round(houseGoal.currentAmount),
                    "Car Goal": Math.round(carGoal.currentAmount),
                });
            }

            setForecastData(results);
            setSummary({
                houseGoalDate,
                carGoalDate,
                projectedNetWorth: results.length > 0 ? results[results.length - 1]["Net Worth"] : netWorth
            });
            setIsLoading(false);
        }, 500);
    }, [horizon, growthRate, efPolicy, travelBudget, initialValues]);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Financial Forecast</h1>
                <p className="text-gray-500 mt-1">Project your financial future based on a detailed, rule-based simulation.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow space-y-4 sticky top-24">
                    <h3 className="text-lg font-semibold text-dark border-b pb-2">Forecast Assumptions</h3>
                    <div>
                        <label htmlFor="horizon" className="block text-sm font-medium text-gray-700">Forecast Horizon: {horizon} years</label>
                        <input type="range" id="horizon" min="1" max="30" value={horizon} onChange={e => setHorizon(Number(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                        <label htmlFor="growthRate" className="block text-sm font-medium text-gray-700">Annual Investment Growth (%)</label>
                        <input type="number" id="growthRate" value={growthRate} onChange={e => setGrowthRate(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                     <div>
                        <label htmlFor="travelBudget" className="block text-sm font-medium text-gray-700">Annual Travel Budget</label>
                        <input type="number" id="travelBudget" value={travelBudget} onChange={e => setTravelBudget(Number(e.target.value))} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                    <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center"><input type="checkbox" checked={efPolicy} onChange={e => setEfPolicy(e.target.checked)} className="h-4 w-4 text-primary rounded"/> <span className="ml-2 text-sm">Stop EF funding when target is reached</span></label>
                         <p className="text-xs text-gray-500 ml-6">Automatically redirects cashflow to goals once your 3-month emergency fund is full.</p>
                    </div>
                     <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center font-medium"><span className="ml-2 text-sm">Sinking Funds Autopilot</span></label>
                         <p className="text-xs text-gray-500 ml-2">Automatically sets aside funds for large, known future expenses like rent, tuition, and fees to ensure cash flow stability.</p>
                    </div>
                    <button onClick={handleRunForecast} disabled={isLoading} className="w-full flex items-center justify-center px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors font-semibold">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Calculating...' : 'Run Forecast'}
                    </button>
                </div>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><p className="text-gray-500">Generating your financial forecast...</p></div>}

                    {summary && !isLoading && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card title="House Goal Met" value={summary.houseGoalDate || 'Not Met'} />
                            <Card title="Car Goal Met" value={summary.carGoalDate || 'Not Met'} />
                            <Card title={`Net Worth in ${horizon} Years`} value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} />
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
                                    <Area type="monotone" dataKey="Investments" stackId="1" stroke="#8b5cf6" fill="url(#colorInvest)" name="Total Investments" />
                                    <Area type="monotone" dataKey="House Goal" stackId="1" stroke="#3b82f6" fill="#3b82f6" name="House Savings" />
                                    <Area type="monotone" dataKey="Car Goal" stackId="1" stroke="#10b981" fill="#10b981" name="Car Savings"/>
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