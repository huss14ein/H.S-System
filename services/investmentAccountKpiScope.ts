import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  inferInvestmentTransactionCurrency,
  portfolioBelongsToAccount,
  resolveInvestmentTransactionAccountId,
} from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';

export type InvestmentAccountKpiScope = {
  accountId: string;
  personalPortfolios: InvestmentPortfolio[];
  allPortfoliosOnAccount: InvestmentPortfolio[];
  hasMixedOwnership: boolean;
  transactionsForMetrics: InvestmentTransaction[];
  availableCashByCurrency: { SAR: number; USD: number };
};

/** Ledger-derived tradable cash from a scoped transaction list (mixed-ownership platforms). */
export function deriveLedgerCashBucketsFromInvestmentTransactions(args: {
  transactions: InvestmentTransaction[];
  accounts: Account[];
  allInvestments: InvestmentPortfolio[];
}): { SAR: number; USD: number } {
  let sar = 0;
  let usd = 0;
  for (const t of args.transactions) {
    const cur = inferInvestmentTransactionCurrency(t, args.accounts, args.allInvestments);
    const amt = getInvestmentTransactionCashAmount(t as InvestmentTransaction);
    if (!Number.isFinite(amt) || !(amt > 0)) continue;
    const type = String(t.type ?? '').toLowerCase();
    const delta =
      type === 'deposit' || type === 'sell' || type === 'dividend'
        ? amt
        : type === 'withdrawal' || type === 'buy'
          ? -amt
          : 0;
    if (cur === 'SAR') sar += delta;
    else usd += delta;
  }
  return { SAR: Math.max(0, sar), USD: Math.max(0, usd) };
}

export function scopeInvestmentTransactionsForPersonalAccount(args: {
  account: Account;
  personalPortfolios: InvestmentPortfolio[];
  allInvestments: InvestmentPortfolio[];
  accounts: Account[];
  accountTransactions: InvestmentTransaction[];
}): Pick<InvestmentAccountKpiScope, 'hasMixedOwnership' | 'transactionsForMetrics' | 'allPortfoliosOnAccount'> {
  const allPortfoliosOnAccount = args.allInvestments.filter((p) =>
    portfolioBelongsToAccount(p, args.account, args.accounts),
  );
  const hasMixedOwnership = allPortfoliosOnAccount.length > args.personalPortfolios.length;
  const personalPortfolioIds = new Set(args.personalPortfolios.map((p) => p.id).filter(Boolean));
  const canSafelyIncludeUnassignedFlows = hasMixedOwnership && personalPortfolioIds.size === 1;
  const transactionsForMetrics = hasMixedOwnership
    ? args.accountTransactions.filter((t) => {
        const pid = (t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
        if (pid) return personalPortfolioIds.has(pid);
        return canSafelyIncludeUnassignedFlows;
      })
    : args.accountTransactions;
  return { allPortfoliosOnAccount, hasMixedOwnership, transactionsForMetrics };
}

export function buildInvestmentAccountKpiScope(args: {
  account: Account;
  personalPortfolios: InvestmentPortfolio[];
  data: FinancialData;
  accountTransactions: InvestmentTransaction[];
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
}): InvestmentAccountKpiScope {
  const accounts = args.data.accounts ?? [];
  const allInvestments = args.data.investments ?? [];
  const scoped = scopeInvestmentTransactionsForPersonalAccount({
    account: args.account,
    personalPortfolios: args.personalPortfolios,
    allInvestments,
    accounts,
    accountTransactions: args.accountTransactions,
  });
  const availableCashByCurrency = scoped.hasMixedOwnership
    ? deriveLedgerCashBucketsFromInvestmentTransactions({
        transactions: scoped.transactionsForMetrics,
        accounts,
        allInvestments,
      })
    : {
        SAR: Math.max(0, args.getAvailableCashForAccount?.(args.account.id)?.SAR ?? 0),
        USD: Math.max(0, args.getAvailableCashForAccount?.(args.account.id)?.USD ?? 0),
      };
  return {
    accountId: args.account.id,
    personalPortfolios: args.personalPortfolios,
    allPortfoliosOnAccount: scoped.allPortfoliosOnAccount,
    hasMixedOwnership: scoped.hasMixedOwnership,
    transactionsForMetrics: scoped.transactionsForMetrics,
    availableCashByCurrency,
  };
}

export function listInvestmentTransactionsForAccount(
  data: FinancialData,
  account: Account,
  accounts: Account[],
  allInvestments: InvestmentPortfolio[],
): InvestmentTransaction[] {
  const personalTx = getPersonalInvestmentTransactionsForKpis(data);
  return personalTx.filter(
    (t) => resolveInvestmentTransactionAccountId(t, accounts, allInvestments) === account.id,
  );
}
