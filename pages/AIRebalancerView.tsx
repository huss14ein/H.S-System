import React, { useState, useMemo, useCallback, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIRebalancingPlan, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import InfoHint from '../components/InfoHint';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { getTargetAllocationForProfile, meanVarianceOptimization } from '../services/portfolioConstruction';
import type { Holding, Page } from '../types';
import { useSelfLearning } from '../context/SelfLearningContext';
import { useMarketData } from '../context/MarketDataContext';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { getPersonalInvestments } from '../utils/wealthScope';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

const AI_REBALANCER_LANG_KEY = 'finova_ai_rebalancer_lang_v1';
const LEGACY_AI_LANG_KEY = 'finova_default_ai_lang_v1';

interface AIRebalancerViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
  setActivePage?: (page: Page) => void;
}

const AIRebalancerView: React.FC<AIRebalancerViewProps> = ({ onNavigateToTab, onOpenWealthUltra, setActivePage: _setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const { isAiAvailable } = useAI();
  const { trackAction } = useSelfLearning();
  const { simulatedPrices } = useMarketData();
  const { exchangeRate } = useCurrency();
  const { formatCurrencyString } = useFormatCurrency();
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('');
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [rebalancingPlan, setRebalancingPlan] = useState<string>('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [rebalDisplayLang, setRebalDisplayLang] = useState<'en' | 'ar'>(() => {
    try {
      if (typeof localStorage === 'undefined') return 'en';
      const v = localStorage.getItem(AI_REBALANCER_LANG_KEY) ?? localStorage.getItem(LEGACY_AI_LANG_KEY);
      return v === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const [rebalAr, setRebalAr] = useState<string | null>(null);
  const [rebalTranslateError, setRebalTranslateError] = useState<string | null>(null);
  const [isTranslatingRebal, setIsTranslatingRebal] = useState(false);

  const portfolios = useMemo(() => getPersonalInvestments(data), [data]);
  const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

  useEffect(() => {
    const r = data?.settings?.riskProfile;
    if (r === 'Conservative' || r === 'Moderate' || r === 'Aggressive') {
      setRiskProfile(r);
    }
  }, [data?.settings?.riskProfile]);

  useEffect(() => {
    if (!portfolios.length) return;
    const valid = portfolios.some((p: { id: string }) => p.id === selectedPortfolioId);
    if (!selectedPortfolioId || !valid) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [portfolios, selectedPortfolioId]);

  const selectedPortfolio = useMemo(() => {
    return portfolios.find((p: { id: string }) => p.id === selectedPortfolioId) ?? portfolios[0];
  }, [selectedPortfolioId, portfolios]);

  const portfolioBookCurrency = useMemo(
    () => (selectedPortfolio ? resolveInvestmentPortfolioCurrency(selectedPortfolio) : 'SAR'),
    [selectedPortfolio],
  );

  const currentAllocation = useMemo(() => {
    if (!selectedPortfolio?.holdings?.length) return [];
    const book = resolveInvestmentPortfolioCurrency(selectedPortfolio);
    return (selectedPortfolio.holdings ?? [])
      .map((h: Holding) => {
        const v = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
        return { name: h.symbol ?? '', value: v };
      })
      .filter((row: { name: string; value: number }) => Number.isFinite(row.value) && row.value > 0);
  }, [selectedPortfolio, simulatedPrices, sarPerUsd]);

  const totalPortfolioValueBook = useMemo(
    () => currentAllocation.reduce((s: number, r: { name: string; value: number }) => s + r.value, 0),
    [currentAllocation],
  );

  const canGeneratePlan = Boolean(
    selectedPortfolio && currentAllocation.length > 0 && totalPortfolioValueBook > 0 && !isLoading,
  );

  const handleGeneratePlan = useCallback(async () => {
    trackAction('generate-plan', 'AI Rebalancer');
    if (!selectedPortfolio?.holdings?.length || totalPortfolioValueBook <= 0) {
      return;
    }
    setIsLoading(true);
    setRebalancingPlan('');
    setPlanError(null);
    setRebalAr(null);
    setRebalTranslateError(null);
    try {
      const plan = await getAIRebalancingPlan(selectedPortfolio.holdings ?? [], riskProfile, {
        bookCurrency: portfolioBookCurrency,
        sarPerUsd,
        portfolioName: selectedPortfolio.name,
        simulatedPrices,
      });
      if (!plan || plan.trim().length === 0) {
        setPlanError('AI returned an empty plan. Please try again.');
      } else {
        setRebalancingPlan(plan);
      }
    } catch (err) {
      setPlanError(formatAiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPortfolio, riskProfile, trackAction, portfolioBookCurrency, sarPerUsd, simulatedPrices, totalPortfolioValueBook]);

  const runArabicTranslation = useCallback(async () => {
    if (!rebalancingPlan.trim()) return;
    setIsTranslatingRebal(true);
    setRebalTranslateError(null);
    try {
      const ar = await translateFinancialInsightToArabic(rebalancingPlan);
      setRebalAr(ar || null);
    } catch (e) {
      setRebalTranslateError(formatAiError(e));
    } finally {
      setIsTranslatingRebal(false);
    }
  }, [rebalancingPlan]);

  useEffect(() => {
    if (rebalDisplayLang !== 'ar' || !rebalancingPlan.trim() || rebalAr != null) return;
    let cancelled = false;
    (async () => {
      setIsTranslatingRebal(true);
      setRebalTranslateError(null);
      try {
        const ar = await translateFinancialInsightToArabic(rebalancingPlan);
        if (!cancelled) setRebalAr(ar);
      } catch (e) {
        if (!cancelled) setRebalTranslateError(formatAiError(e));
      } finally {
        if (!cancelled) setIsTranslatingRebal(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rebalDisplayLang, rebalancingPlan, rebalAr]);

  const targetAssetMix = useMemo(() => getTargetAllocationForProfile(riskProfile), [riskProfile]);

  const mvoResult = useMemo(() => {
    if (!selectedPortfolio?.holdings?.length) return null;
    const book = resolveInvestmentPortfolioCurrency(selectedPortfolio);
    const withVal = (selectedPortfolio.holdings ?? [])
      .map((h: Holding) => ({
        h,
        v: effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd),
      }))
      .filter((x: { h: Holding; v: number }) => x.v > 0);
    if (withVal.length < 2) return null;
    const holdings = withVal.map((x: { h: Holding; v: number }) => x.h);
    const total = withVal.reduce((s: number, x: { h: Holding; v: number }) => s + x.v, 0);
    if (total <= 0) return null;
    const expectedReturns = holdings.map(() => 0.07 / 12);
    const n = holdings.length;
    const cov = Array(n)
      .fill(0)
      .map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) cov[i][i] = 0.04 / 12;
    const res = meanVarianceOptimization({ expectedReturns, covarianceMatrix: cov, riskFreeRate: 0.04 / 12 });
    const labels = holdings.map((h: Holding) => h.symbol ?? '');
    return { ...res, labels };
  }, [selectedPortfolio, simulatedPrices, sarPerUsd]);

  if (loading || !data) {
    return (
      <div className="page-container flex items-center justify-center min-h-[24rem]" aria-busy="true">
        <div className="text-center">
          <div
            className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"
            aria-label="Loading AI Rebalancer"
          />
          <p className="text-sm text-slate-600">Loading portfolio data…</p>
        </div>
      </div>
    );
  }

  if (!portfolios.length) {
    return (
      <div className="page-container space-y-6">
        <section className="section-card p-6 sm:p-8 text-center">
          <h2 className="page-title text-xl sm:text-2xl">AI Portfolio Rebalancer</h2>
          <p className="text-slate-600 mt-2">You don&apos;t have any investment portfolios to analyze.</p>
          <p className="text-sm text-slate-500 mt-1">
            Add a platform and portfolio under <strong>Portfolios</strong>, then return here.
          </p>
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('Portfolios')}
              className="mt-4 btn-primary"
            >
              Go to Portfolios
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="page-container space-y-6">
      <div className="section-card p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 shrink-0 bg-primary/10 rounded-xl flex items-center justify-center">
              <ScaleIcon className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="page-title text-2xl sm:text-3xl">AI Portfolio Rebalancer</h2>
              <p className="text-slate-600 mt-1 max-w-3xl">
                Compare your current weights to a risk style and get educational notes. Numbers match this portfolio&apos;s book
                currency and the same prices as <strong>Portfolios</strong>. Not personalized advice.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                isAiAvailable ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}
            >
              {isAiAvailable ? 'AI enabled' : 'Rule-based fallback if AI unavailable'}
            </span>
            {onOpenWealthUltra && (
              <button type="button" onClick={onOpenWealthUltra} className="btn-ghost text-sm">
                Wealth Ultra
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-100">
          Risk profile defaults from Settings when possible; you can override below. Generated text is grounded to the totals and
          weights on this screen.
        </p>
      </div>

      <div className="cards-grid grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="section-card">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Portfolios</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{portfolios.length}</p>
          <p className="text-sm text-slate-600 mt-1">In your personal scope</p>
        </div>
        <div className="section-card">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Priced positions</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{currentAllocation.length}</p>
          <p className="text-sm text-slate-600 mt-1">In selected portfolio</p>
        </div>
        <div className="section-card">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Book currency</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{portfolioBookCurrency}</p>
          <p className="text-sm text-slate-600 mt-1">Used for totals and AI</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="section-card p-6 sm:p-8">
            <h3 className="section-title mb-6">Configuration</h3>

            <div className="space-y-6">
              <div>
                <label htmlFor="portfolio-select" className="block text-sm font-semibold text-slate-800 mb-2">
                  Portfolio
                  <InfoHint
                    text="Holdings and weights come from your Portfolios data for the selection."
                    hintId="rebalancer-portfolio"
                    hintPage="AI Rebalancer"
                  />
                </label>
                <select
                  id="portfolio-select"
                  value={selectedPortfolioId}
                  onChange={(e) => setSelectedPortfolioId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  {portfolios.map((p: { id: string; name?: string }) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  Current allocation
                  <InfoHint
                    text="Slice weights by market value using the same pricing as Portfolios."
                    hintId="rebalancer-pie"
                    hintPage="AI Rebalancer"
                  />
                </h4>
                <div className="h-64 w-full mx-auto">
                  <AllocationPieChart data={currentAllocation} />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-800 tabular-nums">
                  Total (holdings):{' '}
                  <span className="text-primary">
                    {formatCurrencyString(totalPortfolioValueBook, { inCurrency: portfolioBookCurrency, digits: 0 })}
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Same valuation rules as the Portfolios tab. Currency: {portfolioBookCurrency}.
                </p>
                {totalPortfolioValueBook <= 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
                    Add holdings with quantity and prices, or refresh quotes, so totals can be computed.
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-800 mb-2">
                  Risk profile
                  <InfoHint
                    text="Conservative / Moderate / Aggressive adjusts the illustrative target mix used in the narrative."
                    hintId="rebalancer-risk-profile"
                    hintPage="AI Rebalancer"
                  />
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map((profile) => (
                    <button
                      key={profile}
                      type="button"
                      onClick={() => setRiskProfile(profile)}
                      className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                        riskProfile === profile
                          ? 'bg-primary text-white shadow-sm'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {profile}
                    </button>
                  ))}
                </div>
                {Object.keys(targetAssetMix).length > 0 && (
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    <span className="font-medium text-slate-700">Illustrative US ETF mix</span> (examples only):{' '}
                    {Object.entries(targetAssetMix)
                      .map(([sym, w]) => `${sym} ${(w * 100).toFixed(0)}%`)
                      .join(', ')}
                    . <InfoHint text="Your real targets may differ—see Investment Plan." />
                  </p>
                )}
                {mvoResult && mvoResult.optimalWeights.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-700 mb-1">Illustrative weights (demo math)</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {mvoResult.labels.map((label: string, i: number) => `${label} ${(mvoResult!.optimalWeights[i] * 100).toFixed(0)}%`).join(', ')}
                      {mvoResult.sharpeRatio != null && (
                        <span className="block mt-1 text-slate-500">Sharpe {mvoResult.sharpeRatio.toFixed(2)} (placeholder model)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Not a recommendation—placeholder risk/return inputs.</p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleGeneratePlan}
                disabled={!canGeneratePlan}
                title={
                  !selectedPortfolio
                    ? 'Select a portfolio'
                    : totalPortfolioValueBook <= 0
                      ? 'Need at least one holding with a positive value'
                      : 'Generate educational notes'
                }
                className="btn-primary w-full justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ScaleIcon className="h-5 w-5 shrink-0" />
                {isLoading ? 'Generating…' : 'Generate notes'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="section-card p-6 sm:p-8 min-h-[28rem] flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 shrink-0 bg-primary/10 rounded-xl flex items-center justify-center">
                  <LightBulbIcon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="section-title mb-0">Rebalancing notes</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Grounded to the figures above; educational only.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Report language">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem(AI_REBALANCER_LANG_KEY, 'en');
                      } catch {
                        /* ignore */
                      }
                      setRebalDisplayLang('en');
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${rebalDisplayLang === 'en' ? 'bg-primary/15 text-primary' : 'text-slate-600'}`}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem(AI_REBALANCER_LANG_KEY, 'ar');
                      } catch {
                        /* ignore */
                      }
                      setRebalDisplayLang('ar');
                      setRebalAr(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${rebalDisplayLang === 'ar' ? 'bg-primary/15 text-primary' : 'text-slate-600'}`}
                  >
                    العربية
                  </button>
                </div>
              </div>
            </div>

            {!isAiAvailable && !isLoading && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 mb-4 flex gap-3 items-start">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  When the AI service is unavailable, the app uses the same deterministic summary as fallback—still tied to your
                  holdings and totals.
                </p>
              </div>
            )}

            {planError && !isLoading && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 mb-4">
                <SafeMarkdownRenderer content={planError} />
                <button type="button" onClick={handleGeneratePlan} className="btn-ghost mt-3 text-sm">
                  Retry
                </button>
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col justify-center items-center flex-1 py-16 text-center">
                <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm font-medium text-slate-800">Generating notes…</p>
                <p className="text-sm text-slate-500 mt-1 max-w-md">Using your portfolio weights and risk selection.</p>
              </div>
            )}

            {rebalancingPlan && !isLoading && (
              <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 p-5 sm:p-6">
                {rebalDisplayLang === 'ar' && isTranslatingRebal && (
                  <p className="text-sm text-center text-slate-500 py-2">Translating to Arabic…</p>
                )}
                {rebalDisplayLang === 'ar' && rebalancingPlan.trim() && !isTranslatingRebal && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="text-xs text-slate-600">Arabic uses the same translation step as other reports.</p>
                    <button
                      type="button"
                      onClick={runArabicTranslation}
                      disabled={isTranslatingRebal}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {rebalAr ? 'Refresh Arabic' : rebalTranslateError ? 'Retry Arabic' : 'Translate to Arabic'}
                    </button>
                  </div>
                )}
                {rebalTranslateError && rebalDisplayLang === 'ar' && (
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mb-3">{rebalTranslateError}</p>
                )}
                <div
                  className="prose prose-sm prose-slate max-w-none text-slate-800 [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1"
                  dir={rebalDisplayLang === 'ar' ? 'rtl' : 'ltr'}
                >
                  <SafeMarkdownRenderer content={rebalDisplayLang === 'ar' ? (rebalAr ?? rebalancingPlan) : rebalancingPlan} />
                </div>
              </div>
            )}

            {!rebalancingPlan && !isLoading && !planError && (
              <div className="flex flex-col justify-center items-center flex-1 py-16 text-center px-4">
                <LightBulbIcon className="h-10 w-10 text-slate-300 mb-4" />
                <p className="text-sm font-medium text-slate-800">No notes yet</p>
                <p className="text-sm text-slate-500 mt-1 max-w-md">
                  Choose a portfolio and risk profile, then select <span className="font-semibold text-slate-700">Generate notes</span>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIRebalancerView;
