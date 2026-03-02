import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIRebalancingPlan, formatAiError } from '../services/geminiService';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import SectionCard from '../components/SectionCard';
import InfoHint from '../components/InfoHint';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

interface AIRebalancerViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
}

const AIRebalancerView: React.FC<AIRebalancerViewProps> = ({ onNavigateToTab, onOpenWealthUltra }) => {
  const { data } = useContext(DataContext)!;
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(data.investments[0]?.id || '');
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [rebalancingPlan, setRebalancingPlan] = useState<string>('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const selectedPortfolio = useMemo(() => {
    return data.investments.find(p => p.id === selectedPortfolioId) || data.investments[0];
  }, [selectedPortfolioId, data.investments]);

  const handleGeneratePlan = useCallback(async () => {
    if (!selectedPortfolio) return;
    setIsLoading(true);
    setRebalancingPlan('');
    setPlanError(null);
    try {
      const plan = await getAIRebalancingPlan(selectedPortfolio.holdings, riskProfile);
      setRebalancingPlan(plan);
    } catch (err) {
      setPlanError(formatAiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPortfolio, riskProfile]);

  const currentAllocation = useMemo(() => {
    if (!selectedPortfolio) return [];
    return selectedPortfolio.holdings.map(h => ({ name: h.symbol, value: h.currentValue }));
  }, [selectedPortfolio]);

  if (!data.investments || data.investments.length === 0) {
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
    <div className="mt-6 space-y-6">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6">
        <h2 className="text-xl font-bold text-slate-800">AI Portfolio Rebalancer</h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Get educational suggestions to align your portfolio with your risk tolerance. Select a portfolio and risk profile, then generate a rebalancing plan. Use with <strong>Investment Plan</strong> and <strong>Wealth Ultra</strong> for allocation and execution.
        </p>
        <p className="text-xs text-amber-700 mt-2 font-medium">Disclaimer: Not financial advice. For educational purposes only.</p>
        {(onNavigateToTab || onOpenWealthUltra) && (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
            {onNavigateToTab && (
              <>
                <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-sm font-medium text-primary hover:underline">Portfolios</button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => onNavigateToTab('Investment Plan')} className="text-sm font-medium text-primary hover:underline">Investment Plan</button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={() => onNavigateToTab('Execution History')} className="text-sm font-medium text-primary hover:underline">Execution History</button>
              </>
            )}
            {onOpenWealthUltra && (
              <>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={onOpenWealthUltra} className="text-sm font-medium text-primary hover:underline">Wealth Ultra</button>
              </>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration */}
        <SectionCard title="Configuration" className="space-y-5 lg:col-span-1">
          <div>
            <label htmlFor="portfolio-select" className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
              1. Select Portfolio
              <InfoHint text="Choose which portfolio to analyze. Holdings and current allocation are taken from your Portfolios data." />
            </label>
            <select
              id="portfolio-select"
              value={selectedPortfolioId}
              onChange={(e) => setSelectedPortfolioId(e.target.value)}
              className="mt-1 block w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary text-slate-800"
            >
              {data.investments.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col min-h-[260px]">
            <h4 className="text-sm font-semibold text-slate-700 mb-2 text-left flex items-center gap-1">
              Current Allocation
              <InfoHint text="Pie chart of current holdings by market value. Use this to see concentration before rebalancing." />
            </h4>
            <div className="flex-1 min-h-[220px] w-full rounded-xl overflow-hidden border border-slate-100 flex flex-col items-stretch">
              <AllocationPieChart data={currentAllocation} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
              2. Risk Profile
              <InfoHint text="Conservative: lower volatility focus. Moderate: balanced. Aggressive: higher growth tolerance. AI suggestions adapt to your choice." />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                <button
                  key={profile}
                  type="button"
                  onClick={() => setRiskProfile(profile)}
                  className={`px-3 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                    riskProfile === profile
                      ? 'bg-primary text-white shadow'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {profile}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGeneratePlan}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-xl hover:bg-secondary disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-sm"
          >
            <ScaleIcon className="h-5 w-5" />
            {isLoading ? 'Generating…' : 'Generate Rebalancing Plan'}
          </button>
        </SectionCard>

        {/* Results */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Rebalancing Suggestions"
            icon={<LightBulbIcon className="h-5 w-5 text-amber-500" />}
            className="min-h-[360px]"
          >
            <p className="text-xs text-slate-500 mb-4">From your expert investment advisor</p>
            {planError && !isLoading && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <SafeMarkdownRenderer content={planError} />
                <button type="button" onClick={handleGeneratePlan} className="mt-3 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200">Retry</button>
              </div>
            )}
            {isLoading && (
              <div className="flex flex-col justify-center items-center min-h-[320px] text-slate-500">
                <p className="font-medium">Analyzing your portfolio…</p>
                <p className="text-sm mt-1">Generating educational suggestions based on your risk profile.</p>
              </div>
            )}
            {rebalancingPlan && !isLoading && (
              <div className="prose prose-sm max-w-none text-slate-700">
                <SafeMarkdownRenderer content={rebalancingPlan} />
              </div>
            )}
            {!rebalancingPlan && !isLoading && !planError && (
              <div className="flex flex-col justify-center items-center min-h-[320px] text-center text-slate-500">
                <LightBulbIcon className="h-12 w-12 text-slate-300 mb-3" />
                <p className="font-medium">No plan yet</p>
                <p className="text-sm mt-1 max-w-sm">Select a portfolio and risk profile, then click <strong>Generate Rebalancing Plan</strong> to see educational rebalancing ideas.</p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default AIRebalancerView;
