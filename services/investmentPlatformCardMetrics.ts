/**
 * Pure metrics for Investments → platform card (capital flows, value, P&L).
 * Keeps UI and tests aligned with a single implementation.
 */

import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { quoteDailyPnLInBookCurrency, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency, holdingUsesLiveQuote } from '../utils/holdingValuation';
import { lookupLiveQuoteForSymbol } from '../services/finnhubService';
import {
  inferInvestmentTransactionCurrency,
  portfolioBelongsToAccount,
  resolveInvestmentTransactionAccountId,
  resolveCanonicalAccountId,
} from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import {
  getPersonalAccounts,
  getPersonalCommodityHoldings,
  getPersonalInvestments,
} from '../utils/wealthScope';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

export type SimulatedPriceMap = Record<string, { price: number; change?: number; changePercent?: number }>;

export interface PlatformCardMetrics {
  totalValue: number;
  totalValueInSAR: number;
  /** Holdings / positions only — excludes broker cash (tradable cash bucket). Same FX basis as total value. */
  holdingsValue: number;
  holdingsValueInSAR: number;
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

export interface PlatformMetricValidationResult {
  ok: boolean;
  issues: string[];
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

  /** One implementation for position market value: {@link effectiveHoldingValueInBookCurrency} (same as holdings table / Overview). */
  let holdingsValueInSAR = 0;
  portfolios.forEach((p) => {
    const cur = resolveInvestmentPortfolioCurrency(p);
    (p.holdings || []).forEach((h: Holding) => {
      const v = effectiveHoldingValueInBookCurrency(h, cur, simulatedPrices, rate);
      if (!Number.isFinite(v) || v <= 0) return;
      holdingsValueInSAR += toSAR(v, cur, rate);
    });
  });

  const cashInSar = tradableCashBucketToSAR(
    { SAR: availableCashByCurrency.SAR ?? 0, USD: availableCashByCurrency.USD ?? 0 },
    rate,
  );
  const totalValueInSAR = holdingsValueInSAR + cashInSar;
  const holdingsValue =
    platformCurrency === 'SAR'
      ? holdingsValueInSAR
      : platformCurrency === 'USD'
        ? holdingsValueInSAR / rate
        : holdingsValueInSAR;
  const totalValue =
    platformCurrency === 'SAR'
      ? totalValueInSAR
      : platformCurrency === 'USD'
        ? totalValueInSAR / rate
        : totalValueInSAR;
  const holdingsCostBasisSAR = portfolios.reduce((sum, p) => {
    const cur = resolveInvestmentPortfolioCurrency(p);
    const cost = (p.holdings || []).reduce((s: number, h: Holding) => {
      const qty = Number(h.quantity ?? 0);
      const avg = Number(h.avgCost ?? 0);
      if (!(qty > 0) || !(avg > 0)) return s;
      return s + (qty * avg);
    }, 0);
    return sum + toSAR(cost, cur, rate);
  }, 0);

