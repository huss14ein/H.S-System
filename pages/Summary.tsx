import React, { useState, useMemo, useCallback, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { getAIFinancialPersona, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import PageActionsDropdown from '../components/PageActionsDropdown';
import Card from '../components/Card';
import CollapsibleSection from '../components/CollapsibleSection';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import NetWorthCockpit from '../components/charts/NetWorthCockpit';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { PersonaAnalysis, ReportCardItem } from '../types';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import PageLayout from '../components/PageLayout';
import InfoHint from '../components/InfoHint';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import type { Page } from '../types';
import { SHOCK_TEMPLATES } from '../services/shockDrillEngine';
import { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import { usePrivacyMask } from '../context/PrivacyContext';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { attributeNetWorthWithFlows } from '../services/portfolioAttribution';
import { personalNetCashflowBetween } from '../services/netWorthPeriodFlows';
import type { Transaction } from '../types';
import {
    generateWealthSummaryReportCsv,
    generateWealthSummaryReportHtml,
    openHtmlForPrint,
    generateWealthSummaryReportJson,
} from '../services/reportingEngine';
import { useSelfLearning } from '../context/SelfLearningContext';
import Modal from '../components/Modal';

function householdStressStyles(level: string) {
    const L = (level || '').toLowerCase();
    if (L === 'high') {
        return {
            card: 'border-l-rose-500 bg-rose-50/50',
            pill: 'bg-rose-100 text-rose-900 ring-1 ring-rose-200',
            hint: 'High stress — pause optional spending and shore up cash.',
        };
    }
    if (L === 'medium') {
        return {
            card: 'border-l-amber-500 bg-amber-50/50',
            pill: 'bg-amber-100 text-amber-950 ring-1 ring-amber-200',
            hint: 'Some pressure — keep flexibility and watch large purchases.',
        };
    }
    return {
        card: 'border-l-emerald-500 bg-emerald-50/40',
        pill: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200',
        hint: 'Comfortable room in the household plan.',
    };
}

function runwayStyles(status: 'comfortable' | 'watch' | 'critical' | undefined) {
    if (status === 'critical') return { card: 'border-l-rose-500 bg-rose-50/50', pill: 'bg-rose-100 text-rose-900' };
    if (status === 'watch') return { card: 'border-l-amber-500 bg-amber-50/50', pill: 'bg-amber-100 text-amber-950' };
    return { card: 'border-l-sky-500 bg-sky-50/40', pill: 'bg-sky-100 text-sky-900' };
}

function disciplineStyles(score: number) {
    if (score >= 75) return { card: 'border-l-emerald-500 bg-emerald-50/40', pill: 'bg-emerald-100 text-emerald-900' };
    if (score >= 45) return { card: 'border-l-amber-500 bg-amber-50/40', pill: 'bg-amber-100 text-amber-950' };
    return { card: 'border-l-rose-500 bg-rose-50/50', pill: 'bg-rose-100 text-rose-900' };
}

const getRatingColors = (rating: ReportCardItem['rating']) => {
    switch (rating) {
        case 'Excellent': return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-500', icon: <CheckCircleIcon className="h-6 w-6 text-green-500" /> };
        case 'Good': return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-500', icon: <CheckCircleIcon className="h-6 w-6 text-blue-500" /> };
        case 'Needs Improvement': return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-500', icon: <InformationCircleIcon className="h-6 w-6 text-yellow-500" /> };
        default: return { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-500', icon: null };
    }
};

const MetricIcon: React.FC<{ metric: string }> = ({ metric }) => {
    const iconClass = "h-8 w-8 text-primary";
    switch (metric) {
        case 'Savings Rate': return <PiggyBankIcon className={iconClass} />;
        case 'Debt Management': return <ShieldCheckIcon className={iconClass} />;
        case 'Emergency Fund': return <BanknotesIcon className={iconClass} />;
        case 'Investment Strategy': return <ArrowTrendingUpIcon className={iconClass} />;
        default: return <LightBulbIcon className={iconClass} />;
    }
};

const CheckCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const InformationCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

interface SummaryProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const Summary: React.FC<SummaryProps> = ({ setActivePage, triggerPageAction }) => {
    const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const auth = useContext(AuthContext);
    const { exchangeRate, currency: displayCurrency } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

    const fxBanner = useMemo(() => {
        const w = Number(data?.wealthUltraConfig?.fxRate);
        const hasWu = Number.isFinite(w) && w > 0;
        return {
            rate: sarPerUsd,
            sourceLabel: hasWu ? 'Wealth Ultra / saved FX' : 'Live header rate (or SAR peg default)',
        };
    }, [data?.wealthUltraConfig?.fxRate, sarPerUsd]);
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [analysisEn, setAnalysisEn] = useState<PersonaAnalysis | null>(null);
    const [analysisLanguage, setAnalysisLanguage] = useState<'en' | 'ar'>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);
    const [printSections, setPrintSections] = useState({
        includeSnapshot: true,
        includeCashflow: true,
        includeRisk: true,
        includeInvestmentsOverview: true,
        includePlatforms: true,
        includePortfolios: true,
        includeHoldings: true,
        includeAssets: true,
        includeLiabilities: true,
    });

    useEffect(() => {
        const loadRole = async () => {
            if (!auth?.user || !supabase) {
                setIsAdmin(false);
                return;
            }
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            setIsAdmin(inferIsAdmin(auth.user, userRecord?.role ?? null));
        };
        loadRole();
    }, [auth?.user?.id]);

    const reportModel = useMemo(
        () => (data ? computeWealthSummaryReportModel(data, sarPerUsd, getAvailableCashForAccount) : null),
        [data, sarPerUsd, getAvailableCashForAccount]
    );

    const { maskBalance } = usePrivacyMask();

    const nwSnapshotInsight = useMemo(() => {
        const snaps = listNetWorthSnapshots();
        if (snaps.length < 2) return { snaps, attr: null as ReturnType<typeof attributeNetWorthWithFlows> | null };
        const a = snaps[1];
        const b = snaps[0];
        const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const flow = personalNetCashflowBetween(txs, a.at, b.at);
        return {
            snaps,
            attr: attributeNetWorthWithFlows({
                startNw: a.netWorth,
                endNw: b.netWorth,
                externalCashflow: flow,
            }),
        };
    }, [data, data?.transactions, data?.personalTransactions]);

    const handleGenerateAnalysis = useCallback(async () => {
        const fm = reportModel?.financialMetricsWithEf;
        if (!fm) return;
        trackAction('generate-financial-persona', 'Summary');
        setIsLoading(true);
        setError(null);
        setAnalysis(null);
        setAnalysisEn(null);
        setAnalysisLanguage('en');
        try {
            const result = await getAIFinancialPersona(
                Number(fm.savingsRate) || 0,
                Number(fm.debtToAssetRatio) || 0,
                Number(fm.emergencyFundMonths) || 0,
                String(fm.investmentStyle ?? 'Balanced')
            );
            setAnalysis(result ?? null);
            setAnalysisEn(result ?? null);
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [reportModel?.financialMetricsWithEf, trackAction]);

    const handleTranslateAdvisorToArabic = useCallback(async () => {
        if (!analysisEn) return;
        setIsLoading(true);
        setError(null);
        try {
            const [titleAr, descAr, reportAr] = await Promise.all([
                translateFinancialInsightToArabic(analysisEn.persona.title),
                translateFinancialInsightToArabic(analysisEn.persona.description),
                Promise.all((analysisEn.reportCard ?? []).map(async (item) => ({
                    ...item,
                    metric: await translateFinancialInsightToArabic(item.metric),
                    value: await translateFinancialInsightToArabic(item.value),
                    analysis: await translateFinancialInsightToArabic(item.analysis),
                    suggestion: await translateFinancialInsightToArabic(item.suggestion),
                }))),
            ]);
            setAnalysis({
                persona: { title: titleAr, description: descAr },
                reportCard: reportAr,
            });
            setAnalysisLanguage('ar');
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [analysisEn]);

    const handleAdvisorEnglish = useCallback(() => {
        if (!analysisEn) return;
        setAnalysis(analysisEn);
        setAnalysisLanguage('en');
    }, [analysisEn]);

    const downloadTextFile = useCallback((fileName: string, contents: string, mimeType: string) => {
        const blob = new Blob([contents], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const handleExportWealthSummaryJson = useCallback(() => {
        const payload = reportModel?.wealthSummaryReportPayload;
        if (!payload) return;
        const json = generateWealthSummaryReportJson(payload);
        downloadTextFile(
            `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.json`,
            json,
            'application/json'
        );
    }, [reportModel?.wealthSummaryReportPayload, downloadTextFile]);

    const handleExportWealthSummaryCsv = useCallback(() => {
        const payload = reportModel?.wealthSummaryReportPayload;
        if (!payload) return;
        const csv = generateWealthSummaryReportCsv(payload);
        downloadTextFile(
            `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.csv`,
            csv,
            'text/csv;charset=utf-8'
        );
    }, [reportModel?.wealthSummaryReportPayload, downloadTextFile]);

    const handlePrintWealthSummary = useCallback(() => {
        const payload = reportModel?.wealthSummaryReportPayload;
        if (!payload) return;
        const html = generateWealthSummaryReportHtml(payload, printSections);
        openHtmlForPrint(html);
    }, [reportModel?.wealthSummaryReportPayload, printSections]);

    const summaryMonthlyKpis = useMemo(
        () =>
            data
                ? computeMonthlyReportFinancialKpis(data, sarPerUsd, getAvailableCashForAccount)
                : { budgetVariance: Number.NaN, roi: Number.NaN },
        [data, sarPerUsd, getAvailableCashForAccount]
    );

    const summaryValidationWarnings = useMemo(() => {
        const out: string[] = [];
        const fm = reportModel?.financialMetricsWithEf;
        if (!fm) return out;
        const scopedAccounts = ((data as { personalAccounts?: { currency?: 'SAR' | 'USD' }[] })?.personalAccounts ?? data?.accounts ?? []) as { currency?: 'SAR' | 'USD' }[];
        const hasUsdAccounts = scopedAccounts.some((a) => a.currency === 'USD');
        const fxLooksValid = Number.isFinite(sarPerUsd) && sarPerUsd > 0;
        const liquid = reportModel?.liquidNw;
        const runway = reportModel?.liquidityRunway;

        if (!fxLooksValid) out.push('FX rate is invalid; USD balances may not convert correctly.');
        if (hasUsdAccounts && !fxLooksValid) out.push('USD accounts detected but FX is missing. Set USD→SAR in header/settings.');
        if (!Number.isFinite(fm.netWorth)) out.push('Net worth is invalid.');
        if (!Number.isFinite(fm.monthlyIncome)) out.push('Monthly income is invalid.');
        if (!Number.isFinite(fm.monthlyExpenses)) out.push('Monthly expenses are invalid.');
        if (!Number.isFinite(summaryMonthlyKpis.budgetVariance)) out.push('Budget variance could not be computed.');
        if (!Number.isFinite(summaryMonthlyKpis.roi)) out.push('ROI could not be computed.');
        if (liquid) {
            const rebuilt = liquid.liquidCash + liquid.investmentsSAR + liquid.commodities + liquid.receivables - liquid.shortTermDebt;
            if (Math.abs(rebuilt - liquid.liquidNetWorth) > 1) {
                out.push('Liquid net worth components do not reconcile. Please refresh or review account balances and liabilities.');
            }
            const debtSplit = liquid.creditCardDebtSar + liquid.loanAndMortgageDebtSar;
            if (Math.abs(debtSplit - liquid.shortTermDebt) > 1) {
                out.push('Debt breakdown (cards vs loans) does not match total debt — review liability rows and credit accounts.');
            }
        }
        if (fxLooksValid && Math.abs(exchangeRate - sarPerUsd) > 0.06) {
            out.push('Display FX and calculation FX differ; totals use the resolved SAR-per-USD rate (see banner below).');
        }
        if (runway && !Number.isFinite(runway.monthsOfRunway)) {
            out.push('Liquidity runway could not be calculated from current data.');
        }
        return out;
    }, [reportModel, summaryMonthlyKpis, data, sarPerUsd, exchangeRate]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading summary" />
            </div>
        );
    }

    if (!reportModel) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading summary" />
            </div>
        );
    }

    const {
        financialMetricsWithEf,
        investmentTreemapData,
        managedWealthTotal,
        emergencyFund,
        householdStress,
        riskLane,
        liquidityRunway,
        discipline,
        shockDrill,
        liquidNw,
    } = reportModel;

    return (
        <PageLayout 
            title="Financial Summary" 
            description="Your money at a glance: net worth, cash & investments, stress checks, and optional AI guidance — written for everyday use, not accountant jargon."
            action={
                setActivePage && (
                    <PageActionsDropdown
                        ariaLabel="Summary quick links"
                        actions={[
                            { value: 'print-wealth-summary', label: 'Print wealth summary', onClick: () => setIsPrintOptionsOpen(true) },
                            { value: 'export-wealth-json', label: 'Export wealth summary (JSON)', onClick: handleExportWealthSummaryJson },
                            { value: 'export-wealth-csv', label: 'Export wealth summary (CSV)', onClick: handleExportWealthSummaryCsv },
                            { value: 'wealth-ultra', label: 'Wealth Ultra', onClick: () => setActivePage('Wealth Ultra') },
                            { value: 'market-events', label: 'Market Events', onClick: () => setActivePage('Market Events') },
                            { value: 'assets', label: 'Assets', onClick: () => setActivePage('Assets') },
                            { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
                            { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                            { value: 'transactions', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                            { value: 'statement-upload', label: 'Import statements', onClick: () => setActivePage('Statement Upload') },
                        ]}
                    />
                )
            }
        >
            <Modal isOpen={isPrintOptionsOpen} onClose={() => setIsPrintOptionsOpen(false)} title="Choose what to include in the HTML report">
                <div className="space-y-3 text-sm text-slate-700">
                    <p className="text-slate-600">Pick sections for export. This helps non-financial users print only what they need.</p>
                    {[
                        ['includeSnapshot', 'Net worth snapshot'],
                        ['includeCashflow', 'Cashflow & efficiency'],
                        ['includeRisk', 'Resilience & risk'],
                        ['includeInvestmentsOverview', 'Investment summary (counts & totals)'],
                        ['includePlatforms', 'Investment platforms (cash by platform)'],
                        ['includePortfolios', 'Investment portfolios'],
                        ['includeHoldings', 'Holding details (positions)'],
                        ['includeAssets', 'Asset details'],
                        ['includeLiabilities', 'Liability details'],
                    ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={(printSections as Record<string, boolean>)[key]}
                                onChange={(e) => setPrintSections((prev) => ({ ...prev, [key]: e.target.checked }))}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" className="px-3 py-2 rounded border border-slate-300 text-slate-700" onClick={() => setIsPrintOptionsOpen(false)}>Cancel</button>
                        <button
                            type="button"
                            className="px-3 py-2 rounded bg-primary text-white"
                            onClick={() => {
                                handlePrintWealthSummary();
                                setIsPrintOptionsOpen(false);
                            }}
                        >
                            Generate HTML report
                        </button>
                    </div>
                </div>
            </Modal>

            <div className="mb-4 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/90 to-white px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-700 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-900">One currency view</span>
                    <span>
                        Numbers are calculated in <strong>SAR</strong> (Saudi Riyal) so everything adds up the same way.
                        {displayCurrency === 'USD' && (
                            <span className="text-slate-600"> Your display preference is USD — amounts convert using the rate below.</span>
                        )}
                    </span>
                </div>
                <div className="text-xs sm:text-sm tabular-nums text-slate-600 text-right">
                    <span className="font-semibold text-slate-800">1 USD = {fxBanner.rate.toFixed(2)} SAR</span>
                    <span className="text-slate-500"> · {fxBanner.sourceLabel}</span>
                    {displayCurrency === 'USD' && (
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                            Example: SAR 10,000 ≈ {formatSecondaryEquivalent(10000)}
                        </span>
                    )}
                </div>
            </div>

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setActivePage?.('Assets')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActivePage?.('Assets'); } }}
                        className="lg:col-span-1 section-card-hover flex flex-col justify-center items-center text-center border-l-4 border-l-emerald-500 cursor-pointer bg-gradient-to-br from-white to-emerald-50/30"
                        aria-label="View and manage assets"
                    >
                        <div className="w-full flex items-start justify-between gap-2 mb-1">
                            <h2 className="text-lg font-medium text-gray-500 text-left min-w-0 flex-1">Your net worth</h2>
                            <InfoHint text="Everything you own minus what you owe, for accounts and items marked as yours. Family members’ items with a different Owner are left out — same rule as the Dashboard." placement="bottom" hintId="summary-personal-wealth" hintPage="Summary" />
                        </div>
                        <p className="text-5xl font-extrabold text-dark my-2">{maskBalance(formatCurrencyString(financialMetricsWithEf.netWorth, { digits: 0 }))}</p>
                        <p className={`${financialMetricsWithEf.netWorthTrend >= 0 ? 'text-success' : 'text-danger'} font-semibold flex flex-wrap items-center justify-center gap-2`}>
                            <span>{financialMetricsWithEf.netWorthTrend >= 0 ? '+' : ''}{financialMetricsWithEf.netWorthTrend.toFixed(1)}% rough trend</span>
                            <span className="inline-flex flex-shrink-0">
                                <InfoHint
                                    text="Approximate: compares today’s net worth with an implied figure from this month’s income and spending. It is not investment performance — use the chart and investments section for that."
                                    placement="bottom"
                                    hintId="summary-nw-trend"
                                    hintPage="Summary"
                                />
                            </span>
                        </p>
                        <p className="text-xs text-slate-500 mt-2">Tap to review property &amp; Sukuk on Assets</p>
                        {isAdmin && managedWealthTotal > 0 && (
                            <p className="text-xs text-amber-800 mt-2 font-medium rounded-lg bg-amber-50 px-2 py-1 border border-amber-100">Household / managed wealth on top of yours: {maskBalance(formatCurrencyString(managedWealthTotal, { digits: 0 }))}</p>
                        )}
                    </div>

                <div className="lg:col-span-2 cards-grid grid grid-cols-1 sm:grid-cols-2">
                    <Card title="Money in (this month)" value={formatCurrencyString(financialMetricsWithEf.monthlyIncome)} valueColor="text-success" tooltip="Sum of income-style transactions since the first day of this month (personal accounts only)." />
                    <Card title="Money out (this month)" value={formatCurrencyString(financialMetricsWithEf.monthlyExpenses)} valueColor="text-danger" tooltip="Sum of spending-style transactions this month. Does not double-count internal transfers when labeled correctly." />
                    <Card title="Savings rate" value={`${(financialMetricsWithEf.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="Share of this month’s income left after expenses. If income is zero, this reads 0%." />
                    <Card 
                        title="Emergency Fund" 
                        value={`${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months`}
                        tooltip={`Liquid cash covers ${financialMetricsWithEf.emergencyFundMonths.toFixed(1)} months of essential expenses. Target: ${EMERGENCY_FUND_TARGET_MONTHS} months.${emergencyFund.shortfall > 0 ? ` Shortfall: ${formatCurrencyString(emergencyFund.shortfall)}.` : ''}`}
                        trend={financialMetricsWithEf.efTrend}
                        indicatorColor={financialMetricsWithEf.efStatus as 'green' | 'yellow' | 'red'}
                    />
                </div>
            </div>

            {summaryValidationWarnings.length > 0 && (
                <div className="mb-4 rounded-2xl border-l-4 border-l-amber-500 bg-amber-50/90 border border-amber-100 px-4 py-3 shadow-sm" role="status">
                    <p className="text-sm font-semibold text-amber-950">Before you rely on these numbers</p>
                    <p className="text-xs text-amber-900/90 mt-1 mb-2">One or more checks failed. Fix the underlying data (accounts, FX, transactions) so this page stays trustworthy.</p>
                    <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4">
                        {summaryValidationWarnings.slice(0, 10).map((w, i) => <li key={`sv-${i}`}>{w}</li>)}
                    </ul>
                </div>
            )}

            <CollapsibleSection title="Spendable-style wealth (liquid)" summary={maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))} className="border border-emerald-100 bg-gradient-to-br from-emerald-50/40 to-white">
                <p className="text-sm text-slate-600 mb-2 max-w-prose">
                    A simpler slice than full net worth: cash you can reach quickly, brokerage &amp; Sukuk, commodities, money owed to you, minus cards and loans.
                    Homes and cars stay in <strong>full net worth</strong> above — they are slower to sell, so they are listed separately below for context.
                </p>
                <p className="text-2xl font-extrabold text-emerald-800 mb-4">{maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))}</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Adds</p>
                        <ul className="space-y-2 text-xs text-slate-700">
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />Cash &amp; brokerage cash</span>
                                <span className="tabular-nums font-medium">{maskBalance(formatCurrencyString(liquidNw.liquidCash, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />Stocks &amp; funds (portfolios)</span>
                                <span className="tabular-nums font-medium">{maskBalance(formatCurrencyString(liquidNw.portfolioHoldingsSar, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden />Sukuk (from Assets)</span>
                                <span className="tabular-nums font-medium">{maskBalance(formatCurrencyString(liquidNw.sukukSar, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />Commodities</span>
                                <span className="tabular-nums font-medium">{maskBalance(formatCurrencyString(liquidNw.commodities, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />Receivables (owed to you)</span>
                                <span className="tabular-nums font-medium">{maskBalance(formatCurrencyString(liquidNw.receivables, { digits: 0 }))}</span>
                            </li>
                        </ul>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Subtracts</p>
                        <ul className="space-y-2 text-xs text-slate-700">
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden />Credit cards</span>
                                <span className="tabular-nums font-medium text-rose-800">−{maskBalance(formatCurrencyString(liquidNw.creditCardDebtSar, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-700" aria-hidden />Mortgages &amp; loans</span>
                                <span className="tabular-nums font-medium text-rose-900">−{maskBalance(formatCurrencyString(liquidNw.loanAndMortgageDebtSar, { digits: 0 }))}</span>
                            </li>
                            <li className="flex justify-between gap-2 pt-1 text-slate-800 font-semibold">
                                <span>Total debt in this view</span>
                                <span className="tabular-nums">−{maskBalance(formatCurrencyString(liquidNw.shortTermDebt, { digits: 0 }))}</span>
                            </li>
                        </ul>
                        <p className="text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
                            Illiquid property &amp; similar on the Assets page (excl. Sukuk):{' '}
                            <span className="font-semibold text-slate-700">{maskBalance(formatCurrencyString(liquidNw.illiquidPhysicalAssetsSar, { digits: 0 }))}</span>
                        </p>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    <span className="rounded-lg bg-slate-100 px-2 py-1">Last ~30 days net in/out (income − spending): {maskBalance(formatCurrencyString(liquidNw.contributionEstimate30d, { digits: 0 }))}</span>
                    <InfoHint text="Rough cashflow hint from dated transactions; not a bank statement." hintId="summary-liquid-flow" hintPage="Summary" />
                </div>
                <p className="text-[11px] text-slate-500 mt-2">USD accounts and US-listed holdings are converted with the same SAR-per-USD rate as the rest of the app.</p>
            </CollapsibleSection>

            <CollapsibleSection title="Net worth change vs flows (saved snapshots)" summary="See savings vs market moves" className="border border-violet-100 bg-violet-50/40">
                    {nwSnapshotInsight.attr ? (
                        <>
                            <p className="text-sm text-slate-700 mb-2">Uses your last two net worth snapshots from visiting the Dashboard — helpful to see how much of the change came from money in/out vs investments.</p>
                            <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                                {nwSnapshotInsight.attr.bullets.map((line, i) => (
                                    <li key={i}>{line}</li>
                                ))}
                            </ul>
                            <p className="text-xs text-slate-500 mt-2">
                                More tools: <button type="button" className="text-primary font-medium" onClick={() => triggerPageAction ? triggerPageAction('Engines & Tools', 'openRiskTradingHub') : setActivePage?.('Engines & Tools')}>Safety &amp; rules →</button>
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-600">
                            Open <strong>Dashboard</strong> on two different days to store snapshots; then this section splits <strong>your own activity</strong> from market-style swings.{' '}
                            {nwSnapshotInsight.snaps.length === 1 && (
                                <span className="block mt-1 text-slate-500">One snapshot saved — visit Dashboard again another day.</span>
                            )}
                            {nwSnapshotInsight.snaps.length === 0 && (
                                <span className="block mt-1 text-slate-500">No snapshots yet — open Dashboard once to create the first one.</span>
                            )}
                        </p>
                    )}
            </CollapsibleSection>
            
            <div className="cards-grid grid grid-cols-1 gap-4">
                    <div className="section-card flex flex-col border-l-4 border-l-sky-500">
                        <NetWorthCockpit
                            title="Net worth (history + today)"
                            onOpenInvestments={setActivePage ? () => setActivePage('Investments') : undefined}
                            onOpenAccounts={setActivePage ? () => setActivePage('Accounts') : undefined}
                            onOpenAssets={setActivePage ? () => setActivePage('Assets') : undefined}
                        />
                    </div>
                <div className="section-card flex flex-col min-h-[420px] h-[min(56vh,520px)]">
                    <div className="mb-2 sm:mb-4 space-y-1">
                        <h3 className="section-title !mb-0">Investment Allocation &amp; Performance</h3>
                        <p className="text-xs text-slate-500 max-w-prose">
                            Tile area reflects position size; color reflects unrealized performance vs cost basis. Sukuk recorded under <strong>Assets</strong> is included here and in the Investments band on the net worth chart.
                        </p>
                    </div>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden border border-slate-100">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full min-h-[280px] flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                </div>
            </div>
            
            {householdStress && (() => {
                const hs = householdStressStyles(householdStress.level);
                return (
                <div className={`section-card border-l-4 ${hs.card}`}>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="section-title !mb-0">Household cashflow stress</h3>
                        <span className={`text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${hs.pill}`}>{householdStress.level}</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">{hs.hint}</p>
                    <p className="text-sm text-slate-800 mb-2">{householdStress.summary}</p>
                    {householdStress.flags.length > 0 && (
                        <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5">
                            {householdStress.flags.slice(0, 4).map(flag => (
                                <li key={flag}>{flag}</li>
                            ))}
                        </ul>
                    )}
                </div>
                );
            })()}

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="section-card border-l-4 border-l-violet-500 bg-violet-50/30">
                    <h3 className="section-title mb-1">Investment risk lane</h3>
                    <p className="text-xs text-slate-600 mb-2">How aggressive your current setup looks versus a calmer default — not a product recommendation.</p>
                    <p className="text-sm text-slate-800">
                        Where you are: <span className="font-semibold">{riskLane.lane}</span>
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                        Gentler alternative to consider: <span className="font-semibold">{riskLane.suggestedProfile}</span>
                    </p>
                    <ul className="text-xs text-slate-600 list-disc pl-5 mt-2 space-y-0.5">
                        {(riskLane.reasons ?? []).slice(0, 4).map((r, i) => <li key={r ?? i}>{r}</li>)}
                    </ul>
                </div>
                <div className={`section-card border-l-4 ${liquidityRunway ? runwayStyles(liquidityRunway.status).card : 'border-l-slate-300'}`}>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="section-title !mb-0">Cash runway</h3>
                        {liquidityRunway && (
                            <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${runwayStyles(liquidityRunway.status).pill}`}>
                                {liquidityRunway.status}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-600 mb-2">How many months of typical spending your accessible cash might cover.</p>
                    {liquidityRunway ? (
                        <>
                            <p className="text-lg font-bold text-slate-900 tabular-nums">
                                {(liquidityRunway.monthsOfRunway ?? 0).toFixed(1)} <span className="text-sm font-semibold text-slate-600">months</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Portfolio drawdown (Wealth Ultra snapshots): <span className="font-semibold">{(liquidityRunway.drawdownPct ?? 0).toFixed(1)}%</span>
                            </p>
                            <ul className="text-xs text-slate-600 mt-2 space-y-0.5 list-disc pl-4">
                                {(liquidityRunway.reasons ?? []).slice(0, 3).map((r, i) => <li key={`lr-${i}`}>{r}</li>)}
                            </ul>
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">Add accounts and a few months of expenses to estimate runway.</p>
                    )}
                </div>
                <div className={`section-card border-l-4 ${disciplineStyles(discipline?.score ?? 0).card}`}>
                    <h3 className="section-title mb-1">Budget discipline</h3>
                    <p className="text-xs text-slate-600 mb-2">How closely recent spending stayed inside the lines you set.</p>
                    <p className="text-lg font-bold text-slate-900">
                        {discipline?.score ?? 0}/100 <span className="text-sm font-semibold text-slate-600">({discipline?.label ?? '—'})</span>
                    </p>
                    <ul className="text-xs text-slate-600 list-disc pl-5 mt-2 space-y-0.5">
                        {(discipline.reasons ?? []).slice(0, 4).map((r, i) => <li key={r ?? i}>{r}</li>)}
                    </ul>
                </div>
            </div>

            <div className="section-card">
                <h3 className="section-title mb-2">Shock Drill (Auto)</h3>
                <p className="text-xs text-slate-500 mb-2">
                    Default template: <span className="font-semibold">{SHOCK_TEMPLATES.find(t => t.id === 'job_loss')?.label}</span>
                </p>
                {shockDrill ? (
                    <>
                        <p className="text-sm text-slate-700">
                            Household year-end delta: <span className="font-semibold">{formatCurrencyString(shockDrill.householdProjectedYearEndDelta ?? 0, { digits: 0 })}</span>
                        </p>
                        <p className="text-sm text-slate-700 mt-1">
                            Wealth Ultra value delta: <span className="font-semibold">{(shockDrill.wealthUltraPortfolioValueDeltaPct ?? 0).toFixed(1)}%</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2">{shockDrill.combinedRiskNote ?? '—'}</p>
                    </>
                ) : (
                    <p className="text-sm text-slate-500">Not enough data to run a drill.</p>
                )}
            </div>

            <div className="section-card max-w-full">
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex flex-col"><div className="flex items-center space-x-2"><LightBulbIcon className="h-6 w-6 text-yellow-500" /><h2 className="text-xl font-semibold text-dark">Financial Advisor</h2></div><p className="text-xs text-slate-500 mt-0.5">Direct, summarized guidance with a report card</p></div>
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <button onClick={handleGenerateAnalysis} disabled={isLoading} className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                            <SparklesIcon className="h-5 w-5 mr-2" />
                            {isLoading ? 'Analyzing...' : (analysis ? 'Refresh Advisor Summary' : 'Generate Advisor Summary')}
                        </button>
                        {analysis && (
                            <>
                                <button type="button" onClick={handleAdvisorEnglish} disabled={analysisLanguage === 'en' || isLoading} className="px-3 py-2 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                    English
                                </button>
                                <button type="button" onClick={handleTranslateAdvisorToArabic} disabled={analysisLanguage === 'ar' || isLoading} className="px-3 py-2 text-xs rounded border border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-50">
                                    Translate to Arabic
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {isLoading && <div className="text-center p-8 text-gray-500">Crafting your personal financial summary...</div>}
                {!isLoading && error && (
                    <div className="alert-error">
                         <h4 className="font-bold">AI Analysis Error</h4>
                         <SafeMarkdownRenderer content={error} />
                         <button type="button" onClick={handleGenerateAnalysis} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg hover:bg-red-200">Retry</button>
                    </div>
                )}
                {!isLoading && !analysis && !error && <div className="text-center p-8 text-gray-500">Click "Generate Advisor Summary" to run the advisor manually.</div>}
                {analysis && !isLoading && !error && (
                    <div className="space-y-8 mt-4">
                        <div className="text-center bg-blue-50 p-6 rounded-lg border border-blue-200">
                             <SparklesIcon className="h-10 w-10 text-primary mx-auto mb-2" />
                             <h3 className="text-2xl font-bold text-dark">{analysis.persona.title}</h3>
                             <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{analysis.persona.description}</p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-dark mb-4 text-center">Financial Health Report Card</h3>
                            <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
                                {(analysis.reportCard ?? []).map((item, idx) => (
                                    <div key={item.metric ?? `report-${idx}`} className={`p-4 rounded-lg border-l-4 ${getRatingColors(item.rating).border} ${getRatingColors(item.rating).bg}`}>
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center space-x-3">
                                                 <MetricIcon metric={item.metric} />
                                                 <div>
                                                    <p className="font-bold text-dark">{item.metric}</p>
                                                    <p className={`text-sm font-semibold ${getRatingColors(item.rating).text}`}>{item.rating} ({item.value})</p>
                                                 </div>
                                            </div>
                                             {getRatingColors(item.rating).icon}
                                        </div>
                                        <div className="mt-3 text-sm text-gray-700 space-y-2">
                                            <p><strong className="font-medium">Analysis:</strong> {item.analysis}</p>
                                            <p><strong className="font-medium">Suggestion:</strong> {item.suggestion}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

export default Summary;
