import React, { useState, useMemo, useCallback, useContext, useEffect } from 'react';
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
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { buildBaselineScenarioTimeline } from '../services/scenarioTimelineEngine';
import type { Page, Transaction } from '../types';
import { normalizedMonthlyExpenseSar, personalMonthlyNetByMonthKeySar, savingsRateSar } from '../services/financeMetrics';
import { stressTestScenario, compareStrategies } from '../services/stressScenario';
import AIAdvisor from '../components/AIAdvisor';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import { computeGoalResolvedAmountsSar } from '../services/goalResolvedTotals';
import PageActionsDropdown from '../components/PageActionsDropdown';
import { projectForecastSeries, downsampleForecastRows, type ForecastMonthRow } from '../services/forecastProjection';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

const Forecast: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate, currency: displayCurrency } = useCurrency();
    const [stressJobLossM, setStressJobLossM] = useState(3);
    const [stressMarketDrop, setStressMarketDrop] = useState(15);
    const [stressMedical, setStressMedical] = useState(8000);

    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

    const savingsAnalytics = useMemo(() => {
        if (!data) {
            return {
                averageMonthlyNet: 0,
                medianMonthlyNet: 0,
                monthlyStdDev: 0,
                consistencyScore: 0,
                incomeGrowthSuggestion: 3,
            };
        }
        hydrateSarPerUsdDailySeries(data, exchangeRate);
        const { values } = personalMonthlyNetByMonthKeySar(data, exchangeRate, 12);
        if (values.length === 0 || values.every((v) => v === 0)) {
            return {
                averageMonthlyNet: 0,
                medianMonthlyNet: 0,
                monthlyStdDev: 0,
                consistencyScore: 0,
                incomeGrowthSuggestion: 3,
            };
        }
        const averageMonthlyNet = values.reduce((sum, v) => sum + v, 0) / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const medianMonthlyNet =
            sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - averageMonthlyNet, 2), 0) / values.length;
        const monthlyStdDev = Math.sqrt(Math.max(0, variance));
        const volDenom = Math.max(1, Math.abs(averageMonthlyNet));
        const consistencyScore = clamp(100 - (monthlyStdDev / volDenom) * 100, 0, 100);
        const firstHalfAvg = values.slice(0, 6).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(6, values.length));
        const secondHalfAvg = values.slice(6).reduce((s, v) => s + v, 0) / Math.max(1, values.length - 6);
        const growthRatio =
            Math.abs(firstHalfAvg) > 1e-6 ? (secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg) : secondHalfAvg - firstHalfAvg > 0 ? 0.05 : 0;
        const incomeGrowthSuggestion = clamp(growthRatio * 100, -2, 12);
        return {
            averageMonthlyNet,
            medianMonthlyNet,
            monthlyStdDev,
            consistencyScore,
            incomeGrowthSuggestion,
        };
    }, [data, exchangeRate]);

    const [horizon, setHorizon] = useState(10);
    const [monthlySavingsTouched, setMonthlySavingsTouched] = useState(false);
    const [monthlySavings, setMonthlySavings] = useState(0);
    const [investmentGrowth, setInvestmentGrowth] = useState(7);
    const [incomeGrowth, setIncomeGrowth] = useState(3);
    const [scenarioPreset, setScenarioPreset] = useState<'Conservative' | 'Base' | 'Aggressive' | 'Custom'>('Base');

    useEffect(() => {
        if (monthlySavingsTouched) return;
        setMonthlySavings(Math.max(0, savingsAnalytics.medianMonthlyNet));
    }, [savingsAnalytics.medianMonthlyNet, monthlySavingsTouched]);

    const initialValues = useMemo(() => {
        const d = data as any;
        const investments = d?.personalInvestments ?? data?.investments ?? [];
        const accounts = d?.personalAccounts ?? data?.accounts ?? [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const netWorth = computePersonalNetWorthSAR(data, fx, { getAvailableCashForAccount });
        const holdingsSar = getAllInvestmentsValueInSAR(investments, fx);
        const brokerageCashSar = accounts
            .filter((a: { type?: string }) => a.type === 'Investment')
            .reduce((s: number, a: { id: string }) => s + tradableCashBucketToSAR(getAvailableCashForAccount(a.id), fx), 0);
        const investmentValue = holdingsSar + brokerageCashSar;
        return { netWorth, investmentValue };
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const goalResolvedSarById = useMemo(
        () => computeGoalResolvedAmountsSar(data ?? null, resolveSarPerUsd(data, exchangeRate)),
        [data, exchangeRate],
    );

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

    const liveProjection = useMemo(() => {
        if (!data) return null;
        return projectForecastSeries({
            initialNetWorth: initialValues.netWorth,
            initialInvestmentValue: initialValues.investmentValue,
            monthlySavings: Math.max(0, monthlySavings),
            horizonYears: horizon,
            investmentGrowthAnnualPct: investmentGrowth,
            savingsGrowthAnnualPct: incomeGrowth,
        });
    }, [data, initialValues.netWorth, initialValues.investmentValue, monthlySavings, horizon, investmentGrowth, incomeGrowth]);

    const forecastData = liveProjection?.rows ?? [];
    const summary = liveProjection
        ? { projectedNetWorth: liveProjection.finalNetWorth, projectedInvestments: liveProjection.finalInvestmentValue }
        : null;

    const scenarioComparison = useMemo(() => {
        if (!data) return { Conservative: null, Base: null, Aggressive: null } as Record<'Conservative' | 'Base' | 'Aggressive', { projectedNetWorth: number; projectedInvestments: number } | null>;
        const baseArgs = {
            initialNetWorth: initialValues.netWorth,
            initialInvestmentValue: initialValues.investmentValue,
            monthlySavings: Math.max(0, monthlySavings),
            horizonYears: horizon,
        };
        const presets = {
            Conservative: { investmentGrowthAnnualPct: 4, savingsGrowthAnnualPct: 1 },
            Base: { investmentGrowthAnnualPct: 7, savingsGrowthAnnualPct: 3 },
            Aggressive: { investmentGrowthAnnualPct: 10, savingsGrowthAnnualPct: 5 },
        } as const;
        const out = {} as Record<'Conservative' | 'Base' | 'Aggressive', { projectedNetWorth: number; projectedInvestments: number }>;
        (Object.keys(presets) as Array<keyof typeof presets>).forEach((k) => {
            const p = presets[k];
            const r = projectForecastSeries({ ...baseArgs, ...p });
            out[k] = { projectedNetWorth: r.finalNetWorth, projectedInvestments: r.finalInvestmentValue };
        });
        return out;
    }, [data, initialValues.netWorth, initialValues.investmentValue, monthlySavings, horizon]);

    const confidenceBand = useMemo(() => {
        if (!summary) return null;
        const volBase = Math.max(1, Math.abs(savingsAnalytics.averageMonthlyNet));
        const volatilityFactor = clamp(savingsAnalytics.monthlyStdDev / volBase, 0, 1.5);
        const horizonRisk = Math.sqrt(Math.max(1, horizon));
        const spread = summary.projectedNetWorth * (0.05 + volatilityFactor * 0.08) * (horizonRisk / 4);
        return {
            low: Math.max(0, Math.round(summary.projectedNetWorth - spread)),
            high: Math.max(0, Math.round(summary.projectedNetWorth + spread)),
        };
    }, [summary, savingsAnalytics.averageMonthlyNet, savingsAnalytics.monthlyStdDev, horizon]);

    const chartDisplayData = useMemo(() => downsampleForecastRows(forecastData as ForecastMonthRow[], 80), [forecastData]);

    const chartYDomain = useMemo((): [number, number] | undefined => {
        if (!chartDisplayData.length) return undefined;
        const all: number[] = [];
        chartDisplayData.forEach((r) => {
            all.push(r['Net Worth'], r['Investment Value']);
        });
        const mn = Math.min(...all);
        const mx = Math.max(...all);
        const pad = Math.max((mx - mn) * 0.06, mx * 0.02, 1);
        return [Math.floor(mn - pad), Math.ceil(mx + pad)];
    }, [chartDisplayData]);

    const goalProjections = useMemo(() => {
        if (!data?.goals?.length || !forecastData.length) return [];
        return (data.goals ?? []).map((goal) => {
            const target = Math.max(0, Number(goal.targetAmount) || 0);
            const current = Math.max(0, goalResolvedSarById.get(goal.id) ?? (Number(goal.currentAmount) || 0));
            const gap = Math.max(0, target - current);
            const threshold = initialValues.netWorth + gap;
            let metMonth: number | null = null;
            for (let i = 0; i < forecastData.length; i++) {
                if (forecastData[i]!['Net Worth'] >= threshold) {
                    metMonth = i + 1;
                    break;
                }
            }
            const met = metMonth !== null;
            return {
                name: goal.name ?? '—',
                met,
                years: met ? Math.floor(metMonth! / 12) : 0,
                months: met ? metMonth! % 12 : 0,
            };
        });
    }, [data?.goals, forecastData, goalResolvedSarById, initialValues.netWorth]);

    const goalReferenceLines = useMemo(() => {
        return (data?.goals ?? []).map((goal, idx) => {
            const target = Math.max(0, Number(goal.targetAmount) || 0);
            const current = Math.max(0, goalResolvedSarById.get(goal.id) ?? (Number(goal.currentAmount) || 0));
            const gap = Math.max(0, target - current);
            const yValue = initialValues.netWorth + gap;
            return {
                y: yValue,
                label: goal.name ?? '—',
                key: goal.id ?? `goal-ref-${idx}-${goal.name ?? ''}`,
            };
        });
    }, [data?.goals, initialValues.netWorth, goalResolvedSarById]);

    const stressInputs = useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const liquidCash = accounts
            .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
            .reduce(
                (s: number, a: { balance?: number; currency?: string }) =>
                    s + Math.max(0, toSAR(a.balance ?? 0, (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD', fx)),
                0,
            );
        const monthlyExpense = normalizedMonthlyExpenseSar(txs as Transaction[], accounts, fx, { monthsLookback: 6 });
        return { liquidCash, monthlyExpense };
    }, [data, exchangeRate]);

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
        [stressJobLossM, stressMarketDrop, stressMedical, stressInputs, monthlySavings],
    );

    const strategyCompare = useMemo(() => compareStrategies(), []);
    const lumpDca = useMemo(() => {
        const lump = Math.max(10000, monthlySavings * 12);
        return {
            lumpNote: `Full ${formatCurrencyString(lump, { digits: 0 })} now: full market exposure immediately.`,
            dcaNote: `Spread over 12 mo: ~${formatCurrencyString(lump / 12, { digits: 0 })}/mo; reduces timing risk.`,
        };
    }, [monthlySavings, formatCurrencyString]);

    const currentSavingsRate = useMemo(() => {
        if (!data) return 0;
        const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const accounts = ((data as any)?.personalAccounts ?? data?.accounts ?? []) as import('../types').Account[];
        return savingsRateSar(txs, accounts, new Date(), sarPerUsd);
    }, [data, sarPerUsd]);

    const timeline = useMemo(() => {
        if (!summary) return null;
        return buildBaselineScenarioTimeline(data, horizon, summary.projectedNetWorth);
    }, [data, horizon, summary]);

    const forecastValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const kpis = computeMonthlyReportFinancialKpis(data, fx, getAvailableCashForAccount);
        if (!Number.isFinite(fx) || fx <= 0) warnings.push('Exchange rate is invalid — USD-linked balances may mis-state projections.');
        if (!Number.isFinite(initialValues.netWorth)) warnings.push('Net worth baseline is invalid.');
        if (!Number.isFinite(initialValues.investmentValue) || initialValues.investmentValue < 0) warnings.push('Investment baseline is invalid.');
        if (!Number.isFinite(kpis.roi)) warnings.push('Reference ROI could not be computed.');
        if (monthlySavings < 0) warnings.push('Monthly savings is negative; the model uses zero instead.');
        if (!Number.isFinite(stressInputs.monthlyExpense) || stressInputs.monthlyExpense <= 0) {
            warnings.push('Monthly expense estimate is thin — stress test is less meaningful.');
        }
        if (liveProjection && Math.abs(liveProjection.nonInvestmentOpening + liveProjection.finalInvestmentValue - liveProjection.finalNetWorth) > 2) {
            warnings.push('Internal projection reconciliation failed — please report this.');
        }
        const hasUsd = ((data as any)?.personalAccounts ?? data?.accounts ?? []).some((a: { currency?: string }) => a.currency === 'USD');
        if (hasUsd && (!Number.isFinite(fx) || fx <= 0)) warnings.push('USD accounts detected — set SAR per USD in the header or Wealth Ultra.');
        return warnings;
    }, [data, exchangeRate, getAvailableCashForAccount, initialValues, monthlySavings, stressInputs.monthlyExpense, liveProjection]);

    const deltaProjected = summary ? summary.projectedNetWorth - initialValues.netWorth : 0;

    const resetFromHistory = useCallback(() => {
        setMonthlySavingsTouched(false);
        setMonthlySavings(Math.max(0, savingsAnalytics.medianMonthlyNet));
        handleManualIncomeGrowthChange(Number(savingsAnalytics.incomeGrowthSuggestion.toFixed(1)));
    }, [savingsAnalytics.medianMonthlyNet, savingsAnalytics.incomeGrowthSuggestion]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading forecast" />
            </div>
        );
    }

    const aiForecastTrendSample = chartDisplayData.map((r) => ({
        name: r.name,
        income: r['Net Worth'],
        expenses: r['Investment Value'],
    }));

    return (
        <PageLayout
            title="Financial Forecast"
            description="See how today’s wealth might grow if you keep saving and earning a steady return — updated live as you move the sliders. Same SAR math as Dashboard and Summary."
            action={
                setActivePage ? (
                    <PageActionsDropdown
                        ariaLabel="Forecast quick links"
                        actions={[
                            { value: 'summary', label: 'Financial Summary', onClick: () => setActivePage('Summary') },
                            { value: 'goals', label: 'Goals', onClick: () => setActivePage('Goals') },
                            { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                            { value: 'transactions', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                            { value: 'analysis', label: 'Financial Analysis', onClick: () => setActivePage('Analysis') },
                            { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
                        ]}
                    />
                ) : undefined
            }
        >
            <div className="space-y-6 lg:space-y-8">
                <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/90 to-white px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-700 shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-violet-900">SAR projections</span>
                        <span>
                            All forecast numbers use <strong>SAR</strong> so they match your net worth and investments elsewhere.
                            {displayCurrency === 'USD' && (
                                <span className="text-slate-600"> Display currency is USD — figures convert for viewing only.</span>
                            )}
                        </span>
                    </div>
                    <div className="text-xs sm:text-sm tabular-nums text-slate-600 text-right">
                        <span className="font-semibold text-slate-800">1 USD = {sarPerUsd.toFixed(2)} SAR</span>
                        {displayCurrency === 'USD' && (
                            <span className="block text-[11px] text-slate-500 mt-0.5">Example: SAR 10,000 ≈ {formatSecondaryEquivalent(10000)}</span>
                        )}
                    </div>
                </div>

                <AIAdvisor
                    pageContext="forecast"
                    contextData={{
                        baselineNetWorth: initialValues.netWorth,
                        baselineInvestments: initialValues.investmentValue,
                        projectedNetWorth: summary?.projectedNetWorth ?? 0,
                        monthlySavings,
                        horizonYears: horizon,
                        forecastTrendSample: aiForecastTrendSample,
                    }}
                    title="Forecast advisor"
                    subtitle="Plain-language read on your sliders and projected path"
                    buttonLabel="Get AI forecast insights"
                />

                {forecastValidationWarnings.length > 0 && (
                    <div className="rounded-2xl border-l-4 border-l-amber-500 bg-amber-50/90 border border-amber-100 px-4 py-3 shadow-sm" role="status">
                        <p className="text-sm font-semibold text-amber-950">Checks before you trust the chart</p>
                        <ul className="text-xs text-amber-950 mt-2 space-y-1 list-disc pl-4">
                            {forecastValidationWarnings.slice(0, 8).map((w, i) => (
                                <li key={`fv-${i}`}>{w}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <CollapsibleSection
                    title="How this forecast works (simple)"
                    summary="Tap to read the mechanics"
                    className="border border-sky-100 bg-gradient-to-br from-sky-50/80 via-white to-slate-50/50 shadow-sm"
                    defaultExpanded={false}
                >
                    <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5 leading-relaxed">
                        <li>
                            <strong className="text-slate-900">What moves:</strong> we grow one “investment pile” (your portfolios + brokerage cash today) with your monthly contribution and return %. Everything else in today’s net worth (home, Sukuk, cash outside that pile, debt) stays fixed — so this is a <strong>simplified</strong> story, not a full balance-sheet simulator.
                        </li>
                        <li>
                            <strong className="text-slate-900">Net worth line:</strong> fixed slice of today’s NW + growing investment pile — stays aligned month by month (no rounding drift).
                        </li>
                        <li>
                            <strong className="text-slate-900">History defaults:</strong> your 12‑month net cash flow is converted to <strong>SAR</strong> per transaction (mixed USD/SAR accounts supported).
                        </li>
                        <li>
                            <strong className="text-slate-900">Grey band:</strong> rough sensitivity only — not a formal confidence interval.
                        </li>
                    </ul>
                    <p className="text-xs text-slate-500 mt-4 border-t border-slate-200/80 pt-3">Educational only — not investment advice.</p>
                </CollapsibleSection>

                <div className="cards-grid grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8 lg:items-start">
                    <div className="lg:col-span-1 min-w-0 w-full lg:self-start">
                        <div className="lg:sticky lg:top-24">
                            <SectionCard title="Your assumptions" className="w-full border-l-4 border-l-primary/40 shadow-md" collapsible collapsibleSummary="Presets & sliders" defaultExpanded>
                                <div className="space-y-5">
                                    <p className="text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                                        <InfoHint text="Presets only change growth sliders — compare scenarios in the table." /> Scenario presets
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => (
                                            <button
                                                key={preset}
                                                type="button"
                                                onClick={() => applyScenarioPreset(preset)}
                                                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                                                    scenarioPreset === preset ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:border-primary'
                                                }`}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={resetFromHistory}
                                            className="px-2.5 py-1 text-xs rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                                        >
                                            Reset from history
                                        </button>
                                    </div>
                                    <div>
                                        <label htmlFor="horizon" className="block text-sm font-medium text-slate-700">
                                            Years ahead: <span className="tabular-nums font-semibold text-primary">{horizon}</span>
                                            <InfoHint text="How far to project — longer spans show more uncertainty." />
                                        </label>
                                        <input type="range" id="horizon" min={1} max={30} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary mt-2" />
                                    </div>
                                    <div>
                                        <label htmlFor="monthly-savings" className="block text-sm font-medium text-slate-700">
                                            Monthly savings (model) <InfoHint text="Money you add to investments each month in this simplified story." />
                                        </label>
                                        <input
                                            type="number"
                                            id="monthly-savings"
                                            value={monthlySavings}
                                            onChange={(e) => {
                                                setMonthlySavingsTouched(true);
                                                setMonthlySavings(Number(e.target.value));
                                            }}
                                            className="input-base mt-1"
                                        />
                                        <p className="text-xs text-slate-500 mt-1">
                                            12‑month median net flow {formatCurrencyString(savingsAnalytics.medianMonthlyNet)} · average {formatCurrencyString(savingsAnalytics.averageMonthlyNet)} (SAR)
                                        </p>
                                    </div>
                                    <div>
                                        <label htmlFor="investment-growth" className="block text-sm font-medium text-slate-700">
                                            Expected yearly investment return (%)
                                        </label>
                                        <input
                                            type="number"
                                            id="investment-growth"
                                            value={investmentGrowth}
                                            onChange={(e) => handleManualInvestmentGrowthChange(Number(e.target.value))}
                                            className="input-base mt-1"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="income-growth" className="block text-sm font-medium text-slate-700">
                                            Yearly increase in savings contribution (%)
                                        </label>
                                        <input
                                            type="number"
                                            id="income-growth"
                                            value={incomeGrowth}
                                            onChange={(e) => handleManualIncomeGrowthChange(Number(e.target.value))}
                                            className="input-base mt-1"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">
                                        <SparklesIcon className="h-4 w-4 text-primary shrink-0" aria-hidden />
                                        <span>Projections update instantly — no run button needed.</span>
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    </div>

                    <div className="lg:col-span-3 min-w-0 w-full space-y-6 lg:self-start">
                        {summary && (
                            <>
                                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview</span>
                                        <span
                                            className={`text-[11px] font-bold uppercase rounded-full px-2 py-0.5 ${
                                                scenarioPreset === 'Custom' ? 'bg-slate-100 text-slate-800' : 'bg-primary/10 text-primary'
                                            }`}
                                        >
                                            {scenarioPreset}
                                        </span>
                                    </div>
                                    <div className="cards-grid grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <Card
                                            title={`Net worth (year ${horizon})`}
                                            value={formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}
                                            tooltip="Simplified projection — see methodology."
                                            indicatorColor={deltaProjected >= 0 ? 'green' : 'yellow'}
                                        />
                                        <Card
                                            title="Investment pile (year end)"
                                            value={formatCurrencyString(summary.projectedInvestments, { digits: 0 })}
                                            tooltip="Portfolios + brokerage cash, compounded with your assumptions."
                                            indicatorColor="green"
                                        />
                                        <Card
                                            title="Change vs today"
                                            value={`${deltaProjected >= 0 ? '+' : ''}${formatCurrencyString(deltaProjected, { digits: 0 })}`}
                                            tooltip="Projected net worth minus today’s net worth (SAR)."
                                            indicatorColor={deltaProjected >= 0 ? 'green' : 'yellow'}
                                        />
                                    </div>
                                </div>

                                {confidenceBand && (
                                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Rough range (not exact)</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4">
                                                <p className="text-xs text-rose-800 uppercase tracking-wide font-semibold">Lower</p>
                                                <p className="font-bold text-slate-900 tabular-nums text-lg mt-1">{formatCurrencyString(confidenceBand.low, { digits: 0 })}</p>
                                            </div>
                                            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 ring-1 ring-primary/10">
                                                <p className="text-xs text-primary uppercase tracking-wide font-semibold">Middle</p>
                                                <p className="font-bold text-slate-900 tabular-nums text-lg mt-1">{formatCurrencyString(summary.projectedNetWorth, { digits: 0 })}</p>
                                            </div>
                                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                                                <p className="text-xs text-emerald-800 uppercase tracking-wide font-semibold">Upper</p>
                                                <p className="font-bold text-slate-900 tabular-nums text-lg mt-1">{formatCurrencyString(confidenceBand.high, { digits: 0 })}</p>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-3">Spread scales with how jumpy your monthly savings were and how long you forecast — for intuition only.</p>
                                    </div>
                                )}
                            </>
                        )}

                        {chartDisplayData.length > 0 ? (
                            <SectionCard title="Growth chart" className="flex flex-col border-t-4 border-t-primary/25 shadow-md" collapsible collapsibleSummary="Net worth vs investment pile" defaultExpanded>
                                <p className="text-xs text-slate-600 mb-3">
                                    Long horizons are <strong>sampled</strong> on screen so the chart stays readable — your numbers in the cards use every month.
                                </p>
                                <div className="h-[400px] sm:h-[460px] w-full rounded-xl overflow-hidden border border-slate-100 bg-slate-50/30">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={chartDisplayData} margin={{ ...CHART_MARGIN, right: 28, left: 12, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} tickLine={false} interval="preserveStartEnd" angle={-25} textAnchor="end" height={52} />
                                            <YAxis domain={chartYDomain} tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={11} tickLine={false} width={58} />
                                            <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                            <defs>
                                                <linearGradient id="fcInvestFill2" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.35} />
                                                    <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.08} />
                                                </linearGradient>
                                            </defs>
                                            {goalReferenceLines.map((line) => (
                                                <ReferenceLine
                                                    key={line.key}
                                                    y={line.y}
                                                    stroke={CHART_COLORS.negative}
                                                    strokeDasharray="4 4"
                                                    label={{ value: line.label, position: 'right', fill: CHART_COLORS.axis, fontSize: 10 }}
                                                />
                                            ))}
                                            <Area type="monotone" dataKey="Investment Value" stroke={CHART_COLORS.secondary} fill="url(#fcInvestFill2)" name="Investment pile" />
                                            <Line type="monotone" dataKey="Net Worth" stroke={CHART_COLORS.primary} strokeWidth={2.5} name="Net worth" dot={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </SectionCard>
                        ) : (
                            <SectionCard title="Growth chart">
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 min-h-[200px] flex items-center justify-center text-sm text-slate-500">Add data to project wealth.</div>
                            </SectionCard>
                        )}

                        <SectionCard title={`Scenario comparison (${horizon} years)`} collapsible defaultExpanded className="shadow-md">
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left bg-slate-100 text-slate-700 border-b border-slate-200">
                                            <th className="py-3 px-4 font-semibold">Preset</th>
                                            <th className="py-3 px-4 font-semibold">Net worth</th>
                                            <th className="py-3 px-4 font-semibold">Investments</th>
                                            <th className="py-3 px-4 font-semibold">Note</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {(['Conservative', 'Base', 'Aggressive'] as const).map((preset) => {
                                            const row = scenarioComparison[preset];
                                            const presetIg = preset === 'Conservative' ? 4 : preset === 'Aggressive' ? 10 : 7;
                                            const presetSg = preset === 'Conservative' ? 1 : preset === 'Aggressive' ? 5 : 3;
                                            const isActive =
                                                scenarioPreset === preset ||
                                                (scenarioPreset === 'Custom' && investmentGrowth === presetIg && incomeGrowth === presetSg);
                                            return (
                                                <tr key={preset} className={isActive ? 'bg-primary/5' : ''}>
                                                    <td className="py-3 px-4 font-medium text-slate-900">{preset}</td>
                                                    <td className="py-3 px-4 tabular-nums">{row ? formatCurrencyString(row.projectedNetWorth, { digits: 0 }) : '—'}</td>
                                                    <td className="py-3 px-4 tabular-nums">{row ? formatCurrencyString(row.projectedInvestments, { digits: 0 }) : '—'}</td>
                                                    <td className="py-3 px-4 text-slate-600 text-xs">{isActive ? 'Matches sliders if preset selected' : 'Same savings & horizon, different growth'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </SectionCard>

                        {goalProjections.length > 0 && (
                            <SectionCard title="Goal outlook" collapsible collapsibleSummary="Simple threshold view" defaultExpanded>
                                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {goalProjections.map((proj) => (
                                        <div
                                            key={proj.name}
                                            className={`flex items-start gap-3 p-4 rounded-xl border ${proj.met ? 'border-emerald-200 bg-emerald-50/80' : 'border-slate-200 bg-slate-50/80'}`}
                                        >
                                            <FlagIcon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${proj.met ? 'text-emerald-600' : 'text-slate-400'}`} />
                                            <div>
                                                <p className="font-semibold text-slate-900">{proj.name}</p>
                                                {proj.met ? (
                                                    <p className="text-sm text-emerald-900 mt-1">
                                                        Crosses illustrative threshold in{' '}
                                                        <span className="font-semibold">
                                                            {proj.years}y {proj.months}mo
                                                        </span>
                                                    </p>
                                                ) : (
                                                    <p className="text-sm text-slate-600 mt-1">Not reached within {horizon} years at these assumptions.</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        )}

                        <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Cashflow consistency</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">{savingsAnalytics.consistencyScore.toFixed(0)}</p>
                                <p className="text-xs text-slate-500">Score / 100 from 12‑month SAR net flows</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Volatility (monthly)</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrencyString(savingsAnalytics.monthlyStdDev, { digits: 0 })}</p>
                                <p className="text-xs text-slate-500">How much monthly net swing varies</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Savings rate (this month)</p>
                                <p className={`text-2xl font-bold mt-1 ${currentSavingsRate >= 15 ? 'text-emerald-700' : currentSavingsRate >= 5 ? 'text-amber-700' : 'text-rose-700'}`}>{currentSavingsRate.toFixed(1)}%</p>
                                <p className="text-xs text-slate-500">Income vs expenses (SAR)</p>
                            </div>
                        </div>

                        {currentSavingsRate < 15 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                                <strong>Gentle heads-up:</strong> many plans assume saving at least ~15% of income. Your recent rate is lower — tighten spending or lift income if you want the forecast to feel realistic.
                            </div>
                        )}
                    </div>
                </div>

                <CollapsibleSection title="Stress test (illustrative)" summary="Job loss, market dip, one-off bill" defaultExpanded={false}>
                    <p className="text-xs text-slate-600 mb-4">Rough resilience check using SAR‑normalized cash and spending.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                        <div>
                            <label className="text-xs font-medium text-slate-600">Job loss (months)</label>
                            <input type="range" min={0} max={12} value={stressJobLossM} onChange={(e) => setStressJobLossM(Number(e.target.value))} className="w-full accent-primary" />
                            <p className="text-sm font-semibold">{stressJobLossM} mo</p>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-600">Market drop (% on slice)</label>
                            <input type="range" min={0} max={40} value={stressMarketDrop} onChange={(e) => setStressMarketDrop(Number(e.target.value))} className="w-full accent-primary" />
                            <p className="text-sm font-semibold">{stressMarketDrop}%</p>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-600">One-off cost (SAR)</label>
                            <input type="number" min={0} step={500} value={stressMedical} onChange={(e) => setStressMedical(Number(e.target.value))} className="input-base mt-1" />
                        </div>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm space-y-2">
                        <p className="font-semibold text-amber-950">{stressResult.headline}</p>
                        <p className="text-slate-700">
                            Cash (checking/savings, SAR): <strong>{formatCurrencyString(stressInputs.liquidCash, { digits: 0 })}</strong> · Typical monthly spend:{' '}
                            <strong>{formatCurrencyString(stressInputs.monthlyExpense, { digits: 0 })}</strong>
                        </p>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
                        <div className="rounded-lg border border-slate-200 p-3 bg-white">
                            <p className="font-semibold text-slate-800 mb-1">Strategy lens</p>
                            <p>{strategyCompare.aggressive}</p>
                            <p className="mt-1">{strategyCompare.balanced}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3 bg-white">
                            <p className="font-semibold text-slate-800 mb-1">Lump sum vs DCA</p>
                            <p>{lumpDca.lumpNote}</p>
                            <p className="mt-1">{lumpDca.dcaNote}</p>
                        </div>
                    </div>
                </CollapsibleSection>

                {timeline && (
                    <SectionCard title="Scenario timeline" collapsible defaultExpanded={false}>
                        <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
                            {timeline.events.map((e) => (
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
