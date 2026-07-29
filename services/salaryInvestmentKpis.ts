import type {
  Account,
  FinancialData,
  Holding,
  InvestmentPortfolio,
  InvestmentTransaction,
  SalaryInvestmentTargets,
  Transaction,
} from '../types';
import { roundMoney } from '../utils/money';
import {
  dateInRange,
  financialMonthIsoKey,
  financialMonthKey,
  financialMonthKeysEndingAt,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { classifyIncomeTransaction } from './incomeTaxonomy';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { fxMapForKpiCompute, getSarPerUsdForCalendarDay } from './fxDailySeries';
import { toSAR } from '../utils/currencyMath';
import {
  inferInvestmentTransactionCurrency,
  resolveInvestmentTransactionAccountId,
} from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { isInvestmentReconciliationCashAdjustment } from './reconciliation/cashDelta';
import { detectSalaryIncomeSar, type SalaryDetection } from './transactionIntelligence';

export type SalaryInvestmentMonthRow = {
  monthKey: string;
  salaryIncomeSar: number;
  investedFromSalarySar: number;
  investedTotalSar: number;
  deployedSar: number;
  fundedNotDeployedSar: number;
  salaryInvestRatePct: number;
  targetVsActualGapSar: number;
};

export type SalaryInvestmentBreakdownRow = {
  key: string;
  label: string;
  sar: number;
  targetSar?: number;
};

export type SalaryInvestmentKpis = {
  monthKey: string;
  monthLabel: string;
  salaryIncomeSarMonth: number;
  investedFromSalarySarMonth: number;
  investedTotalSarMonth: number;
  salaryInvestRatePct: number;
  fundedNotDeployedSar: number;
  surplusAfterSpendingSar: number;
  deployedSarMonth: number;
  targetVsActualGapSar: number;
  salaryFundingByPlatform: SalaryInvestmentBreakdownRow[];
  salaryFundingByAssetClass: SalaryInvestmentBreakdownRow[];
  salaryFundingByGoal: SalaryInvestmentBreakdownRow[];
  unlinkedBrokerFundingSar: number;
  nonSalaryFundingSar: number;
  salaryDetectionConfidence: SalaryDetection['confidence'];
  history: SalaryInvestmentMonthRow[];
  hasTargetsConfigured: boolean;
  hasSalarySignal: boolean;
  hasFundingThisMonth: boolean;
  settings: SalaryInvestmentTargets | undefined;
};

type MonthComputeArgs = {
  data: FinancialData;
  monthKey: FinancialMonthKey;
  monthStartDay: number;
  salaryCategoryAllowlist: Set<string>;
  includeBonus: boolean;
  salaryAccountIds: Set<string>;
  fundingFallbackAccountIds: Set<string>;
  transactions: Transaction[];
  accounts: Account[];
  investments: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
  fxMap: Record<string, number>;
  exchangeRate: number;
};

function monthLabelFromKey(key: FinancialMonthKey): string {
  return `${key.year}-${String(key.month).padStart(2, '0')}`;
}

function classifyMonthSalaryIncomeSar(
  txs: Transaction[],
  accountMap: Map<string, Account>,
  data: FinancialData,
  exchangeRate: number,
  fxMap: Record<string, number>,
  salaryCategoryAllowlist: Set<string>,
  includeBonus: boolean,
): number {
  let total = 0;
  for (const tx of txs) {
    const classification = classifyIncomeTransaction(tx);
    if (!classification) continue;
    if (classification === 'bonus' && !includeBonus) continue;
    const manualCategory = String(tx.budgetCategory ?? tx.category ?? '').trim().toLowerCase();
    const description = String(tx.description ?? '').trim().toLowerCase();
    const matchesAllowlist =
      salaryCategoryAllowlist.size > 0 &&
      [...salaryCategoryAllowlist].some((candidate) => manualCategory === candidate || description.includes(candidate));
    const isSalaryLike = classification === 'salary' || matchesAllowlist || (includeBonus && classification === 'bonus');
    if (!isSalaryLike) continue;
    const account = accountMap.get(tx.accountId);
    const currency = account?.currency === 'USD' ? 'USD' : 'SAR';
    const rate = currency === 'USD'
      ? getSarPerUsdForCalendarDay(tx.date.slice(0, 10), data, exchangeRate, fxMap)
      : exchangeRate;
    total += toSAR(Math.abs(Number(tx.amount) || 0), currency, rate);
  }
  return roundMoney(total);
}

function buildHoldingLookup(investments: InvestmentPortfolio[]): Map<string, Holding> {
  const lookup = new Map<string, Holding>();
  for (const portfolio of investments) {
    for (const holding of portfolio.holdings ?? []) {
      const symbol = String(holding.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      lookup.set(`${portfolio.id}:${symbol}`, holding);
      if (!lookup.has(symbol)) lookup.set(symbol, holding);
    }
  }
  return lookup;
}

function computeMonthRow(args: MonthComputeArgs): Omit<SalaryInvestmentKpis, 'monthKey' | 'monthLabel' | 'history' | 'hasTargetsConfigured' | 'hasSalarySignal' | 'hasFundingThisMonth' | 'settings' | 'salaryDetectionConfidence'> {
  const {
    data,
    monthKey,
    monthStartDay,
    salaryCategoryAllowlist,
    includeBonus,
    salaryAccountIds,
    fundingFallbackAccountIds,
    transactions,
    accounts,
    investments,
    investmentTransactions,
    fxMap,
    exchangeRate,
  } = args;
  const range = financialMonthRangeFromKey(monthKey, monthStartDay);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const holdingsLookup = buildHoldingLookup(investments);
  const monthlyTransactions = transactions.filter((tx) => dateInRange(tx.date, range.start, range.end));
  const monthlyExpensesSar = monthlyTransactions.reduce((sum, tx) => {
    if (!countsAsExpenseForCashflowKpi(tx)) return sum;
    const account = accountMap.get(tx.accountId);
    const currency = account?.currency === 'USD' ? 'USD' : 'SAR';
    const rate = currency === 'USD'
      ? getSarPerUsdForCalendarDay(tx.date.slice(0, 10), data, exchangeRate, fxMap)
      : exchangeRate;
    return sum + toSAR(Math.abs(Number(tx.amount) || 0), currency, rate);
  }, 0);
  const salaryIncomeSarMonth = classifyMonthSalaryIncomeSar(
    monthlyTransactions,
    accountMap,
    data,
    exchangeRate,
    fxMap,
    salaryCategoryAllowlist,
    includeBonus,
  );

  const fundingByPlatform = new Map<string, SalaryInvestmentBreakdownRow>();
  const fundingByAssetClass = new Map<string, SalaryInvestmentBreakdownRow>();
  const fundingByGoal = new Map<string, SalaryInvestmentBreakdownRow>();
  let investedFromSalarySarMonth = 0;
  let investedTotalSarMonth = 0;
  let deployedSarMonth = 0;
  let unlinkedBrokerFundingSar = 0;
  let nonSalaryFundingSar = 0;

  const monthlyInvestmentTxs = investmentTransactions.filter((tx) =>
    dateInRange(tx.date, range.start, range.end),
  );

  /** Preferred funding cash that is also a salary source — used only for unlinked deposits. */
  const unlinkedSalaryAssumption =
    [...fundingFallbackAccountIds].some((id) => salaryAccountIds.has(id));

  for (const tx of monthlyInvestmentTxs) {
    if (
      isInvestmentReconciliationCashAdjustment(
        tx as InvestmentTransaction & { note?: string; description?: string; category?: string | null },
      )
    ) continue;
    if (tx.type !== 'deposit') continue;
    const accountId = resolveInvestmentTransactionAccountId(tx, accounts, investments);
    const platform = accountMap.get(accountId);
    const txCurrency = inferInvestmentTransactionCurrency(tx, accounts, investments);
    const txRate = txCurrency === 'USD'
      ? getSarPerUsdForCalendarDay(tx.date.slice(0, 10), data, exchangeRate, fxMap)
      : exchangeRate;
    const amountSar = roundMoney(toSAR(getInvestmentTransactionCashAmount(tx), txCurrency, txRate));
    if (!Number.isFinite(amountSar) || amountSar <= 0) continue;

    investedTotalSarMonth += amountSar;
    const fundingAccountId = String(tx.linkedCashAccountId ?? '').trim();
    // Linked: salary only when the cash source is a salary account.
    // Unlinked: attribute to salary only when preferred funding cash is itself a salary source
    // (never match broker/platform ids against cash funding roles).
    const isSalaryFunded = fundingAccountId
      ? salaryAccountIds.has(fundingAccountId)
      : unlinkedSalaryAssumption;
    if (isSalaryFunded) {
      investedFromSalarySarMonth += amountSar;
      const key = platform?.id || accountId || 'unknown-platform';
      const label = platform?.name || 'Unlinked platform';
      const previous = fundingByPlatform.get(key) ?? { key, label, sar: 0 };
      fundingByPlatform.set(key, { ...previous, sar: roundMoney(previous.sar + amountSar) });
    } else if (fundingAccountId) {
      nonSalaryFundingSar += amountSar;
    } else {
      unlinkedBrokerFundingSar += amountSar;
    }
  }

  // Proportional salary share of deployment when mixed funding exists this month.
  const salaryDeployShare =
    investedFromSalarySarMonth > 0 && investedTotalSarMonth > 0
      ? Math.min(1, investedFromSalarySarMonth / investedTotalSarMonth)
      : investedFromSalarySarMonth > 0
        ? 1
        : 0;

  for (const tx of monthlyInvestmentTxs) {
    if (
      isInvestmentReconciliationCashAdjustment(
        tx as InvestmentTransaction & { note?: string; description?: string; category?: string | null },
      )
    ) continue;
    if (tx.type !== 'buy') continue;
    const txCurrency = inferInvestmentTransactionCurrency(tx, accounts, investments);
    const txRate = txCurrency === 'USD'
      ? getSarPerUsdForCalendarDay(tx.date.slice(0, 10), data, exchangeRate, fxMap)
      : exchangeRate;
    const amountSar = roundMoney(toSAR(getInvestmentTransactionCashAmount(tx), txCurrency, txRate));
    if (!Number.isFinite(amountSar) || amountSar <= 0) continue;

    deployedSarMonth += amountSar;
    if (salaryDeployShare <= 0) continue;
    const salaryAttributedSar = roundMoney(amountSar * salaryDeployShare);
    if (salaryAttributedSar <= 0) continue;
    const portfolioId = String(tx.portfolioId ?? '').trim();
    const symbolKey = String(tx.symbol ?? '').trim().toUpperCase();
    const holding = holdingsLookup.get(`${portfolioId}:${symbolKey}`) ?? holdingsLookup.get(symbolKey);
    const assetClass = String(holding?.assetClass ?? 'Other').trim() || 'Other';
    const goalKey = String(holding?.goalId ?? '').trim();
    const assetPrev = fundingByAssetClass.get(assetClass) ?? { key: assetClass, label: assetClass, sar: 0 };
    fundingByAssetClass.set(assetClass, { ...assetPrev, sar: roundMoney(assetPrev.sar + salaryAttributedSar) });
    if (goalKey) {
      const goalPrev = fundingByGoal.get(goalKey) ?? { key: goalKey, label: goalKey, sar: 0 };
      fundingByGoal.set(goalKey, { ...goalPrev, sar: roundMoney(goalPrev.sar + salaryAttributedSar) });
    }
  }

  const salaryAttributedDeployedSar = roundMoney(deployedSarMonth * salaryDeployShare);
  const fundedNotDeployedSar = roundMoney(Math.max(0, investedFromSalarySarMonth - salaryAttributedDeployedSar));
  const salaryInvestRatePct = salaryIncomeSarMonth > 0
    ? Math.max(0, Math.min(1000, (investedFromSalarySarMonth / salaryIncomeSarMonth) * 100))
    : 0;

  return {
    salaryIncomeSarMonth: roundMoney(salaryIncomeSarMonth),
    investedFromSalarySarMonth: roundMoney(investedFromSalarySarMonth),
    investedTotalSarMonth: roundMoney(investedTotalSarMonth),
    salaryInvestRatePct: roundMoney(salaryInvestRatePct),
    fundedNotDeployedSar,
    surplusAfterSpendingSar: roundMoney(salaryIncomeSarMonth - monthlyExpensesSar - investedFromSalarySarMonth),
    deployedSarMonth: roundMoney(deployedSarMonth),
    targetVsActualGapSar: 0,
    salaryFundingByPlatform: [...fundingByPlatform.values()].sort((a, b) => b.sar - a.sar),
    salaryFundingByAssetClass: [...fundingByAssetClass.values()].sort((a, b) => b.sar - a.sar),
    salaryFundingByGoal: [...fundingByGoal.values()].sort((a, b) => b.sar - a.sar),
    unlinkedBrokerFundingSar: roundMoney(unlinkedBrokerFundingSar),
    nonSalaryFundingSar: roundMoney(nonSalaryFundingSar),
  };
}

export function computeSalaryInvestmentKpis(
  data: FinancialData | null | undefined,
  exchangeRate: number,
): SalaryInvestmentKpis | null {
  if (!data) return null;
  const monthStartDay = resolveMonthStartDayFromData(data);
  const currentKey = financialMonthKey(new Date(), monthStartDay);
  const settings = data.settings?.salaryInvestmentTargets;
  const salaryCategoryAllowlist = new Set(
    (settings?.salaryIncomeCategories ?? ['salary'])
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const includeBonus = settings?.includeBonusInSalaryIncome === true;
  const accounts = getPersonalAccounts(data);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const salaryAccountIds = new Set<string>();
  const fundingFallbackAccountIds = new Set<string>();
  for (const account of accounts) {
    if (account.accountRole === 'salary_receiving') salaryAccountIds.add(account.id);
    if (account.accountRole === 'investment_funding') fundingFallbackAccountIds.add(account.id);
  }
  if (settings?.salarySourceAccountId && accountMap.has(settings.salarySourceAccountId)) {
    salaryAccountIds.add(settings.salarySourceAccountId);
  }
  if (settings?.defaultFundingAccountId && accountMap.has(settings.defaultFundingAccountId)) {
    fundingFallbackAccountIds.add(settings.defaultFundingAccountId);
  }

  const transactions = getPersonalTransactions(data);
  const investments = getPersonalInvestments(data);
  const personalAccountIds = new Set(accounts.map((account) => account.id));
  const investmentTransactions = (data.investmentTransactions ?? []).filter((tx) =>
    personalAccountIds.has(resolveInvestmentTransactionAccountId(tx, accounts, investments)),
  );
  const fxMap = fxMapForKpiCompute(data, exchangeRate);
  const current = computeMonthRow({
    monthKey: currentKey,
    data,
    monthStartDay,
    salaryCategoryAllowlist,
    includeBonus,
    salaryAccountIds,
    fundingFallbackAccountIds,
    transactions,
    accounts,
    investments,
    investmentTransactions,
    fxMap,
    exchangeRate,
  });

  const targetSar = roundMoney(Number(settings?.monthlyInvestTargetSar) || 0);
  const history = financialMonthKeysEndingAt(new Date(), 6, monthStartDay).map((key) => {
    const row = computeMonthRow({
      monthKey: key,
      data,
      monthStartDay,
      salaryCategoryAllowlist,
      includeBonus,
      salaryAccountIds,
      fundingFallbackAccountIds,
      transactions,
      accounts,
      investments,
      investmentTransactions,
      fxMap,
      exchangeRate,
    });
    return {
      monthKey: financialMonthIsoKey(key),
      salaryIncomeSar: row.salaryIncomeSarMonth,
      investedFromSalarySar: row.investedFromSalarySarMonth,
      investedTotalSar: row.investedTotalSarMonth,
      deployedSar: row.deployedSarMonth,
      fundedNotDeployedSar: row.fundedNotDeployedSar,
      salaryInvestRatePct: row.salaryInvestRatePct,
      targetVsActualGapSar: roundMoney(Math.max(0, targetSar - row.investedFromSalarySarMonth)),
    };
  });
  const detection = detectSalaryIncomeSar(transactions, accounts, exchangeRate, 6, data);

  const platformTargets = settings?.platformTargets ?? {};
  const assetClassTargets = settings?.assetClassTargets ?? {};
  const salaryFundingByPlatform = current.salaryFundingByPlatform.map((row) => ({
    ...row,
    targetSar: platformTargets[row.key],
  }));
  const salaryFundingByAssetClass = current.salaryFundingByAssetClass.map((row) => ({
    ...row,
    targetSar: assetClassTargets[row.key],
  }));

  return {
    ...current,
    monthKey: financialMonthIsoKey(currentKey),
    monthLabel: monthLabelFromKey(currentKey),
    targetVsActualGapSar: roundMoney(Math.max(0, targetSar - current.investedFromSalarySarMonth)),
    salaryFundingByPlatform,
    salaryFundingByAssetClass,
    history,
    hasTargetsConfigured:
      targetSar > 0 ||
      Object.keys(platformTargets).length > 0 ||
      Object.keys(assetClassTargets).length > 0,
    hasSalarySignal: current.salaryIncomeSarMonth > 0 || detection.detected,
    hasFundingThisMonth: current.investedTotalSarMonth > 0 || current.deployedSarMonth > 0,
    settings,
    salaryDetectionConfidence: detection.confidence,
  };
}
