import React, { useCallback, useContext, useState } from 'react';
import { DataContext } from '../../context/DataContext';
import { useCanonicalSimulatedPrices, useCanonicalSpotFx } from '../../hooks/useCanonicalFinancialMetrics';
import { useAI } from '../../context/AiContext';
import { useSelfLearning } from '../../context/SelfLearningContext';
import { getAIExecutiveSummary, formatAiError, translateFinancialInsightToArabic } from '../../services/geminiService';
import {
    buildRuleBasedActionCards,
    splitInsightAndActionCards,
    type AiActionCard,
} from '../../services/aiActionCards';
import { buildAiPersonalWealthGrounding } from '../../services/aiPersonalWealthGrounding';
import AiActionCardsPanel from '../AiActionCardsPanel';
import { SparklesIcon } from '../icons/SparklesIcon';
import { ArrowPathIcon } from '../icons/ArrowPathIcon';
import AiProxyUnavailableHint from '../AiProxyUnavailableHint';
import SafeMarkdownRenderer from '../SafeMarkdownRenderer';

const AI_SUMMARY_LANG_KEY = 'finova_wealth_analytics_ai_summary_lang_v1';

function rulesMarkdownFromCards(cards: AiActionCard[]): string {
    if (!cards.length) {
        return '### Recommendations\nNo rule-based recommendations right now. Refresh after updating cash, budgets, or holdings.';
    }
    return [
        '### Overall Financial Health',
        'Rules-based summary from your live Dashboard KPIs (AI provider off or unavailable).',
        '',
        ...cards.map((c) => `### ${c.title}\n${c.rationale}`),
    ].join('\n');
}

