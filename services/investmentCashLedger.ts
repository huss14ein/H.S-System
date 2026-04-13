import type { Account, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { deltaForInvestmentTrade } from './investmentBalanceDelta';
import { inferInvestmentTransactionCurrency, resolveCanonicalAccountId, resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

export function computeAvailableCashByAccountMap(args: {
  accounts: Account[];
  investments: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
  sarPerUsd?: number;
}): Record<string, { SAR: number; USD: number }> {
  const { accounts, investments, investmentTransactions } = args;
  const sarPerUsd = Number(args.sarPerUsd);
  const fx = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;
  const map: Record<string, { SAR: number; USD: number }> = {};
  const txCountByAccount: Record<string, number> = {};

  accounts.forEach((acc) => {
    if (acc.type !== 'Investment') return;
    const accId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    if (!accId) return;
    if (!(accId in map)) map[accId] = { SAR: 0, USD: 0 };
    txCountByAccount[accId] = 0;
  });

  const orderedTransactions = [...investmentTransactions]
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => {
      const ta = Date.parse(String((a.t as any).created_at ?? (a.t as any).createdAt ?? a.t.date ?? ''));
      const tb = Date.parse(String((b.t as any).created_at ?? (b.t as any).createdAt ?? b.t.date ?? ''));
      const va = Number.isFinite(ta) ? ta : 0;
      const vb = Number.isFinite(tb) ? tb : 0;
      if (va !== vb) return va - vb;
      // Preserve caller order for exact timestamp ties.
      return a.idx - b.idx;
    })
    .map((x) => x.t);

  orderedTransactions.forEach((t) => {
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
    const bucket = map[accId];
    if (cur === 'USD') {
      if (signed >= 0) {
        bucket.USD += signed;
      } else {
        let spendUsd = -signed;
        const usdUsed = Math.min(bucket.USD, spendUsd);
        bucket.USD -= usdUsed;
        spendUsd -= usdUsed;
        if (spendUsd > 0) {
          const sarNeeded = spendUsd * fx;
          const sarUsed = Math.min(bucket.SAR, sarNeeded);
          bucket.SAR -= sarUsed;
          spendUsd -= sarUsed / fx;
        }
        if (spendUsd > 0) bucket.USD -= spendUsd;
      }
    } else {
      if (signed >= 0) {
        bucket.SAR += signed;
      } else {
        let spendSar = -signed;
        const sarUsed = Math.min(bucket.SAR, spendSar);
        bucket.SAR -= sarUsed;
        spendSar -= sarUsed;
        if (spendSar > 0) {
          const usdNeeded = spendSar / fx;
          const usdUsed = Math.min(bucket.USD, usdNeeded);
          bucket.USD -= usdUsed;
          spendSar -= usdUsed * fx;
        }
        if (spendSar > 0) bucket.SAR -= spendSar;
      }
    }
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
