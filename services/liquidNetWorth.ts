import type { FinancialData } from '../types';
import { tradableCashBucketToSAR } from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import {
  getPersonalAccounts,
  getPersonalInvestments,
  getPersonalCommodityHoldings,
  getPersonalLiabilities,
  getPersonalTransactions,
} from '../utils/wealthScope';

export type LiquidNetWorthOptions = {
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  /** SAR per USD — required together with `getAvailableCashForAccount` to convert broker cash buckets. */
  exchangeRate?: number;
};

/** Cash-like + investments + commodities + receivables − debt (simplified liquid picture). */
export function computeLiquidNetWorth(
  data: FinancialData | null | undefined,
  options?: LiquidNetWorthOptions
): {
  liquidCash: number;
  investmentsSAR: number;
  commodities: number;
  receivables: number;
  shortTermDebt: number;
  liquidNetWorth: number;
  contributionEstimate30d: number;
  marketMoveEstimate30d: number;
} {
  if (!data) {
    return {
      liquidCash: 0,
      investmentsSAR: 0,
      commodities: 0,
      receivables: 0,
      shortTermDebt: 0,
      liquidNetWorth: 0,
      contributionEstimate30d: 0,
      marketMoveEstimate30d: 0,
    };
  }
  const accounts = getPersonalAccounts(data);
  let liquidCash = accounts
    .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
    .reduce((s: number, a: { balance?: number }) => s + Math.max(0, Number(a.balance) || 0), 0);
  if (options?.getAvailableCashForAccount && options.exchangeRate != null) {
    const fx = options.exchangeRate;
    const getCash = options.getAvailableCashForAccount;
    accounts
      .filter((a: { type?: string }) => a.type === 'Investment')
      .forEach((a: { id: string }) => {
        liquidCash += tradableCashBucketToSAR(getCash(a.id), fx);
      });
  }
  const inv = getPersonalInvestments(data);
  let investmentsSAR = 0;
  inv.forEach((p: { holdings?: { currentValue?: number }[] }) => {
    (p.holdings ?? []).forEach((h: { currentValue?: number }) => {
      investmentsSAR += Number(h.currentValue) || 0;
    });
  });
  const comm = getPersonalCommodityHoldings(data);
  const commodities = comm.reduce((s: number, c: { currentValue?: number }) => s + (Number(c.currentValue) || 0), 0);
  const liab = getPersonalLiabilities(data);
  const receivables = liab.filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);
  const shortTermDebt =
    liab.filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((s: number, l: { amount?: number }) => s + Math.abs(l.amount ?? 0), 0) +
    accounts
      .filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0)
      .reduce((s: number, a: { balance?: number }) => s + Math.abs(a.balance ?? 0), 0);
  const liquidNetWorth = liquidCash + investmentsSAR + commodities + receivables - shortTermDebt;

  const txs = getPersonalTransactions(data);
  const now = new Date();
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  let contributionEstimate30d = 0;
  txs.forEach((t: { date: string; type?: string; category?: string; amount?: number }) => {
    if (new Date(t.date) < d30) return;
    const amt = Number(t.amount) || 0;
    if (countsAsIncomeForCashflowKpi(t)) contributionEstimate30d += amt;
    if (countsAsExpenseForCashflowKpi(t)) contributionEstimate30d -= Math.abs(amt);
  });
  const marketMoveEstimate30d = Math.max(0, contributionEstimate30d) * 0.02;

  return {
    liquidCash,
    investmentsSAR,
    commodities,
    receivables,
    shortTermDebt,
    liquidNetWorth,
    contributionEstimate30d,
    marketMoveEstimate30d,
  };
}
