import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useAI } from '../context/AiContext';
import { runWealthUltraEngine, exportOrdersJson, capitalEfficiencyScore, getDefaultWealthUltraConfig, getRiskWeight } from '../wealth-ultra';
import type { WealthUltraSleeve, WealthUltraPosition, WealthUltraRiskTier } from '../types';
import type { Page } from '../types';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import Card from '../components/Card';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import DraggableResizableGrid from '../components/DraggableResizableGrid';

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

/** Build full Wealth Ultra config from app data. Auto-derives sleeve tickers from Portfolio Universe or holdings when plan lists are empty. */
function buildEngineConfigFromSystem(
  data: {
    investmentPlan?: any;
    wealthUltraConfig?: any;
    accounts?: any[];
    portfolioUniverse?: Array<{ ticker: string; status?: string }>;
    investments?: Array<{ holdings?: Array<{ symbol: string }> }>;
  },
  totalDeployableCash?: number
) {
  const plan = data.investmentPlan;
  const systemConfig = data.wealthUltraConfig;
  const defaults = getDefaultWealthUltraConfig();
  const base = { ...defaults, ...systemConfig } as typeof defaults;

  const cashAvailable =
    totalDeployableCash ??
    (data.accounts || []).reduce((s: number, a: { balance?: number }) => s + (a.balance || 0), 0);

  const allHoldingTickers =
    (data.investments || [])
      .flatMap((p: { holdings?: Array<{ symbol: string }> }) => p.holdings || [])
      .map((h: { symbol: string }) => (h.symbol || '').toUpperCase())
      .filter(Boolean) || [];

  const universe = data.portfolioUniverse || [];

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

const WealthUltraDashboard: React.FC<WealthUltraDashboardProps> = ({ setActivePage, triggerPageAction }) => {
  const { data, loading, totalDeployableCash } = useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable } = useAI();

  const engineState = useMemo(() => {
    const allHoldings = (data.investments || []).flatMap(p => p.holdings || []);
    const priceMap: Record<string, number> = {};
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      priceMap[sym.toUpperCase()] = (o as { price: number }).price;
    });
    allHoldings.forEach(h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!priceMap[sym] && h.quantity > 0) priceMap[sym] = h.currentValue / h.quantity;
    });
    const config = buildEngineConfigFromSystem(
      {
        investmentPlan: data.investmentPlan,
        wealthUltraConfig: data.wealthUltraConfig,
        accounts: data.accounts,
        portfolioUniverse: data.portfolioUniverse,
        investments: data.investments,
      },
      totalDeployableCash
    );
    return runWealthUltraEngine({
      holdings: allHoldings,
      priceMap,
      config,
    });
  }, [data.investments, data.investmentPlan, data.accounts, data.wealthUltraConfig, data.portfolioUniverse, simulatedPrices, totalDeployableCash]);

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
  } = engineState;

  const totalSAR = totalPortfolioValue / config.fxRate;
  const positions = engineState.positions || [];
  const top5Gainers = positions.filter(p => p.plPct > 0).sort((a, b) => b.plPct - a.plPct).slice(0, 5);
  const top5Losers = positions.filter(p => p.plPct < 0).sort((a, b) => a.plPct - b.plPct).slice(0, 5);
  const positionCount = positions.length;
  const portfolioCount = (data.investments || []).filter((p: { holdings?: unknown[] }) => (p.holdings?.length ?? 0) > 0).length;
  const buyOrders = orders.filter(o => o.type === 'BUY');
  const sellOrders = orders.filter(o => o.type === 'SELL');

  const riskDistribution = useMemo(() => {
    const tiers: WealthUltraRiskTier[] = ['Low', 'Med', 'High', 'Spec'];
    const byRisk: Record<string, { count: number; value: number }> = Object.fromEntries(tiers.map(t => [t, { count: 0, value: 0 }]));
    (engineState.positions || []).forEach((p: WealthUltraPosition) => {
      const tier = (p.riskTier && tiers.includes(p.riskTier as WealthUltraRiskTier)) ? p.riskTier : 'Med';
      byRisk[tier].count += 1;
      byRisk[tier].value += p.marketValue;
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

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4">
        <div className="animate-spin rounded-full h-14 w-14 border-2 border-primary border-t-transparent" />
        <p className="text-slate-500 font-medium">Loading Wealth Ultra engine…</p>
      </div>
    );
  }

  const healthColor = portfolioHealth.score >= 85 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : portfolioHealth.score >= 65 ? 'text-amber-600 bg-amber-50 border-amber-200' : portfolioHealth.score >= 40 ? 'text-amber-700 bg-amber-100 border-amber-300' : 'text-rose-600 bg-rose-50 border-rose-200';

  const gridItems = useMemo(
    () => [
      {
        id: 'hero',
        content: (
          <SectionCard title="Wealth Ultra engine" className="border-primary/20 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-slate-600 mt-1 max-w-2xl">Rule-based allocation, sleeve drift, and orders generated from your Investment Plan in one operational workspace.</p>
              </div>
              <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${healthColor} shrink-0`}>
                {portfolioHealth.score >= 85 ? <CheckCircleIcon className="h-6 w-6 text-emerald-600 shrink-0" /> : <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />}
                <div>
                  <p className="font-bold text-sm">{portfolioHealth.label}</p>
                  <p className="text-xs opacity-90">{portfolioHealth.summary}</p>
                </div>
              </div>
            </div>
            {positionCount > 0 && (
              <p className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-100">
                Tracking <strong>{positionCount}</strong> position{positionCount !== 1 ? 's' : ''}{portfolioCount > 0 ? ` across ${portfolioCount} portfolio${portfolioCount !== 1 ? 's' : ''}` : ''}. Data: Investments + Plan + Universe + Accounts.
              </p>
            )}
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
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Engine amounts in <span className="font-semibold">USD</span>; SAR estimate uses fx rate {config.fxRate.toFixed(2)}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        id: 'sleeve-allocation',
        content: (
          <SectionCard title="Sleeve allocation & drift">
            <p className="text-xs text-slate-500 mb-4">Current vs target. Drift &gt;5% suggests rebalancing.</p>
            <div className="space-y-4">
              {allocations.map(a => {
                const driftAbs = Math.abs(a.driftPct);
                const hasDrift = driftAbs > 5;
                return (
                  <div key={a.sleeve} className={`rounded-xl border p-4 ${SLEEVE_BG[a.sleeve]}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-2 font-semibold text-slate-800">
                        <span className={`w-3 h-3 rounded-full ${SLEEVE_COLORS[a.sleeve]}`} />
                        {a.sleeve}
                      </span>
                      <span className={`text-sm font-medium tabular-nums ${hasDrift ? 'text-amber-700' : 'text-slate-600'}`}>
                        {a.allocationPct.toFixed(1)}% actual · target {a.targetPct.toFixed(1)}% {hasDrift && `(${a.driftPct >= 0 ? '+' : ''}${a.driftPct.toFixed(1)}% drift)`}
                      </span>
                    </div>
                    <div className="h-2.5 bg-white/80 rounded-full overflow-hidden">
                      <div className="h-full flex rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-l-full ${a.sleeve === 'Core' ? 'bg-blue-500' : a.sleeve === 'Upside' ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${Math.min(100, a.allocationPct)}%` }}
                        />
                        <div className="h-full flex-1 bg-slate-100" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5">{formatCurrencyString(a.marketValue)}</p>
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
          <SectionCard title="Orders ready" className="border-primary/20 bg-white">
            <p className="text-xs text-slate-600 mb-4">Suggested limit orders from the engine. Export to JSON or use as a checklist when placing trades.</p>
            {orders.length > 0 ? (
              <div className="space-y-3">
                {buyOrders.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Buys ({buyOrders.length})</p>
                    <ul className="space-y-2">
                      {buyOrders.map((o, i) => (
                        <li key={i} className="grid grid-cols-2 sm:grid-cols-4 items-center gap-2 py-2 px-3 rounded-lg bg-white border border-slate-100 text-sm">
                          <span className="font-semibold text-emerald-700">BUY</span>
                          <span className="font-mono font-medium">{o.ticker}</span>
                          <span className="text-slate-600">Qty: {o.qty}</span>
                          <span className="text-slate-600">Limit: {formatCurrencyString(o.limitPrice ?? 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sellOrders.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sells / exits ({sellOrders.length})</p>
                    <ul className="space-y-2">
                      {sellOrders.map((o, i) => (
                        <li key={i} className="grid grid-cols-2 sm:grid-cols-4 items-center gap-2 py-2 px-3 rounded-lg bg-white border border-slate-100 text-sm">
                          <span className="font-semibold text-rose-600">SELL</span>
                          <span className="font-mono font-medium">{o.ticker}</span>
                          <span className="text-slate-600">Qty: {o.qty}</span>
                          {(o.target1Price ?? o.target2Price ?? o.trailingStopPrice) && <span className="text-slate-500 text-xs">Targets / trailing in export</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-4">No orders generated. Add positions and optional buy ladders in Recovery Plan or Investments.</p>
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
          <SectionCard title="Next move — Monthly Core">
            <p className="text-sm text-slate-700">{monthlyDeployment.reason}</p>
            <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums">Amount: {formatCurrencyString(monthlyDeployment.amountToDeploy)}</p>
            {monthlyDeployment.suggestedTicker && <p className="text-sm text-primary font-medium mt-1">Suggested ticker: {monthlyDeployment.suggestedTicker}</p>}
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
          <SectionCard title="Spec sleeve">
            {specBreach && <p className="text-amber-700 font-medium flex items-center gap-2"><ExclamationTriangleIcon className="h-5 w-5 shrink-0" /> Spec over target — new Spec buys disabled</p>}
            {specBuysDisabled && !specBreach && <p className="text-slate-600 text-sm">Spec buys disabled by policy.</p>}
            {!specBreach && !specBuysDisabled && <p className="text-emerald-600 text-sm font-medium flex items-center gap-2"><CheckCircleIcon className="h-5 w-5" /> Within target</p>}
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
      {
        id: 'alerts',
        content: (
          <SectionCard title="Alerts & recommendations">
            <p className="text-xs text-slate-500 mb-3">Prioritized: act on critical first, then warnings; use info for context.</p>
            {alerts.length > 0 ? (
              <ul className="space-y-3">
                {alerts.map((a, i) => {
                  const isCritical = a.severity === 'critical';
                  const isWarning = a.severity === 'warning';
                  const bg = isCritical ? 'bg-rose-50 border-rose-200' : isWarning ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200';
                  const titleColor = isCritical ? 'text-rose-800' : isWarning ? 'text-amber-800' : 'text-slate-800';
                  const label = isCritical ? 'Act now' : isWarning ? 'Review' : 'FYI';
                  return (
                    <li key={i} className={`rounded-xl border p-3 text-sm ${bg}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <ExclamationTriangleIcon className={`h-4 w-4 shrink-0 ${isCritical ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-slate-500'}`} />
                        {a.title && <span className={`font-semibold ${titleColor}`}>{a.title}</span>}
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
                      </div>
                      <p className="text-slate-700">{a.message}</p>
                      {a.actionHint && <p className="text-xs font-medium text-slate-600 mt-2 pt-2 border-t border-slate-200/80">→ {a.actionHint}</p>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 flex items-center gap-2"><CheckCircleIcon className="h-5 w-5 text-emerald-500" /> No alerts. Plan and allocation are in sync.</p>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 1,
      },
      {
        id: 'positions',
        content: (
          <SectionCard title="All positions">
            <p className="text-xs text-slate-500 mb-3">P&L % = (market value − cost) / cost. Sorted by return.</p>
            {positions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr className="text-left text-slate-600">
                      <th className="py-2.5 pr-3 font-semibold">Ticker</th>
                      <th className="py-2.5 pr-3 font-semibold">Sleeve</th>
                      <th className="py-2.5 pr-3 font-semibold">Strategy</th>
                      <th className="py-2.5 pr-3 text-right font-semibold">Value</th>
                      <th className="py-2.5 pr-3 text-right font-semibold">P&L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionsSortedByPl.map(p => (
                      <tr key={p.ticker} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="py-2 font-medium text-slate-800">{p.ticker}</td>
                        <td className="py-2"><span className={`inline-block w-2.5 h-2.5 rounded-full ${SLEEVE_COLORS[p.sleeveType]} mr-1.5`} />{p.sleeveType}</td>
                        <td className="py-2 text-slate-600">{p.strategyMode}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{formatCurrencyString(p.marketValue)}</td>
                        <td className={`py-2 text-right tabular-nums font-semibold ${p.plPct > 0 ? 'text-emerald-600' : p.plPct < 0 ? 'text-rose-600' : 'text-slate-500'}`}>{p.plPct > 0 ? '+' : ''}{p.plPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500 py-6 text-center">No positions. Add holdings in Investments.</p>
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
          <SectionCard title="Top gainers">
            <ul className="space-y-2">
              {top5Gainers.map(p => (
                <li key={p.ticker} className="flex justify-between items-center text-sm py-1">
                  <span className="font-medium text-slate-800">{p.ticker}</span>
                  <span className="text-emerald-600 font-semibold tabular-nums">+{p.plPct.toFixed(1)}%</span>
                </li>
              ))}
              {top5Gainers.length === 0 && <p className="text-slate-500 text-sm">No gains yet.</p>}
            </ul>
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
          <SectionCard title="Top losers">
            <ul className="space-y-2">
              {top5Losers.map(p => (
                <li key={p.ticker} className="flex justify-between items-center text-sm py-1">
                  <span className="font-medium text-slate-800">{p.ticker}</span>
                  <span className="text-rose-600 font-semibold tabular-nums">{p.plPct.toFixed(1)}%</span>
                </li>
              ))}
              {top5Losers.length === 0 && <p className="text-slate-500 text-sm">No losses.</p>}
            </ul>
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
          <SectionCard title="Capital efficiency (return % × risk weight)">
            <p className="text-xs text-slate-500 mb-3">Higher score = better risk-adjusted return. Weights: Med 1.25, High 1.5, Spec 2.</p>
            <ul className="space-y-2">
              {capitalEfficiencyRanked.slice(0, 10).map((p, i) => {
                const tier = p.riskTier ?? 'Med';
                const weight = getRiskWeight(config, tier);
                const score = capitalEfficiencyScore(p.plPct, tier, config);
                return (
                  <li key={p.ticker} className="flex justify-between items-center text-sm gap-2 min-w-0 py-1">
                    <span className="min-w-0 break-words"><span className="text-slate-400 mr-2">{i + 1}.</span><span className="font-medium">{p.ticker}</span> <span className="text-slate-500">({tier})</span></span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={p.plPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{p.plPct >= 0 ? '+' : ''}{p.plPct.toFixed(1)}%</span>
                      <span className="text-slate-400 mx-1">×</span>
                      <span className="text-slate-600">{weight}</span>
                      <span className="text-slate-400 mx-1">=</span>
                      <span className={score >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{score.toFixed(1)}</span>
                    </span>
                  </li>
                );
              })}
              {capitalEfficiencyRanked.length === 0 && <p className="text-slate-500 text-sm">No positions.</p>}
            </ul>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 2,
      },
      {
        id: 'risk-distribution',
        content: (
          <SectionCard title="Risk distribution">
            <div className="flex flex-wrap gap-4">
              {(['Low', 'Med', 'High', 'Spec'] as WealthUltraRiskTier[]).map(tier => {
                const stat = riskDistribution[tier] ?? { count: 0, value: 0 };
                return (
                  <div key={tier} className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 min-w-[120px]">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{tier}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{stat.count} position{stat.count !== 1 ? 's' : ''}</p>
                    <p className="text-lg font-bold text-slate-800 tabular-nums mt-1">{formatCurrencyString(stat.value)}</p>
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
    ]
  );

  return (
    <PageLayout
      title="Wealth Ultra Portfolio Engine"
      description="Smart allocation, sleeve drift, and institutional-grade order planning. Unified with Investment Plan, execution flow, and live portfolio telemetry."
      action={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Operational' : 'Unavailable'}</span>
          {triggerPageAction && (
            <button
              type="button"
              onClick={() => triggerPageAction('Investments', 'focus-investment-plan')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              <PencilIcon className="h-5 w-5" />
              Edit plan & budget
            </button>
          )}
          {setActivePage && (
            <button
              type="button"
              onClick={() => setActivePage('Investments')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              Open Investments Hub
            </button>
          )}
          <button
            type="button"
            onClick={handleExportOrders}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium transition-colors"
          >
            Export orders (JSON)
          </button>
        </div>
      }
    >
      <DraggableResizableGrid
        layoutKey="wealth-ultra"
        items={gridItems}
        cols={12}
        rowHeight={72}
        itemOverflowY="visible"
        handlesOnHoverOnly
        isResizable={false}
      />
    </PageLayout>
  );
};

export default WealthUltraDashboard;
