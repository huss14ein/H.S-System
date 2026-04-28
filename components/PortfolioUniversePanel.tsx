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
import { BoltIcon } from './icons/BoltIcon';
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
  { id: 'all', short: 'Everything', help: 'All companies on this screen' },
  { id: 'Core', short: 'Steady picks', help: 'Where most of each month’s money goes' },
  { id: 'High-Upside', short: 'Growth picks', help: 'Higher-upside slice of your monthly budget' },
  { id: 'Watchlist', short: 'Watching only', help: 'Tracked but no automatic buys' },
  { id: 'Needs mapping', short: 'Needs a link', help: 'Imported from holdings but not finalized in your list yet' },
];

/** Plain-language dropdown labels — values stay API-compatible. */
const ROLE_OPTIONS: { value: TickerStatus; line: string }[] = [
  { value: 'Core', line: 'Stable base (Core) — gets monthly savings' },
  { value: 'High-Upside', line: 'Growth (High-upside) — growth slice of savings' },
  { value: 'Watchlist', line: 'Ideas only (Watchlist) — watch, no auto-buy' },
  { value: 'Quarantine', line: 'Paused (Quarantine) — no new buys for now' },
  { value: 'Speculative', line: 'Extra risky (Speculative) — small bets only' },
  { value: 'Excluded', line: 'Ignored (Excluded) — plan skips this ticker' },
];

const READINESS_R = 44;

function ReadinessRing({ score }: { score: number }) {
  const c = 2 * Math.PI * READINESS_R;
  const pct = Math.max(0, Math.min(100, score));
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative h-[104px] w-[104px] shrink-0" aria-hidden>
      <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
        <circle cx="52" cy="52" r={READINESS_R} fill="none" stroke="rgb(226 232 240)" strokeWidth="9" />
        <circle
          cx="52"
          cy="52"
          r={READINESS_R}
          fill="none"
          stroke="url(#portfolioUniverseRingGrad)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
        <defs>
          <linearGradient id="portfolioUniverseRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[1.65rem] font-black leading-none text-slate-900 tabular-nums">{Math.round(pct)}</span>
        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">ready score</span>
      </div>
    </div>
  );
}

