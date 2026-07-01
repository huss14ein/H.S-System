import type { FinancialData, Liability } from '../types';
import {
  DEFAULT_SAR_PER_USD,
  getAllInvestmentsValueInSAR,
  resolveSarPerUsd,
  toSAR,
  totalLiquidCashSARFromAccounts,
  tradableCashBucketToSAR,
} from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries } from './fxDailySeries';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';
import {
  computePersonalCommoditiesContributionSAR,
  computePersonalPlatformsRollupSAR,
  type SimulatedPriceMap,
} from './investmentPlatformCardMetrics';
import {
  getPersonalAccounts,
  getPersonalAssets,
  getPersonalInvestments,
  getPersonalLiabilities,
  getPersonalTransactions,
} from '../utils/wealthScope';
import { getCreditCardLinkedAccountIds } from './creditCardLinking';

export type LiquidNetWorthOptions = {
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  /** CurrencyContext UI rate (not pre-resolved); hydrated then resolved like headline NW. */
  exchangeRate?: number;
  /** Live quotes — aligns portfolio holdings with Investments hub / headline NW. */
  simulatedPrices?: SimulatedPriceMap;
};

/** Cash-like + investments + commodities + receivables − debt (simplified liquid picture). */
export function computeLiquidNetWorth(
  data: FinancialData | null | undefined,
  options?: LiquidNetWorthOptions
): {
  liquidCash: number;
  /** Brokerage / portfolio holdings only (excludes direct Sukuk positions). */
  portfolioHoldingsSar: number;
  /** Direct Sukuk contracts from sukuk_positions (SAR). */
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
  /** Property & other physical rows under Assets; not part of liquid total — for context only. */
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
  const rawUi = options?.exchangeRate;
  const uiExchangeRate = Number(rawUi) > 0 ? Number(rawUi) : DEFAULT_SAR_PER_USD;
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const fx = resolveSarPerUsd(data, uiExchangeRate);
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

  const sukukSar = sumPersonalSukukPositionsSar(data);
  let portfolioHoldingsSar: number;
  let commodities: number;
  if (options?.getAvailableCashForAccount) {
    const prices = options.simulatedPrices ?? {};
    const getCash = options.getAvailableCashForAccount;
    const platform = computePersonalPlatformsRollupSAR(data, fx, prices, getCash);
    const invAccounts = accounts.filter((a: { type?: string }) => a.type === 'Investment');
    let platformCashSar = 0;
    for (const acc of invAccounts) {
      platformCashSar += tradableCashBucketToSAR(getCash(String((acc as { id?: string }).id ?? '')), fx);
    }
    portfolioHoldingsSar = Math.max(0, platform.subtotalSAR - platformCashSar);
    commodities = computePersonalCommoditiesContributionSAR(data, fx, prices).valueSAR;
  } else {
    /** Platform holdings only — commodities valued separately; Sukuk added in `investmentsSAR`. */
    const prices = options?.simulatedPrices ?? {};
    portfolioHoldingsSar = Math.max(
      0,
      getAllInvestmentsValueInSAR(getPersonalInvestments(data), fx),
    );
    commodities = computePersonalCommoditiesContributionSAR(data, fx, prices).valueSAR;
  }
  const investmentsSAR = portfolioHoldingsSar + sukukSar;
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
  const linkedCc = getCreditCardLinkedAccountIds(liab as Liability[]);
  for (const a of accounts) {
    const id = String((a as { id?: string }).id ?? '');
    if (
      (a as { type?: string }).type === 'Credit' &&
      (Number((a as { balance?: number }).balance) || 0) < 0 &&
      !linkedCc.has(id)
    ) {
      const bal = Math.abs(Number((a as { balance?: number }).balance) || 0);
      const cur = (a as { currency?: string }).currency === 'USD' ? 'USD' : 'SAR';
      creditCardDebtSar += toSAR(bal, cur, fx);
    }
  }

  const shortTermDebt = creditCardDebtSar + loanAndMortgageDebtSar;

  const rawAssets = getPersonalAssets(data);
  let illiquidPhysicalAssetsSar = 0;
  for (const a of rawAssets) {
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
