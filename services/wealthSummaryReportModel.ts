/**
 * Single source of truth for wealth summary exports (Settings, Summary) and related KPIs.
 * Mirrors Summary page calculations so JSON/CSV/HTML match on-screen metrics.
 */

import type { Account, FinancialData, TradeCurrency } from '../types';
import { computeEmergencyFundMetrics, type EmergencyFundMetrics } from '../hooks/useEmergencyFund';
import { getAllInvestmentsValueInSAR, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { getPersonalWealthData } from '../utils/wealthScope';
import { buildHouseholdBudgetPlan, buildHouseholdEngineInputFromData } from './householdBudgetEngine';
import { deriveCashflowStressSummary } from './householdBudgetStress';
import { computeDisciplineScore, type DisciplineScoreSummary } from './disciplineScoreEngine';
import { computeLiquidityRunwayFromData, type LiquidityRunwaySummary } from './liquidityRunwayEngine';
import { computePersonalNetWorthBreakdownSAR } from './personalNetWorth';
import type { WealthSummaryReportInput } from './reportingEngine';
import { computeRiskLaneFromData, type RiskLaneContext } from './riskLaneEngine';
import { runShockDrill, type ShockDrillResult } from './shockDrillEngine';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { computeLiquidNetWorth } from './liquidNetWorth';
import { inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';

export type GetAvailableCashFn = (accountId: string) => { SAR: number; USD: number };

export interface FinancialMetricsCore {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  savingsRate: number;
  debtToAssetRatio: number;
  investmentStyle: string;
  netWorthTrend: number;
}

export interface FinancialMetricsWithEf extends FinancialMetricsCore {
  emergencyFundMonths: number;
  efStatus: 'green' | 'yellow' | 'red';
  efTrend: string;
  emergencyShortfall: number;
  emergencyTargetAmount: number;
}

export interface InvestmentTreemapRow {
  avgCost?: number;
  quantity?: number;
  currentValue?: number;
  /** When set, treemap sizes use SAR (consistent with Summary net worth currency). */
  currentValueSar?: number;
  name?: string;
  symbol?: string;
  portfolioCurrency?: string;
  gainLoss: number;
  gainLossPercent: number;
  [k: string]: unknown;
}

export interface CashflowStressSummary {
  level: string;
  summary: string;
  flags: string[];
  affordabilityPressureMonths?: number;
}

export interface WealthSummaryReportModel {
  financialMetrics: FinancialMetricsCore;
  investmentTreemapData: InvestmentTreemapRow[];
  managedWealthTotal: number;
  emergencyFund: EmergencyFundMetrics;
  financialMetricsWithEf: FinancialMetricsWithEf;
  householdStress: CashflowStressSummary | null;
  riskLane: RiskLaneContext;
  liquidityRunway: LiquidityRunwaySummary | null;
  discipline: DisciplineScoreSummary;
  shockDrill: ShockDrillResult | null;
  liquidNw: ReturnType<typeof computeLiquidNetWorth>;
  wealthSummaryReportPayload: WealthSummaryReportInput;
}

function budgetToMonthly(b: { limit: number; period?: string }): number {
  if (b.period === 'yearly') return b.limit / 12;
  if (b.period === 'weekly') return b.limit * (52 / 12);
  if (b.period === 'daily') return b.limit * (365 / 12);
  return b.limit;
}

/**
 * Monthly report extras: budget headroom vs actual spend (Dashboard-aligned) and portfolio ROI vs net capital.
 */
export function computeMonthlyReportFinancialKpis(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn
): { budgetVariance: number; roi: number } {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const d = data as { personalTransactions?: typeof data.transactions; personalAccounts?: typeof data.accounts; personalInvestments?: typeof data.investments };
  const transactions = d?.personalTransactions ?? data.transactions ?? [];
  const accounts = d?.personalAccounts ?? data.accounts ?? [];
  const investments = d?.personalInvestments ?? data.investments ?? [];
  const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));

  const monthlyTransactions = transactions.filter((t: { date: string }) => new Date(t.date) >= firstDayOfMonth);
  const monthlyExpenses = monthlyTransactions
    .filter((t: { type?: string; category?: string }) => countsAsExpenseForCashflowKpi(t))
    .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(Number(t.amount) ?? 0), 0);

  const totalBudget = (data.budgets ?? [])
    .filter((b) => b.month === currentMonth && b.year === currentYear)
    .reduce((sum, b) => sum + budgetToMonthly(b), 0);
  const budgetVariance = totalBudget - monthlyExpenses;

  const holdingsValueSAR = getAllInvestmentsValueInSAR(investments, sarPerUsd);
  let brokerageCashSAR = 0;
  accounts.forEach((acc: Account) => {
    if (acc.type === 'Investment' && personalAccountIds.has(acc.id)) {
      brokerageCashSAR += tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd);
    }
  });
  const totalInvestmentsValue = holdingsValueSAR + brokerageCashSAR;
  const invTx = (data.investmentTransactions ?? []).filter((t: { accountId?: string }) => personalAccountIds.has(t.accountId ?? ''));
  const totalInvestedSar = invTx
    .filter((t: { type?: string }) => isInvestmentTransactionType(t.type, 'deposit'))
    .reduce((sum: number, t: { total?: number; currency?: string; accountId?: string }) => {
      const currency = inferInvestmentTransactionCurrency(
        { currency: t.currency as 'SAR' | 'USD' | undefined, accountId: t.accountId ?? '' },
        accounts as Account[],
        investments as any,
      );
      return sum + toSAR(getInvestmentTransactionCashAmount(t as any), currency, sarPerUsd);
    }, 0);
  const totalWithdrawnSar = invTx
    .filter((t: { type?: string }) => isInvestmentTransactionType(t.type, 'withdrawal'))
    .reduce((sum: number, t: { total?: number; currency?: string; accountId?: string }) => {
      const currency = inferInvestmentTransactionCurrency(
        { currency: t.currency as 'SAR' | 'USD' | undefined, accountId: t.accountId ?? '' },
        accounts as Account[],
        investments as any,
      );
      return sum + toSAR(getInvestmentTransactionCashAmount(t as any), currency, sarPerUsd);
    }, 0);
  const netCapital = totalInvestedSar - totalWithdrawnSar;
  const totalGainLoss = totalInvestmentsValue - netCapital;
  const roi = netCapital > 0 ? totalGainLoss / netCapital : 0;

  return { budgetVariance, roi };
}

