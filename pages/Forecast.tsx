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
import { DemoDataButton } from '../components/DemoDataButton';
import { buildBaselineScenarioTimeline } from '../services/scenarioTimelineEngine';


const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toMonthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

const Forecast: React.FC = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();

    const savingsAnalytics = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const now = new Date();

        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthlyNet.set(d.toISOString().slice(0, 7), 0);
        }

        (data?.transactions ?? []).forEach(t => {
            const monthKey = t.date.slice(0, 7);
            if (!monthlyNet.has(monthKey)) return;
            monthlyNet.set(monthKey, (monthlyNet.get(monthKey) || 0) + (Number(t.amount) ?? 0));
        });

        const values = Array.from(monthlyNet.values());
        if (values.length === 0) {
            return { averageMonthlySavings: 7500, medianMonthlySavings: 7500, monthlyStdDev: 0, consistencyScore: 0, incomeGrowthSuggestion: 3 };
        }

        const averageMonthlySavings = values.reduce((sum, v) => sum + v, 0) / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const medianMonthlySavings = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

        const variance = values.reduce((sum, v) => sum + Math.pow(v - averageMonthlySavings, 2), 0) / values.length;
        const monthlyStdDev = Math.sqrt(Math.max(0, variance));
        const consistencyScore = averageMonthlySavings !== 0
            ? clamp(100 - (Math.abs(monthlyStdDev / averageMonthlySavings) * 100), 0, 100)
            : 0;

        const firstHalfAvg = values.slice(0, 6).reduce((sum, v) => sum + v, 0) / 6;
        const secondHalfAvg = values.slice(6).reduce((sum, v) => sum + v, 0) / 6;
        const growthRatio = firstHalfAvg > 0 ? (secondHalfAvg - firstHalfAvg) / firstHalfAvg : 0;
        const incomeGrowthSuggestion = clamp(growthRatio * 100, -2, 12);

        return {
            averageMonthlySavings: Math.max(0, averageMonthlySavings),
            medianMonthlySavings: Math.max(0, medianMonthlySavings),
            monthlyStdDev,
            consistencyScore,
            incomeGrowthSuggestion,
        };
    }, [data?.transactions]);

    const [horizon, setHorizon] = useState(10);
    const [monthlySavings, setMonthlySavings] = useState(savingsAnalytics.medianMonthlySavings);
    const [investmentGrowth, setInvestmentGrowth] = useState(7);
    const [incomeGrowth, setIncomeGrowth] = useState(3);
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
        setMonthlySavings(savingsAnalytics.medianMonthlySavings);
    }, [savingsAnalytics.medianMonthlySavings]);

    const initialValues = useMemo(() => {
        const assets = data?.assets ?? [];
        const accounts = data?.accounts ?? [];
        const liabilities = data?.liabilities ?? [];
        const investments = data?.investments ?? [];
        const totalAssets = assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0) + accounts.reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
        const totalLiabilities = liabilities.reduce((sum, liab) => sum + (liab.amount ?? 0), 0);
        const netWorth = totalAssets + totalLiabilities;
        const investmentValue = getAllInvestmentsValueInSAR(investments, exchangeRate);
        return { netWorth, investmentValue };
    }, [data, exchangeRate]);


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
            
            const goalsWithProjections = (data?.goals ?? []).map(g => ({ ...g, metMonth: null as number | null }));

            const results = [];
            const currentDate = new Date();

            for (let i = 0; i < horizon * 12; i++) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                
                if (monthDate.getMonth() === 0 && i > 0) {
                    currentMonthlySavings *= (1 + clamp(incomeGrowth, -20, 40) / 100);
                }

                const normalizedMonthlySavings = Math.max(0, currentMonthlySavings);
                const monthlyGrowthRate = toMonthlyRate(clamp(investmentGrowth, -40, 40) );

                currentInvestmentValue += normalizedMonthlySavings;
                const investmentGain = currentInvestmentValue * monthlyGrowthRate;
                currentInvestmentValue += investmentGain;
                currentNetWorth += normalizedMonthlySavings + investmentGain;

                goalsWithProjections.forEach(goal => {
                    if (goal.metMonth === null) {
                        const netWorthNeededForGoal = initialValues.netWorth - (goal.currentAmount ?? 0) + (goal.targetAmount ?? 0);
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

                const volatilityFactor = clamp(savingsAnalytics.monthlyStdDev / Math.max(1, savingsAnalytics.averageMonthlySavings), 0, 1.5);
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
                    name: g.name ?? '—',
                    met: met,
                    years: met ? Math.floor(g.metMonth! / 12) : 0,
                    months: met ? g.metMonth! % 12 : 0,
                }
            }));

            setIsLoading(false);
        }, 500);
    }, [horizon, monthlySavings, investmentGrowth, incomeGrowth, initialValues, data?.goals, scenarioPreset, savingsAnalytics.monthlyStdDev, savingsAnalytics.averageMonthlySavings]);

    const goalReferenceLines = useMemo(() => {
        return (data?.goals ?? []).map(goal => {
            const yValue = initialValues.netWorth - (goal.currentAmount ?? 0) + (goal.targetAmount ?? 0);
            return {
                y: yValue,
                label: goal.name ?? '—'
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
            action={<DemoDataButton page="Forecast" />}
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
                        <input type="number" id="monthly-savings" value={monthlySavings} onChange={e => setMonthlySavings(Number(e.target.value))} className="input-base mt-1" />
                        <p className="text-xs text-gray-500 mt-1">Calculated 12M median is {formatCurrencyString(savingsAnalytics.medianMonthlySavings)}; average is {formatCurrencyString(savingsAnalytics.averageMonthlySavings)}.</p>
                    </div>
                    <div>
                        <label htmlFor="investment-growth" className="block text-sm font-medium text-gray-700 flex items-center">Annual Investment Growth (%) <InfoHint text="Expected yearly return on investments; affects projected net worth." /></label>
                        <input type="number" id="investment-growth" value={investmentGrowth} onChange={e => handleManualInvestmentGrowthChange(Number(e.target.value))} className="input-base mt-1" />
                    </div>
                    <div>
                        <label htmlFor="income-growth" className="block text-sm font-medium text-gray-700 flex items-center">Annual Savings Increase (%) <InfoHint text="Assume your monthly savings grow by this percent each year (e.g. raises)." /></label>
                        <input type="number" id="income-growth" value={incomeGrowth} onChange={e => handleManualIncomeGrowthChange(Number(e.target.value))} className="input-base mt-1" />
                    </div>
                    <button type="button" onClick={handleRunForecast} disabled={isLoading} className="w-full btn-primary flex items-center justify-center gap-2 font-semibold disabled:opacity-50">
                        <SparklesIcon className="h-5 w-5" />
                        {isLoading ? 'Calculating...' : 'Run Forecast'}
                    </button>
                </SectionCard>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && <div className="text-center p-10 bg-white rounded-lg shadow"><LoadingSpinner message="Generating your financial forecast..." /></div>}

                    {summary && !isLoading && (
                        <>
                        <p className="text-sm text-gray-600">Scenario preset used: <span className="font-semibold text-dark">{scenarioPreset}</span></p>
                        <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
                            <Card title={`Projected Net Worth in ${horizon} Years`} value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} tooltip="Estimated total net worth at the end of the forecast period." />
                            <Card title={`Projected Investments in ${horizon} Years`} value={summary.projectedInvestments ? formatCurrencyString(summary.projectedInvestments, { digits: 0 }) : 'N/A'} tooltip="Estimated investment portfolio value at the end of the forecast period." />
                        </div>
                        {confidenceBand && (
                            <SectionCard title="Forecast confidence band" className="mt-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                    <div className="rounded-lg border bg-slate-50 p-3"><p className="text-slate-500">Low case</p><p className="font-semibold text-slate-800">{formatCurrencyString(confidenceBand.low, { digits: 0 })}</p></div>
                                    <div className="rounded-lg border bg-slate-50 p-3"><p className="text-slate-500">Base case</p><p className="font-semibold text-slate-800">{formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}</p></div>
                                    <div className="rounded-lg border bg-slate-50 p-3"><p className="text-slate-500">High case</p><p className="font-semibold text-slate-800">{formatCurrencyString(confidenceBand.high, { digits: 0 })}</p></div>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">Band is automatically scaled by savings volatility and horizon to highlight uncertainty.</p>
                            </SectionCard>
                        )}
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                            <p><strong>Data quality:</strong> Savings consistency score {savingsAnalytics.consistencyScore.toFixed(0)} / 100 · 12M savings volatility {formatCurrencyString(savingsAnalytics.monthlyStdDev, { digits: 0 })}.</p>
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
                        </SectionCard>
                    )}
                    
                    {goalProjections.length > 0 && !isLoading && (
                        <div className="bg-white p-6 rounded-lg shadow">
                            <h3 className="text-lg font-semibold text-dark mb-4">Goal Projections</h3>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
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
                        <div className="section-card flex flex-col h-[500px] sm:h-[600px]">
                            <h3 className="section-title mb-4">Financial Projections</h3>
                            <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={forecastData} margin={{ ...CHART_MARGIN, right: 24, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} width={56} />
                                        <Tooltip
                                            formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })}
                                            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                                        />
                                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                        <defs>
                                            <linearGradient id="colorInvest" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.4}/><stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.1}/></linearGradient>
                                        </defs>
                                        {goalReferenceLines.map(line => (
                                             <ReferenceLine key={line.label} y={line.y} stroke={CHART_COLORS.negative} strokeDasharray="4 4" label={{ value: line.label, position: 'right', fill: CHART_COLORS.axis, fontSize: 11 }} />
                                        ))}
                                        <Area type="monotone" dataKey="Investment Value" stackId="1" stroke={CHART_COLORS.secondary} fill="url(#colorInvest)" name="Total Investments" />
                                        <Line type="monotone" dataKey="Net Worth" stroke={CHART_COLORS.primary} strokeWidth={3} name="Net Worth" dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ) : (
                         !isLoading && <div className="section-card text-center py-12"><p className="text-slate-500 text-sm">Configure assumptions, run a base case, then adjust growth/savings to compare conservative vs aggressive scenarios.</p></div>
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
