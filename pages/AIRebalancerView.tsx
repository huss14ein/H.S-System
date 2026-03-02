import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIRebalancingPlan, formatAiError } from '../services/geminiService';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

const AIRebalancerView: React.FC = () => {
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
            <div className="mt-6 text-center bg-white p-8 rounded-lg shadow">
                <h2 className="text-2xl font-bold text-dark">AI Portfolio Rebalancer</h2>
                <p className="text-gray-500 mt-4">You don't have any investment portfolios to analyze. Please add one on the 'Platform' tab.</p>
            </div>
        );
    }

    return (
        <div className="mt-6 space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-dark">AI Portfolio Rebalancer</h2>
                <p className="text-gray-500 mt-1">Get educational suggestions to align your portfolio with your risk tolerance.</p>
                <p className="text-xs text-red-600 mt-2 font-semibold">Disclaimer: This is not financial advice. For educational purposes only.</p>
            </div>
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3">
                {/* Configuration Panel */}
                <div className="lg:col-span-1 section-card space-y-6">
                    <div>
                        <label htmlFor="portfolio-select" className="block text-sm font-medium text-gray-700">1. Select Portfolio</label>
                        <select
                            id="portfolio-select"
                            value={selectedPortfolioId}
                            onChange={(e) => setSelectedPortfolioId(e.target.value)}
                            className="mt-1 block w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary shadow-sm"
                        >
                            {data.investments.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="min-h-[260px] flex flex-col">
                         <h4 className="section-title text-base mb-2">Current Allocation</h4>
                         <div className="flex-1 min-h-[200px] rounded-lg overflow-hidden">
                             <AllocationPieChart data={currentAllocation} />
                         </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">2. Define Your Risk Profile</label>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                            {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                                <button
                                    key={profile}
                                    onClick={() => setRiskProfile(profile)}
                                    className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                                        riskProfile === profile
                                            ? 'bg-primary text-white shadow'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    {profile}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleGeneratePlan}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors font-semibold"
                    >
                        <ScaleIcon className="h-5 w-5 mr-2" />
                        {isLoading ? 'Generating Plan...' : 'Generate Rebalancing Plan'}
                    </button>
                </div>

                {/* Results Panel */}
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow">
                    <div className="mb-4">
                        <div className="flex items-center space-x-2">
                            <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                            <h3 className="text-xl font-semibold text-dark">Rebalancing Suggestions</h3>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p>
                    </div>
                    {planError && !isLoading && (
                        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                            <SafeMarkdownRenderer content={planError} />
                            <button type="button" onClick={handleGeneratePlan} className="mt-2 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200">Retry</button>
                        </div>
                    )}
                    {isLoading && (
                        <div className="flex justify-center items-center h-full min-h-[400px]">
                            <p className="text-gray-500">Analyzing your portfolio and generating suggestions...</p>
                        </div>
                    )}
                    {rebalancingPlan && !isLoading && (
                        <SafeMarkdownRenderer content={rebalancingPlan} />
                    )}
                    {!rebalancingPlan && !isLoading && !planError && (
                         <div className="flex justify-center items-center h-full min-h-[400px] text-center text-gray-500">
                            <p>Select a portfolio and risk profile, then click "Generate Plan" to see educational rebalancing ideas.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AIRebalancerView;