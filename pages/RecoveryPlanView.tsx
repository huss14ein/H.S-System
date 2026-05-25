import React, { useMemo, useState, useContext, useEffect, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import type { Holding, PlannedTrade, RecoveryOrderDraft, RecoveryPositionConfig, RecoveryGlobalConfig, TradeCurrency } from '../types';
import {
  buildRecoveryPlan,
  computeNewAverage,
  orderDraftGenerator,
  DEFAULT_RECOVERY_GLOBAL_CONFIG,
} from '../services/recoveryPlan';
import { tickerToSleeve, tickerToRiskTier } from '../wealth-ultra/position';
import { getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { PresentationChartLineIcon } from '../components/icons/PresentationChartLineIcon';
import { suggestRecoveryParameters, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { HOLDING_PER_UNIT_DECIMALS } from '../utils/holdingValuation';
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
import { useSelfLearning } from '../context/SelfLearningContext';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel, formatSymbolWithCompany } from '../components/SymbolWithCompanyName';
import { toast } from '../context/ToastContext';
import { recoveryOrderDraftToPlannedTrade, plannedTradeMatchesRecoveryDraft } from '../services/recoveryToPlannedTrade';
import UnifiedRecoveryPanel from '../components/UnifiedRecoveryPanel';
import { type PositionRecyclingPrefsUi } from '../components/PositionRecyclingPanel';
import {
  buildRecyclingPlanForHolding,
  summarizeRecyclingPlan,
  type RecyclingPlanSummary,
} from '../services/positionRecyclingIntegration';
import { buildUnifiedRecoveryPlan } from '../services/unifiedRecoveryPlan';
import { buildWatchlistScoresFromItems, resolveSyncedRecoveryConviction } from '../services/recoveryConvictionSync';
import {
  loadRecoveryPathMode,
  saveRecoveryPathMode,
  type RecoveryPathMode,
} from '../services/recoveryPathMode';
import {
  buildRecyclingPathBrief,
  buildRecoveryLadderPathBrief,
} from '../services/recoveryPathSummaries';
import {
  loadRecyclingPrefs,
  saveRecyclingPrefs,
  saveRecyclingExecutionFromPlan,
  exportRecyclingPlanJson,
  getRecyclingExecutionsBySymbol,
} from '../services/positionRecyclingPersistence';
import { validatePlannedTrade } from '../services/dataQuality/validation';
import { computeCanonicalPlanningSnapshot } from '../services/canonicalPlanningEngine';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { getPersonalInvestments } from '../utils/wealthScope';
import {
  buildHoldingSymbolOptions,
  navigateToRecordTradeFromHolding,
  resolveHoldingOptionKeyFromSymbol,
} from '../services/holdingSymbolOptions';

interface RecoveryPlanViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

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
function RecoveryPlanViewContent({ onNavigateToTab, onOpenWealthUltra, setActivePage, triggerPageAction }: RecoveryPlanViewProps) {
  const ctx = useContext(DataContext)!;
  const { data, showBlockingLoader, getAvailableCashForAccount, addPlannedTrade } = ctx;
  const { exchangeRate } = useCurrency();
  const { trackAction } = useSelfLearning();
  const { simulatedPrices, symbolQuoteUpdatedAt } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable, aiHealthChecked, aiActionsEnabled } = useAI();
  const aiOptimizeDisabled = !aiActionsEnabled;
  const { sarPerUsd: headlineFx } = useCanonicalFinancialMetrics();
  const canonical = useMemo(
    () =>
      data
        ? computeCanonicalPlanningSnapshot({
            data: data as any,
            exchangeRate,
            sarPerUsd: headlineFx,
            simulatedPrices,
            getAvailableCashForAccount,
            symbolQuoteUpdatedAt,
          })
        : null,
    [data, exchangeRate, headlineFx, simulatedPrices, getAvailableCashForAccount, symbolQuoteUpdatedAt],
  );
  const sarPerUsd = canonical?.sarPerUsd ?? headlineFx;

  const deployableCashSAR = canonical?.recoveryPlan?.deployableCashSar ?? 0;

  const globalConfig: RecoveryGlobalConfig = useMemo(() => ({
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash: deployableCashSAR,
    minDeployableThreshold: Math.max(300, Math.min(1200, deployableCashSAR * 0.01)),
    recoveryBudgetPct: Math.max(0.12, Math.min(0.35, 0.18 + (deployableCashSAR > 50000 ? 0.04 : 0))),
  }), [deployableCashSAR]);

  const universe = data?.portfolioUniverse ?? [];
  const planCurrency = useMemo(
    () => (data?.investmentPlan?.budgetCurrency as TradeCurrency) || 'SAR',
    [data?.investmentPlan?.budgetCurrency],
  );
  // Universe sleeve mappings are applied inside the positions memo (canonical snapshot + local AI overrides).

  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [draftOrders, setDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [recyclingDraftOrders, setRecyclingDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [unifiedDraftOrders, setUnifiedDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [insertingPlanKey, setInsertingPlanKey] = useState<string | null>(null);
  const [recyclingPrefsUi, setRecyclingPrefsUi] = useState<PositionRecyclingPrefsUi>({
    minRebuyDiscountPercent: 10,
    avoidSellingBelowAverage: false,
  });
  const [selectedFundamentals, setSelectedFundamentals] = useState<HoldingFundamentals | null>(null);
  const [isSelectedFundamentalsLoading, setIsSelectedFundamentalsLoading] = useState(false);
  const [selectedFundamentalsError, setSelectedFundamentalsError] = useState<string | null>(null);
  const [aiRecoveryBySymbol, setAiRecoveryBySymbol] = useState<Record<string, { lossTriggerPct: number; cashCap: number; recoveryEnabled: boolean; notes?: string }>>({});
  const [isAiRecoveryLoading, setIsAiRecoveryLoading] = useState(false);
  const [isBulkAiRecoveryLoading, setIsBulkAiRecoveryLoading] = useState(false);
  const [aiRecoveryError, setAiRecoveryError] = useState<string | null>(null);
  const [recoveryStats, setRecoveryStats] = useState<RecoveryPlanStatistics | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [recoveryTimeline, setRecoveryTimeline] = useState<RecoveryTimelineProjection | null>(null);

  const RECOVERY_AI_LANG_KEY = 'finova_default_ai_lang_v1';
  const [recoveryDisplayLang, setRecoveryDisplayLang] = useState<'en' | 'ar'>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(RECOVERY_AI_LANG_KEY) === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const [recoveryBriefAr, setRecoveryBriefAr] = useState<string | null>(null);
  const [recoveryNotesAr, setRecoveryNotesAr] = useState<string | null>(null);
  const [recoveryTranslateErr, setRecoveryTranslateErr] = useState<string | null>(null);
  const [recoveryTranslating, setRecoveryTranslating] = useState(false);
  const [whatIfSpend, setWhatIfSpend] = useState('');
  const [whatIfPrice, setWhatIfPrice] = useState('');
  const [recoveryPathMode, setRecoveryPathMode] = useState<RecoveryPathMode>('recycling');
  const [recyclingSummaryCache, setRecyclingSummaryCache] = useState<
    Record<string, RecyclingPlanSummary | null>
  >({});

  const positionsWithRecovery = useMemo(() => {
    // Base snapshot comes from canonical engine; we re-apply AI overrides (if any) on top.
    const base = canonical?.recoveryPlan?.positions ?? [];
    if (!base.length) return [];
    const universe = data?.portfolioUniverse ?? [];
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
    const sleeveRef = { coreTickers, upsideTickers, specTickers };

    return base.map((row) => {
      const holding = row.holding;
      const portfolioName = row.portfolioName;
      const bookCurrency = row.bookCurrency;
      const sym = (holding.symbol || '').toUpperCase();
      const qty = Number(holding.quantity) || 0;
      const currentVal = holding.currentValue != null ? Number(holding.currentValue) : NaN;
      const avgCost = (holding.avgCost != null ? Number(holding.avgCost) : 0) || 0;
      const currentPrice = row.currentUnitPriceBook;
      const sleeveType = tickerToSleeve(sym, sleeveRef.coreTickers.length || sleeveRef.upsideTickers.length ? sleeveRef : undefined);
      const riskTier = tickerToRiskTier(sym, sleeveRef.coreTickers.length || sleeveRef.upsideTickers.length ? sleeveRef : undefined);
      const roughPlPct = avgCost > 0 && currentPrice > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      const deployableCashInBookCurrency = bookCurrency === 'SAR' ? deployableCashSAR : deployableCashSAR / sarPerUsd;
      const dynamicConfig = deriveDynamicPositionConfig(sym, sleeveType, riskTier, deployableCashInBookCurrency, roughPlPct);
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
          deployableCashInBookCurrency * globalConfig.recoveryBudgetPct,
        ),
      );
      const positionGlobalConfig: RecoveryGlobalConfig = { ...globalConfig, deployableCash: deployableCashInBookCurrency };
      const positionConfig: RecoveryPositionConfig = { ...mergedConfig, maxAddShares: boundedMaxAddShares, maxAddCost: Number(boundedMaxAddCost.toFixed(2)) };
      const plan = buildRecoveryPlan(holding, currentPrice, positionConfig, positionGlobalConfig);
      const recyclingSummary: RecyclingPlanSummary | null =
        plan.plPct < 0 ? recyclingSummaryCache[holding.id] ?? null : null;
      return {
        holding,
        portfolioName,
        portfolioId: row.portfolioId,
        bookCurrency,
        currentPrice,
        positionConfig,
        plan,
        recyclingSummary,
        aiNotes: ai?.notes,
        priceProvenance: row.priceProvenance,
      };
    });
  }, [canonical, data?.portfolioUniverse, deployableCashSAR, sarPerUsd, aiRecoveryBySymbol, globalConfig, recyclingSummaryCache]);

  const losingPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.plPct < 0), [positionsWithRecovery]);
  const recoverySymbols = useMemo(
    () =>
      Array.from(
        new Set(
          losingPositions
            .map(({ holding }) => (holding.symbol || '').trim())
            .filter((s) => s.length >= 2),
        ),
      ),
    [losingPositions],
  );
  const { names: recoveryCompanyNames } = useCompanyNames(recoverySymbols);
  const qualifiedPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.qualified), [positionsWithRecovery]);
  const recyclingReadyCount = useMemo(
    () => losingPositions.filter((p) => p.recyclingSummary?.planAvailable).length,
    [losingPositions],
  );

  const estimatedRecoveryDeploymentSAR = useMemo(() => {
    return qualifiedPositions.reduce((sum, p) => {
      const cost = p.plan.totalPlannedCost ?? 0;
      if (!Number.isFinite(cost) || cost <= 0) return sum;
      return sum + (p.bookCurrency === 'SAR' ? cost : cost * sarPerUsd);
    }, 0);
  }, [qualifiedPositions, sarPerUsd]);

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
    trackAction('save-recovery-execution', 'Recovery Plan');
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
      setStatsError(null);
      const stats = calculateRecoveryStatistics();
      setRecoveryStats(stats);
    } catch (error) {
      console.warn('Failed to save recovery execution:', error);
      setStatsError(error instanceof Error ? error.message : 'Failed to save recovery execution.');
    }
  }, [trackAction]);

  // Selected holding & plan, derived after initial selection
  const selected = selectedHoldingId
    ? positionsWithRecovery.find(p => p.holding.id === selectedHoldingId)
    : null;
  const selectedPlan = selected?.plan;

  const watchlistScores = useMemo(() => {
    const changeBySymbol: Record<string, number> = {};
    for (const [sym, q] of Object.entries(simulatedPrices ?? {})) {
      const ch = Number((q as { change?: number })?.change);
      if (Number.isFinite(ch)) changeBySymbol[sym.toUpperCase()] = ch;
    }
    return buildWatchlistScoresFromItems(data?.watchlist ?? [], changeBySymbol);
  }, [data?.watchlist, simulatedPrices]);

  const unifiedRecoveryPlan = useMemo(() => {
    if (!selected || !selectedPlan || selectedPlan.currentPrice <= 0) return null;
    const deployableCashInBookCurrency =
      selected.bookCurrency === 'SAR' ? deployableCashSAR : deployableCashSAR / sarPerUsd;
    return buildUnifiedRecoveryPlan({
      holding: selected.holding,
      currentPrice: selectedPlan.currentPrice,
      positionConfig: selected.positionConfig,
      globalConfig: { ...globalConfig, deployableCash: deployableCashInBookCurrency },
      data: data ?? null,
      fundamentals: selectedFundamentals,
      plannedTrades: data?.plannedTrades ?? [],
      watchlistScores,
      userPathMode: recoveryPathMode,
      recyclingOpts: {
        convictionGrade: recyclingPrefsUi.convictionGrade,
        stockQualityStatus: recyclingPrefsUi.stockQualityStatus,
        fundamentals: selectedFundamentals,
        minRebuyDiscountPercent: recyclingPrefsUi.minRebuyDiscountPercent,
        avoidSellingBelowAverage: recyclingPrefsUi.avoidSellingBelowAverage,
        allowSellNearLoss: true,
      },
    });
  }, [
    selected,
    selectedPlan,
    selectedFundamentals,
    recyclingPrefsUi,
    recoveryPathMode,
    globalConfig,
    deployableCashSAR,
    sarPerUsd,
    data,
    watchlistScores,
  ]);

  useEffect(() => {
    const sym = selected?.holding.symbol;
    if (!sym) return;
    const saved = loadRecoveryPathMode(sym);
    if (saved) setRecoveryPathMode(saved);
  }, [selected?.holding.id, selected?.holding.symbol]);

  useEffect(() => {
    const sym = selected?.holding.symbol;
    if (!sym || loadRecoveryPathMode(sym)) return;
    if (unifiedRecoveryPlan?.suggestedPathMode) {
      setRecoveryPathMode(unifiedRecoveryPlan.suggestedPathMode);
    }
  }, [selected?.holding.id, unifiedRecoveryPlan?.suggestedPathMode]);

  useEffect(() => {
    if (!selected || !selectedPlan || selectedPlan.plPct >= 0 || selectedPlan.currentPrice <= 0) return;
    const hid = selected.holding.id;
    if (hid in recyclingSummaryCache) return;
    const sym = (selected.holding.symbol || '').toUpperCase();
    const syncedConviction = resolveSyncedRecoveryConviction({
      symbol: sym,
      plPct: selectedPlan.plPct,
      riskTier: selected.positionConfig.riskTier,
      universe: data?.portfolioUniverse ?? [],
      watchlistItems: watchlistScores,
    });
    const summary = summarizeRecyclingPlan(
      buildRecyclingPlanForHolding(selected.holding, selectedPlan.currentPrice, selected.positionConfig, {
        convictionGrade: syncedConviction.convictionGrade,
        stockQualityStatus: syncedConviction.stockQualityStatus,
        fundamentals: selectedFundamentals,
        minRebuyDiscountPercent: recyclingPrefsUi.minRebuyDiscountPercent,
        avoidSellingBelowAverage: recyclingPrefsUi.avoidSellingBelowAverage,
      }),
    );
    setRecyclingSummaryCache((prev) => ({ ...prev, [hid]: summary }));
  }, [selected, selectedPlan, selectedFundamentals, recyclingPrefsUi, watchlistScores, data?.portfolioUniverse]);

  const handleRecoveryPathModeChange = useCallback(
    (mode: RecoveryPathMode) => {
      setRecoveryPathMode(mode);
      setUnifiedDraftOrders(null);
      setRecyclingDraftOrders(null);
      setDraftOrders(null);
      const sym = selected?.holding.symbol;
      if (sym) saveRecoveryPathMode(sym, mode);
    },
    [selected?.holding.symbol],
  );

  const activeRecyclingPlan = unifiedRecoveryPlan?.recyclingActive ?? unifiedRecoveryPlan?.recycling ?? null;
  const activeCashLadderPlan =
    unifiedRecoveryPlan?.cashLadderActive ?? unifiedRecoveryPlan?.cashLadder ?? null;

  const linkedRecoveryPlannedTrades = useMemo(() => {
    const sym = (selected?.holding.symbol ?? '').toUpperCase();
    if (!sym) return [];
    return (data?.plannedTrades ?? []).filter((t) => {
      if ((t.symbol ?? '').toUpperCase() !== sym) return false;
      const n = String(t.notes ?? '').toLowerCase();
      return n.includes('recycle') || n.includes('recycling') || n.includes('recovery');
    });
  }, [data?.plannedTrades, selected?.holding.symbol]);

  const combinedDraftOrders = useMemo(() => {
    if (unifiedDraftOrders?.length) return unifiedDraftOrders;
    if (unifiedRecoveryPlan?.pendingDrafts.length) return unifiedRecoveryPlan.pendingDrafts;
    const rows: RecoveryOrderDraft[] = [];
    if (recyclingDraftOrders?.length) rows.push(...recyclingDraftOrders);
    if (draftOrders?.length) rows.push(...draftOrders);
    return rows.length ? rows : null;
  }, [unifiedDraftOrders, unifiedRecoveryPlan?.pendingDrafts, recyclingDraftOrders, draftOrders]);

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

  const clearStatsError = useCallback(() => {
    setStatsError(null);
    try {
      const stats = calculateRecoveryStatistics();
      setRecoveryStats(stats);
    } catch (error) {
      console.warn('Failed to calculate recovery statistics:', error);
      setRecoveryStats(null);
      setStatsError(error instanceof Error ? error.message : 'Failed to load recovery statistics.');
    }
  }, []);
  const selectedCurrencyDeployableCash = selected
    ? (selected.bookCurrency === 'USD' ? deployableCashSAR / sarPerUsd : deployableCashSAR)
    : deployableCashSAR;
  const alternateCurrencyDeployableCash = selected
    ? (selected.bookCurrency === 'USD' ? deployableCashSAR : deployableCashSAR / sarPerUsd)
    : deployableCashSAR / sarPerUsd;
  const isSelected = (holdingId: string) => selectedHoldingId === holdingId;

  const resolveDisplayNameForDraft = useCallback(
    (draft: RecoveryOrderDraft) => {
      const sym = draft.symbol.toUpperCase();
      const fromUniverse = universe.find((u: { ticker?: string }) => (u.ticker ?? '').toUpperCase() === sym)?.name;
      if (fromUniverse && String(fromUniverse).trim()) return String(fromUniverse).trim();
      if (selected?.holding?.symbol?.toUpperCase() === sym && selected.holding.name) return String(selected.holding.name).trim();
      return sym;
    },
    [universe, selected],
  );

  const openRecordSellForSelected = useCallback(
    (overrides?: { quantity?: number; price?: number }) => {
      if (!selected) {
        toast('Select a losing position first.', 'info');
        return;
      }
      const inv = getPersonalInvestments(data ?? null);
      const opts = buildHoldingSymbolOptions(inv);
      const key = resolveHoldingOptionKeyFromSymbol(
        opts,
        selected.holding.symbol ?? '',
        selected.portfolioId,
      );
      const opt = key ? opts.find((o) => o.optionKey === key) : undefined;
      if (!opt) {
        toast('Could not find this holding in your portfolios.', 'error');
        return;
      }
      navigateToRecordTradeFromHolding(opt, triggerPageAction, {
        tradeType: 'sell',
        quantity: overrides?.quantity ?? opt.quantity,
        price: overrides?.price,
        reason: 'From Recovery Plan',
      });
      if (!triggerPageAction) {
        setActivePage?.('Investments');
      }
      trackAction('recovery-record-sell', 'Recovery Plan');
    },
    [data, selected, setActivePage, triggerPageAction, trackAction],
  );

  const insertRecoveryDraftIntoInvestmentPlan = useCallback(
    async (draft: RecoveryOrderDraft, index: number) => {
      const key = `${draft.symbol}-${index}`;
      setInsertingPlanKey(key);
      try {
        const displayName = resolveDisplayNameForDraft(draft);
        const limitPriceCurrency = selected?.bookCurrency ?? 'USD';
        const invList = data?.personalInvestments ?? data?.investments ?? [];
        const pfRow = selected?.portfolioId ? invList.find((p) => p.id === selected.portfolioId) : undefined;
        const venueAccountId = pfRow?.accountId ? String(pfRow.accountId).trim() : undefined;
        const payload = recoveryOrderDraftToPlannedTrade(draft, {
          displayName,
          planCurrency,
          sarPerUsd,
          limitPriceCurrency,
          portfolioId: selected?.portfolioId,
          accountId: venueAccountId,
        });
        if (plannedTradeMatchesRecoveryDraft(data?.plannedTrades ?? [], payload)) {
          toast('This limit is already in Trade plans.', 'info');
          return;
        }
        const v = validatePlannedTrade(payload);
        if (!v.valid) {
          toast(v.errors.join('\n'), 'error');
          return;
        }
        const ok = await addPlannedTrade(payload);
        if (ok) toast(`${payload.symbol} added to Trade plans (Investment Plan tab).`, 'success');
        trackAction('recovery-draft-to-investment-plan', 'Recovery Plan');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not add to Investment Plan.', 'error');
      } finally {
        setInsertingPlanKey(null);
      }
    },
    [addPlannedTrade, data?.plannedTrades, data?.personalInvestments, data?.investments, planCurrency, resolveDisplayNameForDraft, sarPerUsd, selected?.bookCurrency, selected?.portfolioId, trackAction],
  );

  const handleRecyclingPrefsChange = useCallback((patch: Partial<PositionRecyclingPrefsUi>) => {
    setRecyclingPrefsUi((prev) => {
      const next = { ...prev, ...patch };
      const sym = selected?.holding.symbol;
      if (sym) {
        saveRecyclingPrefs(sym, {
          convictionGrade: next.convictionGrade,
          stockQualityStatus: next.stockQualityStatus,
          minRebuyDiscountPercent: next.minRebuyDiscountPercent,
          avoidSellingBelowAverage: next.avoidSellingBelowAverage,
          allowSellNearLoss: true,
        });
      }
      return next;
    });
    const hid = selected?.holding.id;
    if (hid) {
      setRecyclingSummaryCache((prev) => {
        if (!(hid in prev)) return prev;
        const next = { ...prev };
        delete next[hid];
        return next;
      });
    }
  }, [selected?.holding.symbol, selected?.holding.id]);

  const handleGenerateUnifiedDrafts = useCallback(() => {
    if (!unifiedRecoveryPlan?.pendingDrafts.length) {
      toast('No pending recovery tranches to draft.', 'info');
      return;
    }
    setUnifiedDraftOrders(unifiedRecoveryPlan.pendingDrafts);
    setRecyclingDraftOrders(
      unifiedRecoveryPlan.pendingDrafts.filter(
        (d) => d.trancheKind === 'recycle_sell' || d.trancheKind === 'recycle_rebuy',
      ),
    );
    setDraftOrders(
      unifiedRecoveryPlan.pendingDrafts.filter((d) => d.trancheKind === 'ladder_buy'),
    );
    trackAction('generate-unified-recovery-drafts', 'Recovery Plan');
    const label = recoveryPathMode === 'recycling' ? 'recycling' : 'buy ladder';
    toast(`${unifiedRecoveryPlan.pendingDrafts.length} ${label} draft order(s) ready.`, 'success');
  }, [unifiedRecoveryPlan, recoveryPathMode, trackAction]);

  const handleSaveRecyclingPlan = useCallback(() => {
    const planToSave = activeRecyclingPlan;
    if (!planToSave) return;
    saveRecyclingExecutionFromPlan(planToSave);
    trackAction('save-recycling-plan', 'Recovery Plan');
    toast('Recycling plan saved to history.', 'success');
  }, [activeRecyclingPlan, trackAction]);

  const handleExportRecyclingJson = useCallback(() => {
    if (!activeRecyclingPlan) return;
    const blob = new Blob([exportRecyclingPlanJson(activeRecyclingPlan)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recycling-${activeRecyclingPlan.ticker}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeRecyclingPlan]);

  const insertAllRecoveryDraftsIntoInvestmentPlan = useCallback(async () => {
    if (!combinedDraftOrders?.length) return;
    setInsertingPlanKey('__all__');
    let added = 0;
    let skipped = 0;
    try {
      const seen = new Set<string>();
      const existing = [...(data?.plannedTrades ?? [])];
      for (let i = 0; i < combinedDraftOrders.length; i++) {
        const d = combinedDraftOrders[i];
        const displayName = resolveDisplayNameForDraft(d);
        const limitPriceCurrency = selected?.bookCurrency ?? 'USD';
        const invList = data?.personalInvestments ?? data?.investments ?? [];
        const pfRow = selected?.portfolioId ? invList.find((p) => p.id === selected.portfolioId) : undefined;
        const venueAccountId = pfRow?.accountId ? String(pfRow.accountId).trim() : undefined;
        const payload = recoveryOrderDraftToPlannedTrade(d, {
          displayName,
          planCurrency,
          sarPerUsd,
          limitPriceCurrency,
          portfolioId: selected?.portfolioId,
          accountId: venueAccountId,
        });
        const dedupeKey = `${payload.symbol}|${payload.tradeType}|${payload.targetValue}|${payload.quantity}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        if (plannedTradeMatchesRecoveryDraft(existing, payload)) {
          skipped += 1;
          continue;
        }
        const v = validatePlannedTrade(payload);
        if (!v.valid) {
          toast(`${payload.symbol}: ${v.errors[0] ?? 'Invalid plan'}`, 'error');
          continue;
        }
        const inserted = await addPlannedTrade(payload);
        if (inserted) {
          existing.push({ id: `local-${i}`, user_id: '', ...payload } as PlannedTrade);
          added += 1;
        }
      }
      if (added > 0) {
        toast(`Added ${added} trade plan${added === 1 ? '' : 's'}.${skipped ? ` ${skipped} already existed.` : ''}`, 'success');
        trackAction('recovery-draft-to-investment-plan-batch', 'Recovery Plan');
        onNavigateToTab?.('Investment Plan');
      } else if (skipped > 0) {
        toast('All matching limits are already in Trade plans.', 'info');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add plans.', 'error');
    } finally {
      setInsertingPlanKey(null);
    }
  }, [
    addPlannedTrade,
    data?.plannedTrades,
    data?.personalInvestments,
    data?.investments,
    combinedDraftOrders,
    onNavigateToTab,
    planCurrency,
    resolveDisplayNameForDraft,
    sarPerUsd,
    selected?.bookCurrency,
    selected?.portfolioId,
    trackAction,
  ]);

  const whatIfSimulation = useMemo(() => {
    if (!selected || !selectedPlan) return null;
    const spend = parseFloat(whatIfSpend);
    const price = parseFloat(whatIfPrice);
    if (!Number.isFinite(spend) || spend <= 0 || !Number.isFinite(price) || price <= 0) return null;
    const sh = Number(selected.holding.quantity) || 0;
    const ac = Number(selected.holding.avgCost) || 0;
    const qtyAdd = Math.floor(spend / price);
    if (qtyAdd <= 0) return { error: 'Buy amount is too small for that price (zero shares).' as const };
    const ladder = [
      {
        level: 1 as const,
        qty: qtyAdd,
        price,
        cost: qtyAdd * price,
        weightPct: 100,
      },
    ];
    const { newShares, newAvgCost } = computeNewAverage(sh, ac, ladder);
    const deploy =
      selected.bookCurrency === 'USD' ? deployableCashSAR / sarPerUsd : deployableCashSAR;
    const cashSpend = qtyAdd * price;
    const overBudget = cashSpend > deploy + 1e-6;
    return { newShares, newAvgCost, addedShares: qtyAdd, spend: cashSpend, overBudget };
  }, [selected, selectedPlan, whatIfSpend, whatIfPrice, deployableCashSAR, sarPerUsd]);


  const selectedRecoveryBrief = useMemo(() => {
    if (!selected || !selectedPlan || !unifiedRecoveryPlan) return null;
    const brief =
      recoveryPathMode === 'recycling'
        ? buildRecyclingPathBrief({
            plPct: selectedPlan.plPct,
            recycling: unifiedRecoveryPlan.recycling,
            summary: unifiedRecoveryPlan.recyclingSummary,
            conviction: unifiedRecoveryPlan.conviction,
          })
        : buildRecoveryLadderPathBrief({
            plPct: selectedPlan.plPct,
            lossTriggerPct: selected.positionConfig.lossTriggerPct,
            deployableCash: selectedCurrencyDeployableCash,
            bookCurrency: selected.bookCurrency ?? 'USD',
            ladder: unifiedRecoveryPlan.cashLadder,
          });
    const aiNote = selected.aiNotes ? ` Note: ${selected.aiNotes}` : '';
    return `${brief.headline} — ${brief.oneLiner}${aiNote}`;
  }, [
    selected,
    selectedPlan,
    unifiedRecoveryPlan,
    recoveryPathMode,
    selectedCurrencyDeployableCash,
  ]);

  useEffect(() => {
    if (recoveryDisplayLang !== 'ar' || !aiActionsEnabled) {
      setRecoveryBriefAr(null);
      setRecoveryNotesAr(null);
      setRecoveryTranslateErr(null);
      return;
    }
    const brief = selectedRecoveryBrief?.trim();
    const notes = selected?.aiNotes?.trim();
    if (!brief && !notes) return;
    let cancelled = false;
    setRecoveryTranslating(true);
    setRecoveryTranslateErr(null);
    (async () => {
      try {
        if (brief) {
          const b = await translateFinancialInsightToArabic(brief);
          if (!cancelled) setRecoveryBriefAr(b);
        } else {
          setRecoveryBriefAr(null);
        }
        if (notes) {
          const n = await translateFinancialInsightToArabic(notes);
          if (!cancelled) setRecoveryNotesAr(n);
        } else {
          setRecoveryNotesAr(null);
        }
      } catch (e) {
        if (!cancelled) setRecoveryTranslateErr(formatAiError(e));
      } finally {
        if (!cancelled) setRecoveryTranslating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recoveryDisplayLang, aiActionsEnabled, selectedRecoveryBrief, selected?.aiNotes, selected?.holding?.id]);

  const refreshAiRecoveryConfig = useCallback(async () => {
    if (!selected) return;
    trackAction('ai-suggest-recovery', 'Recovery Plan');
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
        deployableCash: selected.bookCurrency === 'USD' ? deployableCashSAR / sarPerUsd : deployableCashSAR,
        currentPrice: selected.plan.currentPrice,
        avgCost: selected.holding.avgCost ?? 0,
      });
      setAiRecoveryBySymbol(prev => ({ ...prev, [sym]: suggestion }));
    } catch (error) {
      setAiRecoveryError(formatAiError(error));
    } finally {
      setIsAiRecoveryLoading(false);
    }
  }, [selected, deployableCashSAR, sarPerUsd, trackAction]);


  const applyAiToAllQualifiedPositions = useCallback(async () => {
    if (qualifiedPositions.length === 0) return;
    trackAction('ai-apply-all-recovery', 'Recovery Plan');
    setIsBulkAiRecoveryLoading(true);
    setAiRecoveryError(null);
    try {
      const updates = await Promise.all(
        qualifiedPositions.slice(0, 12).map(async (position) => {
          const sym = (position.holding.symbol || '').toUpperCase();
          const deployableCash = position.bookCurrency === 'USD' ? deployableCashSAR / sarPerUsd : deployableCashSAR;
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
  }, [qualifiedPositions, deployableCashSAR, sarPerUsd, trackAction]);

  useEffect(() => {
    setWhatIfSpend('');
    setWhatIfPrice('');
    setRecyclingDraftOrders(null);
    setDraftOrders(null);
    setUnifiedDraftOrders(null);
  }, [selected?.holding?.id]);

  useEffect(() => {
    const sym = selected?.holding.symbol;
    if (!sym) return;
    const loaded = loadRecyclingPrefs(sym);
    setRecyclingPrefsUi({
      convictionGrade: loaded?.convictionGrade,
      stockQualityStatus: loaded?.stockQualityStatus,
      minRebuyDiscountPercent: loaded?.minRebuyDiscountPercent ?? 10,
      avoidSellingBelowAverage: loaded?.avoidSellingBelowAverage ?? false,
    });
  }, [selected?.holding?.symbol]);

  useEffect(() => {
    if (!selectedHoldingId || !selectedPlan || selectedPlan.plPct >= 0) return;
    const t = window.setTimeout(() => {
      document.getElementById('recovery-unified-plan')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [selectedHoldingId, selectedPlan?.plPct]);

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

  const handlePrimaryDraftAction = useCallback(() => {
    if (!selected || !selectedPlan) return;
    if (unifiedRecoveryPlan) {
      handleGenerateUnifiedDrafts();
      if (recoveryPathMode === 'recovery_ladder' && (activeCashLadderPlan?.qualified ?? selectedPlan.qualified)) {
        handleGenerateRecoveryPlan(
          selected.holding,
          activeCashLadderPlan ?? selectedPlan,
          selected.positionConfig,
        );
      }
      return;
    }
    if (recoveryPathMode === 'recycling') {
      toast('Open the recovery approach panel and use Generate recycling drafts.', 'info');
      return;
    }
    const ladderPlan = activeCashLadderPlan ?? selectedPlan;
    if (!ladderPlan.qualified || !(ladderPlan.ladder ?? []).length) {
      toast('Buy ladder is not ready — loss may be above trigger or cash limits apply.', 'info');
      return;
    }
    trackAction('generate-draft-orders', 'Recovery Plan');
    try {
      const drafts = orderDraftGenerator(ladderPlan, true);
      if (!drafts?.length) {
        toast('Could not generate ladder drafts.', 'error');
        return;
      }
      setDraftOrders(drafts);
      handleGenerateRecoveryPlan(selected.holding, ladderPlan, selected.positionConfig);
      toast(`${drafts.length} ladder draft(s) ready.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to generate drafts.', 'error');
    }
  }, [
    selected,
    selectedPlan,
    unifiedRecoveryPlan,
    recoveryPathMode,
    activeCashLadderPlan,
    handleGenerateUnifiedDrafts,
    handleGenerateRecoveryPlan,
  ]);

  if (showBlockingLoader) {
    return (
      <div className="page-container flex justify-center items-center min-h-[24rem]" aria-busy="true">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading recovery plan" />
      </div>
    );
  }

  return (
    <div className="page-container min-h-[40rem] space-y-8 sm:space-y-10">
      {/* Hero */}
      <section className="section-card p-6 sm:p-8">
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg shrink-0">
                <span className="text-white font-bold text-xl">R</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-3xl font-bold text-slate-900 flex flex-wrap items-center gap-2">
                  Recovery Plan (Averaging / Correction Engine)
                  <InfoHint text="Two tools for underwater positions: (1) Recovery ladder — optional new cash buys when loss exceeds your trigger. (2) Position recycling — sell part of the holding on rebounds and rebuy lower using only that sale cash (core shares never sold). Both integrate with Investment Plan limits." />
                </h2>
                <p className="text-lg text-slate-600 mt-2">
                  Buy ladders, position recycling, and exit targets — with guardrails and Investment Plan export
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 ml-auto">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-md border ${
                  !aiHealthChecked
                    ? 'bg-slate-100 text-slate-700 border-slate-200'
                    : isAiAvailable
                      ? 'bg-gradient-to-r from-emerald-100 to-emerald-200 text-emerald-800 border-emerald-300'
                      : 'bg-gradient-to-r from-amber-100 to-amber-200 text-amber-800 border-amber-300'
                }`}
              >
                {!aiHealthChecked ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" aria-hidden />
                    Checking AI…
                    <InfoHint text="Status unknown until the app finishes talking to the AI proxy. This is not the same as “off”—wait a moment, or confirm Netlify env keys if it stays here." />
                  </>
                ) : isAiAvailable ? (
                  <>
                    <CheckCircleIcon className="h-5 w-5 shrink-0" />
                    AI ready
                    <InfoHint text="At least one backend AI provider is configured (e.g. Gemini, Claude, OpenAI, Grok). Optional AI optimize buttons can call the model; the ladder and guardrails still work without AI." />
                  </>
                ) : (
                  <>
                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                    AI unavailable
                    <InfoHint text="No AI provider key reported by the proxy, or all providers failed. Configure GEMINI_API_KEY, OPENAI_API_KEY, or similar in Netlify. Recovery math and rules still run without AI." />
                  </>
                )}
              </span>
              {recoveryStats && recoveryStats.totalExecutions > 0 && (
                <button
                  type="button"
                  onClick={() => setShowStats(!showStats)}
                  className="btn-ghost"
                >
                  {showStats ? 'Hide' : 'Show'} Performance Stats
                </button>
              )}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 sm:p-6 border border-slate-200">
            <p className="text-slate-700 leading-relaxed">
              Positions in loss are listed below. Open a row and <strong>choose one approach</strong>:{' '}
              <strong className="text-teal-800">position recycling</strong> (sell/rebuy with sale cash only — no new deposits) or a{' '}
              <strong className="text-violet-800">recovery buy ladder</strong> (staged buys from deployable cash).
              Plain-language summaries explain each path. Fills in Investment Plan recompute the remaining steps.
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
              <li className="flex items-start gap-3">
                <div className="w-2 h-2 bg-teal-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <strong className="text-slate-800">Position recycling</strong>{' '}
                  <InfoHint text="Core vs recycle split by conviction (A/B/C). Sell 3 tranches on rebounds; rebuy ~10%+ lower with same cash only. No margin, no full exit, no new deposits." />{' '}
                  — pick this OR the buy ladder per position (not both at once).
                </div>
              </li>
            </ul>
          </div>
        </details>
      </section>

      {/* Inline error when stats or execution fail */}
      {statsError && (
        <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900" role="alert">
          <p className="text-sm font-medium">{statsError}</p>
          <button type="button" onClick={clearStatsError} className="mt-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800">
            Retry
          </button>
        </div>
      )}

      {/* Enhanced Performance Statistics */}
      {showStats && recoveryStats && recoveryStats.totalExecutions > 0 && (
        <SectionCard title="Recovery Plan Performance Statistics" collapsible collapsibleSummary="Stats and metrics" defaultExpanded>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Success Rate</p>
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-primary font-bold text-sm">%</span>
                </div>
              </div>
              <p className="text-3xl font-bold text-dark tabular-nums">{(recoveryStats.successRate * 100).toFixed(1)}%</p>
              <p className="text-sm text-slate-600 mt-2">{recoveryStats.totalExecutions} total executions</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Avg Recovery Time</p>
                <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center">
                  <span className="text-success font-bold text-sm">⏱</span>
                </div>
              </div>
              <p className="text-3xl font-bold text-dark tabular-nums">{recoveryStats.avgRecoveryTimeDays.toFixed(0)}</p>
              <p className="text-sm text-slate-600 mt-2">days</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Avg ROI</p>
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <span className="text-amber-700 font-bold text-sm">📈</span>
                </div>
              </div>
              <p className={`text-3xl font-bold tabular-nums ${
                recoveryStats.avgRoi >= 0 ? 'text-success' : 'text-danger'
              }`}>
                {recoveryStats.avgRoi >= 0 ? '+' : ''}{(recoveryStats.avgRoi * 100).toFixed(1)}%
              </p>
              <p className="text-sm text-slate-600 mt-2">on recovery capital</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Capital Deployed</p>
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                  <span className="text-slate-700 font-bold text-sm">💰</span>
                </div>
              </div>
              <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(recoveryStats.totalCapitalDeployed)}</p>
              <p className="text-sm text-slate-600 mt-2">Total recovered: {formatCurrencyString(recoveryStats.totalRecovered)}</p>
            </div>
          </div>
          {Object.keys(recoveryStats.bySymbol).length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">Performance by Symbol</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(recoveryStats.bySymbol).slice(0, 6).map(([symbol, stats]) => (
                  <div key={symbol} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
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

      {/* KPI cards */}
      <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="section-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Losing positions</p>
            <div className="w-10 h-10 bg-danger/10 rounded-xl flex items-center justify-center">
              <span className="text-danger font-bold text-lg">⬇</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-dark tabular-nums">{losingPositions.length}</p>
          <p className="text-sm text-slate-600 mt-1">Positions requiring attention</p>
        </div>
        <div className="section-card border-teal-100/80">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Recycling ready</p>
            <div className="w-10 h-10 bg-teal-500/10 rounded-xl flex items-center justify-center">
              <span className="text-teal-700 font-bold text-lg">↻</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-dark tabular-nums">{recyclingReadyCount}</p>
          <p className="text-sm text-slate-600 mt-1">Losers with an active sell/rebuy ladder</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Recovery eligible</p>
            <div className="w-10 h-10 bg-success/10 rounded-xl flex items-center justify-center">
              <span className="text-success font-bold text-lg">✓</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-dark tabular-nums">{qualifiedPositions.length}</p>
          <p className="text-sm text-slate-600 mt-1">Positions ready for buy ladder</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Deployable cash (SAR + USD)</p>
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <span className="text-primary font-bold text-lg">💰</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(deployableCashSAR)}</p>
          <p className="text-sm text-slate-600 mt-1">Approximate total across currencies</p>
          <p className="text-xs text-slate-500 mt-2">Per-position values below use each portfolio&apos;s base currency</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
              Est. recovery buys (SAR)
              <InfoHint text="Sum of planned ladder costs for every recovery-eligible position, converted to SAR using your FX rate. Approximate; actual fills depend on prices." />
            </p>
            <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <span className="text-indigo-700 font-bold text-lg">∑</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">
            {formatCurrencyString(estimatedRecoveryDeploymentSAR, { inCurrency: 'SAR', digits: 0 })}
          </p>
          <p className="text-sm text-slate-600 mt-1">If all suggested ladders were fully executed</p>
        </div>
      </div>

      {/* Enhanced Losing positions table */}
      <SectionCard title="Positions in loss" className="overflow-hidden" collapsible collapsibleSummary="Holdings to review" defaultExpanded>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-gradient-to-r from-slate-50 to-slate-100">
              <tr>
                <th className="px-6 py-4 text-left font-bold text-slate-700 uppercase tracking-wider">Symbol</th>
                <th className="px-6 py-4 text-right font-bold text-slate-700 uppercase tracking-wider">P/L %</th>
                <th className="px-6 py-4 text-right font-bold text-slate-700 uppercase tracking-wider">Cost / Value</th>
                <th className="px-6 py-4 text-center font-bold text-slate-700 uppercase tracking-wider">
                  Paths
                  <InfoHint text="♻ Recycling = sell/rebuy with sale cash only. $ Ladder = staged buys from deployable cash. Pick one approach after opening the plan." />
                </th>
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
                losingPositions.map(({ holding, portfolioName, bookCurrency, plan, recyclingSummary, priceProvenance, positionConfig }) => (
                  <tr key={holding.id} className={`${isSelected(holding.id) ? 'bg-primary/10 border-l-4 border-primary' : 'hover:bg-slate-50'} transition-colors duration-150`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg flex items-center justify-center">
                          <span className="font-bold text-slate-700 text-sm">{(holding.symbol ?? '').slice(0, 2)}</span>
                        </div>
                        <div>
                          {holding.symbol ? (
                            <ResolvedSymbolLabel
                              symbol={holding.symbol}
                              storedName={holding.name}
                              names={recoveryCompanyNames}
                              layout="stacked"
                              symbolClassName="font-bold text-slate-900 text-lg"
                              companyClassName="text-sm text-slate-600 font-medium"
                            />
                          ) : (
                            <span className="font-bold text-slate-900 text-lg">—</span>
                          )}
                          <span className="block text-sm text-slate-500">{portfolioName}</span>
                          {priceProvenance && (
                            <span
                              className={`mt-1 inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                priceProvenance.quoteFreshness?.isStale
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-700'
                              }`}
                              title={[
                                `Price source: ${priceProvenance.source}`,
                                `Quote updated: ${priceProvenance.quoteFreshness?.updatedAtIso ?? 'unknown'}`,
                                `Quote age (min): ${priceProvenance.quoteFreshness?.ageMinutes != null ? priceProvenance.quoteFreshness.ageMinutes.toFixed(1) : 'unknown'}`,
                                priceProvenance.quoteFreshness?.isStale ? 'Stale quote: refresh prices for higher confidence.' : 'Quote fresh enough for decisions.',
                              ].join('\n')}
                            >
                              <span>{priceProvenance.quoteFreshness?.isStale ? 'Stale' : 'Fresh'}</span>
                              <span className="text-slate-400">·</span>
                              <span>{String(priceProvenance.source).split('_').join(' ')}</span>
                            </span>
                          )}
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
                        <span>{formatCurrencyString(plan.costBasis, { inCurrency: bookCurrency })}</span>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span>→</span>
                          <span>{formatCurrencyString(plan.marketValue, { inCurrency: bookCurrency })}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex flex-col items-center gap-1.5 text-xs font-semibold">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 border ${
                            recyclingSummary?.planAvailable
                              ? 'bg-teal-50 text-teal-900 border-teal-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                          title="Position recycling"
                        >
                          <span aria-hidden>♻</span>
                          {recyclingSummary?.planAvailable
                            ? `${recyclingSummary.trancheCount} steps`
                            : recyclingSummary
                              ? recyclingSummary.planStatus === 'exit_review'
                                ? 'Exit review'
                                : 'Blocked'
                              : 'Open plan'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 border ${
                            plan.qualified
                              ? 'bg-violet-50 text-violet-900 border-violet-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                          title="Recovery buy ladder"
                        >
                          <span aria-hidden>$</span>
                          {plan.qualified
                            ? 'Ladder ready'
                            : plan.plPct <= -positionConfig.lossTriggerPct
                              ? 'Blocked'
                              : 'Need deeper loss'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedHoldingId(isSelected(holding.id) ? null : holding.id)}
                        className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors duration-200 shadow-sm hover:shadow-md ${
                          isSelected(holding.id)
                            ? 'bg-slate-700 text-white hover:bg-slate-800'
                            : plan.qualified
                              ? 'bg-primary text-white hover:bg-secondary'
                              : 'bg-teal-700 text-white hover:bg-teal-800'
                        }`}
                      >
                        {isSelected(holding.id)
                          ? 'Hide plan'
                          : plan.qualified
                            ? 'Open plan'
                            : 'Open plan'}
                      </button>
                      {!plan.qualified && plan.reason && (
                        <p className="text-[11px] text-slate-500 mt-1 max-w-[140px] mx-auto" title={plan.reason}>
                          Buy ladder: {plan.reason}
                        </p>
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
        <SectionCard
          title={`${selected.holding.symbol ? formatSymbolWithCompany(selected.holding.symbol, selected.holding.name, recoveryCompanyNames) : 'Holding'} — Recovery plan`}
          className="space-y-7"
          collapsible
          collapsibleSummary="Recycling, ladder, targets"
          defaultExpanded
        >
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
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto order-first sm:order-last w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => openRecordSellForSelected()}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                title="Opens Record Trade with this holding pre-selected — no typing the symbol"
              >
                Record sell
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">📁</span>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Portfolio: {selected.portfolioName}
                </p>
                <p className="text-xs text-slate-600">
                  Portfolio base (book): <strong>{selected.bookCurrency ?? 'USD'}</strong> — prices and P/L are computed in this currency; live USD quotes are converted with your SAR/USD rate.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryDisplayLang('en');
                    try {
                      localStorage.setItem(RECOVERY_AI_LANG_KEY, 'en');
                    } catch {
                      /* ignore */
                    }
                  }}
                  className={`rounded-md px-2.5 py-1.5 ${recoveryDisplayLang === 'en' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'}`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryBriefAr(null);
                    setRecoveryNotesAr(null);
                    setRecoveryDisplayLang('ar');
                    try {
                      localStorage.setItem(RECOVERY_AI_LANG_KEY, 'ar');
                    } catch {
                      /* ignore */
                    }
                  }}
                  disabled={aiOptimizeDisabled}
                  className={`rounded-md px-2.5 py-1.5 ${recoveryDisplayLang === 'ar' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'} disabled:opacity-50`}
                                title={aiOptimizeDisabled ? 'Wait for AI check or configure AI for Arabic translation' : 'Translate AI summary to Arabic'}
                >
                  العربية
                </button>
              </div>
              <button 
                type="button" 
                onClick={refreshAiRecoveryConfig} 
                disabled={aiOptimizeDisabled || isAiRecoveryLoading} 
                className="px-4 py-2.5 rounded-xl border-2 border-primary/30 text-primary text-sm font-bold hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                title={aiOptimizeDisabled ? 'Configure AI in Netlify or wait for health check' : 'Run AI on selected position'}
              >
                {isAiRecoveryLoading ? 'Optimizing…' : 'AI optimize selected'}
              </button>
              <button 
                type="button" 
                onClick={applyAiToAllQualifiedPositions} 
                disabled={aiOptimizeDisabled || isBulkAiRecoveryLoading || qualifiedPositions.length === 0} 
                className="px-4 py-2.5 rounded-xl border-2 border-emerald-300 text-emerald-700 text-sm font-bold hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                title={aiOptimizeDisabled ? 'Configure AI in Netlify or wait for health check' : 'Run AI on all qualifying positions'}
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
                <div className="min-w-0 flex-1">
                  {recoveryTranslating && recoveryDisplayLang === 'ar' && (
                    <p className="text-xs text-indigo-600 mb-2">Translating summary to Arabic…</p>
                  )}
                  {recoveryTranslateErr && (
                    <p className="text-xs text-rose-600 mb-2">{recoveryTranslateErr}</p>
                  )}
                  <p
                    className="text-sm text-indigo-800 font-medium leading-relaxed"
                    dir={recoveryDisplayLang === 'ar' ? 'rtl' : 'ltr'}
                    lang={recoveryDisplayLang === 'ar' ? 'ar' : 'en'}
                  >
                    {recoveryDisplayLang === 'ar' && recoveryBriefAr
                      ? recoveryBriefAr
                      : selectedRecoveryBrief}
                  </p>
                </div>
              </div>
            </div>
          )}
          {selected.aiNotes && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">✓</span>
                </div>
                <p
                  className="text-sm text-emerald-800 font-medium leading-relaxed"
                  dir={recoveryDisplayLang === 'ar' ? 'rtl' : 'ltr'}
                  lang={recoveryDisplayLang === 'ar' ? 'ar' : 'en'}
                >
                  {recoveryDisplayLang === 'ar' && recoveryNotesAr ? recoveryNotesAr : selected.aiNotes}
                </p>
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


          {selectedPlan.plPct < 0 && selectedPlan.currentPrice > 0 && unifiedRecoveryPlan ? (
            <SectionCard
              id="recovery-unified-plan"
              title="Recovery approach"
              infoHintKey="key.recovery.positionRecycling"
              className="border-indigo-200/80"
              collapsible
              collapsibleSummary={
                recoveryPathMode === 'recycling'
                  ? `Recycling · ${unifiedRecoveryPlan.executionProgress}`
                  : `Buy ladder · ${unifiedRecoveryPlan.executionProgress}`
              }
              defaultExpanded
            >
              {isSelectedFundamentalsLoading && (
                <p className="text-xs text-slate-500 mb-3">Loading 52-week range for sell/rebuy context…</p>
              )}
              {selectedFundamentalsError && (
                <p className="text-xs text-amber-700 mb-3">Market context unavailable: {selectedFundamentalsError}</p>
              )}
              {getRecyclingExecutionsBySymbol(selected.holding.symbol ?? '').length > 0 && (
                <p className="text-xs text-teal-800 mb-3">
                  {getRecyclingExecutionsBySymbol(selected.holding.symbol ?? '').length} saved recycling plan(s) for this symbol.
                </p>
              )}
              <UnifiedRecoveryPanel
                plan={unifiedRecoveryPlan}
                pathMode={recoveryPathMode}
                onPathModeChange={handleRecoveryPathModeChange}
                plPct={selectedPlan.plPct}
                lossTriggerPct={selected.positionConfig.lossTriggerPct}
                deployableCash={selectedCurrencyDeployableCash}
                formatMoney={(n) =>
                  formatCurrencyString(n, { inCurrency: selected.bookCurrency ?? 'USD', digits: 2 })
                }
                formatCurrency={(n, cur) =>
                  formatCurrencyString(n, { inCurrency: (cur as TradeCurrency) ?? selected.bookCurrency ?? 'USD' })
                }
                bookCurrency={selected.bookCurrency ?? 'USD'}
                recyclingPrefs={recyclingPrefsUi}
                onRecyclingPrefsChange={handleRecyclingPrefsChange}
                activeRecyclingPlan={activeRecyclingPlan}
                activeCashLadder={activeCashLadderPlan}
                onGenerateDrafts={handleGenerateUnifiedDrafts}
                onPushDrafts={insertAllRecoveryDraftsIntoInvestmentPlan}
                onSaveRecycling={handleSaveRecyclingPlan}
                onExportRecyclingJson={handleExportRecyclingJson}
                isPushing={insertingPlanKey === '__all__' || insertingPlanKey === '__recycle__'}
                linkedPlannedTrades={linkedRecoveryPlannedTrades}
                onOpenInvestmentPlan={() => onNavigateToTab?.('Investment Plan')}
              />
            </SectionCard>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
              Recovery plan needs a valid live price and a position in loss. Refresh quotes on Portfolios, then reopen this row.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Deployable cash ({selected.bookCurrency ?? 'USD'})</p>
                <div className="w-8 h-8 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">💰</span>
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 tabular-nums">{formatCurrencyString(selectedCurrencyDeployableCash, { inCurrency: selected.bookCurrency ?? 'USD' })}</p>
            </div>
            <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-blue-700 uppercase tracking-wider">Cross-currency reference ({selected?.bookCurrency === 'USD' ? 'SAR' : 'USD'})</p>
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">🔄</span>
                </div>
              </div>
              <p className="text-2xl font-black text-blue-900 tabular-nums">{formatCurrencyString(alternateCurrencyDeployableCash, { inCurrency: (selected?.bookCurrency === 'USD' ? 'SAR' : 'USD') as TradeCurrency })}</p>
            </div>
          </div>
          {aiHealthChecked && !isAiAvailable && (
            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 sm:p-6 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">⚠</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-800 mb-1">AI not configured</p>
                  <p className="text-sm text-amber-700 leading-relaxed">Optional AI tuning is off until you add an API key on the server. The recovery ladder, budgets, and guardrails still run with rule-based parameters—use the page normally.</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
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
                      inCurrency: selected.bookCurrency ?? 'USD',
                      digits: HOLDING_PER_UNIT_DECIMALS,
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 font-medium">Price:</span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatCurrencyString(selectedPlan.currentPrice, {
                      inCurrency: selected.bookCurrency ?? 'USD',
                      digits: HOLDING_PER_UNIT_DECIMALS,
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
                        inCurrency: selected.bookCurrency ?? 'USD',
                      })} ({selectedPlan.plPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {recoveryPathMode === 'recovery_ladder' && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6 shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">After ladder fills <InfoHint text="New average cost and share count from the active buy ladder (recomputed when Investment Plan tranches fill)." /></p>
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-lg">📈</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-emerald-600 font-medium">New Shares:</span>
                  <span className="text-sm font-bold text-emerald-900">
                    {activeCashLadderPlan?.newShares ?? selectedPlan.newShares}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-emerald-600 font-medium">New Avg Cost:</span>
                  <span className="text-sm font-bold text-emerald-900">
                    {formatCurrencyString(activeCashLadderPlan?.newAvgCost ?? selectedPlan.newAvgCost ?? 0, {
                      inCurrency: selected.bookCurrency ?? 'USD',
                    })}
                  </span>
                </div>
                <div className="border-t border-emerald-200 pt-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-emerald-600 font-medium">Planned Recovery Cost:</span>
                    <span className="text-lg font-black text-emerald-900 tabular-nums">
                      {formatCurrencyString(activeCashLadderPlan?.totalPlannedCost ?? selectedPlan.totalPlannedCost ?? 0, {
                        inCurrency: selected.bookCurrency ?? 'USD',
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
            )}
          </div>

          {recoveryPathMode === 'recovery_ladder' && (
          <div className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6 shadow-md">
            <h4 className="text-sm font-bold text-violet-900 uppercase tracking-wider mb-2 flex items-center gap-2">
              Try averaging down (what-if)
              <InfoHint text="See how one extra buy at a limit price would change your average cost. Amounts are in your portfolio base currency. Does not place real orders." />
            </h4>
            <p className="text-xs text-violet-800/90 mb-4">
              Enter gross cash to deploy and the limit price per share (same currency as your portfolio: {selected.bookCurrency}).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-violet-900 mb-1">Buy amount (gross)</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={whatIfSpend}
                  onChange={(e) => setWhatIfSpend(e.target.value)}
                  className="w-full rounded-lg border border-violet-200 px-3 py-2 text-sm"
                  placeholder="e.g. 35000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-violet-900 mb-1">Limit price per share</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={whatIfPrice}
                  onChange={(e) => setWhatIfPrice(e.target.value)}
                  className="w-full rounded-lg border border-violet-200 px-3 py-2 text-sm"
                  placeholder="e.g. 150.12"
                />
              </div>
            </div>
            {whatIfSimulation && 'error' in whatIfSimulation && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{whatIfSimulation.error}</p>
            )}
            {whatIfSimulation && !('error' in whatIfSimulation) && (
              <div className="rounded-xl bg-white/80 border border-violet-100 p-4 space-y-2 text-sm">
                <p className="text-violet-900">
                  <span className="font-semibold">New avg cost:</span>{' '}
                  {formatCurrencyString(whatIfSimulation.newAvgCost, { inCurrency: selected.bookCurrency ?? 'USD' })}
                </p>
                <p className="text-violet-800">
                  <span className="font-semibold">Total shares after:</span> {whatIfSimulation.newShares.toLocaleString()} (+{whatIfSimulation.addedShares} shares)
                </p>
                <p className="text-violet-800 tabular-nums">
                  <span className="font-semibold">Cash used:</span>{' '}
                  {formatCurrencyString(whatIfSimulation.spend, { inCurrency: selected.bookCurrency ?? 'USD' })}
                </p>
                {whatIfSimulation.overBudget && (
                  <p className="text-rose-700 font-medium text-sm">
                    This exceeds your total deployable cash shown above (investment platforms only). Lower the amount or add funds first.
                  </p>
                )}
              </div>
            )}
          </div>
          )}

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

          {!unifiedRecoveryPlan && recoveryPathMode === 'recovery_ladder' && (selectedPlan.ladder ?? []).length > 0 && (
          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">Buy ladder (limit orders) <InfoHint text="Up to 3 levels below current price. Use limit orders only; no market orders." /></h4>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Level</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Price</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Cost</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {(selectedPlan.ladder ?? []).map(l => (
                    <tr key={l.level}>
                      <td className="px-3 py-2 font-medium">L{l.level}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrencyString(l.price, { inCurrency: selected.bookCurrency ?? 'USD' })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatCurrencyString(l.cost, { inCurrency: selected.bookCurrency ?? 'USD' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {recoveryPathMode === 'recovery_ladder' && (
          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">Exit targets (optional) <InfoHint text="Target 1/2 and trailing stop based on new average cost after ladder fills. Not used for recycling-only plans." /></h4>
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
                        inCurrency: selected.bookCurrency ?? 'USD',
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
                        inCurrency: selected.bookCurrency ?? 'USD',
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
                        inCurrency: selected.bookCurrency ?? 'USD',
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
          )}

          {recoveryPathMode === 'recovery_ladder' && recoveryTimeline && (
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
              onClick={() => void handlePrimaryDraftAction()}
              disabled={!unifiedRecoveryPlan && recoveryPathMode === 'recycling'}
              className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-secondary font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {recoveryPathMode === 'recycling'
                ? 'Generate recycling drafts'
                : 'Generate ladder drafts & track'}
            </button>
            {setActivePage && (
              <>
                  <button
                    type="button"
                    onClick={() => setActivePage('Market Events')}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium text-sm"
                  >
                    Check Market Events for {selected.holding.symbol ?? 'holding'}
                  </button>
                {onOpenWealthUltra && (
                  <button
                    type="button"
                    onClick={onOpenWealthUltra}
                    className="px-4 py-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 font-medium text-sm inline-flex items-center gap-2"
                  >
                    <PresentationChartLineIcon className="h-5 w-5" />
                    View in Wealth Ultra
                  </button>
                )}
              </>
            )}
          </div>
        </SectionCard>
      )}

      {combinedDraftOrders && combinedDraftOrders.length > 0 && (
        <SectionCard
          title="Draft orders (selected approach)"
          className="space-y-3"
          collapsible
          collapsibleSummary="Limit orders"
          infoHint={
            recoveryPathMode === 'recycling'
              ? 'Sell and rebuy limits for the recycling path only. Add to Trade plans to track execution.'
              : 'Staged buy limits for the recovery ladder only. Add to Trade plans to track execution.'
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              <span className="font-medium text-slate-800">
                {combinedDraftOrders.length} {recoveryPathMode === 'recycling' ? 'recycling' : 'ladder'}
              </span>{' '}
              limit order(s) for your selected approach. Copy, export, or{' '}
              <span className="font-medium text-slate-800">insert into Trade plans</span>.
            </p>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={insertAllRecoveryDraftsIntoInvestmentPlan}
                disabled={insertingPlanKey !== null}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {insertingPlanKey === '__all__' ? 'Adding…' : 'Add all to Trade plans'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const csv = [
                    ['Type', 'Symbol', 'Quantity', 'Limit Price', 'Currency', 'Label'].join(','),
                    ...combinedDraftOrders.map(d => [
                      d.type,
                      d.symbol,
                      d.qty,
                      d.limitPrice,
                      selected?.bookCurrency ?? 'USD',
                      d.label || ''
                    ].join(','))
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `recovery-recycling-orders-${selected?.holding.symbol ?? 'orders'}-${new Date().toISOString().split('T')[0]}.csv`;
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
                  const text = combinedDraftOrders.map((d, i) => 
                    `${i + 1}. ${d.type.toUpperCase()} ${d.symbol} - Qty: ${d.qty}, Limit: ${formatCurrencyString(d.limitPrice, { inCurrency: selected?.bookCurrency ?? 'USD' })}${d.label ? ` (${d.label})` : ''}`
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
            {combinedDraftOrders.map((d, i) => (
              <div
                key={`${d.type}-${d.symbol}-${d.limitPrice}-${i}`}
                className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 p-3 rounded-xl border text-sm ${
                  d.label?.toLowerCase().includes('recycle')
                    ? 'bg-teal-50/80 border-teal-100'
                    : 'bg-slate-50 border-slate-100'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 flex-1">
                  <span className="font-semibold text-slate-800">
                    {d.type} {d.symbol}
                  </span>
                  <span className="text-slate-600 tabular-nums">Qty: {d.qty}</span>
                  <span className="text-slate-600">
                    Limit:{' '}
                    {formatCurrencyString(d.limitPrice, {
                      inCurrency: selected?.bookCurrency ?? 'USD',
                    })}
                  </span>
                  {d.label && <span className="text-slate-500">({d.label})</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto shrink-0">
                  {d.type === 'SELL' && (
                    <button
                      type="button"
                      onClick={() =>
                        openRecordSellForSelected({
                          quantity: d.qty,
                          price: d.limitPrice,
                        })
                      }
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                      title="Record Trade with this holding, quantity, and limit price"
                    >
                      Record sell
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => insertRecoveryDraftIntoInvestmentPlan(d, i)}
                    disabled={insertingPlanKey !== null}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Creates a Trade plan with this symbol, limit price, quantity, and notional (no manual entry)"
                  >
                    {insertingPlanKey === `${d.symbol}-${i}` ? 'Adding…' : 'Add to Trade plans'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `${d.type.toUpperCase()} ${d.symbol} - Qty: ${d.qty}, Limit: ${formatCurrencyString(d.limitPrice, { inCurrency: selected?.bookCurrency ?? 'USD' })}${d.label ? ` (${d.label})` : ''}`;
                      navigator.clipboard.writeText(text).then(() => {
                        // Visual feedback could be added here
                      }).catch(() => {
                        alert('Failed to copy to clipboard.');
                      });
                    }}
                    className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                    title="Copy this order"
                  >
                    Copy
                  </button>
                </div>
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
