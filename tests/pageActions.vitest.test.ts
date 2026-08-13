import { describe, expect, it } from 'vitest';
import { isSupportedPageAction } from '../utils/pageActions';
import type { Page } from '../types';

describe('isSupportedPageAction', () => {
  it('accepts known notification actions', () => {
    expect(isSupportedPageAction('Notifications', 'notifications-tab:alerts')).toBe(true);
    expect(isSupportedPageAction('Notifications', 'notifications-tab:tasks')).toBe(true);
  });

  it('accepts Dashboard plan compare and salary-invest deep-links', () => {
    expect(isSupportedPageAction('Dashboard', 'plan-compare-dashboard')).toBe(true);
    expect(isSupportedPageAction('Dashboard', 'focus-salary-invest')).toBe(true);
    expect(isSupportedPageAction('Dashboard', 'focus-investment-roi')).toBe(true);
    expect(isSupportedPageAction('Dashboard', 'plan-compare-dashboard-extra')).toBe(false);
    expect(isSupportedPageAction('Settings', 'focus-salary-investing')).toBe(true);
    expect(isSupportedPageAction('Investments', 'focus-salary-invest')).toBe(true);
  });

  it('accepts known transaction and goal actions', () => {
    expect(isSupportedPageAction('Transactions', 'open-transaction-modal')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food:monthly:2026:4')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Rent:yearly:2026:12')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food%20%26%20Dining:monthly:2026:5')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food:monthly:2026:5:2026-05-01')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-plan-expense:2026:4:Housing')).toBe(true);
    expect(isSupportedPageAction('Transactions', 'filter-plan-expense:2026:12:Food%20%26%20Dining')).toBe(true);
    expect(isSupportedPageAction('Goals', 'focus-goal:g-1')).toBe(true);
  });

  it('accepts known investment and engines actions', () => {
    expect(isSupportedPageAction('Investments', 'investment-tab:Overview')).toBe(true);
    expect(isSupportedPageAction('Investments', 'investment-tab:Watchlist')).toBe(true);
    expect(isSupportedPageAction('Investments', 'investment-tab:Dividend Tracker')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-trade-modal')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-trade-modal:from-plan')).toBe(true);
    expect(isSupportedPageAction('Investments', 'focus-symbol:AAPL')).toBe(true);
    expect(isSupportedPageAction('Investments', 'focus-dividend-sms')).toBe(true);
    expect(isSupportedPageAction('Investments', 'focus-holdings-integrity')).toBe(true);
    expect(isSupportedPageAction('Investments', 'sync-realized-pnl')).toBe(true);
    expect(isSupportedPageAction('Statement Upload', 'focus-sms-tab')).toBe(true);
    expect(isSupportedPageAction('Statement Upload', 'focus-bank-tab')).toBe(true);
    expect(isSupportedPageAction('Statement Upload', 'focus-trading-tab')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-corporate-action-wizard')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-corporate-action-wizard:from-plan')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-reconcile-quantity')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-reconcile-quantity:h-1')).toBe(true);
    expect(isSupportedPageAction('Investments', 'open-reconcile-broker-cash:a-1')).toBe(true);
    expect(isSupportedPageAction('Accounts', 'open-reconcile-balance')).toBe(true);
    expect(isSupportedPageAction('Accounts', 'open-reconcile-balance:acc-1')).toBe(true);
    expect(isSupportedPageAction('Accounts', 'open-pay-card')).toBe(true);
    expect(isSupportedPageAction('Accounts', 'open-pay-card:acc-1')).toBe(true);
    expect(isSupportedPageAction('Accounts', 'open-pay-card:acc-1:full')).toBe(true);
    expect(isSupportedPageAction('Liabilities', 'open-restate:l-1')).toBe(true);
    expect(isSupportedPageAction('Commodities', 'open-revalue:c-1')).toBe(true);
    expect(isSupportedPageAction('Assets', 'open-revalue')).toBe(true);
    expect(isSupportedPageAction('Engines & Tools', 'openLogic')).toBe(true);
    expect(isSupportedPageAction('Budgets', 'budgets-focus-admin-pending')).toBe(true);
    expect(isSupportedPageAction('Budgets', 'budgets-open-request-form')).toBe(true);
  });

  it('accepts known Rewards actions', () => {
    expect(isSupportedPageAction('Rewards', 'open-create-reward')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-earn')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-earn:acc-1')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-redeem')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-redeem:acc-1')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-rewards-expire')).toBe(true);
    expect(isSupportedPageAction('Rewards', 'open-apply-cashback:acc-1')).toBe(true);
  });

  it('rejects unknown or malformed Rewards actions', () => {
    expect(isSupportedPageAction('Rewards', 'totally-unknown')).toBe(false);
    expect(isSupportedPageAction('Rewards', 'open-earn:')).toBe(false);
    expect(isSupportedPageAction('Rewards', 'focus-goal:g-1')).toBe(false);
  });

  it('rejects unknown or malformed actions', () => {
    expect(isSupportedPageAction('Investments', 'totally-unknown')).toBe(false);
    expect(isSupportedPageAction('Investments', 'investment-tab:Unknown Tab')).toBe(false);
    expect(isSupportedPageAction('Investments', 'open-trade-modalfoo')).toBe(false);
    expect(isSupportedPageAction('Goals', 'investment-tab:Watchlist')).toBe(false);
    expect(isSupportedPageAction('Goals', 'focus-goal:')).toBe(false);
    expect(isSupportedPageAction('Assets', '')).toBe(false);
    expect(isSupportedPageAction('Assets', 'focus-goal:abc')).toBe(false);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food:invalid:2026:4')).toBe(false);
    expect(isSupportedPageAction('Transactions', 'filter-by-budget:Food:monthly:2026:13')).toBe(false);
    expect(isSupportedPageAction('Transactions', 'filter-plan-expense:2026:0:Housing')).toBe(false);
    expect(isSupportedPageAction('Transactions', 'filter-plan-expense:2026:13:Housing')).toBe(false);
    expect(isSupportedPageAction('Budgets', 'focus-goal:abc')).toBe(false);
  });

  it('fails closed for pages with no mapped actions', () => {
    expect(isSupportedPageAction('Summary' as Page, 'notifications-tab:alerts')).toBe(false);
  });
});
