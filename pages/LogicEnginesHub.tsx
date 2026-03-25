import React, { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useSelfLearning } from '../context/SelfLearningContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import AIAdvisor from '../components/AIAdvisor';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import type { LogicEnginesAiContext } from '../services/geminiService';
import type { Account, Budget, FinancialData, Goal, Liability, Page, Transaction } from '../types';

import {
  simpleReturn,
  annualizedReturn,
  timeWeightedReturn,
  totalReturnAttribution,
} from '../services/returnMeasurementEngine';
import { compareStrategies, compareAllocationModels } from '../services/strategyComparisonEngine';
import {
  allocateCashAcrossBuckets,
  detectIdleCash,
  rankLiquiditySources,
  suggestCashSweep,
  type CashBucket,
} from '../services/cashAllocationEngine';
import { portfolioFXAllocation } from '../services/fxEngine';
import {
  seasonalityAdjustedExpense,
  buildDefaultSeasonalityEvents,
  annualExpenseMonthlyProvision,
  eventMonthStressCheck,
} from '../services/seasonalityEngine';
import {
  safeWithdrawalEstimate,
  retirementFundingGap,
  retirementProjection,
  type RetirementInputs,
} from '../services/retirementEngine';
import { coverageGapCheck, insuranceRenewalAlert } from '../services/insuranceEngine';
import { sensitivityToReturn } from '../services/sensitivityEngine';
import { simulateGoalCompletionProbability, simulatePortfolioRange } from '../services/probabilisticPlanningEngine';
import { validateAssumptionRanges, type AssumptionsMap } from '../services/planningAssumptionsEngine';
import { behavioralRiskCheck, enforceTradeCooldown, preventEmotionDrivenTrade } from '../services/behavioralControlEngine';
import { explainBuyDecision, explainGoalDelay } from '../services/explainabilityEngine';
import { generateBuyTranches } from '../services/orderPlanning';
import { fieldHintEngine, statusBadgeEngine, userInputGuard } from '../services/uxGuardrailsEngine';
import { recalculateCostBasisAfterAction } from '../services/corporateActions';
import { compareToBenchmark } from '../services/benchmarkService';
import { computeRiskLaneFromData } from '../services/riskLaneEngine';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { runShockDrill } from '../services/shockDrillEngine';
import { buildBaselineScenarioTimeline } from '../services/scenarioTimelineEngine';
import { buildUnifiedFinancialContext, runCrossEngineAnalysis } from '../services/engineIntegration';
import { lifestyleGuardrailCheck, discretionarySpendApproval } from '../services/lifestyleGuardrailEngine';
import { monthlyProvisionNeeded } from '../services/provisionEngine';
import { computeLiquidityRunwayFromData } from '../services/liquidityRunwayEngine';
import { savingsRateSar, netCashFlowForMonthSarDated } from '../services/financeMetrics';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { debtStressScore } from '../services/debtEngines';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useCurrency } from '../context/CurrencyContext';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { getPersonalInvestments } from '../utils/wealthScope';

function estimateMonthlyDebtServiceSar(liabilities: Liability[]): number {
  let sum = 0;
  for (const l of liabilities) {
    if ((l.status || 'Active') !== 'Active') continue;
    const bal = Number(l.amount) || 0;
    if (bal >= 0) continue;
    const p = Math.abs(bal);
    if (l.type === 'Credit Card') sum += p * 0.025;
    else if (l.type === 'Mortgage') sum += p / 300;
    else sum += p * 0.02;
  }
  return sum;
}

function getScopedData(d: FinancialData | null) {
  if (!d) {
    return {
      accounts: [] as Account[],
      txs: [] as Transaction[],
      budgets: [] as Budget[],
      goals: [] as Goal[],
      liabilities: [] as any[],
      investmentsFlat: [] as any[],
    };
  }
  const dd = d as any;
  const accounts: Account[] = dd.personalAccounts ?? d.accounts ?? [];
  const txs: Transaction[] = dd.personalTransactions ?? d.transactions ?? [];
  const budgets: Budget[] = d.budgets ?? [];
  const goals: Goal[] = d.goals ?? [];
  const liabilities = dd.personalLiabilities ?? d.liabilities ?? [];
  const portfolios = dd.personalInvestments ?? d.investments ?? [];
  const investmentsFlat: any[] = [];
  for (const p of portfolios) {
    for (const h of p.holdings ?? []) {
      const qty = Number(h.quantity ?? h.shares ?? 0);
      const price = Number(h.currentPrice ?? 0);
      const avg = Number(h.avgCost ?? h.averageCost ?? 0);
      investmentsFlat.push({
        id: String(h.id ?? `${p.id}-${h.symbol}`),
        symbol: String(h.symbol ?? ''),
        quantity: qty,
        shares: qty,
        averageCost: avg,
        avgCost: avg,
        currentPrice: price || avg,
        type: String(h.type ?? 'Stock'),
      });
    }
  }
  return { accounts, txs, budgets, goals, liabilities, investmentsFlat };
}

