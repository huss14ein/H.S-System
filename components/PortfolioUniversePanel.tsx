import React, { useMemo, useState } from 'react';
import type { InvestmentPortfolio, TickerStatus, TradeCurrency, UniverseTicker } from '../types';
import InfoHint from './InfoHint';
import { PlusIcon } from './icons/PlusIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { TrashIcon } from './icons/TrashIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { ChartPieIcon } from './icons/ChartPieIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import CurrencyDualDisplay from './CurrencyDualDisplay';
import { getUniverseRowPlanRole } from '../services/universePlanRole';
import { inferInstrumentCurrencyFromSymbol } from '../utils/currencyMath';

type UniverseSourceRow = UniverseTicker & { source?: string };

type UniverseFilter = 'all' | 'Core' | 'High-Upside' | 'Watchlist' | 'Needs mapping';
type UniverseSort = 'ticker' | 'status' | 'weight';

export type UniversePanelHealth = {
  totalCount: number;
  actionableCount: number;
  monthlyWeightTotal: number;
  overMaxCount: number;
  unmappedCount: number;
};

function scoreAutomation(h: UniversePanelHealth, actionableExists: boolean): { score: number; label: string; hint: string } {
  let s = 0;
  if (h.totalCount > 0) s += 10;
  if (h.actionableCount > 0) s += 32;
  if (actionableExists && h.actionableCount > 0) {
    const d = Math.abs(h.monthlyWeightTotal - 1);
    if (d <= 0.02) s += 30;
    else if (d <= 0.08) s += 18;
    else if (d <= 0.2) s += 8;
  }
  if (h.unmappedCount === 0) s += 18;
  else s -= Math.min(14, h.unmappedCount * 2);
  if (h.overMaxCount === 0) s += 10;
  else s -= Math.min(12, h.overMaxCount * 3);
  const score = Math.max(0, Math.min(100, Math.round(s)));
  if (score >= 90) {
    return { score, label: 'Excellent', hint: 'Automation can run this month with predictable splits.' };
  }
  if (score >= 70) {
    return { score, label: 'Good', hint: 'A quick tune-up of weights or mapping will make runs smoother.' };
  }
  if (score >= 45) {
    return { score, label: 'Getting started', hint: 'Add Core / High-upside names, then balance the bar below.' };
  }
  return { score, label: 'Needs attention', hint: 'Follow the steps: add names → pick roles → balance weights to 100%.' };
}

const FILTER_OPTIONS: { id: UniverseFilter; short: string; help: string }[] = [
  { id: 'all', short: 'All', help: 'Every stock and idea linked to this portfolio' },
  { id: 'Core', short: 'Steady (Core)', help: 'Holdings the plan treats as your stable base' },
  { id: 'High-Upside', short: 'Growth (High-upside)', help: 'Names that can receive the growth slice of the budget' },
  { id: 'Watchlist', short: 'Ideas (Watchlist)', help: 'Tracking only; no money until you promote them' },
  { id: 'Needs mapping', short: 'Needs link', help: 'Came from holdings or plans but is not in your official list yet' },
];

