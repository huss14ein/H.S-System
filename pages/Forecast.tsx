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
import CollapsibleSection from '../components/CollapsibleSection';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { buildBaselineScenarioTimeline } from '../services/scenarioTimelineEngine';
import type { Page } from '../types';
import { normalizedMonthlyExpense } from '../services/financeMetrics';
import { stressTestScenario, compareStrategies } from '../services/stressScenario';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toMonthlyRate = (annualPct: number) => {
    // Convert annual percentage to monthly rate using compound interest formula
    // Works correctly for both positive and negative rates
    // 
    // Formula: (1 + r)^(1/12) - 1 where r is the annual rate as a decimal
    // 
    // Examples:
    // - For -20% annual: (1 - 0.20)^(1/12) - 1 = 0.8^(1/12) - 1 ≈ -0.0184 (-1.84% monthly)
    //   Verification: (1 - 0.0184)^12 ≈ 0.8 (80% retention = 20% decline) ✓
    // - For +20% annual: (1 + 0.20)^(1/12) - 1 = 1.2^(1/12) - 1 ≈ 0.0153 (+1.53% monthly)
    //   Verification: (1 + 0.0153)^12 ≈ 1.2 (120% = 20% growth) ✓
    //
    // NOTE: Do NOT use Math.abs() for negative rates - it produces incorrect compounding.
    // The formula (1 + r)^(1/12) - 1 correctly handles negative r values.
    return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
};

