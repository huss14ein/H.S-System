import type { FinancialData } from '../types';
import {
  resolveSarPerUsd,
  toSAR,
  totalLiquidCashSARFromAccounts,
  getAllInvestmentsValueInSAR,
} from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { sumPersonalSukukAssetsSar } from './personalNetWorth';
import {
  getPersonalAccounts,
  getPersonalAssets,
  getPersonalInvestments,
  getPersonalCommodityHoldings,
  getPersonalLiabilities,
  getPersonalTransactions,
} from '../utils/wealthScope';

export type LiquidNetWorthOptions = {
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  /** SAR per USD — used for cross-currency normalization (USD→SAR). */
  exchangeRate?: number;
};

/** Cash-like + investments + commodities + receivables − debt (simplified liquid picture). */
export function computeLiquidNetWorth(
  data: FinancialData | null | undefined,
  options?: LiquidNetWorthOptions
): {
  liquidCash: number;
  /** Brokerage / portfolio holdings only (excludes Sukuk recorded under Assets). */
  portfolioHoldingsSar: number;
  /** Sukuk rows under Assets (SAR), same bucket as Investments on Dashboard. */
  sukukSar: number;
  /** portfolioHoldingsSar + sukukSar — total “investment exposure” in liquid picture. */
  investmentsSAR: number;
  commodities: number;
  receivables: number;
  /** Credit-card balances (accounts + liability rows typed Credit Card), SAR. */
  creditCardDebtSar: number;
  /** Mortgages, loans, personal loans (liability rows), SAR — excludes credit cards. */
  loanAndMortgageDebtSar: number;
  shortTermDebt: number;
  liquidNetWorth: number;
  /** Property & other physical rows under Assets (excludes Sukuk); not part of liquid total — for context only. */
  illiquidPhysicalAssetsSar: number;
  contributionEstimate30d: number;
  marketMoveEstimate30d: number;
} {
  if (!data) {
    return {
      liquidCash: 0,
      portfolioHoldingsSar: 0,
      sukukSar: 0,
      investmentsSAR: 0,
      commodities: 0,
      receivables: 0,
      creditCardDebtSar: 0,
      loanAndMortgageDebtSar: 0,
      shortTermDebt: 0,
      liquidNetWorth: 0,
      illiquidPhysicalAssetsSar: 0,
      contributionEstimate30d: 0,
      marketMoveEstimate30d: 0,
    };
  }
  const fx = resolveSarPerUsd(data as { wealthUltraConfig?: { fxRate?: number | null } | null }, options?.exchangeRate);
  const accounts = getPersonalAccounts(data);
  const liquidCash = options?.getAvailableCashForAccount
    ? totalLiquidCashSARFromAccounts(accounts as { id: string; type?: string; balance?: number; currency?: 'USD' | 'SAR' }[], options.getAvailableCashForAccount, fx)
    : accounts
        .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
        .reduce((sum: number, a: { balance?: number; currency?: 'USD' | 'SAR' }) => {
          const bal = Math.max(0, Number(a.balance) || 0);
          const cur = a.currency === 'USD' ? 'USD' : 'SAR';
          return sum + toSAR(bal, cur, fx);
        }, 0);

  const inv = getPersonalInvestments(data);
  const portfolioHoldingsSar = getAllInvestmentsValueInSAR(inv as any, fx);
  const sukukSar = sumPersonalSukukAssetsSar(data);
  const investmentsSAR = portfolioHoldingsSar + sukukSar;
  const comm = getPersonalCommodityHoldings(data);
  const commodities = comm.reduce((s: number, c: { currentValue?: number }) => s + (Number(c.currentValue) || 0), 0);
  const liab = getPersonalLiabilities(data);
  const receivables = liab.filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);

  let creditCardDebtSar = 0;
  let loanAndMortgageDebtSar = 0;
  for (const l of liab) {
    const amt = Number((l as { amount?: number }).amount) || 0;
    if (amt >= 0) continue;
    const absAmt = Math.abs(amt);
    if ((l as { type?: string }).type === 'Credit Card') creditCardDebtSar += absAmt;
    else loanAndMortgageDebtSar += absAmt;
  }
  for (const a of accounts) {
    if ((a as { type?: string }).type === 'Credit' && (Number((a as { balance?: number }).balance) || 0) < 0) {
      const bal = Math.abs(Number((a as { balance?: number }).balance) || 0);
      const cur = (a as { currency?: string }).currency === 'USD' ? 'USD' : 'SAR';
      creditCardDebtSar += toSAR(bal, cur, fx);
    }
  }

  const shortTermDebt = creditCardDebtSar + loanAndMortgageDebtSar;

  const rawAssets = getPersonalAssets(data);
  let illiquidPhysicalAssetsSar = 0;
  for (const a of rawAssets) {
    if ((a as { type?: string }).type === 'Sukuk') continue;
    illiquidPhysicalAssetsSar += Math.max(0, Number((a as { value?: number }).value) || 0);
  }
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
    portfolioHoldingsSar,
    sukukSar,
    investmentsSAR,
    commodities,
    receivables,
    creditCardDebtSar,
    loanAndMortgageDebtSar,
    shortTermDebt,
    liquidNetWorth,
    illiquidPhysicalAssetsSar,
    contributionEstimate30d,
    marketMoveEstimate30d,
  };
}
