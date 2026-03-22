import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';

function resolveAccountId(candidate: string | undefined, accounts: Account[]): string | undefined {
  const c = (candidate ?? '').trim();
  if (!c) return undefined;
  const direct = accounts.find((a) => a.id === c);
  if (direct) return direct.id;
  const external = accounts.find((a) => ((a as { account_id?: string }).account_id ?? (a as { accountId?: string }).accountId) === c);
  return external?.id;
}

/** Denomination of balances/transfers on a cash account (Checking/Savings). */
export function resolveCashAccountCurrency(
  acc: Account | undefined,
  data: FinancialData | null | undefined,
): TradeCurrency {
  const raw = (acc as Account & { currency?: TradeCurrency })?.currency;
  if (raw === 'SAR' || raw === 'USD') return raw;
  const plan = data?.investmentPlan?.budgetCurrency;
  if (plan === 'SAR' || plan === 'USD') return plan;
  return 'SAR';
}

/**
 * When transferring cash → investment, the deposit ledger row must use the **same currency as the source cash account**,
 * not the portfolio’s base currency (e.g. SAR transfer must not be stored as USD).
 */
export function ledgerCurrencyCashToInvestment(fromCashAccount: Account | undefined, data: FinancialData | null | undefined): TradeCurrency {
  return resolveCashAccountCurrency(fromCashAccount, data);
}

/**
 * When transferring investment → cash, attribute the withdrawal to the **destination cash account** denomination
 * (the amount typed in the transfer UI matches that account).
 */
export function ledgerCurrencyInvestmentToCash(toCashAccount: Account | undefined, data: FinancialData | null | undefined): TradeCurrency {
  return resolveCashAccountCurrency(toCashAccount, data);
}

/**
 * Legacy rows without `currency`: infer from linked account’s portfolios (single-currency platforms), else SAR.
 */
export function inferInvestmentTransactionCurrency(
  t: Pick<InvestmentTransaction, 'currency' | 'accountId'>,
  accounts: Account[],
  investments: InvestmentPortfolio[],
): TradeCurrency {
  if (t.currency === 'SAR' || t.currency === 'USD') return t.currency;
  const aid = t.accountId ?? '';
  if (!aid) return 'SAR';
  const accPortfolios = investments.filter((p) => resolveAccountId(p.accountId, accounts) === aid || p.accountId === aid);
  const curs = new Set((accPortfolios.length ? accPortfolios : []).map((p) => (p.currency as TradeCurrency) || 'USD'));
  if (curs.size === 1) {
    const one = [...curs][0];
    if (one === 'SAR' || one === 'USD') return one;
  }
  return 'SAR';
}