const PortfolioUniversePanel: React.FC<{
  planCurrency: TradeCurrency;
  /** Core sleeve as 0–100 for copy only */
  coreSleevePct: number;
  upsideSleevePct: number;
  personalPortfolios: InvestmentPortfolio[];
  selectedPortfolioId: string | null;
  onSelectPortfolio: (id: string) => void;
  health: UniversePanelHealth;
  unifiedUniverse: UniverseSourceRow[];
  displayRows: UniverseSourceRow[];
  universeFilter: UniverseFilter;
  onUniverseFilter: (f: UniverseFilter) => void;
  universeSort: UniverseSort;
  onUniverseSort: (s: UniverseSort) => void;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  canAddWatchlistHoldings: boolean;
  onAddWatchlistAndHoldings: () => void;
  onSyncPlanFromUniverse: () => void;
  onAutoConfigureWeights: () => void;
  newTicker: { ticker: string; name: string };
  onNewTicker: React.Dispatch<React.SetStateAction<{ ticker: string; name: string }>>;
  onAddNewTicker: () => void;
  isUniverseTicker: (t: UniverseSourceRow) => boolean;
  isActionableUniverseStatus: (status: TickerStatus) => boolean;
  onStatusUpdate: (t: UniverseSourceRow, status: TickerStatus) => void;
  onMonthlyWeightInput: (t: UniverseSourceRow, value: string) => void;
  onMaxPosWeightInput: (t: UniverseSourceRow, value: string) => void;
  onMonthlyWeightBlur: () => void;
  onMaxPosBlur: () => void;
  onDeleteUniverse: (ticker: UniverseSourceRow) => void;
  simulatedPrices: Record<string, { price?: number } | undefined>;
  onNavigateToWatchlist?: () => void;
  /** Ticker value display decimals for live column */
  priceDigits?: number;
}> = ({
  planCurrency: _planCurrency,
  coreSleevePct,
  upsideSleevePct,
  personalPortfolios,
  selectedPortfolioId,
  onSelectPortfolio,
  health,
  unifiedUniverse,
  displayRows,
  universeFilter,
  onUniverseFilter,
  universeSort,
  onUniverseSort,
  searchQuery,
  onSearchQuery,
  canAddWatchlistHoldings,
  onAddWatchlistAndHoldings,
  onSyncPlanFromUniverse,
  onAutoConfigureWeights,
  newTicker,
  onNewTicker,
  onAddNewTicker,
  isUniverseTicker,
  isActionableUniverseStatus,
  onStatusUpdate,
  onMonthlyWeightInput,
  onMaxPosWeightInput,
  onMonthlyWeightBlur,
  onMaxPosBlur,
  onDeleteUniverse,
  simulatedPrices,
  onNavigateToWatchlist,
  priceDigits = 2,
}) => {
  const [guideOpen, setGuideOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const liveQuotesAny = useMemo(
    () => Object.keys(simulatedPrices ?? {}).some((k) => simulatedPrices[k]?.price != null),
    [simulatedPrices],
  );

  const filterCounts = useMemo(() => {
    const c = (f: UniverseFilter) => {
      if (f === 'all') return unifiedUniverse.length;
      if (f === 'Core') return unifiedUniverse.filter((t) => t.status === 'Core').length;
      if (f === 'High-Upside') return unifiedUniverse.filter((t) => t.status === 'High-Upside').length;
      if (f === 'Watchlist') return unifiedUniverse.filter((t) => t.status === 'Watchlist').length;
      return unifiedUniverse.filter((t) => !t.source?.includes('Universe')).length;
    };
    return Object.fromEntries(FILTER_OPTIONS.map((o) => [o.id, c(o.id)])) as Record<UniverseFilter, number>;
  }, [unifiedUniverse]);

  const weightBarPct = useMemo(() => {
    if (health.actionableCount === 0) return 0;
    return Math.max(0, Math.min(100, health.monthlyWeightTotal * 100));
  }, [health.actionableCount, health.monthlyWeightTotal]);

  const { score, label: scoreLabel, hint: scoreHint } = useMemo(
    () => scoreAutomation(health, health.actionableCount > 0),
    [health],
  );

  const step1 = health.totalCount > 0;
  const step2 = health.actionableCount > 0;
  const step3 = health.actionableCount > 0 && Math.abs(health.monthlyWeightTotal - 1) <= 0.05;
  const step4 = health.unmappedCount === 0;

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  return (
    <div className="xl:col-span-12">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 shadow-md">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.45]"
          style={{
            backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.12), transparent 45%), radial-gradient(circle at 80% 0%, rgba(16, 185, 129, 0.1), transparent 40%)',
          }}
        />
        <div className="relative p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5 min-w-0">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shrink-0" aria-hidden>
                    <ChartPieIcon className="h-5 w-5" />
                  </span>
                  <span>Your stock list (smart automation)</span>
                </h2>
                {liveQuotesAny && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                    Live prices
                  </span>
                )}
                <InfoHint
                  text="This list controls how your monthly plan chooses stocks. You only pick each company’s “role” and how much of the plan it should get; Finova does the rest when you run the plan. Scoped to the portfolio you select below."
                  hintId="universe-hub-intro"
                  hintPage="Investments"
                />
              </div>
              <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-3xl leading-relaxed">
                Think of it as a <strong>simple control panel</strong>: add tickers, mark which ones get this month’s money, and
                keep the <strong>weight total near 100%</strong> so the app splits your budget predictably. No finance jargon
                required—use the green steps and the “balance bar” as your guide.
              </p>
            </div>
            {personalPortfolios.length > 0 && (
              <div className="w-full sm:w-72 shrink-0 rounded-2xl border border-white/60 bg-white/80 p-3 shadow-sm backdrop-blur-sm">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Which portfolio is this for?</label>
                <select
                  value={selectedPortfolioId ?? ''}
                  onChange={(e) => onSelectPortfolio(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm"
                >
                  {personalPortfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || 'Portfolio'}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">Change this if you invest in more than one account.</p>
              </div>
            )}
          </div>

          {/* Readiness + steps */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4 rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Automation readiness</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="relative h-16 w-16 shrink-0">
                  <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36" aria-hidden>
                    <path
                      d="M18 2.084a15.916 15.916 0 010 31.832 15.916 15.916 0 010-31.832"
                      fill="none"
                      className="text-slate-200"
                      stroke="currentColor"
                      strokeWidth="2.4"
                    />
                    <path
                      d="M18 2.084a15.916 15.916 0 010 31.832 15.916 15.916 0 010-31.832"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      className={score >= 80 ? 'text-emerald-500' : score >= 55 ? 'text-amber-500' : 'text-rose-500'}
                      strokeDasharray={`${score}, 100`}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-slate-800 tabular-nums">{score}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{scoreLabel}</p>
                  <p className="text-xs text-slate-600 leading-snug mt-0.5">{scoreHint}</p>
                </div>
              </div>
              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100" title="100% = weights fully allocated">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${weightBarPct >= 99 && weightBarPct <= 101 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500'}`}
                  style={{ width: `${weightBarPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 tabular-nums">Weight total: {(health.monthlyWeightTotal * 100).toFixed(1)}% · aim for 100%</p>
            </div>

            <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {[
                { done: step1, title: '1 · Names on list', sub: 'At least one ticker', k: 'totalCount', v: String(health.totalCount), warn: false },
                { done: step2, title: '2 · Ready to fund', sub: 'Core or High-upside', k: 'actionable', v: String(health.actionableCount), warn: false },
                { done: step3, title: '3 · Weights balance', sub: 'Near 100%', k: 'wt', v: `${(health.monthlyWeightTotal * 100).toFixed(0)}%`, warn: !step3 && health.actionableCount > 0 },
                { done: step4, title: '4 · All linked', sub: 'Nothing “needs link”', k: 'map', v: String(health.unmappedCount), warn: !step4 },
              ].map((c) => (
                <div
                  key={c.k}
                  className={`rounded-2xl border p-3 flex flex-col gap-1 min-h-[92px] transition-shadow ${
                    c.done && !c.warn ? 'border-emerald-200/80 bg-emerald-50/50' : c.warn && !c.done ? 'border-amber-200/90 bg-amber-50/40' : 'border-slate-200/90 bg-white/80'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {c.done ? <CheckCircleIcon className="h-4 w-4 text-emerald-600 shrink-0" /> : <ExclamationTriangleIcon className="h-4 w-4 text-amber-500 shrink-0" />}
                    <p className="text-[11px] font-bold leading-tight text-slate-800">{c.title}</p>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">{c.sub}</p>
                  <p className="text-lg font-bold tabular-nums text-slate-900 mt-auto">{c.v}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Sleeve mix (this plan)</p>
              <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                Steady {coreSleevePct.toFixed(0)}% / Growth {upsideSleevePct.toFixed(0)}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Steady = Core bucket. Growth = High-upside bucket.</p>
            </div>
            <div className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">At risk of overfill</p>
              <p className={`text-base font-bold tabular-nums mt-0.5 ${health.overMaxCount === 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{health.overMaxCount}</p>
              <p className="text-[11px] text-slate-500 mt-1">A position is above your max cap for that stock.</p>
            </div>
            <div className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Waiting to be connected</p>
              <p className={`text-base font-bold tabular-nums mt-0.5 ${health.unmappedCount === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{health.unmappedCount}</p>
              <p className="text-[11px] text-slate-500 mt-1">Use “Add from watchlist &amp; holdings” to import.</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-slate-900 p-4 text-slate-50 shadow-md">
              <p className="text-[11px] font-medium text-slate-300">One-tap fix</p>
              <p className="text-sm font-semibold text-white mt-0.5">Auto-balance weights</p>
              <button
                type="button"
                onClick={onAutoConfigureWeights}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100"
              >
                <SparklesIcon className="h-4 w-4" />
                Run auto-configure
              </button>
            </div>
          </div>

          {Math.abs(health.monthlyWeightTotal - 1) > 0.01 && health.actionableCount > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950" role="status">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" />
              <p>
                <strong className="font-semibold">Heads up:</strong> the slice percentages should add to about <strong>100%</strong> for each active sleeve, so
                the app doesn’t over- or under-spend. Tap <em>Run auto-configure</em> or adjust a few numbers.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setGuideOpen((o) => !o)}
            className="mt-5 w-full sm:w-auto text-left text-sm font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-2"
          >
            {guideOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            {guideOpen ? 'Hide' : 'Show'} quick guide (plain English)
          </button>
          {guideOpen && (
            <ol className="mt-2 space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-slate-700 list-decimal list-inside max-w-4xl">
              <li>
                <strong className="text-slate-900">Add or import</strong> tickers (type above, or pull from your watchlist and current holdings in one click).
              </li>
              <li>
                <strong className="text-slate-900">Pick a simple role</strong> — <em>Steady (Core)</em> and <em>Growth (High-upside)</em> get the monthly money; <em>Watchlist</em> is watch-only; <em>Quarantine</em> blocks new buys.
              </li>
              <li>
                <strong className="text-slate-900">Balance the bar</strong> to ~100% so the split matches what you want each month. Caps stop any one stock from taking too much.
              </li>
            </ol>
          )}

          {/* Search + filter chips */}
          <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="w-full min-w-0 max-w-md">
              <label className="sr-only" htmlFor="universe-search">
                Search this list
              </label>
              <input
                id="universe-search"
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQuery(e.target.value)}
                placeholder="Search by symbol or company name…"
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Filter:</span>
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.help}
                  onClick={() => onUniverseFilter(opt.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    universeFilter === opt.id
                      ? 'border-indigo-500 bg-indigo-600 text-white shadow-md'
                      : 'border-slate-200 bg-white/80 text-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {opt.short}
                  <span
                    className={`tabular-nums rounded-full px-1.5 py-0.5 text-[10px] ${
                      universeFilter === opt.id ? 'bg-white/20' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {filterCounts[opt.id]}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Sort:</span>
              <select
                value={universeSort}
                onChange={(e) => onUniverseSort(e.target.value as UniverseSort)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm"
              >
                <option value="ticker">A–Z by symbol</option>
                <option value="status">By role (status)</option>
                <option value="weight">By weight (highest first)</option>
              </select>
            </div>
          </div>

          {/* Action row */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canAddWatchlistHoldings && (
              <button
                type="button"
                onClick={onAddWatchlistAndHoldings}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/80 px-4 py-2.5 text-sm font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100/80"
              >
                <SparklesIcon className="h-4 w-4" />
                Add from watchlist &amp; holdings
              </button>
            )}
            <button
              type="button"
              onClick={onSyncPlanFromUniverse}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Sync plan lists from this table
            </button>
            <div className="ml-auto flex flex-wrap gap-2 items-end">
              <input
                type="text"
                placeholder="Symbol (e.g. AAPL)"
                value={newTicker.ticker}
                onChange={(e) => onNewTicker((p) => ({ ...p, ticker: e.target.value.toUpperCase() }))}
                className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Company (optional)"
                value={newTicker.name}
                onChange={(e) => onNewTicker((p) => ({ ...p, name: e.target.value }))}
                className="min-w-[140px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={onAddNewTicker}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-md hover:bg-secondary"
                title="Add to list"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Data: desktop table + mobile cards */}
          <div className="mt-4 max-h-[32rem] overflow-auto rounded-2xl border border-slate-200/80 bg-white/50 shadow-inner">
            {displayRows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-600">
                {unifiedUniverse.length === 0 ? (
                  <>
                    <p className="text-base font-semibold text-slate-800">Start your list in under a minute</p>
                    <p className="text-sm mt-2 max-w-md mx-auto">Add a symbol above, or use <strong>Add from watchlist &amp; holdings</strong> to import everything you already follow.</p>
                    {onNavigateToWatchlist && (
                      <button type="button" onClick={onNavigateToWatchlist} className="mt-4 text-sm font-semibold text-indigo-600 hover:underline">
                        Open watchlist
                      </button>
                    )}
                  </>
                ) : (
                  <p className="font-medium text-slate-800">No rows match this search or filter. Try &quot;All&quot; or clear the search box.</p>
                )}
              </div>
            ) : (
              <>
                <div className="hidden md:block min-w-[1100px]">
                  <table className="w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-100/80 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600" />
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Symbol</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Company</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Live (spot)</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">
                          <span className="inline-flex items-center gap-1">Role in plan</span>
                        </th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            Your pick (status)
                            <InfoHint
                              text="Steady vs growth vs watch-only. The app uses this to route monthly money and safety rules."
                              hintId="universe-status-hub"
                              hintPage="Investments"
                            />
                          </span>
                        </th>
                        <th className="px-3 py-2.5 text-center font-bold text-slate-600">
                          <span className="inline-flex items-center justify-center gap-1">Slice %</span>
                        </th>
                        <th className="px-3 py-2.5 text-center font-bold text-slate-600">
                          <span className="inline-flex items-center justify-center gap-1">Max %</span>
                        </th>
                        <th className="px-3 py-2.5 text-right font-bold text-slate-600" />
                      </tr>
                    </thead>
                    <tbody className="bg-white/90">
                      {displayRows.map((ticker) => {
                        const key = `${ticker.id}::${ticker.ticker}`;
                        const isOpen = expanded.has(key);
                        const symU = (ticker.ticker || '').toUpperCase();
                        const px = simulatedPrices[symU]?.price;
                        const instr = inferInstrumentCurrencyFromSymbol(symU);
                        return (
                          <React.Fragment key={key}>
                            <tr className="hover:bg-indigo-50/30 group border-b border-slate-100/80">
                              <td className="px-1 py-1 w-8">
                                <button
                                  type="button"
                                  onClick={() => toggleRow(key)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  aria-expanded={isOpen}
                                  title="Why is this here?"
                                >
                                  {isOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                                </button>
                              </td>
                              <td className="px-3 py-2 font-bold text-slate-900">
                                {ticker.ticker}
                                <div className="text-[10px] font-normal text-slate-400 truncate max-w-[8rem]">{ticker.source}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-600 max-w-[10rem] truncate" title={ticker.name ?? ''}>
                                {ticker.name}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-700 tabular-nums">
                                {px != null && Number.isFinite(px) && px > 0 ? (
                                  <CurrencyDualDisplay value={px} inCurrency={instr} digits={priceDigits} size="base" className="inline-flex" />
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-700 leading-snug min-w-[8rem]">{getUniverseRowPlanRole(ticker)}</td>
                              <td className="px-3 py-2">
                                <select
                                  value={ticker.status}
                                  onChange={(e) => onStatusUpdate(ticker, e.target.value as TickerStatus)}
                                  className="w-full min-w-[9rem] rounded-lg border border-slate-200 p-1.5 text-xs font-medium bg-white"
                                >
                                  <option>Core</option>
                                  <option>High-Upside</option>
                                  <option>Watchlist</option>
                                  <option>Quarantine</option>
                                  <option>Speculative</option>
                                  <option>Excluded</option>
                                </select>
                              </td>
                              <td className="px-3 py-2 text-center">
                                {isUniverseTicker(ticker) ? (
                                  isActionableUniverseStatus(ticker.status) ? (
                                    <>
                                      <input
                                        type="number"
                                        value={ticker.monthly_weight != null ? ticker.monthly_weight * 100 : ''}
                                        onChange={(e) => onMonthlyWeightInput(ticker, e.target.value)}
                                        onBlur={onMonthlyWeightBlur}
                                        className="w-16 p-1.5 border border-slate-200 rounded-lg text-right text-xs"
                                        placeholder="auto"
                                      />
                                      <span className="text-[10px] ml-0.5 text-slate-400">%</span>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">Auto</span>
                                  )
                                ) : (
                                  <span className="text-[10px] text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {isUniverseTicker(ticker) ? (
                                  isActionableUniverseStatus(ticker.status) ? (
                                    <>
                                      <input
                                        type="number"
                                        value={ticker.max_position_weight != null ? ticker.max_position_weight * 100 : ''}
                                        onChange={(e) => onMaxPosWeightInput(ticker, e.target.value)}
                                        onBlur={onMaxPosBlur}
                                        className="w-16 p-1.5 border border-slate-200 rounded-lg text-right text-xs"
                                        placeholder="auto"
                                      />
                                      <span className="text-[10px] ml-0.5 text-slate-400">%</span>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">Auto</span>
                                  )
                                ) : (
                                  <span className="text-[10px] text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {isUniverseTicker(ticker) && (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteUniverse(ticker)}
                                    className="p-1.5 text-slate-300 hover:text-rose-600 rounded-lg"
                                    title="Remove from this list"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-slate-50/90 border-b border-slate-100">
                                <td colSpan={9} className="px-4 py-3 text-xs text-slate-600">
                                  <p>
                                    <strong className="text-slate-800">Source:</strong> {ticker.source || '—'}. The role above tells the app whether
                                    to include this name when splitting your <strong>monthly invest amount</strong>. Slice % is your share of that
                                    role’s piece of the budget; max % is a safety cap for one company.
                                  </p>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden divide-y divide-slate-100 p-2 space-y-2">
                  {displayRows.map((ticker) => {
                    const rowKey = `${ticker.id}::${ticker.ticker}`;
                    const symU = (ticker.ticker || '').toUpperCase();
                    const px = simulatedPrices[symU]?.price;
                    const instr = inferInstrumentCurrencyFromSymbol(symU);
                    return (
                      <div
                        key={rowKey}
                        className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="text-lg font-bold text-slate-900">{ticker.ticker}</p>
                            <p className="text-xs text-slate-500 line-clamp-2">{ticker.name}</p>
                            <p className="text-[10px] text-slate-400 mt-1">{ticker.source}</p>
                          </div>
                          <div className="text-right text-xs text-slate-600">
                            <div className="text-[10px] uppercase text-slate-400">Spot</div>
                            {px != null && Number.isFinite(px) && px > 0 ? (
                              <CurrencyDualDisplay value={px} inCurrency={instr} digits={priceDigits} size="base" className="justify-end" />
                            ) : (
                              '—'
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 mt-2">{getUniverseRowPlanRole(ticker)}</p>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div>
                            <span className="text-[10px] text-slate-500 block mb-0.5">Status</span>
                            <select
                              value={ticker.status}
                              onChange={(e) => onStatusUpdate(ticker, e.target.value as TickerStatus)}
                              className="w-full rounded-lg border p-1.5 text-sm"
                            >
                              <option>Core</option>
                              <option>High-Upside</option>
                              <option>Watchlist</option>
                              <option>Quarantine</option>
                              <option>Speculative</option>
                              <option>Excluded</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Slice %</span>
                              {isUniverseTicker(ticker) && isActionableUniverseStatus(ticker.status) ? (
                                <input
                                  type="number"
                                  value={ticker.monthly_weight != null ? ticker.monthly_weight * 100 : ''}
                                  onChange={(e) => onMonthlyWeightInput(ticker, e.target.value)}
                                  onBlur={onMonthlyWeightBlur}
                                  className="w-full p-1.5 border rounded text-right text-sm"
                                />
                              ) : (
                                <span className="text-sm text-slate-400">Auto</span>
                              )}
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Max %</span>
                              {isUniverseTicker(ticker) && isActionableUniverseStatus(ticker.status) ? (
                                <input
                                  type="number"
                                  value={ticker.max_position_weight != null ? ticker.max_position_weight * 100 : ''}
                                  onChange={(e) => onMaxPosWeightInput(ticker, e.target.value)}
                                  onBlur={onMaxPosBlur}
                                  className="w-full p-1.5 border rounded text-right text-sm"
                                />
                              ) : (
                                <span className="text-sm text-slate-400">Auto</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleRow(rowKey)}
                          className="mt-2 text-xs font-medium text-indigo-600"
                        >
                          {expanded.has(rowKey) ? 'Hide' : 'Show'} why this row exists
                        </button>
                        {expanded.has(rowKey) && (
                          <p className="text-xs text-slate-500 mt-1 border-t border-slate-100 pt-2">
                            {ticker.source} — {getUniverseRowPlanRole(ticker)}
                          </p>
                        )}
                        {isUniverseTicker(ticker) && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => onDeleteUniverse(ticker)}
                              className="text-xs text-rose-600 font-medium"
                            >
                              Remove from list
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioUniversePanel;
