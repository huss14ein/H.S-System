import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, ComposedChart, Line, ReferenceLine } from 'recharts';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from '../components/charts/chartTheme';
import Card from '../components/Card';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from '../components/InfoHint';
import { FlagIcon } from '../components/icons/FlagIcon';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';
import { buildBaselineScenarioTimeline } from '../services/scenarioTimelineEngine';
import { ArrowDownTrayIcon } from '../components/icons/ArrowDownTrayIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';


const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toMonthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

const Forecast: React.FC = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();

    const savingsAnalytics = useMemo(() => {
        try {
            const monthlyNet = new Map<string, number>();
            const now = new Date();

            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                monthlyNet.set(d.toISOString().slice(0, 7), 0);
            }

            (data?.transactions ?? []).forEach(t => {
                try {
                    const monthKey = t.date.slice(0, 7);
                    if (!monthlyNet.has(monthKey)) return;
                    const amount = Number(t.amount) || 0;
                    if (Number.isFinite(amount)) {
                        monthlyNet.set(monthKey, (monthlyNet.get(monthKey) || 0) + amount);
                    }
                } catch (e) {
                    // Skip invalid transactions
                }
            });

            const values = Array.from(monthlyNet.values()).filter(v => Number.isFinite(v));
            if (values.length === 0) {
                return { averageMonthlySavings: 7500, medianMonthlySavings: 7500, monthlyStdDev: 0, consistencyScore: 0, incomeGrowthSuggestion: 3 };
            }

            const averageMonthlySavings = values.reduce((sum, v) => sum + v, 0) / values.length;
            const sorted = [...values].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            const medianMonthlySavings = sorted.length % 2 === 0 
                ? (sorted[middle - 1] + sorted[middle]) / 2 
                : sorted[middle];

            const variance = values.reduce((sum, v) => sum + Math.pow(v - averageMonthlySavings, 2), 0) / values.length;
            const monthlyStdDev = Math.sqrt(Math.max(0, variance));
            const consistencyScore = Math.abs(averageMonthlySavings) > 0.01
                ? clamp(100 - (Math.abs(monthlyStdDev / averageMonthlySavings) * 100), 0, 100)
                : 0;

            const firstHalfAvg = values.slice(0, Math.min(6, values.length)).reduce((sum, v) => sum + v, 0) / Math.min(6, values.length);
            const secondHalfValues = values.slice(Math.max(0, values.length - 6));
            const secondHalfAvg = secondHalfValues.length > 0 
                ? secondHalfValues.reduce((sum, v) => sum + v, 0) / secondHalfValues.length 
                : firstHalfAvg;
            const growthRatio = Math.abs(firstHalfAvg) > 0.01 
                ? (secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg) 
                : 0;
            const incomeGrowthSuggestion = clamp(growthRatio * 100, -2, 12);

            return {
                averageMonthlySavings: Math.max(0, averageMonthlySavings),
                medianMonthlySavings: Math.max(0, medianMonthlySavings),
                monthlyStdDev: Math.max(0, monthlyStdDev),
                consistencyScore: Math.max(0, Math.min(100, consistencyScore)),
                incomeGrowthSuggestion: Math.max(-2, Math.min(12, incomeGrowthSuggestion)),
            };
        } catch (error) {
            console.error('Error calculating savings analytics:', error);
            return { averageMonthlySavings: 7500, medianMonthlySavings: 7500, monthlyStdDev: 0, consistencyScore: 0, incomeGrowthSuggestion: 3 };
        }
    }, [data?.transactions]);

    const [horizon, setHorizon] = useState(10);
    const [monthlySavings, setMonthlySavings] = useState(savingsAnalytics.medianMonthlySavings);
    const [investmentGrowth, setInvestmentGrowth] = useState(7);
    const [incomeGrowth, setIncomeGrowth] = useState(3);
    const [inflationRate, setInflationRate] = useState(2.5);
    const [isLoading, setIsLoading] = useState(false);
    const [scenarioPreset, setScenarioPreset] = useState<'Conservative' | 'Base' | 'Aggressive' | 'Custom'>('Base');

    const [forecastData, setForecastData] = useState<any[]>([]);
    const [confidenceBand, setConfidenceBand] = useState<{ low: number; high: number } | null>(null);
    const [summary, setSummary] = useState<{ projectedNetWorth: number, projectedInvestments: number } | null>(null);
    const [goalProjections, setGoalProjections] = useState<{ name: string; years: number; months: number; met: boolean }[]>([]);
    const [comparisonResults, setComparisonResults] = useState<Record<'Conservative' | 'Base' | 'Aggressive', { projectedNetWorth: number; projectedInvestments: number } | null>>({
        Conservative: null,
        Base: null,
        Aggressive: null,
    });
    const [timeline, setTimeline] = useState<{ horizonYears: number; events: { yearOffset: number; label: string; narrative: string }[] } | null>(null);


    React.useEffect(() => {
        if (savingsAnalytics.medianMonthlySavings > 0) {
            setMonthlySavings(savingsAnalytics.medianMonthlySavings);
        }
    }, [savingsAnalytics.medianMonthlySavings]);

    const initialValues = useMemo(() => {
        try {
            const assets = data?.assets ?? [];
            const accounts = data?.accounts ?? [];
            const liabilities = data?.liabilities ?? [];
            const investments = data?.investments ?? [];
            const commodityHoldings = data?.commodityHoldings ?? [];
            
            // Calculate physical assets
            const totalPhysicalAssets = Math.max(0, assets.reduce((sum, asset) => sum + (Number(asset.value) || 0), 0));
            
            // Calculate cash (positive balances from Checking/Savings accounts only)
            const cashAccounts = accounts.filter(a => a.type === 'Checking' || a.type === 'Savings');
            const totalCash = Math.max(0, cashAccounts.reduce((sum, acc) => sum + Math.max(0, Number(acc.balance) || 0), 0));
            
            // Calculate commodities
            const totalCommodities = Math.max(0, commodityHoldings.reduce((sum, ch) => sum + (Number(ch.currentValue) || 0), 0));
            
            // Calculate investments
            const investmentValue = Math.max(0, getAllInvestmentsValueInSAR(investments, exchangeRate));
            
            // Total assets = physical assets + cash + commodities + investments
            const totalAssets = totalPhysicalAssets + totalCash + totalCommodities + investmentValue;
            
            // Calculate debts (negative liabilities + negative credit card balances)
            const totalDebt = Math.max(0, 
                liabilities
                    .filter(l => (Number(l.amount) || 0) < 0)
                    .reduce((sum, liab) => sum + Math.abs(Number(liab.amount) || 0), 0) +
                accounts
                    .filter(a => a.type === 'Credit' && (Number(a.balance) || 0) < 0)
                    .reduce((sum, acc) => sum + Math.abs(Number(acc.balance) || 0), 0)
            );
            
            // Calculate receivables (positive liabilities)
            const totalReceivable = Math.max(0, 
                liabilities
                    .filter(l => (Number(l.amount) || 0) > 0 || l.type === 'Receivable')
                    .reduce((sum, liab) => sum + (Number(liab.amount) || 0), 0)
            );
            
            // Net worth = Assets - Debts + Receivables
            const netWorth = totalAssets - totalDebt + totalReceivable;
            
            return { 
                netWorth: Math.max(0, netWorth), 
                investmentValue,
                totalCash,
                totalDebt,
                totalReceivable,
            };
        } catch (error) {
            console.error('Error calculating initial values:', error);
            return { 
                netWorth: 0, 
                investmentValue: 0,
                totalCash: 0,
                totalDebt: 0,
                totalReceivable: 0,
            };
        }
    }, [data, exchangeRate]);


    const applyScenarioPreset = (preset: 'Conservative' | 'Base' | 'Aggressive') => {
        setScenarioPreset(preset);
        if (preset === 'Conservative') {
            setInvestmentGrowth(4);
            setIncomeGrowth(1);
            setInflationRate(2.0);
        } else if (preset === 'Aggressive') {
            setInvestmentGrowth(10);
            setIncomeGrowth(5);
            setInflationRate(3.0);
        } else {
            setInvestmentGrowth(7);
            setIncomeGrowth(3);
            setInflationRate(2.5);
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
        try {
            setIsLoading(true);
            setSummary(null);
            setForecastData([]);
            setGoalProjections([]);
            setConfidenceBand(null);
            setTimeline(null);

            setTimeout(() => { // Simulate async calculation
                try {
                    let currentNetWorth = Math.max(0, initialValues.netWorth);
                    let currentInvestmentValue = Math.max(0, initialValues.investmentValue);
                    let currentMonthlySavings = Math.max(0, monthlySavings);
                    
                    const goalsWithProjections = (data?.goals ?? []).map(g => ({ 
                        ...g, 
                        currentAmount: Number(g.currentAmount) || 0,
                        targetAmount: Number(g.targetAmount) || 0,
                        metMonth: null as number | null 
                    }));

                    const results = [];
                    const currentDate = new Date();
                    const validatedInvestmentGrowth = clamp(investmentGrowth, -40, 40);
                    const validatedIncomeGrowth = clamp(incomeGrowth, -20, 40);

                    for (let i = 0; i < horizon * 12; i++) {
                        const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                        
                        // Apply annual income growth at the start of each year (January)
                        if (monthDate.getMonth() === 0 && i > 0) {
                            currentMonthlySavings *= (1 + validatedIncomeGrowth / 100);
                        }

                        const normalizedMonthlySavings = Math.max(0, currentMonthlySavings);
                        const monthlyGrowthRate = toMonthlyRate(validatedInvestmentGrowth);

                        // Add monthly savings to investments
                        currentInvestmentValue += normalizedMonthlySavings;
                        
                        // Apply investment growth
                        const investmentGain = currentInvestmentValue * monthlyGrowthRate;
                        currentInvestmentValue = Math.max(0, currentInvestmentValue + investmentGain);
                        
                        // Update net worth: Net worth changes by the growth in investment value
                        // Since investments are part of net worth, the change is the difference in investment value
                        // from initial to current (which includes contributions + growth)
                        currentNetWorth = Math.max(0, initialValues.netWorth + (currentInvestmentValue - initialValues.investmentValue));

                        // Check if goals are met
                        goalsWithProjections.forEach(goal => {
                            if (goal.metMonth === null && goal.targetAmount > 0) {
                                // Calculate the additional net worth needed to reach the goal
                                const goalGap = Math.max(0, goal.targetAmount - goal.currentAmount);
                                const netWorthNeededForGoal = initialValues.netWorth + goalGap;
                                if (currentNetWorth >= netWorthNeededForGoal) {
                                    goal.metMonth = i + 1;
                                }
                            }
                        });

                        results.push({
                            name: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                            "Net Worth": Math.round(Math.max(0, currentNetWorth)),
                            "Investment Value": Math.round(Math.max(0, currentInvestmentValue)),
                            monthIndex: i,
                        });
                    }

                    setForecastData(results);
                    if (results.length > 0) {
                        const finalEntry = results[results.length - 1];
                        const computedSummary = {
                            projectedNetWorth: Math.max(0, finalEntry["Net Worth"]),
                            projectedInvestments: Math.max(0, finalEntry["Investment Value"]),
                        };
                        setSummary(computedSummary);
                        if (scenarioPreset !== 'Custom') {
                            setComparisonResults(prev => ({
                                ...prev,
                                [scenarioPreset]: computedSummary,
                            }));
                        }

                        // Calculate confidence band based on volatility and horizon
                        const avgSavings = Math.max(0.01, savingsAnalytics.averageMonthlySavings);
                        const volatilityFactor = clamp(savingsAnalytics.monthlyStdDev / avgSavings, 0, 1.5);
                        const horizonRisk = Math.sqrt(Math.max(1, horizon));
                        const spread = computedSummary.projectedNetWorth * (0.05 + volatilityFactor * 0.08) * (horizonRisk / 4);
                        setConfidenceBand({
                            low: Math.max(0, Math.round(computedSummary.projectedNetWorth - spread)),
                            high: Math.max(0, Math.round(computedSummary.projectedNetWorth + spread)),
                        });
                        setTimeline(buildBaselineScenarioTimeline(data, horizon, computedSummary.projectedNetWorth));
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
                } catch (error) {
                    console.error('Error in forecast calculation:', error);
                    setIsLoading(false);
                    setSummary(null);
                    setForecastData([]);
                }
            }, 500);
        } catch (error) {
            console.error('Error starting forecast:', error);
            setIsLoading(false);
        }
    }, [horizon, monthlySavings, investmentGrowth, incomeGrowth, initialValues, data?.goals, scenarioPreset, savingsAnalytics.monthlyStdDev, savingsAnalytics.averageMonthlySavings, data]);

    const goalReferenceLines = useMemo(() => {
        return (data?.goals ?? []).map(goal => {
            const yValue = initialValues.netWorth - goal.currentAmount + goal.targetAmount;
            return {
                y: yValue,
                label: goal.name
            };
        });
    }, [data?.goals, initialValues.netWorth]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Financial Forecast"
            description="Project your financial future based on your current savings habits and market assumptions."
        >
            <div className="alert-info mb-6">
                <h2 className="text-base font-semibold text-blue-900 mb-2">How Scenario Planning Works</h2>
                <ul className="text-sm text-blue-800 space-y-1 list-disc pl-5">
                    <li>The model compounds monthly savings into investment value using your annual growth assumption.</li>
                    <li>At the start of each year, monthly savings increase by your “Annual Savings Increase (%)”.</li>
                    <li>Goal projection marks are estimated by comparing forecasted net worth against each goal target gap.</li>
                </ul>
                <p className="text-xs text-blue-700 mt-3">Assumptions are deterministic and educational (not financial advice). Use multiple runs (conservative/base/aggressive) to compare outcomes.</p>
            </div>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-4 items-start">
                <SectionCard title="Forecast Assumptions" className="lg:col-span-1 sticky top-24 space-y-4">
                    <p className="text-xs text-gray-600 flex items-center gap-1"><InfoHint text="Presets set growth and savings increase; run each to compare scenarios in the table." /> Scenario presets:</p>
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
                        <button
                            type="button"
                            onClick={() => {
                                setMonthlySavings(savingsAnalytics.medianMonthlySavings);
                                handleManualIncomeGrowthChange(Number(savingsAnalytics.incomeGrowthSuggestion.toFixed(1)));
                            }}
                            className="px-2.5 py-1 text-xs rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                        >
                            Auto-fill from history
                        </button>
                    </div>
                    <div>
                        <label htmlFor="horizon" className="block text-sm font-medium text-gray-700 flex items-center">Forecast Horizon: {horizon} years <InfoHint text="Number of years to project net worth and savings growth." /></label>
                        <input type="range" id="horizon" min="1" max="30" value={horizon} onChange={e => setHorizon(Number(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                        <label htmlFor="monthly-savings" className="block text-sm font-medium text-gray-700 flex items-center">Monthly Savings Contribution <InfoHint text="Amount you save per month; used to project future wealth. Default uses your calculated average." /></label>
                        <input 
                            type="number" 
                            id="monthly-savings" 
                            value={monthlySavings} 
                            onChange={e => setMonthlySavings(Math.max(0, Number(e.target.value) || 0))} 
                            className="input-base mt-1"
                            min="0"
                            step="100"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Calculated 12M median: <span className="font-semibold">{formatCurrencyString(savingsAnalytics.medianMonthlySavings)}</span> • 
                            Average: <span className="font-semibold">{formatCurrencyString(savingsAnalytics.averageMonthlySavings)}</span>
                        </p>
                        {savingsAnalytics.consistencyScore > 0 && (
                            <p className="text-xs text-slate-600 mt-1">
                                Consistency: {savingsAnalytics.consistencyScore.toFixed(0)}/100
                            </p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="investment-growth" className="block text-sm font-medium text-gray-700 flex items-center">Annual Investment Growth (%) <InfoHint text="Expected yearly return on investments; affects projected net worth." /></label>
                        <input 
                            type="number" 
                            id="investment-growth" 
                            value={investmentGrowth} 
                            onChange={e => handleManualInvestmentGrowthChange(clamp(Number(e.target.value) || 0, -40, 40))} 
                            className="input-base mt-1"
                            min="-40"
                            max="40"
                            step="0.1"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Range: -40% to 40%. Typical: 4-7% (conservative), 7-10% (moderate), 10%+ (aggressive)
                        </p>
                    </div>
                    <div>
                        <label htmlFor="income-growth" className="block text-sm font-medium text-gray-700 flex items-center">Annual Savings Increase (%) <InfoHint text="Assume your monthly savings grow by this percent each year (e.g. raises)." /></label>
                        <input 
                            type="number" 
                            id="income-growth" 
                            value={incomeGrowth} 
                            onChange={e => handleManualIncomeGrowthChange(clamp(Number(e.target.value) || 0, -20, 40))} 
                            className="input-base mt-1"
                            min="-20"
                            max="40"
                        />
                    </div>
                    <div>
                        <label htmlFor="inflation-rate" className="block text-sm font-medium text-gray-700 flex items-center">Inflation Rate (%) <InfoHint text="Annual inflation rate for adjusting future values. Default: 2.5%." /></label>
                        <input 
                            type="number" 
                            id="inflation-rate" 
                            value={inflationRate} 
                            onChange={e => setInflationRate(clamp(Number(e.target.value) || 0, 0, 10))} 
                            className="input-base mt-1"
                            min="0"
                            max="10"
                            step="0.1"
                        />
                        <p className="text-xs text-gray-500 mt-1">Used for real value calculations (optional).</p>
                    </div>
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Current Net Worth</p>
                        <p className="text-lg font-bold text-blue-800">{formatCurrencyString(initialValues.netWorth, { digits: 0 })}</p>
                        <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                            <div>
                                <p className="text-blue-700">Investments</p>
                                <p className="font-semibold">{formatCurrencyString(initialValues.investmentValue, { digits: 0 })}</p>
                            </div>
                            <div>
                                <p className="text-blue-700">Cash</p>
                                <p className="font-semibold">{formatCurrencyString(initialValues.totalCash || 0, { digits: 0 })}</p>
                            </div>
                        </div>
                    </div>
                    <button 
                        type="button" 
                        onClick={handleRunForecast} 
                        disabled={isLoading || monthlySavings <= 0 || horizon <= 0} 
                        className="w-full btn-primary flex items-center justify-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <SparklesIcon className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                        {isLoading ? 'Calculating...' : 'Run Forecast'}
                    </button>
                    {monthlySavings <= 0 && (
                        <p className="text-xs text-red-600 flex items-center gap-1">
                            <ExclamationTriangleIcon className="h-3 w-3" />
                            Monthly savings must be greater than 0
                        </p>
                    )}
                </SectionCard>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && (
                        <div className="text-center p-10 bg-white rounded-lg shadow">
                            <LoadingSpinner message="Generating your financial forecast..." />
                            <p className="text-xs text-slate-500 mt-2">This may take a few moments...</p>
                        </div>
                    )}

                    {summary && !isLoading && (
                        <>
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                            <p className="text-sm text-gray-600">
                                Scenario preset used: <span className="font-semibold text-dark">{scenarioPreset}</span>
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    const exportData = {
                                        scenario: scenarioPreset,
                                        horizon,
                                        assumptions: {
                                            monthlySavings,
                                            investmentGrowth,
                                            incomeGrowth,
                                            inflationRate,
                                        },
                                        initialValues: {
                                            netWorth: initialValues.netWorth,
                                            investmentValue: initialValues.investmentValue,
                                        },
                                        projections: {
                                            projectedNetWorth: summary.projectedNetWorth,
                                            projectedInvestments: summary.projectedInvestments,
                                            confidenceBand,
                                        },
                                        goalProjections,
                                        forecastData,
                                        exportedAt: new Date().toISOString(),
                                    };
                                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `forecast-${scenarioPreset.toLowerCase()}-${horizon}y-${new Date().toISOString().slice(0, 10)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="text-xs px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                            >
                                <ArrowDownTrayIcon className="h-4 w-4" />
                                Export Forecast
                            </button>
                        </div>
                        <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card 
                                title={`Projected Net Worth in ${horizon} Years`} 
                                value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} 
                                tooltip="Estimated total net worth at the end of the forecast period."
                                trend={initialValues.netWorth > 0 ? `${(((summary.projectedNetWorth - initialValues.netWorth) / initialValues.netWorth) * 100).toFixed(1)}% growth` : undefined}
                                indicatorColor="green"
                            />
                            <Card 
                                title={`Projected Investments in ${horizon} Years`} 
                                value={summary.projectedInvestments ? formatCurrencyString(summary.projectedInvestments, { digits: 0 }) : 'N/A'} 
                                tooltip="Estimated investment portfolio value at the end of the forecast period."
                                trend={initialValues.investmentValue > 0 ? `${(((summary.projectedInvestments - initialValues.investmentValue) / initialValues.investmentValue) * 100).toFixed(1)}% growth` : undefined}
                                indicatorColor="green"
                            />
                        </div>
                        {initialValues.netWorth > 0 && (
                            <div className="mt-3 p-3 bg-gradient-to-r from-slate-50 to-blue-50 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                <div className="p-2 bg-white rounded border border-emerald-200">
                                    <p className="text-xs text-slate-500">Net Worth Growth</p>
                                    <p className="font-bold text-emerald-600 text-lg">
                                        {formatCurrencyString(summary.projectedNetWorth - initialValues.netWorth, { digits: 0 })}
                                    </p>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                        {initialValues.netWorth > 0 
                                            ? `${(((summary.projectedNetWorth - initialValues.netWorth) / initialValues.netWorth) * 100).toFixed(1)}% increase`
                                            : 'N/A'}
                                    </p>
                                </div>
                                <div className="p-2 bg-white rounded border border-blue-200">
                                    <p className="text-xs text-slate-500">Investment Growth</p>
                                    <p className="font-bold text-blue-600 text-lg">
                                        {formatCurrencyString(summary.projectedInvestments - initialValues.investmentValue, { digits: 0 })}
                                    </p>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                        {initialValues.investmentValue > 0 
                                            ? `${(((summary.projectedInvestments - initialValues.investmentValue) / initialValues.investmentValue) * 100).toFixed(1)}% increase`
                                            : 'N/A'}
                                    </p>
                                </div>
                                <div className="p-2 bg-white rounded border border-purple-200">
                                    <p className="text-xs text-slate-500">Total Contributions</p>
                                    <p className="font-bold text-purple-600 text-lg">
                                        {formatCurrencyString(monthlySavings * horizon * 12, { digits: 0 })}
                                    </p>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                        Over {horizon} {horizon === 1 ? 'year' : 'years'}
                                    </p>
                                </div>
                            </div>
                        )}
                        {confidenceBand && (
                            <SectionCard title="Forecast Confidence Band" className="mt-4 border-l-4 border-blue-500">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
                                    <div className="rounded-lg border-2 border-red-200 bg-red-50 p-3">
                                        <p className="text-red-700 font-semibold text-xs uppercase mb-1">Low Case</p>
                                        <p className="font-bold text-red-800 text-lg">{formatCurrencyString(confidenceBand.low, { digits: 0 })}</p>
                                        <p className="text-xs text-red-600 mt-1">
                                            {initialValues.netWorth > 0 
                                                ? `${(((confidenceBand.low - initialValues.netWorth) / initialValues.netWorth) * 100).toFixed(1)}% vs current`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-3">
                                        <p className="text-blue-700 font-semibold text-xs uppercase mb-1">Base Case</p>
                                        <p className="font-bold text-blue-800 text-lg">{formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}</p>
                                        <p className="text-xs text-blue-600 mt-1">
                                            {initialValues.netWorth > 0 
                                                ? `${(((summary.projectedNetWorth - initialValues.netWorth) / initialValues.netWorth) * 100).toFixed(1)}% vs current`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border-2 border-green-200 bg-green-50 p-3">
                                        <p className="text-green-700 font-semibold text-xs uppercase mb-1">High Case</p>
                                        <p className="font-bold text-green-800 text-lg">{formatCurrencyString(confidenceBand.high, { digits: 0 })}</p>
                                        <p className="text-xs text-green-600 mt-1">
                                            {initialValues.netWorth > 0 
                                                ? `${(((confidenceBand.high - initialValues.netWorth) / initialValues.netWorth) * 100).toFixed(1)}% vs current`
                                                : 'N/A'}
                                        </p>
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <p className="text-xs text-slate-600">
                                        <strong>Confidence Range:</strong> {formatCurrencyString(confidenceBand.high - confidenceBand.low, { digits: 0 })} 
                                        ({(((confidenceBand.high - confidenceBand.low) / summary.projectedNetWorth) * 100).toFixed(1)}% of base case)
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Band is automatically scaled by savings volatility ({savingsAnalytics.monthlyStdDev > 0 ? formatCurrencyString(savingsAnalytics.monthlyStdDev, { digits: 0 }) : 'low'}) 
                                        and {horizon}-year horizon to highlight uncertainty.
                                    </p>
                                </div>
                            </SectionCard>
                        )}
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-4 text-xs">
                                    <div>
                                        <span className="text-slate-500">Data Quality:</span>
                                        <span className={`font-semibold ml-1 ${
                                            savingsAnalytics.consistencyScore >= 80 ? 'text-emerald-600' :
                                            savingsAnalytics.consistencyScore >= 60 ? 'text-yellow-600' :
                                            'text-red-600'
                                        }`}>
                                            {savingsAnalytics.consistencyScore.toFixed(0)}/100
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Volatility:</span>
                                        <span className="font-semibold ml-1 text-slate-800">
                                            {formatCurrencyString(savingsAnalytics.monthlyStdDev, { digits: 0 })}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Avg Savings:</span>
                                        <span className="font-semibold ml-1 text-slate-800">
                                            {formatCurrencyString(savingsAnalytics.averageMonthlySavings, { digits: 0 })}
                                        </span>
                                    </div>
                                </div>
                                {savingsAnalytics.consistencyScore < 60 && (
                                    <div className="flex items-center gap-1 text-xs text-amber-600">
                                        <ExclamationTriangleIcon className="h-3 w-3" />
                                        <span>Low consistency - forecast may be less reliable</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        </>
                    )}


                    {Object.values(comparisonResults).some(Boolean) && !isLoading && (
                        <SectionCard title={`Scenario Comparison (${horizon}-Year Horizon)`}>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-600 border-b">
                                            <th className="py-2 pr-4 font-semibold">Preset</th>
                                            <th className="py-2 pr-4 font-semibold">Projected Net Worth</th>
                                            <th className="py-2 pr-4 font-semibold">Projected Investments</th>
                                            <th className="py-2 pr-4 font-semibold">Growth vs Current</th>
                                            <th className="py-2 pr-4 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => {
                                            const row = comparisonResults[preset];
                                            const isActive = preset === scenarioPreset;
                                            const growthPct = row && initialValues.netWorth > 0
                                                ? ((row.projectedNetWorth - initialValues.netWorth) / initialValues.netWorth) * 100
                                                : null;
                                            return (
                                                <tr key={preset} className={`border-b last:border-b-0 ${isActive ? 'bg-blue-50/50' : ''}`}>
                                                    <td className="py-2 pr-4 font-medium text-dark">{preset}</td>
                                                    <td className="py-2 pr-4">
                                                        {row ? (
                                                            <span className="font-semibold">{formatCurrencyString(row.projectedNetWorth, { digits: 0 })}</span>
                                                        ) : '—'}
                                                    </td>
                                                    <td className="py-2 pr-4">
                                                        {row ? formatCurrencyString(row.projectedInvestments, { digits: 0 }) : '—'}
                                                    </td>
                                                    <td className="py-2 pr-4">
                                                        {growthPct !== null ? (
                                                            <span className={`font-semibold ${growthPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                                {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%
                                                            </span>
                                                        ) : '—'}
                                                    </td>
                                                    <td className="py-2 pr-4">
                                                        {row ? (
                                                            <span className={`flex items-center gap-1 ${isActive ? 'text-blue-600' : 'text-emerald-600'}`}>
                                                                {isActive ? (
                                                                    <>
                                                                        <CheckCircleIcon className="h-4 w-4" />
                                                                        <span>Current run</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <CheckCircleIcon className="h-4 w-4" />
                                                                        <span>Completed</span>
                                                                    </>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">Run pending</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-500 mt-3">Tip: Run all three presets to compare conservative, base, and aggressive outcomes side-by-side.</p>
                        </SectionCard>
                    )}
                    
                    {goalProjections.length > 0 && !isLoading && (
                        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-primary">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-dark flex items-center gap-2">
                                    <FlagIcon className="h-5 w-5 text-primary" />
                                    Goal Projections
                                </h3>
                                <span className="text-xs text-slate-500">
                                    {goalProjections.filter(p => p.met).length} of {goalProjections.length} goals achievable
                                </span>
                            </div>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-3">
                                {goalProjections.map(proj => {
                                    const goal = (data?.goals ?? []).find(g => g.name === proj.name);
                                    return (
                                        <div 
                                            key={proj.name} 
                                            className={`flex items-center space-x-3 p-4 rounded-lg border-2 transition-all ${
                                                proj.met 
                                                    ? 'bg-emerald-50 border-emerald-200' 
                                                    : 'bg-slate-50 border-slate-200'
                                            }`}
                                        >
                                            <FlagIcon className={`h-6 w-6 flex-shrink-0 ${proj.met ? 'text-emerald-500' : 'text-slate-400'}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-dark">{proj.name}</p>
                                                {goal && (
                                                    <p className="text-xs text-slate-500 mt-0.5">
                                                        Target: {formatCurrencyString(goal.targetAmount, { digits: 0 })} • 
                                                        Current: {formatCurrencyString(goal.currentAmount, { digits: 0 })}
                                                    </p>
                                                )}
                                                {proj.met ? (
                                                    <p className="text-sm text-emerald-700 mt-1">
                                                        <span className="font-bold">Projected to be met in {proj.years} years and {proj.months} months</span>
                                                    </p>
                                                ) : (
                                                    <p className="text-sm text-slate-500 mt-1">
                                                        Not met within {horizon} years at current rate. Consider increasing savings or extending horizon.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {forecastData.length > 0 && !isLoading ? (
                        <div className="section-card flex flex-col h-[500px] sm:h-[600px]">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="section-title">Financial Projections</h3>
                                {confidenceBand && (
                                    <div className="flex items-center gap-2 text-xs">
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded bg-red-200"></div>
                                            <span className="text-slate-600">Low: {formatCurrencyString(confidenceBand.low, { digits: 0 })}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded bg-blue-500"></div>
                                            <span className="text-slate-600">Base: {formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded bg-green-200"></div>
                                            <span className="text-slate-600">High: {formatCurrencyString(confidenceBand.high, { digits: 0 })}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={forecastData} margin={{ ...CHART_MARGIN, right: 24, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                        <XAxis 
                                            dataKey="name" 
                                            stroke={CHART_AXIS_COLOR} 
                                            fontSize={12} 
                                            tickLine={false}
                                            interval={Math.floor(forecastData.length / 12)}
                                        />
                                        <YAxis 
                                            tickFormatter={(v) => formatAxisNumber(Number(v))} 
                                            stroke={CHART_AXIS_COLOR} 
                                            fontSize={12} 
                                            tickLine={false} 
                                            width={56} 
                                        />
                                        <Tooltip
                                            formatter={(value, name) => [
                                                formatCurrencyString(Number(value), { digits: 0 }),
                                                name
                                            ]}
                                            labelFormatter={(label, payload) => {
                                                if (payload && payload[0]) {
                                                    const monthIndex = payload[0].payload.monthIndex;
                                                    const years = Math.floor(monthIndex / 12);
                                                    const months = monthIndex % 12;
                                                    return `${label} (${years}y ${months}m)`;
                                                }
                                                return label;
                                            }}
                                            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                                        />
                                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                        <defs>
                                            <linearGradient id="colorInvest" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.4}/>
                                                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.1}/>
                                            </linearGradient>
                                            {confidenceBand && (
                                                <>
                                                    <linearGradient id="confidenceLow" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#fca5a5" stopOpacity={0.2}/>
                                                        <stop offset="95%" stopColor="#fca5a5" stopOpacity={0.05}/>
                                                    </linearGradient>
                                                    <linearGradient id="confidenceHigh" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#86efac" stopOpacity={0.2}/>
                                                        <stop offset="95%" stopColor="#86efac" stopOpacity={0.05}/>
                                                    </linearGradient>
                                                </>
                                            )}
                                        </defs>
                                        {confidenceBand && (
                                            <>
                                                <Area 
                                                    type="monotone" 
                                                    dataKey={() => confidenceBand.high} 
                                                    stroke="none" 
                                                    fill="url(#confidenceHigh)" 
                                                    name="High Case"
                                                    isAnimationActive={false}
                                                />
                                                <Area 
                                                    type="monotone" 
                                                    dataKey={() => confidenceBand.low} 
                                                    stroke="none" 
                                                    fill="url(#confidenceLow)" 
                                                    name="Low Case"
                                                    isAnimationActive={false}
                                                />
                                            </>
                                        )}
                                        {goalReferenceLines.map(line => (
                                             <ReferenceLine 
                                                key={line.label} 
                                                y={line.y} 
                                                stroke={CHART_COLORS.negative} 
                                                strokeDasharray="4 4" 
                                                label={{ 
                                                    value: line.label, 
                                                    position: 'right', 
                                                    fill: CHART_COLORS.axis, 
                                                    fontSize: 11 
                                                }} 
                                            />
                                        ))}
                                        <Area 
                                            type="monotone" 
                                            dataKey="Investment Value" 
                                            stackId="1" 
                                            stroke={CHART_COLORS.secondary} 
                                            fill="url(#colorInvest)" 
                                            name="Total Investments"
                                            strokeWidth={2}
                                        />
                                        <Line 
                                            type="monotone" 
                                            dataKey="Net Worth" 
                                            stroke={CHART_COLORS.primary} 
                                            strokeWidth={3} 
                                            name="Net Worth" 
                                            dot={false}
                                            activeDot={{ r: 6 }}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ) : (
                         !isLoading && (
                            <div className="section-card text-center py-12">
                                <ChartBarIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                                <p className="text-slate-600 font-medium mb-1">No forecast data yet</p>
                                <p className="text-slate-500 text-sm">Configure assumptions and click "Run Forecast" to generate projections.</p>
                                <p className="text-xs text-slate-400 mt-2">Tip: Run multiple scenarios (Conservative, Base, Aggressive) to compare outcomes.</p>
                            </div>
                         )
                    )}
                </div>
            </div>

            {timeline && (
                <SectionCard title="Scenario Timeline" className="mt-6">
                    <p className="text-xs text-gray-600 mb-3">
                        Narrative view of your baseline forecast over the next {timeline.horizonYears} year(s).
                    </p>
                    <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
                        {timeline.events.map(e => (
                            <li key={`${e.yearOffset}-${e.label}`}>
                                <span className="font-semibold">{e.label}:</span> {e.narrative}
                            </li>
                        ))}
                    </ol>
                </SectionCard>
            )}
        </PageLayout>
    );
};

export default Forecast;
