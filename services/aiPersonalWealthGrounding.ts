/**
 * Canonical Finova figures for AI prompts — headline NW, financial-month cashflow,
 * budgets, goals, holdings. Keeps model replies aligned with Dashboard KPIs.
 */
import type { Budget, FinancialData, Holding } from '../types';
import { toSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { computePersonalHeadlineNetWorthSar, computePersonalNetWorthBreakdownSAR } from './personalNetWorth';
import { computeDashboardKpiSnapshot, financialMonthNetCashflowSar } from './dashboardKpiSnapshot';
import { presentHeadlineInvestmentGrowth } from './extendedMetricsPresentation';
import { formatGoalsProgressForPrompt } from './goalResolvedTotals';
import {
  financialMonthLabel,
  financialMonthRange,
  resolveMonthStartDayFromData,
  dateInRange,
  budgetsForFinancialMonthView,
} from '../utils/financialMonth';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { sortByNewestFirst } from '../utils/sortRecency';
import {
  getPersonalTransactions,
  getPersonalSukukPositions,
  getPersonalLiabilities,
  getPersonalAccounts,
} from '../utils/wealthScope';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { sumRewardsFiatSar, rewardsExpiringWithinDays } from './rewards/rewardsDomain';
import { buildAvailableLiquiditySnapshot } from './availableLiquidity';
import { computeSalaryInvestmentKpis } from './salaryInvestmentKpis';
import { sumTradableCashSarFromInvestmentAccounts } from './investmentCashLedger';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';

export type AiGroundingBuildOptions = {
  data: FinancialData;
  /** Required — same SAR/USD as Dashboard / headline NW (`useCanonicalFinancialMetrics().sarPerUsd`). */
  exchangeRate: number;
  getAvailableCashForAccount?: (id: string) => { SAR: number; USD: number };
  simulatedPrices?: SimulatedPriceMap;
};

export type AiPersonalWealthGrounding = {
  /** Resolved SAR/USD — same as headline NW / Dashboard KPIs. */
  sarPerUsd: number;
  asOfDate: string;
  financialMonthLabel: string;
  netWorthSar: number;
  liquidCashSar: number;
  monthlyPnLSar: number;
  monthlyIncomeSar: number;
  monthlyExpensesSar: number;
  salaryInvestRatePct: number;
  investedFromSalarySar: number;
  fundedNotDeployedSar: number;
  roiPct: number;
  netInvestedSar: number;
  /** Present value of personal investment exposure (SAR). */
  presentValueSar: number;
  principalFullyRecovered: boolean;
  overspentBudgetLines: string[];
  goalsProgress: string;
  topHoldingsLines: string[];
  recentTxLines: string[];
  /** Active liability / debt total (SAR). */
  totalDebtSar: number;
  /** Tradable cash on investment accounts (SAR). */
  investableCashSar: number;
  /** Months of essential expenses covered by liquid cash. */
  emergencyFundMonths: number;
  /** Largest holding as % of investment exposure (0–100). */
  topConcentrationPct: number;
  /** Sum of platforms daily P/L (SAR). */
  platformsDailyPnLSar: number;
  /** Hint when credit-card / loan min-payments look material. */
  unpaidInstallmentsHint: string | null;
  /** Rough trailing dividend income run-rate (SAR) when dividend txs exist. */
  dividendRunRateSar: number;
  promptBlock: string;
};

export type AiPageDeltaPage =
  | 'investments'
  | 'cashflow'
  | 'plan'
  | 'liabilities'
  | 'goals'
  | 'zakat'
  | 'recovery'
  | 'rebalancer'
  | 'dashboard'
  | 'summary'
  | string;

const fmt = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0';

function budgetMonthlyLimit(b: Budget): number {
  if (b.period === 'yearly') return b.limit / 12;
  if (b.period === 'weekly') return b.limit * (52 / 12);
  if (b.period === 'daily') return b.limit * (365 / 12);
  return b.limit;
}

function topHoldingsLines(
  data: FinancialData,
  sarPerUsd: number,
  simulatedPrices: SimulatedPriceMap,
  limit = 5,
): string[] {
  const portfolios = (data as { personalInvestments?: { holdings?: Holding[] }[] }).personalInvestments
    ?? data.investments
    ?? [];
  const rows: { symbol: string; valueSar: number }[] = [];
  for (const p of portfolios) {
    const book = resolveInvestmentPortfolioCurrency(p);
    for (const h of p.holdings ?? []) {
      const curVal = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd);
      const valueSar = toSAR(curVal, book, sarPerUsd);
      if (valueSar > 0 && h.symbol) rows.push({ symbol: h.symbol, valueSar });
    }
  }
  return rows
    .sort((a, b) => b.valueSar - a.valueSar)
    .slice(0, limit)
    .map((r) => `${r.symbol}: ${fmt(r.valueSar)} SAR`);
}

