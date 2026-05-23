/**
 * Dividend Tracker — separates **received** (ledger) from **expected** (plan).
 */

import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { toSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';
import { computeTopDividendEarnersFromLedger, type DividendLedgerEarner } from './dividendLedgerRankings';
import { loadAllExpectedOverrides, loadExpectedAnnualOverride } from './dividendExpectedOverrides';
import {
  aggregateQuarterlyYtd,
  buildUpcomingDividendPayouts,
  effectivePayoutMonths,
  inferDividendCadence,
  inferTypicalPayoutMonthsFromLedger,
  receivedQuartersYtdSar,
  type DividendCadence,
  type UpcomingDividendPayout,
} from './dividendExpectedSchedule';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import {
  financialMonthIsoKey,
  financialMonthKey,
  financialMonthKeysEndingAt,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';

export type ExpectedDividendSource =
  | 'none'
  | 'manual'
  | 'holding_yield'
  | 'market_dps'
  | 'market_yield';

export interface DividendHoldingPlanRow {
  holdingId: string;
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name: string;
  quantity: number;
  bookCurrency: 'USD' | 'SAR';
  receivedYtdSar: number;
  received12mSar: number;
  expectedAnnualSar: number;
  expectedSource: ExpectedDividendSource;
  expectedYtdPaceSar: number;
  pacePct: number | null;
  forwardYieldPct: number | null;
  holdingYieldPct: number | null;
  marketYieldPct: number | null;
  marketDpsAnnual: number | null;
  marketDpsCurrency: 'USD' | 'SAR' | null;
  dividendDistribution: 'Reinvest' | 'Payout' | null;
  dividendPayoutCadence: Holding['dividendPayoutCadence'];
  typicalPayoutMonths: number[];
  cadence: DividendCadence;
  quarterlyExpectedSar: number;
  receivedQuartersYtd: [number, number, number, number];
  hasManualOverride: boolean;
}

export interface DividendTrackerCoverage {
  totalHoldings: number;
  withoutPlan: number;
  withoutReceivedYtd: number;
}

export interface DividendQuarterlyTotals {
  expectedPerQuarter: number;
  receivedByQuarter: [number, number, number, number];
}

export interface DividendTrackerSummary {
  receivedYtdSar: number;
  received12mSar: number;
  expectedAnnualSar: number;
  expectedYtdPaceSar: number;
  pacePct: number | null;
  holdingsWithExpected: number;
  holdingsWithReceived12m: number;
}

export interface DividendChartMonthRow {
  name: string;
  monthKey: string;
  receivedSar: number;
  expectedSar: number;
  [platformKey: string]: string | number;
}

export type MarketFundDividend = {
  dividendYieldPct?: number | null;
  dividendPerShareAnnual?: number | null;
  dividendCashCurrency?: string | null;
};

function txSar(
  t: InvestmentTransaction,
  accounts: Account[],
  portfolios: InvestmentPortfolio[],
  data: FinancialData | null,
  uiExchangeRate: number,
): number {
  return investmentTransactionCashAmountSarDated({
    tx: t,
    accounts,
    portfolios,
    data,
    uiExchangeRate,
  });
}

function dayOfYearFraction(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear() + 1, 0, 1);
  const elapsed = now.getTime() - start.getTime();
  const span = end.getTime() - start.getTime();
  return span > 0 ? Math.min(1, Math.max(0, elapsed / span)) : 0;
}

export function resolveExpectedAnnualSar(args: {
  holding: Holding;
  bookCurrency: 'USD' | 'SAR';
  sarPerUsd: number;
  market?: MarketFundDividend | null;
  /** @deprecated legacy localStorage; prefer holding.expectedAnnualDividendSar */
  manualAnnualSar?: number | null;
}): { annualSar: number; source: ExpectedDividendSource; holdingYieldPct: number | null } {
  const { holding, bookCurrency, sarPerUsd, market } = args;
  const dbPlan = Number(holding.expectedAnnualDividendSar);
  if (Number.isFinite(dbPlan) && dbPlan > 0) {
    return { annualSar: dbPlan, source: 'manual', holdingYieldPct: Number(holding.dividendYield) || null };
  }
  const manual = args.manualAnnualSar;
  if (manual != null && Number.isFinite(manual) && manual > 0) {
    return { annualSar: manual, source: 'manual', holdingYieldPct: Number(holding.dividendYield) || null };
  }

  const qty = Math.max(0, Number(holding.quantity) || 0);
  const cv = Number(holding.currentValue) || 0;
  const holdingYield = Number(holding.dividendYield);
  if (holdingYield > 0 && holdingYield <= 100 && cv > 0 && qty > 0) {
    return {
      annualSar: toSAR(cv * (holdingYield / 100), bookCurrency, sarPerUsd),
      source: 'holding_yield',
      holdingYieldPct: holdingYield,
    };
  }

  const dps = market?.dividendPerShareAnnual;
  const dpsCur = (market?.dividendCashCurrency === 'SAR' ? 'SAR' : 'USD') as 'USD' | 'SAR';
  if (dps != null && dps > 0 && qty > 0) {
    return {
      annualSar: toSAR(dps * qty, dpsCur, sarPerUsd),
      source: 'market_dps',
      holdingYieldPct: holdingYield > 0 ? holdingYield : null,
    };
  }

  const mktYield = Number(market?.dividendYieldPct);
  if (mktYield > 0 && mktYield <= 100 && cv > 0) {
    return {
      annualSar: toSAR(cv * (mktYield / 100), bookCurrency, sarPerUsd),
      source: 'market_yield',
      holdingYieldPct: holdingYield > 0 ? holdingYield : null,
    };
  }

  return { annualSar: 0, source: 'none', holdingYieldPct: holdingYield > 0 ? holdingYield : null };
}

export function buildDividendTrackerModel(args: {
  data: FinancialData;
  personalInvestments: InvestmentPortfolio[];
  dividendTransactions: InvestmentTransaction[];
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  uiExchangeRate: number;
  sarPerUsd: number;
  fundMap?: Record<string, MarketFundDividend>;
  personalAccountIds: string[];
  now?: Date;
}): {
  summary: DividendTrackerSummary;
  holdingRows: DividendHoldingPlanRow[];
  topReceived: DividendLedgerEarner[];
  topExpected: Array<{ symbol: string; name: string; expectedSar: number }>;
  monthlyChart: DividendChartMonthRow[];
  platformStackKeys: { key: string; label: string }[];
  monthlyChartHasActivity: boolean;
  recentDividendTransactions: InvestmentTransaction[];
  coverage: DividendTrackerCoverage;
  quarterlyTotals: DividendQuarterlyTotals;
  upcomingPayouts: UpcomingDividendPayout[];
} {
  const {
    data,
    personalInvestments,
    dividendTransactions,
    accounts,
    portfolios,
    uiExchangeRate,
    sarPerUsd,
    fundMap = {},
    personalAccountIds,
  } = args;
  const now = args.now ?? new Date();
  const year = now.getFullYear();
  const ytdFrac = dayOfYearFraction(now);
  const overrides = loadAllExpectedOverrides();

  const monthStartDay = resolveMonthStartDayFromData(data);
  const finKeys12 = financialMonthKeysEndingAt(now, 12, monthStartDay);
  const twelveMonthsAgo = financialMonthRangeFromKey(finKeys12[0], monthStartDay).start;
  const monthKeys = finKeys12.map((k) => financialMonthIsoKey(k));

  let receivedYtdSar = 0;
  let received12mSar = 0;
  const receivedYtdByKey = new Map<string, number>();
  const received12mByKey = new Map<string, number>();

  const personalAccountIdSet = new Set(personalAccountIds);
  const platformKey = (accountId: string) => `pf_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const byAccountMonth = new Map<string, Map<string, number>>();

  for (const t of dividendTransactions) {
    const txDate = new Date(t.date);
    if (isNaN(txDate.getTime())) continue;
    const sar = txSar(t, accounts, portfolios, data, uiExchangeRate);
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    const pid = String(t.portfolioId ?? '').trim();
    const rowKey = pid && sym ? `${pid}:${sym}` : sym;

    if (txDate.getFullYear() === year) {
      receivedYtdSar += sar;
      if (rowKey) receivedYtdByKey.set(rowKey, (receivedYtdByKey.get(rowKey) ?? 0) + sar);
    }
    if (txDate >= twelveMonthsAgo) {
      received12mSar += sar;
      if (rowKey) received12mByKey.set(rowKey, (received12mByKey.get(rowKey) ?? 0) + sar);
      const monthKey = financialMonthIsoKey(financialMonthKey(txDate, monthStartDay));
      const aid = resolveCanonicalAccountId(String(t.accountId ?? ''), accounts);
      if (personalAccountIdSet.has(aid)) {
        if (!byAccountMonth.has(aid)) byAccountMonth.set(aid, new Map());
        const m = byAccountMonth.get(aid)!;
        m.set(monthKey, (m.get(monthKey) || 0) + sar);
      }
    }
  }

  const accountIdsFromTx = [...byAccountMonth.keys()].filter((id) => personalAccountIdSet.has(id));
  const sumForAccount = (accountId: string) =>
    [...(byAccountMonth.get(accountId)?.values() ?? [])].reduce((s, v) => s + v, 0);
  accountIdsFromTx.sort((a, b) => sumForAccount(b) - sumForAccount(a));

  const MAX_PLATFORMS = 8;
  const displayAccountIds = accountIdsFromTx.slice(0, MAX_PLATFORMS);
  const otherAccountIds = accountIdsFromTx.slice(MAX_PLATFORMS);
  const accountLabel = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return (a?.name?.trim() || 'Investment platform').slice(0, 36);
  };
  const platformStackKeys = [
    ...displayAccountIds.map((id) => ({ key: platformKey(id), label: accountLabel(id) })),
    ...(otherAccountIds.length ? [{ key: platformKey('__other__'), label: 'Other platforms' }] : []),
  ];

  const holdingRows: DividendHoldingPlanRow[] = [];
  let expectedAnnualSar = 0;

  for (const p of personalInvestments) {
    const portfolioId = String(p.id ?? '').trim();
    const portfolioName = (p.name || 'Portfolio').trim();
    const book = resolveInvestmentPortfolioCurrency(p) as 'USD' | 'SAR';
    for (const h of p.holdings ?? []) {
      if ((h as Holding).holdingType === 'commodity') continue;
      const sym = String(h.symbol ?? '').trim().toUpperCase();
      if (!sym) continue;
      const key = `${portfolioId}:${sym}`;
      const market = fundMap[sym];
      const manual = overrides[key];
      const { annualSar, source, holdingYieldPct } = resolveExpectedAnnualSar({
        holding: h,
        bookCurrency: book,
        sarPerUsd,
        market,
        manualAnnualSar: manual,
      });
      expectedAnnualSar += annualSar;
      const receivedYtd = receivedYtdByKey.get(key) ?? 0;
      const received12m = received12mByKey.get(key) ?? 0;
      const expectedYtdPace = annualSar * ytdFrac;
      const pacePct =
        expectedYtdPace > 0.01 ? Math.min(200, (receivedYtd / expectedYtdPace) * 100) : null;
      const cv = Number(h.currentValue) || 0;
      const forwardYieldPct =
        cv > 0 && annualSar > 0
          ? (annualSar / toSAR(cv, book, sarPerUsd)) * 100
          : holdingYieldPct;

      const distribution =
        h.dividendDistribution === 'Reinvest' || h.dividendDistribution === 'Payout'
          ? h.dividendDistribution
          : null;
      const inferredMonths = inferTypicalPayoutMonthsFromLedger({
        dividendTransactions,
        portfolioId,
        symbol: sym,
      });
      const typicalPayoutMonths =
        effectivePayoutMonths(h).length > 0 ? effectivePayoutMonths(h) : inferredMonths;
      const cadence = inferDividendCadence({
        dividendDistribution: distribution ?? undefined,
        dividendPayoutCadence: h.dividendPayoutCadence,
      });
      const receivedQuartersYtd = receivedQuartersYtdSar({
        dividendTransactions,
        portfolioId,
        symbol: sym,
        accounts,
        portfolios,
        data,
        uiExchangeRate,
        year,
      });

      holdingRows.push({
        holdingId: String(h.id ?? ''),
        portfolioId,
        portfolioName,
        symbol: sym,
        name: String(h.name || sym),
        quantity: Number(h.quantity) || 0,
        bookCurrency: book,
        receivedYtdSar: receivedYtd,
        received12mSar: received12m,
        expectedAnnualSar: annualSar,
        expectedSource: source,
        expectedYtdPaceSar: expectedYtdPace,
        pacePct,
        forwardYieldPct: forwardYieldPct ?? null,
        holdingYieldPct,
        marketYieldPct:
          market?.dividendYieldPct != null && Number.isFinite(market.dividendYieldPct)
            ? market.dividendYieldPct
            : null,
        marketDpsAnnual:
          market?.dividendPerShareAnnual != null && market.dividendPerShareAnnual > 0
            ? market.dividendPerShareAnnual
            : null,
        marketDpsCurrency:
          market?.dividendCashCurrency === 'SAR'
            ? 'SAR'
            : market?.dividendCashCurrency
              ? 'USD'
              : null,
        dividendDistribution: distribution,
        dividendPayoutCadence: h.dividendPayoutCadence,
        typicalPayoutMonths,
        cadence,
        quarterlyExpectedSar: annualSar > 0 ? annualSar / 4 : 0,
        receivedQuartersYtd,
        hasManualOverride:
          (h.expectedAnnualDividendSar != null && Number(h.expectedAnnualDividendSar) > 0) ||
          loadExpectedAnnualOverride(portfolioId, sym) != null,
      });
    }
  }

  holdingRows.sort((a, b) => b.expectedAnnualSar - a.expectedAnnualSar || b.received12mSar - a.received12mSar);

  const expectedYtdPaceSar = expectedAnnualSar * ytdFrac;
  const summary: DividendTrackerSummary = {
    receivedYtdSar,
    received12mSar,
    expectedAnnualSar,
    expectedYtdPaceSar,
    pacePct: expectedYtdPaceSar > 0.01 ? Math.min(200, (receivedYtdSar / expectedYtdPaceSar) * 100) : null,
    holdingsWithExpected: holdingRows.filter((r) => r.expectedAnnualSar > 0.01).length,
    holdingsWithReceived12m: holdingRows.filter((r) => r.received12mSar > 0.01).length,
  };

  const monthlyExpectedPerMonth = expectedAnnualSar > 0 ? expectedAnnualSar / 12 : 0;
  const monthlyChart: DividendChartMonthRow[] = monthKeys.map((mk) => {
    const [y, m] = mk.split('-').map(Number);
    const name =
      monthStartDay === 1
        ? new Date(mk + '-02').toLocaleString('default', { month: 'short', year: '2-digit' })
        : `${m}/${String(y).slice(-2)}`;
    const row: DividendChartMonthRow = { name, monthKey: mk, receivedSar: 0, expectedSar: monthlyExpectedPerMonth };
    let total = 0;
    for (const aid of displayAccountIds) {
      const v = byAccountMonth.get(aid)?.get(mk) ?? 0;
      row[platformKey(aid)] = v;
      total += v;
    }
    let other = 0;
    for (const aid of otherAccountIds) other += byAccountMonth.get(aid)?.get(mk) ?? 0;
    if (otherAccountIds.length) {
      row[platformKey('__other__')] = other;
      total += other;
    }
    row.receivedSar = total;
    return row;
  });

  const monthlyChartHasActivity = monthlyChart.some((r) => r.receivedSar > 0.01);

  const nameBySymbol: Record<string, string> = {};
  for (const r of holdingRows) nameBySymbol[r.symbol] = r.name;

  const topReceived = computeTopDividendEarnersFromLedger({
    dividendTransactions,
    accounts,
    portfolios,
    data,
    uiExchangeRate,
    nameBySymbol,
    limit: 5,
  });

  const topExpected = [...holdingRows]
    .filter((r) => r.expectedAnnualSar > 0.01)
    .sort((a, b) => b.expectedAnnualSar - a.expectedAnnualSar)
    .slice(0, 5)
    .map((r) => ({ symbol: r.symbol, name: r.name, expectedSar: r.expectedAnnualSar }));

  const recentDividendTransactions = [...dividendTransactions]
    .filter((t) => !isNaN(new Date(t.date).getTime()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  const coverage: DividendTrackerCoverage = {
    totalHoldings: holdingRows.length,
    withoutPlan: holdingRows.filter((r) => r.expectedAnnualSar <= 0.01).length,
    withoutReceivedYtd: holdingRows.filter((r) => r.receivedYtdSar <= 0.01).length,
  };

  const quarterlyTotals = aggregateQuarterlyYtd({ holdingRows });
  const upcomingPayouts = buildUpcomingDividendPayouts({
    holdingRows: holdingRows.map((r) => ({
      portfolioId: r.portfolioId,
      portfolioName: r.portfolioName,
      symbol: r.symbol,
      name: r.name,
      expectedAnnualSar: r.expectedAnnualSar,
      dividendDistribution: r.dividendDistribution ?? undefined,
      dividendPayoutCadence: r.dividendPayoutCadence,
      typicalPayoutMonths: r.typicalPayoutMonths,
    })),
    now,
  });

  return {
    summary,
    holdingRows,
    topReceived,
    topExpected,
    monthlyChart,
    platformStackKeys,
    monthlyChartHasActivity,
    recentDividendTransactions,
    coverage,
    quarterlyTotals,
    upcomingPayouts,
  };
}

export function expectedSourceLabel(source: ExpectedDividendSource): string {
  switch (source) {
    case 'manual':
      return 'Your plan (manual)';
    case 'holding_yield':
      return 'Holding yield %';
    case 'market_dps':
      return 'Market DPS hint';
    case 'market_yield':
      return 'Market yield hint';
    default:
      return 'Not set';
  }
}
