import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { runWealthUltraEngine, exportOrdersJson, capitalEfficiencyScore, getDefaultWealthUltraConfig } from '../wealth-ultra';
import type { WealthUltraSleeve, WealthUltraPosition } from '../types';
import type { Page } from '../types';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import Card from '../components/Card';

const SLEEVE_COLORS: Record<WealthUltraSleeve, string> = {
  Core: 'bg-blue-500',
  Upside: 'bg-amber-500',
  Spec: 'bg-rose-500',
};

function buildEngineConfigFromSystem(data: { investmentPlan?: any; wealthUltraConfig?: any; accounts?: any[] }) {
  const plan = data.investmentPlan;
  const systemConfig = data.wealthUltraConfig;
  const defaults = getDefaultWealthUltraConfig();
  const base = { ...defaults, ...systemConfig } as typeof defaults;
  if (!plan) return undefined;
  const cashAvailable = (data.accounts || []).reduce((s: number, a: { balance?: number }) => s + (a.balance || 0), 0);
  const sleeves = plan.sleeves && Array.isArray(plan.sleeves) && plan.sleeves.length > 0;
  const core = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'core' || s.id === 'Core') : null;
  const upside = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'upside' || s.id === 'Upside') : null;
  const spec = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'spec' || s.id === 'Spec') : null;
  return {
    ...base,
    monthlyDeposit: plan.monthlyBudget ?? base.monthlyDeposit,
    cashAvailable,
    targetCorePct: sleeves && core ? core.targetPct : (plan.coreAllocation ?? 0.7) * 100,
    targetUpsidePct: sleeves && upside ? upside.targetPct : (plan.upsideAllocation ?? 0.3) * 100,
    targetSpecPct: sleeves && spec ? spec.targetPct : Math.max(0, 100 - (plan.coreAllocation ?? 0.7) * 100 - (plan.upsideAllocation ?? 0.3) * 100),
    coreTickers: sleeves && core ? (core.tickers || []) : (plan.corePortfolio ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean),
    upsideTickers: sleeves && upside ? (upside.tickers || []) : (plan.upsideSleeve ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean),
    specTickers: sleeves && spec ? (spec.tickers || []) : [],
  };
}