  let invSAR = 0;
  let invUSD = 0;
  let wdrSAR = 0;
  let wdrUSD = 0;
  let buySAR = 0;
  let buyUSD = 0;
  let sellSAR = 0;
  let sellUSD = 0;
  let divSAR = 0;
  let divUSD = 0;
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'deposit'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') invSAR += amt;
      else invUSD += amt;
    });
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'withdrawal'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') wdrSAR += amt;
      else wdrUSD += amt;
    });
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'buy'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') buySAR += amt;
      else buyUSD += amt;
    });
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'sell'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') sellSAR += amt;
      else sellUSD += amt;
    });
  transactions
    .filter((t) => isInvestmentTransactionType(t.type, 'dividend'))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') divSAR += amt;
      else divUSD += amt;
    });

  const totalInvestedSARRaw = invSAR + invUSD * rate;
  const totalWithdrawn =
    platformCurrency === 'SAR'
      ? wdrSAR + wdrUSD * rate
      : platformCurrency === 'USD'
        ? wdrUSD + wdrSAR / rate
        : wdrSAR + wdrUSD * rate;

  const inferredInvestedFromLedgerSAR = Math.max(
    0,
    (buySAR + buyUSD * rate) - (sellSAR + sellUSD * rate) - (divSAR + divUSD * rate) + cashInSar + (wdrSAR + wdrUSD * rate),
  );
  const totalInvestedSAR =
    totalInvestedSARRaw > 0
      ? totalInvestedSARRaw
      : inferredInvestedFromLedgerSAR > 0
        ? inferredInvestedFromLedgerSAR
        : Math.max(0, holdingsCostBasisSAR + cashInSar + (wdrSAR + wdrUSD * rate));
  const netCapitalSAR = Math.max(0, totalInvestedSAR - (wdrSAR + wdrUSD * rate));
  const totalGainLossSAR = totalValueInSAR - netCapitalSAR;
  const netCapital =
    platformCurrency === 'SAR'
      ? netCapitalSAR
      : platformCurrency === 'USD'
        ? netCapitalSAR / rate
        : netCapitalSAR;
  const totalGainLoss =
    platformCurrency === 'SAR'
      ? totalGainLossSAR
      : platformCurrency === 'USD'
        ? totalGainLossSAR / rate
        : totalGainLossSAR;
  const totalInvested =
    platformCurrency === 'SAR'
      ? totalInvestedSAR
      : platformCurrency === 'USD'
        ? totalInvestedSAR / rate
        : totalInvestedSAR;
  const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;

  const totalWithdrawnSAR = wdrSAR + wdrUSD * rate;

  let dailySar = 0;
  let dailyUsd = 0;
  portfolios.forEach((p) => {
    const cur = resolveInvestmentPortfolioCurrency(p);
    (p.holdings || []).forEach((h: Holding) => {
      if (!holdingUsesLiveQuote(h)) return;
      const qty = h.quantity ?? 0;
      if (qty <= 0) return;
      const symRaw = (h.symbol || '').trim();
      const info = lookupLiveQuoteForSymbol(simulatedPrices, symRaw);
      if (!info || !Number.isFinite(info.change)) return;
      const d = quoteDailyPnLInBookCurrency(info.change, qty, symRaw.toUpperCase(), cur, rate);
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

  const out: PlatformCardMetrics = {
    totalValue,
    totalValueInSAR,
    holdingsValue,
    holdingsValueInSAR,
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
  return sanitizeAndValidatePlatformMetrics(out, platformCurrency, rate);
}

const HOLDINGS_WEIGHT_EPS = 1e-9;

export type PortfolioMetricsBundle = {
  metricsByPortfolioId: Map<string, PlatformCardMetrics>;
  /** Account cash buckets split by this portfolio’s share of total position value (SAR), for tooltips. */
  allocatedCashByPortfolioId: Map<string, { SAR: number; USD: number }>;
};

function investmentTransactionBelongsToPortfolio(
  t: InvestmentTransaction,
  portfolioId: string,
): boolean {
  const pid = String(
    t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '',
  ).trim();
  return pid === portfolioId;
}

/**
 * Per-portfolio KPIs for one platform card row: reuses {@link computePlatformCardMetrics} with
 * (a) transactions filtered to that portfolio, and (b) broker cash allocated from the account bucket
 * by each portfolio’s **holdings value in SAR** (same sim/stored rules as the platform). When all
 * positions are zero, splits cash equally. Not a second formula — same engine, scoped inputs.
 */
export function computePortfolioMetricsBundle(args: {
  /** Portfolios listed on this account row (siblings on the same broker). */
  siblingPortfolios: InvestmentPortfolio[];
  /** Investment transactions already scoped to this platform account (same as PlatformCard). */
  transactions: InvestmentTransaction[];
  accounts: Account[];
  allInvestments: InvestmentPortfolio[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  accountAvailableCashByCurrency: { SAR: number; USD: number };
}): PortfolioMetricsBundle {
  const {
    siblingPortfolios,
    transactions,
    accounts: accList,
    allInvestments: invList,
    sarPerUsd: rate,
    simulatedPrices,
    accountAvailableCashByCurrency,
  } = args;

  const metricsByPortfolioId = new Map<string, PlatformCardMetrics>();
  const allocatedCashByPortfolioId = new Map<string, { SAR: number; USD: number }>();

  const holdingsSarById = new Map<string, number>();
  for (const p of siblingPortfolios) {
    const pc = resolveInvestmentPortfolioCurrency(p);
    const mHold = computePlatformCardMetrics({
      portfolios: [p],
      transactions: [],
      accounts: accList,
      allInvestments: invList,
      sarPerUsd: rate,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices,
      platformCurrency: pc,
    });
    holdingsSarById.set(p.id, mHold.holdingsValueInSAR);
  }

  const totalHoldingsSar = siblingPortfolios.reduce((s, p) => s + (holdingsSarById.get(p.id) ?? 0), 0);
  const n = siblingPortfolios.length;

  const sarBucket = accountAvailableCashByCurrency.SAR ?? 0;
  const usdBucket = accountAvailableCashByCurrency.USD ?? 0;

  for (const p of siblingPortfolios) {
    const mine = holdingsSarById.get(p.id) ?? 0;
    const share =
      totalHoldingsSar > HOLDINGS_WEIGHT_EPS
        ? mine / totalHoldingsSar
        : n > 0
          ? 1 / n
          : 1;
    const allocated = {
      SAR: sarBucket * share,
      USD: usdBucket * share,
    };
    allocatedCashByPortfolioId.set(p.id, allocated);

    const filtered = transactions.filter((t) => investmentTransactionBelongsToPortfolio(t, p.id));
    const pc = resolveInvestmentPortfolioCurrency(p);
    metricsByPortfolioId.set(
      p.id,
      computePlatformCardMetrics({
        portfolios: [p],
        transactions: filtered,
        accounts: accList,
        allInvestments: invList,
        sarPerUsd: rate,
        availableCashByCurrency: allocated,
        simulatedPrices,
        platformCurrency: pc,
      }),
    );
  }

  return { metricsByPortfolioId, allocatedCashByPortfolioId };
}

const RECONCILIATION_EPSILON = 1e-6;

function sanitizeFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Strict arithmetic checks for platform KPI consistency. */
export function validatePlatformMetrics(
  metrics: PlatformCardMetrics,
  platformCurrency: TradeCurrency | undefined,
  sarPerUsd: number,
): PlatformMetricValidationResult {
  const issues: string[] = [];
  const rate = sanitizeFinite(sarPerUsd) > 0 ? sarPerUsd : 1;
  const m = metrics;

  for (const [k, v] of Object.entries(m)) {
    if (!Number.isFinite(v)) issues.push(`${k} is not finite`);
  }

  const derivedGain = m.totalValueInSAR - m.netCapitalSAR;
  if (Math.abs(derivedGain - m.totalGainLossSAR) > RECONCILIATION_EPSILON) {
    issues.push('totalGainLossSAR mismatch with totalValueInSAR - netCapitalSAR');
  }

  const derivedNetCapital = Math.max(0, m.totalInvestedSAR - m.totalWithdrawnSAR);
  if (Math.abs(derivedNetCapital - m.netCapitalSAR) > RECONCILIATION_EPSILON) {
    issues.push('netCapitalSAR mismatch with totalInvestedSAR - totalWithdrawnSAR');
  }

  const expectedTotalValue =
    platformCurrency === 'USD' ? m.totalValueInSAR / rate
      : platformCurrency === 'SAR' ? m.totalValueInSAR
      : m.totalValueInSAR;
  if (Math.abs(expectedTotalValue - m.totalValue) > RECONCILIATION_EPSILON) {
    issues.push('totalValue mismatch with platformCurrency conversion');
  }

  return { ok: issues.length === 0, issues };
}

function sanitizeAndValidatePlatformMetrics(
  metrics: PlatformCardMetrics,
  platformCurrency: TradeCurrency | undefined,
  sarPerUsd: number,
): PlatformCardMetrics {
  const rate = sanitizeFinite(sarPerUsd) > 0 ? sarPerUsd : 1;
  const safe: PlatformCardMetrics = {
    totalValue: sanitizeFinite(metrics.totalValue),
    totalValueInSAR: sanitizeFinite(metrics.totalValueInSAR),
    holdingsValue: sanitizeFinite(metrics.holdingsValue),
    holdingsValueInSAR: sanitizeFinite(metrics.holdingsValueInSAR),
    totalGainLoss: sanitizeFinite(metrics.totalGainLoss),
    dailyPnL: sanitizeFinite(metrics.dailyPnL),
    totalInvested: Math.max(0, sanitizeFinite(metrics.totalInvested)),
    totalWithdrawn: Math.max(0, sanitizeFinite(metrics.totalWithdrawn)),
    roi: sanitizeFinite(metrics.roi),
    totalAvailable: Math.max(0, sanitizeFinite(metrics.totalAvailable)),
    totalGainLossSAR: sanitizeFinite(metrics.totalGainLossSAR),
    dailyPnLSAR: sanitizeFinite(metrics.dailyPnLSAR),
    totalInvestedSAR: Math.max(0, sanitizeFinite(metrics.totalInvestedSAR)),
    totalWithdrawnSAR: Math.max(0, sanitizeFinite(metrics.totalWithdrawnSAR)),
    netCapitalSAR: Math.max(0, sanitizeFinite(metrics.netCapitalSAR)),
  };

  // Canonical derivations (single source of truth).
  safe.netCapitalSAR = Math.max(0, safe.totalInvestedSAR - safe.totalWithdrawnSAR);
  safe.totalGainLossSAR = safe.totalValueInSAR - safe.netCapitalSAR;
  safe.totalGainLoss =
    platformCurrency === 'USD' ? safe.totalGainLossSAR / rate
      : platformCurrency === 'SAR' ? safe.totalGainLossSAR
      : safe.totalGainLossSAR;
  safe.totalValue =
    platformCurrency === 'USD' ? safe.totalValueInSAR / rate
      : platformCurrency === 'SAR' ? safe.totalValueInSAR
      : safe.totalValueInSAR;
  safe.totalInvested =
    platformCurrency === 'USD' ? safe.totalInvestedSAR / rate
      : platformCurrency === 'SAR' ? safe.totalInvestedSAR
      : safe.totalInvestedSAR;
  safe.totalWithdrawn =
    platformCurrency === 'USD' ? safe.totalWithdrawnSAR / rate
      : platformCurrency === 'SAR' ? safe.totalWithdrawnSAR
      : safe.totalWithdrawnSAR;
  safe.roi = safe.netCapitalSAR > 0 ? (safe.totalGainLossSAR / safe.netCapitalSAR) * 100 : 0;

  safe.holdingsValueInSAR = Math.max(0, sanitizeFinite(metrics.holdingsValueInSAR));
  safe.holdingsValue =
    platformCurrency === 'USD' ? safe.holdingsValueInSAR / rate
      : platformCurrency === 'SAR' ? safe.holdingsValueInSAR
      : safe.holdingsValueInSAR;

  return safe;
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
      const txAccountId = resolveInvestmentTransactionAccountId(
        t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
        accounts,
        data.investments ?? [],
      );
      if (!txAccountId) return false;
      const canon = resolveCanonicalAccountId(txAccountId, accounts);
      return canon === account.id || txAccountId === account.id;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currencies = [...new Set(portfoliosOnAccount.map((p) => resolveInvestmentPortfolioCurrency(p)))];
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
  _sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
): { valueSAR: number; dailyDeltaSAR: number } {
  const commodities = getPersonalCommodityHoldings(data);
  let valueSAR = 0;
  let dailyDeltaSAR = 0;
  for (const ch of commodities) {
    const sym = (ch.symbol || '').trim().toUpperCase();
    const px = simulatedPrices[sym];
    /**
     * Commodity prices/current values are stored in SAR in Finova (save flow + market refresh).
     * Do not apply USD→SAR conversion again here, otherwise values are overstated by FX.
     */
    const rawSar =
      px && Number.isFinite(px.price) ? px.price * (ch.quantity ?? 0) : (ch.currentValue ?? 0);
    valueSAR += Number.isFinite(rawSar) ? rawSar : 0;
    const chg =
      px && px.change != null && Number.isFinite(px.change) ? px.change * (ch.quantity ?? 0) : 0;
    dailyDeltaSAR += Number.isFinite(chg) ? chg : 0;
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
