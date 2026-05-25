import type { Page } from '../types';
import { EXECUTE_PLAN_STORAGE_KEY } from '../content/plainLanguage';

/** Deep-link to Investments → Record Trade with dividend type pre-filled. */
export function stashDividendRecordTradePlan(args: {
  symbol: string;
  name?: string;
  portfolioId: string;
  accountId: string;
  tradeCurrency: 'USD' | 'SAR';
  amount?: number;
}): void {
  try {
    sessionStorage.setItem(
      EXECUTE_PLAN_STORAGE_KEY,
      JSON.stringify({
        symbol: args.symbol,
        name: args.name,
        tradeType: 'dividend',
        portfolioId: args.portfolioId,
        accountId: args.accountId,
        tradeCurrency: args.tradeCurrency,
        ...(args.amount != null && Number.isFinite(args.amount) && args.amount > 0 ? { amount: args.amount } : {}),
      }),
    );
  } catch {
    /* private mode */
  }
}

export function openRecordDividendTrade(args: {
  symbol?: string;
  name?: string;
  portfolioId?: string;
  accountId?: string;
  tradeCurrency?: 'USD' | 'SAR';
  amount?: number;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}): void {
  const canPrefill =
    Boolean(args.symbol?.trim()) &&
    Boolean(args.portfolioId?.trim()) &&
    Boolean(args.accountId?.trim()) &&
    (args.tradeCurrency === 'USD' || args.tradeCurrency === 'SAR');

  if (canPrefill) {
    stashDividendRecordTradePlan({
      symbol: args.symbol!.trim(),
      name: args.name,
      portfolioId: args.portfolioId!.trim(),
      accountId: args.accountId!.trim(),
      tradeCurrency: args.tradeCurrency!,
      amount: args.amount,
    });
    if (args.triggerPageAction) {
      args.triggerPageAction('Investments', 'open-trade-modal:from-plan');
      return;
    }
    args.setActivePage?.('Investments');
    return;
  }

  if (args.triggerPageAction) {
    args.triggerPageAction('Investments', 'open-trade-modal');
    return;
  }
  args.setActivePage?.('Investments');
}