/** On-demand executive summary (Wealth Analytics — kept off Dashboard for performance). */
export const AIExecutiveSummary: React.FC = () => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const sarPerUsd = useCanonicalSpotFx();
    const simulatedPrices = useCanonicalSimulatedPrices();
    const { isAiAvailable, aiHealthChecked, aiActionsEnabled } = useAI();
    const { trackAction } = useSelfLearning();
    const [summary, setSummary] = useState('');
    const [summaryEn, setSummaryEn] = useState('');
    const [actionCards, setActionCards] = useState<AiActionCard[]>([]);
    const [isRulesBased, setIsRulesBased] = useState(false);
    const [summaryLanguage, setSummaryLanguage] = useState<'en' | 'ar'>(() => {
        try {
            const stored = localStorage.getItem(AI_SUMMARY_LANG_KEY);
            return stored === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyRulesSummary = useCallback(() => {
        if (!data) return;
        try {
            const wealth = buildAiPersonalWealthGrounding({
                data,
                exchangeRate: sarPerUsd,
                getAvailableCashForAccount,
                simulatedPrices,
            });
            const cards = buildRuleBasedActionCards(wealth, data, 'summary');
            const md = rulesMarkdownFromCards(cards);
            setSummaryEn(md);
            setSummary(md);
            setActionCards(cards);
            setIsRulesBased(true);
            setSummaryLanguage('en');
            setError(null);
        } catch (err) {
            setError(formatAiError(err));
            setActionCards([]);
            setIsRulesBased(true);
        }
    }, [data, sarPerUsd, getAvailableCashForAccount, simulatedPrices]);

    const handleGenerate = useCallback(async () => {
        if (!data) return;
        trackAction('generate-ai-summary', 'Wealth Analytics');
        setIsLoading(true);
        setError(null);
        setSummary('');
        setSummaryEn('');
        setActionCards([]);
        setIsRulesBased(false);

        if (!aiActionsEnabled) {
            applyRulesSummary();
            setIsLoading(false);
            return;
        }

        try {
            const result = await getAIExecutiveSummary(data, {
                exchangeRate: sarPerUsd,
                getAvailableCashForAccount,
                simulatedPrices,
                page: 'summary',
            });
            const split = splitInsightAndActionCards(result ?? '');
            let cards = split.actionCards;
            if (!cards.length) {
                try {
                    const wealth = buildAiPersonalWealthGrounding({
                        data,
                        exchangeRate: sarPerUsd,
                        getAvailableCashForAccount,
                        simulatedPrices,
                    });
                    cards = buildRuleBasedActionCards(wealth, data, 'summary');
                } catch {
                    /* keep empty */
                }
            }
            const normalized = split.markdown || result || '';
            setSummaryEn(normalized);
            setActionCards(cards);
            setIsRulesBased(cards.every((c) => c.rulesBased) && cards.length > 0);
            if (summaryLanguage === 'ar') {
                const translated = await translateFinancialInsightToArabic(normalized);
                setSummary(translated ?? normalized);
                setSummaryLanguage('ar');
            } else {
                setSummary(normalized);
                setSummaryLanguage('en');
            }
        } catch (err) {
            applyRulesSummary();
        }
        setIsLoading(false);
    }, [
        data,
        sarPerUsd,
        getAvailableCashForAccount,
        simulatedPrices,
        trackAction,
        summaryLanguage,
        aiActionsEnabled,
        applyRulesSummary,
    ]);

    const handleTranslateToArabic = useCallback(async () => {
        if (!summaryEn.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const translated = await translateFinancialInsightToArabic(summaryEn);
            setSummary(translated ?? summaryEn);
            setSummaryLanguage('ar');
            try {
                localStorage.setItem(AI_SUMMARY_LANG_KEY, 'ar');
            } catch {}
        } catch (err) {
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, [summaryEn]);

    const handleShowEnglish = useCallback(() => {
        if (!summaryEn.trim()) return;
        setSummary(summaryEn);
        setSummaryLanguage('en');
        try {
            localStorage.setItem(AI_SUMMARY_LANG_KEY, 'en');
        } catch {}
    }, [summaryEn]);

    return (
        <div className="section-card border-t-4 border-secondary">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center space-x-3">
                        <SparklesIcon className="h-7 w-7 text-secondary" />
                        <h2 className="text-xl font-semibold text-dark">Executive summary</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 ml-10">
                        Uses the same net worth and cashflow numbers as Dashboard and Summary (canonical KPI path).
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isLoading}
                    title={
                        !aiActionsEnabled
                            ? 'AI off — Generate still shows rules-based summary and action cards'
                            : undefined
                    }
                    className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-slate-400 transition-colors"
                >
                    <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading
                        ? 'Summarizing…'
                        : summary
                          ? isRulesBased || !aiActionsEnabled
                            ? 'Refresh (rules-based)'
                            : 'Refresh summary'
                          : !aiActionsEnabled
                            ? 'Generate (rules-based)'
                            : 'Generate summary'}
                </button>
            </div>

            {isLoading && <p className="text-center p-6 text-slate-500">Analyzing your financial picture…</p>}

            {!isLoading && error && !summary && (
                <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-r-lg">
                    <h4 className="font-bold">Summary error</h4>
                    <SafeMarkdownRenderer content={error} />
                    <button type="button" onClick={handleGenerate} className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 text-red-800 rounded-lg">
                        Retry
                    </button>
                </div>
            )}

            {aiHealthChecked && !isAiAvailable && (
                <AiProxyUnavailableHint className="mb-4" title="AI summary is off — rules-based Generate still works" />
            )}

            {!summary && !isLoading && !error && (
                <p className="text-center p-6 text-slate-500 text-sm">
                    Generate a high-level overview grounded in your live balance sheet and KPIs.
                </p>
            )}

            {summary && !isLoading && (
                <div className="bg-violet-50/50 p-4 rounded-lg">
                    {isRulesBased && (
                        <span className="inline-flex mb-3 text-[11px] px-2.5 py-1 rounded-full font-medium border bg-amber-50 border-amber-200 text-amber-900">
                            ● Rules-based summary
                        </span>
                    )}
                    <div className="mb-3 flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={handleShowEnglish}
                            disabled={summaryLanguage === 'en' || !summaryEn.trim()}
                            className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white disabled:opacity-50"
                        >
                            English
                        </button>
                        <button
                            type="button"
                            onClick={handleTranslateToArabic}
                            disabled={summaryLanguage === 'ar' || !summaryEn.trim() || isLoading || !aiActionsEnabled}
                            className="px-2.5 py-1 text-xs rounded border border-violet-300 bg-violet-100 text-violet-800 disabled:opacity-50"
                        >
                            Translate to Arabic
                        </button>
                    </div>
                    <SafeMarkdownRenderer content={summary} />
                    <AiActionCardsPanel
                        cards={actionCards}
                        title={isRulesBased ? 'Rules-based recommendations' : 'Recommendations'}
                    />
                </div>
            )}
        </div>
    );
};
