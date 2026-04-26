import React from 'react';
import type { Page, PlannedTrade, TradeCurrency } from '../types';
import { DataContext } from '../context/DataContext';
import { useMarketData } from '../context/MarketDataContext';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import InvestmentPlanView from './InvestmentPlanView';
import { buildInvestmentEngineUniverse } from '../services/investmentEngine/universe';
import { generateInvestmentPlanSuggestions, type PlanDraft } from '../services/investmentEngine/suggestions';
import { toast } from '../context/ToastContext';
import { computeLiquidityRunwayFromData } from '../services/liquidityRunwayEngine';
import { personalMonthlyNetByMonthKeySar } from '../services/financeMetrics';

const Chip: React.FC<{ tone: 'green' | 'amber' | 'red' | 'slate'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-900 border-amber-200'
        : tone === 'red'
          ? 'bg-rose-100 text-rose-900 border-rose-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
};

export default function InvestmentPlanAutopilot(props: {
  onExecutePlan: (plan?: PlannedTrade) => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  embedded?: boolean;
  stagedAddOnPlanned?: { key: number; symbol: string; name?: string; targetPrice?: number; amount?: number; quantity?: number; tradeType?: 'buy' | 'sell'; notes?: string } | null;
  onStagedAddOnPlannedHandled?: () => void;
}) {
  const { data, loading, refreshData, applySuggestedPlans, getAvailableCashForAccount } = React.useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const { exchangeRate } = useCurrency();
  const sarPerUsd = React.useMemo(() => resolveSarPerUsd(data ?? null, exchangeRate), [data, exchangeRate]);

  const [drafts, setDrafts] = React.useState<PlanDraft[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [notes, setNotes] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null);
  const [ackReview, setAckReview] = React.useState(false);
  const [marketFilter, setMarketFilter] = React.useState<'usa' | 'ksa' | 'all'>('usa');

  const planCurrency = ((data?.investmentPlan?.budgetCurrency as TradeCurrency) || 'SAR') as TradeCurrency;
  const monthlyBudget = Number(data?.investmentPlan?.monthlyBudget ?? 0) || 0;
  const coreAllocation = Number(data?.investmentPlan?.coreAllocation ?? 0.7) || 0.7;
  const upsideAllocation = Number(data?.investmentPlan?.upsideAllocation ?? 0.3) || 0.3;

  const existingPlanKeys = React.useMemo(() => {
    const s = new Set<string>();
    for (const p of data?.plannedTrades ?? []) s.add(`${String(p.symbol || '').toUpperCase()}|${p.tradeType}`);
    return s;
  }, [data?.plannedTrades]);

  const computeSuggestions = React.useCallback(() => {
    if (!data) return;
    const runway = computeLiquidityRunwayFromData(data, { exchangeRate, getAvailableCashForAccount });
    const { values } = personalMonthlyNetByMonthKeySar(data as any, exchangeRate, 1);
    const monthlyNetLast30d = values.length ? (values[values.length - 1] ?? 0) : 0;
    const universe = buildInvestmentEngineUniverse({
      data,
      exchangeRate,
      simulatedPrices,
    });
    const out = generateInvestmentPlanSuggestions({
      universe,
      planCurrency,
      monthlyBudget,
      coreAllocation,
      upsideAllocation,
      existingPlanKeys,
      policyContext: { runwayMonths: runway?.monthsOfRunway ?? 0, monthlyNetLast30d },
    });
    setDrafts(out.drafts);
    setNotes(out.notes);
    const nextSelected: Record<string, boolean> = {};
    for (const d of out.drafts) {
      const isUsa = (d.instrumentCurrency ?? '') === 'USD';
      const isKsa = (d.instrumentCurrency ?? '') === 'SAR';
      const inFilter = marketFilter === 'all' ? true : marketFilter === 'usa' ? isUsa : isKsa;
      if (inFilter && d.canAutoPlan && d.kind === 'equity' && d.severity !== 'blocked') nextSelected[d.draftId] = true;
    }
    setSelected(nextSelected);
    setLastRefreshAt(Date.now());
  }, [data, exchangeRate, simulatedPrices, planCurrency, monthlyBudget, coreAllocation, upsideAllocation, existingPlanKeys, marketFilter]);

  React.useEffect(() => {
    if (loading || !data) return;
    computeSuggestions();
  }, [loading, data, computeSuggestions]);

  // When the filter changes, refresh default selection to match it.
  React.useEffect(() => {
    if (loading || !data) return;
    computeSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketFilter]);

  const visibleDrafts = React.useMemo(() => {
    if (marketFilter === 'all') return drafts;
    if (marketFilter === 'usa') return drafts.filter((d) => (d.instrumentCurrency ?? '') === 'USD');
    return drafts.filter((d) => (d.instrumentCurrency ?? '') === 'SAR');
  }, [drafts, marketFilter]);

  const chosenDrafts = visibleDrafts.filter((d) => selected[d.draftId]);
  const chosenAutoDrafts = chosenDrafts.filter((d) => d.canAutoPlan && d.kind === 'equity' && d.severity !== 'blocked');
  const chosenReviewDrafts = chosenAutoDrafts.filter((d) => d.severity === 'review');
  const safeDrafts = visibleDrafts.filter((d) => d.canAutoPlan && d.kind === 'equity' && d.severity === 'safe');
  const reviewDrafts = visibleDrafts.filter((d) => d.canAutoPlan && d.kind === 'equity' && d.severity === 'review');

  const apply = async () => {
    if (chosenAutoDrafts.length === 0) {
      toast('No eligible equity plans selected.', 'error');
      return;
    }
    if (chosenReviewDrafts.length > 0 && !ackReview) {
      toast('Review items selected. Tick the confirmation box to apply them.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await applySuggestedPlans(chosenAutoDrafts, { planCurrency });
      if (res.errors.length) toast(res.errors.join('\n'), 'error');
      toast(`Applied: ${res.created} created, ${res.updated} updated.`, 'success');
      await refreshData();
      computeSuggestions();
    } finally {
      setBusy(false);
    }
  };

  const applyAllSafe = async () => {
    if (safeDrafts.length === 0) {
      toast('No safe equity suggestions to apply.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await applySuggestedPlans(safeDrafts, { planCurrency });
      if (res.errors.length) toast(res.errors.join('\n'), 'error');
      toast(`Applied safe: ${res.created} created, ${res.updated} updated.`, 'success');
      await refreshData();
      computeSuggestions();
    } finally {
      setBusy(false);
    }
  };

  const dataHealth = (() => {
    const anyPrice = Object.values(simulatedPrices ?? {}).some((p) => p?.price != null && Number.isFinite(p.price as number) && (p.price as number) > 0);
    if (!anyPrice) return { tone: 'red' as const, label: 'Prices missing' };
    if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) return { tone: 'amber' as const, label: 'FX needs review' };
    return { tone: 'green' as const, label: 'Healthy' };
  })();

  const topBuys = visibleDrafts.filter((d) => d.kind === 'equity' && d.tradeType === 'buy').slice(0, 6);
  const topSells = visibleDrafts.filter((d) => d.kind === 'equity' && d.tradeType === 'sell').slice(0, 6);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Banner */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 px-4 py-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Investment Autopilot</p>
            <p className="mt-1 text-sm text-slate-600">
              Guided suggestions that can auto-write your trade plans (you still confirm execution).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone={dataHealth.tone}>{dataHealth.label}</Chip>
            <Chip tone="slate">Budget: {monthlyBudget.toLocaleString()} {planCurrency}/mo</Chip>
            <button
              type="button"
              onClick={() => computeSuggestions()}
              className="px-4 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90"
            >
              Refresh suggestions
            </button>
          </div>
        </div>
        {lastRefreshAt && (
          <p className="mt-2 text-xs text-slate-500">Last refresh: {new Date(lastRefreshAt).toLocaleString()}</p>
        )}
      </div>

      {/* Cockpit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Now</p>
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Buy</p>
            {topBuys.length ? (
              topBuys.map((d) => (
                <div key={d.draftId} className="flex items-start justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{d.symbol}</p>
                    <p className="text-xs text-slate-600">{d.confidence} confidence · target {d.targetValue.toLocaleString()} {d.instrumentCurrency}</p>
                  </div>
                  <Chip tone={d.severity === 'safe' ? 'green' : d.severity === 'review' ? 'amber' : 'red'}>{d.severity}</Chip>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No buy picks yet.</p>
            )}
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-rose-700">Sell</p>
            {topSells.length ? (
              topSells.map((d) => (
                <div key={d.draftId} className="flex items-start justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{d.symbol}</p>
                    <p className="text-xs text-slate-600">{d.confidence} confidence · target {d.targetValue.toLocaleString()} {d.instrumentCurrency}</p>
                  </div>
                  <Chip tone={d.severity === 'safe' ? 'green' : d.severity === 'review' ? 'amber' : 'red'}>{d.severity}</Chip>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No sell alerts yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Why</p>
          <div className="mt-3 space-y-3">
            {notes.length ? (
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {notes.slice(0, 6).map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">We explain each suggestion in plain language below.</p>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-700">How targets are picked</p>
              <p className="text-xs text-slate-600 mt-1">Buy targets use a small pullback band. Sell targets use a near-market band for trims/quarantine. You can edit any plan before saving.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Safety</p>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Auto-plan coverage</span>
              <Chip tone="slate">{chosenAutoDrafts.length} selected</Chip>
            </div>
            <div className="flex items-center justify-between">
              <span>Non-equity guidance</span>
              <Chip tone="amber">{drafts.filter((d) => !d.canAutoPlan).length} items</Chip>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-900">Important</p>
              <p className="text-xs text-amber-800 mt-1">Commodities and Sukuk are shown as guidance and won’t be auto-written into broker trade plans (they live on their own pages).</p>
            </div>
          </div>
        </div>
      </div>

      {/* Suggestions queue */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Suggested plans queue</p>
            <p className="text-sm text-slate-600 mt-1">Defaults to USA (USD) holdings. Use the filter to include KSA (SAR) or all.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Chip tone="green">{safeDrafts.length} safe</Chip>
              <Chip tone="amber">{reviewDrafts.length} review</Chip>
              <Chip tone="red">{visibleDrafts.filter((d) => d.canAutoPlan && d.severity === 'blocked').length} blocked</Chip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setMarketFilter('usa')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${marketFilter === 'usa' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                USA (USD)
              </button>
              <button
                type="button"
                onClick={() => setMarketFilter('ksa')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${marketFilter === 'ksa' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                KSA (SAR)
              </button>
              <button
                type="button"
                onClick={() => setMarketFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${marketFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                All
              </button>
            </div>
            <button
              type="button"
              onClick={() => applyAllSafe()}
              disabled={busy || safeDrafts.length === 0}
              className="px-4 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold hover:bg-emerald-100 disabled:opacity-50"
              title="Applies only safe items (green). Review/blocked are skipped."
            >
              Apply all (safe)
            </button>
            <button
              type="button"
              onClick={() => apply()}
              disabled={busy || chosenAutoDrafts.length === 0}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              Apply selected
            </button>
          </div>
        </div>
        {reviewDrafts.length > 0 && (
          <label className="mt-3 flex items-start gap-2 text-xs text-slate-700 select-none">
            <input
              type="checkbox"
              checked={ackReview}
              onChange={(e) => setAckReview(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I understand items marked <span className="font-semibold">review</span> need a second look (caps, mapping, or missing context). Allow applying them when selected.
            </span>
          </label>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold text-slate-600">
                <th className="px-3 py-3">Use</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Symbol</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Size</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleDrafts.slice(0, 40).map((d) => (
                <tr key={d.draftId} className="hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      disabled={!d.canAutoPlan || d.severity === 'blocked'}
                      checked={!!selected[d.draftId]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [d.draftId]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Chip tone={d.tradeType === 'buy' ? 'green' : 'red'}>{d.tradeType.toUpperCase()}</Chip>
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-sm font-semibold text-slate-900">{d.symbol}</p>
                    <p className="text-xs text-slate-500">{d.name}</p>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap">
                    {d.conditionType === 'date'
                      ? new Date(d.targetValue).toLocaleDateString()
                      : Number.isFinite(d.targetValue)
                        ? d.targetValue.toLocaleString()
                        : '—'}{' '}
                    {d.conditionType === 'price' ? d.instrumentCurrency : ''}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap">
                    {d.amountPlanCurrency != null ? `${d.amountPlanCurrency.toLocaleString()} ${planCurrency}` : '—'}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Chip tone={d.confidence === 'High' ? 'green' : d.confidence === 'Medium' ? 'amber' : 'slate'}>{d.confidence}</Chip>
                    <span className="ml-2">
                      <Chip tone={d.severity === 'safe' ? 'green' : d.severity === 'review' ? 'amber' : 'red'}>{d.severity}</Chip>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <ul className="text-xs text-slate-700 space-y-1">
                      {(d.explanation || []).slice(0, 2).map((x, idx) => (
                        <li key={idx}>- {x}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
              {visibleDrafts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">No suggestions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Keep the robust plans editor/table from existing page */}
      <InvestmentPlanView {...props} embedded />
    </div>
  );
}

