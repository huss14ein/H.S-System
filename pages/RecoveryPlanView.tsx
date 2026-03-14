import React, { useMemo, useState, useContext, useEffect, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import type { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import type { RecoveryPositionConfig, RecoveryGlobalConfig, RecoveryOrderDraft } from '../types';
import {
  buildRecoveryPlan,
  orderDraftGenerator,
  DEFAULT_RECOVERY_GLOBAL_CONFIG,
} from '../services/recoveryPlan';
import { tickerToSleeve, tickerToRiskTier } from '../wealth-ultra/position';
import { getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { suggestRecoveryParameters, formatAiError } from '../services/geminiService';
import {
  saveRecoveryExecution,
  getRecoveryExecutionsBySymbol,
  calculateRecoveryStatistics,
  updateRecoveryExecutionOutcome,
  projectRecoveryTimeline,
  type RecoveryPlanStatistics,
  type RecoveryTimelineProjection,
} from '../services/recoveryPlanPerformance';
import type { Page } from '../types';

interface RecoveryPlanViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
  setActivePage?: (page: Page) => void;
}

const inferMarketCurrencyFromSymbol = (symbol?: string): TradeCurrency | null => {
  const sym = (symbol ?? '').trim().toUpperCase();
  if (!sym) return null;
  if (sym.endsWith('.SR')) return 'SAR';
  return 'USD';
};


const convertCurrency = (amount: number, from: TradeCurrency, to: TradeCurrency, fxRate: number): number => {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  if (from === 'USD' && to === 'SAR') return amount * fxRate;
  if (from === 'SAR' && to === 'USD') return amount / fxRate;
  return amount;
};


const deriveDynamicPositionConfig = (
  symbol: string,
  sleeveType: 'Core' | 'Upside' | 'Spec',
  riskTier: 'Low' | 'Med' | 'High' | 'Spec',
  deployableCash: number,
  plPct: number
): RecoveryPositionConfig => {
  const lossSeverity = Math.min(1, Math.max(0, Math.abs(plPct) / 45));
  const riskCapFactor = riskTier === 'Low' ? 0.14 : riskTier === 'Med' ? 0.11 : riskTier === 'High' ? 0.085 : 0.06;
  const cashCap = Math.max(1200, Math.min(deployableCash * 0.35, deployableCash * (riskCapFactor + lossSeverity * 0.06)));
  const triggerBase = riskTier === 'Low' ? 12 : riskTier === 'Med' ? 15 : riskTier === 'High' ? 18 : 22;
  const dynamicTrigger = Math.max(8, Math.min(30, triggerBase - lossSeverity * 3));
  return {
    symbol,
    sleeveType,
    riskTier,
    recoveryEnabled: sleeveType !== 'Spec',
    lossTriggerPct: Number(dynamicTrigger.toFixed(1)),
    cashCap: Number(cashCap.toFixed(2)),
  };
};
function RecoveryPlanViewContent({ onNavigateToTab, onOpenWealthUltra, setActivePage }: RecoveryPlanViewProps) {
  const ctx = useContext(DataContext)!;
  const { data, getAvailableCashForAccount } = ctx;
  const { exchangeRate } = useCurrency();
  const safeFxRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 3.75;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable } = useAI();

  const allHoldingsWithPortfolio = useMemo(() => {
    const list: { holding: Holding; portfolioName: string; currency: TradeCurrency; accountId?: string }[] = [];
    (data?.investments ?? []).forEach((p: InvestmentPortfolio) => {
      (p.holdings ?? [])
        .filter((h: Holding) => (Number(h.quantity) || 0) > 0)
        .forEach((h: Holding) => {
          const portfolioCurrency: TradeCurrency =
            p.currency === 'SAR' || p.currency === 'USD' ? p.currency : 'USD';
          const symbolInferredCurrency = inferMarketCurrencyFromSymbol(h.symbol);
          const effectiveCurrency = symbolInferredCurrency ?? portfolioCurrency;
          list.push({
            holding: h,
            portfolioName: p.name ?? 'Portfolio',
            currency: effectiveCurrency,
            accountId: p.accountId,
          });
        });
    });
    return list;
  }, [data?.investments]);
  const allHoldings = useMemo(() => allHoldingsWithPortfolio.map(({ holding }) => holding), [allHoldingsWithPortfolio]);
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      const s = sym.toUpperCase();
      const price = (o as { price: number }).price;
      if (Number.isFinite(price) && price > 0) map[s] = price;
    });
    allHoldings.forEach(h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!sym) return;
      if (sym in map) return;
      const qty = Number(h.quantity) || 0;
      const currentVal = h.currentValue != null ? Number(h.currentValue) : NaN;
      const avgCost = h.avgCost != null ? Number(h.avgCost) : 0;
      if (qty > 0 && Number.isFinite(currentVal) && currentVal > 0) {
        map[sym] = currentVal / qty;
      } else if (qty > 0 && avgCost > 0) {
        map[sym] = avgCost;
      }
    });
    return map;
  }, [simulatedPrices, allHoldings]);

  const deployableCashSAR = useMemo(() => {
    const bankCash = (data?.accounts ?? [])
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((s, a) => s + Math.max(0, Number(a.balance) || 0), 0);

    const platformCashSAR = (data?.accounts ?? [])
      .filter((a) => a.type === 'Investment')
      .reduce((s, a) => {
        const cash = getAvailableCashForAccount(a.id);
        return s + (cash.SAR || 0) + (cash.USD || 0) * safeFxRate;
      }, 0);

    const total = bankCash + platformCashSAR;
    // Validate result
    if (!Number.isFinite(total) || total < 0) {
      console.warn('Invalid deployable cash calculated:', { bankCash, platformCashSAR, total });
      return 0;
    }
    return total;
  }, [data?.accounts, getAvailableCashForAccount, safeFxRate]);

  const globalConfig: RecoveryGlobalConfig = useMemo(() => ({
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash: deployableCashSAR,
    minDeployableThreshold: Math.max(300, Math.min(1200, deployableCashSAR * 0.01)),
    recoveryBudgetPct: Math.max(0.12, Math.min(0.35, 0.18 + (deployableCashSAR > 50000 ? 0.04 : 0))),
  }), [deployableCashSAR]);

  const universe = data?.portfolioUniverse ?? [];
  const coreUpsideSpec = useMemo(() => {
    const coreTickers: string[] = [];
    const upsideTickers: string[] = [];
    const specTickers: string[] = [];
    universe.forEach((u: { ticker?: string; status?: string }) => {
      const t = (u.ticker ?? '').toUpperCase();
      if (!t) return;
      if (u.status === 'Core') coreTickers.push(t);
      else if (u.status === 'High-Upside') upsideTickers.push(t);
      else if (u.status === 'Speculative') specTickers.push(t);
    });
    if (coreTickers.length === 0 && upsideTickers.length === 0 && data?.investmentPlan) {
      (data.investmentPlan.corePortfolio ?? []).forEach((p: { ticker?: string }) => coreTickers.push((p.ticker ?? '').toUpperCase()));
      (data.investmentPlan.upsideSleeve ?? []).forEach((p: { ticker?: string }) => upsideTickers.push((p.ticker ?? '').toUpperCase()));
    }
    return { coreTickers, upsideTickers, specTickers };
  }, [universe, data?.investmentPlan]);

  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [draftOrders, setDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [selectedFundamentals, setSelectedFundamentals] = useState<HoldingFundamentals | null>(null);
  const [isSelectedFundamentalsLoading, setIsSelectedFundamentalsLoading] = useState(false);
  const [selectedFundamentalsError, setSelectedFundamentalsError] = useState<string | null>(null);
  const [aiRecoveryBySymbol, setAiRecoveryBySymbol] = useState<Record<string, { lossTriggerPct: number; cashCap: number; recoveryEnabled: boolean; notes?: string }>>({});
  const [isAiRecoveryLoading, setIsAiRecoveryLoading] = useState(false);
  const [isBulkAiRecoveryLoading, setIsBulkAiRecoveryLoading] = useState(false);
  const [aiRecoveryError, setAiRecoveryError] = useState<string | null>(null);
  const [recoveryStats, setRecoveryStats] = useState<RecoveryPlanStatistics | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [recoveryTimeline, setRecoveryTimeline] = useState<RecoveryTimelineProjection | null>(null);

  const positionsWithRecovery = useMemo(() => {
    return allHoldingsWithPortfolio.map(({ holding, portfolioName, currency }) => {
      const sym = (holding.symbol || '').toUpperCase();
      const qty = Number(holding.quantity) || 0;
      const currentVal = holding.currentValue != null ? Number(holding.currentValue) : NaN;
      const avgCost = (holding.avgCost != null ? Number(holding.avgCost) : 0) || 0;
      const currentPrice =
        priceMap[sym]
        ?? (qty > 0 && Number.isFinite(currentVal) && currentVal > 0
          ? currentVal / qty
          : null)
        ?? (qty > 0 ? avgCost : 0);
      const sleeveType = tickerToSleeve(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const riskTier = tickerToRiskTier(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const roughPlPct = avgCost > 0 && currentPrice > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      const deployableCashInHoldingCurrency = currency === 'USD' ? deployableCashSAR / safeFxRate : deployableCashSAR;
      const dynamicConfig = deriveDynamicPositionConfig(sym, sleeveType, riskTier, deployableCashInHoldingCurrency, roughPlPct);
      const ai = aiRecoveryBySymbol[sym];
      const mergedConfig: RecoveryPositionConfig = ai
        ? { ...dynamicConfig, lossTriggerPct: ai.lossTriggerPct, cashCap: ai.cashCap, recoveryEnabled: ai.recoveryEnabled }
        : dynamicConfig;

      const marketValue = Number.isFinite(currentVal) && currentVal > 0 ? currentVal : qty * currentPrice;
      const shareCapMultiplier = riskTier === 'Low' ? 1.0 : riskTier === 'Med' ? 0.75 : riskTier === 'High' ? 0.5 : 0.3;
      const costCapMultiplier = riskTier === 'Low' ? 0.6 : riskTier === 'Med' ? 0.45 : riskTier === 'High' ? 0.3 : 0.2;
      const boundedMaxAddShares = Math.max(1, Math.floor(qty * shareCapMultiplier));
      const boundedMaxAddCost = Math.max(
        0,
        Math.min(
          mergedConfig.cashCap,
          marketValue > 0 ? marketValue * costCapMultiplier : mergedConfig.cashCap,
          deployableCashInHoldingCurrency * globalConfig.recoveryBudgetPct,
        ),
      );
      const positionGlobalConfig: RecoveryGlobalConfig = {
        ...globalConfig,
        deployableCash: deployableCashInHoldingCurrency,
      };
      const positionConfig: RecoveryPositionConfig = {
        ...mergedConfig,
        maxAddShares: boundedMaxAddShares,
        maxAddCost: Number(boundedMaxAddCost.toFixed(2)),
      };
      const plan = buildRecoveryPlan(holding, currentPrice, positionConfig, positionGlobalConfig);
      return { holding, portfolioName, currency, currentPrice, positionConfig, plan, aiNotes: ai?.notes };
    });
  }, [allHoldingsWithPortfolio, priceMap, globalConfig, coreUpsideSpec, deployableCashSAR, safeFxRate, aiRecoveryBySymbol]);

  const losingPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.plPct < 0), [positionsWithRecovery]);
  const qualifiedPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.qualified), [positionsWithRecovery]);

  // Load recovery statistics dynamically
  useEffect(() => {
    try {
      const stats = calculateRecoveryStatistics();
      setRecoveryStats(stats);
    } catch (error) {
      console.warn('Failed to calculate recovery statistics:', error);
      setRecoveryStats(null);
    }
  }, [selectedHoldingId, losingPositions.length, qualifiedPositions.length]);

  // Track recovery plan when generated
  const handleGenerateRecoveryPlan = useCallback((holding: Holding, plan: any, positionConfig: RecoveryPositionConfig) => {
    try {
      const executionId = `recovery-${holding.id}-${Date.now()}`;
      saveRecoveryExecution({
        id: executionId,
        symbol: holding.symbol ?? '',
        timestamp: Date.now(),
        initialPlPct: plan.plPct,
        initialPrice: plan.currentPrice,
        initialShares: holding.quantity,
        initialAvgCost: holding.avgCost ?? 0,
        recoveryConfig: {
          lossTriggerPct: positionConfig.lossTriggerPct,
          cashCap: positionConfig.cashCap,
          ladderLevels: plan.ladder.length,
          totalPlannedCost: plan.totalPlannedCost,
        },
        executionStatus: 'planned',
      });
      
      // Refresh statistics after saving
      const stats = calculateRecoveryStatistics();
      setRecoveryStats(stats);
    } catch (error) {
      console.warn('Failed to save recovery execution:', error);
    }
  }, []);

  // Selected holding & plan, derived after initial selection
  const selected = selectedHoldingId
    ? positionsWithRecovery.find(p => p.holding.id === selectedHoldingId)
    : null;
  const selectedPlan = selected?.plan;

  useEffect(() => {
    if (selectedHoldingId || qualifiedPositions.length === 0) return;
    setSelectedHoldingId(qualifiedPositions[0].holding.id);
  }, [qualifiedPositions, selectedHoldingId]);

  // Auto-update recovery execution outcomes when positions change
  useEffect(() => {
    if (!selected || !selectedPlan) return;
    
    const symbolExecutions = getRecoveryExecutionsBySymbol(selected.holding.symbol ?? '');
    const activeExecutions = symbolExecutions.filter(e => 
      e.executionStatus === 'planned' || e.executionStatus === 'partial'
    );
    
    activeExecutions.forEach(execution => {
      try {
        updateRecoveryExecutionOutcome(execution.id, {
          shares: selectedPlan.newShares || selected.holding.quantity,
          avgCost: (selectedPlan.newAvgCost ?? selected.holding.avgCost) ?? 0,
          currentPrice: selectedPlan.currentPrice,
          plPct: selectedPlan.plPct,
        });
      } catch (error) {
        console.warn('Failed to update recovery execution outcome:', error);
      }
    });
    
    if (activeExecutions.length > 0) {
      const stats = calculateRecoveryStatistics();
      setRecoveryStats(stats);
    }
    
    // Calculate recovery timeline projection
    try {
      if (selectedPlan.plPct < 0) {
        const timeline = projectRecoveryTimeline(
          selected.holding.symbol ?? '',
          selectedPlan.plPct,
          selectedPlan.plPct,
          selected.positionConfig.lossTriggerPct
        );
        setRecoveryTimeline(timeline);
      } else {
        setRecoveryTimeline(null);
      }
    } catch (error) {
      console.warn('Failed to project recovery timeline:', error);
      setRecoveryTimeline(null);
    }
  }, [selected, selectedPlan]);
  const selectedCurrencyDeployableCash = selected
    ? (selected.currency === 'USD' ? deployableCashSAR / safeFxRate : deployableCashSAR)
    : deployableCashSAR;
  const alternateCurrencyDeployableCash = selected
    ? (selected.currency === 'USD' ? deployableCashSAR : deployableCashSAR / safeFxRate)
    : deployableCashSAR / safeFxRate;
  const isSelected = (holdingId: string) => selectedHoldingId === holdingId;


  const selectedRecoveryBrief = useMemo(() => {
    if (!selected || !selectedPlan) return null;
    const secondaryCurrency: TradeCurrency = selected.currency === 'USD' ? 'SAR' : 'USD';
    const plannedCostSecondary = convertCurrency(selectedPlan.totalPlannedCost ?? 0, selected.currency, secondaryCurrency, safeFxRate);
    const postAvgSecondary = convertCurrency(selectedPlan.newAvgCost ?? 0, selected.currency, secondaryCurrency, safeFxRate);
    const triggerGap = Math.abs(selectedPlan.plPct) - Math.abs(selected.positionConfig.lossTriggerPct);
    const triggerStatus = triggerGap >= 0 ? 'trigger met' : 'monitor only';
    const aiNote = selected.aiNotes ? ` AI note: ${selected.aiNotes}` : '';
    return `Status ${triggerStatus}. Planned recovery ladder cost is ${formatCurrencyString(selectedPlan.totalPlannedCost ?? 0, { inCurrency: selected.currency ?? 'USD' })} (${formatCurrencyString(plannedCostSecondary, { inCurrency: secondaryCurrency })}) across ${selectedPlan.ladder?.length ?? 0} levels; projected post-average cost is ${formatCurrencyString(selectedPlan.newAvgCost ?? 0, { inCurrency: selected.currency ?? 'USD' })} (${formatCurrencyString(postAvgSecondary, { inCurrency: secondaryCurrency })}).${aiNote}`;
  }, [selected, selectedPlan, safeFxRate, formatCurrencyString]);

  const refreshAiRecoveryConfig = useCallback(async () => {
    if (!selected) return;
    const sym = (selected.holding.symbol || '').toUpperCase();
    if (!sym) return;
    setIsAiRecoveryLoading(true);
    setAiRecoveryError(null);
    try {
      const suggestion = await suggestRecoveryParameters({
        symbol: sym,
        sleeveType: selected.positionConfig.sleeveType,
        riskTier: selected.positionConfig.riskTier,
        plPct: selected.plan.plPct,
        deployableCash: selected.currency === 'USD' ? deployableCashSAR / safeFxRate : deployableCashSAR,
        currentPrice: selected.plan.currentPrice,
        avgCost: selected.holding.avgCost ?? 0,
      });
      setAiRecoveryBySymbol(prev => ({ ...prev, [sym]: suggestion }));
    } catch (error) {
      setAiRecoveryError(formatAiError(error));
    } finally {
      setIsAiRecoveryLoading(false);
    }
  }, [selected, deployableCashSAR, safeFxRate]);


  const applyAiToAllQualifiedPositions = useCallback(async () => {
    if (qualifiedPositions.length === 0) return;
    setIsBulkAiRecoveryLoading(true);
    setAiRecoveryError(null);
    try {
      const updates = await Promise.all(
        qualifiedPositions.slice(0, 12).map(async (position) => {
          const sym = (position.holding.symbol || '').toUpperCase();
          const deployableCash = position.currency === 'USD' ? deployableCashSAR / safeFxRate : deployableCashSAR;
          const suggestion = await suggestRecoveryParameters({
            symbol: sym,
            sleeveType: position.positionConfig.sleeveType,
            riskTier: position.positionConfig.riskTier,
            plPct: position.plan.plPct,
            deployableCash,
            currentPrice: position.plan.currentPrice,
            avgCost: position.holding.avgCost ?? 0,
          });
          return [sym, suggestion] as const;
        }),
      );
      setAiRecoveryBySymbol((prev) => ({ ...prev, ...Object.fromEntries(updates) }));
    } catch (error) {
      setAiRecoveryError(formatAiError(error));
    } finally {
      setIsBulkAiRecoveryLoading(false);
    }
  }, [qualifiedPositions, deployableCashSAR, safeFxRate]);

  useEffect(() => {
    const symbol = selected?.holding?.symbol;
    if (!symbol) {
      setSelectedFundamentals(null);
      setSelectedFundamentalsError(null);
      setIsSelectedFundamentalsLoading(false);
      return;
    }
    let cancelled = false;
    setIsSelectedFundamentalsLoading(true);
    setSelectedFundamentalsError(null);
    getHoldingFundamentals(symbol)
      .then((data) => {
        if (!cancelled) setSelectedFundamentals(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setSelectedFundamentalsError(e instanceof Error ? e.message : 'Unable to load upcoming events.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsSelectedFundamentalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.holding?.symbol]);

  const handleGenerateDraft = () => {
    if (!selectedPlan) {
      alert('Please select a position first.');
      return;
    }
    if (!selectedPlan.qualified) {
      alert('This position does not qualify for recovery. Loss must exceed the trigger threshold.');
      return;
    }
    if ((selectedPlan.ladder ?? []).length === 0) {
      alert('No recovery ladder available for this position.');
      return;
    }
    try {
      const drafts = orderDraftGenerator(selectedPlan, true);
      if (!drafts || drafts.length === 0) {
        alert('Could not generate draft orders. Please check the recovery plan configuration.');
        return;
      }
      setDraftOrders(drafts);
    } catch (error) {
      alert(`Failed to generate draft orders: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Enhanced Hero */}
      <section className="rounded-3xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-8 shadow-xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-xl">R</span>
              </div>
              <div>
                <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                  Recovery Plan (Averaging / Correction Engine)
                  <InfoHint text="Controlled workflow for positions in loss: only activates when loss exceeds your trigger (e.g. 20%). Builds a limited buy ladder (1–3 orders), predicts new average cost, and can generate exit targets. Safe guardrails prevent over-spending." />
                </h2>
                <p className="text-lg text-slate-600 mt-2">Intelligent loss recovery with AI-powered optimization</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 ml-auto">
              <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-md ${
                isAiAvailable ? 'bg-gradient-to-r from-emerald-100 to-emerald-200 text-emerald-800 border border-emerald-300' : 
                'bg-gradient-to-r from-amber-100 to-amber-200 text-amber-800 border border-amber-300'
              }`}>
                {isAiAvailable ? <CheckCircleIcon className="h-5 w-5" /> : <ExclamationTriangleIcon className="h-5 w-5" />} AI {isAiAvailable ? 'Enabled' : 'Unavailable'}
              </span>
              {recoveryStats && recoveryStats.totalExecutions > 0 && (
                <button
                  type="button"
                  onClick={() => setShowStats(!showStats)}
                  className="px-4 py-2 rounded-xl border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-indigo-100 text-indigo-700 hover:from-indigo-100 hover:to-indigo-200 font-bold transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  {showStats ? 'Hide' : 'Show'} Performance Stats
                </button>
              )}
            </div>
          </div>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
            <p className="text-slate-700 leading-relaxed">
              Positions in loss are listed below. When a position qualifies, you can generate a recovery ladder and optional exit targets. Integrated with your Portfolios and Investment Plan; never runs if over budget, spec breach, or per-ticker cap exceeded.
            </p>
          </div>
          {(onNavigateToTab || onOpenWealthUltra) && (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wider">Related:</span>
              {onNavigateToTab && (
                <>
                  <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">Portfolios</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Investment Plan')} className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">Investment Plan</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Execution History')} className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">Execution History</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Watchlist')} className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">Watchlist</button>
                </>
              )}
              {onOpenWealthUltra && (
                <>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={onOpenWealthUltra} className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">Wealth Ultra</button>
                </>
              )}
            </div>
          )}
        </div>
        <details className="mt-6 text-sm text-slate-600">
          <summary className="cursor-pointer font-bold text-primary mb-3">Default parameters</summary>
          <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-slate-200">
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <strong className="text-slate-800">Loss trigger</strong> <InfoHint text="Position must be in loss by at least this % to qualify (e.g. 20% = -20% or worse)." />: <span className="text-blue-600 font-bold">20%</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-2 h-2 bg-emerald-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <strong className="text-slate-800">Recovery budget</strong> <InfoHint text="Max share of deployable cash that can be used for recovery plans (e.g. 20%)." />: <span className="text-emerald-600 font-bold">20% of deployable cash</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-2 h-2 bg-amber-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <strong className="text-slate-800">Cash cap per ticker</strong> <InfoHint text="Max amount allowed for correction on a single ticker." />: <span className="text-amber-600 font-bold">5,000 (default)</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-2 h-2 bg-rose-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <strong className="text-slate-800">Spec</strong>: Recovery is off for Speculative sleeve unless overridden; guardrails prevent over-spending.
                </div>
              </li>
            </ul>
          </div>
        </details>
      </section>

      {/* Enhanced Performance Statistics */}
      {showStats && recoveryStats && recoveryStats.totalExecutions > 0 && (
        <SectionCard title="Recovery Plan Performance Statistics" className="border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-indigo-600 uppercase tracking-wider">Success Rate</p>
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">%</span>
                </div>
              </div>
              <p className="text-3xl font-black text-indigo-900 tabular-nums">{(recoveryStats.successRate * 100).toFixed(1)}%</p>
              <p className="text-sm text-slate-600 mt-2">{recoveryStats.totalExecutions} total executions</p>
            </div>
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-emerald-600 uppercase tracking-wider">Avg Recovery Time</p>
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">⏱</span>
                </div>
              </div>
              <p className="text-3xl font-black text-emerald-900 tabular-nums">{recoveryStats.avgRecoveryTimeDays.toFixed(0)}</p>
              <p className="text-sm text-slate-600 mt-2">days</p>
            </div>
            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-amber-600 uppercase tracking-wider">Avg ROI</p>
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">📈</span>
                </div>
              </div>
              <p className={`text-3xl font-black tabular-nums ${
                recoveryStats.avgRoi >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {recoveryStats.avgRoi >= 0 ? '+' : ''}{(recoveryStats.avgRoi * 100).toFixed(1)}%
              </p>
              <p className="text-sm text-slate-600 mt-2">on recovery capital</p>
            </div>
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Capital Deployed</p>
                <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">💰</span>
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 tabular-nums">{formatCurrencyString(recoveryStats.totalCapitalDeployed)}</p>
              <p className="text-sm text-slate-600 mt-2">Total recovered: {formatCurrencyString(recoveryStats.totalRecovered)}</p>
            </div>
          </div>
          {Object.keys(recoveryStats.bySymbol).length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">Performance by Symbol</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(recoveryStats.bySymbol).slice(0, 6).map(([symbol, stats]) => (
                  <div key={symbol} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-md hover:shadow-lg transition-all duration-300">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-lg font-bold text-slate-900">{symbol}</p>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        stats.avgRoi >= 0 ? 'bg-emerald-100' : 'bg-rose-100'
                      }`}>
                        <span className={`text-xs font-bold ${
                          stats.avgRoi >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}>
                          {stats.avgRoi >= 0 ? '↑' : '↓'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-2">
                      {stats.count} execution{stats.count !== 1 ? 's' : ''} • {(stats.successRate * 100).toFixed(0)}% success
                    </p>
                    <p className={`text-sm font-bold ${
                      stats.avgRoi >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      Avg ROI: {stats.avgRoi >= 0 ? '+' : ''}{(stats.avgRoi * 100).toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Enhanced KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-rose-50 to-red-50 border-2 border-rose-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl">⬇</span>
            </div>
            <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-rose-800 uppercase tracking-wider mb-2">Losing positions</p>
          <p className="text-4xl font-black text-rose-900 tabular-nums">{losingPositions.length}</p>
          <p className="text-sm text-rose-700 mt-2">Positions requiring attention</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl">✓</span>
            </div>
            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-2">Recovery eligible</p>
          <p className="text-4xl font-black text-emerald-900 tabular-nums">{qualifiedPositions.length}</p>
          <p className="text-sm text-emerald-700 mt-2">Positions ready for recovery</p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl">💰</span>
            </div>
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-blue-800 uppercase tracking-wider mb-2">Deployable cash (SAR + USD)</p>
          <p className="text-3xl font-black text-blue-900 tabular-nums">{formatCurrencyString(deployableCashSAR)}</p>
          <p className="text-sm text-blue-700 mt-2">Approximate total across currencies</p>
          <p className="text-xs text-blue-600 mt-3">Per-position values below use each portfolio&apos;s base currency</p>
        </div>
      </div>

      {/* Enhanced Losing positions table */}
      <SectionCard title="Positions in loss" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-gradient-to-r from-slate-50 to-slate-100">
              <tr>
                <th className="px-6 py-4 text-left font-bold text-slate-700 uppercase tracking-wider">Symbol</th>
                <th className="px-6 py-4 text-right font-bold text-slate-700 uppercase tracking-wider">P/L %</th>
                <th className="px-6 py-4 text-right font-bold text-slate-700 uppercase tracking-wider">Cost / Value</th>
                <th className="px-6 py-4 text-center font-bold text-slate-700 uppercase tracking-wider">State</th>
                <th className="px-6 py-4 text-center font-bold text-slate-700 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {losingPositions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-emerald-100 to-emerald-200 rounded-full flex items-center justify-center">
                        <span className="text-emerald-600 text-2xl">✓</span>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-slate-700">No losing positions</p>
                        <p className="text-sm text-slate-500 mt-1">Recovery plan applies only when a position is in loss</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                losingPositions.map(({ holding, portfolioName, currency, plan }) => (
                  <tr key={holding.id} className={`${isSelected(holding.id) ? 'bg-primary/10 border-l-4 border-primary' : 'hover:bg-slate-50'} transition-colors duration-150`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg flex items-center justify-center">
                          <span className="font-bold text-slate-700 text-sm">{(holding.symbol ?? '').slice(0, 2)}</span>
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 text-lg">{holding.symbol ?? '—'}</span>
                          <span className="block text-sm text-slate-500">{portfolioName}</span>
                        </div>
                      </div>
                    </td>
                    <td className={`px-6 py-4 text-right font-bold tabular-nums text-lg ${
                      plan.plPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {plan.plPct >= 0 ? '+' : ''}{plan.plPct.toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 text-right text-slate-600 tabular-nums font-medium">
                      <div className="flex flex-col gap-1">
                        <span>{formatCurrencyString(plan.costBasis, { inCurrency: currency })}</span>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span>→</span>
                          <span>{formatCurrencyString(plan.marketValue, { inCurrency: currency })}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {plan.qualified ? (
                        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm">
                          ✓ Recovery Eligible
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {plan.state}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {plan.qualified && (
                        <button
                          type="button"
                          onClick={() => setSelectedHoldingId(isSelected(holding.id) ? null : holding.id)}
                          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary font-bold text-sm transition-colors duration-200 shadow-sm hover:shadow-md"
                        >
                          {isSelected(holding.id) ? 'Hide plan' : 'Generate Recovery Plan'}
                        </button>
                      )}
                      {!plan.qualified && plan.reason && (
                        <span className="text-xs text-slate-500 italic" title={plan.reason}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selected && selectedPlan && (
        <SectionCard title={`${selected.holding.symbol ?? 'Holding'} — Recovery Plan`} className="space-y-5">
          {(() => {
            const symbolHistory = getRecoveryExecutionsBySymbol(selected.holding.symbol ?? '');
            if (symbolHistory.length > 0) {
              const lastExecution = symbolHistory[0];
              const completed = symbolHistory.filter(e => e.executionStatus === 'complete' && e.outcome);
              const successRate = completed.length > 0
                ? (completed.filter(e => e.outcome?.recovered).length / completed.length) * 100
                : 0;
              return (
                <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-6 mb-6 shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                      <span className="text-white font-bold text-lg">📊</span>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-indigo-900 uppercase tracking-wide">Historical Performance</p>
                      <p className="text-indigo-700 font-medium">{selected.holding.symbol ?? 'Holding'} recovery history</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-indigo-100">
                      <p className="text-2xl font-black text-indigo-900 tabular-nums">{symbolHistory.length}</p>
                      <p className="text-sm text-indigo-700 font-medium">Previous recovery{symbolHistory.length !== 1 ? 's' : ''}</p>
                    </div>
                    {completed.length > 0 && (
                      <>
                        <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-indigo-100">
                          <p className="text-2xl font-black text-indigo-900 tabular-nums">{successRate.toFixed(0)}%</p>
                          <p className="text-sm text-indigo-700 font-medium">Success rate</p>
                        </div>
                        {lastExecution.outcome && (
                          <>
                            <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-indigo-100">
                              <p className="text-lg font-bold text-indigo-900">
                                {lastExecution.outcome.recovered ? 'Success' : 'In progress'}
                              </p>
                              <p className="text-sm text-indigo-700 font-medium">Last recovery</p>
                            </div>
                            {lastExecution.outcome.recoveryTimeDays && (
                              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-indigo-100">
                                <p className="text-lg font-bold text-indigo-900 tabular-nums">{lastExecution.outcome.recoveryTimeDays}</p>
                                <p className="text-sm text-indigo-700 font-medium">Recovery time (days)</p>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            }
            return null;
          })()}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">📁</span>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Portfolio: {selected.portfolioName}
                </p>
                <p className="text-xs text-slate-600">
                  Display currency: {selected.currency ?? 'USD'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button 
                type="button" 
                onClick={refreshAiRecoveryConfig} 
                disabled={isAiRecoveryLoading} 
                className="px-4 py-2.5 rounded-xl border-2 border-primary/30 text-primary text-sm font-bold hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
              >
                {isAiRecoveryLoading ? 'Optimizing…' : 'AI optimize selected'}
              </button>
              <button 
                type="button" 
                onClick={applyAiToAllQualifiedPositions} 
                disabled={isBulkAiRecoveryLoading || qualifiedPositions.length === 0} 
                className="px-4 py-2.5 rounded-xl border-2 border-emerald-300 text-emerald-700 text-sm font-bold hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
              >
                {isBulkAiRecoveryLoading ? 'Optimizing all…' : `AI optimize all (${qualifiedPositions.length})`}
              </button>
            </div>
          </div>
          {selectedRecoveryBrief && (
            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">ℹ</span>
                </div>
                <p className="text-sm text-indigo-800 font-medium leading-relaxed">{selectedRecoveryBrief}</p>
              </div>
            </div>
          )}
          {selected.aiNotes && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">✓</span>
                </div>
                <p className="text-sm text-emerald-800 font-medium leading-relaxed">{selected.aiNotes}</p>
              </div>
            </div>
          )}
          {aiRecoveryError && (
            <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-r from-rose-50 to-red-50 p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">⚠</span>
                </div>
                <p className="text-sm text-rose-800 font-medium leading-relaxed">{aiRecoveryError}</p>
              </div>
            </div>
          )}


          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Deployable cash ({selected.currency ?? 'USD'})</p>
                <div className="w-8 h-8 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">💰</span>
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 tabular-nums">{formatCurrencyString(selectedCurrencyDeployableCash, { inCurrency: selected.currency ?? 'USD' })}</p>
            </div>
            <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-blue-700 uppercase tracking-wider">Cross-currency reference ({selected?.currency === 'USD' ? 'SAR' : 'USD'})</p>
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">🔄</span>
                </div>
              </div>
              <p className="text-2xl font-black text-blue-900 tabular-nums">{formatCurrencyString(alternateCurrencyDeployableCash, { inCurrency: (selected?.currency === 'USD' ? 'SAR' : 'USD') as TradeCurrency })}</p>
            </div>
          </div>
          {!isAiAvailable && (
            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">⚠</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-800 mb-1">AI Currently Unavailable</p>
                  <p className="text-sm text-amber-700 leading-relaxed">Recovery plan still runs with deterministic guardrails, dual-currency checks, and clear trigger logic.</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Current Position</p>
                <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-lg">📊</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 font-medium">Shares:</span>
                  <span className="text-sm font-bold text-slate-900">{selected.holding.quantity}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 font-medium">Avg Cost:</span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatCurrencyString(selected.holding.avgCost ?? 0, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 font-medium">Price:</span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatCurrencyString(selectedPlan.currentPrice, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600 font-medium">P/L:</span>
                    <span className={`text-lg font-black tabular-nums ${
                      selectedPlan.plPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatCurrencyString(selectedPlan.plUsd, {
                        inCurrency: selected.currency ?? 'USD',
                      })} ({selectedPlan.plPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">After ladder fills <InfoHint text="New average cost and share count if all planned buy orders are filled." /></p>
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-lg">📈</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-emerald-600 font-medium">New Shares:</span>
                  <span className="text-sm font-bold text-emerald-900">{selectedPlan.newShares}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-emerald-600 font-medium">New Avg Cost:</span>
                  <span className="text-sm font-bold text-emerald-900">
                    {formatCurrencyString(selectedPlan.newAvgCost ?? 0, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                </div>
                <div className="border-t border-emerald-200 pt-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-emerald-600 font-medium">Planned Recovery Cost:</span>
                    <span className="text-lg font-black text-emerald-900 tabular-nums">
                      {formatCurrencyString(selectedPlan.totalPlannedCost ?? 0, {
                        inCurrency: selected.currency ?? 'USD',
                      })}
                    </span>
                  </div>
                  <div className="bg-emerald-100/50 rounded-lg p-3">
                    <p className="text-xs text-emerald-700 font-medium">
                      Added shares cap: {Math.max(0, (selectedPlan.newShares ?? 0) - (selectedPlan.shares ?? 0))} / {selected.positionConfig.maxAddShares ?? 0}
                      {' '}({(selectedPlan.shares ?? 0) > 0 ? ((((selectedPlan.newShares ?? 0) - (selectedPlan.shares ?? 0)) / (selectedPlan.shares ?? 1)) * 100).toFixed(0) : '0'}% of current shares)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white border border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Next earnings & dividends (estimated)
              </p>
              {isSelectedFundamentalsLoading && (
                <p className="text-[11px] text-slate-400">Updating…</p>
              )}
            </div>
            {selectedFundamentalsError && (
              <p className="text-[11px] text-rose-600 mb-1">
                Could not load event details right now.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 text-xs text-slate-600">
              <div className="space-y-1">
                <p className="font-semibold text-slate-500 uppercase tracking-wide text-[11px]">
                  Next earnings report (estimated)
                </p>
                {selectedFundamentals?.nextEarnings?.date ? (
                  <>
                    <p className="text-slate-800">
                      {new Date(selectedFundamentals.nextEarnings.date).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                      {selectedFundamentals.nextEarnings.quarter != null &&
                        selectedFundamentals.nextEarnings.year != null && (
                          <span className="text-[11px] text-slate-500 ml-1">
                            · Q{selectedFundamentals.nextEarnings.quarter}{' '}
                            {selectedFundamentals.nextEarnings.year}
                          </span>
                        )}
                    </p>
                    {typeof selectedFundamentals.nextEarnings.revenueEstimate === 'number' &&
                      selectedFundamentals.nextEarnings.revenueEstimate > 0 && (
                        <p className="text-[11px] text-slate-600">
                          Revenue estimate:{' '}
                          {formatCurrencyString(selectedFundamentals.nextEarnings.revenueEstimate, {
                            inCurrency:
                              (selectedFundamentals.currency === 'SAR' ? 'SAR' : 'USD') as TradeCurrency,
                            digits: 0,
                          })}
                        </p>
                      )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">No upcoming earnings date available from market data.</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500 uppercase tracking-wide text-[11px]">
                  Dividend snapshot (estimated)
                </p>
                {selectedFundamentals?.dividend ? (
                  <>
                    {typeof selectedFundamentals.dividend.dividendYieldPct === 'number' &&
                      selectedFundamentals.dividend.dividendYieldPct > 0 && (
                        <p className="text-slate-800">
                          Indicative yield (TTM/forward):{' '}
                          {selectedFundamentals.dividend.dividendYieldPct.toFixed(2)}%
                        </p>
                      )}
                    {typeof selectedFundamentals.dividend.dividendPerShareAnnual === 'number' &&
                      selectedFundamentals.dividend.dividendPerShareAnnual > 0 && (
                        <p className="text-[11px] text-slate-600">
                          Annual dividend per share:{' '}
                          {formatCurrencyString(
                            selectedFundamentals.dividend.dividendPerShareAnnual,
                            {
                              inCurrency:
                                (selectedFundamentals.currency === 'SAR' ? 'SAR' : 'USD') as TradeCurrency,
                              digits: 2,
                            },
                          )}
                        </p>
                      )}
                    {!selectedFundamentals.dividend.dividendYieldPct &&
                      !selectedFundamentals.dividend.dividendPerShareAnnual && (
                        <p className="text-[11px] text-slate-500">No dividend data available.</p>
                      )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">No dividend data available.</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">Buy ladder (limit orders) <InfoHint text="Up to 3 levels below current price. Use limit orders only; no market orders." /></h4>
              <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">📊</span>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full">
                <thead className="bg-gradient-to-r from-slate-100 to-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-slate-700 text-sm uppercase tracking-wider">Level</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700 text-sm uppercase tracking-wider">Quantity</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700 text-sm uppercase tracking-wider">Price</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700 text-sm uppercase tracking-wider">Cost</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {(selectedPlan.ladder ?? []).map(l => (
                    <tr key={l.level} className="hover:bg-slate-50 transition-colors duration-150">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold text-xs">L{l.level}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">{l.qty}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800 tabular-nums">
                        {formatCurrencyString(l.price, {
                          inCurrency: selected.currency ?? 'USD',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700 tabular-nums">
                        {formatCurrencyString(l.cost, {
                          inCurrency: selected.currency ?? 'USD',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">Exit targets (optional) <InfoHint text="Target 1/2 and trailing stop based on new average cost. Apply when you want to auto-suggest exit prices." /></h4>
              <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">🎯</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {selectedPlan.exitPlan.applyTarget1 &&
                selectedPlan.exitPlan.target1Price != null && (
                  <div className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-50 to-purple-50 border-2 border-violet-200 shadow-md hover:shadow-lg transition-all duration-200">
                    <p className="text-sm font-bold text-violet-800">Target 1: {selectedPlan.exitPlan.target1Pct}%</p>
                    <p className="text-sm font-black text-violet-900 tabular-nums">
                      {formatCurrencyString(selectedPlan.exitPlan.target1Price, {
                        inCurrency: selected.currency ?? 'USD',
                      })}
                    </p>
                  </div>
                )}
              {selectedPlan.exitPlan.applyTarget2 &&
                selectedPlan.exitPlan.target2Price != null && (
                  <div className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 shadow-md hover:shadow-lg transition-all duration-200">
                    <p className="text-sm font-bold text-indigo-800">Target 2: {selectedPlan.exitPlan.target2Pct}%</p>
                    <p className="text-sm font-black text-indigo-900 tabular-nums">
                      {formatCurrencyString(selectedPlan.exitPlan.target2Price, {
                        inCurrency: selected.currency ?? 'USD',
                      })}
                    </p>
                  </div>
                )}
              {selectedPlan.exitPlan.applyTrailing &&
                selectedPlan.exitPlan.trailStopPrice != null && (
                  <div className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 shadow-md hover:shadow-lg transition-all duration-200">
                    <p className="text-sm font-bold text-amber-800">Trailing: {selectedPlan.exitPlan.trailPct}%</p>
                    <p className="text-sm font-black text-amber-900 tabular-nums">
                      {formatCurrencyString(selectedPlan.exitPlan.trailStopPrice, {
                        inCurrency: selected.currency ?? 'USD',
                      })}
                    </p>
                  </div>
                )}
              {(!selectedPlan.exitPlan.applyTarget1 && !selectedPlan.exitPlan.applyTarget2 && !selectedPlan.exitPlan.applyTrailing) && (
                <div className="px-4 py-2.5 rounded-xl bg-slate-100 border-2 border-slate-200">
                  <p className="text-sm font-medium text-slate-600">No exit targets configured</p>
                </div>
              )}
            </div>
          </div>

          {recoveryTimeline && (
            <div className="rounded-lg border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-white p-4">
              <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                Recovery Timeline Projection
                <InfoHint text="Estimated time to recovery based on historical data and current progress." />
              </h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-indigo-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Estimated Days</p>
                    <p className="text-2xl font-black text-indigo-700 tabular-nums">{recoveryTimeline.estimatedDaysToRecovery}</p>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Confidence</p>
                    <p className={`text-lg font-bold tabular-nums ${
                      recoveryTimeline.confidence === 'high' ? 'text-emerald-700' :
                      recoveryTimeline.confidence === 'medium' ? 'text-amber-700' : 'text-rose-700'
                    }`}>
                      {recoveryTimeline.confidence.toUpperCase()}
                    </p>
                  </div>
                </div>
                {recoveryTimeline.projectedRecoveryDate && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                    <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">Projected Recovery Date</p>
                    <p className="text-sm font-bold text-indigo-900">
                      {recoveryTimeline.projectedRecoveryDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {recoveryTimeline.historicalAverageDays && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Historical Average</p>
                    <p className="text-sm text-slate-700">
                      {recoveryTimeline.historicalAverageDays.toFixed(0)} days (based on past recoveries)
                    </p>
                  </div>
                )}
                {recoveryTimeline.factors.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Key Factors</p>
                    <ul className="text-xs text-slate-700 space-y-1">
                      {recoveryTimeline.factors.map((factor, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-indigo-500 mt-0.5">•</span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                if (!selectedPlan) return;
                handleGenerateRecoveryPlan(selected.holding, selectedPlan, selected.positionConfig);
                handleGenerateDraft();
              }}
              className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-secondary font-medium text-sm"
            >
              Create Draft Orders & Track Recovery
            </button>
            {setActivePage && (
              <>
                {setActivePage && (
                  <button
                    type="button"
                    onClick={() => setActivePage('Market Events')}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium text-sm"
                  >
                    Check Market Events for {selected.holding.symbol ?? 'holding'}
                  </button>
                )}
                {onOpenWealthUltra && (
                  <button
                    type="button"
                    onClick={onOpenWealthUltra}
                    className="px-4 py-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 font-medium text-sm"
                  >
                    View in Wealth Ultra
                  </button>
                )}
              </>
            )}
          </div>
        </SectionCard>
      )}

      {draftOrders && draftOrders.length > 0 && (
        <SectionCard title="Draft orders (export to broker)" className="space-y-3">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-600">Copy or use these to place limit orders in your broker.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const csv = [
                    ['Type', 'Symbol', 'Quantity', 'Limit Price', 'Currency', 'Label'].join(','),
                    ...draftOrders.map(d => [
                      d.type,
                      d.symbol,
                      d.qty,
                      d.limitPrice,
                      selected?.currency ?? 'USD',
                      d.label || ''
                    ].join(','))
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `recovery-orders-${selected?.holding.symbol ?? 'orders'}-${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  const text = draftOrders.map((d, i) => 
                    `${i + 1}. ${d.type.toUpperCase()} ${d.symbol} - Qty: ${d.qty}, Limit: ${formatCurrencyString(d.limitPrice, { inCurrency: selected?.currency ?? 'USD' })}${d.label ? ` (${d.label})` : ''}`
                  ).join('\n');
                  navigator.clipboard.writeText(text).then(() => {
                    alert('Orders copied to clipboard!');
                  }).catch(() => {
                    alert('Failed to copy to clipboard. Please copy manually.');
                  });
                }}
                className="px-4 py-2 text-sm font-medium bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
              >
                Copy All
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {draftOrders.map((d, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-sm"
              >
                <span className="font-semibold text-slate-800">
                  {d.type} {d.symbol}
                </span>
                <span className="text-slate-600">Qty: {d.qty}</span>
                <span className="text-slate-600">
                  Limit:{' '}
                  {formatCurrencyString(d.limitPrice, {
                    inCurrency: selected?.currency ?? 'USD',
                  })}
                </span>
                {d.label && <span className="text-slate-500">({d.label})</span>}
                <button
                  type="button"
                  onClick={() => {
                    const text = `${d.type.toUpperCase()} ${d.symbol} - Qty: ${d.qty}, Limit: ${formatCurrencyString(d.limitPrice, { inCurrency: selected?.currency ?? 'USD' })}${d.label ? ` (${d.label})` : ''}`;
                    navigator.clipboard.writeText(text).then(() => {
                      // Visual feedback could be added here
                    }).catch(() => {
                      alert('Failed to copy to clipboard.');
                    });
                  }}
                  className="ml-auto px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                  title="Copy this order"
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setDraftOrders(null)} className="mt-2 text-sm text-slate-500 hover:underline font-medium">Close</button>
        </SectionCard>
      )}
    </div>
  );
}

export default function RecoveryPlanView(props: RecoveryPlanViewProps = {}) {
  return (
    <React.Suspense fallback={<div className="text-center p-8 text-slate-500">Loading…</div>}>
      <RecoveryPlanViewContent {...props} />
    </React.Suspense>
  );
}
