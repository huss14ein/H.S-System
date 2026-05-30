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
  /** Sum of qty×avg cost (SAR) for lots with both set — used when `unrealizedPnLBasis` is `holdings_cost`. */
  holdingsCostBasisSAR?: number;
  /** When set on output, unrealized P/L and ROI use holdings vs cost (portfolio rows), not value − net deposits. */
  unrealizedPnLBasis?: 'net_capital' | 'holdings_cost';
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
   * `net_capital` (default): total value − (deposits − withdrawals) — whole-platform economics.
   * `holdings_cost`: unrealized P/L = holdings value − sum(qty×avg cost); ROI vs that cost — matches holdings table & portfolio rows.
   */
  unrealizedPnLBasis?: 'net_capital' | 'holdings_cost';
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
    holdingsCostBasisSAR,
    unrealizedPnLBasis,
  };
  return sanitizeAndValidatePlatformMetrics(out, platformCurrency, rate, { unrealizedPnLBasis });
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

/** Account-level rows without `portfolioId` — allocate across siblings (deposits, trades, dividends, fees). */
function isOrphanPortfolioAttributedTx(t: InvestmentTransaction): boolean {
  if (transactionPortfolioIdTrimmed(t)) return false;
  return (
    isInvestmentTransactionType(t.type, 'deposit') ||
    isInvestmentTransactionType(t.type, 'withdrawal') ||
    isInvestmentTransactionType(t.type, 'buy') ||
    isInvestmentTransactionType(t.type, 'sell') ||
    isInvestmentTransactionType(t.type, 'dividend') ||
    isInvestmentTransactionType(t.type, 'fee') ||
    isInvestmentTransactionType(t.type, 'vat')
  );
}

/** @deprecated use isOrphanPortfolioAttributedTx */
function isOrphanPortfolioCashFlowTx(t: InvestmentTransaction): boolean {
  if (transactionPortfolioIdTrimmed(t)) return false;
  return (
    isInvestmentTransactionType(t.type, 'deposit') || isInvestmentTransactionType(t.type, 'withdrawal')
  );
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
function portfolioSiblingAttributionWeights(
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
 * - **Single portfolio** on the account: use the **full** platform transaction list + **pooled** tradable cash and
 *   **`holdings_cost`** for unrealized P/L and ROI (matches each holdings row). **Invested** / **Withdrawn** still
 *   come from the ledger; when deposits are sparse vs qty×avg cost, that is intentional.
 * - **Multiple portfolios**: rows use **positions-only cash** (`0` in metrics) but **split** account-level deposits &
 *   withdrawals without `portfolioId` across siblings by **holdings market value** weights; ROI/P&amp;L stay
 *   `holdings_cost` (per holdings table).
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
        platformCurrency: pc,
        unrealizedPnLBasis: 'net_capital',
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
    metricsByPortfolioId.set(
      p.id,
      computePlatformCardMetrics({
        portfolios: [p],
        transactions: filtered,
        accounts: accList,
        allInvestments: invList,
        sarPerUsd: rate,
        availableCashByCurrency: { SAR: 0, USD: 0 },
        simulatedPrices,
        platformCurrency: pc,
        unrealizedPnLBasis: 'net_capital',
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
  };

  // Canonical derivations (single source of truth).
  safe.netCapitalSAR = Math.max(0, safe.totalInvestedSAR - safe.totalWithdrawnSAR);
  if (basisMode === 'holdings_cost') {
    safe.totalGainLossSAR = safe.holdingsValueInSAR - basisSAR;
    safe.roi = basisSAR > 1e-9 ? (safe.totalGainLossSAR / basisSAR) * 100 : 0;
  } else {
    safe.totalGainLossSAR = safe.totalValueInSAR - safe.netCapitalSAR;
    safe.roi =
      safe.netCapitalSAR > 1e-9 ? (safe.totalGainLossSAR / safe.netCapitalSAR) * 100 : 0;
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
