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
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import NetWorthCompositionChart from '../components/charts/NetWorthCompositionChart';
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
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
    const [analysis, setAnalysis] = useState<PersonaAnalysis | null>(null);
    const [analysisEn, setAnalysisEn] = useState<PersonaAnalysis | null>(null);
    const [analysisLanguage, setAnalysisLanguage] = useState<'en' | 'ar'>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

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
    }, [data?.transactions, data?.personalTransactions]);

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
        const html = generateWealthSummaryReportHtml(payload);
        openHtmlForPrint(html);
    }, [reportModel?.wealthSummaryReportPayload]);

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
        if (!Number.isFinite(fm.netWorth)) out.push('Net worth is invalid.');
        if (!Number.isFinite(fm.monthlyIncome)) out.push('Monthly income is invalid.');
        if (!Number.isFinite(fm.monthlyExpenses)) out.push('Monthly expenses are invalid.');
        if (!Number.isFinite(summaryMonthlyKpis.budgetVariance)) out.push('Budget variance could not be computed.');
        if (!Number.isFinite(summaryMonthlyKpis.roi)) out.push('ROI could not be computed.');
        return out;
    }, [reportModel, summaryMonthlyKpis]);

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
            description="Key metrics and AI-generated financial persona with report card and suggestions."
            action={
                setActivePage && (
                    <PageActionsDropdown
                        ariaLabel="Summary quick links"
                        actions={[
                            { value: 'print-wealth-summary', label: 'Print wealth summary', onClick: handlePrintWealthSummary },
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
            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isAdmin ? (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setActivePage?.('Assets')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActivePage?.('Assets'); } }}
                        className="lg:col-span-1 section-card-hover flex flex-col justify-center items-center text-center border-l-4 border-l-primary cursor-pointer"
                        aria-label="View and manage assets"
                    >
                        <div className="w-full flex items-start justify-between gap-2 mb-1">
                            <h2 className="text-lg font-medium text-gray-500 text-left min-w-0 flex-1">My Net Worth</h2>
                            <InfoHint text="Personal wealth only. Items with Owner set (e.g. Father) are excluded from this total." placement="bottom" hintId="summary-personal-wealth" hintPage="Summary" />
                        </div>
                        <p className="text-5xl font-extrabold text-dark my-2">{maskBalance(formatCurrencyString(financialMetricsWithEf.netWorth, { digits: 0 }))}</p>
                        <p className={`${financialMetricsWithEf.netWorthTrend >= 0 ? 'text-success' : 'text-danger'} font-semibold flex flex-wrap items-center justify-center gap-2`}>
                            <span>{financialMetricsWithEf.netWorthTrend >= 0 ? '+' : ''}{financialMetricsWithEf.netWorthTrend.toFixed(1)}% vs implied prior net worth</span>
                            <span className="inline-flex flex-shrink-0">
                                <InfoHint
                                    text="Uses this month’s personal transactions (income vs expenses) vs current net worth—not a stored last-month snapshot. Same personal scope as Dashboard."
                                    placement="bottom"
                                    hintId="summary-nw-trend"
                                    hintPage="Summary"
                                />
                            </span>
                        </p>
                        <p className="text-xs text-slate-500 mt-2">Personal wealth only · Click to manage assets</p>
                        {managedWealthTotal > 0 && (
                            <p className="text-xs text-amber-700 mt-2 font-medium">Wealth under management: {maskBalance(formatCurrencyString(managedWealthTotal, { digits: 0 }))}</p>
                        )}
                    </div>
                ) : (
                    <div className="lg:col-span-1 section-card border-l-4 border-l-amber-400">
                        <h2 className="text-lg font-medium text-gray-700">Net Worth</h2>
                        <p className="text-sm text-slate-600 mt-2">Net worth visibility is restricted to Admin only.</p>
                    </div>
                )}

                <div className="lg:col-span-2 cards-grid grid grid-cols-1 sm:grid-cols-2">
                    <Card title="This Month's Income" value={formatCurrencyString(financialMetricsWithEf.monthlyIncome)} valueColor="text-success" />
                    <Card title="This Month's Expenses" value={formatCurrencyString(financialMetricsWithEf.monthlyExpenses)} valueColor="text-danger" />
                    <Card title="Savings Rate" value={`${(financialMetricsWithEf.savingsRate * 100).toFixed(1)}%`} valueColor="text-success" tooltip="The percentage of your income you are saving." />
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
                <SectionCard title="Summary validation checks" collapsible collapsibleSummary="Data quality and wiring checks" defaultExpanded className="mb-4">
                    <ul className="text-xs text-amber-800 space-y-1">
                        {summaryValidationWarnings.slice(0, 8).map((w, i) => <li key={`sv-${i}`}>- {w}</li>)}
                    </ul>
                </SectionCard>
            )}

            <CollapsibleSection title="Liquid net worth (simplified)" summary={maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))} className="border border-slate-200 bg-slate-50/50">
                <p className="text-2xl font-extrabold text-primary mb-4">{maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>Cash (checking/savings): {maskBalance(formatCurrencyString(liquidNw.liquidCash, { digits: 0 }))}</span>
                    <span>Investments (book): {maskBalance(formatCurrencyString(liquidNw.investmentsSAR, { digits: 0 }))}</span>
                    <span>Commodities: {maskBalance(formatCurrencyString(liquidNw.commodities, { digits: 0 }))}</span>
                    <span>Receivables: {maskBalance(formatCurrencyString(liquidNw.receivables, { digits: 0 }))}</span>
                    <span>Debt: −{maskBalance(formatCurrencyString(liquidNw.shortTermDebt, { digits: 0 }))}</span>
                    <span className="text-slate-500">~30d cashflow est.: {maskBalance(formatCurrencyString(liquidNw.contributionEstimate30d, { digits: 0 }))}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Excludes illiquid physical assets. Investment values in account currency; not FX-normalized to SAR here.</p>
            </CollapsibleSection>

            {isAdmin && (
                <CollapsibleSection title="Net worth change vs flows (local snapshots)" summary="Contribution vs market-style residual" className="border border-violet-100 bg-violet-50/40">
                    {nwSnapshotInsight.attr ? (
                        <>
                            <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                                {nwSnapshotInsight.attr.bullets.map((line, i) => (
                                    <li key={i}>{line}</li>
                                ))}
                            </ul>
                            <p className="text-xs text-slate-500 mt-2">
                                From last two Dashboard visits (admin). Full detail: <button type="button" className="text-primary font-medium" onClick={() => triggerPageAction ? triggerPageAction('Engines & Tools', 'openRiskTradingHub') : setActivePage?.('Engines & Tools')}>Safety &amp; rules →</button>
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-600">
                            Open <strong>Dashboard</strong> twice on different days as admin to record net worth snapshots; then this section shows contribution vs market-style residual.{' '}
                            {nwSnapshotInsight.snaps.length === 1 && (
                                <span className="block mt-1 text-slate-500">One snapshot stored—visit Dashboard again tomorrow.</span>
                            )}
                            {nwSnapshotInsight.snaps.length === 0 && (
                                <span className="block mt-1 text-slate-500">No snapshots yet—load Dashboard once to start.</span>
                            )}
                        </p>
                    )}
                </CollapsibleSection>
            )}
            
            <div className="cards-grid grid grid-cols-1 gap-4">
                {isAdmin ? (
                    <div className="section-card flex flex-col min-h-[420px] h-[min(56vh,520px)]">
                        <NetWorthCompositionChart title="Historical Net Worth" />
                    </div>
                ) : (
                    <div className="section-card flex flex-col min-h-[200px] justify-center">
                        <p className="text-sm text-slate-600 text-center px-6">Historical net worth chart is available for Admin only.</p>
                    </div>
                )}
                <div className="section-card flex flex-col min-h-[420px] h-[min(56vh,520px)]">
                    <h3 className="section-title mb-2 sm:mb-4">Investment Allocation &amp; Performance</h3>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden border border-slate-100">
                        {investmentTreemapData.length > 0 ? (
                            <PerformanceTreemap data={investmentTreemapData} />
                        ) : (
                            <div className="empty-state h-full min-h-[280px] flex items-center justify-center">No investment data available.</div>
                        )}
                    </div>
                </div>
            </div>
            
            {householdStress && (
                <div className="section-card">
                    <h3 className="section-title mb-2">Household Cashflow Stress</h3>
                    <p className="text-sm text-slate-700 mb-1">
                        Current stress level: <span className="font-semibold uppercase">{householdStress.level}</span>
                    </p>
                    <p className="text-xs text-slate-600 mb-2">
                        {householdStress.summary}
                    </p>
                    {householdStress.flags.length > 0 && (
                        <ul className="text-xs text-slate-500 list-disc pl-5 space-y-0.5">
                            {householdStress.flags.slice(0, 3).map(flag => (
                                <li key={flag}>{flag}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="section-card">
                    <h3 className="section-title mb-2">Risk Lane</h3>
                    <p className="text-sm text-slate-700">
                        Current lane: <span className="font-semibold">{riskLane.lane}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                        Suggested profile: <span className="font-semibold">{riskLane.suggestedProfile}</span>
                    </p>
                    <ul className="text-xs text-slate-500 list-disc pl-5 mt-2 space-y-0.5">
                        {(riskLane.reasons ?? []).slice(0, 3).map((r, i) => <li key={r ?? i}>{r}</li>)}
                    </ul>
                </div>
                <div className="section-card">
                    <h3 className="section-title mb-2">Liquidity Runway</h3>
                    {liquidityRunway ? (
                        <>
                            <p className="text-sm text-slate-700">
                                Runway: <span className="font-semibold">{(liquidityRunway.monthsOfRunway ?? 0).toFixed(1)} months</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Portfolio drawdown: <span className="font-semibold">{(liquidityRunway.drawdownPct ?? 0).toFixed(1)}%</span>
                            </p>
                            <p className="text-xs text-slate-600 mt-2">{liquidityRunway.reasons?.[0] ?? '—'}</p>
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">Not enough data.</p>
                    )}
                </div>
                <div className="section-card">
                    <h3 className="section-title mb-2">Discipline Score</h3>
                    <p className="text-sm text-slate-700">
                        Score: <span className="font-semibold">{discipline?.score ?? 0}/100</span> ({discipline?.label ?? '—'})
                    </p>
                    <ul className="text-xs text-slate-500 list-disc pl-5 mt-2 space-y-0.5">
                        {(discipline.reasons ?? []).slice(0, 3).map((r, i) => <li key={r ?? i}>{r}</li>)}
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
