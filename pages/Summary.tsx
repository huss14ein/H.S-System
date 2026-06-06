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
import { ArrowTrendingDownIcon } from '../components/icons/ArrowTrendingDownIcon';
import PageActionsDropdown from '../components/PageActionsDropdown';
import Card from '../components/Card';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import NetWorthCockpit from '../components/charts/NetWorthCockpit';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import { PersonaAnalysis, ReportCardItem } from '../types';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import PageLayout from '../components/PageLayout';
import InfoHint from '../components/InfoHint';
import { useCurrency } from '../context/CurrencyContext';
import { supabase } from '../services/supabaseClient';
import type { Page } from '../types';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { getPersonalAccounts } from '../utils/wealthScope';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import { usePrivacyMask } from '../context/PrivacyContext';
import { buildReviewPack, downloadReviewPackMarkdown } from '../services/reviewPack';
import { sendReviewPackEmail } from '../services/reviewPackEmail';
import { toast } from '../context/ToastContext';
import { captureExtendedNetWorthSnapshot } from '../services/netWorthSnapshotExtended';
import {
    canAutoCaptureNetWorthSnapshot,
    getTrackedQuoteSymbolsFromData,
    quoteRefreshFingerprint,
} from '../services/netWorthSnapshotReadiness';
import {
    markAutoNetWorthSnapshotCaptured,
    shouldThrottleAutoNetWorthSnapshot,
} from '../services/netWorthSnapshotThrottle';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import DashboardKpiQualityPanel from '../components/DashboardKpiQualityPanel';
import { SectionLoadingPlaceholder } from '../components/shared/SectionLoadingPlaceholder';
import {
    generateWealthSummaryReportCsv,
    generateWealthSummaryReportHtml,
    openHtmlForPrint,
    generateWealthSummaryReportJson,
} from '../services/reportingEngine';
import { useSelfLearning } from '../context/SelfLearningContext';
import Modal from '../components/Modal';
import { useAI } from '../context/AiContext';
import AiProxyUnavailableHint from '../components/AiProxyUnavailableHint';
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