interface WealthUltraDashboardProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const WealthUltraDashboard: React.FC<WealthUltraDashboardProps> = ({ setActivePage, triggerPageAction }) => {
  const { data, loading } = useContext(DataContext)!;
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
    const config = buildEngineConfigFromSystem(data);
    return runWealthUltraEngine({
      holdings: allHoldings,
      priceMap,
      config,
    });
  }, [data.investments, data.investmentPlan, data?.accounts, data.wealthUltraConfig, simulatedPrices]);

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
  const top5Winners = [...(engineState.positions || [])].sort((a, b) => b.plPct - a.plPct).slice(0, 5);
  const top5Losers = [...(engineState.positions || [])].sort((a, b) => a.plPct - b.plPct).slice(0, 5);

  const riskDistribution = useMemo(() => {
    const byRisk: Record<string, { count: number; value: number }> = { Low: { count: 0, value: 0 }, Med: { count: 0, value: 0 }, High: { count: 0, value: 0 }, Spec: { count: 0, value: 0 } };
    (engineState.positions || []).forEach((p: WealthUltraPosition) => {
      byRisk[p.riskTier].count += 1;
      byRisk[p.riskTier].value += p.marketValue;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-dark flex items-center gap-2">
          <ChartPieIcon className="h-8 w-8 text-primary" />
          Wealth Ultra Portfolio Engine
        </h1>
        <div className="flex items-center gap-2">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Total Portfolio Value" value={totalPortfolioValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })} trend={totalSAR.toLocaleString('en-US', { style: 'currency', currency: 'SAR', minimumFractionDigits: 0 }) + ' (SAR)'} density="comfortable" />
        <Card title="Cash Planner" value={cashPlannerStatus === 'WITHIN_LIMIT' ? 'WITHIN LIMIT' : 'OVER BUDGET'} trend={`Deployable: ${formatCurrencyString(deployableCash)} · Planned: ${formatCurrencyString(totalPlannedBuyCost)}`} density="comfortable" indicatorColor={cashPlannerStatus === 'OVER_BUDGET' ? 'red' : 'green'} />
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
        <h2 className="text-lg font-semibold text-dark mb-4">Sleeve allocation & drift</h2>
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
                  <td className="py-2">
                    <span className={`inline-block w-3 h-3 rounded-full ${SLEEVE_COLORS[a.sleeve]} mr-2`} />
                    {a.sleeve}
                  </td>
                  <td className="py-2">{formatCurrencyString(a.marketValue)}</td>
                  <td className="py-2">{a.allocationPct.toFixed(1)}%</td>
                  <td className="py-2">{a.targetPct.toFixed(1)}%</td>
                  <td className={`py-2 font-medium ${Math.abs(a.driftPct) > 5 ? 'text-amber-600' : ''}`}>
                    {a.driftPct >= 0 ? '+' : ''}{a.driftPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          <h2 className="text-lg font-semibold text-dark mb-4">Top 5 winners</h2>
          <ul className="space-y-2">
            {top5Winners.map(p => (
              <li key={p.ticker} className="flex justify-between items-center text-sm">
                <span className="font-medium">{p.ticker}</span>
                <span className="text-success">+{p.plPct.toFixed(1)}%</span>
              </li>
            ))}
            {top5Winners.length === 0 && <p className="text-gray-500 text-sm">No positions</p>}
          </ul>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          <h2 className="text-lg font-semibold text-dark mb-4">Top 5 losers</h2>
          <ul className="space-y-2">
            {top5Losers.map(p => (
              <li key={p.ticker} className="flex justify-between items-center text-sm">
                <span className="font-medium">{p.ticker}</span>
                <span className="text-danger">{p.plPct.toFixed(1)}%</span>
              </li>
            ))}
            {top5Losers.length === 0 && <p className="text-gray-500 text-sm">No positions</p>}
          </ul>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
        <h2 className="text-lg font-semibold text-dark mb-4">Capital efficiency ranking (return % × risk weight)</h2>
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {capitalEfficiencyRanked.slice(0, 10).map((p, i) => (
            <li key={p.ticker} className="flex justify-between items-center text-sm">
              <span><span className="text-gray-400 mr-2">{i + 1}.</span>{p.ticker} <span className="text-gray-500">({p.riskTier})</span></span>
              <span className={p.plPct >= 0 ? 'text-success' : 'text-danger'}>
                {capitalEfficiencyScore(p.plPct, p.riskTier, config).toFixed(1)}
              </span>
            </li>
          ))}
          {capitalEfficiencyRanked.length === 0 && <p className="text-gray-500 text-sm">No positions</p>}
        </ul>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
        <h2 className="text-lg font-semibold text-dark mb-4">Risk distribution</h2>
        <div className="flex flex-wrap gap-4">
          {(['Low', 'Med', 'High', 'Spec'] as const).map(tier => (
            <div key={tier} className="bg-gray-50 rounded-lg px-4 py-2">
              <span className="text-sm font-medium text-gray-700">{tier}</span>
              <span className="ml-2 text-sm text-gray-500">{riskDistribution[tier].count} positions</span>
              <p className="text-sm font-semibold text-dark mt-1">{formatCurrencyString(riskDistribution[tier].value)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          <h2 className="text-lg font-semibold text-dark mb-4">Monthly Core deployment</h2>
          <p className="text-sm text-gray-600">{monthlyDeployment.reason}</p>
          <p className="mt-2 font-medium">Amount: {formatCurrencyString(monthlyDeployment.amountToDeploy)}</p>
          {monthlyDeployment.suggestedTicker && (
            <p className="text-sm text-primary">Suggested ticker: {monthlyDeployment.suggestedTicker}</p>
          )}
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          <h2 className="text-lg font-semibold text-dark mb-4">Spec risk</h2>
          {specBreach && (
            <p className="text-amber-700 font-medium flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5" /> Spec breach — new Spec buys disabled
            </p>
          )}
          {specBuysDisabled && !specBreach && <p className="text-gray-600 text-sm">Spec buys disabled by policy.</p>}
          {!specBreach && !specBuysDisabled && <p className="text-success text-sm">Within target.</p>}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
          <h2 className="text-lg font-semibold text-dark mb-4">Alerts</h2>
          <ul className="space-y-2">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded p-2">
                <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WealthUltraDashboard;
