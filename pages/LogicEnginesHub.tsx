import React, { useContext, useMemo, useEffect, useState } from 'react';
import { DataContext } from '../context/DataContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import type { Account, Budget, FinancialData, Goal, Page, Transaction } from '../types';

import {
  simpleReturn,
  annualizedReturn,
  timeWeightedReturn,
  benchmarkExcessReturn,
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
import { convertToBaseCurrency, portfolioFXAllocation } from '../services/fxEngine';
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
import { savingsRate, netCashFlowForMonth } from '../services/financeMetrics';
import { debtStressScore } from '../services/debtEngines';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

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

function computeNetWorth(data: FinancialData | null): number {
  if (!data) return 0;
  const d = data as any;
  const accounts = d.personalAccounts ?? data.accounts ?? [];
  const assets = d.personalAssets ?? data.assets ?? [];
  const liabilities = d.personalLiabilities ?? data.liabilities ?? [];
  const inv = d.personalInvestments ?? data.investments ?? [];
  const cash = accounts.reduce((s: number, a: { balance?: number }) => s + (Number(a.balance) ?? 0), 0);
  const assetVal = assets.reduce((s: number, a: { value?: number }) => s + (Number(a.value) ?? 0), 0);
  const invVal = inv.reduce((s: number, p: { holdings?: { currentValue?: number }[] }) => {
    return s + (p.holdings ?? []).reduce((t: number, h: { currentValue?: number }) => t + (Number(h.currentValue) ?? 0), 0);
  }, 0);
  const debt = liabilities
    .filter((l: { amount?: number }) => (l.amount ?? 0) < 0)
    .reduce((s: number, l: { amount?: number }) => s + Math.abs(l.amount ?? 0), 0);
  return cash + assetVal + invVal - debt;
}

const LogicEnginesHub: React.FC<{ setActivePage?: (p: Page) => void }> = ({ setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const ef = useEmergencyFund(data ?? null);
  const { formatCurrencyString } = useFormatCurrency();
  const [dataTick, setDataTick] = useState(0);
  /** Re-run derived engine outputs when user returns to the tab (automation without polling). */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') setDataTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const scoped = useMemo(() => getScopedData(data ?? null), [data]);
  const netWorth = useMemo(() => computeNetWorth(data ?? null), [data]);
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
  const bucketAlloc = useMemo(
    () =>
      allocateCashAcrossBuckets(5000, [
        { id: 'res', targetMin: 2000, targetMax: 8000, priority: 1 },
        { id: 'goal', targetMin: 1000, priority: 2 },
        { id: 'inv', targetMin: 0, priority: 3 },
      ]),
    []
  );
  const idleCash = useMemo(() => detectIdleCash(scoped.accounts, { minBalance: 1000 }), [scoped.accounts]);
  const liqRanked = useMemo(() => rankLiquiditySources(scoped.accounts), [scoped.accounts]);
  const sweeps = useMemo(() => suggestCashSweep(cashBuckets, Math.max(0, netWorth * 0.01)), [cashBuckets, netWorth]);

  const fxPositions = useMemo(() => {
    const base = 'SAR';
    return scoped.accounts.map((a) => ({
      currency: base,
      valueInBase: Math.max(0, a.balance ?? 0),
    }));
  }, [scoped.accounts]);
  const fxAlloc = useMemo(() => portfolioFXAllocation(fxPositions), [fxPositions]);
  const fxConverted = useMemo(() => convertToBaseCurrency(1000, 'USD', 'SAR', 3.75), []);

  const monthNow = new Date().getMonth() + 1;
  const seasonEvents = useMemo(() => buildDefaultSeasonalityEvents(), []);
  const seasonAdj = useMemo(
    () => seasonalityAdjustedExpense({ baseMonthlyExpense: ef.monthlyCoreExpenses || 3000, month: monthNow, events: seasonEvents }),
    [ef.monthlyCoreExpenses, monthNow, seasonEvents]
  );
  const annualProv = useMemo(() => annualExpenseMonthlyProvision({ annualAmount: 12000, dueMonth: 12 }), []);
  const stressMonth = useMemo(
    () => eventMonthStressCheck({ adjustedMonthlyExpense: seasonAdj, baselineMonthlyExpense: ef.monthlyCoreExpenses || 3000 }),
    [seasonAdj, ef.monthlyCoreExpenses]
  );

  const retirementInputs: RetirementInputs = useMemo(
    () => ({
      futureMonthlyNeed: Math.max(2000, (ef.monthlyCoreExpenses || 3000) * 1.2),
      inflationRatePct: 3,
      yearsToRetirement: 25,
      currentCorpus: Math.max(0, netWorth * 0.35),
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

  const { income, expenses } = useMemo(() => netCashFlowForMonth(scoped.txs, new Date()), [scoped.txs]);
  const srPct = useMemo(() => savingsRate(scoped.txs, new Date()), [scoped.txs]);
  const monthlyDebt = useMemo(
    () => scoped.liabilities.filter((l: { status?: string }) => l.status === 'Active').reduce((s: number, l: { monthlyPayment?: number }) => s + (l.monthlyPayment ?? 0), 0),
    [scoped.liabilities]
  );
  const liquid = useMemo(
    () => scoped.accounts.filter((a) => a.type === 'Checking' || a.type === 'Savings').reduce((s, a) => s + Math.max(0, a.balance ?? 0), 0),
    [scoped.accounts]
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
  const discretionary = useMemo(
    () =>
      discretionarySpendApproval({
        emergencyFundMonths: ef.monthsCovered,
        runwayMonths: liquidityRunway?.monthsOfRunway ?? ef.monthsCovered,
        savingsRatePct: srPct,
        discretionaryProposedAmount: 2000,
        goalSlippagePct: firstGoal && firstGoal.targetAmount > 0 ? (1 - firstGoal.currentAmount / firstGoal.targetAmount) * 100 : 0,
      }),
    [ef.monthsCovered, liquidityRunway, srPct, firstGoal]
  );

  const provisionDemo = useMemo(
    () => monthlyProvisionNeeded({ events: [{ amount: 6000, dueMonth: 6 }], monthsToProvision: 6 }),
    []
  );

  if (loading && !data) {
    return (
      <PageLayout title="Logic & Engines" description="Financial engines wired to your data">
        <p className="text-gray-500">Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Logic & Engines"
      description="Spec logic layers (returns, cash, FX, retirement, risk, integration) driven by your profile — not dead code."
    >
      <div className="space-y-6">
        <SectionCard
          title="How to use this page"
        >
          <p className="text-sm text-gray-600 mb-3">
            Each section calls a service under <code className="text-xs bg-gray-100 px-1 rounded">services/</code> with your real data
            where possible—no extra setup. Open <strong>Strategy → Logic & Engines</strong> or the sidebar anytime.
          </p>
          {setActivePage && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="text-sm text-primary-600 underline" onClick={() => setActivePage('Risk & Trading Hub')}>
                Risk & Trading Hub
              </button>
              <button type="button" className="text-sm text-primary-600 underline" onClick={() => setActivePage('Forecast')}>
                Forecast
              </button>
              <button type="button" className="text-sm text-primary-600 underline" onClick={() => setActivePage('Settings')}>
                Settings
              </button>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Returns & benchmarks"
        >
          <ul className="text-sm space-y-1 text-gray-700">
            <li>Simple return (last two snapshots): {portfolioReturnPct.toFixed(2)}%</li>
            <li>Annualized (demo 2y on 10%): {annualizedReturn(10, 2).toFixed(2)}%</li>
            <li>TWRR link (demo sub-periods): {twrDemo.toFixed(2)}%</li>
            <li>Benchmark excess (portfolio vs 8%): {benchmarkExcessReturn(portfolioReturnPct, 8).toFixed(2)} pp</li>
            <li>vs benchmark: {benchmarkCmp.outperforming ? 'Outperforming' : 'Behind'} (excess {benchmarkCmp.excess.toFixed(2)} pp)</li>
            <li>
              Attribution demo: price {attrDemo.price}% + div {attrDemo.dividend}% + FX {attrDemo.fx}% + contrib {attrDemo.contribution}% ={' '}
              {attrDemo.total.toFixed(2)}%
            </li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Strategy comparison"
        >
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

        <SectionCard
          title="Cash & liquidity"
        >
          <p className="text-xs text-gray-500 mb-2">cashAllocationEngine + liquidityRunwayEngine</p>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>Runway: {(liquidityRunway?.monthsOfRunway ?? 0).toFixed(1)} mo — {liquidityRunway?.status ?? '—'}</li>
            <li>Sample bucket allocation (SAR 5k): {bucketAlloc.map((b) => `${b.bucketId}:${b.amount}`).join(', ')}</li>
            <li>Idle cash accounts (≥1000): {idleCash.length}</li>
            <li>Top liquid account: {liqRanked[0]?.name ?? '—'}</li>
            <li>Sweep ideas: {sweeps.length ? sweeps.map((s) => s.reason).join('; ') : 'None'}</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="FX"
        >
          <ul className="text-sm text-gray-700 space-y-1">
            <li>Portfolio by currency (balances as base): {fxAlloc.map((f) => `${f.currency} ${f.allocationPct.toFixed(0)}%`).join(', ') || '—'}</li>
            <li>Demo convert 1000 USD→SAR @3.75: {fxConverted.toFixed(2)} SAR</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Seasonality"
        >
          <ul className="text-sm text-gray-700 space-y-1">
            <li>This month adjusted expense: {formatCurrencyString(seasonAdj)}</li>
            <li>Annual cost monthly provision (demo): {formatCurrencyString(annualProv)}</li>
            <li>Stress month: {stressMonth.isStressMonth ? 'Yes' : 'No'} (threshold {formatCurrencyString(stressMonth.threshold)})</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Retirement & sensitivity"
        >
          <ul className="text-sm text-gray-700 space-y-1">
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

        <SectionCard
          title="Insurance (baseline)"
        >
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

        <SectionCard
          title="Planning assumptions"
        >
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

        <SectionCard
          title="Behavioral & explainability"
        >
          <ul className="text-sm text-gray-700 space-y-2">
            <li>Buy policy: {behaviorBuy.allowed ? 'Allowed' : `Blocked (${behaviorBuy.flags.join(', ')})`}</li>
            <li>{explainBuy}</li>
            <li>Cooldown (5d, no last trade): {cooldown.allowed ? 'OK' : `wait ${cooldown.remainingDays.toFixed(1)}d`}</li>
            <li>Emotion guard (drawdown): {emotion.allowed ? 'OK' : emotion.reason}</li>
            <li>{explainGoal}</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Order planning (demo ladder)"
        >
          <ul className="text-sm text-gray-700">
            {buyTranches.map((t, i) => (
              <li key={i}>
                {t.label ?? 'Tranche'} @ {t.limitPrice.toFixed(2)} — {formatCurrencyString(t.amount)}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="UX guardrails"
        >
          <ul className="text-sm text-gray-700 space-y-1">
            <li>Badge: {badgeDemo.text} ({badgeDemo.severity})</li>
            <li>Field hint (amount): {hintDemo ?? '—'}</li>
            <li>Input guard (-5 amount): {guardDemo.ok ? 'OK' : guardDemo.error}</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Corporate actions (demo)"
        >
          <p className="text-sm text-gray-700">
            2:1 split: 100 sh @ 40 → {splitDemo.quantity.toFixed(2)} sh @ {splitDemo.avgCost.toFixed(4)} cost/sh
          </p>
        </SectionCard>

        <SectionCard
          title="Risk lane"
        >
          <p className="text-sm text-gray-700">
            Lane: <strong>{riskLane.lane}</strong> → suggested profile {riskLane.suggestedProfile}
          </p>
          <ul className="text-xs text-gray-600 mt-1">
            {riskLane.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Next best actions"
        >
          <ul className="text-sm space-y-2">
            {nextActions.slice(0, 6).map((a) => (
              <li key={a.id} className="border-b border-gray-100 pb-2">
                <span className="font-medium">{a.title}</span> <span className="text-gray-400">({a.priorityScore})</span>
                <p className="text-gray-600 text-xs">{a.description}</p>
                {setActivePage && a.link && (
                  <button type="button" className="text-xs text-primary-600 underline mt-1" onClick={() => setActivePage(a.link as Page)}>
                    Open {a.linkLabel ?? a.link}
                  </button>
                )}
              </li>
            ))}
            {nextActions.length === 0 && <li className="text-gray-500">No urgent actions from current signals.</li>}
          </ul>
        </SectionCard>

        <SectionCard
          title="Shock drill & scenario timeline"
        >
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

        <SectionCard
          title="Engine integration (cross-engine)"
        >
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

        <SectionCard
          title="Lifestyle guardrails & provisioning"
        >
          <ul className="text-sm text-gray-700 space-y-1">
            <li>Guardrail: {lifestyle.ok ? 'OK' : 'Flags: ' + lifestyle.flags.join(', ')}</li>
            <li>Discretionary sample: {discretionary.allowed ? 'Approved' : discretionary.reason}</li>
            <li>Demo monthly provision (6k over 6mo): {formatCurrencyString(provisionDemo)}</li>
          </ul>
        </SectionCard>
      </div>
    </PageLayout>
  );
};

export default LogicEnginesHub;
