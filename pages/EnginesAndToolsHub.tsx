/**
 * Unified Engines & Tools: Logic & Engines, Liquidation Planner, Financial Journal
 * Fully wired to DataContext, useFinancialEnginesIntegration. URL hash sync, visibility refresh.
 */

import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Page } from '../types';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { useSelfLearning } from '../context/SelfLearningContext';
import { CubeIcon } from '../components/icons/CubeIcon';
import { ArrowTrendingDownIcon } from '../components/icons/ArrowTrendingDownIcon';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import LoadingSpinner from '../components/LoadingSpinner';
import CollapsibleSection from '../components/CollapsibleSection';

const LogicEnginesHub = lazy(() => import('./LogicEnginesHub'));
const LiquidationPlanner = lazy(() => import('./LiquidationPlanner'));
const FinancialJournal = lazy(() => import('./FinancialJournal'));

export type EnginesSubTab = 'Logic & Engines' | 'Liquidation' | 'Journal';

const ENGINES_TAB_KEY = 'finova_engines_tab';

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
  useFinancialEnginesIntegration();
  const { trackAction } = useSelfLearning();

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
    }
  }, [pageAction, clearPageAction, setTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = sessionStorage.getItem(ENGINES_TAB_KEY) as EnginesSubTab | null;
      if (saved && (saved === 'Logic & Engines' || saved === 'Liquidation' || saved === 'Journal')) {
        setActiveTab(saved);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setDataTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const tabs = useMemo(
    () => [
      { id: 'Logic & Engines' as EnginesSubTab, label: 'Behind the numbers', icon: CubeIcon },
      { id: 'Liquidation' as EnginesSubTab, label: 'Sell priority', icon: ArrowTrendingDownIcon },
      { id: 'Journal' as EnginesSubTab, label: 'Notes & ideas', icon: BookOpenIcon },
    ],
    []
  );

  const content = useMemo(() => {
    const common = { setActivePage, triggerPageAction, dataTick };
    switch (activeTab) {
      case 'Logic & Engines':
        return <LogicEnginesHub {...common} />;
      case 'Liquidation':
        return <LiquidationPlanner {...common} />;
      case 'Journal':
        return <FinancialJournal {...common} />;
      default:
        return null;
    }
  }, [activeTab, setActivePage, triggerPageAction, dataTick]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Money Tools</h1>
        <p className="mt-1 text-base text-slate-600 max-w-2xl">
          Simple tools to understand your investments, track your ideas, and see what might need attention—all using your real data.
        </p>
      </div>

      <CollapsibleSection title="What are these tools?" summary="Logic, Liquidation, Journal" defaultExpanded={false}>
        <p className="text-sm text-slate-700">
          <strong className="text-slate-900">Choose a tool:</strong>{' '}
          <span className="text-slate-600">Behind the numbers</span> shows how your portfolio is calculated;{' '}
          <span className="text-slate-600">Sell priority</span> lists investments to review first if you need to trim;{' '}
          <span className="text-slate-600">Notes & ideas</span> lets you jot down why you bought something and when to revisit it.
        </p>
      </CollapsibleSection>

      <div className="inline-flex items-center p-1 rounded-lg border border-slate-200 bg-white shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<LoadingSpinner className="min-h-[20rem]" />}>
        {content}
      </Suspense>
    </div>
  );
};

export default EnginesAndToolsHub;
