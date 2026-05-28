import { EXECUTE_PLAN_STORAGE_KEY } from '../content/plainLanguage';
import type { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

/** One selectable row: a specific holding in a specific portfolio. */
export interface HoldingSymbolOption {
  optionKey: string;
  symbol: string;
  name: string;
  holdingId: string;
  portfolioId: string;
  portfolioName: string;
  accountId: string;
  quantity: number;
  avgCost: number;
  bookCurrency: TradeCurrency;
}

export function holdingOptionKey(portfolioId: string, holdingId: string): string {
  return `${portfolioId}:${holdingId}`;
}

export function parseHoldingOptionKey(key: string): { portfolioId: string; holdingId: string } | null {
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const portfolioId = key.slice(0, i);
  const holdingId = key.slice(i + 1);
  if (!portfolioId || !holdingId) return null;
  return { portfolioId, holdingId };
}

function holdingDisplayName(h: Holding): string {
  const n = (h.name || '').trim();
  return n || (h.symbol || '').trim();
}

/**
 * Flatten personal portfolios into pick-list rows (one row per holding instance).
 */
/** Holdings pick-list for one portfolio only (Record Trade sell/dividend). */
export function filterHoldingSymbolOptionsByPortfolio(
  options: HoldingSymbolOption[],
  portfolioId: string | null | undefined,
): HoldingSymbolOption[] {
  const pid = String(portfolioId ?? '').trim();
  if (!pid) return [];
  return options.filter((o) => o.portfolioId === pid);
}

export function buildHoldingSymbolOptions(
  portfolios: InvestmentPortfolio[],
  portfolioId?: string | null,
): HoldingSymbolOption[] {
  const scopePid = String(portfolioId ?? '').trim();
  const rows: HoldingSymbolOption[] = [];
  for (const p of portfolios) {
    const portfolioId = String(p.id ?? '').trim();
    if (!portfolioId) continue;
    if (scopePid && portfolioId !== scopePid) continue;
    const portfolioName = (p.name || 'Portfolio').trim();
    const accountId = String(p.accountId ?? '').trim();
    const bookCurrency = resolveInvestmentPortfolioCurrency(p);
    for (const h of p.holdings ?? []) {
      const symbol = (h.symbol || '').trim().toUpperCase();
      if (symbol.length < 1) continue;
      const holdingId = String(h.id ?? '').trim();
      if (!holdingId) continue;
      const qty = Number(h.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      rows.push({
        optionKey: holdingOptionKey(portfolioId, holdingId),
        symbol,
        name: holdingDisplayName(h),
        holdingId,
        portfolioId,
        portfolioName,
        accountId,
        quantity: qty,
        avgCost: Number.isFinite(Number(h.avgCost)) ? Number(h.avgCost) : 0,
        bookCurrency,
      });
    }
  }
  return rows.sort((a, b) => {
    const sym = a.symbol.localeCompare(b.symbol);
    if (sym !== 0) return sym;
    return a.portfolioName.localeCompare(b.portfolioName);
  });
}

export function findHoldingOptionByKey(
  options: HoldingSymbolOption[],
  key: string,
): HoldingSymbolOption | undefined {
  if (!key) return undefined;
  return options.find((o) => o.optionKey === key);
}

export function findHoldingOptionsForSymbol(
  options: HoldingSymbolOption[],
  symbol: string,
): HoldingSymbolOption[] {
  const norm = (symbol || '').trim().toUpperCase();
  if (!norm) return [];
  return options.filter((o) => o.symbol === norm);
}

/** Resolve pick-list key from symbol + optional portfolio (e.g. plan/deeplink prefill). */
export function resolveHoldingOptionKeyFromSymbol(
  options: HoldingSymbolOption[],
  symbol: string,
  portfolioId?: string | null,
): string {
  const matches = findHoldingOptionsForSymbol(options, symbol);
  if (matches.length === 0) return '';
  const pid = (portfolioId || '').trim();
  if (pid) {
    const exact = matches.find((m) => m.portfolioId === pid);
    if (exact) return exact.optionKey;
  }
  return matches[0].optionKey;
}

export function holdingSymbolIsOwned(
  options: HoldingSymbolOption[],
  symbol: string,
  portfolioId?: string | null,
): boolean {
  const norm = (symbol || '').trim().toUpperCase();
  if (!norm) return false;
  const matches = findHoldingOptionsForSymbol(options, norm);
  if (matches.length === 0) return false;
  const pid = (portfolioId || '').trim();
  if (!pid) return true;
  return matches.some((m) => m.portfolioId === pid);
}

export interface ExecutePlanTradePayload {
  symbol: string;
  name?: string;
  tradeType: 'buy' | 'sell';
  amount?: number;
  quantity?: number;
  price?: number;
  portfolioId?: string;
  accountId?: string;
  executedPlanId?: string;
  reason?: string;
  tradeCurrency?: TradeCurrency;
}

export function buildExecutePlanPayloadFromHoldingOption(
  option: HoldingSymbolOption,
  overrides: Partial<ExecutePlanTradePayload> = {},
): ExecutePlanTradePayload {
  return {
    symbol: option.symbol,
    name: option.name,
    tradeType: 'sell',
    portfolioId: option.portfolioId,
    accountId: option.accountId || undefined,
    tradeCurrency: option.bookCurrency,
    quantity: option.quantity,
    ...overrides,
  };
}

export function stashExecutePlanTrade(payload: ExecutePlanTradePayload): void {
  try {
    sessionStorage.setItem(EXECUTE_PLAN_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Navigate to Investments → Record Trade with a stashed payload (same path as Investment Plan execute). */
export function navigateToRecordTradeFromHolding(
  option: HoldingSymbolOption,
  triggerPageAction: ((page: import('../types').Page, action: string) => void) | undefined,
  overrides: Partial<ExecutePlanTradePayload> = {},
): void {
  stashExecutePlanTrade(buildExecutePlanPayloadFromHoldingOption(option, overrides));
  if (triggerPageAction) {
    triggerPageAction('Investments', 'open-trade-modal:from-plan');
  }
}
