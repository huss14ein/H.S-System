import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIRebalancingPlan, formatAiError } from '../services/geminiService';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import InfoHint from '../components/InfoHint';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { getTargetAllocationForProfile, meanVarianceOptimization } from '../services/portfolioConstruction';
import type { Page } from '../types';

type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

interface AIRebalancerViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
  setActivePage?: (page: Page) => void;
}

const AIRebalancerView: React.FC<AIRebalancerViewProps> = ({ onNavigateToTab, onOpenWealthUltra, setActivePage: _setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const { isAiAvailable } = useAI();
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(data?.investments?.[0]?.id ?? '');
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [rebalancingPlan, setRebalancingPlan] = useState<string>('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
  const selectedPortfolio = useMemo(() => {
    return portfolios.find((p: { id: string }) => p.id === selectedPortfolioId) ?? portfolios[0];
  }, [selectedPortfolioId, portfolios]);

  const handleGeneratePlan = useCallback(async () => {
    if (!selectedPortfolio) {
      alert('Please select a portfolio first.');
      return;
    }
    if (!selectedPortfolio.holdings || selectedPortfolio.holdings.length === 0) {
      alert('Selected portfolio has no holdings. Add holdings first.');
      return;
    }
    setIsLoading(true);
    setRebalancingPlan('');
    setPlanError(null);
    try {
      const plan = await getAIRebalancingPlan(selectedPortfolio.holdings, riskProfile);
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
  }, [selectedPortfolio, riskProfile]);

  const targetAssetMix = useMemo(() => getTargetAllocationForProfile(riskProfile), [riskProfile]);

  const mvoResult = useMemo(() => {
    if (!selectedPortfolio?.holdings?.length) return null;
    const holdings = (selectedPortfolio.holdings ?? []).filter((h: { currentValue?: number }) => Number(h.currentValue ?? 0) > 0);
    if (holdings.length < 2) return null;
    const total = holdings.reduce((s: number, h: { currentValue?: number }) => s + Number(h.currentValue ?? 0), 0);
    if (total <= 0) return null;
    const expectedReturns = holdings.map(() => 0.07 / 12);
    const n = holdings.length;
    const cov = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) cov[i][i] = 0.04 / 12;
    const res = meanVarianceOptimization({ expectedReturns, covarianceMatrix: cov, riskFreeRate: 0.04 / 12 });
    const labels = holdings.map((h: { symbol?: string }) => h.symbol ?? '');
    return { ...res, labels };
  }, [selectedPortfolio?.holdings]);

  const currentAllocation = useMemo(() => {
    if (!selectedPortfolio) return [];
    return (selectedPortfolio?.holdings ?? [])
      .map((h: { quantity?: number; avgCost?: number; currentValue?: number; symbol?: string }) => {
        const quantity = Number(h.quantity || 0);
        const avgCost = Number(h.avgCost || 0);
        const marketValue = Number(h.currentValue || 0);
        const fallbackValue = quantity > 0 && avgCost > 0 ? quantity * avgCost : 0;
        const effectiveValue = marketValue > 0 ? marketValue : fallbackValue;
        return { name: h.symbol ?? '', value: effectiveValue };
      })
      .filter((row: { name: string; value: number }) => Number.isFinite(row.value) && row.value > 0);
  }, [selectedPortfolio]);

  // Loading state
  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center" aria-busy="true">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading AI Rebalancer" />
          <p className="text-sm text-slate-600">Loading portfolio data...</p>
        </div>
      </div>
    );
  }

  if (!portfolios.length) {
    return (
      <div className="mt-6 space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6 text-center">
          <h2 className="text-xl font-bold text-slate-800">AI Portfolio Rebalancer</h2>
          <p className="text-slate-600 mt-2">You don't have any investment portfolios to analyze.</p>
          <p className="text-sm text-slate-500 mt-1">Add a platform and portfolio under <strong>Portfolios</strong>, then return here.</p>
          {onNavigateToTab && (
            <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="mt-4 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-secondary text-sm font-medium">
              Go to Portfolios
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Enhanced Hero Section */}
      <div className="rounded-3xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-8 shadow-xl mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <ScaleIcon className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-slate-900">AI Portfolio Rebalancer</h2>
              <p className="text-lg text-slate-600 mt-2">Educational portfolio analysis and rebalancing suggestions</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-bold text-indigo-700 uppercase tracking-wider">AI Powered</span>
          </div>
        </div>
        <div className="mt-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
          <p className="text-slate-700 leading-relaxed">
            Get educational suggestions to align your portfolio with your risk tolerance. Select a portfolio and risk profile, then generate a rebalancing plan. 
            Use with <span className="font-bold text-indigo-700">Investment Plan</span> and <span className="font-bold text-indigo-700">Wealth Ultra</span> for allocation and execution.
          </p>
          <p className="text-xs text-amber-700 font-medium mt-3">Disclaimer: Not financial advice. For educational purposes only.</p>
        </div>
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-slate-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-slate-500 to-slate-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">📁</span>
            </div>
            <div className="w-3 h-3 bg-slate-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Portfolios</p>
          <p className="text-4xl font-black text-slate-900 tabular-nums">{portfolios.length}</p>
          <p className="text-sm text-slate-600 mt-2">Available portfolios</p>
        </div>
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">📊</span>
            </div>
            <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-indigo-800 uppercase tracking-wider mb-2">Selected Holdings</p>
          <p className="text-4xl font-black text-indigo-900 tabular-nums">{selectedPortfolio?.holdings?.length ?? 0}</p>
          <p className="text-sm text-indigo-600 mt-2">Current positions</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
              {isAiAvailable ? <CheckCircleIcon className="h-7 w-7 text-white" /> : <ExclamationTriangleIcon className="h-7 w-7 text-white" />}
            </div>
            <div className={`w-3 h-3 rounded-full animate-pulse ${
              isAiAvailable ? 'bg-emerald-500' : 'bg-amber-500'
            }`}></div>
          </div>
          <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-2">AI Status</p>
          <p className={`text-2xl font-bold tabular-nums ${
            isAiAvailable ? 'text-emerald-900' : 'text-amber-900'
          }`}>
            {isAiAvailable ? 'Operational' : 'Fallback Active'}
          </p>
          <p className="text-sm text-emerald-600 mt-2">Service status</p>
        </div>
      </div>

      {/* Enhanced Navigation Links */}
      {(onNavigateToTab || onOpenWealthUltra) && (
        <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300 mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">Related Pages:</span>
            {onNavigateToTab && (
              <>
                <button 
                  type="button" 
                  onClick={() => onNavigateToTab('Portfolios')} 
                  className="px-4 py-2 text-sm font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors duration-200"
                >
                  Portfolios
                </button>
                <button 
                  type="button" 
                  onClick={() => onNavigateToTab('Investment Plan')} 
                  className="px-4 py-2 text-sm font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors duration-200"
                >
                  Investment Plan
                </button>
                <button 
                  type="button" 
                  onClick={() => onNavigateToTab('Execution History')} 
                  className="px-4 py-2 text-sm font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors duration-200"
                >
                  Execution History
                </button>
              </>
            )}
            {onOpenWealthUltra && (
              <button 
                type="button" 
                onClick={onOpenWealthUltra} 
                className="px-4 py-2 text-sm font-bold bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors duration-200"
              >
                Wealth Ultra
              </button>
            )}
          </div>
        </div>
      )}

      {/* Enhanced Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Enhanced Configuration Section */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-8 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">⚙️</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900">Configuration</h3>
            </div>
            
            <div className="space-y-6">
              {/* Portfolio Selection */}
              <div>
                <label htmlFor="portfolio-select" className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <span className="text-lg">1️⃣</span>
                  Select Portfolio
                  <InfoHint text="Choose which portfolio to analyze. Holdings and current allocation are taken from your Portfolios data." />
                </label>
                <select
                  id="portfolio-select"
                  value={selectedPortfolioId}
                  onChange={(e) => setSelectedPortfolioId(e.target.value)}
                  className="w-full p-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 font-medium bg-white shadow-sm"
                >
                  {portfolios.map((p: { id: string; name?: string }) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Current Allocation Chart */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                  <span className="text-lg">📊</span>
                  Current Allocation
                  <InfoHint text="Pie chart of current holdings by market value. Use this to see concentration before rebalancing." />
                </h4>
                <div className="h-64 w-full">
                  <AllocationPieChart data={currentAllocation} />
                </div>
              </div>

              {/* Risk Profile Selection */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <span className="text-lg">2️⃣</span>
                  Risk Profile
                  <InfoHint text="Conservative: lower volatility focus. Moderate: balanced. Aggressive: higher growth tolerance. AI suggestions adapt to your choice." />
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                    <button
                      key={profile}
                      type="button"
                      onClick={() => setRiskProfile(profile)}
                      className={`px-4 py-3 text-sm font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg ${
                        riskProfile === profile
                          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                          : 'bg-white text-slate-700 hover:bg-slate-50 border-2 border-slate-200'
                      }`}
                    >
                      {profile}
                    </button>
                  ))}
                </div>
                {Object.keys(targetAssetMix).length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Target allocation: {Object.entries(targetAssetMix).map(([sym, w]) => `${sym} ${(w * 100).toFixed(0)}%`).join(', ')}
                  </p>
                )}
                {mvoResult && mvoResult.optimalWeights.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-700 mb-1">MVO suggested weights (Efficient Frontier)</p>
                    <p className="text-xs text-slate-600">
                      {mvoResult.labels.map((label: string, i: number) => `${label} ${(mvoResult!.optimalWeights[i] * 100).toFixed(0)}%`).join(', ')}
                      {mvoResult.sharpeRatio != null && (
                        <span className="block mt-1 text-slate-500">Sharpe {mvoResult.sharpeRatio.toFixed(2)}</span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                type="button"
                onClick={handleGeneratePlan}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-bold text-lg shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <ScaleIcon className="h-6 w-6" />
                {isLoading ? 'Generating…' : 'Generate Rebalancing Plan'}
              </button>
            </div>
          </div>
        </div>

        {/* Enhanced Results Section */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-8 shadow-lg hover:shadow-xl transition-all duration-300 min-h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <LightBulbIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-indigo-900">Rebalancing Suggestions</h3>
                  <p className="text-sm text-indigo-600 mt-1">From your expert investment advisor</p>
                </div>
              </div>
              {!isAiAvailable && !isLoading && (
                <div className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-bold">
                  AI Fallback Active
                </div>
              )}
            </div>
            
            {!isAiAvailable && !isLoading && (
              <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-6 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ExclamationTriangleIcon className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm text-amber-800 font-medium leading-relaxed">
                    Live AI is unavailable right now. Rebalancer will still generate a deterministic, portfolio-based fallback plan.
                  </p>
                </div>
              </div>
            )}
            
            {planError && !isLoading && (
              <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-r from-rose-50 to-red-50 p-6 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-sm">!</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-rose-800 font-medium leading-relaxed mb-4">
                      <SafeMarkdownRenderer content={planError} />
                    </p>
                    <button 
                      type="button" 
                      onClick={handleGeneratePlan} 
                      className="px-4 py-2 text-sm font-bold bg-rose-100 text-rose-800 rounded-lg hover:bg-rose-200 transition-colors duration-200"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {isLoading && (
              <div className="flex flex-col justify-center items-center min-h-[400px] text-center">
                <div className="w-16 h-16 bg-indigo-200 rounded-full animate-pulse mb-6"></div>
                <p className="text-lg font-bold text-indigo-900 mb-2">Analyzing your portfolio…</p>
                <p className="text-sm text-indigo-600 max-w-md">Generating educational suggestions based on your risk profile and current allocation.</p>
              </div>
            )}
            
            {rebalancingPlan && !isLoading && (
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-indigo-100">
                <div className="prose prose-sm max-w-none text-slate-700">
                  <SafeMarkdownRenderer content={rebalancingPlan} />
                </div>
              </div>
            )}
            
            {!rebalancingPlan && !isLoading && !planError && (
              <div className="flex flex-col justify-center items-center min-h-[400px] text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mb-6">
                  <LightBulbIcon className="h-10 w-10 text-indigo-400" />
                </div>
                <p className="text-lg font-bold text-slate-900 mb-2">No plan yet</p>
                <p className="text-sm text-slate-600 max-w-md">
                  Select a portfolio and risk profile, then click <span className="font-bold text-indigo-700">Generate Rebalancing Plan</span> to see educational rebalancing ideas.
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
