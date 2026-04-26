import React, { useMemo, useContext, useEffect, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { useAI } from '../context/AiContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { aggregateMonthlyBudgetAcrossPortfolios } from '../utils/investmentPlanPerPortfolio';
import type { InvestmentPlanSettings, UniverseTicker } from '../types';
import AIAdvisor from '../components/AIAdvisor';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import {
  runWealthUltraEngine,
  exportOrdersJson,
  capitalEfficiencyScore,
  getRiskWeight,
  getDefaultWealthUltraConfig,
  buildFinancialWealthUltraConfig,
} from '../wealth-ultra';
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
import InfoHint from '../components/InfoHint';
import CurrencyDualDisplay from '../components/CurrencyDualDisplay';
import CollapsibleSection from '../components/CollapsibleSection';
import { formatUniverseMonthlyWeightFraction, getUniversePlanRoleLabel } from '../services/universePlanRole';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel, formatSymbolWithCompany } from '../components/SymbolWithCompanyName';

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
  const { exchangeRate } = useCurrency();
  const { isAiAvailable, aiHealthChecked } = useAI();

  const sarPerUsd = useMemo(() => resolveSarPerUsd(data ?? null, exchangeRate), [data, exchangeRate]);

  /** Engine outputs (positions, orders, deployable cash from config) are interpreted as USD for display consistency. */
  const fmtEngineUsd = useCallback(
    (n: number, digits = 0) => formatCurrencyString(n, { inCurrency: 'USD', showSecondary: true, digits }),
    [formatCurrencyString]
  );
  const [scenarioId, setScenarioId] = React.useState('current');

  const { analysis: crossEngineAnalysis, household, cash } = useFinancialEnginesIntegration();

  const effectiveDeployableCash = useMemo(() => {
    const base = totalDeployableCash ?? 0;
    if (base <= 0) return base;
    const hasCriticalStress = household?.cashflowStressSignals?.some((s: { type: string }) => s.type === 'critical');
    const lowBuffer = (cash?.cashflowBuffer ?? 999) < 2;
    if (hasCriticalStress || lowBuffer) {
      const cap = cash?.discretionaryBudget ?? base;
      return Math.max(0, Math.min(base, cap));
    }
    return base;
  }, [totalDeployableCash, household?.cashflowStressSignals, cash?.cashflowBuffer, cash?.discretionaryBudget]);

  const personalInvestments = useMemo(
    () => ((data as any)?.personalInvestments ?? data?.investments ?? []) as Array<{ id: string; name?: string; holdings?: unknown[] }>,
    [data?.investments, (data as any)?.personalInvestments]
  );
  const portfolioIds = useMemo(() => personalInvestments.map((p) => p.id).filter(Boolean), [personalInvestments]);

  const investmentHoldingsCount = useMemo(() => {
    return personalInvestments.reduce(
      (n: number, p: { holdings?: unknown[] }) => n + (p.holdings?.length ?? 0),
      0
    );
  }, [personalInvestments]);

  const aggBudget = useMemo(() => {
    if (!data?.investmentPlan) return { total: 0, planCurrency: 'SAR' as const };
    return aggregateMonthlyBudgetAcrossPortfolios(
      data.investmentPlan as InvestmentPlanSettings,
      portfolioIds,
      data.investmentPlan as InvestmentPlanSettings
    );
  }, [data?.investmentPlan, portfolioIds]);

  const planSnapshot = useMemo(() => {
    const p = data?.investmentPlan as InvestmentPlanSettings | undefined;
    if (!p) return null;
    const core = Number(p.coreAllocation);
    const up = Number(p.upsideAllocation);
    return {
      monthlyBudget: Number(p.monthlyBudget) || 0,
      budgetCurrency: (p.budgetCurrency as 'SAR') || 'SAR',
      corePct: Number.isFinite(core) ? core * 100 : 0,
      upsidePct: Number.isFinite(up) ? up * 100 : 0,
    };
  }, [data?.investmentPlan]);

  const planValidation = useMemo(() => {
    const p = data?.investmentPlan as InvestmentPlanSettings | undefined;
    if (!p) {
      return {
        hasPlan: false,
        totalAllocationPct: 0,
        isAllocationBalanced: false,
        issues: ['Investment Plan is not configured yet.'],
      };
    }

    const core = Number(p.coreAllocation);
    const upside = Number(p.upsideAllocation);
    const total = (Number.isFinite(core) ? core : 0) + (Number.isFinite(upside) ? upside : 0);
    const totalPct = total * 100;
    const issues: string[] = [];

    if (!Number.isFinite(core) || !Number.isFinite(upside)) {
      issues.push('Core/Upside allocation values are invalid.');
    }
    if (Math.abs(total - 1) > 0.0001) {
      issues.push(`Core + Upside allocation should equal 100%, currently ${totalPct.toFixed(1)}%.`);
    }
    if ((Number(p.monthlyBudget) || 0) < 0) {
      issues.push('Monthly budget cannot be negative.');
    }
    if ((Number(p.monthlyBudget) || 0) === 0) {
      issues.push('Monthly budget is 0. Set a monthly target to unlock full automation recommendations.');
    }

    return {
      hasPlan: true,
      totalAllocationPct: totalPct,
      isAllocationBalanced: issues.every((m) => !m.includes('allocation')),
      issues,
    };
  }, [data?.investmentPlan]);

  const universeByPortfolio = useMemo(() => {
    const rows = (data?.portfolioUniverse ?? []) as UniverseTicker[];
    const map = new Map<string | '__unassigned__', UniverseTicker[]>();
    for (const t of rows) {
      const key = t.portfolioId ? String(t.portfolioId) : '__unassigned__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return { map, rows };
  }, [data?.portfolioUniverse]);

  const engineBundle = useMemo(() => {
    const personalInvestments = (data as any)?.personalInvestments ?? data?.investments ?? [];
    const personalAccounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
    const allHoldings = personalInvestments.flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
    const priceMap: Record<string, number> = {};
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      priceMap[sym.toUpperCase()] = (o as { price: number }).price;
    });
    allHoldings.forEach((h: { symbol?: string; quantity?: number; currentValue?: number }) => {
      const sym = (h.symbol || '').toUpperCase();
      if (!priceMap[sym] && (h.quantity ?? 0) > 0) priceMap[sym] = (h.currentValue ?? 0) / (h.quantity ?? 1);
    });
    const scenario = SCENARIO_OPTIONS.find(s => s.id === scenarioId) ?? SCENARIO_OPTIONS[0];
    if (scenario.multiplier !== 1) {
      Object.keys(priceMap).forEach(sym => { priceMap[sym] = priceMap[sym] * scenario.multiplier; });
    }
    const config = buildFinancialWealthUltraConfig(
      {
        investmentPlan: data?.investmentPlan,
        wealthUltraConfig: data?.wealthUltraConfig,
        settings: data?.settings,
        accounts: personalAccounts,
        portfolioUniverse: data?.portfolioUniverse ?? [],
        investments: personalInvestments,
      },
      effectiveDeployableCash
    );
    try {
      const state = runWealthUltraEngine({
        holdings: allHoldings as any,
        priceMap,
        config,
      });
      return { state, engineWarning: null as string | null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Wealth Ultra] engine error, using validated defaults', e);
      try {
        const state = runWealthUltraEngine({
          holdings: [],
          priceMap: {},
          config: getDefaultWealthUltraConfig(),
        });
        return {
          state,
          engineWarning: `Showing safe defaults because the engine could not run with your plan/config: ${msg}. Ensure Investment Plan sleeve targets sum to 100% and Wealth Ultra parameters are valid.`,
        };
      } catch (e2) {
        console.error('[Wealth Ultra] fatal engine error', e2);
        throw e2;
      }
    }
  }, [data?.investments, data?.investmentPlan, data?.accounts, data?.wealthUltraConfig, data?.settings, data?.portfolioUniverse, (data as any)?.personalInvestments, (data as any)?.personalAccounts, simulatedPrices, effectiveDeployableCash, scenarioId]);

  const engineState = engineBundle.state;
  const engineWarning = engineBundle.engineWarning;

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

  const positions = engineState.positions || [];
  const top5Gainers = positions.filter(p => p.plPct > 0).sort((a, b) => b.plPct - a.plPct).slice(0, 5);
  const top5Losers = positions.filter(p => p.plPct < 0).sort((a, b) => a.plPct - b.plPct).slice(0, 5);
  const positionCount = positions.length;
  const portfolioCount = personalInvestments.filter((p: { holdings?: unknown[] }) => (p.holdings?.length ?? 0) > 0).length;
  const buyOrders = orders.filter(o => o.type === 'BUY');
  const sellOrders = orders.filter(o => o.type === 'SELL');

  const wealthUltraAiContext = useMemo(
    () => ({
      totalPortfolioValueUsd: totalPortfolioValue,
      deployableCashUsd: deployableCash,
      totalPlannedBuyCostUsd: totalPlannedBuyCost,
      monthlyDeployUsd: monthlyDeployment.amountToDeploy,
      monthlyBudgetTotal: aggBudget.total,
      monthlyBudgetCurrency: aggBudget.planCurrency,
      sarPerUsd,
      portfolioHealthLabel: portfolioHealth.label,
      portfolioHealthScore: portfolioHealth.score,
      alertCount: alerts.length,
      buyOrderCount: buyOrders.length,
      positionCount: positions.length,
      investmentPortfolioCount: personalInvestments.length,
      universeTickerCount: (data?.portfolioUniverse ?? []).length,
      cashPlannerStatus,
    }),
    [
      totalPortfolioValue,
      deployableCash,
      totalPlannedBuyCost,
      monthlyDeployment.amountToDeploy,
      aggBudget.total,
      aggBudget.planCurrency,
      sarPerUsd,
      portfolioHealth.label,
      portfolioHealth.score,
      alerts.length,
      buyOrders.length,
      positions.length,
      personalInvestments.length,
      data?.portfolioUniverse,
      cashPlannerStatus,
    ]
  );

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

  const ultraTickerSymbols = useMemo(() => {
    const set = new Set<string>();
    positions.forEach((p) => {
      if (p.ticker) set.add(p.ticker);
    });
    if (monthlyDeployment.suggestedTicker) set.add(monthlyDeployment.suggestedTicker);
    (orders ?? []).forEach((o: { ticker?: string }) => {
      if (o.ticker) set.add(o.ticker);
    });
    return Array.from(set).filter((s) => s.length >= 2);
  }, [positions, monthlyDeployment.suggestedTicker, orders]);
  const { names: ultraTickerNames } = useCompanyNames(ultraTickerSymbols);

  const healthColor = portfolioHealth.score >= 85 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : portfolioHealth.score >= 65 ? 'text-amber-600 bg-amber-50 border-amber-200' : portfolioHealth.score >= 40 ? 'text-amber-700 bg-amber-100 border-amber-300' : 'text-rose-600 bg-rose-50 border-rose-200';

  const dataValidation = useMemo(() => {
    const issues: string[] = [];
    if (Math.abs((config.fxRate ?? sarPerUsd) - sarPerUsd) > 0.0001) {
      issues.push(`FX config mismatch detected (config ${config.fxRate.toFixed(4)} vs resolved ${sarPerUsd.toFixed(4)} SAR/USD). Resolved rate is used for display and conversions.`);
    }
    if (portfolioIds.length > 0 && universeByPortfolio.rows.length === 0) {
      issues.push('No portfolio universe symbols found. Add tickers in Investments → Portfolio universe for full automation.');
    }
    if (cashPlannerStatus !== 'WITHIN_LIMIT') {
      issues.push(`Buy plan exceeds deployable cash by ${fmtEngineUsd(Math.max(0, totalPlannedBuyCost - deployableCash), 0)}.`);
    }
    if (planValidation.issues.length > 0) {
      issues.push(...planValidation.issues);
    }
    return issues;
  }, [config.fxRate, sarPerUsd, portfolioIds.length, universeByPortfolio.rows.length, cashPlannerStatus, totalPlannedBuyCost, deployableCash, fmtEngineUsd, planValidation.issues]);

  const criticalValidationIssues = useMemo(
    () => dataValidation.filter((msg) => /should equal 100%|cannot be negative|exceeds deployable cash|not configured yet/i.test(msg)),
    [dataValidation]
  );
  const hasBlockingValidationIssue = criticalValidationIssues.length > 0;
  const exportActionLabel = hasBlockingValidationIssue
    ? `Export orders (blocked: ${criticalValidationIssues.length} critical check${criticalValidationIssues.length === 1 ? '' : 's'})`
    : 'Export orders (JSON)';

  const metricConfidence = useMemo(() => {
    const hasHoldings = investmentHoldingsCount > 0;
    const hasPlan = !!planSnapshot;
    const fxHealthy = Math.abs((config.fxRate ?? sarPerUsd) - sarPerUsd) <= 0.0001;
    return {
      totalPortfolio: hasHoldings ? 'High' : 'Medium',
      planBudget: hasPlan ? 'High' : 'Low',
      deployableCash: Number.isFinite(deployableCash) ? 'High' : 'Low',
      orderbook: hasBlockingValidationIssue ? 'Low' : orders.length > 0 ? 'High' : 'Medium',
      fx: fxHealthy ? 'High' : 'Medium',
    } as const;
  }, [investmentHoldingsCount, planSnapshot, config.fxRate, sarPerUsd, deployableCash, hasBlockingValidationIssue, orders.length]);

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
        reason: `Planned buys ${fmtEngineUsd(totalPlannedBuyCost)} exceed deployable cash ${fmtEngineUsd(deployableCash)}.`,
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
        reason: `Current monthly deployment target is ${fmtEngineUsd(monthlyDeployment.amountToDeploy)}; convert top BUY orders into recurring instructions.`,
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
  }, [allocations, alerts.length, cashPlannerStatus, deployableCash, fmtEngineUsd, monthlyDeployment, orders.length, positions.length, specBreach, specBuysDisabled, totalPlannedBuyCost]);

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
          <SectionCard
            title="Wealth Ultra Engine"
            className="border border-slate-200 bg-white shadow-sm"
            collapsible
            collapsibleSummary="Overview"
            defaultExpanded
          >
            <div className="space-y-4">
              <p className="text-slate-700 leading-relaxed max-w-3xl">
                Reads the same <strong className="font-semibold text-slate-900">Investment Plan</strong> (monthly budget + Core/Upside split) and <strong className="font-semibold text-slate-900">portfolio universe</strong> as Investments, then runs sleeve drift, cash checks, and suggested orders. Nothing here replaces editing your plan in the Investments hub.
              </p>
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-xs text-slate-600 font-medium max-w-3xl">
                Engine totals below use <span className="font-semibold text-slate-900">USD</span> (share prices and order math). SAR in parentheses uses the same rate as the rest of the app:{' '}
                <span className="font-mono font-semibold text-slate-800">{sarPerUsd.toFixed(4)}</span> SAR per 1 USD
                {Number.isFinite(config.fxRate) && Math.abs(config.fxRate - sarPerUsd) > 0.0001 && (
                  <span className="text-slate-500"> (stored config {config.fxRate.toFixed(4)} is ignored for display — resolver wins)</span>
                )}
                .
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <Card
                title="Total portfolio value"
                value={<CurrencyDualDisplay value={totalPortfolioValue} inCurrency="USD" digits={0} size="2xl" />}
                trend={`SAR equivalent uses ${sarPerUsd.toFixed(4)} / USD · Confidence: ${metricConfidence.totalPortfolio}`}
                density="compact"
                indicatorColor="green"
                valueColor="text-slate-900"
                tooltip="Wealth Ultra values holdings using USD notionally; SAR is for comparison with the rest of your Finova totals."
              />
              <Card
                title="Combined monthly plan budget"
                value={
                  aggBudget.total > 0 ? (
                    <CurrencyDualDisplay value={aggBudget.total} inCurrency="SAR" digits={2} size="2xl" />
                  ) : (
                    'No monthly target'
                  )
                }
                trend={
                  aggBudget.total > 0
                    ? `Summed from Investment Plan across ${portfolioIds.length || 'your'} portfolio(s) · Confidence: ${metricConfidence.planBudget}`
                    : 'Set budgets per portfolio in Investments → Investment Plan'
                }
                density="compact"
                indicatorColor={aggBudget.total > 0 ? 'green' : 'yellow'}
                valueColor="text-slate-900"
                tooltip="Pulled from your saved Investment Plan (per portfolio when set). This is separate from the engine’s USD deployment line."
              />
              <Card
                title="Deployable cash (engine)"
                value={<CurrencyDualDisplay value={deployableCash} inCurrency="USD" digits={0} size="2xl" />}
                trend={`Confidence: ${metricConfidence.deployableCash} · FX consistency: ${metricConfidence.fx}`}
                density="compact"
                indicatorColor={deployableCash > 0 ? 'green' : 'yellow'}
                valueColor="text-slate-900"
                tooltip="Cash available for buys after reserve, in the engine’s USD view — matches the cash pipeline feeding Wealth Ultra."
              />
              <Card
                title="Planned buys (engine)"
                value={<CurrencyDualDisplay value={totalPlannedBuyCost} inCurrency="USD" digits={0} size="2xl" />}
                trend={`Confidence: ${metricConfidence.orderbook}`}
                density="compact"
                indicatorColor={totalPlannedBuyCost > 0 ? 'green' : undefined}
                valueColor="text-slate-900"
                tooltip="Total notional USD cost of suggested BUY orders from the engine this run."
              />
              <Card
                title="Cash plan vs orders"
                value={cashPlannerStatus === 'WITHIN_LIMIT' ? 'Within limit' : 'Over budget'}
                indicatorColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'green' : 'red'}
                density="compact"
                valueColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'text-emerald-700' : 'text-rose-700'}
                tooltip="Compares planned BUY cost vs deployable cash in the engine. “Over budget” means suggested buys exceed that cash line."
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
          <SectionCard
            title="Alerts & Recommendations"
            className="h-full border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary={`${alerts.length} alert(s)`}
            defaultExpanded
          >
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
          <SectionCard
            title="Engine Intelligence & Decision Summary"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary="IQ score & actions"
            defaultExpanded
          >
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
          <SectionCard
            title="Sleeve Allocation & Drift Analysis"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary="Core / Upside / Spec"
            defaultExpanded
          >
            <p className="text-xs text-slate-600 mb-6 font-medium">
              Current vs target allocation. Drift &gt;5% suggests rebalancing action. With no portfolio value, drift is not measured (shown as 0%).
            </p>
            {totalPortfolioValue <= 0 && (
              <p className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-4">
                Add holdings with market value in Investments to measure sleeve drift. Targets below still reflect your plan and defaults.
              </p>
            )}
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
                          <p className="text-sm text-slate-700 mt-1 tabular-nums font-medium">Value: {fmtEngineUsd(a.marketValue, 0)}</p>
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
          <SectionCard
            title="Generated Orders"
            className="border-2 border-primary/30 bg-gradient-to-br from-white to-primary/5 shadow-lg"
            collapsible
            collapsibleSummary="Buys & sells"
            defaultExpanded
          >
            <p className="text-xs text-slate-700 mb-5 font-medium">
              Suggested limit orders from the engine. Export JSON or use the list as a manual checklist at your broker. Finova does not connect to any broker API and does not send trades automatically.
            </p>
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
                          <span className="min-w-0">
                            <ResolvedSymbolLabel
                              symbol={o.ticker}
                              names={ultraTickerNames}
                              layout="inline"
                              symbolClassName="font-mono font-bold text-slate-900"
                            />
                          </span>
                          <span className="text-slate-700 font-medium">Qty: <span className="font-bold">{o.qty}</span></span>
                          <span className="text-slate-700 font-medium">Limit: <span className="font-bold tabular-nums">{fmtEngineUsd(o.limitPrice ?? 0, 2)}</span></span>
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
                          <span className="min-w-0">
                            <ResolvedSymbolLabel
                              symbol={o.ticker}
                              names={ultraTickerNames}
                              layout="inline"
                              symbolClassName="font-mono font-bold text-slate-900"
                            />
                          </span>
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
          <SectionCard
            title="Next Move — Monthly Deployment"
            className="h-full border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-white shadow-lg"
            collapsible
            collapsibleSummary="Deploy amount"
            defaultExpanded
          >
            <div className="h-full flex flex-col justify-between gap-4">
              <p className="text-sm leading-relaxed text-slate-700 font-medium">{toSafeText(monthlyDeployment.reason, 'Review allocation before deploying.')}</p>
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Planned Deployment</span>
                  <span className="text-2xl font-black text-slate-900 tabular-nums">{fmtEngineUsd(monthlyDeployment.amountToDeploy, 0)}</span>
                </div>
                {monthlyDeployment.suggestedTicker && (
                  <div className="inline-flex flex-col sm:flex-row items-center gap-2 rounded-lg bg-primary/20 border-2 border-primary/30 text-primary px-4 py-2 w-full justify-center text-center">
                    <span className="text-xs uppercase tracking-wide text-primary/90 font-bold">Ticker</span>
                    <ResolvedSymbolLabel
                      symbol={monthlyDeployment.suggestedTicker}
                      names={ultraTickerNames}
                      layout="stacked"
                      symbolClassName="font-mono font-bold text-lg text-primary"
                      companyClassName="text-xs text-primary/90 font-medium"
                    />
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
          <SectionCard
            title="Speculative Sleeve Status"
            className="h-full min-h-[140px] border-2 border-rose-200 bg-gradient-to-br from-rose-50/50 to-white shadow-lg"
            collapsible
            collapsibleSummary="Spec policy"
            defaultExpanded
          >
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
          <SectionCard
            title="All Positions"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary={`${positions.length} position(s)`}
            defaultExpanded
          >
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
                        <td className="py-3 px-4 min-w-0">
                          <ResolvedSymbolLabel
                            symbol={p.ticker}
                            names={ultraTickerNames}
                            layout="stacked"
                            symbolClassName="font-bold text-slate-900"
                            companyClassName="text-xs text-slate-500 font-medium"
                          />
                        </td>
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
                        <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">{fmtEngineUsd(p.marketValue, 0)}</td>
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
          <SectionCard
            title="Top Gainers"
            className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white shadow-lg"
            collapsible
            collapsibleSummary="Best P&L"
            defaultExpanded
          >
            {top5Gainers.length > 0 ? (
              <ul className="space-y-3">
                {top5Gainers.map((p, idx) => (
                  <li key={p.ticker} className="flex justify-between items-center py-2.5 px-3 rounded-lg bg-white border-2 border-emerald-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">{idx + 1}</span>
                      <span className="min-w-0">
                        <ResolvedSymbolLabel
                          symbol={p.ticker}
                          names={ultraTickerNames}
                          layout="inline"
                          symbolClassName="font-bold text-slate-900"
                        />
                      </span>
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
          <SectionCard
            title="Top Losers"
            className="border-2 border-rose-200 bg-gradient-to-br from-rose-50/50 to-white shadow-lg"
            collapsible
            collapsibleSummary="Worst P&L"
            defaultExpanded
          >
            {top5Losers.length > 0 ? (
              <ul className="space-y-3">
                {top5Losers.map((p, idx) => (
                  <li key={p.ticker} className="flex justify-between items-center py-2.5 px-3 rounded-lg bg-white border-2 border-rose-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-800 font-bold text-xs">{idx + 1}</span>
                      <span className="min-w-0">
                        <ResolvedSymbolLabel
                          symbol={p.ticker}
                          names={ultraTickerNames}
                          layout="inline"
                          symbolClassName="font-bold text-slate-900"
                        />
                      </span>
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
          <SectionCard
            title="Capital Efficiency Ranking"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary="Risk-adjusted"
            defaultExpanded
          >
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
                          <ResolvedSymbolLabel
                            symbol={p.ticker}
                            names={ultraTickerNames}
                            layout="inline"
                            symbolClassName="font-bold text-slate-900"
                            companyClassName="text-slate-500 text-xs font-medium"
                          />
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
          <SectionCard
            title="Exception History"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary="Past alerts"
            defaultExpanded
          >
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
          <SectionCard
            title="Risk Distribution"
            className="border-2 border-slate-200 bg-white shadow-md"
            collapsible
            collapsibleSummary="Low–Spec"
            defaultExpanded
          >
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
                    <p className={`text-xl font-black tabular-nums ${colors.text}`}>{fmtEngineUsd(stat.value ?? 0, 0)}</p>
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
      sarPerUsd,
      aggBudget,
      portfolioIds,
      config.fxRate,
      cashPlannerStatus,
      deployableCash,
      totalPlannedBuyCost,
      formatCurrencyString,
      fmtEngineUsd,
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
      ultraTickerNames,
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
      title="Wealth Ultra Engine"
      description="Simple, automated portfolio cockpit. Wealth Ultra reads your plan + universe + holdings and proposes the next safe moves."
      action={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-slate-500 text-xs font-medium">Scenario:</span>
            <InfoHint text="Current uses live/simulated prices. Market −10% / −20% stress all holding prices uniformly to see allocation, drift, and orders under a simple drawdown—illustrative, not a full risk model." />
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
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${!aiHealthChecked ? 'bg-slate-100 text-slate-600 border border-slate-200' : isAiAvailable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{!aiHealthChecked ? 'Checking…' : <>{isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Operational' : 'Unavailable'}</>}</span>
          <PageActionsDropdown
            ariaLabel="Wealth Ultra actions"
            actions={[
              ...(triggerPageAction
                ? [
                    { value: 'edit-plan', label: 'Investment Plan (budget & sleeves)', onClick: () => triggerPageAction('Investments', 'focus-investment-plan') },
                    { value: 'recovery', label: 'Recovery Plan', onClick: () => triggerPageAction('Investments', 'investment-tab:Recovery Plan') },
                  ]
                : []),
              ...(setActivePage ? [{ value: 'investments', label: 'Investments hub', onClick: () => setActivePage('Investments') }] : []),
              { value: 'export', label: exportActionLabel, disabled: hasBlockingValidationIssue, onClick: handleExportOrders },
            ]}
          />
        </div>
      }
    >
      <div className="space-y-8 md:space-y-10 lg:space-y-12">
        {engineWarning && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm" role="alert">
            <p className="font-semibold flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" /> Engine fallback active
            </p>
            <p className="mt-2 leading-relaxed">{engineWarning}</p>
          </div>
        )}
        {investmentHoldingsCount === 0 && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/95 p-4 text-sm text-sky-950">
            <p className="font-semibold">No investment holdings in scope</p>
            <p className="mt-1 text-sky-900/90 leading-relaxed">
              Sleeve drift, positions, and order suggestions fill in once you add holdings under Investments. Cash deployable, plan targets, and stress scenarios still run from your accounts and settings.
            </p>
          </div>
        )}
        {hasBlockingValidationIssue && (
          <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4 sm:p-5 text-sm text-rose-900">
            <p className="font-semibold">Critical validation checks are blocking order export</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {criticalValidationIssues.map((issue, idx) => (
                <li key={`${issue}-${idx}`}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <SectionCard
          title="Wealth Ultra autopilot"
          className="border-slate-200 bg-gradient-to-br from-white via-slate-50 to-violet-50/30 shadow-sm"
          collapsible
          collapsibleSummary="Simple status + next safe moves"
          defaultExpanded
          infoHint="Designed for non-financial users: check status, review the suggested orders, export, then record trades at your broker."
        >
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    hasBlockingValidationIssue
                      ? 'bg-rose-100 text-rose-800'
                      : portfolioHealth.score >= 85
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {hasBlockingValidationIssue ? (
                    <ExclamationTriangleIcon className="h-4 w-4" />
                  ) : portfolioHealth.score >= 85 ? (
                    <CheckCircleIcon className="h-4 w-4" />
                  ) : (
                    <ExclamationTriangleIcon className="h-4 w-4" />
                  )}
                  {hasBlockingValidationIssue ? 'Blocked' : portfolioHealth.score >= 85 ? 'Ready' : 'Review'}
                </span>
                <p className="text-sm font-semibold text-slate-900">
                  {hasBlockingValidationIssue ? 'Fix blockers first, then export orders.' : 'Next safe moves are ready.'}
                </p>
              </div>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed max-w-3xl">
                Engine math uses <strong>USD</strong> internally (prices + order notional). SAR equivalents use your app FX resolver:{' '}
                <strong className="font-mono">{sarPerUsd.toFixed(4)}</strong> SAR/USD.
              </p>
              {planValidation.issues.length > 0 && (
                <ul className="mt-3 text-xs text-amber-900 space-y-1 list-disc pl-5">
                  {planValidation.issues.slice(0, 4).map((x, i) => (
                    <li key={`wu-plan-issue-${i}`}>{x}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {triggerPageAction && (
                <button
                  type="button"
                  onClick={() => triggerPageAction('Investments', 'focus-investment-plan')}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-slate-800"
                >
                  Open Investment Plan
                </button>
              )}
              {setActivePage && (
                <button
                  type="button"
                  onClick={() => setActivePage('Investments')}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
                >
                  Investments hub
                </button>
              )}
              <button
                type="button"
                disabled={hasBlockingValidationIssue}
                onClick={handleExportOrders}
                className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-xs font-extrabold ${
                  hasBlockingValidationIssue ? 'bg-slate-200 text-slate-500' : 'bg-primary text-white hover:bg-primary/90'
                }`}
              >
                {exportActionLabel}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Card
              title="Total portfolio value"
              value={<CurrencyDualDisplay value={totalPortfolioValue} inCurrency="USD" digits={0} size="2xl" />}
              trend={`Confidence: ${metricConfidence.totalPortfolio}`}
              density="compact"
              indicatorColor="green"
              valueColor="text-slate-900"
              tooltip="Total market value as the engine sees it (USD)."
            />
            <Card
              title="Deployable cash"
              value={<CurrencyDualDisplay value={deployableCash} inCurrency="USD" digits={0} size="2xl" />}
              trend={`Confidence: ${metricConfidence.deployableCash}`}
              density="compact"
              indicatorColor={deployableCash > 0 ? 'green' : 'yellow'}
              valueColor="text-slate-900"
              tooltip="Engine deployable cash after reserve logic."
            />
            <Card
              title="Planned buys"
              value={<CurrencyDualDisplay value={totalPlannedBuyCost} inCurrency="USD" digits={0} size="2xl" />}
              trend={`Confidence: ${metricConfidence.orderbook}`}
              density="compact"
              indicatorColor={totalPlannedBuyCost > 0 ? 'green' : 'yellow'}
              valueColor="text-slate-900"
              tooltip="Total BUY notional from suggested orders."
            />
            <Card
              title="Orders status"
              value={cashPlannerStatus === 'WITHIN_LIMIT' ? 'Within cash' : 'Over cash'}
              trend={`Engine IQ: ${engineIntelligence.iqScore}/100`}
              density="compact"
              indicatorColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'green' : 'red'}
              valueColor={cashPlannerStatus === 'WITHIN_LIMIT' ? 'text-emerald-700' : 'text-rose-700'}
              tooltip="Within cash means suggested BUY orders fit inside deployable cash."
            />
          </div>
        </SectionCard>

        <CollapsibleSection
          title="Engine rules & data flow"
          summary="What feeds this page"
          defaultExpanded={false}
          className="border border-slate-200 bg-slate-50/50"
        >
          <ol className="list-decimal pl-5 space-y-3 text-sm text-slate-700 leading-relaxed max-w-4xl">
            <li>
              <span className="font-semibold text-slate-900">Investment Plan</span> (Investments → Investment Plan) defines monthly budget in SAR and Core vs High-Upside split. Wealth Ultra reads that for deployment context; the KPI &quot;Combined monthly plan budget&quot; is the same aggregate.
            </li>
            <li>
              <span className="font-semibold text-slate-900">Portfolio universe</span> tickers and statuses match Investments. Sleeve targets and drift use holdings + universe classification.
            </li>
            <li>
              <span className="font-semibold text-slate-900">USD in tables below</span> is the engine&apos;s internal convention for value and order math; SAR equivalents use your app FX rate ({sarPerUsd.toFixed(4)} SAR/USD).
            </li>
            <li>
              <span className="font-semibold text-slate-900">Generated orders</span> are suggestions and export only — Finova does not send trades to any broker.
            </li>
            <li>
              <span className="font-semibold text-slate-900">Cross-engine alerts</span> may reference household cash or budgets from other services when relevant.
            </li>
          </ol>
        </CollapsibleSection>

        <SectionCard
          title="Investment Plan link"
          className="border border-indigo-100 bg-indigo-50/30 shadow-sm"
          collapsible
          collapsibleSummary="Budget & sleeve split (read-only here)"
          defaultExpanded={false}
          infoHint="This mirrors your saved plan. Edit budgets, universe, and execution in Investments — not on this page."
        >
          {planSnapshot ? (
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
                <div className="rounded-xl border border-white bg-white/80 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Monthly budget (saved)</p>
                  <CurrencyDualDisplay value={planSnapshot.monthlyBudget} inCurrency={planSnapshot.budgetCurrency} digits={0} size="xl" weight="bold" className="text-slate-900" />
                </div>
                <div className="rounded-xl border border-white bg-white/80 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Core sleeve</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{planSnapshot.corePct.toFixed(0)}%</p>
                </div>
                <div className="rounded-xl border border-white bg-white/80 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">High-Upside sleeve</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{planSnapshot.upsidePct.toFixed(0)}%</p>
                </div>
              </div>
              {triggerPageAction && (
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => triggerPageAction('Investments', 'focus-investment-plan')}
                    className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
                  >
                    Edit in Investment Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerPageAction('Investments', 'investment-tab:Recovery Plan')}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Recovery Plan
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No Investment Plan saved yet. Open Investments → Investment Plan to set a monthly budget and sleeves.</p>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Aggregated monthly budget across portfolios (KPI strip):{' '}
            {aggBudget.total > 0 ? (
              <CurrencyDualDisplay value={aggBudget.total} inCurrency="SAR" digits={0} size="base" className="inline-flex" />
            ) : (
              <span>—</span>
            )}
            {portfolioIds.length > 0 && (
              <span className="text-slate-400"> · {portfolioIds.length} portfolio(s) in scope</span>
            )}
          </p>
        </SectionCard>

        {/* Overview Section */}
        <section className="space-y-8">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Portfolio Overview</h2>
            <p className="text-xs text-slate-500 mt-1">Key metrics and engine intelligence</p>
          </div>

          <AIAdvisor
            pageContext="wealthUltra"
            contextData={wealthUltraAiContext}
            title="Portfolio insights"
            subtitle="Plain-language summary of this page. After generating, switch to English or العربية."
            buttonLabel="Explain this screen"
          />
          
          {/* Hero & Health Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
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
                    <p className="text-sm text-slate-800">Overall {(advancedRisk.overallRiskScore ?? 0).toFixed(1)}/100 · Concentration {((advancedRisk.concentrationRisk ?? 0) * 100).toFixed(1)}%</p>
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
                  const volWeightLabels = positions
                    .filter((p: WealthUltraPosition) => (p.marketValue ?? 0) > 0)
                    .map((p: WealthUltraPosition) => formatSymbolWithCompany(p.ticker ?? '', undefined, ultraTickerNames));
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk & compliance</p>
                      <p className="text-[10px] text-slate-400 leading-snug border-b border-slate-100 pb-2 mb-1">
                        VaR below uses a short synthetic return series for illustration only — not a live risk model or forecast.
                      </p>
                      {varResult && (
                        <p className="text-xs text-slate-700">VaR (95%, illustrative): ${varResult.varAmount.toFixed(0)} notional stress</p>
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

          <SectionCard
            title="Data Quality & Automation Checks"
            className="border border-slate-200 bg-white shadow-sm"
            collapsible
            collapsibleSummary={dataValidation.length === 0 ? 'All checks passed' : `${dataValidation.length} check(s) need attention`}
            defaultExpanded
            infoHint="These checks verify plan completeness, FX consistency, and order-vs-cash safety before acting on engine output."
          >
            {dataValidation.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                All core validation checks passed. Wealth Ultra is fully wired to your current plan, holdings, and currency settings.
              </div>
            ) : (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {dataValidation.map((msg, idx) => (
                    <li key={`${msg}-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {msg}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(triggerPageAction || setActivePage) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (triggerPageAction) {
                          triggerPageAction('Investments', 'focus-investment-plan');
                          return;
                        }
                        setActivePage?.('Investments');
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Fix plan setup
                    </button>
                  )}
                  {(triggerPageAction || setActivePage) && (
                    <button
                      type="button"
                      onClick={() => {
                        setActivePage?.('Investments');
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Open investments hub
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScenarioId('down10')}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Stress test (-10%)
                  </button>
                </div>
              </div>
            )}
          </SectionCard>

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
        <section className="space-y-8 pt-4 border-t border-slate-100">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Allocation & Strategy</h2>
            <p className="text-xs text-slate-500 mt-1">Universe (shared with Investments), sleeve drift, spec status, and next deployment</p>
          </div>

          <SectionCard
            title="Portfolio universe (by investment account)"
            className="border border-slate-200 bg-white shadow-sm"
            collapsible
            collapsibleSummary={`${universeByPortfolio.rows.length} ticker(s) in universe`}
            defaultExpanded
          >
            <p className="text-xs text-slate-600 mb-4 font-medium">
              Same data as <strong className="font-medium text-slate-800">Investments → Portfolio universe</strong>. Grouped by portfolio when <span className="font-mono">portfolio_id</span> is set. Monthly weight is stored as a fraction (0–1); shown as % below.
            </p>
            {universeByPortfolio.rows.length === 0 ? (
              <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-600">
                No universe tickers yet. Add them under Investments → Portfolio universe to drive sleeve lists and automation.
              </div>
            ) : (
              <div className="space-y-6">
                {Array.from(universeByPortfolio.map.entries())
                  .sort(([a], [b]) => {
                    if (a === '__unassigned__') return 1;
                    if (b === '__unassigned__') return -1;
                    return a.localeCompare(b);
                  })
                  .map(([key, tickers]) => {
                    const portfolioLabel =
                      key === '__unassigned__'
                        ? 'Not linked to a portfolio (legacy)'
                        : personalInvestments.find((p) => p.id === key)?.name?.trim() || `Portfolio ${key.slice(0, 8)}…`;
                    return (
                      <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                          <p className="text-sm font-bold text-slate-900">{portfolioLabel}</p>
                          <p className="text-xs text-slate-500">{tickers.length} symbol(s)</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-white border-b border-slate-100">
                              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                <th className="py-2 px-3">Ticker</th>
                                <th className="py-2 px-3">Name</th>
                                <th className="py-2 px-3">Status</th>
                                <th className="py-2 px-3">Plan role</th>
                                <th className="py-2 px-3 text-right">Monthly wt</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {tickers.map((t) => (
                                <tr key={t.id} className="hover:bg-slate-50/80">
                                  <td className="py-2 px-3 font-mono font-semibold text-slate-900">{t.ticker}</td>
                                  <td className="py-2 px-3 text-slate-700">{toSafeText(t.name, '—')}</td>
                                  <td className="py-2 px-3 text-slate-600">{t.status}</td>
                                  <td className="py-2 px-3 text-xs text-slate-500">{getUniversePlanRoleLabel(t.status)}</td>
                                  <td className="py-2 px-3 text-right tabular-nums text-slate-800">
                                    {formatUniverseMonthlyWeightFraction(t.monthly_weight)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </SectionCard>

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
        <section className="space-y-8 pt-4 border-t border-slate-100">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Orders & Actions</h2>
            <p className="text-xs text-slate-500 mt-1">Suggested orders only — not sent to any broker; export JSON or use as your own trade checklist</p>
          </div>

          <div>
            {gridItems.find(item => item.id === 'orders')?.content}
          </div>
        </section>

        {/* Portfolio Analysis Section */}
        <section className="space-y-8 pt-4 border-t border-slate-100">
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
        <section className="space-y-8 pt-4 border-t border-slate-100">
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
