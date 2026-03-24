/**
 * Pure metrics for Investments → platform card (capital flows, value, P&L).
 * Keeps UI and tests aligned with a single implementation.
 */

import type { Account, Holding, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { tradableCashBucketToSAR } from '../utils/currencyMath';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import { inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';

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
      const priceInfo = holdingUsesLiveQuote(h) ? simulatedPrices[symbol] : undefined;
      if (priceInfo && Number.isFinite(priceInfo.price) && (h.quantity ?? 0) > 0) {
        const live = priceInfo.price * (h.quantity || 0);
        if (Number.isFinite(live) && live > 0) {
          if (cur === 'SAR') valueSarFromSim += live;
          else valueUsdFromSim += live;
          return;
        }
      }
      const fallback = Number.isFinite(h.currentValue) ? (h.currentValue as number) : 0;
      if (!Number.isFinite(fallback) || fallback <= 0) return;
      if (cur === 'SAR') valueSarFromStored += fallback;
      else valueUsdFromStored += fallback;
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
    .filter((t) => t.type === 'deposit')
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      if (c === 'SAR') invSAR += t.total ?? 0;
      else invUSD += t.total ?? 0;
    });
  transactions
    .filter((t) => t.type === 'withdrawal')
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

  let dailySar = 0;
  let dailyUsd = 0;
  portfolios.forEach((p) => {
    const cur = ((p.currency as TradeCurrency) || 'USD') as TradeCurrency;
    (p.holdings || []).forEach((h: Holding) => {
      const symbol = (h.symbol || '').trim().toUpperCase();
      const info = holdingUsesLiveQuote(h) ? simulatedPrices[symbol] : undefined;
      if (!info || !Number.isFinite(info.change) || (h.quantity ?? 0) <= 0) return;
      const d = (info.change as number) * (h.quantity || 0);
      if (cur === 'SAR') dailySar += d;
      else dailyUsd += d;
    });
  });
  const dailyPnL =
    platformCurrency === 'SAR'
      ? dailySar + dailyUsd * rate
      : platformCurrency === 'USD'
        ? dailyUsd + dailySar / rate
        : dailySar + dailyUsd * rate;

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
  };
}