const Summary: React.FC<SummaryProps> = ({ setActivePage }) => {
    const { aiActionsEnabled, aiHealthChecked, isAiAvailable } = useAI();
    const { data, getAvailableCashForAccount, showHydrateBanner } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const auth = useContext(AuthContext);
    const isAdmin = Boolean(auth?.isAdmin);
    const { exchangeRate, currency: displayCurrency } = useCurrency();
    const {
        wealthSummary: reportModel,
        kpiSnapshot,
        headline,
        todaySnapshot,
        investableCashBars,
        sarPerUsd: canonicalSarPerUsd,
        simulatedPrices: canonicalSimulatedPrices,
        extendedReady,
    } = useExtendedCanonicalMetrics();
    const { isRefreshing, hasQueuedPriceRefresh, symbolQuoteUpdatedAt, isLive } = useMarketQuoteMeta();
    const fxBanner = useMemo(() => {
        const w = Number(data?.wealthUltraConfig?.fxRate);
        const hasWu = Number.isFinite(w) && w > 0;
        const rate = reportModel?.sarPerUsd ?? exchangeRate;
        return {
            rate,
            sourceLabel: hasWu ? 'Wealth Ultra / saved FX' : 'Live header rate (or SAR peg default)',
        };
    }, [data?.wealthUltraConfig?.fxRate, reportModel?.sarPerUsd, exchangeRate]);
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [analysisEn, setAnalysisEn] = useState<PersonaAnalysis | null>(null);
    const [analysisLanguage, setAnalysisLanguage] = useState<'en' | 'ar'>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);
    const [reviewPackEmailSending, setReviewPackEmailSending] = useState(false);
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

    const { maskBalance } = usePrivacyMask();
    const handleGenerateAnalysis = useCallback(async () => {
        if (!aiActionsEnabled) {
            setError(
                'AI is not available yet. Confirm the proxy health banner below: set GEMINI_API_KEY (or another provider) in Netlify or project `.env`, then Retry.',
            );
            return;
        }
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
    }, [aiActionsEnabled, reportModel?.financialMetricsWithEf, trackAction]);

    const handleTranslateAdvisorToArabic = useCallback(async () => {
        if (!analysisEn || !aiActionsEnabled) return;
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
    }, [analysisEn, aiActionsEnabled]);

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

    const handleExportReviewPack = useCallback(() => {
        if (!data) return;
        const fm = reportModel?.financialMetricsWithEf;
        const surplus = Math.max(0, (fm?.monthlyIncome ?? 0) - (fm?.monthlyExpenses ?? 0));
        const pack = buildReviewPack(data, exchangeRate, getAvailableCashForAccount, surplus, canonicalSimulatedPrices);
        downloadReviewPackMarkdown(pack.markdown);
        trackAction('export-review-pack', 'Summary');
    }, [data, exchangeRate, getAvailableCashForAccount, canonicalSimulatedPrices, reportModel?.financialMetricsWithEf, trackAction]);

    const handleEmailReviewPack = useCallback(async () => {
        if (!data || reviewPackEmailSending) return;
        const fm = reportModel?.financialMetricsWithEf;
        const surplus = Math.max(0, (fm?.monthlyIncome ?? 0) - (fm?.monthlyExpenses ?? 0));
        const pack = buildReviewPack(data, exchangeRate, getAvailableCashForAccount, surplus, canonicalSimulatedPrices);
        setReviewPackEmailSending(true);
        const result = await sendReviewPackEmail(pack.markdown);
        setReviewPackEmailSending(false);
        if (result.ok) {
            toast('Review pack sent to your account email.', 'success');
            trackAction('email-review-pack', 'Summary');
        } else {
            toast(result.error, 'error');
        }
    }, [data, exchangeRate, getAvailableCashForAccount, canonicalSimulatedPrices, reportModel?.financialMetricsWithEf, reviewPackEmailSending, trackAction]);

    const handleCaptureSnapshot = useCallback(() => {
        if (!data) return;
        captureExtendedNetWorthSnapshot(
            data,
            exchangeRate,
            getAvailableCashForAccount,
            supabase && auth?.user?.id ? { supabase, userId: auth.user.id } : null,
            canonicalSimulatedPrices,
        );
        trackAction('capture-nw-snapshot', 'Summary');
    }, [data, exchangeRate, getAvailableCashForAccount, auth?.user?.id, canonicalSimulatedPrices, trackAction]);

    useEffect(() => {
        if (!auth?.user?.id || !data) return;
        const nw = headline?.netWorth;
        if (typeof nw !== 'number' || !Number.isFinite(nw)) return;
        const snapshotReady = canAutoCaptureNetWorthSnapshot({
            showHydrateBanner,
            isRefreshing,
            hasQueuedPriceRefresh,
            symbolQuoteUpdatedAt,
            isLive,
            data,
        });
        if (!snapshotReady) return;
        const quoteFp = quoteRefreshFingerprint(
            getTrackedQuoteSymbolsFromData(data),
            symbolQuoteUpdatedAt,
        );
        if (shouldThrottleAutoNetWorthSnapshot(auth.user.id, nw, undefined, quoteFp)) return;
        captureExtendedNetWorthSnapshot(
            data,
            exchangeRate,
            getAvailableCashForAccount,
            supabase ? { supabase, userId: auth.user.id } : null,
            canonicalSimulatedPrices,
        );
        markAutoNetWorthSnapshotCaptured(auth.user.id, nw, quoteFp);
    }, [
        auth?.user?.id,
        data,
        headline?.netWorth,
        exchangeRate,
        getAvailableCashForAccount,
        showHydrateBanner,
        canonicalSimulatedPrices,
        isRefreshing,
        hasQueuedPriceRefresh,
        symbolQuoteUpdatedAt,
        isLive,
    ]);

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
            kpiSnapshot
                ? { budgetVariance: kpiSnapshot.budgetVariance, roi: kpiSnapshot.roi }
                : data
                  ? computeMonthlyReportFinancialKpis(data, exchangeRate, getAvailableCashForAccount, canonicalSimulatedPrices)
                  : { budgetVariance: Number.NaN, roi: Number.NaN },
        [kpiSnapshot, data, exchangeRate, getAvailableCashForAccount, canonicalSimulatedPrices],
    );

    const summaryValidationWarnings = useMemo(() => {
        const out: string[] = [];
        const fm = reportModel?.financialMetricsWithEf;
        if (!fm) return out;
        const scopedAccounts = getPersonalAccounts(data) as { currency?: 'SAR' | 'USD' }[];
        const hasUsdAccounts = scopedAccounts.some((a) => a.currency === 'USD');
        const rate = reportModel?.sarPerUsd;
        const fxLooksValid = Number.isFinite(rate) && (rate ?? 0) > 0;
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
        if (fxLooksValid && Math.abs(exchangeRate - (rate ?? 0)) > 0.06) {
            out.push('Display FX and calculation FX differ; totals use the resolved SAR-per-USD rate (see banner below).');
        }
        if (runway && !Number.isFinite(runway.monthsOfRunway)) {
            out.push('Liquidity runway could not be calculated from current data.');
        }
        return out;
    }, [reportModel, summaryMonthlyKpis, data, exchangeRate]);

    if (!extendedReady || !reportModel) {
        return (
            <PageLayout title="Wealth Summary" description="Consolidated view of net worth, investments, and cashflow.">
                <SectionLoadingPlaceholder labelKey="analyticsMetricsLoading" minHeight="12rem" />
            </PageLayout>
        );
    }

    const {
        financialMetricsWithEf,
        investmentTreemapData,
        managedWealthTotal,
        emergencyFund,
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
                            { value: 'capture-snapshot', label: 'Capture net worth snapshot', onClick: handleCaptureSnapshot },
                            { value: 'export-review-pack', label: 'Export review pack (Markdown)', onClick: handleExportReviewPack },
                            {
                                value: 'email-review-pack',
                                label: reviewPackEmailSending ? 'Sending review pack…' : 'Email review pack',
                                onClick: () => void handleEmailReviewPack(),
                            },
                            { value: 'export-wealth-json', label: 'Export wealth summary (JSON)', onClick: handleExportWealthSummaryJson },
                            { value: 'export-wealth-csv', label: 'Export wealth summary (CSV)', onClick: handleExportWealthSummaryCsv },
                            { value: 'wealth-analytics', label: 'Wealth Analytics', onClick: () => setActivePage('Wealth Analytics') },
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

            {data && isAdmin && <DashboardKpiQualityPanel />}

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
                        <div
                            className={`mt-1 flex flex-col items-center gap-1 ${financialMetricsWithEf.netWorthTrend >= 0 ? 'text-success' : 'text-danger'}`}
                        >
                            <div className="flex items-center justify-center gap-2">
                                {financialMetricsWithEf.netWorthTrend >= 0 ? (
                                    <ArrowTrendingUpIcon className="h-6 w-6 shrink-0 opacity-90" aria-hidden />
                                ) : (
                                    <ArrowTrendingDownIcon className="h-6 w-6 shrink-0 opacity-90" aria-hidden />
                                )}
                                <span className="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight">
                                    {financialMetricsWithEf.netWorthTrend >= 0 ? '+' : ''}
                                    {financialMetricsWithEf.netWorthTrend.toFixed(1)}%
                                </span>
                                <InfoHint
                                    text="This financial month’s net cashflow (income − expenses, same KPI filters as Dashboard) expressed as a percent of implied net worth at month start. It is not portfolio time-weighted return — use Investments and the net worth cockpit chart for that."
                                    placement="bottom"
                                    hintId="summary-nw-trend"
                                    hintPage="Summary"
                                />
                            </div>
                            <p className="text-xs font-medium text-slate-600 max-w-[16rem] leading-snug text-center">
                                This month’s flow vs implied month start net worth (same as Dashboard card).
                            </p>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Tap to review property &amp; Sukuk on Assets</p>
                        {isAdmin && managedWealthTotal > 0 && (
                            <p className="text-xs text-amber-800 mt-2 font-medium rounded-lg bg-amber-50 px-2 py-1 border border-amber-100">Household / managed wealth on top of yours: {maskBalance(formatCurrencyString(managedWealthTotal, { digits: 0 }))}</p>
                        )}
                    </div>

                <div className="lg:col-span-2 cards-grid grid grid-cols-1 sm:grid-cols-2">
                    <Card title="Money in (financial month)" value={formatCurrencyString(financialMetricsWithEf.monthlyIncome)} valueColor="text-success" tooltip="Sum of income-style transactions in the current financial month (Settings → month start day). Personal accounts only." />
                    <Card title="Money out (financial month)" value={formatCurrencyString(financialMetricsWithEf.monthlyExpenses)} valueColor="text-danger" tooltip="Sum of spending-style transactions in the current financial month. Does not double-count internal transfers when labeled correctly." />
                    <Card title="Savings rate" value={`${(financialMetricsWithEf.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="Share of this financial month’s income left after expenses. If income is zero, this reads 0%." />
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

            <div className="cards-grid grid grid-cols-1 gap-4 mb-6">
                    <div className="section-card flex flex-col border-l-4 border-l-sky-500">
                        <NetWorthCockpit
                            title="Net worth (history + today)"
                        metricsOverride={{
                            headline,
                            todaySnapshot,
                            investableCashBars,
                            sarPerUsd: canonicalSarPerUsd,
                            simulatedPrices: canonicalSimulatedPrices,
                        }}
                            onOpenInvestments={setActivePage ? () => setActivePage('Investments') : undefined}
                            onOpenAccounts={setActivePage ? () => setActivePage('Accounts') : undefined}
                            onOpenAssets={setActivePage ? () => setActivePage('Assets') : undefined}
                            onOpenDataReconciliation={() => {
                                window.location.hash = 'data-reconciliation';
                            }}
                        />
                    </div>
                <div className="section-card flex flex-col min-h-[420px] h-[min(56vh,520px)]">
                    <div className="mb-2 sm:mb-4 space-y-1">
                        <h3 className="section-title !mb-0">Investment allocation &amp; performance</h3>
                        <p className="text-xs text-slate-500 max-w-prose">
                            Position size vs unrealized P&amp;L. Totals match the Investments hub.
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
            
            <div className="mb-4 rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3 text-sm text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span>Liquid wealth, resilience, shock drills, and snapshot attribution moved to <strong>Wealth Analytics</strong> (same canonical numbers).</span>
                {setActivePage && (
                    <button type="button" className="btn-outline text-sm shrink-0" onClick={() => setActivePage('Wealth Analytics')}>
                        Open Wealth Analytics →
                    </button>
                )}
            </div>

            <div className="section-card max-w-full">
                {aiHealthChecked && !isAiAvailable && (
                    <AiProxyUnavailableHint className="mb-4" title="Advisor summary requires the AI proxy" />
                )}
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div className="flex flex-col"><div className="flex items-center space-x-2"><LightBulbIcon className="h-6 w-6 text-yellow-500" /><h2 className="text-xl font-semibold text-dark">Financial Advisor</h2></div><p className="text-xs text-slate-500 mt-0.5">Direct, summarized guidance with a report card</p></div>
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <button type="button" onClick={handleGenerateAnalysis} disabled={isLoading || !aiActionsEnabled} title={!aiActionsEnabled ? 'AI unavailable — configure provider keys' : undefined} className="w-full md:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                            <SparklesIcon className="h-5 w-5 mr-2" />
                            {isLoading ? 'Analyzing...' : (analysis ? 'Refresh Advisor Summary' : 'Generate Advisor Summary')}
                        </button>
                        {analysis && (
                            <>
                                <button type="button" onClick={handleAdvisorEnglish} disabled={analysisLanguage === 'en' || isLoading} className="px-3 py-2 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                    English
                                </button>
                                <button type="button" onClick={handleTranslateAdvisorToArabic} disabled={analysisLanguage === 'ar' || isLoading || !aiActionsEnabled} title={!aiActionsEnabled ? 'Translation needs AI' : undefined} className="px-3 py-2 text-xs rounded border border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-50">
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