const PortfolioUniversePanel: React.FC<{
  planCurrency: TradeCurrency;
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
  /** One tap: pull in watchlist/holdings rows + rebalance slices (parent wiring). */
  onFullAutoSetup?: () => void | Promise<void>;
  /** Ticker value display decimals for live column */
  priceDigits?: number;
}> = ({
  planCurrency: _planCurrency,
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
  onFullAutoSetup,
  priceDigits = 2,
}) => {
  const [guideOpen, setGuideOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fullAutoBusy, setFullAutoBusy] = useState(false);
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

  const runFullAutoSetup = async () => {
    if (!onFullAutoSetup) return;
    setFullAutoBusy(true);
    try {
      await onFullAutoSetup();
    } finally {
      setFullAutoBusy(false);
    }
  };

  const readinessHeadline =
    step1 && step2 && step3 && step4
      ? 'Your plan can run smoothly'
      : health.totalCount === 0
        ? 'Start in one minute'
        : 'Almost there — one tap can finish setup';

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
                  <span>Portfolio menu — smart autopilot</span>
                </h2>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800 border border-indigo-200/80">
                  Ultra
                </span>
                {liveQuotesAny && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                    Live prices
                  </span>
                )}
                <InfoHint
                  text="You choose which companies receive your monthly savings and how big each slice is. Finova applies safety caps and balances slices automatically when you ask it to. Everything here applies only to the portfolio you pick on the right."
                  hintId="universe-hub-intro"
                  hintPage="Investments"
                />
              </div>
              <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-3xl leading-relaxed">
                Built for people who don’t live in spreadsheets: pick your account, tap <strong>Do everything for me</strong> when it appears, or use the short checklist below.
                No jargon required — “slice” just means how much of each month’s invest amount goes to that stock.
              </p>
            </div>
            {personalPortfolios.length > 0 && (
              <div className="w-full sm:w-72 shrink-0 rounded-2xl border border-white/60 bg-white/80 p-3 shadow-sm backdrop-blur-sm">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Which account?</label>
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

          {/* Automation cockpit — visual readiness + one-tap setup */}
          <div className="mt-6 rounded-2xl border-2 border-indigo-100 bg-gradient-to-br from-white via-indigo-50/40 to-emerald-50/30 p-4 sm:p-6 shadow-md">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <ReadinessRing score={score} />
                <div className="min-w-0 text-center sm:text-left flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">Automation readiness</p>
                  <p className="mt-1 text-lg sm:text-xl font-bold text-slate-900 leading-snug">{readinessHeadline}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className={`font-semibold ${score >= 80 ? 'text-emerald-700' : score >= 55 ? 'text-amber-700' : 'text-rose-700'}`}>{scoreLabel}</span>
                    <span className="text-slate-500"> · slices add to {(health.monthlyWeightTotal * 100).toFixed(0)}% ( aim ~100% )</span>
                  </p>
                  <p className="mt-2 text-xs text-slate-600 leading-relaxed max-w-xl">{scoreHint}</p>
                </div>
              </div>
              <div className="flex flex-col gap-3 w-full lg:w-auto lg:min-w-[280px]">
                {onFullAutoSetup && (
                  <button
                    type="button"
                    onClick={() => void runFullAutoSetup()}
                    disabled={fullAutoBusy}
                    className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                  >
                    <BoltIcon className="h-5 w-5 shrink-0" aria-hidden />
                    {fullAutoBusy ? 'Working…' : 'Do everything for me — import & balance'}
                  </button>
                )}
                <p className="text-[11px] text-slate-600 leading-snug">
                  {onFullAutoSetup
                    ? 'Adds any missing stocks from your watchlist & holdings, then spreads monthly “slices” fairly and safely. You can still edit rows below.'
                    : 'Use the buttons below to bring in stocks and balance slices — same result, more steps.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {canAddWatchlistHoldings && (
                    <button
                      type="button"
                      onClick={onAddWatchlistAndHoldings}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-50 shadow-sm"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add missing stocks
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onAutoConfigureWeights}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800 shadow-sm"
                  >
                    <SparklesIcon className="h-4 w-4" />
                    Balance slices only
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { ok: step1, label: 'Has stocks on the list', short: 'List' },
                { ok: step2, label: 'Ready for monthly money', short: 'Roles' },
                { ok: step3, label: 'Slices ≈ 100%', short: 'Slices' },
                { ok: step4, label: 'Everything linked', short: 'Linked' },
              ].map((s) => (
                <div
                  key={s.short}
                  className={`rounded-xl border px-3 py-2 flex items-start gap-2 ${s.ok ? 'border-emerald-200 bg-emerald-50/80' : 'border-slate-200 bg-white/90'}`}
                >
                  {s.ok ? (
                    <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
                  )}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{s.short}</p>
                    <p className="text-xs font-semibold text-slate-900 leading-snug">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            {Math.abs(health.monthlyWeightTotal - 1) > 0.01 && health.actionableCount > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950" role="status">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <p>
                  Your monthly slices should add up to about <strong>100%</strong>. Tap <strong>Balance slices only</strong> or <strong>Do everything for me</strong> — or tweak numbers in the table.
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setGuideOpen((o) => !o)}
            className="mt-5 w-full sm:w-auto text-left text-sm font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-2"
          >
            {guideOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            {guideOpen ? 'Hide' : 'Show'} 60-second explanation
          </button>
          {guideOpen && (
            <ol className="mt-2 space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-slate-700 list-decimal list-inside max-w-4xl">
              <li>
                <strong className="text-slate-900">Tell us what you own or watch</strong> — add symbols, or import from your watchlist &amp; holdings in one go.
              </li>
              <li>
                <strong className="text-slate-900">Say who gets paid first</strong> — “stable” vs “growth” stocks share your monthly invest amount; “watching only” never auto-buys.
              </li>
              <li>
                <strong className="text-slate-900">Let Finova split the pie</strong> — one tap balances percentages and keeps any single company from hogging the budget.
              </li>
            </ol>
          )}

          {/* Search + filter chips */}
          <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="w-full min-w-0 max-w-md">
              <label className="sr-only" htmlFor="universe-search">
                Search companies
              </label>
              <input
                id="universe-search"
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQuery(e.target.value)}
                placeholder="Search company or ticker…"
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Show:</span>
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
                Pull from watchlist &amp; holdings
              </button>
            )}
            <button
              type="button"
              onClick={onSyncPlanFromUniverse}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Update plan from this table
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
                    <p className="text-base font-semibold text-slate-800">Your menu is empty — let’s fill it</p>
                    <p className="text-sm mt-2 max-w-md mx-auto">Type a ticker above, or tap <strong>Pull from watchlist &amp; holdings</strong> (or <strong>Do everything for me</strong> when shown) to load what you already track.</p>
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
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Ticker</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Company</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Price today</th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">
                          <span className="inline-flex items-center gap-1">Plan role</span>
                        </th>
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            Who gets savings?
                            <InfoHint
                              text="Stable vs growth vs watch-only. We use this to split your monthly invest amount safely."
                              hintId="universe-status-hub"
                              hintPage="Investments"
                            />
                          </span>
                        </th>
                        <th className="px-3 py-2.5 text-center font-bold text-slate-600">
                          <span className="inline-flex items-center justify-center gap-1">Slice %</span>
                        </th>
                        <th className="px-3 py-2.5 text-center font-bold text-slate-600">
                          <span className="inline-flex items-center justify-center gap-1">Safety cap %</span>
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
                                  className="w-full min-w-[11rem] rounded-lg border border-slate-200 p-1.5 text-xs font-medium bg-white"
                                  aria-label="Who receives monthly savings"
                                >
                                  {ROLE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.line}
                                    </option>
                                  ))}
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
                                    <strong className="text-slate-800">Where this row came from:</strong> {ticker.source || '—'}.{' '}
                                    <strong className="text-slate-800">Slice %</strong> is how much of your monthly invest pie this stock takes inside its group.
                                    <strong className="text-slate-800"> Safety cap</strong> stops one company from growing too large.
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
                              <span className="text-[10px] text-slate-500 block mb-0.5">Who gets savings?</span>
                            <select
                              value={ticker.status}
                              onChange={(e) => onStatusUpdate(ticker, e.target.value as TickerStatus)}
                              className="w-full rounded-lg border p-1.5 text-sm"
                              aria-label="Who receives monthly savings"
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.line}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Monthly slice %</span>
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
                              <span className="text-[10px] text-slate-500 block">Safety cap %</span>
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
