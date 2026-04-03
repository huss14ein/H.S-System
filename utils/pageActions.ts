import type { Page } from '../types';

/**
 * Central whitelist for page-action routes emitted by notifications or quick actions.
 * Keeps navigation deterministic and prevents dispatching unknown action strings.
 */
export function isSupportedPageAction(page: Page, action: string): boolean {
  if (!action || typeof action !== 'string') return false;

  if (page === 'Notifications') {
    return action === 'notifications-tab:tasks' || action === 'notifications-tab:alerts';
  }

  if (page === 'Transactions') {
    return (
      action === 'open-transaction-modal' ||
      /^filter-by-budget:[^:]+:(monthly|weekly|daily|yearly):\d{4}:(?:[1-9]|1[0-2])$/.test(action)
    );
  }

  if (page === 'Goals') {
    return /^focus-goal:[^\s:]+$/.test(action);
  }

  if (page === 'Budgets') {
    return (
      action === 'budgets-focus-requests' ||
      action === 'budgets-focus-my-pending' ||
      action === 'budgets-open-request-form' ||
      action === 'budgets-focus-admin-pending'
    );
  }

  if (page === 'Assets') {
    return action === 'open-asset-modal';
  }

  if (page === 'Investments') {
    return (
      action === 'open-trade-modal' ||
      /^open-trade-modal:.+/.test(action) ||
      action === 'investment-tab:Recovery Plan' ||
      action === 'investment-tab:Investment Plan' ||
      action === 'investment-tab:Dividend Tracker' ||
      action === 'investment-tab:AI Rebalancer' ||
      action === 'investment-tab:Watchlist' ||
      action === 'focus-investment-plan' ||
      action === 'openRiskTradingHub'
    );
  }

  if (page === 'Engines & Tools') {
    return action === 'openLiquidation' || action === 'openJournal' || action === 'openLogic' || action === 'openRiskTradingHub';
  }

  return false;
}
