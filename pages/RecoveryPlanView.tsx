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

interface RecoveryPlanViewProps {
  onNavigateToTab?: (tab: string) => void;
  onOpenWealthUltra?: () => void;
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
function RecoveryPlanViewContent({ onNavigateToTab, onOpenWealthUltra }: RecoveryPlanViewProps) {
  const ctx = useContext(DataContext)!;
  const { data, getAvailableCashForAccount } = ctx;
  const { exchangeRate } = useCurrency();
  const safeFxRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 3.75;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable } = useAI();

  const allHoldingsWithPortfolio = useMemo(() => {
    const list: { holding: Holding; portfolioName: string; currency: TradeCurrency; accountId?: string }[] = [];
    (data.investments ?? []).forEach((p: InvestmentPortfolio) => {
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
  }, [data.investments]);
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
    const bankCash = (data.accounts ?? [])
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((s, a) => s + Math.max(0, Number(a.balance) || 0), 0);

    const platformCashSAR = (data.accounts ?? [])
      .filter((a) => a.type === 'Investment')
      .reduce((s, a) => {
        const cash = getAvailableCashForAccount(a.id);
        return s + (cash.SAR || 0) + (cash.USD || 0) * safeFxRate;
      }, 0);

    return bankCash + platformCashSAR;
  }, [data.accounts, getAvailableCashForAccount, safeFxRate]);

  const globalConfig: RecoveryGlobalConfig = useMemo(() => ({
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash: deployableCashSAR,
    minDeployableThreshold: Math.max(300, Math.min(1200, deployableCashSAR * 0.01)),
    recoveryBudgetPct: Math.max(0.12, Math.min(0.35, 0.18 + (deployableCashSAR > 50000 ? 0.04 : 0))),
  }), [deployableCashSAR]);

