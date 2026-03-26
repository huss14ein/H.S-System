/**
 * Money Tools (Engines & Tools): Logic & Engines, Safety & rules, Liquidation, Financial Journal
 * Fully wired to DataContext, useFinancialEnginesIntegration. URL hash sync, visibility refresh.
 */

import React, { useState, useEffect, useMemo, useCallback, useContext, lazy, Suspense } from 'react';
import { Page } from '../types';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { netCashFlowForMonthSar, savingsRateSar } from '../services/financeMetrics';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { useSelfLearning } from '../context/SelfLearningContext';
import { CubeIcon } from '../components/icons/CubeIcon';
import { ArrowTrendingDownIcon } from '../components/icons/ArrowTrendingDownIcon';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { BoltIcon } from '../components/icons/BoltIcon';
import LoadingSpinner from '../components/LoadingSpinner';
import CollapsibleSection from '../components/CollapsibleSection';

const LogicEnginesHub = lazy(() => import('./LogicEnginesHub'));
const LiquidationPlanner = lazy(() => import('./LiquidationPlanner'));
const FinancialJournal = lazy(() => import('./FinancialJournal'));
const RiskTradingHub = lazy(() => import('./RiskTradingHub'));

export type EnginesSubTab = 'Logic & Engines' | 'Safety & rules' | 'Liquidation' | 'Journal';

const ENGINES_TAB_KEY = 'finova_engines_tab';

type ToolVisual = {
  label: string;
  /** Short line under title */
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind border-t class */
  borderAccent: string;
  /** Icon circle background */
  iconBg: string;
  /** Icon stroke color */
  iconClass: string;
  /** Active card ring */
  activeRing: string;
  /** Subtle page tint when active (optional strip) */
  strip: string;
};

const TOOL_VISUAL: Record<EnginesSubTab, ToolVisual> = {
  'Logic & Engines': {
    label: 'Behind the numbers',
    blurb: 'Formulas, weights, and how portfolio math works.',
    icon: CubeIcon,
    borderAccent: 'border-t-indigo-500',
    iconBg: 'bg-indigo-100',
    iconClass: 'text-indigo-700',
    activeRing: 'ring-2 ring-indigo-500/80 ring-offset-2 ring-offset-white',
    strip: 'from-indigo-500/15 to-transparent',
  },
  'Safety & rules': {
    label: 'Safety & rules',
    blurb: 'Runway, guardrails, policy checks, net worth snapshots.',
    icon: ShieldCheckIcon,
    borderAccent: 'border-t-emerald-500',
    iconBg: 'bg-emerald-100',
    iconClass: 'text-emerald-700',
    activeRing: 'ring-2 ring-emerald-500/80 ring-offset-2 ring-offset-white',
    strip: 'from-emerald-500/15 to-transparent',
  },
  Liquidation: {
    label: 'Sell priority',
    blurb: 'What to review first if you need to raise cash.',
    icon: ArrowTrendingDownIcon,
    borderAccent: 'border-t-amber-500',
    iconBg: 'bg-amber-100',
    iconClass: 'text-amber-800',
    activeRing: 'ring-2 ring-amber-500/80 ring-offset-2 ring-offset-white',
    strip: 'from-amber-500/15 to-transparent',
  },
  Journal: {
    label: 'Notes & ideas',
    blurb: 'Capture the “why” behind trades and revisit dates.',
    icon: BookOpenIcon,
    borderAccent: 'border-t-violet-500',
    iconBg: 'bg-violet-100',
    iconClass: 'text-violet-700',
    activeRing: 'ring-2 ring-violet-500/80 ring-offset-2 ring-offset-white',
    strip: 'from-violet-500/15 to-transparent',
  },
};

