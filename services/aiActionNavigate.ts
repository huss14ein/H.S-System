/**
 * Deep-link dispatcher for AiActionCard CTAs.
 * Layout registers the live navigator; coaches/Feed/Copilot call dispatchAiActionCta.
 */
import type { Page } from '../types';
import { isSupportedPageAction } from '../utils/pageActions';
import { stashExecutePlanTrade, type ExecutePlanTradePayload } from './holdingSymbolOptions';
import type { AiActionCard, AiActionCta } from './aiActionCards';

type Navigator = {
  setActivePage: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
};

let navigatorRef: Navigator | null = null;

export function registerAiActionNavigator(nav: Navigator | null): void {
  navigatorRef = nav;
}

function asPage(raw: string): Page {
  return raw as Page;
}

/** Apply a confirmable recommendation CTA (user already clicked). */
export function dispatchAiActionCta(cta: AiActionCta): boolean {
  if (!navigatorRef) return false;
  const page = asPage(String(cta.page || 'Dashboard'));
  const action = cta.action?.trim();
  const payload = cta.payload;

  // Trade prefill via existing Investment Plan execute stash.
  if (
    payload &&
    (action?.startsWith('open-trade-modal') || page === 'Investments') &&
    (payload.symbol || payload.tradeType)
  ) {
    const trade: ExecutePlanTradePayload = {
      symbol: String(payload.symbol ?? ''),
      name: payload.name != null ? String(payload.name) : undefined,
      tradeType: payload.tradeType === 'sell' ? 'sell' : 'buy',
      amount: payload.amount != null ? Number(payload.amount) : undefined,
      quantity: payload.quantity != null ? Number(payload.quantity) : undefined,
      price: payload.price != null ? Number(payload.price) : undefined,
      portfolioId: payload.portfolioId != null ? String(payload.portfolioId) : undefined,
      accountId: payload.accountId != null ? String(payload.accountId) : undefined,
      reason: payload.reason != null ? String(payload.reason) : undefined,
    };
    if (trade.symbol) {
      stashExecutePlanTrade(trade);
      navigatorRef.triggerPageAction('Investments', 'open-trade-modal:from-plan');
      return true;
    }
  }

  if (action && isSupportedPageAction(page, action)) {
    navigatorRef.triggerPageAction(page, action);
    return true;
  }

  // Investment sub-pages often arrive as page name alone.
  if (
    page === 'Recovery Plan' ||
    page === 'AI Rebalancer' ||
    page === 'Investment Plan' ||
    page === 'Dividend Tracker' ||
    page === 'Watchlist'
  ) {
    navigatorRef.setActivePage(page);
    return true;
  }

  navigatorRef.setActivePage(page);
  return true;
}

export function dispatchAiActionCard(card: AiActionCard): boolean {
  return dispatchAiActionCta(card.cta);
}
