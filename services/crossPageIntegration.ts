/**
 * Cross-Page Integration Service
 * Provides utilities for navigating between related pages and triggering actions
 */

import type { Page } from '../types';

export interface PageIntegration {
  fromPage: Page;
  toPage: Page;
  action?: string;
  context?: Record<string, any>;
}

/**
 * Get related pages for a given page
 */
export function getRelatedPages(page: Page): Array<{ page: Page; label: string; reason: string }> {
  const related: Array<{ page: Page; label: string; reason: string }> = [];
  
  switch (page) {
    case 'Wealth Ultra':
      related.push(
        { page: 'Investments', label: 'Investments', reason: 'View holdings and portfolios' },
        { page: 'Market Events', label: 'Market Events', reason: 'Check upcoming market events' },
        { page: 'Recovery Plan', label: 'Recovery Plan', reason: 'Review recovery plans for losing positions' }
      );
      break;
    case 'Recovery Plan':
      related.push(
        { page: 'Wealth Ultra', label: 'Wealth Ultra', reason: 'View portfolio allocation' },
        { page: 'Investments', label: 'Investments', reason: 'Manage holdings' },
        { page: 'Market Events', label: 'Market Events', reason: 'Check earnings and macro events' }
      );
      break;
    case 'Market Events':
      related.push(
        { page: 'Wealth Ultra', label: 'Wealth Ultra', reason: 'Review portfolio strategy' },
        { page: 'Investments', label: 'Investments', reason: 'View affected holdings' },
        { page: 'Recovery Plan', label: 'Recovery Plan', reason: 'Check recovery plans' },
        { page: 'Budgets', label: 'Budgets', reason: 'Review budget impact' }
      );
      break;
    case 'Investments':
      related.push(
        { page: 'Wealth Ultra', label: 'Wealth Ultra', reason: 'View portfolio engine' },
        { page: 'Recovery Plan', label: 'Recovery Plan', reason: 'Check recovery plans' },
        { page: 'Market Events', label: 'Market Events', reason: 'View upcoming events' }
      );
      break;
    case 'Budgets':
      related.push(
        { page: 'Transactions', label: 'Transactions', reason: 'View spending' },
        { page: 'Goals', label: 'Goals', reason: 'Review goal progress' },
        { page: 'Plan', label: 'Plan', reason: 'View financial plan' }
      );
      break;
  }
  
  return related;
}

/**
 * Generate page action based on context
 */
export function generatePageAction(
  fromPage: Page,
  toPage: Page,
  context?: Record<string, any>
): string | null {
  if (fromPage === 'Market Events' && toPage === 'Investments' && context?.symbol) {
    return `focus-symbol:${context.symbol}`;
  }
  if (fromPage === 'Market Events' && toPage === 'Recovery Plan') {
    return 'focus-recovery-plan';
  }
  if (fromPage === 'Wealth Ultra' && toPage === 'Investments') {
    return 'focus-investment-plan';
  }
  if (fromPage === 'Recovery Plan' && toPage === 'Wealth Ultra') {
    return 'focus-portfolio-allocation';
  }
  return null;
}
