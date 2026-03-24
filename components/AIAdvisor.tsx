import React, { useState, useCallback, useContext, useMemo, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import {
    getAIAnalysis,
    getInvestmentAIAnalysis,
    getAIPlanAnalysis,
    getAIHouseholdEngineAnalysis,
    getAITransactionAnalysis,
    getAIGoalStrategyAnalysis,
    getAIAnalysisPageInsights,
    formatAiError,
    translateFinancialInsightToArabic,
} from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { FinancialData } from '../types';
import { useAI } from '../context/AiContext';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, resolveSarPerUsd, tradableCashBucketToSAR } from '../utils/currencyMath';
import { computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';
import { computeLiquidNetWorth } from '../services/liquidNetWorth';

type AIContext = 'dashboard' | 'investments' | 'plan' | 'summary' | 'cashflow' | 'goals' | 'analysis';

type InsightSectionVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface AIAdvisorProps {
    pageContext: AIContext;
    contextData?: any;
    title?: string;
    subtitle?: string;
    buttonLabel?: string;
}

function inferSectionVariant(title: string): InsightSectionVariant {
    const t = title.toLowerCase();
    if (/risk|debt|caution|warn|concern|issue|problem|weak|loss|threat|declin|downside/.test(t)) return 'warning';
    if (/opportunit|strength|positive|strong|growth|gain|upside|momentum/.test(t)) return 'success';
    if (/summary|overview|snapshot|headline|key|takeaway|bottom line/.test(t)) return 'info';
    return 'neutral';
}

function splitInsightIntoSections(raw: string): { title: string | null; body: string; variant: InsightSectionVariant }[] {
    const text = (raw || '').trim();
    if (!text) return [];
    const parts = text
        .split(/\n(?=###\s)/)
        .map((p) => p.trim())
        .filter(Boolean);
    return parts.map((part) => {
        const m = part.match(/^###\s+(.+?)(?:\n([\s\S]*))?$/);
        if (m) {
            const secTitle = m[1].trim();
            const body = (m[2] ?? '').trim();
            return { title: secTitle, body, variant: inferSectionVariant(secTitle) };
        }
        return { title: null, body: part, variant: 'neutral' as const };
    });
}

function isLikelyErrorInsight(text: string): boolean {
    return /AI Service Error|AI not configured|not configured|temporarily unavailable|usage limit|timed out/i.test(text);
}

const sectionShell: Record<InsightSectionVariant, string> = {
    info: 'border-l-sky-500 bg-sky-50/90 text-slate-800',
    success: 'border-l-emerald-500 bg-emerald-50/90 text-slate-800',
    warning: 'border-l-amber-500 bg-amber-50/90 text-slate-900',
    danger: 'border-l-rose-500 bg-rose-50/90 text-rose-950',
    neutral: 'border-l-slate-400 bg-slate-50/90 text-slate-800',
};

const sectionLabel: Record<InsightSectionVariant, string> = {
    info: 'Insight',
    success: 'Positive signal',
    warning: 'Watch',
    danger: 'Alert',
    neutral: 'Note',
};

function renderBodyAsBlocks(body: string): React.ReactNode {
    const lines = body.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return null;
    const bullets: string[] = [];
    const paragraphs: string[] = [];
    for (const line of lines) {
        const t = line.trim();
        const bullet = /^[-*]\s+(.+)$/.exec(t);
        if (bullet) bullets.push(bullet[1]);
        else paragraphs.push(t);
    }
    return (
        <div className="space-y-2 text-sm leading-relaxed">
            {paragraphs.map((p, i) => (
                <p key={`p-${i}`} className="whitespace-pre-wrap">
                    {stripSimpleMarkdownBold(p)}
                </p>
            ))}
            {bullets.length > 0 && (
                <ul className="list-disc ps-5 space-y-1.5 marker:text-slate-400">
                    {bullets.map((b, i) => (
                        <li key={`b-${i}`} className="whitespace-pre-wrap">
                            {stripSimpleMarkdownBold(b)}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function stripSimpleMarkdownBold(s: string): React.ReactNode {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(part);
        if (m) return <strong key={i} className="font-semibold text-slate-900">{m[1]}</strong>;
        return <span key={i}>{part}</span>;
    });
}

// This is a simplified router for demonstration. A real app might have more complex logic.
const getAnalysisForPage = (
    context: AIContext,
    data: FinancialData,
    contextData: any,
    sarPerUsd: number,
    getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number }
): Promise<string> => {
    const nwOpts = { getAvailableCashForAccount };
    switch (context) {
        case 'dashboard': {
            const { netWorth, totalDebt } = computePersonalNetWorthBreakdownSAR(data, sarPerUsd, nwOpts);
            const { liquidNetWorth } = computeLiquidNetWorth(data, { getAvailableCashForAccount, exchangeRate: sarPerUsd });
            const d = data as any;
            const accounts = d?.personalAccounts ?? data?.accounts ?? [];
            const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));
            const investments = d?.personalInvestments ?? data?.investments ?? [];
            let totalInvestmentsValue = getAllInvestmentsValueInSAR(investments, sarPerUsd);
            accounts.forEach((acc: { id: string; type?: string }) => {
                if (acc.type === 'Investment') {
                    totalInvestmentsValue += tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd);
                }
            });
            const invTx = (data?.investmentTransactions ?? []).filter((t: { accountId?: string }) => personalAccountIds.has(t.accountId ?? ''));
            const totalInvested = invTx.filter((t: { type?: string }) => t.type === 'buy').reduce((sum: number, t: { total?: number }) => sum + (t.total ?? 0), 0);
            const totalWithdrawn = Math.abs(invTx.filter((t: { type?: string }) => t.type === 'sell').reduce((sum: number, t: { total?: number }) => sum + (t.total ?? 0), 0));
            const netCapital = totalInvested - totalWithdrawn;
            const totalGainLoss = totalInvestmentsValue - netCapital;
            const roi = netCapital > 0 ? (totalGainLoss / netCapital) : 0;
            const summary = { netWorth, roi, assetMix: [], liquidNetWorth, liabilitiesCoverage: totalDebt, monthlyIncome: 0, monthlyExpenses: 0, monthlyPnL: 0, budgetVariance: 0 };
            return getAIAnalysis(summary);
        }
        case 'investments':
            return getInvestmentAIAnalysis(((data as any)?.personalInvestments ?? data?.investments ?? []).flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []));
        case 'plan':
             if (contextData?.householdEngine) {
                return getAIHouseholdEngineAnalysis(contextData.householdEngine, contextData?.scenarios);
             }
             if (contextData?.totals && contextData?.scenarios) {
                return getAIPlanAnalysis(contextData.totals, contextData.scenarios);
             }
             return Promise.resolve("Not enough data for plan analysis.");
        case 'cashflow':
            if (contextData?.transactions && contextData?.budgets) {
                return getAITransactionAnalysis(contextData.transactions, contextData.budgets);
            }
            return Promise.resolve("Not enough data for cashflow analysis.");
        case 'goals':
            if (contextData?.goals && typeof contextData?.monthlySavings !== 'undefined') {
                return getAIGoalStrategyAnalysis(contextData.goals, contextData.monthlySavings, data);
            }
            return Promise.resolve("Not enough data for goal strategy analysis.");
        case 'analysis':
            if (contextData?.spendingData && contextData?.trendData && contextData?.compositionData) {
                return getAIAnalysisPageInsights(contextData.spendingData, contextData.trendData, contextData.compositionData);
            }
            return Promise.resolve("Not enough data for a full analysis.");
        default:
            return Promise.resolve("AI analysis for this section is not configured yet.");
    }
};


const AIAdvisor: React.FC<AIAdvisorProps> = ({ pageContext, contextData, title = 'Financial Advisor', subtitle = 'Expert financial & investment insights', buttonLabel = 'Get AI Insights' }) => {
    const [insightEn, setInsightEn] = useState<string>('');
    const [insightAr, setInsightAr] = useState<string | null>(null);
    const [displayLang, setDisplayLang] = useState<'en' | 'ar'>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translateError, setTranslateError] = useState<string | null>(null);
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { isAiAvailable } = useAI();

    const insightSource = useMemo(() => {
        const text = (insightEn || '').toLowerCase();
        if (!insightEn) return null;
        if (text.includes('deterministic') || text.includes('fallback') || text.includes('provider unavailable')) return 'Deterministic fallback';
        return 'AI provider';
    }, [insightEn]);

    const activeText = displayLang === 'ar' ? (insightAr ?? insightEn) : insightEn;

    const sections = useMemo(() => {
        if (!activeText) return [];
        const base = splitInsightIntoSections(activeText);
        if (isLikelyErrorInsight(activeText)) {
            return [{ title: 'Something went wrong', body: activeText, variant: 'danger' as const }];
        }
        return base.map((s) =>
            s.title ? s : { ...s, title: 'Summary', variant: s.variant === 'neutral' ? ('info' as const) : s.variant }
        );
    }, [activeText]);

    useEffect(() => {
        if (displayLang !== 'ar' || !insightEn || insightAr != null || !isAiAvailable) return;
        let cancelled = false;
        (async () => {
            setIsTranslating(true);
            setTranslateError(null);
            try {
                const ar = await translateFinancialInsightToArabic(insightEn);
                if (!cancelled) setInsightAr(ar);
            } catch (e) {
                if (!cancelled) setTranslateError(formatAiError(e));
            } finally {
                if (!cancelled) setIsTranslating(false);
            }
        })();
        return () => { cancelled = true; };
    }, [displayLang, insightEn, insightAr, isAiAvailable]);

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setInsightEn('');
        setInsightAr(null);
        setTranslateError(null);
        setDisplayLang('en');
        try {
            const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
            const result = await getAnalysisForPage(pageContext, data, contextData, sarPerUsd, getAvailableCashForAccount);
            setInsightEn(result);
        } catch (error) {
            console.error("AI analysis failed:", error);
            setInsightEn(formatAiError(error));
        }
        setIsLoading(false);
    }, [pageContext, data, contextData, exchangeRate, getAvailableCashForAccount]);

    const handleLangChange = (lang: 'en' | 'ar') => {
        setDisplayLang(lang);
        if (lang === 'ar') setTranslateError(null);
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md border border-slate-100">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                        <LightBulbIcon className="h-6 w-6 text-amber-500 shrink-0" />
                        <h2 className="text-xl font-semibold text-dark">{title}</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:items-center">
                    {insightEn && !isLoading && (
                        <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50" role="group" aria-label="Response language">
                            <button
                                type="button"
                                onClick={() => handleLangChange('en')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${displayLang === 'en' ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                            >
                                English
                            </button>
                            <button
                                type="button"
                                onClick={() => handleLangChange('ar')}
                                disabled={!isAiAvailable}
                                title={!isAiAvailable ? 'Configure AI to enable Arabic translation' : 'عرض بالعربية'}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${displayLang === 'ar' ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-900'} disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                العربية
                            </button>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={!isAiAvailable || isLoading}
                        title={!isAiAvailable ? "AI features are disabled. Please configure your API key." : "Get AI Insights"}
                        className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                    >
                        <SparklesIcon className="h-5 w-5 mr-2 shrink-0" />
                        {isLoading ? 'Analyzing...' : buttonLabel}
                    </button>
                </div>
            </div>

            {isLoading && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 flex items-center gap-3 text-sky-900 text-sm" role="status">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500 animate-pulse shrink-0" aria-hidden />
                    Generating personalized insights…
                </div>
            )}

            {insightEn && !isLoading && (
                <div className="space-y-3 mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {insightSource && (
                            <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium border ${insightSource === 'AI provider' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                                {insightSource === 'AI provider' ? '● Live model' : '● Rule-based fallback'}
                            </span>
                        )}
                        {displayLang === 'ar' && (
                            <span className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-violet-50 text-violet-800 border border-violet-200">
                                العربية — ترجمة تلقائية
                            </span>
                        )}
                    </div>

                    {displayLang === 'ar' && isTranslating && (
                        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 flex items-center gap-2" role="status">
                            <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                            جاري الترجمة…
                        </div>
                    )}
                    {displayLang === 'ar' && translateError && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
                            {translateError}
                        </div>
                    )}

                    <div className={`space-y-3 ${displayLang === 'ar' ? 'font-sans' : ''}`} dir={displayLang === 'ar' ? 'rtl' : 'ltr'} lang={displayLang === 'ar' ? 'ar' : 'en'}>
                        {sections.map((sec, idx) => {
                            const shell = sectionShell[isLikelyErrorInsight(activeText) ? 'danger' : sec.variant];
                            const label = sectionLabel[isLikelyErrorInsight(activeText) ? 'danger' : sec.variant];
                            return (
                                <div
                                    key={`${sec.title}-${idx}`}
                                    className={`rounded-r-lg rounded-l-md border border-slate-100 border-l-4 pl-4 pr-3 py-3 shadow-sm ${shell}`}
                                >
                                    {sec.title && (
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                                            <h3 className="text-sm font-bold text-slate-900">{sec.title}</h3>
                                        </div>
                                    )}
                                    {renderBodyAsBlocks(sec.body)}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {!isAiAvailable ? (
                 <div className="text-center p-4 text-slate-600 bg-amber-50/80 border border-amber-200 rounded-lg mt-2" role="alert">
                    <p className="font-semibold text-amber-950">AI غير مفعّل / AI disabled</p>
                    <p className="text-sm mt-1">Set your Gemini (or other) API key in environment variables to enable insights and Arabic translation.</p>
                </div>
            ) : (
                !insightEn && !isLoading && (
                    <div className="text-center p-4 text-slate-500 border border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-sm">
                        اضغط للحصول على تحليل بيانات {pageContext} / Click &quot;{buttonLabel}&quot; for an analysis of your {pageContext} data.
                    </div>
                )
            )}
        </div>
    );
};

export default AIAdvisor;
