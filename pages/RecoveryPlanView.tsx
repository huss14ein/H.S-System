import React, { useMemo, useState, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from '../components/InfoHint';
import type { Holding } from '../types';
import type { RecoveryPositionConfig, RecoveryGlobalConfig, RecoveryOrderDraft } from '../types';
import {
  buildRecoveryPlan,
  orderDraftGenerator,
  defaultPositionConfig,
  DEFAULT_RECOVERY_GLOBAL_CONFIG,
} from '../services/recoveryPlan';
import { tickerToSleeve, tickerToRiskTier } from '../wealth-ultra/position';

function RecoveryPlanViewContent() {
  const ctx = useContext(DataContext)!;
  const { data } = ctx;
  const deployableCash = ctx.totalDeployableCash ?? 0;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();

  const allHoldings = useMemo(() => (data.investments ?? []).flatMap(p => (p.holdings ?? []).filter((h: Holding) => h.quantity > 0)), [data.investments]);
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      map[sym.toUpperCase()] = (o as { price: number }).price;
    });
    allHoldings.forEach(h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!(sym in map) && h.quantity > 0) map[sym] = h.currentValue / h.quantity;
    });
    return map;
  }, [simulatedPrices, allHoldings]);


  const globalConfig: RecoveryGlobalConfig = useMemo(() => ({
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash,
    minDeployableThreshold: 500,
  }), [deployableCash]);

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

  const positionsWithRecovery = useMemo(() => {
    return allHoldings.map(holding => {
      const sym = (holding.symbol || '').toUpperCase();
      const currentPrice = priceMap[sym] ?? (holding.quantity > 0 ? holding.currentValue / holding.quantity : holding.avgCost);
      const sleeveType = tickerToSleeve(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const riskTier = tickerToRiskTier(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const positionConfig: RecoveryPositionConfig = defaultPositionConfig(sym, sleeveType, riskTier, 5000);
      const plan = buildRecoveryPlan(holding, currentPrice, positionConfig, globalConfig);
      return { holding, currentPrice, positionConfig, plan };
    });
  }, [allHoldings, priceMap, globalConfig, coreUpsideSpec]);

  const losingPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.plPct < 0), [positionsWithRecovery]);
  const qualifiedPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.qualified), [positionsWithRecovery]);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [draftOrders, setDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);

  const selected = selectedSymbol ? positionsWithRecovery.find(p => (p.holding.symbol || '').toUpperCase() === selectedSymbol.toUpperCase()) : null;
  const selectedPlan = selected?.plan;
  const isSelected = (symbol: string) => (selectedSymbol || '').toUpperCase() === (symbol || '').toUpperCase();

  const handleGenerateDraft = () => {
    if (!selectedPlan) return;
    const drafts = orderDraftGenerator(selectedPlan, true);
    setDraftOrders(drafts);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-dark flex items-center gap-2">
          Recovery Plan (Averaging / Correction Engine)
          <InfoHint text="Controlled workflow for positions in loss: only activates when loss exceeds your trigger (e.g. 20%). Builds a limited buy ladder (1–3 orders), predicts new average cost, and can generate exit targets. Safe guardrails prevent over-spending." />
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Positions in loss are listed below. When a position qualifies, you can generate a recovery ladder and optional exit targets. Never runs if over budget, spec breach, or per-ticker cap exceeded.
        </p>
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-primary">Default parameters</summary>
          <ul className="mt-2 pl-4 space-y-1 list-disc">
            <li><strong>Loss trigger</strong> <InfoHint text="Position must be in loss by at least this % to qualify (e.g. 20% = -20% or worse)." />: 20%</li>
            <li><strong>Recovery budget</strong> <InfoHint text="Max share of deployable cash that can be used for recovery plans (e.g. 20%)." />: 20% of deployable cash</li>
            <li><strong>Cash cap per ticker</strong> <InfoHint text="Max amount allowed for correction on a single ticker." />: 5,000 (default)</li>
            <li><strong>Spec</strong>: Recovery is off for Speculative sleeve unless overridden; guardrails prevent over-spending.</li>
          </ul>
        </details>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-gray-500">Losing positions</p>
          <p className="text-lg font-semibold text-dark">{losingPositions.length}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-gray-600">Recovery eligible</p>
          <p className="text-lg font-semibold text-emerald-700">{qualifiedPositions.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-gray-500">Deployable cash</p>
          <p className="text-lg font-semibold text-dark">{formatCurrencyString(deployableCash)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Symbol</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">P/L %</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Cost / Value</th>
              <th className="px-4 py-3 text-center font-medium text-gray-700">State</th>
              <th className="px-4 py-3 text-center font-medium text-gray-700">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {losingPositions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No losing positions. Recovery plan applies only when a position is in loss.</td>
              </tr>
            ) : (
              losingPositions.map(({ holding, plan }) => (
                <tr key={holding.id} className={isSelected(holding.symbol) ? 'bg-primary/5' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 font-medium text-dark">{holding.symbol}</td>
                  <td className={`px-4 py-3 text-right font-medium ${plan.plPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {plan.plPct >= 0 ? '+' : ''}{plan.plPct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {formatCurrencyString(plan.costBasis)} → {formatCurrencyString(plan.marketValue)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {plan.qualified ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">Recovery Eligible</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">{plan.state}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {plan.qualified && (
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol(isSelected(holding.symbol) ? null : holding.symbol)}
                        className="text-primary font-medium hover:underline"
                      >
                        {isSelected(holding.symbol) ? 'Hide plan' : 'Generate Recovery Plan'}
                      </button>
                    )}
                    {!plan.qualified && plan.reason && <span className="text-xs text-gray-500" title={plan.reason}>—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && selectedPlan && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-6">
          <h3 className="text-lg font-semibold text-dark">{selected.holding.symbol} — Recovery Plan</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
              <p className="text-gray-500 mb-1">Current</p>
              <p>Shares: {selected.holding.quantity} · Avg cost: {formatCurrencyString(selected.holding.avgCost)} · Price: {formatCurrencyString(selectedPlan.currentPrice)}</p>
              <p className="mt-2 font-medium">P/L: {formatCurrencyString(selectedPlan.plUsd)} ({selectedPlan.plPct.toFixed(1)}%)</p>
            </div>
            <div className="p-4 rounded-lg bg-emerald-50/50 border border-emerald-100">
              <p className="text-gray-600 mb-1 flex items-center gap-1">After ladder fills <InfoHint text="New average cost and share count if all planned buy orders are filled." /></p>
              <p>New shares: {selectedPlan.newShares} · New avg cost: {formatCurrencyString(selectedPlan.newAvgCost)}</p>
              <p className="mt-2 font-medium">Planned recovery cost: {formatCurrencyString(selectedPlan.totalPlannedCost)}</p>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-dark mb-2 flex items-center gap-1">Buy ladder (limit orders) <InfoHint text="Up to 3 levels below current price. Use limit orders only; no market orders." /></h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200 rounded-lg">
                <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left font-medium">Level</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr></thead>
                <tbody>
                  {selectedPlan.ladder.map(l => (
                    <tr key={l.level} className="border-t border-gray-100"><td className="px-3 py-2">L{l.level}</td><td className="px-3 py-2 text-right">{l.qty}</td><td className="px-3 py-2 text-right">{formatCurrencyString(l.price)}</td><td className="px-3 py-2 text-right">{formatCurrencyString(l.cost)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-dark mb-2 flex items-center gap-1">Exit targets (optional) <InfoHint text="Target 1/2 and trailing stop based on new average cost. Apply when you want to auto-suggest exit prices." /></h4>
            <div className="flex flex-wrap gap-4 text-sm">
              {selectedPlan.exitPlan.applyTarget1 && selectedPlan.exitPlan.target1Price != null && (
                <span className="px-3 py-1.5 rounded-lg bg-violet-50 text-violet-800">Target 1: {selectedPlan.exitPlan.target1Pct}% → {formatCurrencyString(selectedPlan.exitPlan.target1Price)}</span>
              )}
              {selectedPlan.exitPlan.applyTarget2 && selectedPlan.exitPlan.target2Price != null && (
                <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800">Target 2: {selectedPlan.exitPlan.target2Pct}% → {formatCurrencyString(selectedPlan.exitPlan.target2Price)}</span>
              )}
              {selectedPlan.exitPlan.applyTrailing && selectedPlan.exitPlan.trailStopPrice != null && (
                <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800">Trailing: {selectedPlan.exitPlan.trailPct}% → {formatCurrencyString(selectedPlan.exitPlan.trailStopPrice)}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGenerateDraft}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary font-medium text-sm"
            >
              Create Draft Orders
            </button>
          </div>
        </div>
      )}

      {draftOrders && draftOrders.length > 0 && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-dark mb-3">Draft orders (export to broker)</h3>
          <p className="text-sm text-gray-500 mb-3">Copy or use these to place limit orders in your broker.</p>
          <div className="space-y-2">
            {draftOrders.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                <span className="font-medium">{d.type} {d.symbol}</span>
                <span>Qty: {d.qty}</span>
                <span>Limit: {formatCurrencyString(d.limitPrice)}</span>
                {d.label && <span className="text-gray-500">({d.label})</span>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setDraftOrders(null)} className="mt-3 text-sm text-gray-500 hover:underline">Close</button>
        </div>
      )}
    </div>
  );
}

export default function RecoveryPlanView() {
  return (
    <React.Suspense fallback={<div className="text-center p-8">Loading...</div>}>
      <RecoveryPlanViewContent />
    </React.Suspense>
  );
}
