/**
 * Pure metrics for Investments → platform card (capital flows, value, P&L).
 * Keeps UI and tests aligned with a single implementation.
 */

import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { quoteDailyPnLInBookCurrency, quoteNotionalInBookCurrency, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import {
  inferInvestmentTransactionCurrency,
  portfolioBelongsToAccount,
  resolveCanonicalAccountId,
} from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import {
  getPersonalAccounts,
  getPersonalCommodityHoldings,
  getPersonalInvestments,
} from '../utils/wealthScope';

export type SimulatedPriceMap = Record<string, { price: number; change?: number; changePercent?: number }>;

export interface PlatformCardMetrics {
  totalValue: number;
  totalValueInSAR: number;
  totalGainLoss: number;
  dailyPnL: number;
  totalInvested: number;
  totalWithdrawn: number;
  roi: number;
  totalAvailable: number;
  /** Same P&L as `totalGainLoss` but always in SAR (for consistent headers across USD/SAR platforms). */
  totalGainLossSAR: number;
  dailyPnLSAR: number;
  totalInvestedSAR: number;
  totalWithdrawnSAR: number;
  netCapitalSAR: number;
}

export interface ComputePlatformCardMetricsArgs {
  portfolios: InvestmentPortfolio[];
  transactions: InvestmentTransaction[];
  accounts: Account[];
  allInvestments: InvestmentPortfolio[];
  sarPerUsd: number;
  availableCashByCurrency: { SAR: number; USD: number };
  simulatedPrices: SimulatedPriceMap;
  /** Single portfolio currency, or undefined when mixed / unknown (same fallbacks as PlatformCard). */
  platformCurrency: TradeCurrency | undefined;
}

/**
 * Mirrors `PlatformCard` useMemo (Investments.tsx): deposits/withdrawals → invested & withdrawn;
 * holdings (sim or stored) + tradable cash → value; P&L = value − (invested − withdrawn).
 */
export function computePlatformCardMetrics(args: ComputePlatformCardMetricsArgs): PlatformCardMetrics {
  const {
    portfolios,
    transactions,
    accounts: accList,
    allInvestments: invList,
    sarPerUsd: rate,
    availableCashByCurrency,
    simulatedPrices,
    platformCurrency,
  } = args;

  let valueSarFromSim = 0;
  let valueUsdFromSim = 0;
  let valueSarFromStored = 0;
  let valueUsdFromStored = 0;

  portfolios.forEach((p) => {
    const cur = ((p.currency as TradeCurrency) || 'USD') as TradeCurrency;
    (p.holdings || []).forEach((h: Holding) => {
      const symbol = (h.symbol || '').trim().toUpperCase();
      const qty = Number(h.quantity ?? 0);
      const avgCost = Number(h.avgCost ?? 0);
      const costBasis = Number.isFinite(avgCost) && Number.isFinite(qty) ? avgCost * qty : 0;
      const priceInfo = holdingUsesLiveQuote(h) ? simulatedPrices[symbol] : undefined;
      if (priceInfo && Number.isFinite(priceInfo.price) && qty > 0) {
        const liveInBook = quoteNotionalInBookCurrency(priceInfo.price, qty, symbol, cur, rate);
        if (Number.isFinite(liveInBook) && liveInBook > 0) {
          if (cur === 'SAR') valueSarFromSim += liveInBook;
          else valueUsdFromSim += liveInBook;
          return;
        }
      }
      const stored = Number.isFinite(h.currentValue) ? (h.currentValue as number) : 0;
      const effective = stored > 0 ? stored : costBasis > 0 ? costBasis : 0;
      if (!Number.isFinite(effective) || effective <= 0) return;
      if (cur === 'SAR') valueSarFromStored += effective;
      else valueUsdFromStored += effective;
    });
  });

  const cashInSar = tradableCashBucketToSAR(
    { SAR: availableCashByCurrency.SAR ?? 0, USD: availableCashByCurrency.USD ?? 0 },
    rate,
  );
  const totalValueInSAR = valueSarFromSim + valueSarFromStored + (valueUsdFromStored + valueUsdFromSim) * rate + cashInSar;
  const totalValue =
    platformCurrency === 'SAR'
      ? totalValueInSAR
      : platformCurrency === 'USD'
        ? totalValueInSAR / rate
        : totalValueInSAR;

  let invSAR = 0;
  let invUSD = 0;
  let wdrSAR = 0;
  let wdrUSD = 0;
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'deposit'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      if (c === 'SAR') invSAR += t.total ?? 0;
      else invUSD += t.total ?? 0;
    });
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'withdrawal'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      if (c === 'SAR') wdrSAR += t.total ?? 0;
      else wdrUSD += t.total ?? 0;
    });

  const totalInvested =
    platformCurrency === 'SAR'
      ? invSAR + invUSD * rate
      : platformCurrency === 'USD'
        ? invUSD + invSAR / rate
        : invSAR + invUSD * rate;
  const totalWithdrawn =
    platformCurrency === 'SAR'
      ? wdrSAR + wdrUSD * rate
      : platformCurrency === 'USD'
        ? wdrUSD + wdrSAR / rate
        : wdrSAR + wdrUSD * rate;

  const netCapital = totalInvested - totalWithdrawn;
  const totalGainLoss = totalValue - netCapital;
  const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;

  const totalInvestedSAR = invSAR + invUSD * rate;
  const totalWithdrawnSAR = wdrSAR + wdrUSD * rate;
  const netCapitalSAR = totalInvestedSAR - totalWithdrawnSAR;
  const totalGainLossSAR = totalValueInSAR - netCapitalSAR;

  let dailySar = 0;
  let dailyUsd = 0;
  portfolios.forEach((p) => {
    const cur = ((p.currency as TradeCurrency) || 'USD') as TradeCurrency;
    (p.holdings || []).forEach((h: Holding) => {
      const symbol = (h.symbol || '').trim().toUpperCase();
      const info = holdingUsesLiveQuote(h) ? simulatedPrices[symbol] : undefined;
      if (!info || !Number.isFinite(info.change) || (h.quantity ?? 0) <= 0) return;
      const d = quoteDailyPnLInBookCurrency(info.change as number, h.quantity || 0, symbol, cur, rate);
      if (cur === 'SAR') dailySar += d;
      else dailyUsd += d;
    });
  });
  const dailyPnLSAR = dailySar + dailyUsd * rate;
  const dailyPnL =
    platformCurrency === 'SAR'
      ? dailyPnLSAR
      : platformCurrency === 'USD'
        ? dailyUsd + dailySar / rate
        : dailyPnLSAR;

  const cashSAR = availableCashByCurrency.SAR ?? 0;
  const cashUSD = availableCashByCurrency.USD ?? 0;
  const totalAvailable =
    platformCurrency === 'SAR'
      ? cashSAR + cashUSD * rate
      : platformCurrency === 'USD'
        ? cashUSD + cashSAR / rate
        : cashSAR + cashUSD * rate;

  return {
    totalValue,
    totalValueInSAR,
    totalGainLoss,
    dailyPnL,
    totalInvested,
    totalWithdrawn,
    roi,
    totalAvailable,
    totalGainLossSAR,
    dailyPnLSAR,
    totalInvestedSAR,
    totalWithdrawnSAR,
    netCapitalSAR,
  };
}