interface LogicEnginesHubProps {
  setActivePage?: (p: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  dataTick?: number;
}

const LogicEnginesHub: React.FC<LogicEnginesHubProps> = ({ setActivePage, triggerPageAction, dataTick = 0 }) => {
  const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
  const { trackAction } = useSelfLearning();
  const ef = useEmergencyFund(data ?? null);
  const { formatCurrencyString } = useFormatCurrency();
  const { exchangeRate } = useCurrency();
  const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

  const scoped = useMemo(() => getScopedData(data ?? null), [data]);
  const netWorth = useMemo(
    () => computePersonalNetWorthSAR(data ?? null, sarPerUsd, { getAvailableCashForAccount }),
    [data, sarPerUsd, getAvailableCashForAccount]
  );
  /** Local NW snapshots (device); refresh when tab visible so Risk hub + Dashboard writes show up. */
  const snaps = useMemo(() => listNetWorthSnapshots(), [data?.accounts?.length, dataTick]);
  const liquidityRunway = useMemo(() => computeLiquidityRunwayFromData(data ?? null), [data]);

  const portfolioReturnPct = useMemo(() => {
    if (snaps.length < 2) return 0;
    const sorted = [...snaps].sort((a, b) => a.at.localeCompare(b.at));
    const a = sorted[sorted.length - 2]?.netWorth ?? 0;
    const b = sorted[sorted.length - 1]?.netWorth ?? 0;
    return simpleReturn(a, b);
  }, [snaps]);

  const benchmarkCmp = useMemo(() => compareToBenchmark(portfolioReturnPct, 8), [portfolioReturnPct]);
  const twrDemo = useMemo(() => timeWeightedReturn([1.2, -0.5, 2.1]), []);
  const attrDemo = useMemo(
    () => totalReturnAttribution({ priceReturnPct: 4, dividendReturnPct: 0.5, fxReturnPct: -0.2, contributionReturnPct: 0.1 }),
    []
  );

  const strategyRank = useMemo(
    () =>
      compareStrategies([
        { id: 'a', label: 'Invest surplus', projectedNetWorth: netWorth * 1.15 },
        { id: 'b', label: 'Hold cash', projectedNetWorth: netWorth * 1.02 },
        { id: 'c', label: 'Pay debt first', projectedNetWorth: netWorth * 1.08 },
      ]),
    [netWorth]
  );

  const plan = data?.investmentPlan;
  const equityPct = plan ? (plan.coreAllocation + plan.upsideAllocation) * 100 : 60;
  const allocCompare = useMemo(
    () =>
      compareAllocationModels({
        models: [
          { name: 'Your plan (approx)', equityPct, projectedReturnPct: 7 + equityPct * 0.04, volatilityPct: 12 + equityPct * 0.08 },
          { name: 'Balanced', equityPct: 50, projectedReturnPct: 6, volatilityPct: 10 },
          { name: 'Conservative', equityPct: 30, projectedReturnPct: 4.5, volatilityPct: 6 },
        ],
      }),
    [equityPct]
  );

  const cashBuckets: CashBucket[] = useMemo(
    () => [
      { id: 'op', label: 'Operating', type: 'operating', currentBalance: ef.emergencyCash * 0.2 },
      { id: 'res', label: 'Reserve', type: 'reserve', currentBalance: ef.emergencyCash * 0.8, targetMin: ef.targetAmount * 0.5 },
      { id: 'inv', label: 'Investable', type: 'investable', currentBalance: Math.max(0, netWorth * 0.02) },
    ],
    [ef.emergencyCash, ef.targetAmount, netWorth]
  );
  const monthlyCashflowSar = useMemo(() => {
    if (data) hydrateSarPerUsdDailySeries(data, exchangeRate);
    return netCashFlowForMonthSarDated(scoped.txs, scoped.accounts, new Date(), data ?? null, exchangeRate);
  }, [scoped.txs, scoped.accounts, data, exchangeRate]);
  const bucketAllocInput = useMemo(() => {
    const surplus = Math.max(0, monthlyCashflowSar.net);
    const fromLiquid = Math.max(0, ef.emergencyCash * 0.08);
    const blended = surplus > 0 ? Math.min(surplus, fromLiquid, 200_000) : Math.min(fromLiquid, 50_000);
    return Math.round(Math.max(500, blended || Math.min(5000, Math.max(0, netWorth) * 0.005)));
  }, [monthlyCashflowSar.net, ef.emergencyCash, netWorth]);
  const bucketAlloc = useMemo(
    () =>
      allocateCashAcrossBuckets(bucketAllocInput, [
        { id: 'res', targetMin: Math.min(2000, bucketAllocInput), targetMax: Math.max(bucketAllocInput, ef.targetAmount * 0.25 || 8000), priority: 1 },
        { id: 'goal', targetMin: Math.min(1000, Math.floor(bucketAllocInput * 0.2)), priority: 2 },
        { id: 'inv', targetMin: 0, priority: 3 },
      ]),
    [bucketAllocInput, ef.targetAmount]
  );
  const idleCash = useMemo(() => detectIdleCash(scoped.accounts, { minBalance: 1000 }), [scoped.accounts]);
  const liqRanked = useMemo(() => rankLiquiditySources(scoped.accounts), [scoped.accounts]);
  const sweeps = useMemo(() => suggestCashSweep(cashBuckets, Math.max(0, netWorth * 0.01)), [cashBuckets, netWorth]);

  const fxBreakdown = useMemo(() => {
    let sarNative = 0;
    let usdAsSar = 0;
    for (const a of scoped.accounts) {
      if (a.type !== 'Checking' && a.type !== 'Savings') continue;
      const bal = Math.max(0, Number(a.balance) || 0);
      if (a.currency === 'USD') usdAsSar += toSAR(bal, 'USD', sarPerUsd);
      else sarNative += toSAR(bal, 'SAR', sarPerUsd);
    }
    let invSarBook = 0;
    let invUsdAsSar = 0;
    const portfolios = getPersonalInvestments(data ?? null);
    for (const p of portfolios) {
      const ccy = resolveInvestmentPortfolioCurrency(p);
      for (const h of p.holdings ?? []) {
        const v = Math.max(0, Number(h.currentValue) || 0);
        if (ccy === 'USD') invUsdAsSar += toSAR(v, 'USD', sarPerUsd);
        else invSarBook += toSAR(v, 'SAR', sarPerUsd);
      }
    }
    const positions = [
      { currency: 'SAR', valueInBase: sarNative + invSarBook },
      { currency: 'USD', valueInBase: usdAsSar + invUsdAsSar },
    ].filter((p) => p.valueInBase > 0.01);
    return { positions, sarNative, usdAsSar, invSarBook, invUsdAsSar };
  }, [scoped.accounts, data, sarPerUsd]);
  const fxAlloc = useMemo(() => portfolioFXAllocation(fxBreakdown.positions), [fxBreakdown.positions]);
  const usdThousandInSar = useMemo(() => toSAR(1000, 'USD', sarPerUsd), [sarPerUsd]);

  const monthNow = new Date().getMonth() + 1;
  const seasonEvents = useMemo(() => buildDefaultSeasonalityEvents(), []);
  const seasonAdj = useMemo(
    () => seasonalityAdjustedExpense({ baseMonthlyExpense: ef.monthlyCoreExpenses || 3000, month: monthNow, events: seasonEvents }),
    [ef.monthlyCoreExpenses, monthNow, seasonEvents]
  );
  const annualProv = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const yearly = scoped.budgets.filter((b) => b.period === 'yearly' && b.year === y);
    if (yearly.length > 0) {
      const total = yearly.reduce((s, b) => s + (Number(b.limit) || 0), 0);
      return { amount: total / 12, label: 'From yearly budgets (÷12)' as const };
    }
    return {
      amount: annualExpenseMonthlyProvision({ annualAmount: 12_000, dueMonth: 12 }),
      label: 'Illustrative — add yearly budgets in Budgets for accuracy' as const,
    };
  }, [scoped.budgets]);
  const stressMonth = useMemo(
    () => eventMonthStressCheck({ adjustedMonthlyExpense: seasonAdj, baselineMonthlyExpense: ef.monthlyCoreExpenses || 3000 }),
    [seasonAdj, ef.monthlyCoreExpenses]
  );

  const retirementInputs: RetirementInputs = useMemo(
    () => ({
      futureMonthlyNeed: Math.max(2000, (ef.monthlyCoreExpenses || 3000) * 1.2),
      inflationRatePct: 3,
      yearsToRetirement: 25,
      currentCorpus: Math.max(0, netWorth),
      safeWithdrawalRatePct: 3.5,
    }),
    [ef.monthlyCoreExpenses, netWorth]
  );
  const swr = useMemo(() => safeWithdrawalEstimate({ riskCase: 'moderate' }), []);
  const retGap = useMemo(() => retirementFundingGap(retirementInputs), [retirementInputs]);
  const retProj = useMemo(
    () =>
      retirementProjection({
        currentCorpus: retirementInputs.currentCorpus,
        monthlyContribution: plan?.monthlyBudget ?? 0,
        yearsToRetirement: retirementInputs.yearsToRetirement,
        expectedAnnualReturnPct: 6,
      }),
    [retirementInputs, plan?.monthlyBudget]
  );
  const sensReturn = useMemo(
    () =>
      sensitivityToReturn({
        baseExpectedAnnualReturnPct: 6,
        deltaPct: 2,
        model: (r) =>
          retirementProjection({
            currentCorpus: retirementInputs.currentCorpus,
            monthlyContribution: plan?.monthlyBudget ?? 0,
            yearsToRetirement: retirementInputs.yearsToRetirement,
            expectedAnnualReturnPct: r,
          }).projectedCorpus,
      }),
    [retirementInputs, plan?.monthlyBudget]
  );

  const insuranceGaps = useMemo(
    () =>
      coverageGapCheck({
        needs: [
          { type: 'health', coverageNeeded: 500_000 },
          { type: 'life', coverageNeeded: 1_000_000 },
        ],
        existing: [],
      }),
    []
  );
  const renewalAlerts = useMemo(() => insuranceRenewalAlert({ existing: [] }), []);

  const firstGoal = scoped.goals[0];
  const goalSim = useMemo(() => {
    if (!firstGoal) return null;
    return simulateGoalCompletionProbability({
      startingValue: firstGoal.currentAmount,
      monthlyContribution: (plan?.monthlyBudget ?? 0) * ((firstGoal.savingsAllocationPercent ?? 10) / 100),
      goalAmount: firstGoal.targetAmount,
      years: 5,
      expectedAnnualReturnPct: 6,
      annualVolatilityPct: 15,
      simulations: 800,
      seed: 42,
    });
  }, [firstGoal, plan?.monthlyBudget]);

  const portRange = useMemo(
    () =>
      simulatePortfolioRange({
        startingValue: Math.max(1, netWorth),
        monthlyContribution: plan?.monthlyBudget ?? 0,
        years: 10,
        expectedAnnualReturnPct: 6,
        annualVolatilityPct: 14,
        simulations: 800,
        seed: 99,
      }),
    [netWorth, plan?.monthlyBudget]
  );

  const assumptionsDemo: AssumptionsMap = useMemo(
    () => ({
      inflationPct: { value: 3, range: { min: 0, max: 12 }, label: 'Inflation', unit: '%' },
      returnPct: { value: 6, range: { min: -5, max: 15 }, label: 'Expected return', unit: '%' },
    }),
    []
  );
  const assumptionValidation = useMemo(() => validateAssumptionRanges({ assumptions: assumptionsDemo }), [assumptionsDemo]);

  const behaviorBuy = useMemo(
    () =>
      behavioralRiskCheck({
        request: { type: 'buy', isSpeculative: false },
        ctx: {
          runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
          emergencyFundMonths: ef.monthsCovered,
        },
      }),
    [liquidityRunway, ef.monthsCovered]
  );
  const cooldown = useMemo(() => enforceTradeCooldown({ cooldownDays: 5, lastTradeAtISO: null }), []);
  const emotion = useMemo(() => preventEmotionDrivenTrade({ recentDrawdownPct: -12, requireApprovalIfRecentDrawdownPctAbove: 10 }), []);

  const explainBuy = useMemo(
    () =>
      explainBuyDecision({
        allowed: behaviorBuy.allowed,
        emergencyFundMonths: ef.monthsCovered,
        runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
      }),
    [behaviorBuy.allowed, ef.monthsCovered, liquidityRunway]
  );
  const explainGoal = useMemo(
    () =>
      firstGoal
        ? explainGoalDelay({
            goalName: firstGoal.name,
            gapPct: firstGoal.targetAmount > 0 ? (1 - firstGoal.currentAmount / firstGoal.targetAmount) * 100 : 0,
            allocPct: firstGoal.savingsAllocationPercent ?? 0,
          })
        : 'Add a goal in Goals to see delay explanations.',
    [firstGoal]
  );

  const buyTranches = useMemo(
    () => generateBuyTranches({ currentPrice: 100, totalAmount: 3000, downStepsPct: [0, 5, 10] }),
    []
  );

  const badgeDemo = useMemo(() => statusBadgeEngine({ status: liquidityRunway?.status === 'critical' ? 'critical runway' : 'on track' }), [liquidityRunway]);
  const hintDemo = fieldHintEngine({ field: 'amount' });
  const guardDemo = userInputGuard({ field: 'amount', value: -5 });

  const splitDemo = useMemo(
    () =>
      recalculateCostBasisAfterAction({
        action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
        holding: { quantity: 100, avgCost: 40 },
      }),
    []
  );

  const riskLane = useMemo(() => computeRiskLaneFromData(data ?? null, ef.monthsCovered), [data, ef.monthsCovered]);

  const income = monthlyCashflowSar.income;
  const expenses = monthlyCashflowSar.expenses;
  const srPct = useMemo(() => savingsRateSar(scoped.txs, scoped.accounts, new Date(), sarPerUsd), [scoped.txs, scoped.accounts, sarPerUsd]);
  const monthlyDebt = useMemo(
    () => estimateMonthlyDebtServiceSar(scoped.liabilities as Liability[]),
    [scoped.liabilities]
  );
  const liquid = useMemo(
    () =>
      scoped.accounts
        .filter((a) => a.type === 'Checking' || a.type === 'Savings')
        .reduce((s, a) => s + toSAR(Math.max(0, a.balance ?? 0), a.currency === 'USD' ? 'USD' : 'SAR', sarPerUsd), 0),
    [scoped.accounts, sarPerUsd]
  );
  const debtStress = useMemo(() => debtStressScore(monthlyDebt, Math.max(1, income), liquid), [monthlyDebt, income, liquid]);

  const goalAlerts = useMemo(
    () =>
      scoped.goals.map((g) => ({
        goalId: g.id,
        name: g.name,
        gapPct: g.targetAmount > 0 ? Math.max(0, (1 - g.currentAmount / g.targetAmount) * 100) : 0,
        allocPct: g.savingsAllocationPercent ?? 0,
      })),
    [scoped.goals]
  );

  const nextActions = useMemo(
    () =>
      generateNextBestActions({
        emergencyFundMonths: ef.monthsCovered,
        runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
        goalAlerts,
        debtStressScore: debtStress.score,
        salaryCoverageRatio: expenses > 0 ? income / expenses : 1,
        nwSnapshotCount: snaps.length,
      }),
    [ef.monthsCovered, liquidityRunway, goalAlerts, debtStress.score, income, expenses, snaps.length]
  );

  const shock = useMemo(() => runShockDrill(data ?? null, 'market_crash'), [data]);
  const scenarioTw = useMemo(() => buildBaselineScenarioTimeline(data ?? null, 10, netWorth * 1.25), [data, netWorth]);

  const unified = useMemo(() => {
    try {
      const ctx = buildUnifiedFinancialContext(scoped.txs, scoped.accounts, scoped.budgets, scoped.goals, scoped.investmentsFlat);
      return runCrossEngineAnalysis(ctx);
    } catch {
      return null;
    }
  }, [scoped.txs, scoped.accounts, scoped.budgets, scoped.goals, scoped.investmentsFlat]);

  const trackedSymbolCount = useMemo(() => {
    const w = (data?.watchlist ?? [])
      .map((x: { symbol?: string }) => (x.symbol ?? '').trim().toUpperCase())
      .filter((s: string): s is string => Boolean(s));
    const h = getPersonalInvestments(data ?? null).flatMap((p) =>
      (p.holdings ?? []).map((x) => (x.symbol ?? '').trim().toUpperCase()).filter((s: string): s is string => Boolean(s))
    );
    return new Set([...w, ...h]).size;
  }, [data]);

  const enginesAiContext: LogicEnginesAiContext = useMemo(
    () => ({
      netWorthSar: netWorth,
      monthlyIncomeSar: monthlyCashflowSar.income,
      monthlyExpensesSar: monthlyCashflowSar.expenses,
      monthlyNetSar: monthlyCashflowSar.net,
      savingsRatePct: srPct,
      portfolioSnapshotReturnPct: portfolioReturnPct,
      runwayMonths: liquidityRunway?.monthsOfRunway ?? 0,
      emergencyMonthsCovered: ef.monthsCovered,
      usdToSarRate: sarPerUsd,
      alertCount: unified?.alerts?.length ?? 0,
      symbolCount: trackedSymbolCount,
    }),
    [
      netWorth,
      monthlyCashflowSar.income,
      monthlyCashflowSar.expenses,
      monthlyCashflowSar.net,
      srPct,
      portfolioReturnPct,
      liquidityRunway?.monthsOfRunway,
      ef.monthsCovered,
      sarPerUsd,
      unified?.alerts?.length,
      trackedSymbolCount,
    ]
  );

  const logicValidationWarnings = useMemo(() => {
    const w: string[] = [];
    if (snaps.length < 2) w.push('Add at least two device net worth snapshots to see a meaningful simple return between snapshots.');
    if (!ef.hasEssentialExpenseEstimate) w.push('Core monthly expenses are uncertain — classify core expenses or add essential budgets.');
    if (monthlyCashflowSar.income === 0 && monthlyCashflowSar.expenses > 0) {
      w.push('This month has expenses but no recorded income in SAR — verify Transactions and account currencies.');
    }
    if (
      scoped.liabilities.some((l: Liability) => (l.status || 'Active') === 'Active' && Number(l.amount) < 0)
    ) {
      w.push('Debt stress uses estimated monthly payments (Liabilities have no dedicated monthly payment field).');
    }
    if (fxBreakdown.positions.length === 0) {
      w.push('No checking/savings or investment holdings found for FX exposure.');
    }
    return w;
  }, [snaps.length, ef.hasEssentialExpenseEstimate, monthlyCashflowSar.income, scoped.txs, scoped.liabilities, fxBreakdown.positions.length]);

  const lifestyle = useMemo(
    () =>
      lifestyleGuardrailCheck({
        emergencyFundMonths: ef.monthsCovered,
        runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
        savingsRatePct: srPct,
        goalSlippagePct: firstGoal && firstGoal.targetAmount > 0 ? (1 - firstGoal.currentAmount / firstGoal.targetAmount) * 100 : 0,
      }),
    [ef.monthsCovered, liquidityRunway, srPct, firstGoal]
  );
  const discretionaryProbeAmount = useMemo(
    () =>
      Math.max(
        500,
        Math.min(
          50_000,
          monthlyCashflowSar.net > 0 ? monthlyCashflowSar.net * 0.25 : (ef.monthlyCoreExpenses || 0) * 0.15 || 2000
        )
      ),
    [monthlyCashflowSar.net, ef.monthlyCoreExpenses]
  );
  const discretionary = useMemo(
    () =>
      discretionarySpendApproval({
        emergencyFundMonths: ef.monthsCovered,
        runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
        savingsRatePct: srPct,
        discretionaryProposedAmount: discretionaryProbeAmount,
        goalSlippagePct: firstGoal && firstGoal.targetAmount > 0 ? (1 - firstGoal.currentAmount / firstGoal.targetAmount) * 100 : 0,
      }),
    [ef.monthsCovered, liquidityRunway, srPct, firstGoal, discretionaryProbeAmount]
  );

  const provisionDemo = useMemo(() => {
    const yearlySum = scoped.budgets.filter((b) => b.period === 'yearly').reduce((s, b) => s + (Number(b.limit) || 0), 0);
    if (yearlySum > 0) {
      return { amount: monthlyProvisionNeeded({ events: [{ amount: yearlySum, dueMonth: 12 }], monthsToProvision: 6 }), label: 'From yearly budget total' };
    }
    return {
      amount: monthlyProvisionNeeded({ events: [{ amount: 6000, dueMonth: 6 }], monthsToProvision: 6 }),
      label: 'Illustrative event' as const,
    };
  }, [scoped.budgets]);

  if (loading && !data) {
    return (
      <PageLayout title="Behind the numbers" description="How your portfolio returns, cash flow, and retirement projections are calculated.">
        <p className="text-gray-500">Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Behind the numbers"
      description="How your portfolio returns, cash flow, and retirement projections are calculated—all using your real data."
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-sm text-slate-700">
            <strong className="text-slate-900">What is this?</strong> A behind-the-scenes view of how Finova calculates things like returns, runway, and retirement projections. Cash flows, liquid balances, and FX examples are normalized to <strong>SAR</strong> using your accounts’ currencies and the app USD→SAR rate (Settings / Wealth Ultra FX when set).
          </p>
        </div>

        {logicValidationWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold mb-1">Validation</p>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              {logicValidationWarnings.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <SectionCard title="Quick links" collapsible collapsibleSummary="Jump to Safety, Forecast, Settings" defaultExpanded>
          <p className="text-sm text-gray-600 mb-3">
            Jump to related tools:
          </p>
          {(setActivePage || triggerPageAction) && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-sm text-primary-600 hover:text-primary-700 underline"
                onClick={() => { trackAction('link-risk-trading', 'Engines & Tools'); triggerPageAction ? triggerPageAction('Engines & Tools', 'openRiskTradingHub') : setActivePage?.('Engines & Tools'); }}
              >
                Safety & rules
              </button>
              <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => { trackAction('link-forecast', 'Engines & Tools'); setActivePage?.('Forecast'); }}>
                Forecast
              </button>
              <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => setActivePage?.('Settings')}>
                Settings
              </button>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Returns & benchmarks" infoHint="How your portfolio performed compared to a simple benchmark. Uses your saved net worth snapshots." collapsible collapsibleSummary="TWR, attribution, benchmark" defaultExpanded>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>Simple return (last two device net worth snapshots): {portfolioReturnPct.toFixed(2)}%</li>
            <li>Illustrative annualized return (engine example: 10% over 2y): {annualizedReturn(10, 2).toFixed(2)}%</li>
            <li>Illustrative TWRR link (engine example sub-periods): {twrDemo.toFixed(2)}%</li>
            <li>vs 8% benchmark: {benchmarkCmp.outperforming ? 'Outperforming' : 'Behind'} (excess {benchmarkCmp.excess.toFixed(2)} pp)</li>
            <li>
              Illustrative attribution mix (engine demo, not your portfolio): price {attrDemo.price}% + div {attrDemo.dividend}% + FX {attrDemo.fx}%
              % + contrib {attrDemo.contribution}% = {attrDemo.total.toFixed(2)}%
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="Strategy comparison" collapsible collapsibleSummary="Scenarios and allocation models">
          <p className="text-xs text-gray-500 mb-2">compareStrategies / compareAllocationModels</p>
          <p className="text-sm mb-2">Scenarios (projected NW): {strategyRank.map((s) => `${s.label}: ${formatCurrencyString(s.projectedNetWorth)}`).join(' · ')}</p>
          <ul className="text-sm text-gray-700">
            {allocCompare.map((m) => (
              <li key={m.name}>
                #{m.rank} {m.name} — equity {m.equityPct.toFixed(0)}%, ret {m.projectedReturnPct.toFixed(1)}%, vol {m.volatilityPct.toFixed(1)}%
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Cash & liquidity" collapsible collapsibleSummary="Runway, buckets, idle cash">
          <p className="text-xs text-gray-500 mb-2">cashAllocationEngine + liquidityRunwayEngine · amounts in SAR equivalent</p>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>
              This month cashflow (SAR): income {formatCurrencyString(income)} · expenses {formatCurrencyString(expenses)} · net{' '}
              {formatCurrencyString(monthlyCashflowSar.net)}
            </li>
            <li>Runway: {(liquidityRunway?.monthsOfRunway ?? 0).toFixed(1)} mo — {liquidityRunway?.status ?? '—'}</li>
            <li>
              Bucket allocation example ({formatCurrencyString(bucketAllocInput)}):{' '}
              {bucketAlloc.map((b) => `${b.bucketId}: ${formatCurrencyString(b.amount, { digits: 0 })}`).join(', ')}
            </li>
            <li>Idle cash accounts (≥1000 book): {idleCash.length}</li>
            <li>Top liquid account: {liqRanked[0]?.name ?? '—'}</li>
            <li>Sweep ideas: {sweeps.length ? sweeps.map((s) => s.reason).join('; ') : 'None'}</li>
          </ul>
        </SectionCard>

        <SectionCard title="FX" collapsible collapsibleSummary="Portfolio FX allocation">
          <ul className="text-sm text-gray-700 space-y-1">
            <li>
              Cash — SAR-denominated (SAR eq.): {formatCurrencyString(fxBreakdown.sarNative)} · USD accounts (SAR eq.):{' '}
              {formatCurrencyString(fxBreakdown.usdAsSar)}
            </li>
            <li>
              Holdings — SAR book (SAR eq.): {formatCurrencyString(fxBreakdown.invSarBook)} · USD book (SAR eq.):{' '}
              {formatCurrencyString(fxBreakdown.invUsdAsSar)}
            </li>
            <li>Share of cash + listed holdings by currency bucket: {fxAlloc.map((f) => `${f.currency} ${f.allocationPct.toFixed(0)}%`).join(', ') || '—'}</li>
            <li>
              Reference: 1,000 USD → {formatCurrencyString(usdThousandInSar)} at {sarPerUsd.toFixed(4)} SAR per USD (app rate).
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="Seasonality" collapsible collapsibleSummary="Adjusted expense, provision">
          <ul className="text-sm text-gray-700 space-y-1">
            <li>This month adjusted expense: {formatCurrencyString(seasonAdj)}</li>
            <li>
              Annual-cost monthly provision ({annualProv.label}): {formatCurrencyString(annualProv.amount)}
            </li>
            <li>Stress month: {stressMonth.isStressMonth ? 'Yes' : 'No'} (threshold {formatCurrencyString(stressMonth.threshold)})</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Retirement & sensitivity"
        >
          <ul className="text-sm text-gray-700 space-y-1">
            <li className="text-xs text-gray-500">
              Starting corpus uses full net worth (SAR); refine in Forecast / Goals for dedicated retirement buckets.
            </li>
            <li>
              {swr.label} → target corpus {formatCurrencyString(retGap.targetCorpus)}; gap {formatCurrencyString(retGap.gap)}
            </li>
            <li>Projected corpus (plan contributions): {formatCurrencyString(retProj.projectedCorpus)}</li>
            <li>
              Sensitivity ±2% return on corpus: base {formatCurrencyString(sensReturn.baseline)} / up {formatCurrencyString(sensReturn.up)} / down{' '}
              {formatCurrencyString(sensReturn.down)}
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="Insurance (baseline)" collapsible collapsibleSummary="Gaps and renewal alerts">
          <ul className="text-sm text-gray-700 space-y-1">
            {insuranceGaps.gaps.map((g) => (
              <li key={g.type}>
                {g.type}: gap {formatCurrencyString(g.gap)} — {g.adequate ? 'adequate' : 'review'}
              </li>
            ))}
            <li>Renewal alerts: {renewalAlerts.alerts.length ? renewalAlerts.alerts.map((a) => `${a.type} in ${a.dueInDays}d`).join(', ') : 'None'}</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Probabilistic planning"
        >
          {goalSim && firstGoal ? (
            <ul className="text-sm text-gray-700 space-y-1">
              <li>
                Goal &quot;{firstGoal.name}&quot; completion probability (sim): {goalSim.probability.toFixed(1)}%
              </li>
              <li>
                Outcome p10/p50/p90: {formatCurrencyString(goalSim.stats.p10)} / {formatCurrencyString(goalSim.stats.p50)} /{' '}
                {formatCurrencyString(goalSim.stats.p90)}
              </li>
              <li>
                Portfolio range (10y, sim): p10 {formatCurrencyString(portRange.p10)} … p90 {formatCurrencyString(portRange.p90)}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-gray-600">Add goals to see Monte Carlo goal completion stats.</p>
          )}
        </SectionCard>

        <SectionCard title="Planning assumptions" collapsible collapsibleSummary="Assumption validation">
          <p className="text-sm">{assumptionValidation.ok ? 'All demo assumptions in range.' : 'Validation issues:'}</p>
          {!assumptionValidation.ok && (
            <ul className="text-sm text-amber-800">
              {assumptionValidation.errors.map((e) => (
                <li key={e.key}>
                  {e.key}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Behavioral & explainability" collapsible collapsibleSummary="Buy policy, cooldown">
          <ul className="text-sm text-gray-700 space-y-2">
            <li>Buy policy: {behaviorBuy.allowed ? 'Allowed' : `Blocked (${behaviorBuy.flags.join(', ')})`}</li>
            <li>{explainBuy}</li>
            <li>Cooldown (5d, no last trade): {cooldown.allowed ? 'OK' : `wait ${cooldown.remainingDays.toFixed(1)}d`}</li>
            <li>Emotion guard (drawdown): {emotion.allowed ? 'OK' : emotion.reason}</li>
            <li>{explainGoal}</li>
          </ul>
        </SectionCard>

        <SectionCard title="Order planning (demo ladder)" collapsible collapsibleSummary="Buy tranches">
          <ul className="text-sm text-gray-700">
            {buyTranches.map((t, i) => (
              <li key={i}>
                {t.label ?? 'Tranche'} @ {t.limitPrice.toFixed(2)} — {formatCurrencyString(t.amount)}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="UX guardrails" collapsible collapsibleSummary="Badge, hints, guards">
          <ul className="text-sm text-gray-700 space-y-1">
            <li>Badge: {badgeDemo.text} ({badgeDemo.severity})</li>
            <li>Field hint (amount): {hintDemo ?? '—'}</li>
            <li>Input guard (-5 amount): {guardDemo.ok ? 'OK' : guardDemo.error}</li>
          </ul>
        </SectionCard>

        <SectionCard title="Corporate actions (demo)" collapsible collapsibleSummary="Split demo">
          <p className="text-sm text-gray-700">
            2:1 split: 100 sh @ 40 → {splitDemo.quantity.toFixed(2)} sh @ {splitDemo.avgCost.toFixed(4)} cost/sh
          </p>
        </SectionCard>

        <SectionCard title="Risk lane" collapsible collapsibleSummary="Suggested profile">
          <p className="text-sm text-gray-700">
            Lane: <strong>{riskLane.lane}</strong> → suggested profile {riskLane.suggestedProfile}
          </p>
          <ul className="text-xs text-gray-600 mt-1">
            {riskLane.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Next best actions" collapsible collapsibleSummary="Prioritized actions">
          <ul className="text-sm space-y-2">
            {nextActions.slice(0, 6).map((a) => (
              <li key={a.id} className="border-b border-gray-100 pb-2">
                <span className="font-medium">{a.title}</span> <span className="text-gray-400">({a.priorityScore})</span>
                <p className="text-gray-600 text-xs">{a.description}</p>
                {setActivePage && a.link && (
                  <button
                    type="button"
                    className="text-xs text-primary-600 underline mt-1"
                    onClick={() => {
                      trackAction(`link-${String(a.link).toLowerCase().replace(/\s+/g, '-')}`, 'Engines & Tools');
                      const subAction = (a as { data?: { action?: string } }).data?.action;
                      if (subAction && triggerPageAction) triggerPageAction(a.link as Page, subAction);
                      else setActivePage(a.link as Page);
                    }}
                  >
                    Open {a.linkLabel ?? a.link}
                  </button>
                )}
              </li>
            ))}
            {nextActions.length === 0 && <li className="text-gray-500">No urgent actions from current signals.</li>}
          </ul>
        </SectionCard>

        <SectionCard title="Shock drill & scenario timeline" collapsible collapsibleSummary="Stress scenarios">
          {shock ? (
            <ul className="text-sm text-gray-700 space-y-1">
              <li>
                Template: {shock.template.label} — household Δ {formatCurrencyString(shock.householdProjectedYearEndDelta)}; portfolio Δ{' '}
                {shock.wealthUltraPortfolioValueDeltaPct.toFixed(2)}%
              </li>
              <li>{shock.combinedRiskNote}</li>
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Need financial data for shock drill.</p>
          )}
          <p className="text-xs text-gray-600 mt-3">Timeline ({scenarioTw.horizonYears}y):</p>
          <ul className="text-xs text-gray-600">
            {scenarioTw.events.map((e, i) => (
              <li key={i}>
                Y{e.yearOffset}: {e.label} — {e.narrative}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Engine integration (cross-engine)" collapsible collapsibleSummary="Alerts and recs">
          {unified ? (
            <>
              <p className="text-sm text-gray-700 mb-2">
                Alerts: {unified.alerts.length} · Investment recs: {unified.investmentRecommendations.length} · Budget recs:{' '}
                {unified.budgetRecommendations.length}
              </p>
              <ul className="text-xs text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                {unified.alerts.slice(0, 8).map((al, i) => (
                  <li key={i}>
                    [{al.severity}] {al.message}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-gray-500">Integration analysis unavailable.</p>
          )}
        </SectionCard>

        <SectionCard title="Lifestyle guardrails & provisioning" collapsible collapsibleSummary="Guardrails, provision">
          <ul className="text-sm text-gray-700 space-y-1">
            <li>Guardrail: {lifestyle.ok ? 'OK' : 'Flags: ' + lifestyle.flags.join(', ')}</li>
            <li>
              Discretionary probe ({formatCurrencyString(discretionaryProbeAmount)}): {discretionary.allowed ? 'Approved' : discretionary.reason}
            </li>
            <li>
              Monthly provision ({provisionDemo.label}): {formatCurrencyString(provisionDemo.amount)}
            </li>
          </ul>
        </SectionCard>

        <AIAdvisor
          pageContext="engines"
          contextData={enginesAiContext}
          title="AI — Money Tools snapshot"
          subtitle="SAR-normalized metrics from this page. After insight loads, use English / العربية."
          buttonLabel="Get AI insight"
        />
      </div>
    </PageLayout>
  );
};

export default LogicEnginesHub;
