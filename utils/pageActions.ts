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
    return action === 'open-transaction-modal' || action.startsWith('filter-by-budget:');
  }

  if (page === 'Goals') {
    return action.startsWith('focus-goal:');
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
      action.startsWith('open-trade-modal') ||
      action.startsWith('investment-tab:') ||
      action === 'focus-investment-plan' ||
      action === 'openRiskTradingHub'
    );
  }

  if (page === 'Engines & Tools') {
    return action === 'openLiquidation' || action === 'openJournal' || action === 'openLogic' || action === 'openRiskTradingHub';
  }

  return false;
}
