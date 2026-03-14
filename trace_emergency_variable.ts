/* eslint-disable no-console */
// Trace the emergency gap variable throughout the calculation
import { buildHouseholdBudgetPlan, HouseholdEngineInput, DEFAULT_HOUSEHOLD_ENGINE_CONFIG } from './services/householdBudgetEngine';

// Monkey patch to trace the variable
const originalBuildPlan = buildHouseholdBudgetPlan;

const tracedBuildPlan = (input: HouseholdEngineInput) => {
  console.log('=== Input Values ===');
  console.log('monthlyActualExpense[0]:', input.monthlyActualExpense?.[0]);
  console.log('monthlySalaryPlan[0]:', input.monthlySalaryPlan[0]);
  console.log('emergencyBalance:', input.emergencyBalance);
  
  const config = DEFAULT_HOUSEHOLD_ENGINE_CONFIG;
  const toCurrency = (v: number) => Math.max(0, Math.round(Number(v) * 100) / 100);
  
  // Calculate initial gap
  const initialGap = Math.max(0, toCurrency((input.monthlyActualExpense?.[0] || input.monthlySalaryPlan[0] || 0) * config.emergencyTargetMonths - toCurrency(input.emergencyBalance)));
  console.log('Initial emergency gap calculation:', initialGap);
  
  // Call original function
  const result = originalBuildPlan(input);
  
  console.log('Final emergency gap in result:', result.emergencyGap);
  
  // Let's also check month 1 emergency allocation
  console.log('Month 1 emergency bucket:', result.months[0].buckets.emergencySavings);
  
  return result;
};

// Test case
const testCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(12000),
  monthlyActualIncome: Array(12).fill(12000),
  monthlyActualExpense: Array(12).fill(4000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 15000,
  emergencyBalance: 5000,
  reserveBalance: 3000,
  goals: []
};

console.log('=== Traced Emergency Gap Calculation ===');
const result = tracedBuildPlan(testCase);