const Forecast: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage: _setActivePage }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const [stressJobLossM, setStressJobLossM] = useState(3);
    const [stressMarketDrop, setStressMarketDrop] = useState(15);
    const [stressMedical, setStressMedical] = useState(8000);

    const savingsAnalytics = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const now = new Date();

        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthlyNet.set(d.toISOString().slice(0, 7), 0);
        }

        ((data as any)?.personalTransactions ?? data?.transactions ?? []).forEach((t: { date: string; amount?: number }) => {
            const monthKey = t.date.slice(0, 7);
            if (!monthlyNet.has(monthKey)) return;
            monthlyNet.set(monthKey, (monthlyNet.get(monthKey) || 0) + (Number(t.amount) ?? 0));
        });

        const values = Array.from(monthlyNet.values());
        if (values.length === 0 || values.every(v => v === 0)) {
            // No transaction data available - return neutral defaults with a note
            return { 
                averageMonthlySavings: 0, 
                medianMonthlySavings: 0, 
                monthlyStdDev: 0, 
                consistencyScore: 0, 
                incomeGrowthSuggestion: 3 
            };
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
    }, [data]);

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
        const d = data as any;
        const investments = d?.personalInvestments ?? data?.investments ?? [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const netWorth = computePersonalNetWorthSAR(data, fx);
        const investmentValue = getAllInvestmentsValueInSAR(investments, fx);
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
                
                // Apply income growth monthly (more accurate than yearly)
                const monthlyIncomeGrowth = toMonthlyRate(clamp(incomeGrowth, -20, 40));
                if (i > 0) {
                    currentMonthlySavings *= (1 + monthlyIncomeGrowth);
                }

                const normalizedMonthlySavings = Math.max(0, currentMonthlySavings);
                const monthlyGrowthRate = toMonthlyRate(clamp(investmentGrowth, -40, 40));

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
                const finalEntry = results[results.length - 1];
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
        }, 0);
    }, [horizon, monthlySavings, investmentGrowth, incomeGrowth, initialValues, data?.goals, scenarioPreset, savingsAnalytics.monthlyStdDev, savingsAnalytics.averageMonthlySavings]);

    const goalReferenceLines = useMemo(() => {
        return (data?.goals ?? []).map((goal, idx) => {
            const yValue = initialValues.netWorth - (goal.currentAmount ?? 0) + (goal.targetAmount ?? 0);
            return {
                y: yValue,
                label: goal.name ?? '—',
                key: goal.id ?? `goal-ref-${idx}-${goal.name ?? ''}`,
            };
        });
    }, [data?.goals, initialValues.netWorth]);

    const stressInputs = useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const liquidCash = accounts
            .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
            .reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
        const monthlyExpense = normalizedMonthlyExpense(txs as { date: string; type?: string; category?: string; amount?: number }[], { monthsLookback: 6 });
        return { liquidCash, monthlyExpense };
    }, [data]);

    const stressResult = useMemo(
        () =>
            stressTestScenario({
                jobLossMonths: stressJobLossM,
                marketDropPct: stressMarketDrop,
                medicalCost: stressMedical,
                monthlyExpense: Math.max(500, stressInputs.monthlyExpense),
                liquidCash: stressInputs.liquidCash,
                goalMonthlyNeed: Math.max(200, monthlySavings * 0.3),
            }),
        [stressJobLossM, stressMarketDrop, stressMedical, stressInputs, monthlySavings]
    );
    const strategyCompare = useMemo(() => compareStrategies(), []);
    const lumpDca = useMemo(() => {
        const lump = Math.max(10000, monthlySavings * 12);
        return {
            lumpNote: `Full ${formatCurrencyString(lump, { digits: 0 })} now: full market exposure immediately.`,
            dcaNote: `Spread over 12 mo: ~${formatCurrencyString(lump / 12, { digits: 0 })}/mo; reduces timing risk.`,
        };
    }, [monthlySavings, formatCurrencyString]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading forecast" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Financial Forecast"
            description="Deterministic long-horizon view from today’s balances, savings rate, and return assumptions—use alongside Goals and your real plan."
        >
            <div className="space-y-6 lg:space-y-8">
            <CollapsibleSection title="Forecast methodology" summary="How projections are calculated" className="border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-slate-50/50 shadow-sm">
                <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5 leading-relaxed">
                    <li>
                        <strong className="text-slate-900">Investment path:</strong> each month adds your savings contribution to the investment balance, then applies compound return using your annual investment growth % as a monthly rate.
                    </li>
                    <li>
                        <strong className="text-slate-900">Savings growth:</strong> the monthly contribution grows each month using your “Annual Savings Increase %” as a smooth monthly rate (not a single step once per year).
                    </li>
                    <li>
                        <strong className="text-slate-900">Net worth:</strong> starts from your current snapshot (personal scope); incremental changes follow the same savings + return path as the investment line. Other assets and liabilities are not re-projected month-by-month—they stay implied in the opening snapshot only.
                    </li>
                    <li>
                        <strong className="text-slate-900">Goals &amp; band:</strong> goal lines are a rough threshold check; the confidence band is a heuristic from savings volatility and horizon, not a statistical forecast.
                    </li>
                </ul>
                <p className="text-xs text-slate-500 mt-4 border-t border-slate-200/80 pt-3">
                    Educational only—not financial advice. Run Conservative / Base / Aggressive to compare sensitivity to assumptions.
                </p>
            </CollapsibleSection>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-4 items-start gap-6 lg:gap-8">
                <SectionCard
                    title="Forecast Assumptions"
                    className="lg:col-span-1 sticky top-24 space-y-4"
                    collapsible
                    collapsibleSummary="Presets, horizon, run"
                    defaultExpanded
                >
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
                        <span className="inline-flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setMonthlySavings(savingsAnalytics.medianMonthlySavings);
                                    handleManualIncomeGrowthChange(Number(savingsAnalytics.incomeGrowthSuggestion.toFixed(1)));
                                }}
                                className="px-2.5 py-1 text-xs rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                title="Sets monthly savings to your 12-month median and savings growth to a suggested rate from history"
                            >
                                Auto-fill from history
                            </button>
                            <InfoHint text="Uses your last 12 months of transaction-derived savings: median monthly savings and a suggested annual savings growth rate. You can still edit fields after." />
                        </span>
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
                        <label htmlFor="income-growth" className="block text-sm font-medium text-gray-700 flex items-center">Annual Savings Increase (%) <InfoHint text="Annual rate applied smoothly each month (compound), not one jump per calendar year—see Forecast methodology." /></label>
                        <input type="number" id="income-growth" value={incomeGrowth} onChange={e => handleManualIncomeGrowthChange(Number(e.target.value))} className="input-base mt-1" />
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={handleRunForecast} disabled={isLoading} className="flex-1 btn-primary flex items-center justify-center gap-2 font-semibold disabled:opacity-50">
                            <SparklesIcon className="h-5 w-5" aria-hidden />
                            {isLoading ? 'Calculating...' : 'Run Forecast'}
                        </button>
                        <InfoHint text="Recalculates projections from current assumptions, personal-scope net worth baseline, and savings analytics. Results are educational—not a guarantee." />
                    </div>
                </SectionCard>

                <div className="lg:col-span-3 space-y-6">
                    {isLoading && (
                        <div className="rounded-xl border border-slate-200 bg-white p-12 shadow-sm">
                            <LoadingSpinner message="Running projection…" />
                        </div>
                    )}

                    {summary && !isLoading && (
                        <>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Last run</p>
                            <p className="text-sm text-slate-600 mb-4">
                                Preset: <span className="font-semibold text-slate-900">{scenarioPreset}</span>
                                <span className="text-slate-400 mx-2">·</span>
                                Horizon: <span className="font-semibold text-slate-900">{horizon} years</span>
                            </p>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Card title={`Net worth (year ${horizon})`} value={summary.projectedNetWorth ? formatCurrencyString(summary.projectedNetWorth, { digits: 0 }) : 'N/A'} tooltip="Projected total net worth at horizon from this model (see methodology for limits)." />
                                <Card title={`Investments (year ${horizon})`} value={summary.projectedInvestments ? formatCurrencyString(summary.projectedInvestments, { digits: 0 }) : 'N/A'} tooltip="Projected investment balance after monthly contributions and compound return." />
                            </div>
                        </div>
                        {confidenceBand && (
                            <SectionCard title="Uncertainty band (heuristic)" collapsible collapsibleSummary="Low / base / high" defaultExpanded>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"><p className="text-xs text-slate-500 uppercase tracking-wide">Low</p><p className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(confidenceBand.low, { digits: 0 })}</p></div>
                                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3"><p className="text-xs text-primary/80 uppercase tracking-wide">Base</p><p className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}</p></div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"><p className="text-xs text-slate-500 uppercase tracking-wide">High</p><p className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(confidenceBand.high, { digits: 0 })}</p></div>
                                </div>
                                <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                                    Spread scales with your 12‑month savings volatility and horizon—it illustrates sensitivity, not a statistical confidence interval.
                                </p>
                            </SectionCard>
                        )}
                        </>
                    )}

                    {forecastData.length > 0 && !isLoading ? (
                        <SectionCard title="Projection chart" className="flex flex-col" collapsible collapsibleSummary="Net worth & investments" defaultExpanded>
                            <div className="h-[420px] sm:h-[520px] w-full rounded-xl overflow-hidden border border-slate-100 bg-slate-50/30">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={forecastData} margin={{ ...CHART_MARGIN, right: 24, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} tickLine={false} interval="preserveStartEnd" />
                                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={11} tickLine={false} width={56} />
                                        <Tooltip
                                            formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })}
                                            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                                        />
                                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                        <defs>
                                            <linearGradient id="fcInvestFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.35}/><stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.08}/></linearGradient>
                                        </defs>
                                        {goalReferenceLines.map((line) => (
                                             <ReferenceLine key={line.key} y={line.y} stroke={CHART_COLORS.negative} strokeDasharray="4 4" label={{ value: line.label, position: 'right', fill: CHART_COLORS.axis, fontSize: 10 }} />
                                        ))}
                                        <Area type="monotone" dataKey="Investment Value" stroke={CHART_COLORS.secondary} fill="url(#fcInvestFill)" name="Investments" />
                                        <Line type="monotone" dataKey="Net Worth" stroke={CHART_COLORS.primary} strokeWidth={2.5} name="Net worth" dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </SectionCard>
                    ) : (
                         !isLoading && !summary && (
                            <SectionCard title="Results" className="border-dashed border-slate-300 bg-slate-50/50" collapsible collapsibleSummary="Run forecast first">
                                <p className="text-sm text-slate-600 text-center py-6">Set assumptions on the left, then run the forecast to see projections, the chart, and scenario comparison.</p>
                            </SectionCard>
                         )
                    )}

                    {Object.values(comparisonResults).some(Boolean) && !isLoading && (
                        <SectionCard title={`Scenario comparison (${horizon}‑year)`} collapsible collapsibleSummary="Conservative / Base / Aggressive" defaultExpanded>
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left bg-slate-100 text-slate-700 border-b border-slate-200">
                                            <th className="py-3 px-4 font-semibold">Preset</th>
                                            <th className="py-3 px-4 font-semibold">Net worth</th>
                                            <th className="py-3 px-4 font-semibold">Investments</th>
                                            <th className="py-3 px-4 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => {
                                            const row = comparisonResults[preset];
                                            const isActive = preset === scenarioPreset;
                                            return (
                                                <tr key={preset} className={isActive ? 'bg-primary/5' : ''}>
                                                    <td className="py-3 px-4 font-medium text-slate-900">{preset}</td>
                                                    <td className="py-3 px-4 tabular-nums text-slate-800">{row ? formatCurrencyString(row.projectedNetWorth, { digits: 0 }) : '—'}</td>
                                                    <td className="py-3 px-4 tabular-nums text-slate-800">{row ? formatCurrencyString(row.projectedInvestments, { digits: 0 }) : '—'}</td>
                                                    <td className="py-3 px-4 text-slate-600">{row ? (isActive ? 'Current run' : 'Saved') : 'Run pending'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-slate-500 mt-3">Run each preset (Conservative, Base, Aggressive) once to fill the table and compare side‑by‑side.</p>
                        </SectionCard>
                    )}

                    {goalProjections.length > 0 && !isLoading && (
                        <SectionCard title="Goal outlook" collapsible collapsibleSummary="Goal thresholds" defaultExpanded>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-3">
                                {goalProjections.map(proj => (
                                    <div key={proj.name} className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/80">
                                        <FlagIcon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${proj.met ? 'text-emerald-600' : 'text-slate-400'}`} />
                                        <div>
                                            <p className="font-semibold text-slate-900">{proj.name}</p>
                                            {proj.met ? (
                                                <p className="text-sm text-emerald-800 mt-1">Crosses simple threshold in <span className="font-semibold">{proj.years}y {proj.months}mo</span> (illustrative).</p>
                                            ) : (
                                                <p className="text-sm text-slate-600 mt-1">Not reached within {horizon} years at this run’s assumptions.</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </SectionCard>
                    )}

                    {summary && !isLoading && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-600 leading-relaxed">
                            <strong className="text-slate-800">Inputs quality:</strong> savings consistency {savingsAnalytics.consistencyScore.toFixed(0)} / 100 · 12‑month savings volatility {formatCurrencyString(savingsAnalytics.monthlyStdDev, { digits: 0 })}.
                        </div>
                    )}
                </div>
            </div>

            <CollapsibleSection title="Stress test (illustrative)" summary="Job loss, market drop, one-off cost scenarios">
                <p className="text-xs text-slate-600 mb-4">
                    Rough cash runway after job loss, a market hit on part of liquid wealth, and a one-off cost. Not advice—use with your real numbers.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="text-xs font-medium text-slate-600 flex items-center gap-0.5 flex-wrap">
                            Job loss (months, no income)
                            <InfoHint text="Simulates zero income for N months while spending continues at the estimated monthly expense. See headline for implied runway." />
                        </label>
                        <input type="range" min={0} max={12} value={stressJobLossM} onChange={(e) => setStressJobLossM(Number(e.target.value))} className="w-full" />
                        <p className="text-sm font-semibold">{stressJobLossM} mo</p>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 flex items-center gap-0.5 flex-wrap">
                            Market drop (% on ~30% of cash)
                            <InfoHint text="Illustrative shock: a slice of liquid cash is treated as at risk of a drawdown. Not a full portfolio model—just a simple stress on part of liquidity." />
                        </label>
                        <input type="range" min={0} max={40} value={stressMarketDrop} onChange={(e) => setStressMarketDrop(Number(e.target.value))} className="w-full" />
                        <p className="text-sm font-semibold">{stressMarketDrop}%</p>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 flex items-center gap-0.5 flex-wrap">
                            One-off cost (SAR)
                            <InfoHint text="Adds a single large expense (e.g. medical or repair) on top of ongoing spending to test liquidity after shocks." />
                        </label>
                        <input type="number" min={0} step={500} value={stressMedical} onChange={(e) => setStressMedical(Number(e.target.value))} className="input-base mt-1" />
                    </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm space-y-2">
                    <p className="font-semibold text-amber-900">{stressResult.headline}</p>
                    <p className="text-slate-700">
                        Liquid cash (Checking+Savings): <strong>{formatCurrencyString(stressInputs.liquidCash, { digits: 0 })}</strong> · Avg monthly spend (ext.):{' '}
                        <strong>{formatCurrencyString(stressInputs.monthlyExpense, { digits: 0 })}</strong>
                    </p>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
                    <div className="rounded-lg border border-slate-200 p-3">
                        <p className="font-semibold text-slate-800 mb-1 flex items-center gap-0.5">
                            Strategy lens
                            <InfoHint text="Generic comparison of aggressive vs balanced investing styles from the engine—context for learning, not a recommendation for your portfolio." />
                        </p>
                        <p>{strategyCompare.aggressive}</p>
                        <p className="mt-1">{strategyCompare.balanced}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                        <p className="font-semibold text-slate-800 mb-1 flex items-center gap-0.5">
                            Lump sum vs DCA
                            <InfoHint text="Illustrative note on deploying a lump of savings at once vs over time, using a scale tied to your monthly savings. Educational only." />
                        </p>
                        <p>{lumpDca.lumpNote}</p>
                        <p className="mt-1">{lumpDca.dcaNote}</p>
                    </div>
                </div>
            </CollapsibleSection>

            {timeline && (
                <SectionCard title="Scenario timeline" collapsible collapsibleSummary="Narrative years" defaultExpanded>
                    <p className="text-xs text-slate-600 mb-3">
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
            </div>
        </PageLayout>
    );
};

export default Forecast;
