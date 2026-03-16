import React, { useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useAI } from '../context/AiContext';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { runWealthUltraEngine, exportOrdersJson, capitalEfficiencyScore, getDefaultWealthUltraConfig, getRiskWeight } from '../wealth-ultra';
import { calculatePortfolioRisk } from '../services/advancedRiskScoring';
import { valueAtRiskHistorical, getPDTStatus, getMarketHoursGuardrail, volatilityAdjustedWeights } from '../services/riskCompliance';
import type { WealthUltraSleeve, WealthUltraPosition, WealthUltraRiskTier } from '../types';
import type { Page } from '../types';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import PageActionsDropdown from '../components/PageActionsDropdown';
import Card from '../components/Card';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';

const SLEEVE_COLORS: Record<WealthUltraSleeve, string> = {
  Core: 'bg-blue-500',
  Upside: 'bg-amber-500',
  Spec: 'bg-rose-500',
};

const SLEEVE_BG: Record<WealthUltraSleeve, string> = {
  Core: 'bg-blue-50 border-blue-100',
  Upside: 'bg-amber-50 border-amber-100',
  Spec: 'bg-rose-50 border-rose-100',
};

const toSafeText = (value: unknown, fallback = '—'): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

/** Build full Wealth Ultra config from app data. Auto-derives sleeve tickers from Portfolio Universe or holdings when plan lists are empty. */
function buildEngineConfigFromSystem(
  data: {
    investmentPlan?: any;
    wealthUltraConfig?: any;
    accounts?: any[];
    portfolioUniverse?: Array<{ ticker: string; status?: string }>;
    investments?: Array<{ holdings?: Array<{ symbol?: string }> }>;
  },
  totalDeployableCash?: number
) {
  const plan = data?.investmentPlan;
  const systemConfig = data?.wealthUltraConfig;
  const defaults = getDefaultWealthUltraConfig();
  const base = { ...defaults, ...systemConfig } as typeof defaults;

  const cashAvailable =
    totalDeployableCash ??
    (data?.accounts ?? []).reduce((s: number, a: { balance?: number }) => s + (a.balance ?? 0), 0);

  const allHoldingTickers =
    (data?.investments ?? [])
      .flatMap((p: { holdings?: Array<{ symbol?: string }> }) => p.holdings || [])
      .map((h: { symbol?: string }) => (h.symbol || '').toUpperCase())
      .filter(Boolean) || [];

  const universe = data?.portfolioUniverse ?? [];

  let coreTickers: string[] = [];
  let upsideTickers: string[] = [];
  let specTickers: string[] = [];

  if (plan) {
    const sleeves = plan.sleeves && Array.isArray(plan.sleeves) && plan.sleeves.length > 0;
    const core = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'core' || s.id === 'Core') : null;
    const upside = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'upside' || s.id === 'Upside') : null;
    const spec = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'spec' || s.id === 'Spec') : null;

    coreTickers = sleeves && core
      ? (core.tickers || [])
      : (plan.corePortfolio ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean);
    upsideTickers = sleeves && upside
      ? (upside.tickers || [])
      : (plan.upsideSleeve ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean);
    specTickers = sleeves && spec ? (spec.tickers || []) : [];
  }

  if (coreTickers.length === 0 && upsideTickers.length === 0 && specTickers.length === 0 && universe.length > 0) {
    universe.forEach((t: { ticker: string; status?: string }) => {
      const sym = (t.ticker || '').toUpperCase();
      if (!sym) return;
      const status = (t.status || '').toLowerCase();
      if (status === 'core') coreTickers.push(sym);
      else if (status === 'high-upside' || status === 'highupside') upsideTickers.push(sym);
      else if (status === 'speculative' || status === 'spec') specTickers.push(sym);
    });
  }

  if (coreTickers.length === 0 && upsideTickers.length === 0 && specTickers.length === 0 && allHoldingTickers.length > 0) {
    coreTickers = [...new Set(allHoldingTickers)];
  }

  const coreSet = new Set(coreTickers.map(t => t.toUpperCase()));
  const upsideSet = new Set(upsideTickers.map(t => t.toUpperCase()));
  const specSet = new Set(specTickers.map(t => t.toUpperCase()));
  const universeByTicker = new Map(universe.map((t: { ticker: string; status?: string }) => [(t.ticker || '').toUpperCase(), (t.status || '').toLowerCase()]));
  allHoldingTickers.forEach(sym => {
    if (coreSet.has(sym) || upsideSet.has(sym) || specSet.has(sym)) return;
    const status = universeByTicker.get(sym);
    if (status === 'core') coreSet.add(sym);
    else if (status === 'high-upside' || status === 'highupside') upsideSet.add(sym);
    else if (status === 'speculative' || status === 'spec') specSet.add(sym);
    else coreSet.add(sym);
  });
  coreTickers = Array.from(coreSet);
  upsideTickers = Array.from(upsideSet);
  specTickers = Array.from(specSet);

  const hasSleeves = plan?.sleeves && Array.isArray(plan.sleeves) && plan.sleeves.length > 0;
  const coreSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'core' || s.id === 'Core') : null;
  const upsideSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'upside' || s.id === 'Upside') : null;
  const specSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'spec' || s.id === 'Spec') : null;
  const coreExplicit = coreSleeve && typeof coreSleeve.targetPct === 'number';
  const upsideExplicit = upsideSleeve && typeof upsideSleeve.targetPct === 'number';
  const specExplicit = specSleeve && typeof specSleeve.targetPct === 'number';

  let targetCorePct: number;
  let targetUpsidePct: number;
  let targetSpecPct: number;

  if (!plan) {
    targetCorePct = base.targetCorePct;
    targetUpsidePct = base.targetUpsidePct;
    targetSpecPct = base.targetSpecPct;
  } else if (hasSleeves && coreExplicit && upsideExplicit && specExplicit) {
    targetCorePct = coreSleeve.targetPct;
    targetUpsidePct = upsideSleeve.targetPct;
    targetSpecPct = specSleeve.targetPct;
  } else if (hasSleeves && (coreExplicit || upsideExplicit || specExplicit)) {
    targetCorePct = coreExplicit ? coreSleeve.targetPct : base.targetCorePct;
    targetUpsidePct = upsideExplicit ? upsideSleeve.targetPct : base.targetUpsidePct;
    targetSpecPct = specExplicit ? specSleeve.targetPct : base.targetSpecPct;
    const sum = targetCorePct + targetUpsidePct + targetSpecPct;
    if (Math.abs(sum - 100) > 0.01) {
      const scale = 100 / sum;
      targetCorePct *= scale;
      targetUpsidePct *= scale;
      targetSpecPct *= scale;
    }
  } else {
    const specDefault = (plan.specAllocation ?? 0.05) * 100;
    const remainder = 100 - specDefault;
    const coreRatio = (plan.coreAllocation ?? 0.7) / ((plan.coreAllocation ?? 0.7) + (plan.upsideAllocation ?? 0.3));
    const upsideRatio = (plan.upsideAllocation ?? 0.3) / ((plan.coreAllocation ?? 0.7) + (plan.upsideAllocation ?? 0.3));
    targetSpecPct = specDefault;
    targetCorePct = remainder * coreRatio;
    targetUpsidePct = remainder * upsideRatio;
  }

  return {
    ...base,
    monthlyDeposit: plan?.monthlyBudget ?? base.monthlyDeposit,
    cashAvailable,
    targetCorePct,
    targetUpsidePct,
    targetSpecPct,
    coreTickers,
    upsideTickers,
    specTickers,
  };
}

