import React, { useMemo, useState, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import type { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import type { RecoveryPositionConfig, RecoveryGlobalConfig, RecoveryOrderDraft } from '../types';
import {
  buildRecoveryPlan,
  orderDraftGenerator,
  defaultPositionConfig,
  DEFAULT_RECOVERY_GLOBAL_CONFIG,
} from '../services/recoveryPlan';
import { tickerToSleeve, tickerToRiskTier } from '../wealth-ultra/position';
import { getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';

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

function RecoveryPlanViewContent({ onNavigateToTab, onOpenWealthUltra }: RecoveryPlanViewProps) {
  const ctx = useContext(DataContext)!;
  const { data } = ctx;
  const deployableCash = ctx.totalDeployableCash ?? 0;
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { isAiAvailable } = useAI();

  const allHoldingsWithPortfolio = useMemo(() => {
    const list: { holding: Holding; portfolioName: string; currency: TradeCurrency }[] = [];
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
          });
        });
    });
    return list;
  }, [data.investments]);
  const allHoldings = useMemo(() => allHoldingsWithPortfolio.map(({ holding }) => holding), [allHoldingsWithPortfolio]);
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    allHoldings.forEach(h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!sym) return;
      const qty = Number(h.quantity) || 0;
      const currentVal = h.currentValue != null ? Number(h.currentValue) : NaN;
      const avgCost = h.avgCost != null ? Number(h.avgCost) : 0;
      if (qty > 0 && Number.isFinite(currentVal) && currentVal > 0) {
        map[sym] = currentVal / qty;
      } else if (qty > 0 && avgCost > 0) {
        map[sym] = avgCost;
      }
    });
    Object.entries(simulatedPrices).forEach(([sym, o]) => {
      const s = sym.toUpperCase();
      const price = (o as { price: number }).price;
      if (Number.isFinite(price) && price > 0 && !(s in map)) map[s] = price;
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
    return allHoldingsWithPortfolio.map(({ holding, portfolioName, currency }) => {
      const sym = (holding.symbol || '').toUpperCase();
      const qty = Number(holding.quantity) || 0;
      const currentVal = holding.currentValue != null ? Number(holding.currentValue) : NaN;
      const avgCost = (holding.avgCost != null ? Number(holding.avgCost) : 0) || 0;
      const currentPrice =
        (qty > 0 && Number.isFinite(currentVal) && currentVal > 0
          ? currentVal / qty
          : null) ?? priceMap[sym] ?? (qty > 0 ? avgCost : 0);
      const sleeveType = tickerToSleeve(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const riskTier = tickerToRiskTier(sym, coreUpsideSpec.coreTickers.length || coreUpsideSpec.upsideTickers.length ? coreUpsideSpec : undefined);
      const positionConfig: RecoveryPositionConfig = defaultPositionConfig(sym, sleeveType, riskTier, 5000);
      const plan = buildRecoveryPlan(holding, currentPrice, positionConfig, globalConfig);
      return { holding, portfolioName, currency, currentPrice, positionConfig, plan };
    });
  }, [allHoldingsWithPortfolio, priceMap, globalConfig, coreUpsideSpec]);

  const losingPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.plPct < 0), [positionsWithRecovery]);
  const qualifiedPositions = useMemo(() => positionsWithRecovery.filter(p => p.plan.qualified), [positionsWithRecovery]);

  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [draftOrders, setDraftOrders] = useState<RecoveryOrderDraft[] | null>(null);
  const [selectedFundamentals, setSelectedFundamentals] = useState<HoldingFundamentals | null>(null);
  const [isSelectedFundamentalsLoading, setIsSelectedFundamentalsLoading] = useState(false);
  const [selectedFundamentalsError, setSelectedFundamentalsError] = useState<string | null>(null);

  const selected = selectedHoldingId ? positionsWithRecovery.find(p => p.holding.id === selectedHoldingId) : null;
  const selectedPlan = selected?.plan;
  const isSelected = (holdingId: string) => selectedHoldingId === holdingId;

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
            {formatCurrencyString(deployableCash)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Approximate total across currencies. Per-position values below use each portfolio&apos;s base currency.
          </p>
        </SectionCard>
      </div>

      {/* Losing positions table */}
      <SectionCard title="Positions in loss" className="overflow-hidden p-0">
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
          <p className="text-sm text-slate-600">
            Portfolio: {selected.portfolioName}{' '}
            <span className="text-xs text-slate-500">
              · Display currency: {selected.currency ?? 'USD'}
            </span>
          </p>

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
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white border border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Next financial statement & dividends
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
                  Next financial statement
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
                          Expected revenue:{' '}
                          {formatCurrencyString(selectedFundamentals.nextEarnings.revenueEstimate, {
                            inCurrency:
                              (selectedFundamentals.currency === 'SAR' ? 'SAR' : 'USD') as TradeCurrency,
                            digits: 0,
                          })}
                        </p>
                      )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">No upcoming earnings date available.</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-500 uppercase tracking-wide text-[11px]">
                  Dividends
                </p>
                {selectedFundamentals?.dividend ? (
                  <>
                    {typeof selectedFundamentals.dividend.dividendYieldPct === 'number' &&
                      selectedFundamentals.dividend.dividendYieldPct > 0 && (
                        <p className="text-slate-800">
                          Dividend yield:{' '}
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