function directSukukLines(data: FinancialData, sarPerUsd: number, limit = 3): string[] {
  return getPersonalSukukPositions(data)
    .filter((p) => p.status === 'active' && (p.outstandingPrincipal ?? 0) > 0)
    .map((p) => ({
      name: p.name,
      valueSar: toSAR(Math.max(0, Number(p.outstandingPrincipal) || 0), p.currency === 'USD' ? 'USD' : 'SAR', sarPerUsd),
    }))
    .sort((a, b) => b.valueSar - a.valueSar)
    .slice(0, limit)
    .map((r) => `Sukuk ${r.name}: ${fmt(r.valueSar)} SAR`);
}

export function buildAiPersonalWealthGrounding(opts: AiGroundingBuildOptions): AiPersonalWealthGrounding {
  const { data } = opts;
  const exchangeRate = Number(opts.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error('buildAiPersonalWealthGrounding requires a positive exchangeRate (canonical SAR/USD).');
  }
  const getCash = opts.getAvailableCashForAccount;
  const simulatedPrices = opts.simulatedPrices ?? {};
  const now = new Date();
  const monthStartDay = resolveMonthStartDayFromData(data);
  const finRange = financialMonthRange(now, monthStartDay);
  const asOfDate = now.toISOString().slice(0, 10);
  const finLabel = financialMonthLabel(finRange.key, monthStartDay);

  const headline = computePersonalHeadlineNetWorthSar(data, exchangeRate, {
    getAvailableCashForAccount: getCash,
    simulatedPrices,
  });
  const snap = computeDashboardKpiSnapshot(data, exchangeRate, getCash ?? (() => ({ SAR: 0, USD: 0 })), simulatedPrices);
  const cf = financialMonthNetCashflowSar(data, exchangeRate);

  const personalTx = sortByNewestFirst(getPersonalTransactions(data));
  const monthlyTx = personalTx.filter((t) => dateInRange(t.date, finRange.start, finRange.end));

  const overspentBudgetLines: string[] = [];
  for (const budget of budgetsForFinancialMonthView(data.budgets ?? [], finRange.key, monthStartDay)) {
    const spent = monthlyTx
      .filter((t) => countsAsExpenseForCashflowKpi(t) && (t.budgetCategory === budget.category || t.category === budget.category))
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
    const limit = budgetMonthlyLimit(budget);
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    if (pct >= 75) {
      overspentBudgetLines.push(`${budget.category}: ${fmt(spent)} / ${fmt(limit)} SAR (${pct.toFixed(0)}% of monthly limit)`);
    }
  }

  const goalsProgress = formatGoalsProgressForPrompt(data, headline.sarPerUsd);
  const holdings = topHoldingsLines(data, headline.sarPerUsd, simulatedPrices);
  const sukukLines = directSukukLines(data, headline.sarPerUsd);
  const rewardsSar = sumRewardsFiatSar(data, headline.sarPerUsd);
  const expiringN = rewardsExpiringWithinDays(
    data.rewardsAccounts ?? [],
    data.rewardsTransactions ?? [],
    30,
  ).length;
  const monthsTarget = Number(data.settings?.emergencyFundMonthsTarget) || 6;
  const liq = buildAvailableLiquiditySnapshot({
    data,
    liquidCashSar: snap?.liquidCashSar ?? 0,
    monthlyEssentialExpenseSar: cf.monthlyExpensesSar,
    monthsTarget,
  });
  const recentTxLines = personalTx.slice(0, 8).map((t) => {
    const cat = t.budgetCategory || t.category || 'Uncategorized';
    return `${t.date?.slice(0, 10) ?? ''}: ${(t.description || '').slice(0, 48)} | ${fmt(Math.abs(Number(t.amount) || 0))} SAR | ${cat}`;
  });

  const presentedRoi = presentHeadlineInvestmentGrowth(snap?.headlineInvestmentExposure);
  const roiPct = presentedRoi?.roiPct ?? (snap ? snap.roi * 100 : 0);
  const salaryInvestment = computeSalaryInvestmentKpis(data, exchangeRate);

  const nwOptions = getCash ? { getAvailableCashForAccount: getCash, simulatedPrices } : { simulatedPrices };
  const breakdown = computePersonalNetWorthBreakdownSAR(data, exchangeRate, nwOptions);
  const totalDebtSar = breakdown.totalDebt ?? 0;
  const scopeAccounts = getPersonalAccounts(data);
  const allAccounts = data.accounts ?? scopeAccounts;
  const investableCashSar = sumTradableCashSarFromInvestmentAccounts(
    scopeAccounts,
    allAccounts,
    headline.sarPerUsd,
  );

  const emergencyFundMonths =
    cf.monthlyExpensesSar > 0 ? (snap?.liquidCashSar ?? 0) / cf.monthlyExpensesSar : 0;

  let platformsDailyPnLSar = 0;
  let investmentsTotalSar = presentedRoi?.presentValueSar ?? snap?.headlineInvestmentExposure?.totalExposureSar ?? 0;
  if (getCash) {
    try {
      const exposure = computeHeadlinePersonalInvestmentRoiDecimal(
        data,
        headline.sarPerUsd,
        getCash,
        simulatedPrices,
      );
      platformsDailyPnLSar = Number(exposure.platformsDailyPnLSar) || 0;
      investmentsTotalSar = exposure.totalExposureSar || investmentsTotalSar;
    } catch {
      /* keep zeros */
    }
  }

  const topHoldingSar = (() => {
    const portfolios =
      (data as { personalInvestments?: { holdings?: Holding[] }[] }).personalInvestments ??
      data.investments ??
      [];
    let max = 0;
    for (const p of portfolios) {
      const book = resolveInvestmentPortfolioCurrency(p);
      for (const h of p.holdings ?? []) {
        const curVal = effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, headline.sarPerUsd);
        const valueSar = toSAR(curVal, book, headline.sarPerUsd);
        if (valueSar > max) max = valueSar;
      }
    }
    return max;
  })();
  const topConcentrationPct =
    investmentsTotalSar > 0 ? Math.min(100, (topHoldingSar / investmentsTotalSar) * 100) : 0;

  const liabilities = getPersonalLiabilities(data).filter((l) => l.status === 'Active' && l.type !== 'Receivable');
  const minPaySum = liabilities.reduce((s, l) => s + (Number(l.minPayment) || 0), 0);
  const unpaidInstallmentsHint =
    minPaySum > 0
      ? `Active liabilities with min payments totaling ~${fmt(minPaySum)} SAR/mo across ${liabilities.length} account(s).`
      : liabilities.length > 0
        ? `${liabilities.length} active debt account(s); min-payment schedule not set on all.`
        : null;

  const yearStart = `${now.getFullYear()}-01-01`;
  let dividendRunRateSar = 0;
  for (const t of data.investmentTransactions ?? []) {
    if (String(t.type || '').toLowerCase() !== 'dividend') continue;
    const d = String(t.date || '').slice(0, 10);
    if (d < yearStart) continue;
    const amt = Math.abs(Number((t as { total?: number }).total) || Number((t as { amount?: number }).amount) || 0);
    dividendRunRateSar += amt;
  }

  const promptBlock = [
    '=== FINOVA GROUND TRUTH (use only these figures for SAR amounts; do not invent) ===',
    `As-of: ${asOfDate}`,
    `Financial month: ${finLabel}`,
    `Headline net worth (SAR): ${fmt(headline.netWorth)}`,
    `Liquid cash (SAR): ${fmt(snap?.liquidCashSar ?? 0)}`,
    `Investable / tradable platform cash (SAR): ${fmt(investableCashSar)}`,
    `Total debt (SAR): ${fmt(totalDebtSar)}`,
    `Emergency fund months (liquid / month expenses): ${emergencyFundMonths.toFixed(1)}`,
    `Top holding concentration: ${topConcentrationPct.toFixed(1)}% of investments`,
    `Platforms daily P/L (SAR): ${fmt(platformsDailyPnLSar)}`,
    unpaidInstallmentsHint ? `Liability payment hint: ${unpaidInstallmentsHint}` : null,
    dividendRunRateSar > 0 ? `YTD dividend run-rate (SAR, recorded): ${fmt(dividendRunRateSar)}` : null,
    `Available liquidity (SAR): ${fmt(liq.availableLiquiditySar)} (reserved ${fmt(liq.reservedLiquiditySar)}; EF floor ${fmt(liq.emergencyFundFloorSar)})`,
    `Rewards memo (SAR, not cash/Zakat): ${fmt(rewardsSar)}${expiringN ? `; ${expiringN} lot(s) expire ≤30d` : ''}`,
    `This financial month — income ${fmt(cf.monthlyIncomeSar)} SAR, expenses ${fmt(cf.monthlyExpensesSar)} SAR, net ${fmt(cf.monthlyPnLSar)} SAR`,
    `Salary to investment — salary ${fmt(salaryInvestment?.salaryIncomeSarMonth ?? 0)} SAR, funded from salary ${fmt(salaryInvestment?.investedFromSalarySarMonth ?? 0)} SAR, invest rate ${(salaryInvestment?.salaryInvestRatePct ?? 0).toFixed(1)}%, funded not deployed ${fmt(salaryInvestment?.fundedNotDeployedSar ?? 0)} SAR`,
    presentedRoi
      ? `Investment growth — present value ${fmt(presentedRoi.presentValueSar)} SAR, net invested ${fmt(presentedRoi.netInvestedSar)} SAR (deposits ${fmt(presentedRoi.depositsRecordedSar)} − withdrawals ${fmt(presentedRoi.totalWithdrawnSar)}${snap?.headlineInvestmentExposure?.capitalSource === 'mixed' ? '; hybrid: incomplete portfolios floor at cost + cash' : snap?.headlineInvestmentExposure?.economicFloorApplied ? '; cost floor applied' : ''}), growth ${fmt(presentedRoi.growthSar)} SAR, ROI ${presentedRoi.valueDisplay}${presentedRoi.investmentAgeLabel ? `, ${presentedRoi.investmentAgeLabel}` : ''}`
      : `Investment ROI (% on net invested, app): ${roiPct.toFixed(2)}`,
    overspentBudgetLines.length ? `Budget pressure (≥75% used): ${overspentBudgetLines.join('; ')}` : 'Budget pressure: none ≥75% this month',
    `Goals (resolved linked wealth): ${goalsProgress || 'none set'}`,
    holdings.length ? `Top holdings: ${holdings.join('; ')}` : 'Top holdings: none',
    sukukLines.length ? `Direct Sukuk contracts: ${sukukLines.join('; ')}` : 'Direct Sukuk contracts: none',
    recentTxLines.length ? `Recent transactions (newest first): ${recentTxLines.join(' | ')}` : 'Recent transactions: none',
    '=== END GROUND TRUTH ===',
  ]
    .filter((x): x is string => !!x)
    .join('\n');

  return {
    sarPerUsd: headline.sarPerUsd,
    asOfDate,
    financialMonthLabel: finLabel,
    netWorthSar: headline.netWorth,
    liquidCashSar: snap?.liquidCashSar ?? 0,
    monthlyPnLSar: cf.monthlyPnLSar,
    monthlyIncomeSar: cf.monthlyIncomeSar,
    monthlyExpensesSar: cf.monthlyExpensesSar,
    salaryInvestRatePct: salaryInvestment?.salaryInvestRatePct ?? 0,
    investedFromSalarySar: salaryInvestment?.investedFromSalarySarMonth ?? 0,
    fundedNotDeployedSar: salaryInvestment?.fundedNotDeployedSar ?? 0,
    roiPct,
    netInvestedSar: presentedRoi?.netInvestedSar ?? 0,
    presentValueSar: investmentsTotalSar,
    principalFullyRecovered: presentedRoi?.principalFullyRecovered === true,
    overspentBudgetLines,
    goalsProgress,
    topHoldingsLines: holdings,
    recentTxLines,
    totalDebtSar,
    investableCashSar,
    emergencyFundMonths,
    topConcentrationPct,
    platformsDailyPnLSar,
    unpaidInstallmentsHint,
    dividendRunRateSar,
    promptBlock,
  };
}

