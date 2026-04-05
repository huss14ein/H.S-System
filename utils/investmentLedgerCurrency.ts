import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';

function resolveAccountId(candidate: string | undefined, accounts: Account[]): string | undefined {
  const c = (candidate ?? '').trim();
  if (!c) return undefined;
  const direct = accounts.find((a) => a.id === c);
  if (direct) return direct.id;
  const external = accounts.find((a) => ((a as { account_id?: string }).account_id ?? (a as { accountId?: string }).accountId) === c);
  return external?.id;
}

/**
 * Normalize any stored account reference (internal id or legacy external id) to the canonical `Account.id`
 * used in UI and `getAvailableCashForAccount`. Falls back to the trimmed raw string when unmatched.
 */
export function resolveCanonicalAccountId(candidate: string | undefined, accounts: Account[]): string {
  const c = (candidate ?? '').trim();
  if (!c) return '';
  return resolveAccountId(c, accounts) ?? c;
}

/**
 * Resolve a transaction's platform account id from any supported shape:
 * - direct accountId / account_id on transaction
 * - inferred from linked portfolioId / portfolio_id
 * Returns canonical Account.id when possible.
 */
export function resolveInvestmentTransactionAccountId(
  t: Partial<InvestmentTransaction> & { account_id?: string; portfolio_id?: string },
  accounts: Account[],
  investments: InvestmentPortfolio[],
): string {
  const directRaw = (t.accountId ?? t.account_id ?? '').trim();
  if (directRaw) return resolveCanonicalAccountId(directRaw, accounts);

  const pid = (t.portfolioId ?? t.portfolio_id ?? '').trim();
  if (!pid) return '';
  const linkedPortfolio = investments.find((p) => p.id === pid);
  const portfolioRaw = ((linkedPortfolio as { account_id?: string } | undefined)?.account_id ?? linkedPortfolio?.accountId ?? '').trim();
  if (!portfolioRaw) return '';
  return resolveCanonicalAccountId(portfolioRaw, accounts);
}

/** True if a portfolio is linked to this platform account (handles legacy `account_id` aliases). */
export function portfolioBelongsToAccount(
  portfolio: Pick<InvestmentPortfolio, 'accountId'>,
  account: Pick<Account, 'id'>,
  accounts: Account[],
): boolean {
  const raw = ((portfolio as { account_id?: string }).account_id ?? portfolio.accountId ?? '').trim();
  if (!raw) return false;
  const canon = resolveCanonicalAccountId(raw, accounts);
  return canon === account.id || raw === account.id;
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
  t: Pick<InvestmentTransaction, 'currency' | 'accountId'> & { account_id?: string; portfolioId?: string; portfolio_id?: string },
  accounts: Account[],
  investments: InvestmentPortfolio[],
): TradeCurrency {
  if (t.currency === 'SAR' || t.currency === 'USD') return t.currency;
  const aid = resolveInvestmentTransactionAccountId(t, accounts, investments);
  if (!aid) return 'SAR';
  const accPortfolios = investments.filter((p) => {
    const portfolioAccount = resolveCanonicalAccountId(
      ((p as { account_id?: string }).account_id ?? p.accountId ?? '').trim(),
      accounts,
    );
    return portfolioAccount === aid;
  });
  const curs = new Set((accPortfolios.length ? accPortfolios : []).map((p) => (p.currency as TradeCurrency) || 'USD'));
  if (curs.size === 1) {
    const one = [...curs][0];
    if (one === 'SAR' || one === 'USD') return one;
  }
  return 'SAR';
}