export function computeWealthSummaryReportModel(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn
): WealthSummaryReportModel {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const transactions = (data as { personalTransactions?: typeof data.transactions }).personalTransactions ?? data.transactions ?? [];
  const recentTransactions = transactions.filter((t) => new Date(t.date) >= firstDayOfMonth);

  const monthlyIncome = recentTransactions
    .filter((t) => countsAsIncomeForCashflowKpi(t))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
  const monthlyExpenses = recentTransactions
    .filter((t) => countsAsExpenseForCashflowKpi(t))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) ?? 0), 0);
  const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  const monthlyPnL = monthlyIncome - monthlyExpenses;

  const investments = (data as { personalInvestments?: typeof data.investments }).personalInvestments ?? data.investments ?? [];
  const nwOpts = { getAvailableCashForAccount };
  const { netWorth, totalAssets, totalDebt, totalReceivable } = computePersonalNetWorthBreakdownSAR(data, sarPerUsd, nwOpts);
  const grossAssets = totalAssets + totalReceivable;
  const debtToAssetRatio = grossAssets > 0 ? totalDebt / grossAssets : 0;

  const netWorthPrevMonth = netWorth - monthlyPnL;
  const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / Math.abs(netWorthPrevMonth)) * 100 : 0;

  const cur = (c: string | undefined): TradeCurrency => (c === 'SAR' || c === 'USD' ? c : 'USD');

  const allHoldings = investments.flatMap((p) =>
    (p.holdings || []).map((h) => ({ ...h, portfolioCurrency: p.currency }))
  );
  const investmentTreemapData: InvestmentTreemapRow[] = allHoldings.map((h) => {
    const totalCost = (h.avgCost ?? 0) * (h.quantity ?? 0);
    const gainLoss = (h.currentValue ?? 0) - totalCost;
    const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
    const currentValueSar = toSAR(Number(h.currentValue ?? 0), cur(h.portfolioCurrency), sarPerUsd);
    return { ...h, gainLoss, gainLossPercent, currentValueSar };
  });
  const totalInvestments = investmentTreemapData.reduce((sum, h) => sum + toSAR(h.currentValue ?? 0, cur(h.portfolioCurrency), sarPerUsd), 0);
  const individualStocksValue = investmentTreemapData
    .filter((h) => !['ETF', 'Index Fund', 'Bond'].some((type) => String(h.name ?? '').includes(type)))
    .reduce((sum, h) => sum + toSAR(h.currentValue ?? 0, cur(h.portfolioCurrency), sarPerUsd), 0);
  const investmentConcentration = totalInvestments > 0 ? individualStocksValue / totalInvestments : 0;
  let investmentStyle = 'Balanced';
  if (investmentConcentration > 0.6) investmentStyle = 'Aggressive (High concentration in individual stocks)';
  else if (investmentConcentration < 0.2) investmentStyle = 'Conservative (High concentration in funds/ETFs)';

  const financialMetrics: FinancialMetricsCore = {
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    savingsRate,
    debtToAssetRatio,
    investmentStyle,
    netWorthTrend,
  };

  const {
    personalAccounts,
    personalAssets,
    personalLiabilities,
    personalInvestments,
    personalCommodityHoldings: personalCommodities,
  } = getPersonalWealthData(data);
  const fullAccounts = data.accounts ?? [];
  const fullAssets = data.assets ?? [];
  const fullLiabilities = data.liabilities ?? [];
  const fullInvestments = data.investments ?? [];
  const fullCommodities = data.commodityHoldings ?? [];

  const cash = (acc: { type?: string; balance?: number }[]) =>
    acc.filter((a) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
  const cashNegative = (acc: { type?: string; balance?: number }[]) =>
    acc
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((s: number, a: { balance?: number }) => s + Math.abs(Math.min(0, a.balance ?? 0)), 0);
  const debt = (
    acc: { type?: string; balance?: number }[],
    liab: { amount?: number }[]
  ) =>
    liab
      .filter((l: { amount?: number }) => (l.amount ?? 0) < 0)
      .reduce((s: number, l: { amount?: number }) => s + Math.abs(l.amount ?? 0), 0) +
    acc
      .filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0)
      .reduce((s: number, a: { balance?: number }) => s + Math.abs(a.balance ?? 0), 0) +
    cashNegative(acc);
  const rec = (liab: { amount?: number }[]) =>
    liab.filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);

  const fullCash = cash(fullAccounts);
  const fullDebt = debt(fullAccounts, fullLiabilities);
  const fullRec = rec(fullLiabilities);
  const fullAst =
    fullAssets.reduce((s: number, a: { value?: number }) => s + (a.value ?? 0), 0) +
    fullCash +
    fullCommodities.reduce((s: number, c: { currentValue?: number }) => s + (c.currentValue ?? 0), 0) +
    getAllInvestmentsValueInSAR(fullInvestments, sarPerUsd);

  const personalCash = cash(personalAccounts);
  const personalDebt = debt(personalAccounts, personalLiabilities);
  const personalRec = rec(personalLiabilities);
  const personalAst =
    personalAssets.reduce((s: number, a: { value?: number }) => s + (a.value ?? 0), 0) +
    personalCash +
    personalCommodities.reduce((s: number, c: { currentValue?: number }) => s + (c.currentValue ?? 0), 0) +
    getAllInvestmentsValueInSAR(personalInvestments, sarPerUsd);

  const fullNW = fullAst - fullDebt + fullRec;
  const personalNW = personalAst - personalDebt + personalRec;
  const managedWealthTotal = Math.round(fullNW - personalNW);

  const emergencyFund = computeEmergencyFundMetrics(data, { exchangeRate: sarPerUsd });
  const efStatus: 'green' | 'yellow' | 'red' =
    emergencyFund.status === 'healthy' || emergencyFund.status === 'adequate'
      ? 'green'
      : emergencyFund.status === 'low'
        ? 'yellow'
        : 'red';
  const efTrend =
    emergencyFund.status === 'healthy'
      ? 'Healthy'
      : emergencyFund.status === 'adequate'
        ? 'Adequate'
        : emergencyFund.status === 'low'
          ? 'Low'
          : 'Critical';

  const financialMetricsWithEf: FinancialMetricsWithEf = {
    ...financialMetrics,
    emergencyFundMonths: emergencyFund.monthsCovered,
    efStatus,
    efTrend,
    emergencyShortfall: emergencyFund.shortfall,
    emergencyTargetAmount: emergencyFund.targetAmount,
  };

  const householdInput = buildHouseholdEngineInputFromData(
    ((data as { personalTransactions?: { date: string; type?: string; amount?: number }[] }).personalTransactions ?? data.transactions ?? []) as {
      date: string;
      type?: string;
      amount?: number;
    }[],
    ((data as { personalAccounts?: { type?: string; balance?: number }[] }).personalAccounts ?? data.accounts ?? []) as { type?: string; balance?: number }[],
    (data.goals ?? []) as Parameters<typeof buildHouseholdEngineInputFromData>[2],
    {
      year: new Date().getFullYear(),
      expectedMonthlySalary: undefined,
      adults: 2,
      kids: 0,
      profile: (data.settings?.riskProfile as string) || 'Moderate',
      monthlyOverrides: [],
    }
  );
  const householdPlan = buildHouseholdBudgetPlan(householdInput);
  const householdStress = deriveCashflowStressSummary(householdPlan) as CashflowStressSummary;

  const riskLane = computeRiskLaneFromData(data, emergencyFund.monthsCovered);
  const liquidityRunway = computeLiquidityRunwayFromData(data, { exchangeRate: sarPerUsd, getAvailableCashForAccount });
  const discipline = computeDisciplineScore(data);
  const shockDrill = runShockDrill(data, 'job_loss');
  const liquidNw = computeLiquidNetWorth(data, { getAvailableCashForAccount, exchangeRate: sarPerUsd });

  const wealthSummaryReportPayload: WealthSummaryReportInput = {
    generatedAtIso: new Date().toISOString(),
    currency: 'SAR',
    netWorth: Number(financialMetricsWithEf.netWorth) || 0,
    netWorthTrendPct: Number(financialMetricsWithEf.netWorthTrend) || 0,
    monthlyIncome: Number(financialMetricsWithEf.monthlyIncome) || 0,
    monthlyExpenses: Number(financialMetricsWithEf.monthlyExpenses) || 0,
    monthlyPnL: Number(financialMetricsWithEf.monthlyIncome) - Number(financialMetricsWithEf.monthlyExpenses),
    savingsRatePct: (Number(financialMetricsWithEf.savingsRate) || 0) * 100,
    debtToAssetRatioPct: (Number(financialMetricsWithEf.debtToAssetRatio) || 0) * 100,
    emergencyFundMonths: Number(financialMetricsWithEf.emergencyFundMonths) || 0,
    emergencyFundTargetAmount: Number(financialMetricsWithEf.emergencyTargetAmount) || 0,
    emergencyFundShortfall: Number(financialMetricsWithEf.emergencyShortfall) || 0,
    liquidNetWorth: Number(liquidNw.liquidNetWorth) || 0,
    managedWealthTotal: Number(managedWealthTotal) || 0,
    riskLane: String(riskLane.lane ?? 'Unknown'),
    liquidityRunwayMonths: Number(liquidityRunway?.monthsOfRunway ?? 0),
    disciplineScore: Number(discipline.score) || 0,
    investmentStyle: String(financialMetricsWithEf.investmentStyle ?? 'Balanced'),
    householdStressLabel: String(householdStress?.level ?? 'Not available'),
    householdStressPressureMonths: Number(householdStress?.affordabilityPressureMonths ?? 0),
    shockDrillSeverity: String(shockDrill?.template?.label ?? 'Not available'),
    shockDrillEstimatedGap: Number(shockDrill?.householdProjectedYearEndDelta ?? 0),
    holdings: investmentTreemapData.map((h) => ({
      symbol: String(h.symbol ?? '').toUpperCase(),
      name: String(h.name ?? h.symbol ?? ''),
      quantity: Number(h.quantity ?? 0),
      avgCost: Number(h.avgCost ?? 0),
      currentValue: Number(h.currentValue ?? 0),
      gainLoss: Number(h.gainLoss ?? 0),
      gainLossPct: Number(h.gainLossPercent ?? 0),
      currency: String(h.portfolioCurrency ?? 'USD'),
      currentValueSar: toSAR(Number(h.currentValue ?? 0), cur(h.portfolioCurrency), sarPerUsd),
    })),
    assets: (personalAssets ?? []).map((a: { name?: string; type?: string; value?: number }) => ({
      name: String(a.name ?? ''),
      type: String(a.type ?? ''),
      value: Number(a.value ?? 0),
    })),
    liabilities: (personalLiabilities ?? []).map((l: { name?: string; type?: string; amount?: number; status?: string }) => ({
      name: String(l.name ?? ''),
      type: String(l.type ?? ''),
      amount: Number(l.amount ?? 0),
      status: String(l.status ?? ''),
    })),
    investmentSummary: {
      platformCount: personalAccounts.filter((a: { type?: string }) => a.type === 'Investment').length,
      portfolioCount: personalInvestments.length,
      holdingCount: investmentTreemapData.length,
      platformCashSar: personalAccounts
        .filter((a: { type?: string }) => a.type === 'Investment')
        .reduce((sum: number, a: { id: string }) => sum + tradableCashBucketToSAR(getAvailableCashForAccount(a.id), sarPerUsd), 0),
      holdingsValueSar: investmentTreemapData.reduce((sum, h) => sum + Number(h.currentValueSar ?? 0), 0),
    },
    platforms: personalAccounts
      .filter((a: { type?: string }) => a.type === 'Investment')
      .map((a: { id: string; name?: string; currency?: string }) => {
        const cash = getAvailableCashForAccount(a.id);
        return {
          name: String(a.name ?? ''),
          currency: String(a.currency ?? 'SAR'),
          cashSar: Number(cash.SAR ?? 0),
          cashUsd: Number(cash.USD ?? 0),
          cashTotalSar: tradableCashBucketToSAR(cash, sarPerUsd),
        };
      }),
    portfolios: personalInvestments.map((p: { name?: string; accountId?: string; currency?: string; holdings?: { currentValue?: number }[] }) => {
      const holdings = p.holdings ?? [];
      const valueSar = holdings.reduce((sum: number, h: { currentValue?: number }) => sum + toSAR(Number(h.currentValue ?? 0), cur(p.currency), sarPerUsd), 0);
      const platform = personalAccounts.find((a: { id: string }) => a.id === p.accountId);
      return {
        name: String(p.name ?? ''),
        platformName: String(platform?.name ?? p.accountId ?? ''),
        currency: String(p.currency ?? 'USD'),
        holdingsCount: holdings.length,
        holdingsValueSar: Number(valueSar || 0),
      };
    }),
  };

  return {
    financialMetrics,
    investmentTreemapData,
    managedWealthTotal,
    emergencyFund,
    financialMetricsWithEf,
    householdStress,
    riskLane,
    liquidityRunway,
    discipline,
    shockDrill,
    liquidNw,
    wealthSummaryReportPayload,
  };
}