  const universe = data.portfolioUniverse ?? [];
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
    if (coreTickers.length === 0 && upsideTickers.length === 0) {
      (data.investmentPlan?.corePortfolio ?? []).forEach((p: { ticker?: string }) => coreTickers.push((p.ticker ?? '').toUpperCase()));
      (data.investmentPlan?.upsideSleeve ?? []).forEach((p: { ticker?: string }) => upsideTickers.push((p.ticker ?? '').toUpperCase()));
    }
    return { coreTickers, upsideTickers, specTickers };
  }, [universe, data.investmentPlan]);

  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [draftOrders, setDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [selectedFundamentals, setSelectedFundamentals] = useState<HoldingFundamentals | null>(null);
  const [isSelectedFundamentalsLoading, setIsSelectedFundamentalsLoading] = useState(false);
  const [selectedFundamentalsError, setSelectedFundamentalsError] = useState<string | null>(null);
  const [aiRecoveryBySymbol, setAiRecoveryBySymbol] = useState<Record<string, { lossTriggerPct: number; cashCap: number; recoveryEnabled: boolean; notes?: string }>>({});
  const [isAiRecoveryLoading, setIsAiRecoveryLoading] = useState(false);
  const [isBulkAiRecoveryLoading, setIsBulkAiRecoveryLoading] = useState(false);
  const [aiRecoveryError, setAiRecoveryError] = useState<string | null>(null);

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



  useEffect(() => {
    if (selectedHoldingId || qualifiedPositions.length === 0) return;
    setSelectedHoldingId(qualifiedPositions[0].holding.id);
  }, [qualifiedPositions, selectedHoldingId]);
  const selected = selectedHoldingId ? positionsWithRecovery.find(p => p.holding.id === selectedHoldingId) : null;
  const selectedPlan = selected?.plan;
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
    const plannedCostSecondary = convertCurrency(selectedPlan.totalPlannedCost, selected.currency, secondaryCurrency, safeFxRate);
    const postAvgSecondary = convertCurrency(selectedPlan.newAvgCost, selected.currency, secondaryCurrency, safeFxRate);
    const triggerGap = Math.abs(selectedPlan.plPct) - Math.abs(selected.positionConfig.lossTriggerPct);
    const triggerStatus = triggerGap >= 0 ? 'trigger met' : 'monitor only';
    const aiNote = selected.aiNotes ? ` AI note: ${selected.aiNotes}` : '';
    return `Status ${triggerStatus}. Planned recovery ladder cost is ${formatCurrencyString(selectedPlan.totalPlannedCost, { inCurrency: selected.currency ?? 'USD' })} (${formatCurrencyString(plannedCostSecondary, { inCurrency: secondaryCurrency })}) across ${selectedPlan.ladder.length} levels; projected post-average cost is ${formatCurrencyString(selectedPlan.newAvgCost, { inCurrency: selected.currency ?? 'USD' })} (${formatCurrencyString(postAvgSecondary, { inCurrency: secondaryCurrency })}).${aiNote}`;
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
    if (!isAiAvailable || qualifiedPositions.length === 0) return;
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
  }, [isAiAvailable, qualifiedPositions, deployableCashSAR, safeFxRate]);

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
    if (!selectedPlan) return;
    const drafts = orderDraftGenerator(selectedPlan, true);
    setDraftOrders(drafts);
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 flex-wrap">
              Recovery Plan (Averaging / Correction Engine)
              <InfoHint text="Controlled workflow for positions in loss: only activates when loss exceeds your trigger (e.g. 20%). Builds a limited buy ladder (1–3 orders), predicts new average cost, and can generate exit targets. Safe guardrails prevent over-spending." />
            </h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Enabled' : 'Unavailable'}
            </span>
          </div>
          <p className="text-sm text-slate-600 max-w-2xl">
            Positions in loss are listed below. When a position qualifies, you can generate a recovery ladder and optional exit targets. Integrated with your Portfolios and Investment Plan; never runs if over budget, spec breach, or per-ticker cap exceeded.
          </p>
          {(onNavigateToTab || onOpenWealthUltra) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
              {onNavigateToTab && (
                <>
                  <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-sm font-medium text-primary hover:underline">Portfolios</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Investment Plan')} className="text-sm font-medium text-primary hover:underline">Investment Plan</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Execution History')} className="text-sm font-medium text-primary hover:underline">Execution History</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => onNavigateToTab('Watchlist')} className="text-sm font-medium text-primary hover:underline">Watchlist</button>
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
        </div>
        <details className="mt-4 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-primary">Default parameters</summary>
          <ul className="mt-2 pl-4 space-y-1 list-disc">
            <li><strong>Loss trigger</strong> <InfoHint text="Position must be in loss by at least this % to qualify (e.g. 20% = -20% or worse)." />: 20%</li>
            <li><strong>Recovery budget</strong> <InfoHint text="Max share of deployable cash that can be used for recovery plans (e.g. 20%)." />: 20% of deployable cash</li>
            <li><strong>Cash cap per ticker</strong> <InfoHint text="Max amount allowed for correction on a single ticker." />: 5,000 (default)</li>
            <li><strong>Spec</strong>: Recovery is off for Speculative sleeve unless overridden; guardrails prevent over-spending.</li>
          </ul>
        </details>
      </section>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionCard className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Losing positions</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums mt-1">{losingPositions.length}</p>
        </SectionCard>
        <SectionCard className="min-w-0 border-l-4 border-emerald-500">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Recovery eligible</p>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{qualifiedPositions.length}</p>
        </SectionCard>
        <SectionCard className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deployable cash (SAR + USD)</p>
          <p className="text-xl font-bold text-slate-800 tabular-nums mt-1">
            {formatCurrencyString(deployableCashSAR)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Approximate total across currencies. Per-position values below use each portfolio&apos;s base currency.
          </p>
        </SectionCard>
      </div>

      {/* Losing positions table */}
      <SectionCard title="Positions in loss" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Symbol</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">P/L %</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">Cost / Value</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">State</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {losingPositions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No losing positions. Recovery plan applies only when a position is in loss.</td>
                </tr>
              ) : (
                losingPositions.map(({ holding, portfolioName, currency, plan }) => (
                  <tr key={holding.id} className={isSelected(holding.id) ? 'bg-primary/5' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800">{holding.symbol}</span>
                      <span className="block text-xs text-slate-500">{portfolioName}</span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${plan.plPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {plan.plPct >= 0 ? '+' : ''}{plan.plPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {formatCurrencyString(plan.costBasis, { inCurrency: currency })} →{' '}
                      {formatCurrencyString(plan.marketValue, { inCurrency: currency })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {plan.qualified ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800">Recovery Eligible</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">{plan.state}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {plan.qualified && (
                        <button
                          type="button"
                          onClick={() => setSelectedHoldingId(isSelected(holding.id) ? null : holding.id)}
                          className="text-primary font-medium hover:underline"
                        >
                          {isSelected(holding.id) ? 'Hide plan' : 'Generate Recovery Plan'}
                        </button>
                      )}
                      {!plan.qualified && plan.reason && <span className="text-xs text-slate-500" title={plan.reason}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selected && selectedPlan && (
        <SectionCard title={`${selected.holding.symbol} — Recovery Plan`} className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Portfolio: {selected.portfolioName}{' '}
              <span className="text-xs text-slate-500">
                · Display currency: {selected.currency ?? 'USD'}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={refreshAiRecoveryConfig} disabled={!isAiAvailable || isAiRecoveryLoading} className="px-3 py-1.5 rounded-md border border-primary/30 text-primary text-xs font-medium hover:bg-primary/5 disabled:opacity-50">
                {isAiRecoveryLoading ? 'Optimizing…' : 'AI optimize selected'}
              </button>
              <button type="button" onClick={applyAiToAllQualifiedPositions} disabled={!isAiAvailable || isBulkAiRecoveryLoading || qualifiedPositions.length === 0} className="px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-50">
                {isBulkAiRecoveryLoading ? 'Optimizing all…' : `AI optimize all (${qualifiedPositions.length})`}
              </button>
            </div>
          </div>
          {selectedRecoveryBrief && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">{selectedRecoveryBrief}</p>
          )}
          {selected.aiNotes && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{selected.aiNotes}</p>
          )}
          {aiRecoveryError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mt-2">{aiRecoveryError}</p>
          )}


          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Deployable cash ({selected.currency ?? 'USD'})</p>
              <p className="text-sm font-semibold text-slate-800 tabular-nums">{formatCurrencyString(selectedCurrencyDeployableCash, { inCurrency: selected.currency ?? 'USD' })}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Cross-currency reference ({selected?.currency === 'USD' ? 'SAR' : 'USD'})</p>
              <p className="text-sm font-semibold text-slate-800 tabular-nums">{formatCurrencyString(alternateCurrencyDeployableCash, { inCurrency: (selected?.currency === 'USD' ? 'SAR' : 'USD') as TradeCurrency })}</p>
            </div>
          </div>
          {!isAiAvailable && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">AI is currently unavailable. Recovery plan still runs with deterministic guardrails, dual-currency checks, and clear trigger logic.</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Current</p>
              <p className="text-sm text-slate-700">
                Shares: {selected.holding.quantity} · Avg cost:{' '}
                {formatCurrencyString(selected.holding.avgCost ?? 0, {
                  inCurrency: selected.currency ?? 'USD',
                })}{' '}
                · Price:{' '}
                {formatCurrencyString(selectedPlan.currentPrice, {
                  inCurrency: selected.currency ?? 'USD',
                })}
              </p>
              <p className="mt-2 font-semibold text-slate-800">
                P/L:{' '}
                {formatCurrencyString(selectedPlan.plUsd, {
                  inCurrency: selected.currency ?? 'USD',
                })}{' '}
                ({selectedPlan.plPct.toFixed(1)}%)
              </p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-100">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1">After ladder fills <InfoHint text="New average cost and share count if all planned buy orders are filled." /></p>
              <p className="text-sm text-slate-700">
                New shares: {selectedPlan.newShares} · New avg cost:{' '}
                {formatCurrencyString(selectedPlan.newAvgCost, {
                  inCurrency: selected.currency ?? 'USD',
                })}
              </p>
              <p className="mt-2 font-semibold text-emerald-800">
                Planned recovery cost:{' '}
                {formatCurrencyString(selectedPlan.totalPlannedCost, {
                  inCurrency: selected.currency ?? 'USD',
                })}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Added shares cap: {Math.max(0, selectedPlan.newShares - selectedPlan.shares)} / {selected.positionConfig.maxAddShares ?? 0}
                {' '}({selectedPlan.shares > 0 ? (((selectedPlan.newShares - selectedPlan.shares) / selectedPlan.shares) * 100).toFixed(0) : '0'}% of current shares)
              </p>
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

          <div>
            <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-1">Buy ladder (limit orders) <InfoHint text="Up to 3 levels below current price. Use limit orders only; no market orders." /></h4>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left font-semibold text-slate-700">Level</th><th className="px-3 py-2 text-right font-semibold text-slate-700">Qty</th><th className="px-3 py-2 text-right font-semibold text-slate-700">Price</th><th className="px-3 py-2 text-right font-semibold text-slate-700">Cost</th></tr></thead>
                <tbody className="bg-white">
                  {selectedPlan.ladder.map(l => (
                    <tr key={l.level} className="border-t border-slate-100">
                      <td className="px-3 py-2">L{l.level}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrencyString(l.price, {
                          inCurrency: selected.currency ?? 'USD',
                        })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
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

          <div>
            <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-1">Exit targets (optional) <InfoHint text="Target 1/2 and trailing stop based on new average cost. Apply when you want to auto-suggest exit prices." /></h4>
            <div className="flex flex-wrap gap-3 text-sm">
              {selectedPlan.exitPlan.applyTarget1 &&
                selectedPlan.exitPlan.target1Price != null && (
                  <span className="px-3 py-1.5 rounded-lg bg-violet-50 text-violet-800 font-medium">
                    Target 1: {selectedPlan.exitPlan.target1Pct}% →{' '}
                    {formatCurrencyString(selectedPlan.exitPlan.target1Price, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                )}
              {selectedPlan.exitPlan.applyTarget2 &&
                selectedPlan.exitPlan.target2Price != null && (
                  <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 font-medium">
                    Target 2: {selectedPlan.exitPlan.target2Pct}% →{' '}
                    {formatCurrencyString(selectedPlan.exitPlan.target2Price, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                )}
              {selectedPlan.exitPlan.applyTrailing &&
                selectedPlan.exitPlan.trailStopPrice != null && (
                  <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 font-medium">
                    Trailing: {selectedPlan.exitPlan.trailPct}% →{' '}
                    {formatCurrencyString(selectedPlan.exitPlan.trailStopPrice, {
                      inCurrency: selected.currency ?? 'USD',
                    })}
                  </span>
                )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={handleGenerateDraft}
              className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-secondary font-medium text-sm"
            >
              Create Draft Orders
            </button>
          </div>
        </SectionCard>
      )}

      {draftOrders && draftOrders.length > 0 && (
        <SectionCard title="Draft orders (export to broker)" className="space-y-3">
          <p className="text-sm text-slate-600">Copy or use these to place limit orders in your broker.</p>
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
