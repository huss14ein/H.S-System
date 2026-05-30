import React, { useCallback, useContext, useMemo, useState } from 'react';
import { DataContext } from '../../context/DataContext';
import { useAI } from '../../context/AiContext';
import { useCanonicalFinancialMetrics } from '../../hooks/useCanonicalFinancialMetrics';
import { buildAiPersonalWealthGrounding } from '../../services/aiPersonalWealthGrounding';
import {
  buildMultiSymbolMarketGrounding,
  parseMultiStockSymbols,
  SAMPLE_MULTI_STOCK_SYMBOLS,
} from '../../services/multiSymbolMarketGrounding';
import { getAIMultiStockAnalysis, formatAiError, type MultiStockAnalysisLang } from '../../services/geminiService';
import { SparklesIcon } from '../icons/SparklesIcon';
import SafeMarkdownRenderer from '../SafeMarkdownRenderer';
import { ExclamationTriangleIcon } from '../icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../icons/CheckCircleIcon';

const MULTI_STOCK_LANG_KEY = 'finova_multi_stock_ai_lang_v1';

export const MultiStockAnalysisPanel: React.FC<{
  /** Pre-fill tickers (e.g. from watchlist). */
  initialSymbols?: string[];
  compact?: boolean;
}> = ({ initialSymbols, compact = false }) => {
  const { data, getAvailableCashForAccount } = useContext(DataContext)!;
  const { isAiAvailable, aiHealthChecked, aiActionsEnabled } = useAI();
  const { simulatedPrices, sarPerUsd } = useCanonicalFinancialMetrics();

  const defaultTickers = useMemo(() => {
    if (initialSymbols?.length) return initialSymbols.join(', ');
    const wl = (data?.watchlist ?? []).map((w) => w.symbol).filter(Boolean).slice(0, 12);
    return wl.length ? wl.join(', ') : SAMPLE_MULTI_STOCK_SYMBOLS.join(', ');
  }, [initialSymbols, data?.watchlist]);

  const [tickersRaw, setTickersRaw] = useState(defaultTickers);
  const [lang, setLang] = useState<MultiStockAnalysisLang>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(MULTI_STOCK_LANG_KEY) === 'en'
        ? 'en'
        : 'ar';
    } catch {
      return 'ar';
    }
  });
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groundedCount, setGroundedCount] = useState<number | null>(null);

  const parsedCount = useMemo(() => parseMultiStockSymbols(tickersRaw).length, [tickersRaw]);

  const handleLoadSample = useCallback(() => {
    setTickersRaw(SAMPLE_MULTI_STOCK_SYMBOLS.join(', '));
  }, []);

  const handleAnalyze = useCallback(
    async (targetLang: MultiStockAnalysisLang) => {
      const symbols = parseMultiStockSymbols(tickersRaw);
      if (!symbols.length) {
        setError('Enter at least one ticker symbol.');
        return;
      }
      setLang(targetLang);
      try {
        localStorage.setItem(MULTI_STOCK_LANG_KEY, targetLang);
      } catch {
        /* ignore */
      }
      setLoading(true);
      setError(null);
      setContent('');
      try {
        const grounding = await buildMultiSymbolMarketGrounding({
          symbols,
          simulatedPrices,
          watchlistItems: data?.watchlist,
        });
        setGroundedCount(grounding.rows.filter((r) => r.price != null).length);
        const wealthGrounding = buildAiPersonalWealthGrounding({
          data,
          exchangeRate: sarPerUsd,
          getAvailableCashForAccount,
          simulatedPrices,
        });
        const { content: analysis } = await getAIMultiStockAnalysis(symbols, {
          lang: targetLang,
          grounding,
          wealthGrounding,
        });
        setContent(analysis);
      } catch (e) {
        setError(formatAiError(e));
      } finally {
        setLoading(false);
      }
    },
    [tickersRaw, simulatedPrices, data, sarPerUsd, getAvailableCashForAccount],
  );

  return (
    <div
      className={`rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/60 via-white to-indigo-50/40 ${
        compact ? 'p-4' : 'section-card p-5'
      }`}
      aria-label="Multi-stock AI analysis"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
        <div>
          <h3 className={`font-semibold text-slate-900 flex items-center gap-2 ${compact ? 'text-sm' : 'section-title !mb-1'}`}>
            <SparklesIcon className="h-5 w-5 text-violet-600" />
            Multi-stock analysis
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Grounded quotes + 52-week range · comparison table · Arabic or English
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {!aiHealthChecked ? (
            <span className="text-slate-500">Checking AI…</span>
          ) : isAiAvailable ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full font-medium">
              <CheckCircleIcon className="h-3.5 w-3.5" /> AI ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-2 py-1 rounded-full font-medium">
              <ExclamationTriangleIcon className="h-3.5 w-3.5" /> Fallback mode
            </span>
          )}
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="multi-stock-tickers">
        Tickers ({parsedCount}/25)
      </label>
      <textarea
        id="multi-stock-tickers"
        value={tickersRaw}
        onChange={(e) => setTickersRaw(e.target.value)}
        rows={compact ? 3 : 4}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
        placeholder="NKE, PLTR, 2222.SR …"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={handleLoadSample} className="text-xs font-medium text-violet-700 hover:underline">
          Load sample list (19 US names)
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleAnalyze('ar')}
          disabled={loading || !parsedCount || !aiActionsEnabled}
          className="btn-primary bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-sm"
        >
          {loading && lang === 'ar' ? 'جاري التحليل…' : 'Analyze (العربية)'}
        </button>
        <button
          type="button"
          onClick={() => void handleAnalyze('en')}
          disabled={loading || !parsedCount || !aiActionsEnabled}
          className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading && lang === 'en' ? 'Analyzing…' : 'Analyze (English)'}
        </button>
      </div>

      {groundedCount != null && !loading && (
        <p className="mt-2 text-[11px] text-slate-500">
          Grounded live prices for {groundedCount} of {parsedCount} symbol(s) from Finova quotes / Finnhub.
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <SafeMarkdownRenderer content={error} />
        </div>
      )}

      {loading && (
        <p className="mt-4 text-sm text-center text-slate-500 py-4">
          {lang === 'ar' ? 'جاري جمع الأسعار والتحليل…' : 'Fetching quotes and running analysis…'}
        </p>
      )}

      {!loading && content && (
        <div
          className="mt-4 prose prose-sm max-w-none rounded-lg border border-violet-100 bg-white/80 p-4 max-h-[520px] overflow-y-auto"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          <SafeMarkdownRenderer content={content} />
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-500">
        Educational only — not financial advice. Analyst targets require cited sources; never invented by Finova.
      </p>
    </div>
  );
};

export default MultiStockAnalysisPanel;
