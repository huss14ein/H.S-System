import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  getAllInvestmentsValueInSAR,
  toSAR,
  tradableCashBucketToSAR,
  tradableCashBucketToSARSigned,
} from '../utils/currencyMath';
import {
  inferInvestmentTransactionCurrency,
  resolveCanonicalAccountId,
  resolveInvestmentTransactionAccountId,
} from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType, normalizeInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { isCapitalInvestmentDeposit, isCapitalInvestmentWithdrawal } from './reconciliation/cashDelta';
import { appCalendarTodayYmd } from './reconciliation/constants';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import {
  computePersonalPlatformsRollupSAR,
  computePersonalCommoditiesContributionSAR,
} from './investmentPlatformCardMetrics';
import { sumPersonalSukukPositionsCostSar, sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';
import { getPersonalCommodityHoldings } from '../utils/wealthScope';
import { brokerCashBucketsFromInvestmentAccount } from './investmentCashLedger';

type GetAvailableCashFn = (accountId: string) => { SAR?: number; USD?: number } | null | undefined;

/** Clamp absurd ROI from corrupt holdings (e.g. bad `current_value` in DB) for UI display. */
export function sanitizeInvestmentRoiDecimal(roi: number): number {
  if (!Number.isFinite(roi)) return 0;
  if (roi > 10) return 10;
  if (roi < -1) return -1;
  return roi;
}

export type PersonalInvestmentKpisSar = {
  holdingsValueSar: number;
  brokerageCashSar: number;
  totalInvestmentsValueSar: number;
  totalInvestedSar: number;
  totalWithdrawnSar: number;
  netCapitalSar: number;
  totalGainLossSar: number;
  roi: number;
};

export type InvestmentCapitalSource = 'deposits' | 'ledger_inferred' | 'cost_basis_fallback';

/**
 * When deposits are missing we infer capital from buys/sells/dividends/cash — fragile if buy history is incomplete.
 * Cross-check against avg-cost fallback (holdings basis + broker cash + withdrawals): if inferred diverges wildly,
 * prefer cost_basis_fallback instead of overstating or understating invested capital.
 */
export const LEDGER_INFERRED_FALLBACK_MIN_RATIO = 0.22;
export const LEDGER_INFERRED_FALLBACK_MAX_RATIO = 4.5;
/** Skip ratio cross-check when fallback gross is tiny (noise vs rounding). */
export const LEDGER_INFERRED_FALLBACK_MIN_SAR = 400;

export const HEADLINE_NEAR_ZERO_NET_INVESTED_SAR = 1;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day only — rejects anything that is not YYYY-MM-DD (XSS / injection defense). */
export function safeCapitalDepositYmd(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').slice(0, 10);
  return YMD_RE.test(d) ? d : null;
}

export function earliestCapitalDepositYmd(transactions: Array<{ date?: string | null; type?: string | null; note?: string | null; description?: string | null; category?: string | null; idempotencyKey?: string | null }>): string | null {
  let min: string | null = null;
  for (const t of transactions) {
    if (!isCapitalInvestmentDeposit(t)) continue;
    const d = safeCapitalDepositYmd(t.date);
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

export function investmentAgeDaysFromYmd(startYmd: string | null | undefined, asOfYmd: string = appCalendarTodayYmd()): number | null {
  const start = safeCapitalDepositYmd(startYmd);
  const asOf = safeCapitalDepositYmd(asOfYmd);
  if (!start || !asOf) return null;
  const startMs = Date.parse(`${start}T00:00:00`);
  const asOfMs = Date.parse(`${asOf}T00:00:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(asOfMs) || asOfMs < startMs) return null;
  return Math.floor((asOfMs - startMs) / 86_400_000);
}

export function formatInvestmentAgeLabel(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  const n = Math.floor(days);
  if (n < 1) return 'Started today';
  if (n === 1) return '1 day invested';
  if (n < 31) return `${n} days invested`;
  const months = Math.floor(n / 30.4375);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} invested`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return `${years} year${years === 1 ? '' : 's'} invested`;
  return `${years}y ${remMonths}mo invested`;
}

/**
 * Headline platform capital: deposits − withdrawals when funding history exists.
 * Cost-basis + idle cash is a floor only when deposits are missing (incomplete books).
 */
export function resolveHeadlinePlatformNetCapitalSar(args: {
  capitalSource: InvestmentCapitalSource;
  ledgerNetCapitalSar: number;
  economicDeployedSar: number;
}): { platformNetSar: number; economicFloorApplied: boolean } {
  const ledger = Math.max(0, Number.isFinite(args.ledgerNetCapitalSar) ? args.ledgerNetCapitalSar : 0);
  const economic = Math.max(0, Number.isFinite(args.economicDeployedSar) ? args.economicDeployedSar : 0);
  if (args.capitalSource === 'deposits') {
    return { platformNetSar: ledger, economicFloorApplied: false };
  }
  const platformNetSar = Math.max(ledger, economic);
  return {
    platformNetSar,
    economicFloorApplied: platformNetSar > ledger + 1e-9,
  };
}

export type PersonalInvestmentKpiBreakdown = PersonalInvestmentKpisSar & {
  capitalSource: InvestmentCapitalSource;
  /** Sum of deposit transactions (SAR). */
  depositsRecordedSar: number;
  /** Earliest economic deposit calendar day (YYYY-MM-DD), if any. */
  firstCapitalDepositYmd: string | null;
  /** Used only when deposits are missing: max(0, buys − sells − dividends + brokerageCash + withdrawals). */
  inferredInvestedFromLedgerSar: number;
  /** Rolling average-cost basis of open holdings (SAR). */
  holdingsCostBasisSar: number;
  /** Used when deposits and inferred path are zero: max(0, holdingsCostBasisSar + brokerageCashSar + totalWithdrawnSar). */
  fallbackInvestedSar: number;
  buysSar: number;
  sellsSar: number;
  dividendsSar: number;
  feesSar: number;
  vatSar: number;
  /**
   * Cash implied by ledger flows using **spot** SAR/USD (`sarPerUsd`), same basis as book balances.
   * Compare to signed broker cash for drift — **not** the dated-FX flow sums used for capital/ROI.
   */
  expectedCashFromLedgerSpotSar: number;
  /**
   * Ledger-implied cash using **transaction-dated** SAR (same basis as `buysSar`, `depositsRecordedSar`, etc.).
   * Identity: deposits − buys + sells + dividends − withdrawals − fees − vat.
   */
  expectedCashFromLedgerDatedSar: number;
};

/**
 * Investment ledger rows attributed to the signed-in user’s accounts — same filter as
 * {@link computePersonalInvestmentKpiBreakdown} (resolves `portfolio_id` → platform account).
 */
export function getPersonalInvestmentTransactionsForKpis(data: FinancialData): InvestmentTransaction[] {
  const d = data as FinancialData & {
    personalAccounts?: Account[];
    personalInvestments?: InvestmentPortfolio[];
  };
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const investments = (d.personalInvestments ?? data.investments ?? []) as InvestmentPortfolio[];
  const personalAccountIds = new Set(accounts.map((a) => a.id));

  const hits = (t: InvestmentTransaction) => {
    const accountId = resolveInvestmentTransactionAccountId(
      t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
      accounts,
      investments,
    );
    return !!accountId && personalAccountIds.has(accountId);
  };

  return ((data.investmentTransactions ?? []) as InvestmentTransaction[]).filter(hits);
}

/**
 * Canonical personal-investment KPI math shared across Dashboard, Investments summary, and reporting.
 * Uses one SAR normalization basis (`sarPerUsd`) and one flow derivation path for consistency.
 */
export function computePersonalInvestmentKpiBreakdown(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
): PersonalInvestmentKpiBreakdown {
  const d = data as FinancialData & {
    personalAccounts?: Account[];
    personalInvestments?: InvestmentPortfolio[];
  };
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const investments = (d.personalInvestments ?? data.investments ?? []) as InvestmentPortfolio[];
  const personalAccountIds = new Set(accounts.map((a) => a.id));

  const holdingsValueSar = getAllInvestmentsValueInSAR(investments, sarPerUsd);
  let brokerageCashSar = 0;
  for (const account of accounts) {
    if (account.type !== 'Investment' || !personalAccountIds.has(account.id)) continue;
    const cash = getAvailableCashForAccount(account.id);
    brokerageCashSar += tradableCashBucketToSAR({ SAR: cash?.SAR ?? 0, USD: cash?.USD ?? 0 }, sarPerUsd);
  }
  const totalInvestmentsValueSar = holdingsValueSar + brokerageCashSar;

  const invTx = getPersonalInvestmentTransactionsForKpis(data);
  const invTxSar = (t: InvestmentTransaction) =>
    investmentTransactionCashAmountSarDated({
      tx: t,
      accounts,
      portfolios: investments,
      data,
      uiExchangeRate: sarPerUsd,
    }) || toSAR(getInvestmentTransactionCashAmount(t as any), inferInvestmentTransactionCurrency(t as any, accounts, investments), sarPerUsd);

  /** Spot FX — matches how broker `balance` is converted for reconciliation (avoids false drift from historical USD rates). */
  const invTxSarSpot = (t: InvestmentTransaction): number => {
    const amount = Math.abs(getInvestmentTransactionCashAmount(t as any));
    if (!(amount > 0)) return 0;
    return toSAR(amount, inferInvestmentTransactionCurrency(t as any, accounts, investments), sarPerUsd);
  };

  const isCapitalDeposit = (t: InvestmentTransaction) => isCapitalInvestmentDeposit(t);
  const isCapitalWithdrawal = (t: InvestmentTransaction) => isCapitalInvestmentWithdrawal(t);

  /**
   * Single pass over the ledger — dated FX and spot FX once per row.
   * Repeated filter/reduce previously re-converted every transaction ~12 times and could stall large books.
   */
  let depositsRecordedSar = 0;
  let firstCapitalDepositYmd: string | null = null;
  let totalWithdrawnSar = 0;
  let buysSar = 0;
  let sellsSar = 0;
  let dividendsSar = 0;
  let feesSar = 0;
  let vatSar = 0;
  let depositsSpotSar = 0;
  let withdrawalsSpotSar = 0;
  let buysSpotSar = 0;
  let sellsSpotSar = 0;
  let dividendsSpotSar = 0;
  let feesSpotSar = 0;
  let vatSpotSar = 0;
  let depositsDatedAllSar = 0;
  let withdrawalsDatedAllSar = 0;
  for (const t of invTx) {
    const dated = invTxSar(t);
    const spot = invTxSarSpot(t);
    const typ = normalizeInvestmentTransactionType(t.type);
    if (typ === 'deposit') {
      depositsSpotSar += spot;
      depositsDatedAllSar += dated;
      if (isCapitalDeposit(t)) {
        depositsRecordedSar += dated;
        const d = safeCapitalDepositYmd(t.date);
        if (d && (!firstCapitalDepositYmd || d < firstCapitalDepositYmd)) firstCapitalDepositYmd = d;
      }
    } else if (typ === 'withdrawal') {
      withdrawalsSpotSar += spot;
      withdrawalsDatedAllSar += dated;
      if (isCapitalWithdrawal(t)) totalWithdrawnSar += dated;
    } else if (typ === 'buy') {
      buysSar += dated;
      buysSpotSar += spot;
    } else if (typ === 'sell') {
      sellsSar += dated;
      sellsSpotSar += spot;
    } else if (typ === 'dividend') {
      dividendsSar += dated;
      dividendsSpotSar += spot;
    } else if (typ === 'fee') {
      feesSar += dated;
      feesSpotSar += spot;
    } else if (typ === 'vat') {
      vatSar += dated;
      vatSpotSar += spot;
    }
  }
  const expectedCashFromLedgerSpotSar =
    depositsSpotSar - buysSpotSar + sellsSpotSar + dividendsSpotSar - withdrawalsSpotSar - feesSpotSar - vatSpotSar;
  const expectedCashFromLedgerDatedSar =
    depositsDatedAllSar - buysSar + sellsSar + dividendsSar - withdrawalsDatedAllSar - feesSar - vatSar;

  /**
   * Heuristic when deposit history is empty: approximates “funds committed” from net purchases and
   * live cash (floored per currency). Withdrawals appear inside this expression and net capital applies
   * withdrawals again — see System Health breakdown for cancellation intuition.
   */
  const inferredInvestedFromLedgerSar = Math.max(0, buysSar - sellsSar - dividendsSar + brokerageCashSar + totalWithdrawnSar);
  const holdingsCostBasisSar = investments.reduce((sum: number, portfolio: InvestmentPortfolio) => {
    const book: 'USD' | 'SAR' = portfolio?.currency === 'USD' ? 'USD' : 'SAR';
    const cost = (portfolio.holdings ?? []).reduce((s: number, h: Holding) => {
      const avg = Number(h?.avgCost ?? 0);
      const qty = Number(h?.quantity ?? 0);
      if (!(avg > 0) || !(qty > 0)) return s;
      return s + avg * qty;
    }, 0);
    return sum + toSAR(cost, book, sarPerUsd);
  }, 0);
  const fallbackInvestedSar = Math.max(0, holdingsCostBasisSar + brokerageCashSar + totalWithdrawnSar);

  let capitalSource: InvestmentCapitalSource = 'cost_basis_fallback';
  let totalInvestedSar = fallbackInvestedSar;
  if (depositsRecordedSar > 0) {
    capitalSource = 'deposits';
    totalInvestedSar = depositsRecordedSar;
  } else if (inferredInvestedFromLedgerSar > 0) {
    const fallbackMeaningful = fallbackInvestedSar >= LEDGER_INFERRED_FALLBACK_MIN_SAR;
    const ratioOk =
      !fallbackMeaningful ||
      (inferredInvestedFromLedgerSar >= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MIN_RATIO &&
        inferredInvestedFromLedgerSar <= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MAX_RATIO);
    if (ratioOk) {
      capitalSource = 'ledger_inferred';
      totalInvestedSar = inferredInvestedFromLedgerSar;
    }
  }

  const netCapitalSar = Math.max(0, totalInvestedSar - totalWithdrawnSar);
  const totalGainLossSar = totalInvestmentsValueSar - netCapitalSar;
  const roi = sanitizeInvestmentRoiDecimal(
    netCapitalSar > 0 ? totalGainLossSar / netCapitalSar : 0,
  );

  return {
    holdingsValueSar,
    brokerageCashSar,
    totalInvestmentsValueSar,
    totalInvestedSar,
    totalWithdrawnSar,
    netCapitalSar,
    totalGainLossSar,
    roi,
    capitalSource,
    depositsRecordedSar,
    firstCapitalDepositYmd,
    inferredInvestedFromLedgerSar,
    holdingsCostBasisSar,
    fallbackInvestedSar,
    buysSar,
    sellsSar,
    dividendsSar,
    feesSar,
    vatSar,
    expectedCashFromLedgerSpotSar,
    expectedCashFromLedgerDatedSar,
  };
}

export type InvestmentPlatformCashDriftRow = {
  accountId: string;
  name: string;
  brokerSarSigned: number;
  expectedCashSpotSar: number;
  driftSar: number;
  hasLedgerFlows: boolean;
};

/**
 * Per-platform broker cash vs ledger-implied cash (spot FX), for Investments / System Health banners.
 * Matches {@link computePersonalInvestmentKpiBreakdown} aggregate identity when summed across platforms.
 */
export function computePersonalInvestmentCashDriftByPlatform(
  data: FinancialData,
  sarPerUsd: number,
): InvestmentPlatformCashDriftRow[] {
  const d = data as FinancialData & {
    personalAccounts?: Account[];
    personalInvestments?: InvestmentPortfolio[];
  };
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const investments = (d.personalInvestments ?? data.investments ?? []) as InvestmentPortfolio[];
  const personalIds = new Set(accounts.map((a) => a.id));
  const txs = (data.investmentTransactions ?? []) as InvestmentTransaction[];

  const invTxSarSpot = (t: InvestmentTransaction): number => {
    const amount = Math.abs(getInvestmentTransactionCashAmount(t as any));
    if (!(amount > 0)) return 0;
    return toSAR(amount, inferInvestmentTransactionCurrency(t as any, accounts, investments), sarPerUsd);
  };

  const rows: InvestmentPlatformCashDriftRow[] = [];
  for (const acc of accounts) {
    if (acc.type !== 'Investment' || !personalIds.has(acc.id)) continue;
    const canonicalId = resolveCanonicalAccountId(acc.id, accounts) ?? acc.id;
    const accountTxs = txs.filter(
      (t) => resolveInvestmentTransactionAccountId(t as any, accounts, investments) === canonicalId,
    );

    const hasLedgerFlows = accountTxs.some(
      (t) =>
        isInvestmentTransactionType(t.type, 'deposit') ||
        isInvestmentTransactionType(t.type, 'withdrawal') ||
        isInvestmentTransactionType(t.type, 'buy') ||
        isInvestmentTransactionType(t.type, 'sell') ||
        isInvestmentTransactionType(t.type, 'dividend') ||
        isInvestmentTransactionType(t.type, 'fee') ||
        isInvestmentTransactionType(t.type, 'vat'),
    );

    const brokerBuckets = brokerCashBucketsFromInvestmentAccount(acc);
    const brokerSarSigned = tradableCashBucketToSARSigned(brokerBuckets, sarPerUsd);

    let depositsSar = 0;
    let withdrawalsSar = 0;
    let buysSar = 0;
    let sellsSar = 0;
    let dividendsSar = 0;
    let feesSar = 0;
    let vatSar = 0;
    for (const t of accountTxs) {
      const sar = invTxSarSpot(t);
      if (isInvestmentTransactionType(t.type, 'deposit')) depositsSar += sar;
      else if (isInvestmentTransactionType(t.type, 'withdrawal')) withdrawalsSar += sar;
      else if (isInvestmentTransactionType(t.type, 'buy')) buysSar += sar;
      else if (isInvestmentTransactionType(t.type, 'sell')) sellsSar += sar;
      else if (isInvestmentTransactionType(t.type, 'dividend')) dividendsSar += sar;
      else if (isInvestmentTransactionType(t.type, 'fee')) feesSar += sar;
      else if (isInvestmentTransactionType(t.type, 'vat')) vatSar += sar;
    }
    const expectedCashSpotSar = depositsSar - buysSar + sellsSar + dividendsSar - withdrawalsSar - feesSar - vatSar;
    const driftSar = brokerSarSigned - expectedCashSpotSar;

    rows.push({
      accountId: canonicalId,
      name: String(acc.name ?? 'Investment account'),
      brokerSarSigned,
      expectedCashSpotSar,
      driftSar,
      hasLedgerFlows,
    });
  }
  return rows;
}

export function computePersonalInvestmentKpisSar(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
): PersonalInvestmentKpisSar {
  const b = computePersonalInvestmentKpiBreakdown(data, sarPerUsd, getAvailableCashForAccount);
  return {
    holdingsValueSar: b.holdingsValueSar,
    brokerageCashSar: b.brokerageCashSar,
    totalInvestmentsValueSar: b.totalInvestmentsValueSar,
    totalInvestedSar: b.totalInvestedSar,
    totalWithdrawnSar: b.totalWithdrawnSar,
    netCapitalSar: b.netCapitalSar,
    totalGainLossSar: b.totalGainLossSar,
    roi: b.roi,
  };
}

/** Same rollup as Investments hub headline: platforms (live rollup) + commodities + Sukuk assets vs net capital incl. commodity + Sukuk cost bases. */
export type HeadlinePersonalInvestmentRoi = {
  /** Total gain/(loss) in SAR (exposure − net capital). */
  totalGainLossSar: number;
  /** Exposure: platforms + commodities + Sukuk market values (SAR). */
  totalExposureSar: number;
  /** Capital: platform net capital + commodity purchase SAR + Sukuk cost (SAR). */
  netCapitalSar: number;
  /** Gain / net capital — **decimal** (e.g. 0.12 = 12%); matches Dashboard KPI card convention. */
  roi: number;
  capitalSource: InvestmentCapitalSource;
  platformsRollupSar: number;
  commoditiesValueSar: number;
  sukukPositionsValueSar: number;
  /** Intraday / live move in SAR — platforms only (same as rollup). */
  platformsDailyPnLSar: number;
  /** Approximate commodity position move in SAR (live quote × qty). */
  commoditiesDailyPnLSar: number;
  /** Same inputs as headline net capital decomposition (single source for reconciliation UI). */
  commodityCostSar: number;
  sukukPositionsCostSar: number;
  /** Platform net capital used in headline (deposits − withdrawals when funding exists). */
  platformNetForHeadlineSar: number;
  economicDeployedPlatformSar: number;
  /** True only when deposit history is missing and cost-basis + cash raised the denominator. */
  economicFloorApplied: boolean;
  depositsRecordedSar: number;
  totalWithdrawnSar: number;
  /** Platform net capital before any incomplete-books floor (deposits − withdrawals, or inferred/fallback net). */
  ledgerPlatformNetCapitalSar: number;
  /** Deposits exist, net invested is 0, but present value remains — remaining MV is profit after recovering principal. */
  principalFullyRecovered: boolean;
  firstCapitalDepositYmd: string | null;
  investmentAgeDays: number | null;
};

/**
 * Single headline ROI path for Dashboard, Investments hub, and monthly KPI reconciliation.
 * Uses `computePersonalPlatformsRollupSAR` (same as Investments cards), not raw `getAllInvestmentsValueInSAR`.
 */
export function computeHeadlinePersonalInvestmentRoiDecimal(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
  simulatedPrices: SimulatedPriceMap = {},
): HeadlinePersonalInvestmentRoi {
  const breakdown = computePersonalInvestmentKpiBreakdown(data, sarPerUsd, getAvailableCashForAccount);
  const getCash = getAvailableCashForAccount as (id: string) => { SAR: number; USD: number };

  const { subtotalSAR: platformsRollupSar, dailyPnLSAR: platformsDailyPnLSar } = computePersonalPlatformsRollupSAR(
    data,
    sarPerUsd,
    simulatedPrices,
    getCash,
  );
  const {
    valueSAR: commoditiesValueSar,
    dailyDeltaSAR: commoditiesDailyPnLSar,
  } = computePersonalCommoditiesContributionSAR(data, sarPerUsd, simulatedPrices);

  const allCommodities = getPersonalCommodityHoldings(data);
  const commodityCost = allCommodities.reduce(
    (sum: number, ch: { purchaseValue?: number }) => sum + toSAR(ch.purchaseValue ?? 0, 'SAR', sarPerUsd),
    0,
  );

  const sukukPositionsValueSar = sumPersonalSukukPositionsSar(data, sarPerUsd);
  const sukukPositionsCostSar = sumPersonalSukukPositionsCostSar(data, sarPerUsd);

  const totalExposureSar = platformsRollupSar + commoditiesValueSar + sukukPositionsValueSar;
  /**
   * When deposit history exists, net invested is deposits − withdrawals. Do not floor at cost basis + idle
   * cash — that treats remaining book cost as still-invested capital after withdrawals and understates growth.
   * Floor only when deposits are missing (ledger_inferred / cost_basis_fallback) so incomplete books do not
   * produce triple-digit ROI.
   */
  const economicDeployedSar = Math.max(0, breakdown.holdingsCostBasisSar + breakdown.brokerageCashSar);
  const { platformNetSar: platformNetForHeadline, economicFloorApplied } = resolveHeadlinePlatformNetCapitalSar({
    capitalSource: breakdown.capitalSource,
    ledgerNetCapitalSar: breakdown.netCapitalSar,
    economicDeployedSar,
  });
  const netCapitalSar = Math.max(0, platformNetForHeadline + commodityCost + sukukPositionsCostSar);
  const totalGainLossSar = totalExposureSar - netCapitalSar;
  const principalFullyRecovered =
    breakdown.capitalSource === 'deposits' &&
    breakdown.depositsRecordedSar > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR &&
    netCapitalSar <= HEADLINE_NEAR_ZERO_NET_INVESTED_SAR &&
    totalExposureSar > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR;
  const roi = principalFullyRecovered
    ? 0
    : sanitizeInvestmentRoiDecimal(netCapitalSar > 0 ? totalGainLossSar / netCapitalSar : 0);
  const firstCapitalDepositYmd = safeCapitalDepositYmd(breakdown.firstCapitalDepositYmd);
  const investmentAgeDays = investmentAgeDaysFromYmd(firstCapitalDepositYmd);

  return {
    totalGainLossSar,
    totalExposureSar,
    netCapitalSar,
    roi,
    capitalSource: breakdown.capitalSource,
    platformsRollupSar,
    commoditiesValueSar,
    sukukPositionsValueSar,
    platformsDailyPnLSar,
    commoditiesDailyPnLSar,
    commodityCostSar: commodityCost,
    sukukPositionsCostSar,
    platformNetForHeadlineSar: platformNetForHeadline,
    economicDeployedPlatformSar: economicDeployedSar,
    economicFloorApplied,
    depositsRecordedSar: breakdown.depositsRecordedSar,
    totalWithdrawnSar: breakdown.totalWithdrawnSar,
    ledgerPlatformNetCapitalSar: breakdown.netCapitalSar,
    principalFullyRecovered,
    firstCapitalDepositYmd,
    investmentAgeDays,
  };
}
