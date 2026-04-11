import type { Account, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { deltaForInvestmentTrade } from './investmentBalanceDelta';
import { inferInvestmentTransactionCurrency, resolveCanonicalAccountId, resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

export function computeAvailableCashByAccountMap(args: {
  accounts: Account[];
  investments: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
}): Record<string, { SAR: number; USD: number }> {
  const { accounts, investments, investmentTransactions } = args;
  const map: Record<string, { SAR: number; USD: number }> = {};
  const txCountByAccount: Record<string, number> = {};

  accounts.forEach((acc) => {
    if (acc.type !== 'Investment') return;
    const accId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!accId) return;
    if (!(accId in map)) map[accId] = { SAR: 0, USD: 0 };
    txCountByAccount[accId] = 0;
  });

  investmentTransactions.forEach((t) => {
    const rawAccountId = resolveInvestmentTransactionAccountId(
      t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
      accounts,
      investments,
    );
    const accId = resolveCanonicalAccountId(rawAccountId, accounts) ?? rawAccountId;
    if (!accId || !(accId in map)) return;
    const amount = getInvestmentTransactionCashAmount(t as any);
    if (!(amount > 0)) return;
    const signed = deltaForInvestmentTrade(String(t.type ?? ''), amount);
    if (!Number.isFinite(signed) || signed === 0) return;
    const cur = inferInvestmentTransactionCurrency(t, accounts, investments);
    map[accId][cur === 'USD' ? 'USD' : 'SAR'] += signed;
    txCountByAccount[accId] = (txCountByAccount[accId] ?? 0) + 1;
  });

  accounts.forEach((acc) => {
    if (acc.type !== 'Investment') return;
    const accId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!accId || !(accId in map)) return;
    if ((txCountByAccount[accId] ?? 0) > 0) return;
    const openingBalance = Number(acc.balance ?? 0);
    if (!Number.isFinite(openingBalance) || openingBalance === 0) return;
    const baseCur: TradeCurrency = acc.currency === 'USD' ? 'USD' : 'SAR';
    map[accId][baseCur] += openingBalance;
  });

  return map;
}