/** One investment platform row: personal portfolios on that account + ledger + cash (same rules as PlatformCard). */
export function computePersonalPlatformCardRow(
  account: Account,
  data: FinancialData,
  options: {
    sarPerUsd: number;
    simulatedPrices: SimulatedPriceMap;
    getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  },
): PlatformCardMetrics {
  const accounts = data.accounts ?? [];
  const personalPorts = getPersonalInvestments(data);
  const portfoliosOnAccount = personalPorts.filter((p) => portfolioBelongsToAccount(p, account, accounts));
  const txRaw = data.investmentTransactions ?? [];
  const transactions = txRaw
    .filter((t) => {
      const raw = t.accountId ?? (t as { account_id?: string }).account_id ?? '';
      const canon = resolveCanonicalAccountId(raw, accounts);
      return canon === account.id || raw === account.id;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currencies = [...new Set(portfoliosOnAccount.map((p) => (p.currency || 'USD') as TradeCurrency))];
  const platformCurrency = currencies.length === 1 ? currencies[0] : undefined;
  return computePlatformCardMetrics({
    portfolios: portfoliosOnAccount,
    transactions,
    accounts,
    allInvestments: personalPorts,
    sarPerUsd: options.sarPerUsd,
    availableCashByCurrency: options.getAvailableCashForAccount(account.id),
    simulatedPrices: options.simulatedPrices,
    platformCurrency,
  });
}

export function computePersonalCommoditiesContributionSAR(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
): { valueSAR: number; dailyDeltaSAR: number } {
  const commodities = getPersonalCommodityHoldings(data);
  let valueSAR = 0;
  let dailyDeltaSAR = 0;
  for (const ch of commodities) {
    const sym = (ch.symbol || '').trim().toUpperCase();
    const px = simulatedPrices[sym];
    const raw =
      px && Number.isFinite(px.price) ? px.price * (ch.quantity ?? 0) : (ch.currentValue ?? 0);
    valueSAR += toSAR(raw, 'USD', sarPerUsd);
    const chg =
      px && px.change != null && Number.isFinite(px.change) ? px.change * (ch.quantity ?? 0) : 0;
    dailyDeltaSAR += toSAR(chg, 'USD', sarPerUsd);
  }
  return { valueSAR, dailyDeltaSAR };
}

/** Sum of all personal investment platforms (holdings + tradable cash per platform). Excludes commodities. */
export function computePersonalPlatformsRollupSAR(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
): { subtotalSAR: number; dailyPnLSAR: number } {
  const invAccounts = getPersonalAccounts(data).filter((a) => a.type === 'Investment');
  let subtotalSAR = 0;
  let dailyPnLSAR = 0;
  for (const account of invAccounts) {
    const m = computePersonalPlatformCardRow(account, data, {
      sarPerUsd,
      simulatedPrices,
      getAvailableCashForAccount,
    });
    subtotalSAR += m.totalValueInSAR;
    dailyPnLSAR += m.dailyPnLSAR;
  }
  return { subtotalSAR, dailyPnLSAR };
}
