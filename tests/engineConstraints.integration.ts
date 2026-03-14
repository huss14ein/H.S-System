/**
 * Integration verification: Household, Budget, and Wealth Ultra share constraints (cash, risk) and run without errors.
 * Run with: npx tsx tests/engineConstraints.integration.ts (or node --loader ts-node/esm)
 */

import { buildHouseholdBudgetPlan, sumLiquidCash, mapGoalsForRouting, DEFAULT_HOUSEHOLD_ENGINE_CONFIG } from '../services/householdBudgetEngine';
import { computeSharedConstraints } from '../services/engineConstraints';
import { runWealthUltraEngine } from '../wealth-ultra';
import type { Holding } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// --- Household engine: stress signals and suggestedMaxInvestmentFromHousehold ---
const householdPlan = buildHouseholdBudgetPlan({
  monthlySalaryPlan: Array(12).fill(5000),
  monthlyActualIncome: Array(12).fill(5000),
  monthlyActualExpense: Array(12).fill(3000),
  householdDefaults: { adults: 2, kids: 0 },
  monthlyOverrides: [],
  liquidBalance: 20000,
  emergencyBalance: 20000,
  reserveBalance: 8000,
  goals: mapGoalsForRouting([{ id: 'g1', name: 'Goal', targetAmount: 10000, currentAmount: 2000, deadline: '2026-12-31', savingsAllocationPercent: 20 }]),
  config: DEFAULT_HOUSEHOLD_ENGINE_CONFIG,
});

assert(householdPlan.months.length === 12, 'Household plan has 12 months');
assert(typeof householdPlan.stressSignals.overall === 'string', 'Household stress overall is string');
assert(householdPlan.stressSignals.suggestedMaxInvestmentFromHousehold >= 0, 'suggestedMaxInvestmentFromHousehold is non-negative');
assert(householdPlan.dynamicBaseline.baselineMonthlyExpense >= 0, 'Dynamic baseline expense >= 0');
assert(householdPlan.predictiveSpend.nextMonthExpense >= 0, 'Predictive spend next month >= 0');

// --- Shared constraints: cap deployable from household ---
const constraints = computeSharedConstraints({
  householdStress: householdPlan.stressSignals,
  budgetMaxInvestable: undefined,
  rawDeployableCash: 50000,
  riskTolerance: 'moderate',
});

assert(constraints.valid === true, 'Constraints valid');
assert(constraints.cappedDeployableCash >= 0, 'Capped deployable >= 0');
assert(constraints.cappedDeployableCash <= 50000, 'Capped deployable <= raw');

// --- Wealth Ultra with scenarioCashCap (from shared constraints) ---
const mockHoldings: Holding[] = [
  {
    id: 'h1',
    symbol: 'AAPL',
    quantity: 10,
    avgCost: 150,
    currentValue: 1600,
    portfolio_id: 'p1',
    zakahClass: 'Zakatable',
    realizedPnL: 0,
  },
];
const priceMap: Record<string, number> = { AAPL: 160 };

const state = runWealthUltraEngine({
  holdings: mockHoldings,
  priceMap,
  config: { cashAvailable: 10000 },
  scenarioCashCap: constraints.cappedDeployableCash,
});

assert(state.positions.length === 1, 'Wealth Ultra has 1 position');
assert(state.deployableCash <= constraints.cappedDeployableCash, 'Wealth Ultra deployable <= capped');
assert(state.portfolioHealth != null, 'Portfolio health present');
assert(state.tradeRankedPositions != null, 'Trade ranked positions present');
assert(state.diversification != null, 'Diversification result present');
assert(state.positions[0].riskScore != null, 'Position has riskScore');
assert(state.positions[0].tradeRank != null, 'Position has tradeRank');

// --- Scenario hook: scenarioTargetOverrides ---
const stateScenario = runWealthUltraEngine({
  holdings: mockHoldings,
  priceMap,
  config: { cashAvailable: 10000, targetCorePct: 70, targetUpsidePct: 25, targetSpecPct: 5 },
  scenarioTargetOverrides: { Core: 80, Upside: 15, Spec: 5 },
});
assert(stateScenario.config.targetCorePct === 80, 'Scenario override Core applied');
assert(stateScenario.config.targetUpsidePct === 15, 'Scenario override Upside applied');

console.log('Integration checks passed: Household, SharedConstraints, Wealth Ultra (with scenarioCashCap and scenarioTargetOverrides), risk scoring, trade ranking, diversification.');
export {};
