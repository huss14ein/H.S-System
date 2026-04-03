import { describe, expect, it } from 'vitest';
import { isSupportedPageAction } from '../utils/pageActions';
import type { Page } from '../types';

describe('isSupportedPageAction', () => {
  it('accepts known notification actions', () => {
    expect(isSupportedPageAction('Notifications', 'notifications-tab:alerts')).toBe(true);
    expect(isSupportedPageAction('Notifications', 'notifications-tab:tasks')).toBe(true);
  });

  it('accepts known transaction and goal actions', () => {
    expect(isSupportedPageAction('Transactions', 'open-transaction-modal')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food:monthly:2026:4')).toBe(true);
    expect(isSupportedPageAction('Goals', 'focus-goal:g-1')).toBe(true);
  });

  it('accepts known investment and engines actions', () => {
    expect(isSupportedPageAction('Investments', 'investment-tab:Watchlist')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-trade-modal:from-plan')).toBe(true);
    expect(isSupportedPageAction('Engines & Tools', 'openLogic')).toBe(true);
    expect(isSupportedPageAction('Budgets', 'budgets-focus-admin-pending')).toBe(true);
    expect(isSupportedPageAction('Budgets', 'budgets-open-request-form')).toBe(true);
  });

  it('rejects unknown or malformed actions', () => {
    expect(isSupportedPageAction('Investments', 'totally-unknown')).toBe(false);
    expect(isSupportedPageAction('Goals', 'investment-tab:Watchlist')).toBe(false);
    expect(isSupportedPageAction('Assets', '')).toBe(false);
    expect(isSupportedPageAction('Assets', 'focus-goal:abc')).toBe(false);
    expect(isSupportedPageAction('Budgets', 'focus-goal:abc')).toBe(false);
  });

  it('fails closed for pages with no mapped actions', () => {
    expect(isSupportedPageAction('Summary' as Page, 'notifications-tab:alerts')).toBe(false);
  });
});