/**
 * Page-specific delta pack appended after wealth ground truth.
 * Keep short — page coaches add only facts visible on that surface.
 */
export function buildAiPageDelta(
  page: AiPageDeltaPage,
  data: FinancialData,
  extras?: Record<string, unknown> | null,
): string {
  const lines: string[] = [`=== PAGE DELTA (${page}) ===`];
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        lines.push(`${k}: ${v}`);
      } else if (Array.isArray(v)) {
        lines.push(`${k}: ${JSON.stringify(v).slice(0, 800)}`);
      } else if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v).slice(0, 800)}`);
      }
    }
  }
  if (page === 'liabilities') {
    const debts = getPersonalLiabilities(data)
      .filter((l) => l.status === 'Active' && l.type !== 'Receivable')
      .slice(0, 8)
      .map((l) => `${l.name} (${l.type}): ${fmt(Number(l.amount) || 0)} min ${fmt(Number(l.minPayment) || 0)}`);
    if (debts.length) lines.push(`Debt lines: ${debts.join('; ')}`);
  }
  if (page === 'goals') {
    lines.push(`Goals count: ${(data.goals ?? []).length}`);
  }
  if (page === 'cashflow') {
    lines.push(`Budgets count: ${(data.budgets ?? []).length}`);
  }
  lines.push('=== END PAGE DELTA ===');
  return lines.join('\n');
}

export type CategorySuggestionGrounding = {
  description: string;
  amountSar?: number;
  txDate?: string;
  txType?: string;
  priorCategoryHints: string[];
  topSpendCategories: string[];
  promptLines: string[];
};

/** History-aware hints for transaction categorization (no invented spend totals). */
export function buildCategorySuggestionGrounding(
  data: FinancialData | null | undefined,
  description: string,
  allowedCategories: string[],
  opts?: { amount?: number; date?: string; type?: string },
): CategorySuggestionGrounding {
  const desc = description.trim();
  const descKey = desc.toLowerCase().slice(0, 80);
  const txs = sortByNewestFirst(getPersonalTransactions(data));

  const priorCounts = new Map<string, number>();
  for (const t of txs) {
    const d = (t.description || '').toLowerCase();
    if (!d || (!d.includes(descKey.slice(0, 12)) && !descKey.includes(d.slice(0, 12)))) continue;
    const cat = (t.budgetCategory || t.category || '').trim();
    if (!cat) continue;
    priorCounts.set(cat, (priorCounts.get(cat) ?? 0) + 1);
  }
  const priorCategoryHints = [...priorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => `${c} (${n} prior match${n > 1 ? 'es' : ''})`);

  const spendByCat = new Map<string, number>();
  const monthStartDay = resolveMonthStartDayFromData(data);
  const { start, end } = financialMonthRange(new Date(), monthStartDay);
  for (const t of txs) {
    if (!countsAsExpenseForCashflowKpi(t)) continue;
    if (!dateInRange(t.date, start, end)) continue;
    const cat = (t.budgetCategory || t.category || '').trim();
    if (!cat) continue;
    spendByCat.set(cat, (spendByCat.get(cat) ?? 0) + Math.abs(Number(t.amount) || 0));
  }
  const topSpendCategories = [...spendByCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c, v]) => `${c} (${fmt(v)} SAR this financial month)`);

  const promptLines = [
    `Description: "${desc}"`,
    opts?.amount != null ? `Amount: ${fmt(opts.amount)} SAR` : null,
    opts?.date ? `Date: ${opts.date.slice(0, 10)}` : null,
    opts?.type ? `Type: ${opts.type}` : null,
    priorCategoryHints.length ? `Prior labels for similar text: ${priorCategoryHints.join('; ')}` : 'Prior labels: none',
    topSpendCategories.length ? `Active spend categories this month: ${topSpendCategories.join('; ')}` : null,
    `Allowed categories (pick exactly one): [${allowedCategories.join(', ')}]`,
  ].filter((x): x is string => !!x);

  return {
    description: desc,
    amountSar: opts?.amount,
    txDate: opts?.date,
    txType: opts?.type,
    priorCategoryHints,
    topSpendCategories,
    promptLines,
  };
}

export type AnalysisChartRow = { name: string; value: number };
export type TrendChartRow = { name: string; income: number; expenses: number };

/** Serialize chart bundles for AI prompts (SAR amounts as shown on page). */
export function formatAnalysisChartsForPrompt(
  spendingData: AnalysisChartRow[],
  trendData: TrendChartRow[],
  compositionData: AnalysisChartRow[],
): string {
  const spend = spendingData
    .slice(0, 8)
    .map((d) => `${d.name} ${fmt(d.value)} SAR`)
    .join('; ');
  const trend = trendData
    .map((d) => `${d.name}: income ${fmt(d.income)} / expenses ${fmt(d.expenses)} SAR`)
    .join('; ');
  const comp = compositionData.map((d) => `${d.name} ${fmt(d.value)} SAR`).join('; ');
  return [
    spend ? `Spending by category: ${spend}` : 'Spending by category: none',
    trend ? `Financial-month trend: ${trend}` : 'Financial-month trend: none',
    comp ? `Balance-sheet slices: ${comp}` : 'Balance-sheet slices: none',
  ].join('\n');
}