interface EnginesAndToolsHubProps {
  setActivePage?: (p: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  pageAction?: string | null;
  clearPageAction?: () => void;
}

const EnginesAndToolsHub: React.FC<EnginesAndToolsHubProps> = ({
  setActivePage,
  triggerPageAction,
  pageAction,
  clearPageAction,
}) => {
  const [activeTab, setActiveTab] = useState<EnginesSubTab>('Logic & Engines');
  const [dataTick, setDataTick] = useState(0);
  const engines = useFinancialEnginesIntegration();
  const { trackAction } = useSelfLearning();
  const { data, getAvailableCashForAccount } = useContext(DataContext)!;
  const { exchangeRate } = useCurrency();
  const { formatCurrencyString } = useFormatCurrency();

  const moneyToolsKpis = useMemo(() => {
    if (!data) return null;
    const sar = resolveSarPerUsd(data, exchangeRate);
    const nw = computePersonalNetWorthSAR(data, sar, { getAvailableCashForAccount });
    const accounts = getPersonalAccounts(data);
    const txs = getPersonalTransactions(data);
    const ref = new Date();
    const { income, expenses, net } = netCashFlowForMonthSar(txs, accounts, ref, sar);
    const sr = savingsRateSar(txs, accounts, ref, sar);
    return { nw, income, expenses, net, sr };
  }, [data, exchangeRate, getAvailableCashForAccount, dataTick]);

  const statusStrip = useMemo(() => {
    const alerts = engines.analysis?.alerts ?? [];
    const critical = alerts.filter((a) => a.severity === 'critical').length;
    const warnings = alerts.filter((a) => a.severity === 'warning').length;
    const actions = engines.actionQueue?.length ?? 0;
    return { critical, warnings, actions, ready: engines.ready };
  }, [engines.analysis?.alerts, engines.actionQueue?.length, engines.ready]);

  const setTab = useCallback((tab: EnginesSubTab) => {
    trackAction(`tab-${tab.replace(/\s+/g, '-').replace('&', '')}`, 'Engines & Tools');
    setActiveTab(tab);
    try {
      if (typeof window !== 'undefined') sessionStorage.setItem(ENGINES_TAB_KEY, tab);
    } catch (_) {}
  }, [trackAction]);

  useEffect(() => {
    if (pageAction === 'openLiquidation') {
      setTab('Liquidation');
      clearPageAction?.();
    } else if (pageAction === 'openJournal') {
      setTab('Journal');
      clearPageAction?.();
    } else if (pageAction === 'openLogic') {
      setTab('Logic & Engines');
      clearPageAction?.();
    } else if (pageAction === 'openRiskTradingHub') {
      setTab('Safety & rules');
      clearPageAction?.();
    }
  }, [pageAction, clearPageAction, setTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = sessionStorage.getItem(ENGINES_TAB_KEY) as EnginesSubTab | null;
      if (
        saved &&
        (saved === 'Logic & Engines' ||
          saved === 'Safety & rules' ||
          saved === 'Liquidation' ||
          saved === 'Journal')
      ) {
        setActiveTab(saved);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setDataTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const content = useMemo(() => {
    const common = { setActivePage, triggerPageAction, dataTick };
    switch (activeTab) {
      case 'Logic & Engines':
        return <LogicEnginesHub {...common} />;
      case 'Safety & rules':
        return <RiskTradingHub embedded setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Liquidation':
        return <LiquidationPlanner {...common} />;
      case 'Journal':
        return <FinancialJournal {...common} />;
      default:
        return null;
    }
  }, [activeTab, setActivePage, triggerPageAction, dataTick]);

  const tabIds = useMemo(() => Object.keys(TOOL_VISUAL) as EnginesSubTab[], []);
  const activeVisual = TOOL_VISUAL[activeTab];

  return (
    <div className="space-y-8">
      {/* Hero + live status */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 shadow-sm">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${activeVisual.strip}`}
          aria-hidden
        />
        <div className="relative px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Money Tools</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Live data
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
                  <BoltIcon className="h-3.5 w-3.5" />
                  Engines
                </span>
              </div>
              <p className="mt-3 text-base leading-relaxed text-slate-600">
                Production utilities—not demos. Each tool uses your portfolio, accounts, and rules so you can see mechanics,
                stay within guardrails, plan sales, and keep notes in one place.
              </p>
            </div>

            {/* Status indicators */}
            <div
              className="flex shrink-0 flex-col gap-2 rounded-xl border border-slate-200/90 bg-white/90 p-4 shadow-sm backdrop-blur-sm sm:min-w-[260px]"
              role="status"
              aria-live="polite"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Engine snapshot</p>
              {!statusStrip.ready ? (
                <p className="text-sm text-slate-500">Loading your data…</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Attention signals</span>
                    <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                      {statusStrip.critical > 0 ? (
                        <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-rose-800 ring-1 ring-rose-200">
                          {statusStrip.critical} critical
                        </span>
                      ) : null}
                      {statusStrip.warnings > 0 ? (
                        <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200">
                          {statusStrip.warnings} warn
                        </span>
                      ) : null}
                      {statusStrip.critical === 0 && statusStrip.warnings === 0 ? (
                        <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-900 ring-1 ring-emerald-200">
                          Clear
                        </span>
                      ) : null}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                    <span className="text-slate-600">Suggested actions</span>
                    <span
                      className={`rounded-md px-2 py-0.5 font-semibold tabular-nums ring-1 ${
                        statusStrip.actions > 0
                          ? 'bg-sky-100 text-sky-900 ring-sky-200'
                          : 'bg-slate-100 text-slate-600 ring-slate-200'
                      }`}
                    >
                      {statusStrip.actions}
                    </span>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {moneyToolsKpis && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Net worth (SAR eq.)', value: formatCurrencyString(moneyToolsKpis.nw, { inCurrency: 'SAR' }) },
            { label: 'Month income', value: formatCurrencyString(moneyToolsKpis.income, { inCurrency: 'SAR' }) },
            { label: 'Month expenses', value: formatCurrencyString(moneyToolsKpis.expenses, { inCurrency: 'SAR' }) },
            {
              label: 'Month net · savings %',
              value: `${formatCurrencyString(moneyToolsKpis.net, { inCurrency: 'SAR' })} · ${moneyToolsKpis.sr.toFixed(1)}%`,
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{k.value}</p>
            </div>
          ))}
        </div>
      )}

      <CollapsibleSection
        title="Quick guide"
        summary="What each colored tool does"
        card={false}
        className="!rounded-xl !p-3 border border-slate-200 bg-slate-50/50"
      >
        <p className="text-sm leading-relaxed text-slate-700 m-0">
          <strong className="text-slate-900">Indigo — Logic:</strong> transparency into calculations.{' '}
          <strong className="text-emerald-800">Green — Safety:</strong> runway and rules.{' '}
          <strong className="text-amber-900">Amber — Sell priority:</strong> what to trim first.{' '}
          <strong className="text-violet-800">Violet — Journal:</strong> notes linked to your investing.
        </p>
      </CollapsibleSection>

      {/* Tool cards (primary navigation) */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Choose a tool</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tabIds.map((id) => {
            const spec = TOOL_VISUAL[id];
            const Icon = spec.icon;
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`group relative flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${spec.borderAccent} border-t-4 ${
                  isActive ? `${spec.activeRing} shadow-md` : 'hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${spec.iconBg} transition-transform group-hover:scale-105`}>
                    <Icon className={`h-5 w-5 ${spec.iconClass}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{spec.label}</span>
                      {isActive ? (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Active
                        </span>
                      ) : null}
                    </span>
                    <p className="mt-1 text-xs leading-snug text-slate-600">{spec.blurb}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-colors ${
          activeTab === 'Logic & Engines'
            ? 'ring-1 ring-indigo-100'
            : activeTab === 'Safety & rules'
              ? 'ring-1 ring-emerald-100'
              : activeTab === 'Liquidation'
                ? 'ring-1 ring-amber-100'
                : 'ring-1 ring-violet-100'
        }`}
      >
        <div
          className={`flex items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-6 ${
            activeTab === 'Logic & Engines'
              ? 'bg-gradient-to-r from-indigo-50/80 to-transparent'
              : activeTab === 'Safety & rules'
                ? 'bg-gradient-to-r from-emerald-50/80 to-transparent'
                : activeTab === 'Liquidation'
                  ? 'bg-gradient-to-r from-amber-50/80 to-transparent'
                  : 'bg-gradient-to-r from-violet-50/80 to-transparent'
          }`}
        >
          {(() => {
            const Icon = activeVisual.icon;
            return (
              <>
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${activeVisual.iconBg}`}>
                  <Icon className={`h-5 w-5 ${activeVisual.iconClass}`} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{activeVisual.label}</p>
                  <p className="text-xs text-slate-500">{activeVisual.blurb}</p>
                </div>
              </>
            );
          })()}
        </div>
        <div className="p-4 sm:p-6">
          <Suspense fallback={<LoadingSpinner className="min-h-[20rem]" />}>{content}</Suspense>
        </div>
      </div>
    </div>
  );
};

export default EnginesAndToolsHub;
