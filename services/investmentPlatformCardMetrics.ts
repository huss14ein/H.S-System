/**
 * Pure metrics for Investments → platform card (capital flows, value, P&L).
 * Keeps UI and tests aligned with a single implementation.
 */

import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { quoteDailyPnLInBookCurrency, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { quoteChangeForDailyPnL, resolveEquityListingExchange } from './marketSessionLocal';
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
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { isCapitalInvestmentDeposit, isCapitalInvestmentWithdrawal } from './reconciliation/cashDelta';
import {
  earliestCapitalDepositYmd,
  formatInvestmentAgeLabel,
  HEADLINE_NEAR_ZERO_NET_INVESTED_SAR,
  investmentAgeDaysFromYmd,
} from './investmentCapitalAge';
import {
  getPersonalAccounts,
  getPersonalCommodityHoldings,
  getPersonalInvestments,
} from '../utils/wealthScope';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

export type SimulatedPriceRow = { price: number; change?: number; changePercent?: number };
export type SimulatedPriceMap = Record<string, SimulatedPriceRow>;

/** Resolve per-share day change from quote row (change or derived from changePercent). */
export function resolveQuoteChangePerShare(
  info: { price?: number; change?: number; changePercent?: number } | null | undefined,
): number {
  if (!info) return 0;
  if (Number.isFinite(info.change) && info.change !== 0) return info.change as number;
  const price = info.price;
  const pct = info.changePercent;
  if (Number.isFinite(price) && Number.isFinite(pct) && (price as number) > 0) {
    return ((price as number) * (pct as number)) / 100;
  }
  return Number.isFinite(info.change) ? (info.change as number) : 0;
}

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
  /** Sum of qty×avg cost (SAR) for lots with both set — diagnostic only; ROI uses net invested. */
  holdingsCostBasisSAR?: number;
  /** When set on output, unrealized P/L and ROI use holdings vs cost (legacy). Default is net invested. */
  unrealizedPnLBasis?: 'net_capital' | 'holdings_cost';
  /** Earliest economic deposit (YYYY-MM-DD) in the scoped ledger. */
  firstCapitalDepositYmd?: string | null;
  investmentAgeDays?: number | null;
  /** Deposits exist, leftover net invested ≤ 1 SAR, present value remains. */
  principalFullyRecovered?: boolean;
  /** Raw deposit amounts in SAR (before incomplete-books inference). */
  depositsRecordedSAR?: number;
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
  /**
   * `net_capital` (default): present value − (deposits − withdrawals) — money you still have in vs what you put in.
   * `holdings_cost`: leftover diagnostic vs qty×avg cost (not the investor ROI question).
   */
  unrealizedPnLBasis?: 'net_capital' | 'holdings_cost';
  /** Session clock for daily P/L (defaults to now). */
  asOf?: Date;
  /** Live quote map for daily P/L — defaults to `simulatedPrices`. Use session/live ticks so `change` is fresh. */
  dailyPnLPrices?: SimulatedPriceMap;
  /**
   * When set, deposits/withdrawals convert USD→SAR with transaction-dated FX (same as headline ROI).
   * Spot `sarPerUsd` remains for holdings marks and display conversion.
   */
  datedFxData?: FinancialData | null;
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
    unrealizedPnLBasis = 'net_capital',
    asOf = new Date(),
    dailyPnLPrices,
    datedFxData = null,
  } = args;
  const pricesForDailyPnL = dailyPnLPrices ?? simulatedPrices;
  const txCashSar = (t: InvestmentTransaction) =>
    datedFxData
      ? investmentTransactionCashAmountSarDated({
          tx: t,
          accounts: accList,
          portfolios: invList,
          data: datedFxData,
          uiExchangeRate: rate,
        })
      : (() => {
          const c = inferInvestmentTransactionCurrency(t, accList, invList);
          const amt = getInvestmentTransactionCashAmount(t as any);
          return c === 'SAR' ? amt : toSAR(amt, 'USD', rate);
        })();

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
  let depositsRecordedSarDated = 0;
  let withdrawnSarDated = 0;
  /** Economic capital only — broker-cash Reconcile Balance rows stay out of invested/withdrawn. */
  transactions
    .filter((t) => isCapitalInvestmentDeposit(t))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') invSAR += amt;
      else invUSD += amt;
      depositsRecordedSarDated += txCashSar(t);
    });
  transactions
    .filter((t) => isCapitalInvestmentWithdrawal(t))
    .forEach((t) => {
      const c = inferInvestmentTransactionCurrency(t, accList, invList);
      const amt = getInvestmentTransactionCashAmount(t as any);
      if (c === 'SAR') wdrSAR += amt;
      else wdrUSD += amt;
      withdrawnSarDated += txCashSar(t);
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

  /** Spot FX books (legacy display currency split). */
  const spotDepositsSAR = invSAR + invUSD * rate;
  const spotWithdrawnSAR = wdrSAR + wdrUSD * rate;
  /**
   * Prefer transaction-dated FX when `datedFxData` is set so USD mid-history capital
   * matches headline ROI / Recovery books (not today’s spot alone).
   */
  const totalInvestedSARRaw =
    datedFxData != null ? Math.max(0, depositsRecordedSarDated) : spotDepositsSAR;
  const withdrawnSAR =
    datedFxData != null ? Math.max(0, withdrawnSarDated) : spotWithdrawnSAR;
  const totalWithdrawn =
    platformCurrency === 'USD'
      ? rate > 0
        ? withdrawnSAR / rate
        : withdrawnSAR
      : withdrawnSAR;

  const inferredInvestedFromLedgerSAR = Math.max(
    0,
    (buySAR + buyUSD * rate) - (sellSAR + sellUSD * rate) - (divSAR + divUSD * rate) + cashInSar + spotWithdrawnSAR,
  );
  const totalInvestedSAR =
    totalInvestedSARRaw > 0
      ? totalInvestedSARRaw
      : inferredInvestedFromLedgerSAR > 0
        ? inferredInvestedFromLedgerSAR
        : Math.max(0, holdingsCostBasisSAR + cashInSar + withdrawnSAR);
  const ledgerNetCapitalSAR = Math.max(0, totalInvestedSAR - withdrawnSAR);
  /** Match headline: when deposits exist, use ledger net; when missing, floor at cost + idle cash. */
  const economicDeployedSAR = Math.max(0, holdingsCostBasisSAR + cashInSar);
  const netCapitalSAR =
    totalInvestedSARRaw > 0
      ? ledgerNetCapitalSAR
      : Math.max(ledgerNetCapitalSAR, economicDeployedSAR);
  const totalGainLossSAR = totalValueInSAR - netCapitalSAR;
  const depositsRecordedSAR = totalInvestedSARRaw;
  const principalFullyRecovered =
    depositsRecordedSAR > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR &&
    netCapitalSAR <= HEADLINE_NEAR_ZERO_NET_INVESTED_SAR &&
    totalValueInSAR > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR;
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
  const roi = principalFullyRecovered ? 0 : netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
  const firstCapitalDepositYmd = earliestCapitalDepositYmd(transactions);
  const investmentAgeDays = investmentAgeDaysFromYmd(firstCapitalDepositYmd);

  const totalWithdrawnSAR = withdrawnSAR;

  let dailySar = 0;
  let dailyUsd = 0;
  portfolios.forEach((p) => {
    const cur = resolveInvestmentPortfolioCurrency(p);
    (p.holdings || []).forEach((h: Holding) => {
      if (!holdingUsesLiveQuote(h)) return;
      const qty = h.quantity ?? 0;
      if (qty <= 0) return;
      const symRaw = (h.symbol || '').trim();
      const info = lookupLiveQuoteForSymbol(pricesForDailyPnL, symRaw);
      if (!info) return;
      const changePerShare = resolveQuoteChangePerShare(info);
      const d = quoteDailyPnLInBookCurrency(
        changePerShare,
        qty,
        symRaw.toUpperCase(),
        cur,
        rate,
        asOf,
        pricesForDailyPnL as Record<string, unknown>,
      );
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
    holdingsCostBasisSAR,
    unrealizedPnLBasis,
    firstCapitalDepositYmd,
    investmentAgeDays,
    principalFullyRecovered,
    depositsRecordedSAR,
  };
  return sanitizeAndValidatePlatformMetrics(out, platformCurrency, rate, { unrealizedPnLBasis });
}

/** Display labels for platform / portfolio ROI vs net invested (deposits − withdrawals). */
export function presentScopedInvestmentGrowth(m: PlatformCardMetrics): {
  roiDisplay: string;
  growthSar: number;
  netInvestedSar: number;
  isGrowing: boolean;
  statusLabel: string;
  ageLabel: string | null;
  firstCapitalDepositYmd: string | null;
  principalFullyRecovered: boolean;
} {
  const principalFullyRecovered = m.principalFullyRecovered === true;
  const growthSar = Number.isFinite(m.totalGainLossSAR) ? m.totalGainLossSAR : 0;
  return {
    roiDisplay: principalFullyRecovered ? 'Principal recovered' : `${(Number.isFinite(m.roi) ? m.roi : 0).toFixed(1)}%`,
    growthSar,
    netInvestedSar: Number.isFinite(m.netCapitalSAR) ? m.netCapitalSAR : 0,
    isGrowing: principalFullyRecovered || growthSar >= 0,
    statusLabel: principalFullyRecovered
      ? 'Principal recovered'
      : growthSar > 0.5
        ? 'Growing'
        : growthSar < -0.5
          ? 'Shrinking'
          : 'Flat',
    ageLabel: formatInvestmentAgeLabel(m.investmentAgeDays ?? null),
    firstCapitalDepositYmd: m.firstCapitalDepositYmd ?? null,
    principalFullyRecovered,
  };
}

export type PortfolioMetricsBundle = {
  metricsByPortfolioId: Map<string, PlatformCardMetrics>;
  /**
   * Full account SAR/USD tradable buckets repeated per portfolio id (same values for every sibling).
   * Broker cash is one pooled ledger per platform — not split across portfolios.
   */
  allocatedCashByPortfolioId: Map<string, { SAR: number; USD: number }>;
};

function transactionPortfolioIdTrimmed(t: InvestmentTransaction): string {
  return String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
}

export function getPortfolioAttributedTransactions(args: {
  portfolioId: string;
  portfolioIndex: number;
  siblingPortfolios: InvestmentPortfolio[];
  transactions: InvestmentTransaction[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
}): InvestmentTransaction[] {
  const weights = portfolioSiblingAttributionWeights(
    args.siblingPortfolios,
    args.sarPerUsd,
    args.simulatedPrices,
  );
  return transactionsAttributedToPortfolioForKpis({
    portfolioId: args.portfolioId,
    portfolioIndex: args.portfolioIndex,
    transactions: args.transactions,
    weights,
    siblingPortfolios: args.siblingPortfolios,
  });
}

/** Account-level rows without `portfolioId` — allocate across siblings (capital deposits/withdrawals, trades, dividends, fees). */
function isOrphanPortfolioAttributedTx(t: InvestmentTransaction): boolean {
  if (transactionPortfolioIdTrimmed(t)) return false;
  if (isCapitalInvestmentDeposit(t) || isCapitalInvestmentWithdrawal(t)) return true;
  return (
    isInvestmentTransactionType(t.type, 'buy') ||
    isInvestmentTransactionType(t.type, 'sell') ||
    isInvestmentTransactionType(t.type, 'dividend') ||
    isInvestmentTransactionType(t.type, 'fee') ||
    isInvestmentTransactionType(t.type, 'vat')
  );
}

function isOrphanPortfolioCashFlowTx(t: InvestmentTransaction): boolean {
  if (transactionPortfolioIdTrimmed(t)) return false;
  return isCapitalInvestmentDeposit(t) || isCapitalInvestmentWithdrawal(t);
}

function orphanShareWeightForPortfolio(args: {
  tx: InvestmentTransaction;
  portfolioIndex: number;
  siblingPortfolios: InvestmentPortfolio[];
  weights: number[];
}): number {
  const { tx, portfolioIndex, siblingPortfolios, weights } = args;
  const sym = String(tx.symbol ?? '').trim().toUpperCase();
  if (sym && !isOrphanPortfolioCashFlowTx(tx)) {
    const qtyPerPortfolio = siblingPortfolios.map((p) =>
      (p.holdings ?? [])
        .filter((h) => String(h.symbol ?? '').trim().toUpperCase() === sym)
        .reduce((s, h) => s + Math.max(0, Number(h.quantity) || 0), 0),
    );
    const totalQty = qtyPerPortfolio.reduce((s, v) => s + v, 0);
    if (totalQty > 0) return qtyPerPortfolio[portfolioIndex] / totalQty;
  }
  return weights[portfolioIndex] ?? 0;
}

/**
 * Weights for splitting orphan cashflows: each portfolio’s live position value in SAR (same basis as holdings KPIs).
 */
export function portfolioSiblingAttributionWeights(
  siblingPortfolios: InvestmentPortfolio[],
  rate: number,
  simulatedPrices: SimulatedPriceMap,
): number[] {
  const sarEach = siblingPortfolios.map((p) => {
    const cur = resolveInvestmentPortfolioCurrency(p);
    let sumBook = 0;
    (p.holdings || []).forEach((h: Holding) => {
      const v = effectiveHoldingValueInBookCurrency(h, cur, simulatedPrices, rate);
      if (Number.isFinite(v) && v > 0) sumBook += v;
    });
    return toSAR(sumBook, cur, rate);
  });
  const total = sarEach.reduce((s, v) => s + v, 0);
  const n = Math.max(1, siblingPortfolios.length);
  if (!(total > 0)) return siblingPortfolios.map(() => 1 / n);
  return sarEach.map((v) => v / total);
}

/**
 * Ledger rows tagged to this portfolio + proportional share of orphan deposits/withdrawals (no `portfolioId`).
 */
function transactionsAttributedToPortfolioForKpis(args: {
  portfolioId: string;
  portfolioIndex: number;
  transactions: InvestmentTransaction[];
  weights: number[];
  siblingPortfolios?: InvestmentPortfolio[];
}): InvestmentTransaction[] {
  const { portfolioId, portfolioIndex, transactions, weights, siblingPortfolios = [] } = args;
  const w = weights[portfolioIndex] ?? 0;
  const out: InvestmentTransaction[] = [];

  for (const t of transactions) {
    const pid = transactionPortfolioIdTrimmed(t);
    if (pid === portfolioId) {
      out.push(t);
      continue;
    }
    if (pid) continue;

    if (!isOrphanPortfolioAttributedTx(t)) continue;
    const share =
      siblingPortfolios.length > 0
        ? orphanShareWeightForPortfolio({
            tx: t,
            portfolioIndex,
            siblingPortfolios,
            weights,
          })
        : w;
    if (!(share > 0)) continue;
    const base = getInvestmentTransactionCashAmount(t as any);
    if (!(base > 0)) continue;
    const scaled = base * share;
    if (!(scaled > 1e-12)) continue;
    const scaledQty =
      isInvestmentTransactionType(t.type, 'buy') || isInvestmentTransactionType(t.type, 'sell')
        ? Math.abs(Number(t.quantity) || 0) * share
        : Number(t.quantity) || 0;
    out.push({
      ...t,
      id: `${t.id}~kpiAlloc~${portfolioId}`,
      portfolioId,
      total: scaled,
      quantity: scaledQty,
    } as InvestmentTransaction);
  }

  return out;
}

/**
 * Per-portfolio KPIs for one platform row: same ledger rules as {@link computePlatformCardMetrics}.
 *
 * Present value = holdings + this portfolio’s share of idle broker cash.
 * Net invested = deposits − withdrawals tagged to the portfolio, plus a value-weighted share of
 * untagged capital transfers. ROI is always vs that net invested (never qty × avg cost).
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
  dailyPnLPrices?: SimulatedPriceMap;
  accountAvailableCashByCurrency: { SAR: number; USD: number };
  /** Same dated FX path as platform cards / headline ROI capital. */
  datedFxData?: FinancialData | null;
}): PortfolioMetricsBundle {
  const {
    siblingPortfolios,
    transactions,
    accounts: accList,
    allInvestments: invList,
    sarPerUsd: rate,
    simulatedPrices,
    dailyPnLPrices,
    accountAvailableCashByCurrency,
    datedFxData = null,
  } = args;

  const metricsByPortfolioId = new Map<string, PlatformCardMetrics>();
  const allocatedCashByPortfolioId = new Map<string, { SAR: number; USD: number }>();

  const sarBucket = Math.max(0, accountAvailableCashByCurrency.SAR ?? 0);
  const usdBucket = Math.max(0, accountAvailableCashByCurrency.USD ?? 0);
  const sharedBuckets = { SAR: sarBucket, USD: usdBucket };

  if (siblingPortfolios.length === 1) {
    const p = siblingPortfolios[0];
    allocatedCashByPortfolioId.set(p.id, { ...sharedBuckets });
    const pc = resolveInvestmentPortfolioCurrency(p);
    metricsByPortfolioId.set(
      p.id,
      computePlatformCardMetrics({
        portfolios: [p],
        transactions,
        accounts: accList,
        allInvestments: invList,
        sarPerUsd: rate,
        availableCashByCurrency: accountAvailableCashByCurrency,
        simulatedPrices,
        dailyPnLPrices,
        platformCurrency: pc,
        unrealizedPnLBasis: 'net_capital',
        datedFxData,
      }),
    );
    return { metricsByPortfolioId, allocatedCashByPortfolioId };
  }

  const weights = portfolioSiblingAttributionWeights(siblingPortfolios, rate, simulatedPrices);

  for (let i = 0; i < siblingPortfolios.length; i++) {
    const p = siblingPortfolios[i];
    allocatedCashByPortfolioId.set(p.id, { ...sharedBuckets });

    const filtered = transactionsAttributedToPortfolioForKpis({
      portfolioId: p.id,
      portfolioIndex: i,
      transactions,
      weights,
      siblingPortfolios,
    });
    const pc = resolveInvestmentPortfolioCurrency(p);
    const w = weights[i] ?? 0;
    const cashShare = { SAR: sarBucket * w, USD: usdBucket * w };
    metricsByPortfolioId.set(
      p.id,
      computePlatformCardMetrics({
        portfolios: [p],
        transactions: filtered,
        accounts: accList,
        allInvestments: invList,
        sarPerUsd: rate,
        availableCashByCurrency: cashShare,
        simulatedPrices,
        dailyPnLPrices,
        platformCurrency: pc,
        unrealizedPnLBasis: 'net_capital',
        datedFxData,
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
    if (typeof v !== 'number') continue;
    if (!Number.isFinite(v)) issues.push(`${k} is not finite`);
  }

  if (m.unrealizedPnLBasis !== 'holdings_cost') {
    const derivedGain = m.totalValueInSAR - m.netCapitalSAR;
    if (Math.abs(derivedGain - m.totalGainLossSAR) > RECONCILIATION_EPSILON) {
      issues.push('totalGainLossSAR mismatch with totalValueInSAR - netCapitalSAR');
    }
  } else {
    const basis = m.holdingsCostBasisSAR ?? 0;
    const derivedUnreal = m.holdingsValueInSAR - basis;
    if (Math.abs(derivedUnreal - m.totalGainLossSAR) > RECONCILIATION_EPSILON) {
      issues.push('totalGainLossSAR mismatch with holdingsValueInSAR - holdingsCostBasisSAR');
    }
  }

  const derivedNetCapital = Math.max(0, m.totalInvestedSAR - m.totalWithdrawnSAR);
  const cashSar = Math.max(0, m.totalValueInSAR - m.holdingsValueInSAR);
  const economicFloor = Math.max(0, (m.holdingsCostBasisSAR ?? 0) + cashSar);
  const hasDeposits =
    (m.depositsRecordedSAR != null && m.depositsRecordedSAR > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR) ||
    (m.depositsRecordedSAR == null && m.firstCapitalDepositYmd != null);
  const expectedNet = hasDeposits ? derivedNetCapital : Math.max(derivedNetCapital, economicFloor);
  if (Math.abs(expectedNet - m.netCapitalSAR) > RECONCILIATION_EPSILON) {
    issues.push('netCapitalSAR mismatch with deposits−withdrawals (or incomplete-books floor)');
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
  opts?: { unrealizedPnLBasis?: 'net_capital' | 'holdings_cost' },
): PlatformCardMetrics {
  const rate = sanitizeFinite(sarPerUsd) > 0 ? sarPerUsd : 1;
  const basisMode = opts?.unrealizedPnLBasis ?? metrics.unrealizedPnLBasis ?? 'net_capital';
  const basisSAR = sanitizeFinite(metrics.holdingsCostBasisSAR ?? 0);

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
    holdingsCostBasisSAR: basisSAR,
    unrealizedPnLBasis: basisMode === 'holdings_cost' ? 'holdings_cost' : undefined,
    firstCapitalDepositYmd: metrics.firstCapitalDepositYmd ?? null,
    investmentAgeDays:
      metrics.investmentAgeDays != null && Number.isFinite(metrics.investmentAgeDays)
        ? Math.floor(metrics.investmentAgeDays)
        : null,
    principalFullyRecovered: metrics.principalFullyRecovered === true,
    depositsRecordedSAR: Math.max(0, sanitizeFinite(metrics.depositsRecordedSAR ?? 0)),
  };

  // Canonical derivations (single source of truth).
  const ledgerNet = Math.max(0, safe.totalInvestedSAR - safe.totalWithdrawnSAR);
  const cashSar = Math.max(0, safe.totalValueInSAR - safe.holdingsValueInSAR);
  const economicDeployed = Math.max(0, basisSAR + cashSar);
  const hasDeposits = (safe.depositsRecordedSAR ?? 0) > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR;
  /** Incomplete books (no deposit amounts): floor at cost + idle cash — same as headline. */
  safe.netCapitalSAR = hasDeposits ? ledgerNet : Math.max(ledgerNet, economicDeployed);
  safe.principalFullyRecovered =
    hasDeposits &&
    safe.netCapitalSAR <= HEADLINE_NEAR_ZERO_NET_INVESTED_SAR &&
    safe.totalValueInSAR > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR;
  if (basisMode === 'holdings_cost') {
    safe.totalGainLossSAR = safe.holdingsValueInSAR - basisSAR;
    safe.roi = basisSAR > 1e-9 ? (safe.totalGainLossSAR / basisSAR) * 100 : 0;
  } else {
    safe.totalGainLossSAR = safe.totalValueInSAR - safe.netCapitalSAR;
    if (safe.principalFullyRecovered) {
      safe.roi = 0;
    } else {
      safe.roi =
        safe.netCapitalSAR > 1e-9 ? (safe.totalGainLossSAR / safe.netCapitalSAR) * 100 : 0;
    }
  }
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
    datedFxData: data,
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
    const px = lookupLiveQuoteForSymbol(simulatedPrices, sym);
    /**
     * Commodity prices/current values are stored in SAR in Finova (save flow + market refresh).
     * Do not apply USD→SAR conversion again here, otherwise values are overstated by FX.
     */
    const rawSar =
      px && Number.isFinite(px.price) ? px.price * (ch.quantity ?? 0) : (ch.currentValue ?? 0);
    valueSAR += Number.isFinite(rawSar) ? rawSar : 0;
    const changePerShare =
      px && (px.change != null || px.changePercent != null)
        ? resolveEquityListingExchange(sym) != null
          ? quoteChangeForDailyPnL(sym, resolveQuoteChangePerShare(px))
          : resolveQuoteChangePerShare(px)
        : 0;
    const chg = changePerShare * (ch.quantity ?? 0);
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

/**
 * One investment platform row using **all** portfolios on the account (household-inclusive Analysis / managed split).
 * Same metrics engine as {@link computePersonalPlatformCardRow}, without personal-owner filter.
 */
export function computeAllScopePlatformCardRow(
  account: Account,
  data: FinancialData,
  options: {
    sarPerUsd: number;
    simulatedPrices: SimulatedPriceMap;
    getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  },
): PlatformCardMetrics {
  const accounts = data.accounts ?? [];
  const allPorts = data.investments ?? [];
  const portfoliosOnAccount = allPorts.filter((p) => portfolioBelongsToAccount(p, account, accounts));
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
    allInvestments: allPorts,
    sarPerUsd: options.sarPerUsd,
    availableCashByCurrency: options.getAvailableCashForAccount(account.id),
    simulatedPrices: options.simulatedPrices,
    platformCurrency,
    datedFxData: data,
  });
}

/** Household-inclusive platforms rollup (all Investment accounts + all portfolios). */
export function computeAllPlatformsRollupSAR(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
): { subtotalSAR: number; dailyPnLSAR: number } {
  const invAccounts = (data.accounts ?? []).filter((a) => a.type === 'Investment');
  let subtotalSAR = 0;
  let dailyPnLSAR = 0;
  for (const account of invAccounts) {
    const m = computeAllScopePlatformCardRow(account, data, {
      sarPerUsd,
      simulatedPrices,
      getAvailableCashForAccount,
    });
    subtotalSAR += m.totalValueInSAR;
    dailyPnLSAR += m.dailyPnLSAR;
  }
  return { subtotalSAR, dailyPnLSAR };
}

/** Household-inclusive commodities with live quotes (same mark rules as personal). */
export function computeAllCommoditiesContributionSAR(
  data: FinancialData,
  _sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
): { valueSAR: number; dailyDeltaSAR: number } {
  const commodities = data.commodityHoldings ?? [];
  let valueSAR = 0;
  let dailyDeltaSAR = 0;
  for (const ch of commodities) {
    const sym = (ch.symbol || '').trim().toUpperCase();
    const px = lookupLiveQuoteForSymbol(simulatedPrices, sym);
    const rawSar =
      px && Number.isFinite(px.price) ? px.price * (ch.quantity ?? 0) : (ch.currentValue ?? 0);
    valueSAR += Number.isFinite(rawSar) ? rawSar : 0;
    const changePerShare =
      px && (px.change != null || px.changePercent != null)
        ? resolveEquityListingExchange(sym) != null
          ? quoteChangeForDailyPnL(sym, resolveQuoteChangePerShare(px))
          : resolveQuoteChangePerShare(px)
        : 0;
    const chg = changePerShare * (ch.quantity ?? 0);
    dailyDeltaSAR += Number.isFinite(chg) ? chg : 0;
  }
  return { valueSAR, dailyDeltaSAR };
}
