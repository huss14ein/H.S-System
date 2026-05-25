/**
 * Canonical Finova figures for AI prompts — headline NW, financial-month cashflow,
 * budgets, goals, holdings. Keeps model replies aligned with Dashboard KPIs.
 */
import type { Budget, FinancialData, Holding, Transaction } from '../types';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { computePersonalHeadlineNetWorthSar } from './personalNetWorth';
import { computeDashboardKpiSnapshot, financialMonthNetCashflowSar } from './dashboardKpiSnapshot';
import { formatGoalsProgressForPrompt } from './goalResolvedTotals';
import {
  financialMonthLabel,
  financialMonthRange,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { sortByNewestFirst } from '../utils/sortRecency';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';

export type AiGroundingBuildOptions = {
  data: FinancialData;
  exchangeRate?: number;
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
  roiPct: number;
  overspentBudgetLines: string[];
  goalsProgress: string;
  topHoldingsLines: string[];
  recentTxLines: string[];
  promptBlock: string;
};

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

export function buildAiPersonalWealthGrounding(opts: AiGroundingBuildOptions): AiPersonalWealthGrounding {
  const { data } = opts;
  const exchangeRate = opts.exchangeRate ?? resolveSarPerUsd(data, undefined);
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

  const personalTx = sortByNewestFirst(
    ((data as { personalTransactions?: Transaction[] }).personalTransactions ?? data.transactions ?? []) as Transaction[],
  );
  const monthlyTx = personalTx.filter((t) => {
    const d = new Date(t.date);
    return d >= finRange.start && d <= finRange.end;
  });

  const overspentBudgetLines: string[] = [];
  for (const budget of data.budgets ?? []) {
    if (budget.month !== finRange.key.month || budget.year !== finRange.key.year) continue;
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
  const recentTxLines = personalTx.slice(0, 8).map((t) => {
    const cat = t.budgetCategory || t.category || 'Uncategorized';
    return `${t.date?.slice(0, 10) ?? ''}: ${(t.description || '').slice(0, 48)} | ${fmt(Math.abs(Number(t.amount) || 0))} SAR | ${cat}`;
  });

  const roiPct = snap ? snap.roi * 100 : 0;
  const promptBlock = [
    '=== FINOVA GROUND TRUTH (use only these figures for SAR amounts; do not invent) ===',
    `As-of: ${asOfDate}`,
    `Financial month: ${finLabel}`,
    `Headline net worth (SAR): ${fmt(headline.netWorth)}`,
    `Liquid cash (SAR): ${fmt(snap?.liquidCashSar ?? 0)}`,
    `This financial month — income ${fmt(cf.monthlyIncomeSar)} SAR, expenses ${fmt(cf.monthlyExpensesSar)} SAR, net ${fmt(cf.monthlyPnLSar)} SAR`,
    `Investment ROI (% on net capital, app): ${roiPct.toFixed(2)}`,
    overspentBudgetLines.length ? `Budget pressure (≥75% used): ${overspentBudgetLines.join('; ')}` : 'Budget pressure: none ≥75% this month',
    `Goals (resolved linked wealth): ${goalsProgress || 'none set'}`,
    holdings.length ? `Top holdings: ${holdings.join('; ')}` : 'Top holdings: none',
    recentTxLines.length ? `Recent transactions (newest first): ${recentTxLines.join(' | ')}` : 'Recent transactions: none',
    '=== END GROUND TRUTH ===',
  ].join('\n');

  return {
    sarPerUsd: headline.sarPerUsd,
    asOfDate,
    financialMonthLabel: finLabel,
    netWorthSar: headline.netWorth,
    liquidCashSar: snap?.liquidCashSar ?? 0,
    monthlyPnLSar: cf.monthlyPnLSar,
    monthlyIncomeSar: cf.monthlyIncomeSar,
    monthlyExpensesSar: cf.monthlyExpensesSar,
    roiPct,
    overspentBudgetLines,
    goalsProgress,
    topHoldingsLines: holdings,
    recentTxLines,
    promptBlock,
  };
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
  const txs = sortByNewestFirst(
    ((data as { personalTransactions?: Transaction[] })?.personalTransactions ?? data?.transactions ?? []) as Transaction[],
  );

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
  const { start } = financialMonthRange(new Date(), monthStartDay);
  for (const t of txs) {
    if (!countsAsExpenseForCashflowKpi(t)) continue;
    if (new Date(t.date) < start) continue;
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