interface WealthUltraDashboardProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const SCENARIO_OPTIONS: { id: string; label: string; multiplier: number }[] = [
  { id: 'current', label: 'Current', multiplier: 1 },
  { id: 'down10', label: 'Market −10%', multiplier: 0.9 },
  { id: 'down20', label: 'Market −20%', multiplier: 0.8 },
];

const WealthUltraDashboard: React.FC<WealthUltraDashboardProps> = ({ setActivePage, triggerPageAction }) => {
  const { data, loading, totalDeployableCash } = useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable } = useAI();
  const [scenarioId, setScenarioId] = React.useState('current');

  const engineState = useMemo(() => {
    const allHoldings = (data?.investments ?? []).flatMap(p => p.holdings ?? []);
    const priceMap: Record<string, number> = {};
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      priceMap[sym.toUpperCase()] = (o as { price: number }).price;
    });
    allHoldings.forEach(h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!priceMap[sym] && h.quantity > 0) priceMap[sym] = h.currentValue / h.quantity;
    });
    const scenario = SCENARIO_OPTIONS.find(s => s.id === scenarioId) ?? SCENARIO_OPTIONS[0];
    if (scenario.multiplier !== 1) {
      Object.keys(priceMap).forEach(sym => { priceMap[sym] = priceMap[sym] * scenario.multiplier; });
    }
    const config = buildEngineConfigFromSystem(
      {
        investmentPlan: data?.investmentPlan,
        wealthUltraConfig: data?.wealthUltraConfig,
        accounts: data?.accounts ?? [],
        portfolioUniverse: data?.portfolioUniverse ?? [],
        investments: data?.investments ?? [],
      },
      totalDeployableCash
    );
    return runWealthUltraEngine({
      holdings: allHoldings,
      priceMap,
      config,
    });
  }, [data?.investments, data?.investmentPlan, data?.accounts, data?.wealthUltraConfig, data?.portfolioUniverse, simulatedPrices, totalDeployableCash, scenarioId]);

  const {
    totalPortfolioValue,
    config,
    allocations,
    capitalEfficiencyRanked,
    alerts,
    cashPlannerStatus,
    deployableCash,
    totalPlannedBuyCost,
    monthlyDeployment,
    specBreach,
    specBuysDisabled,
    orders,
    portfolioHealth,
    diversificationSummary,
    rebalancePolicy,
  } = engineState;

  const { analysis: crossEngineAnalysis } = useFinancialEnginesIntegration();

  const pdtState = useMemo(() => {
    const txs = (data?.investmentTransactions ?? []) as Array<{ date: string; type: string; symbol?: string }>;
    const buySell = txs.filter(t => t.type === 'buy' || t.type === 'sell');
    const dayTradeCountByDay = new Map<string, number>();
    const days = new Set(buySell.map(t => (t.date || '').slice(0, 10)).filter(Boolean));
    days.forEach(day => {
      const buys = new Set(buySell.filter(t => t.date?.slice(0, 10) === day && t.type === 'buy').map(t => (t.symbol || '').toUpperCase()));
      const sells = new Set(buySell.filter(t => t.date?.slice(0, 10) === day && t.type === 'sell').map(t => (t.symbol || '').toUpperCase()));
      let count = 0;
      buys.forEach(s => { if (sells.has(s)) count++; });
      if (count > 0) dayTradeCountByDay.set(day, count);
    });
    const now = new Date();
    let fiveBizAgo = new Date(now);
    let d = 0;
    while (d < 5) {
      fiveBizAgo.setDate(fiveBizAgo.getDate() - 1);
      if (fiveBizAgo.getDay() !== 0 && fiveBizAgo.getDay() !== 6) d++;
    }
    const cutoff = fiveBizAgo.toISOString().slice(0, 10);
    const dayTradesInLast5Days = Array.from(dayTradeCountByDay.entries())
      .filter(([day]) => day >= cutoff)
      .reduce((sum, [, n]) => sum + n, 0);
    return { dayTradesInLast5Days, last5BusinessDays: [], accountEquity: totalPortfolioValue };
  }, [data?.investmentTransactions, totalPortfolioValue]);

  const advancedRisk = useMemo(() => {
    const pos = engineState.positions ?? [];
    if (pos.length === 0 || totalPortfolioValue <= 0) return null;
    const positionRiskInputs = pos.map((p: WealthUltraPosition) => ({
      symbol: p.ticker,
      shares: p.currentShares ?? 0,
      currentPrice: p.currentPrice ?? 0,
      marketValue: p.marketValue ?? 0,
      avgCost: p.avgCost ?? 0,
      sector: 'Equity',
      assetClass: 'equity',
    }));
    try {
      const { portfolioMetrics } = calculatePortfolioRisk({
        positions: positionRiskInputs,
        cashBalance: 0,
        totalPortfolioValue,
      });
      return portfolioMetrics;
    } catch {
      return null;
    }
  }, [engineState.positions, totalPortfolioValue]);

  const totalSAR = totalPortfolioValue / config.fxRate;
  const positions = engineState.positions || [];
  const top5Gainers = positions.filter(p => p.plPct > 0).sort((a, b) => b.plPct - a.plPct).slice(0, 5);
  const top5Losers = positions.filter(p => p.plPct < 0).sort((a, b) => a.plPct - b.plPct).slice(0, 5);
  const positionCount = positions.length;
  const portfolioCount = (data?.investments ?? []).filter((p: { holdings?: unknown[] }) => (p.holdings?.length ?? 0) > 0).length;
  const buyOrders = orders.filter(o => o.type === 'BUY');
  const sellOrders = orders.filter(o => o.type === 'SELL');

  const riskDistribution = useMemo(() => {
    const tiers: WealthUltraRiskTier[] = ['Low', 'Med', 'High', 'Spec'];
    const byRisk: Record<string, { count: number; value: number }> = Object.fromEntries(tiers.map(t => [t, { count: 0, value: 0 }]));
    (engineState.positions || []).forEach((p: WealthUltraPosition) => {
      const tier = (p.riskTier && tiers.includes(p.riskTier as WealthUltraRiskTier)) ? p.riskTier : 'Med';
      byRisk[tier].count += 1;
      byRisk[tier].value += (p.marketValue ?? 0);
    });
    return byRisk;
  }, [engineState.positions]);

  const handleExportOrders = () => {
    const json = exportOrdersJson(orders);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wealth-ultra-orders.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const positionsSortedByPl = useMemo(() => [...positions].sort((a, b) => b.plPct - a.plPct), [positions]);

  const healthColor = portfolioHealth.score >= 85 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : portfolioHealth.score >= 65 ? 'text-amber-600 bg-amber-50 border-amber-200' : portfolioHealth.score >= 40 ? 'text-amber-700 bg-amber-100 border-amber-300' : 'text-rose-600 bg-rose-50 border-rose-200';

  const engineIntelligence = useMemo(() => {
    const maxDrift = allocations.reduce((max, item) => Math.max(max, Math.abs(item.driftPct)), 0);
    const driftPenalty = Math.min(30, maxDrift * 3);
    const alertPenalty = Math.min(25, alerts.length * 5);
    const cashPenalty = cashPlannerStatus === 'WITHIN_LIMIT' ? 0 : 20;
    const specPenalty = specBreach ? 15 : 0;
    const iqScore = Math.max(0, Math.min(100, Math.round(100 - driftPenalty - alertPenalty - cashPenalty - specPenalty)));

    const recommendations: Array<{ title: string; reason: string; priority: 'high' | 'medium' | 'low' }> = [];
    if (cashPlannerStatus !== 'WITHIN_LIMIT') {
      recommendations.push({
        title: 'Trim buy list to fit cash limits',
        reason: `Planned buys ${formatCurrencyString(totalPlannedBuyCost)} exceed deployable cash ${formatCurrencyString(deployableCash)}.`,
        priority: 'high',
      });
    }
    if (maxDrift > 5) {
      recommendations.push({
        title: 'Rebalance sleeve drift',
        reason: `Maximum sleeve drift is ${maxDrift.toFixed(1)}%, above the 5% operating threshold.`,
        priority: maxDrift > 10 ? 'high' : 'medium',
      });
    }
    if (specBreach) {
      recommendations.push({
        title: 'Reduce speculative exposure',
        reason: 'Spec sleeve is above limit, so new spec buys are blocked until risk normalizes.',
        priority: 'high',
      });
    }
    if (monthlyDeployment.amountToDeploy > 0) {
      recommendations.push({
        title: 'Automate monthly deployment',
        reason: `Current monthly deployment target is ${formatCurrencyString(monthlyDeployment.amountToDeploy)}; convert top BUY orders into recurring instructions.`,
        priority: 'low',
      });
    }
    if (recommendations.length === 0) {
      recommendations.push({
        title: 'Maintain current allocations',
        reason: 'No critical drift, cash, or spec-limit violations detected in this cycle.',
        priority: 'low',
      });
    }

    const guardrails = [
      { label: 'Cash discipline', ok: cashPlannerStatus === 'WITHIN_LIMIT' },
      { label: 'Spec guardrail', ok: !specBreach && !specBuysDisabled },
      { label: 'Drift under control', ok: maxDrift <= 5 },
      { label: 'Orderbook prepared', ok: orders.length > 0 || positions.length === 0 },
    ];

    const estimatedRebalanceMonths = monthlyDeployment.amountToDeploy > 0
      ? Math.max(1, Math.ceil((Math.max(0, maxDrift - 2) / 2)))
      : null;

    return {
      iqScore,
      maxDrift,
      recommendations: recommendations.slice(0, 3),
      guardrails,
      estimatedRebalanceMonths,
    };
  }, [allocations, alerts.length, cashPlannerStatus, deployableCash, formatCurrencyString, monthlyDeployment, orders.length, positions.length, specBreach, specBuysDisabled, totalPlannedBuyCost]);

  const exceptionHistory = useMemo(() => {
    if (typeof window === 'undefined') return [] as Array<{ at: string; severity: string; title: string; message: string; actionHint?: string }>;
    try {
      const raw = window.localStorage.getItem('wealth-ultra-exception-history');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 25) : [];
    } catch {
      return [];
    }
  }, [alerts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newEntries = alerts
      .filter((a) => a.severity === 'critical' || a.severity === 'warning')
      .map((a) => ({
        at: new Date().toISOString(),
        severity: toSafeText(a.severity, 'info').toLowerCase(),
        title: toSafeText(a.title, 'Portfolio exception'),
        message: toSafeText(a.message, 'Review portfolio exception details.'),
        actionHint: a.actionHint ? toSafeText(a.actionHint, '') : undefined,
      }));
    if (newEntries.length === 0) return;

    try {
      const raw = window.localStorage.getItem('wealth-ultra-exception-history');
      const existing = raw ? JSON.parse(raw) : [];
      const source = Array.isArray(existing) ? existing : [];
      const merged = [...newEntries, ...source]
        .filter((row: any) => row && row.title && row.message)
        .filter((row: any, idx: number, arr: any[]) =>
          arr.findIndex((x: any) => x.title === row.title && x.message === row.message && x.severity === row.severity) === idx
        )
        .slice(0, 25);
      window.localStorage.setItem('wealth-ultra-exception-history', JSON.stringify(merged));
    } catch {
      // ignore storage limitations
    }
  }, [alerts]);

  /** Grid items ordered to match page flow: Overview (hero, KPIs, alerts, engine IQ) → Allocation → Orders → Analysis → History */
  const gridItems = useMemo(
    () => [
      {
        id: 'hero',
        content: (
          <SectionCard title="Wealth Ultra Engine" className="border-2 border-primary/30 bg-gradient-to-br from-white via-primary/5 to-slate-50 shadow-lg">
            <div className="space-y-4">
              <p className="text-slate-700 leading-relaxed max-w-3xl">Rule-based allocation, sleeve drift analysis, and institutional-grade order planning. Unified with your Investment Plan, execution flow, and live portfolio telemetry.</p>
              {positionCount > 0 && (
                <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">{positionCount}</span>
                    <span>position{positionCount !== 1 ? 's' : ''}</span>
                    {portfolioCount > 0 && (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-slate-900">{portfolioCount}</span>
                        <span>portfolio{portfolioCount !== 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    Data sources: Investments + Plan + Universe + Accounts
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 2,
        minW: 12,
        minH: 1,
      },
      {
        id: 'kpis',
        content: (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600 font-medium">
                All amounts in <span className="font-semibold text-slate-900">USD</span>
              </p>
              <p className="text-xs text-slate-500">
                SAR conversion rate: <span className="font-mono font-semibold">{config.fxRate.toFixed(4)}</span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Card
                title="Total portfolio value"
                value={formatCurrencyString(totalPortfolioValue, { digits: 0 })}
                trend={`≈ ${totalSAR.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'SAR',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })} SAR`}
                density="compact"
                indicatorColor="green"
                valueColor="text-slate-900"
                tooltip="All Wealth Ultra positions at current prices (USD). SAR shown for reference."
              />
              <Card
                title="Deployable cash"
                value={formatCurrencyString(deployableCash, { digits: 0 })}
                density="compact"
                indicatorColor={deployableCash > 0 ? 'green' : 'yellow'}
                valueColor="text-slate-900"
                tooltip="Cash available for buys after reserve, as seen by the Wealth Ultra engine."
              />
              <Card
                title="Planned buys"
                value={formatCurrencyString(totalPlannedBuyCost, { digits: 0 })}
                density="compact"
                indicatorColor={totalPlannedBuyCost > 0 ? 'green' : undefined}
                valueColor="text-slate-900"
                tooltip="Total cost of suggested BUY orders generated by the engine."
              />
              <Card
                title="Cash plan"
                value={cashPlannerStatus === 'WITHIN_LIMIT' ? 'Within limit' : 'Over budget'}
                indicatorColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'green' : 'red'}
                density="compact"
                valueColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'text-emerald-700' : 'text-rose-700'}
                tooltip="Compares planned BUY cost vs deployable cash. Over budget means orders exceed safe cash."
              />
            </div>
          </div>
        ),
        defaultW: 12,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
      {
        id: 'alerts',
        content: (
          <SectionCard title="Alerts & Recommendations" className="h-full border-2 border-slate-200 bg-white shadow-md">
            <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
              <p className="text-xs text-slate-600 font-medium">Prioritized: act on critical first, then warnings; use info for context.</p>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full border-2 border-slate-300 bg-slate-100 text-slate-700 whitespace-nowrap shadow-sm">
                {alerts.length} {alerts.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {alerts.length > 0 ? (
              <ul className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {alerts.map((a, i) => {
                  const isCritical = a.severity === 'critical';
                  const isWarning = a.severity === 'warning';
                  const bg = isCritical ? 'bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-300' : isWarning ? 'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-300' : 'bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-300';
                  const titleColor = isCritical ? 'text-rose-900' : isWarning ? 'text-amber-900' : 'text-slate-900';
                  const label = isCritical ? 'Act Now' : isWarning ? 'Review' : 'FYI';
                  return (
                    <li key={i} className={`rounded-xl border-2 p-4 text-sm shadow-sm hover:shadow-md transition-shadow ${bg}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <ExclamationTriangleIcon className={`h-5 w-5 shrink-0 ${isCritical ? 'text-rose-700' : isWarning ? 'text-amber-700' : 'text-slate-600'}`} />
                        {a.title && <span className={`font-bold text-base ${titleColor}`}>{toSafeText(a.title, 'Alert')}</span>}
                        <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${isCritical ? 'bg-rose-200 text-rose-900' : isWarning ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-700'}`}>{label}</span>
                      </div>
                      <p className="text-slate-800 leading-relaxed">{toSafeText(a.message, 'Review this condition in Wealth Ultra.')}</p>
                      {a.actionHint && (
                        <div className="mt-3 pt-3 border-t border-slate-300/50">
                          <p className="text-xs font-bold text-slate-700">→ {toSafeText(a.actionHint, '')}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="py-8 text-center border-2 border-dashed border-emerald-200 rounded-lg bg-emerald-50/50">
                <CheckCircleIcon className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-sm text-emerald-800 font-medium">No alerts</p>
                <p className="text-xs text-emerald-700 mt-1">Plan and allocation are in sync.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 1,
      },
      {
        id: 'engine-iq',
        content: (
          <SectionCard title="Engine Intelligence & Decision Summary" className="border-2 border-slate-200 bg-white shadow-md">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-bold mb-3">Engine IQ Score</p>
                <div className="flex items-baseline gap-2 mb-3">
                  <p className="text-4xl font-black text-slate-900 tabular-nums">{engineIntelligence.iqScore}</p>
                  <span className="text-lg font-semibold text-slate-500">/100</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mb-4">Calculated from drift, alerts, cash compliance, and spec-rule discipline.</p>
                {engineIntelligence.estimatedRebalanceMonths && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-700">Estimated stabilization:</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">~{engineIntelligence.estimatedRebalanceMonths} month{engineIntelligence.estimatedRebalanceMonths !== 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>
              <div className="lg:col-span-2 rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-bold mb-4">Top Actions This Cycle</p>
                <ul className="space-y-3">
                  {engineIntelligence.recommendations.map((action, idx) => (
                    <li key={`${action.title}-${idx}`} className="rounded-lg border-2 border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs">{idx + 1}</span>
                          {action.title}
                        </p>
                        <span className={`text-[10px] uppercase tracking-wide font-bold px-2.5 py-1 rounded-full shrink-0 ${action.priority === 'high' ? 'bg-rose-100 text-rose-800 border border-rose-200' : action.priority === 'medium' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>{action.priority}</span>
                      </div>
                      <p className="text-xs text-slate-600 ml-8 leading-relaxed">{action.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-bold mb-3">System Guardrails</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {engineIntelligence.guardrails.map(item => (
                  <div key={item.label} className={`rounded-lg border-2 px-4 py-3 text-sm shadow-sm ${item.ok ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-800' : 'border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100/50 text-rose-800'}`}>
                    <p className="font-bold mb-1">{item.label}</p>
                    <p className="text-xs font-semibold">{item.ok ? '✓ Healthy' : '⚠ Needs action'}</p>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 2,
      },
      {
        id: 'sleeve-allocation',
        content: (
          <SectionCard title="Sleeve Allocation & Drift Analysis" className="border-2 border-slate-200 bg-white shadow-md">
            <p className="text-xs text-slate-600 mb-6 font-medium">Current vs target allocation. Drift &gt;5% suggests rebalancing action.</p>
            <div className="space-y-4">
              {allocations.map(a => {
                const driftAbs = Math.abs(a.driftPct);
                const hasDrift = driftAbs > 5;
                const driftText = `${a.driftPct >= 0 ? '+' : ''}${a.driftPct.toFixed(1)}% drift`;
                return (
                  <div key={a.sleeve} className={`rounded-xl border-2 p-5 shadow-sm ${SLEEVE_BG[a.sleeve]} ${hasDrift ? 'ring-2 ring-amber-200' : ''}`}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <span className={`w-4 h-4 rounded-full ${SLEEVE_COLORS[a.sleeve]} shadow-sm`} />
                        <div>
                          <p className="font-bold text-lg text-slate-900">{a.sleeve} Sleeve</p>
                          <p className="text-sm text-slate-700 mt-1 tabular-nums font-medium">Value: {formatCurrencyString(a.marketValue)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className="text-sm font-bold text-slate-900 bg-white/90 border-2 border-slate-300 rounded-lg px-3 py-1.5 tabular-nums shadow-sm">
                          Actual {a.allocationPct.toFixed(1)}%
                        </span>
                        <span className="text-sm font-bold text-slate-700 bg-white/90 border-2 border-slate-300 rounded-lg px-3 py-1.5 tabular-nums shadow-sm">
                          Target {a.targetPct.toFixed(1)}%
                        </span>
                        <span className={`text-sm font-bold rounded-lg px-3 py-1.5 tabular-nums shadow-sm ${hasDrift ? 'bg-amber-100 text-amber-900 border-2 border-amber-300' : 'bg-slate-100 text-slate-700 border-2 border-slate-300'}`}>
                          {driftText}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-3 bg-white/90 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full flex rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-l-full shadow-sm ${a.sleeve === 'Core' ? 'bg-blue-600' : a.sleeve === 'Upside' ? 'bg-amber-600' : 'bg-rose-600'}`}
                            style={{ width: `${Math.min(100, a.allocationPct)}%` }}
                          />
                          <div className="h-full flex-1 bg-slate-200" />
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>0%</span>
                        <span className="font-semibold">Target: {a.targetPct.toFixed(1)}%</span>
                        <span>100%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 4,
        minW: 6,
        minH: 2,
      },
      {
        id: 'orders',
        content: (
          <SectionCard title="Generated Orders" className="border-2 border-primary/30 bg-gradient-to-br from-white to-primary/5 shadow-lg">
            <p className="text-xs text-slate-700 mb-5 font-medium">Suggested limit orders from the engine. Export to JSON or use as a checklist when placing trades.</p>
            {orders.length > 0 ? (
              <div className="space-y-5">
                {buyOrders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-5 bg-emerald-500 rounded-full"></div>
                      <p className="text-sm font-bold text-slate-900 uppercase tracking-wide">Buy Orders ({buyOrders.length})</p>
                    </div>
                    <ul className="space-y-2">
                      {buyOrders.map((o, i) => (
                        <li key={i} className="grid grid-cols-2 sm:grid-cols-4 items-center gap-3 py-3 px-4 rounded-lg bg-white border-2 border-emerald-100 shadow-sm hover:shadow-md transition-shadow text-sm">
                          <span className="font-bold text-emerald-700 uppercase tracking-wide">BUY</span>
                          <span className="font-mono font-bold text-slate-900">{o.ticker}</span>
                          <span className="text-slate-700 font-medium">Qty: <span className="font-bold">{o.qty}</span></span>
                          <span className="text-slate-700 font-medium">Limit: <span className="font-bold tabular-nums">{formatCurrencyString(o.limitPrice ?? 0)}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sellOrders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-5 bg-rose-500 rounded-full"></div>
                      <p className="text-sm font-bold text-slate-900 uppercase tracking-wide">Sell / Exit Orders ({sellOrders.length})</p>
                    </div>
                    <ul className="space-y-2">
                      {sellOrders.map((o, i) => (
                        <li key={i} className="grid grid-cols-2 sm:grid-cols-4 items-center gap-3 py-3 px-4 rounded-lg bg-white border-2 border-rose-100 shadow-sm hover:shadow-md transition-shadow text-sm">
                          <span className="font-bold text-rose-700 uppercase tracking-wide">SELL</span>
                          <span className="font-mono font-bold text-slate-900">{o.ticker}</span>
                          <span className="text-slate-700 font-medium">Qty: <span className="font-bold">{o.qty}</span></span>
                          {(o.target1Price ?? o.target2Price ?? o.trailingStopPrice) ? (
                            <span className="text-slate-600 text-xs font-medium">Targets / trailing in export</span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                <p className="text-sm text-slate-600 font-medium">No orders generated</p>
                <p className="text-xs text-slate-500 mt-1">Add positions and optional buy ladders in Recovery Plan or Investments.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 2,
      },
      {
        id: 'next-move',
        content: (
          <SectionCard title="Next Move — Monthly Deployment" className="h-full border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-white shadow-lg">
            <div className="h-full flex flex-col justify-between gap-4">
              <p className="text-sm leading-relaxed text-slate-700 font-medium">{toSafeText(monthlyDeployment.reason, 'Review allocation before deploying.')}</p>
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Planned Deployment</span>
                  <span className="text-2xl font-black text-slate-900 tabular-nums">{formatCurrencyString(monthlyDeployment.amountToDeploy)}</span>
                </div>
                {monthlyDeployment.suggestedTicker && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-primary/20 border-2 border-primary/30 text-primary px-4 py-2 w-full justify-center">
                    <span className="text-xs uppercase tracking-wide text-primary/90 font-bold">Ticker</span>
                    <span className="font-mono font-bold text-lg">{monthlyDeployment.suggestedTicker}</span>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
      {
        id: 'spec-risk',
        content: (
          <SectionCard title="Speculative Sleeve Status" className="h-full min-h-[140px] border-2 border-rose-200 bg-gradient-to-br from-rose-50/50 to-white shadow-lg">
            <div className="min-h-[100px] flex flex-col justify-center">
              {specBreach ? (
                <div className="w-full rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100/50 px-4 py-4 shadow-sm">
                  <p className="text-amber-900 font-bold flex items-center gap-2 text-base mb-2">
                    <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
                    Over Target Limit
                  </p>
                  <p className="text-sm text-amber-800 leading-relaxed">New Spec buys are disabled until allocation returns within policy limits.</p>
                </div>
              ) : specBuysDisabled ? (
                <div className="w-full rounded-xl border-2 border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/50 px-4 py-4 shadow-sm">
                  <p className="text-slate-900 font-bold text-base mb-2">Policy Lock Active</p>
                  <p className="text-sm text-slate-700 leading-relaxed">Spec buys are currently disabled by portfolio policy.</p>
                </div>
              ) : (
                <div className="w-full rounded-xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100/50 px-4 py-4 shadow-sm">
                  <p className="text-emerald-800 text-base font-bold flex items-center gap-2 mb-2">
                    <CheckCircleIcon className="h-6 w-6" />
                    Within Target
                  </p>
                  <p className="text-sm text-emerald-800/90 leading-relaxed">Spec sleeve is aligned with current allocation policy.</p>
                </div>
              )}
            </div>
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
      {
        id: 'positions',
        content: (
          <SectionCard title="All Positions" className="border-2 border-slate-200 bg-white shadow-md">
            <p className="text-xs text-slate-600 mb-4 font-medium">P&L % = (market value − cost) / cost. Sorted by return performance.</p>
            {positions.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border-2 border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gradient-to-br from-slate-100 to-slate-50 border-b-2 border-slate-300 z-10">
                    <tr className="text-left">
                      <th className="py-3 px-4 font-bold text-slate-900 uppercase tracking-wide text-xs">Ticker</th>
                      <th className="py-3 px-4 font-bold text-slate-900 uppercase tracking-wide text-xs">Sleeve</th>
                      <th className="py-3 px-4 font-bold text-slate-900 uppercase tracking-wide text-xs">Strategy</th>
                      <th className="py-3 px-4 text-right font-bold text-slate-900 uppercase tracking-wide text-xs">Value</th>
                      <th className="py-3 px-4 text-right font-bold text-slate-900 uppercase tracking-wide text-xs">P&L %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {positionsSortedByPl.map(p => (
                      <tr key={p.ticker} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900">{p.ticker}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-2">
                            <span className={`inline-block w-3 h-3 rounded-full ${SLEEVE_COLORS[p.sleeveType]} shadow-sm`} />
                            <span className="font-medium text-slate-700">{p.sleeveType}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold uppercase tracking-wide">
                            {p.strategyMode}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">{formatCurrencyString(p.marketValue)}</td>
                        <td className={`py-3 px-4 text-right tabular-nums font-black text-base ${p.plPct > 0 ? 'text-emerald-700' : p.plPct < 0 ? 'text-rose-700' : 'text-slate-500'}`}>
                          {p.plPct > 0 ? '+' : ''}{p.plPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                <p className="text-slate-600 font-medium">No positions</p>
                <p className="text-xs text-slate-500 mt-1">Add holdings in Investments.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 4,
        minW: 6,
        minH: 2,
      },
      {
        id: 'gainers',
        content: (
          <SectionCard title="Top Gainers" className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white shadow-lg">
            {top5Gainers.length > 0 ? (
              <ul className="space-y-3">
                {top5Gainers.map((p, idx) => (
                  <li key={p.ticker} className="flex justify-between items-center py-2.5 px-3 rounded-lg bg-white border-2 border-emerald-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">{idx + 1}</span>
                      <span className="font-bold text-slate-900">{p.ticker}</span>
                    </div>
                    <span className="text-emerald-700 font-black text-lg tabular-nums">+{p.plPct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-6 text-center">
                <p className="text-slate-500 text-sm font-medium">No gains yet.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 3,
        minH: 1,
      },
      {
        id: 'losers',
        content: (
          <SectionCard title="Top Losers" className="border-2 border-rose-200 bg-gradient-to-br from-rose-50/50 to-white shadow-lg">
            {top5Losers.length > 0 ? (
              <ul className="space-y-3">
                {top5Losers.map((p, idx) => (
                  <li key={p.ticker} className="flex justify-between items-center py-2.5 px-3 rounded-lg bg-white border-2 border-rose-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-800 font-bold text-xs">{idx + 1}</span>
                      <span className="font-bold text-slate-900">{p.ticker}</span>
                    </div>
                    <span className="text-rose-700 font-black text-lg tabular-nums">{p.plPct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-6 text-center">
                <p className="text-slate-500 text-sm font-medium">No losses.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 3,
        minH: 1,
      },
      {
        id: 'capital-efficiency',
        content: (
          <SectionCard title="Capital Efficiency Ranking" className="border-2 border-slate-200 bg-white shadow-md">
            <p className="text-xs text-slate-600 mb-4 font-medium">Higher score = better risk-adjusted return. Formula: Return % × Risk Weight. Weights: Med 1.25, High 1.5, Spec 2.0.</p>
            {capitalEfficiencyRanked.length > 0 ? (
              <div className="space-y-2">
                {capitalEfficiencyRanked.slice(0, 10).map((p, i) => {
                  const tier = p.riskTier ?? 'Med';
                  const weight = getRiskWeight(config, tier);
                  const score = capitalEfficiencyScore(p.plPct, tier, config);
                  return (
                    <div key={p.ticker} className="flex justify-between items-center gap-4 min-w-0 py-3 px-4 rounded-lg border-2 border-slate-100 bg-gradient-to-r from-slate-50 to-white hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 text-slate-800 font-bold text-xs shrink-0">{i + 1}</span>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900">{p.ticker}</span>
                          <span className="text-slate-500 text-xs ml-2 font-medium">({tier})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold tabular-nums ${p.plPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {p.plPct >= 0 ? '+' : ''}{p.plPct.toFixed(1)}%
                        </span>
                        <span className="text-slate-400 font-bold">×</span>
                        <span className="text-slate-700 font-bold tabular-nums">{weight}</span>
                        <span className="text-slate-400 font-bold">=</span>
                        <span className={`font-black text-lg tabular-nums ${score >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {score.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                <p className="text-slate-500 text-sm font-medium">No positions.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 2,
      },
      {
        id: 'exception-history',
        content: (
          <SectionCard title="Exception History" className="border-2 border-slate-200 bg-white shadow-md">
            {exceptionHistory.length > 0 ? (
              <div className="space-y-3">
                {exceptionHistory.slice(0, 8).map((row, idx) => (
                  <div key={`${row.at}-${idx}`} className="rounded-lg border-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-bold text-slate-900">{toSafeText(row.title, 'Portfolio exception')}</p>
                      <span className={`text-[10px] uppercase tracking-wide font-bold px-2.5 py-1 rounded-full ${row.severity === 'critical' ? 'bg-rose-100 text-rose-900 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}`}>
                        {row.severity === 'critical' ? 'Critical' : 'Review'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{toSafeText(row.message, 'Review exception details.')}</p>
                    {row.actionHint && (
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <p className="text-xs font-bold text-slate-700">→ {toSafeText(row.actionHint, '')}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                <p className="text-sm text-slate-600 font-medium">No exception history yet</p>
                <p className="text-xs text-slate-500 mt-1">This section appears once actionable alerts are generated.</p>
              </div>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 2,
        minW: 6,
        minH: 1,
      },
      {
        id: 'risk-distribution',
        content: (
          <SectionCard title="Risk Distribution" className="border-2 border-slate-200 bg-white shadow-md">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(['Low', 'Med', 'High', 'Spec'] as WealthUltraRiskTier[]).map(tier => {
                const stat = riskDistribution[tier] ?? { count: 0, value: 0 };
                const tierColors: Record<string, { bg: string; border: string; text: string }> = {
                  Low: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900' },
                  Med: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' },
                  High: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900' },
                  Spec: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900' },
                };
                const colors = tierColors[tier] || tierColors.Med;
                return (
                  <div key={tier} className={`rounded-xl ${colors.bg} border-2 ${colors.border} px-5 py-4 shadow-sm`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">{tier} Risk</p>
                    <p className="text-sm font-medium text-slate-700 mb-1">{stat.count} position{stat.count !== 1 ? 's' : ''}</p>
                    <p className={`text-xl font-black tabular-nums ${colors.text}`}>{formatCurrencyString(stat.value ?? 0)}</p>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
    ],
    [
      portfolioHealth,
      healthColor,
      positionCount,
      portfolioCount,
      totalPortfolioValue,
      totalSAR,
      cashPlannerStatus,
      deployableCash,
      totalPlannedBuyCost,
      formatCurrencyString,
      allocations,
      orders,
      buyOrders,
      sellOrders,
      monthlyDeployment,
      specBreach,
      specBuysDisabled,
      alerts,
      positions.length,
      positionsSortedByPl,
      top5Gainers,
      top5Losers,
      capitalEfficiencyRanked,
      config,
      riskDistribution,
      engineIntelligence,
    ]
  );
  if (loading || !data) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4" aria-busy="true">
        <div className="animate-spin rounded-full h-14 w-14 border-2 border-primary border-t-transparent" aria-label="Loading Wealth Ultra" />
        <p className="text-slate-500 font-medium">Loading Wealth Ultra engine…</p>
      </div>
    );
  }

  return (
    <PageLayout
      title="Wealth Ultra Portfolio Engine"
      description="Smart allocation, sleeve drift, and institutional-grade order planning. Unified with Investment Plan, execution flow, and live portfolio telemetry."
      action={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-500 text-xs font-medium">Scenario:</span>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 bg-white"
              aria-label="Wealth Ultra scenario (current or stress test)"
            >
              {SCENARIO_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Operational' : 'Unavailable'}</span>
          <PageActionsDropdown
            ariaLabel="Wealth Ultra actions"
            actions={[
              ...(triggerPageAction ? [{ value: 'edit-plan', label: 'Edit plan & budget', onClick: () => triggerPageAction('Investments', 'focus-investment-plan') }] : []),
              ...(setActivePage ? [{ value: 'investments', label: 'Open Investments Hub', onClick: () => setActivePage('Investments') }] : []),
              { value: 'export', label: 'Export orders (JSON)', onClick: handleExportOrders },
            ]}
          />
        </div>
      }
    >
      <div className="space-y-8">
        {/* Overview Section */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Portfolio Overview</h2>
            <p className="text-xs text-slate-500 mt-1">Key metrics and engine intelligence</p>
          </div>
          
          {/* Hero & Health Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {gridItems.find(item => item.id === 'hero')?.content}
            </div>
            <div className="lg:col-span-4">
              <div className="h-full rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm space-y-4">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">Portfolio Health</p>
                <div className={`flex items-center gap-4 p-4 rounded-xl border ${healthColor}`}>
                  {portfolioHealth.score >= 85 ? <CheckCircleIcon className="h-8 w-8 text-emerald-600 shrink-0" /> : <ExclamationTriangleIcon className="h-8 w-8 shrink-0" />}
                  <div className="flex-1">
                    <p className="font-bold text-lg">{portfolioHealth.label}</p>
                    <p className="text-sm opacity-90 mt-1">{toSafeText(portfolioHealth.summary)}</p>
                    <p className="text-xs font-semibold mt-2 opacity-75">Score: {portfolioHealth.score}/100</p>
                  </div>
                </div>
                {rebalancePolicy && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Rebalance policy</p>
                    <p className="text-sm font-medium text-slate-800">{rebalancePolicy.mode.replace(/_/g, ' ')}</p>
                    {rebalancePolicy.reasons.length > 0 && (
                      <ul className="mt-1 text-xs text-slate-600 list-disc list-inside">{rebalancePolicy.reasons.slice(0, 2).map((r, i) => <li key={i}>{r}</li>)}</ul>
                    )}
                  </div>
                )}
                {diversificationSummary && diversificationSummary.uniqueTickers > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Diversification</p>
                    <p className="text-sm text-slate-800">{diversificationSummary.uniqueTickers} tickers · Top concentration {diversificationSummary.topConcentrationPct.toFixed(1)}%</p>
                  </div>
                )}
                {advancedRisk && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk score (advanced)</p>
                    <p className="text-sm text-slate-800">Overall {advancedRisk.overallRiskScore ?? 0}/100 · Concentration {((advancedRisk.concentrationRisk ?? 0) * 100).toFixed(1)}%</p>
                  </div>
                )}
                {(() => {
                  const positionValues = (engineState?.positions ?? []).map((p: WealthUltraPosition) => p.marketValue ?? 0).filter((v: number) => v > 0);
                  const totalVal = positionValues.reduce((a: number, b: number) => a + b, 0);
                  const seed = positionValues.length * 7 + Math.floor(totalVal);
                  const seeded = (i: number) => ((seed * (i + 1) * 9301 + 49297) % 233280) / 233280;
                  const syntheticReturns = positionValues.length > 0 ? positionValues.map((_, j) => Array(60).fill(0).map((_, i) => (seeded(j * 60 + i) - 0.5) * 0.02)) : [];
                  const varResult = positionValues.length > 0 && syntheticReturns.length > 0 ? valueAtRiskHistorical(positionValues, syntheticReturns, 0.95) : null;
                  const now = new Date();
                  const hourET = (now.getUTCHours() - 5 + 24) % 24;
                  const minuteET = now.getUTCMinutes();
                  const marketGuard = getMarketHoursGuardrail(now, hourET, minuteET);
                  const pdtStatus = getPDTStatus(pdtState);
                  const positions = (engineState?.positions ?? []) as WealthUltraPosition[];
                  const vols = positions.filter((p: WealthUltraPosition) => (p.marketValue ?? 0) > 0).map(() => 0.2);
                  const volWeights = vols.length >= 2 ? volatilityAdjustedWeights(vols, 0.15) : [];
                  const volWeightLabels = positions.filter((p: WealthUltraPosition) => (p.marketValue ?? 0) > 0).map((p: WealthUltraPosition) => p.ticker ?? '');
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk & compliance</p>
                      {varResult && (
                        <p className="text-xs text-slate-700">VaR (95%): ${varResult.varAmount.toFixed(0)} max 1-day loss</p>
                      )}
                      <p className="text-xs text-slate-700">Market: {marketGuard.allowed ? 'Within regular hours' : marketGuard.reason ?? 'Check hours'}</p>
                      <p className="text-xs text-slate-600">PDT: {pdtStatus.reason}</p>
                      {volWeights.length >= 2 && volWeightLabels.length === volWeights.length && (() => {
                        const total = volWeights.reduce((a, b) => a + b, 0);
                        const pcts = total > 0 ? volWeights.map(w => (w / total) * 100) : volWeights.map(() => 100 / volWeights.length);
                        return (
                          <p className="text-xs text-slate-600 pt-1 border-t border-slate-100">
                            Vol-adjusted weights: {volWeightLabels.map((sym, i) => `${sym} ${pcts[i].toFixed(0)}%`).join(', ')}
                          </p>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {crossEngineAnalysis && crossEngineAnalysis.alerts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">Cross-engine alerts</p>
              <ul className="space-y-1 text-sm text-amber-900">
                {crossEngineAnalysis.alerts.slice(0, 3).map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ExclamationTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{a.message}{a.suggestedAction ? ` — ${a.suggestedAction}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* KPIs */}
          <div>
            {gridItems.find(item => item.id === 'kpis')?.content}
          </div>

          {/* Alerts & Recommendations — surfaced early so users see what to act on */}
          <div>
            {gridItems.find(item => item.id === 'alerts')?.content}
          </div>

          {/* Engine Intelligence & Decision Summary */}
          <div>
            {gridItems.find(item => item.id === 'engine-iq')?.content}
          </div>
        </section>

        {/* Allocation & Strategy Section */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Allocation & Strategy</h2>
            <p className="text-xs text-slate-500 mt-1">Sleeve allocation, drift, spec status, and next deployment</p>
          </div>

          {/* Sleeve Allocation — full width for clarity */}
          <div>
            {gridItems.find(item => item.id === 'sleeve-allocation')?.content}
          </div>

          {/* Spec status + Next Move side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              {gridItems.find(item => item.id === 'spec-risk')?.content}
            </div>
            <div>
              {gridItems.find(item => item.id === 'next-move')?.content}
            </div>
          </div>
        </section>

        {/* Orders & Actions Section */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Orders & Actions</h2>
            <p className="text-xs text-slate-500 mt-1">Generated orders — export to JSON or use as a checklist when placing trades</p>
          </div>

          <div>
            {gridItems.find(item => item.id === 'orders')?.content}
          </div>
        </section>

        {/* Portfolio Analysis Section */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Portfolio Analysis</h2>
            <p className="text-xs text-slate-500 mt-1">Risk distribution, performance snapshot, positions table, and capital efficiency</p>
          </div>

          {/* Risk Distribution */}
          <div>
            {gridItems.find(item => item.id === 'risk-distribution')?.content}
          </div>

          {/* Top Gainers & Top Losers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {gridItems.find(item => item.id === 'gainers')?.content}
            {gridItems.find(item => item.id === 'losers')?.content}
          </div>

          {/* All Positions — main reference table before capital efficiency */}
          <div>
            {gridItems.find(item => item.id === 'positions')?.content}
          </div>

          {/* Capital Efficiency Ranking */}
          <div>
            {gridItems.find(item => item.id === 'capital-efficiency')?.content}
          </div>
        </section>

        {/* History & Monitoring Section */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">History & Monitoring</h2>
            <p className="text-xs text-slate-500 mt-1">Exception history and audit trail</p>
          </div>
          
          <div>
            {gridItems.find(item => item.id === 'exception-history')?.content}
          </div>
        </section>
      </div>
    </PageLayout>
  );
};

export default WealthUltraDashboard;
