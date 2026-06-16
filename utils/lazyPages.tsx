import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Page } from '../types';
import { INVESTMENT_SUB_NAV_PAGE_NAMES } from '../constants';
import { scheduleIdleWork } from './runWhenIdle';

type PageModule = {
  Lazy: LazyExoticComponent<ComponentType<any>>;
  prefetch: () => Promise<unknown>;
  /** Sync bundle — no React.lazy Suspense wait. */
  eager?: boolean;
};

function loadWithRetry<T>(loader: () => Promise<{ default: T }>, retries = 1): Promise<{ default: T }> {
  return loader().catch(async (err) => {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return loadWithRetry(loader, retries - 1);
  });
}

function lazyPage<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): PageModule {
  let prefetchPromise: Promise<unknown> | null = null;
  const load = () => loadWithRetry(loader);
  const prefetch = () => {
    if (!prefetchPromise) prefetchPromise = load();
    return prefetchPromise;
  };
  return { Lazy: lazy(load), prefetch };
}

function eagerPage<T extends ComponentType<any>>(component: T): PageModule {
  return {
    Lazy: component as LazyExoticComponent<ComponentType<any>>,
    prefetch: () => Promise.resolve(),
    eager: true,
  };
}

/** Dashboard only eager — avoids Suspense on home; other heavy routes lazy-loaded for initial bundle. */
import DashboardPage from '../pages/Dashboard';

export const PAGE_MODULES: Record<Page, PageModule | undefined> = {
  Dashboard: eagerPage(DashboardPage),
  'Wealth Ultra': lazyPage(() => import('../pages/WealthUltraDashboard')),
  Budgets: lazyPage(() => import('../pages/Budgets')),
  Transactions: lazyPage(() => import('../pages/Transactions')),
  Investments: lazyPage(() => import('../pages/Investments')),
  Accounts: lazyPage(() => import('../pages/Accounts')),
  Summary: lazyPage(() => import('../pages/Summary')),
  'Wealth Analytics': lazyPage(() => import('../pages/WealthAnalytics')),
  Liabilities: lazyPage(() => import('../pages/Liabilities')),
  Goals: lazyPage(() => import('../pages/Goals')),
  Forecast: lazyPage(() => import('../pages/Forecast')),
  Analysis: lazyPage(() => import('../pages/Analysis')),
  Zakat: lazyPage(() => import('../pages/Zakat')),
  Notifications: lazyPage(() => import('../pages/Notifications')),
  Settings: lazyPage(() => import('../pages/Settings')),
  Plan: lazyPage(() => import('../pages/Plan')),
  Assets: lazyPage(() => import('../pages/Assets')),
  Commodities: lazyPage(() => import('../pages/Commodities')),
  'Market Events': lazyPage(() => import('../pages/MarketEvents')),
  'System & APIs Health': lazyPage(() => import('../pages/SystemHealth')),
  'Statement Upload': lazyPage(() => import('../pages/StatementUpload')),
  'Statement History': lazyPage(() => import('../pages/StatementHistoryView')),
  'Engines & Tools': lazyPage(() => import('../pages/EnginesAndToolsHub')),
  Installments: lazyPage(() => import('../pages/Installments')),
  'Recovery Plan': lazyPage(() => import('../pages/Investments')),
  'Investment Plan': lazyPage(() => import('../pages/Investments')),
  'Dividend Tracker': lazyPage(() => import('../pages/Investments')),
  'AI Rebalancer': lazyPage(() => import('../pages/Investments')),
  Watchlist: lazyPage(() => import('../pages/Investments')),
};

/** Maps hash/nav targets (including Investments sub-tabs) to the shell page key. */
export function resolveShellPage(page: Page): Page {
  if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(page)) return 'Investments';
  return page;
}

export function isEagerShellPage(page: Page): boolean {
  const shell = resolveShellPage(page);
  return Boolean(PAGE_MODULES[shell]?.eager);
}

export function prefetchPage(page: Page): void {
  const shell = resolveShellPage(page);
  if (PAGE_MODULES[shell]?.eager) return;
  PAGE_MODULES[shell]?.prefetch();
}

const PRIORITY_PREFETCH_PAGES: Page[] = ['Summary', 'Wealth Analytics', 'Investments', 'Budgets', 'Transactions'];

const IDLE_PREFETCH_PAGES: Page[] = [
  'Budgets',
  'Transactions',
  'Accounts',
  'Summary',
  'Wealth Analytics',
  'Investments',
  'Plan',
  'Liabilities',
  'Goals',
  'Wealth Ultra',
  'Settings',
  'Analysis',
  'Forecast',
  'Zakat',
  'Assets',
  'Commodities',
  'Market Events',
  'Notifications',
];

/** Warm common lazy chunks one route at a time so we never block the main thread for 30s+. */
export function prefetchCommonPagesIdle(): void {
  if (typeof window === 'undefined') return;
  const allPages = [...new Set([...PRIORITY_PREFETCH_PAGES, ...IDLE_PREFETCH_PAGES])];
  let index = 0;
  const step = () => {
    if (index >= allPages.length) return;
    prefetchPage(allPages[index]!);
    index += 1;
    if (index < allPages.length) {
      scheduleIdleWork(step, 2500);
    }
  };
  scheduleIdleWork(step, 3000);
}
