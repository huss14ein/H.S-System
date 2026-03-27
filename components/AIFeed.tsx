import React, { useState, useCallback, useContext, useEffect, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIFeedInsights, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { PiggyBankIcon } from './icons/PiggyBankIcon';
import { TrophyIcon } from './icons/TrophyIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { FeedItem } from '../types';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';

const FEED_AI_LANG_KEY = 'finova_default_ai_lang_v1';

const FeedItemIcon: React.FC<{ type: FeedItem['type'] }> = ({ type }) => {
    const iconClass = "h-6 w-6";
    switch(type) {
        case 'BUDGET': return <ExclamationTriangleIcon className={`${iconClass} text-warning`} />;
        case 'GOAL': return <TrophyIcon className={`${iconClass} text-yellow-500`} />;
        case 'INVESTMENT': return <ArrowTrendingUpIcon className={`${iconClass} text-secondary`} />;
        case 'SAVINGS': return <PiggyBankIcon className={`${iconClass} text-success`} />;
        default: return <LightBulbIcon className={`${iconClass} text-primary`} />;
    }
}

const AIFeed: React.FC = () => {
    const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [displayLang, setDisplayLang] = useState<'en' | 'ar'>(() => {
        try {
            return localStorage.getItem(FEED_AI_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const [arItems, setArItems] = useState<{ title: string; description: string }[] | null>(null);
    const [translating, setTranslating] = useState(false);
    const { data } = useContext(DataContext)!;
    const { isAiAvailable, aiHealthChecked, aiActionsEnabled, refreshAiHealth } = useAI();
    const [aiRecheckBusy, setAiRecheckBusy] = useState(false);
    const dataRef = useRef(data);

    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    useEffect(() => {
        try {
            localStorage.setItem(FEED_AI_LANG_KEY, displayLang);
        } catch {
            /* ignore */
        }
    }, [displayLang]);

    useEffect(() => {
        if (displayLang !== 'ar' || feedItems.length === 0 || !aiActionsEnabled) return;
        if (arItems && arItems.length === feedItems.length) return;
        let cancelled = false;
        (async () => {
            setTranslating(true);
            setError(null);
            try {
                const translated = await Promise.all(
                    feedItems.map(async (item) => ({
                        title: await translateFinancialInsightToArabic(item.title),
                        description: await translateFinancialInsightToArabic(item.description),
                    })),
                );
                if (!cancelled) setArItems(translated);
            } catch (err) {
                console.error('AI Feed translation failed:', err);
                if (!cancelled) {
                    setError(formatAiError(err));
                    setDisplayLang('en');
                }
            } finally {
                if (!cancelled) setTranslating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [displayLang, feedItems, arItems, aiActionsEnabled]);

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setFeedItems([]);
        setArItems(null);
        setError(null);
        try {
            const items = await getAIFeedInsights(dataRef.current);
            setFeedItems(items);
        } catch (err) {
            console.error("AI Feed generation failed:", err);
            setError(formatAiError(err));
        }
        setIsLoading(false);
    }, []);

    const handleLangToggle = useCallback(() => {
        if (feedItems.length === 0) return;
        setDisplayLang((prev) => (prev === 'ar' ? 'en' : 'ar'));
    }, [feedItems.length]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center space-x-2">
                        <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                        <h2 className="text-xl font-semibold text-dark">For You</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">From your expert financial advisor</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isLoading || !aiActionsEnabled}
                  title={!aiActionsEnabled ? 'AI unavailable — check proxy and API keys' : 'Refresh Feed'}
                  className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    <SparklesIcon className="h-5 w-5 mr-2" />
                    {isLoading ? 'Thinking...' : 'Refresh Feed'}
                </button>
                <button
                  type="button"
                  onClick={handleLangToggle}
                  disabled={isLoading || translating || feedItems.length === 0 || !aiActionsEnabled}
                  title={displayLang === 'ar' ? 'Show English' : 'Translate feed to Arabic'}
                  className="w-full sm:w-auto flex items-center justify-center px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                    {translating ? '…' : displayLang === 'ar' ? 'English' : 'العربية'}
                </button>
                </div>
            </div>
            {isLoading && (
                 <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-4 p-3 animate-pulse">
                            <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                            <div className="flex-1 space-y-2">
                                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {translating && feedItems.length > 0 && !isLoading && (
                <p className="text-xs text-slate-500 mb-2" dir="rtl">جاري الترجمة…</p>
            )}
            
            {error && !isLoading && (
                <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-r-lg">
                     <h4 className="font-bold">AI Feed Error</h4>
                     <SafeMarkdownRenderer content={error} />
                </div>
            )}

            {feedItems.length > 0 && !isLoading && !error && (
                 <div className="space-y-2">
                    {feedItems.map((item, index) => {
                        const ar = displayLang === 'ar' && arItems?.[index];
                        return (
                        <div
                            key={index}
                            className={`flex items-start space-x-4 p-3 rounded-lg border-l-4 hover:bg-gray-50/80 ${
                                item.type === 'BUDGET' ? 'border-amber-500 bg-amber-50/30' :
                                item.type === 'GOAL' ? 'border-blue-500 bg-blue-50/30' :
                                item.type === 'INVESTMENT' ? 'border-violet-500 bg-violet-50/30' :
                                item.type === 'SAVINGS' ? 'border-green-500 bg-green-50/30' :
                                'border-primary/50 bg-primary/5'
                            }`}
                            dir={displayLang === 'ar' ? 'rtl' : 'ltr'}
                        >
                            <div className="flex-shrink-0 w-10 h-10 bg-white rounded-full flex items-center justify-center text-xl shadow-sm border border-gray-100">
                                {item.emoji || <FeedItemIcon type={item.type} />}
                            </div>
                            <div>
                                <h4 className="font-semibold text-dark">{ar ? ar.title : item.title}</h4>
                                <p className="text-sm text-gray-600 whitespace-pre-wrap">{ar ? ar.description : item.description}</p>
                            </div>
                        </div>
                    );})}
                </div>
            )}

            {aiHealthChecked && !isAiAvailable ? (
                 <div className="text-center p-4 text-amber-900 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="font-semibold">AI Features Disabled</p>
                    <p className="text-sm mt-1">Configure a provider key on the server and ensure the dev server exposes <code className="text-xs bg-amber-100 px-1 rounded">/api/gemini-proxy</code> (Netlify Vite plugin).</p>
                    <button
                        type="button"
                        disabled={aiRecheckBusy}
                        onClick={() => {
                            setAiRecheckBusy(true);
                            void refreshAiHealth().finally(() => setAiRecheckBusy(false));
                        }}
                        className="mt-3 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-100 text-amber-950 hover:bg-amber-200 disabled:opacity-60"
                    >
                        {aiRecheckBusy ? 'Checking…' : 'Retry connection check'}
                    </button>
                </div>
            ) : (
                feedItems.length === 0 && !isLoading && !error && (
                    <div className="text-center p-4 text-gray-500">
                        Click "Refresh Feed" for personalized AI insights on your finances.
                    </div>
                )
            )}
        </div>
    );
};

export default AIFeed;
