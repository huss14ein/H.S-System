import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { runWealthUltraEngine, exportOrdersJson, capitalEfficiencyScore, getDefaultWealthUltraConfig, getRiskWeight } from '../wealth-ultra';
import type { WealthUltraSleeve, WealthUltraPosition, WealthUltraRiskTier } from '../types';
import type { Page } from '../types';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import Card from '../components/Card';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import DraggableResizableGrid from '../components/DraggableResizableGrid';

const SLEEVE_COLORS: Record<WealthUltraSleeve, string> = {
  Core: 'bg-blue-500',
  Upside: 'bg-amber-500',
  Spec: 'bg-rose-500',
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

const WealthUltraDashboard: React.FC<WealthUltraDashboardProps> = ({ setActivePage: _setActivePage, triggerPageAction }) => {
  const { data, loading, totalDeployableCash } = useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();

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
  } = engineState;

  const totalSAR = totalPortfolioValue / config.fxRate;
  const positions = engineState.positions || [];
  const top5Gainers = positions.filter(p => p.plPct > 0).sort((a, b) => b.plPct - a.plPct).slice(0, 5);
  const top5Losers = positions.filter(p => p.plPct < 0).sort((a, b) => a.plPct - b.plPct).slice(0, 5);
  const positionCount = positions.length;
  const portfolioCount = (data.investments || []).filter((p: { holdings?: unknown[] }) => (p.holdings?.length ?? 0) > 0).length;

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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  const positionsSortedByPl = useMemo(() => [...positions].sort((a, b) => b.plPct - a.plPct), [positions]);

  const gridItems = useMemo(
    () => [
      {
        id: 'data-source',
        content: (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 h-full">
            <strong>Data source:</strong> Positions from <strong>Investments</strong> (all portfolios) · Sleeves & targets from <strong>Investment Plan</strong> and <strong>Portfolio Universe</strong> · Cash from <strong>Accounts</strong>.
            {positionCount > 0 && (
              <span className="ml-1">Tracking <strong>{positionCount}</strong> position{positionCount !== 1 ? 's' : ''}{portfolioCount > 0 ? ` across ${portfolioCount} portfolio${portfolioCount !== 1 ? 's' : ''}` : ''}.</span>
            )}
          </div>
        ),
        defaultW: 12,
        defaultH: 1,
        minW: 12,
        minH: 1,
      },
      {
        id: 'summary-cards',
        content: (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
            <Card title="Total Portfolio Value" value={formatCurrencyString(totalPortfolioValue)} trend={totalSAR.toLocaleString('en-US', { style: 'currency', currency: 'SAR', minimumFractionDigits: 0 }) + ' (SAR)'} density="comfortable" tooltip="Total value of all portfolio positions in your base currency." />
            <Card title="Cash Planner" value={cashPlannerStatus === 'WITHIN_LIMIT' ? 'WITHIN LIMIT' : 'OVER BUDGET'} trend={`Deployable: ${formatCurrencyString(deployableCash)} · Planned: ${formatCurrencyString(totalPlannedBuyCost)}`} density="comfortable" indicatorColor={cashPlannerStatus === 'OVER_BUDGET' ? 'red' : 'green'} tooltip="Compares deployable cash to planned buy cost." />
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="py-2 pr-4">Sleeve</th>
                    <th className="py-2 pr-4">Market value</th>
                    <th className="py-2 pr-4">Allocation %</th>
                    <th className="py-2 pr-4">Target %</th>
                    <th className="py-2 pr-4">Drift %</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map(a => (
                    <tr key={a.sleeve} className="border-b border-gray-100">
                      <td className="py-2"><span className={`inline-block w-3 h-3 rounded-full ${SLEEVE_COLORS[a.sleeve]} mr-2`} />{a.sleeve}</td>
                      <td className="py-2">{formatCurrencyString(a.marketValue)}</td>
                      <td className="py-2">{a.allocationPct.toFixed(1)}%</td>
                      <td className="py-2">{a.targetPct.toFixed(1)}%</td>
                      <td className={`py-2 font-medium ${Math.abs(a.driftPct) > 5 ? 'text-amber-600' : ''}`}>{a.driftPct >= 0 ? '+' : ''}{a.driftPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 3,
        minW: 6,
        minH: 2,
      },
      {
        id: 'all-positions',
        content: (
          <SectionCard title="All positions (P&L tracked)">
            <p className="text-xs text-slate-500 mb-4">Source: your holdings from Investments. P&L % = (market value − cost basis) / cost basis.</p>
            {positions.length > 0 ? (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b">
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">Ticker</th>
                      <th className="py-2 pr-3">Sleeve</th>
                      <th className="py-2 pr-3 text-right">Value</th>
                      <th className="py-2 pr-3 text-right">P&L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionsSortedByPl.map(p => (
                      <tr key={p.ticker} className="border-b border-gray-100">
                        <td className="py-1.5 font-medium">{p.ticker}</td>
                        <td className="py-1.5"><span className={`inline-block w-2 h-2 rounded-full ${SLEEVE_COLORS[p.sleeveType]} mr-1.5`} />{p.sleeveType}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCurrencyString(p.marketValue)}</td>
                        <td className={`py-1.5 text-right tabular-nums font-medium ${p.plPct > 0 ? 'text-emerald-600' : p.plPct < 0 ? 'text-rose-600' : 'text-slate-500'}`}>{p.plPct > 0 ? '+' : ''}{p.plPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state text-sm text-slate-500">No positions yet. Add holdings in Investments.</p>
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
          <SectionCard title="Top 5 gainers">
            <p className="text-xs text-slate-500 mb-4">Only positive P&L; flat or no-cost excluded.</p>
            <ul className="space-y-2">
              {top5Gainers.map(p => (
                <li key={p.ticker} className="flex justify-between items-center text-sm">
                  <span className="font-medium">{p.ticker}</span>
                  <span className="text-emerald-600 font-medium">+{p.plPct.toFixed(1)}%</span>
                </li>
              ))}
              {top5Gainers.length === 0 && <p className="empty-state text-sm text-slate-500">No gains.</p>}
            </ul>
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 3,
        minW: 3,
        minH: 2,
      },
      {
        id: 'losers',
        content: (
          <SectionCard title="Top 5 losers">
            <p className="text-xs text-slate-500 mb-4">Only negative P&L; flat or no-cost excluded.</p>
            <ul className="space-y-2">
              {top5Losers.map(p => (
                <li key={p.ticker} className="flex justify-between items-center text-sm">
                  <span className="font-medium">{p.ticker}</span>
                  <span className="text-rose-600 font-medium">{p.plPct.toFixed(1)}%</span>
                </li>
              ))}
              {top5Losers.length === 0 && <p className="empty-state text-sm text-slate-500">No losses.</p>}
            </ul>
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 3,
        minW: 3,
        minH: 2,
      },
      {
        id: 'capital-efficiency',
        content: (
          <SectionCard title="Capital efficiency ranking (return % × risk weight)">
            <p className="text-xs text-slate-500 mb-3">Score = unrealized return % × risk weight. Weights used: Med=1.25 (Core), High=1.5 (Upside), Spec=2 (Speculative). Sorted by score descending; higher = better risk-adjusted return.</p>
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {capitalEfficiencyRanked.slice(0, 10).map((p, i) => {
                const tier = p.riskTier ?? 'Med';
                const weight = getRiskWeight(config, tier);
                const score = capitalEfficiencyScore(p.plPct, tier, config);
                return (
                  <li key={p.ticker} className="flex justify-between items-center text-sm gap-2 min-w-0">
                    <span className="min-w-0 truncate"><span className="text-gray-400 mr-2">{i + 1}.</span><span className="font-medium">{p.ticker}</span> <span className="text-gray-500">({tier})</span></span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={p.plPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{p.plPct >= 0 ? '+' : ''}{p.plPct.toFixed(1)}%</span>
                      <span className="text-gray-400 mx-1">×</span>
                      <span className="text-gray-600">{weight}</span>
                      <span className="text-gray-400 mx-1">=</span>
                      <span className={score >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>{score.toFixed(1)}</span>
                    </span>
                  </li>
                );
              })}
              {capitalEfficiencyRanked.length === 0 && <p className="empty-state text-sm">No positions</p>}
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
            <p className="text-xs text-slate-500 mb-3">By sleeve: Med = Core, High = Upside, Spec = Speculative. Values = sum of position market values in each tier.</p>
            <div className="flex flex-wrap gap-4">
              {(['Low', 'Med', 'High', 'Spec'] as WealthUltraRiskTier[]).map(tier => {
                const stat = riskDistribution[tier] ?? { count: 0, value: 0 };
                return (
                  <div key={tier} className="bg-gray-50 rounded-lg px-4 py-2 min-w-[120px]">
                    <span className="text-sm font-medium text-gray-700">{tier}</span>
                    <span className="ml-2 text-sm text-gray-500">{stat.count} position{stat.count !== 1 ? 's' : ''}</span>
                    <p className="text-sm font-semibold text-dark mt-1">{formatCurrencyString(stat.value)}</p>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ),
        defaultW: 6,
        defaultH: 2,
        minW: 4,
        minH: 1,
      },
      {
        id: 'monthly-deployment',
        content: (
          <SectionCard title="Monthly Core deployment">
            <p className="text-sm text-gray-600">{monthlyDeployment.reason}</p>
            <p className="mt-2 font-medium">Amount: {formatCurrencyString(monthlyDeployment.amountToDeploy)}</p>
            {monthlyDeployment.suggestedTicker && <p className="text-sm text-primary">Suggested ticker: {monthlyDeployment.suggestedTicker}</p>}
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
          <SectionCard title="Spec risk">
            {specBreach && <p className="text-amber-700 font-medium flex items-center gap-2"><ExclamationTriangleIcon className="h-5 w-5" /> Spec breach — new Spec buys disabled</p>}
            {specBuysDisabled && !specBreach && <p className="text-gray-600 text-sm">Spec buys disabled by policy.</p>}
            {!specBreach && !specBuysDisabled && <p className="text-success text-sm">Within target.</p>}
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
            <p className="text-xs text-slate-500 mb-3">Prioritized by impact: act on critical first, then review warnings; use info for opportunities and context.</p>
            {alerts.length > 0 ? (
              <ul className="space-y-3 max-h-[420px] overflow-y-auto">
                {alerts.map((a, i) => {
                  const isCritical = a.severity === 'critical';
                  const isWarning = a.severity === 'warning';
                  const bg = isCritical ? 'bg-rose-50 border-rose-200' : isWarning ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200';
                  const titleColor = isCritical ? 'text-rose-800' : isWarning ? 'text-amber-800' : 'text-slate-800';
                  const label = isCritical ? 'Act now' : isWarning ? 'Review' : 'FYI / Opportunity';
                  return (
                    <li key={i} className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${bg}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <ExclamationTriangleIcon className={`h-4 w-4 flex-shrink-0 ${isCritical ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-slate-500'}`} />
                        {a.title && <span className={`font-semibold ${titleColor}`}>{a.title}</span>}
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
                      </div>
                      <p className="text-slate-700">{a.message}</p>
                      {a.actionHint && (
                        <p className="text-xs font-medium text-slate-600 mt-0.5 pt-1.5 border-t border-slate-200/80">
                          → {a.actionHint}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No alerts. Your plan and allocation are in sync.</p>
            )}
          </SectionCard>
        ),
        defaultW: 12,
        defaultH: 2,
        minW: 6,
        minH: 1,
      },
    ],
    [
      positionCount,
      portfolioCount,
      totalPortfolioValue,
      totalSAR,
      cashPlannerStatus,
      deployableCash,
      totalPlannedBuyCost,
      formatCurrencyString,
      allocations,
      positions.length,
      positionsSortedByPl,
      top5Gainers,
      top5Losers,
      capitalEfficiencyRanked,
      config,
      riskDistribution,
      monthlyDeployment,
      specBreach,
      specBuysDisabled,
      alerts,
    ]
  );

  return (
    <PageLayout
      title="Wealth Ultra Portfolio Engine"
      description="Rule-based allocation, sleeve drift, and orders from your Investment Plan and holdings. Drag sections to reorder; resize by hovering and using the corner handle (no visible buttons)."
      action={
        <div className="flex flex-wrap items-center gap-2">
          {triggerPageAction && (
            <button
              type="button"
              onClick={() => triggerPageAction('Investments', 'focus-investment-plan')}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2"
            >
              <PencilIcon className="h-5 w-5" />
              Edit plan & budget
            </button>
          )}
          <button
            type="button"
            onClick={handleExportOrders}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary text-sm"
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
        handlesOnHoverOnly
      />
    </PageLayout>
  );
};

export default WealthUltraDashboard;
