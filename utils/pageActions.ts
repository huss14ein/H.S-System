import type { Page } from '../types';

/**
 * Central whitelist for page-action routes emitted by notifications or quick actions.
 * Keeps navigation deterministic and prevents dispatching unknown action strings.
 */
export function isSupportedPageAction(page: Page, action: string): boolean {
  if (!action || typeof action !== 'string') return false;

  if (page === 'Dashboard') {
    return action === 'plan-compare-dashboard';
  }

  if (page === 'Notifications') {
    return action === 'notifications-tab:tasks' || action === 'notifications-tab:alerts';
  }

  if (page === 'Transactions') {
    return (
      action === 'open-transaction-modal' ||
      /^filter-by-budget:.+:(monthly|weekly|daily|yearly):\d{4}:(?:[1-9]|1[0-2])(?::\d{4}-\d{2}-\d{2})?$/i.test(action) ||
      /^filter-by-month:\d{4}-\d{2}$/i.test(action) ||
      /^filter-by-merchant:.+$/i.test(action) ||
      /^filter-plan-expense:\d{4}:(?:[1-9]|1[0-2]):.+$/.test(action)
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
      action === 'budgets-focus-admin-pending' ||
      action === 'budgets-advance-from-next-month' ||
      /^budgets-advance-from-next-month:.+/.test(action)
    );
  }

  if (page === 'Accounts') {
    return (
      action === 'open-reconcile-balance' ||
      /^open-reconcile-balance:[^\s:]+$/.test(action) ||
      action === 'open-pay-card' ||
      /^open-pay-card:[^\s:]+$/.test(action) ||
      /^open-pay-card:[^\s:]+:full$/.test(action)
    );
  }

  if (page === 'Assets') {
    return (
      action === 'open-asset-modal' ||
      action === 'open-revalue' ||
      /^open-revalue:[^\s:]+$/.test(action)
    );
  }

  if (page === 'Liabilities') {
    return (
      action === 'open-restate' ||
      /^open-restate:[^\s:]+$/.test(action)
    );
  }

  if (page === 'Commodities') {
    return (
      action === 'open-revalue' ||
      /^open-revalue:[^\s:]+$/.test(action)
    );
  }

  if (page === 'Rewards') {
    return (
      action === 'open-create-reward' ||
      action === 'open-earn' ||
      /^open-earn:[^\s:]+$/.test(action) ||
      action === 'open-redeem' ||
      /^open-redeem:[^\s:]+$/.test(action) ||
      action === 'open-rewards-expire' ||
      /^open-rewards-expire:/.test(action) ||
      action === 'open-apply-cashback' ||
      /^open-apply-cashback:[^\s:]+$/.test(action)
    );
  }

  if (page === 'Engines & Tools') {
    return action === 'openLiquidation' || action === 'openJournal' || action === 'openLogic' || action === 'openRiskTradingHub';
  }

  if (page === 'Statement Upload') {
    return (
      action === 'focus-sms-tab' ||
      action === 'focus-bank-tab' ||
      action === 'focus-trading-tab'
    );
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
      action === 'focus-dividend-sms' ||
      action === 'sync-realized-pnl' ||
      action === 'open-corporate-action-wizard' ||
      action === 'open-corporate-action-wizard:from-plan' ||
      /^focus-symbol:.+/.test(action) ||
      action === 'openRiskTradingHub' ||
      action === 'open-reconcile-quantity' ||
      /^open-reconcile-quantity:[^\s:]+$/.test(action) ||
      action === 'open-reconcile-broker-cash' ||
      /^open-reconcile-broker-cash:[^\s:]+$/.test(action) ||
      action === 'open-edit-investment-tx' ||
      /^open-edit-investment-tx:[^\s:]+$/.test(action)
    );
  }

  return false;
}
