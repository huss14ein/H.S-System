/* eslint-disable no-console */
// Test file to verify Household Budget Engine calculations
import { buildHouseholdBudgetPlan, HouseholdEngineInput } from './services/householdBudgetEngine';

// Test Case 1: Basic calculation verification
const testCase1: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(8000),
  monthlyActualIncome: Array(12).fill(8000),
  monthlyActualExpense: Array(12).fill(3000),
  householdDefaults: { adults: 2, kids: 1 },
  liquidBalance: 10000,
  emergencyBalance: 5000,
  reserveBalance: 3000,
  goals: [{ name: 'House', remaining: 20000 }]
};

// Test Case 2: Emergency fund gap calculation
const testCase2: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(8000),
  householdDefaults: { adults: 1, kids: 0 },
  liquidBalance: 2000,
  emergencyBalance: 1000, // Low emergency fund
  reserveBalance: 500,
  goals: []
};

// Test Case 3: Goal routing with surplus
const testCase3: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(10000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 15000,
  emergencyBalance: 12000, // Fully funded
  reserveBalance: 4000, // Fully funded
  goals: [
    { name: 'House', remaining: 15000 },
    { name: 'Car', remaining: 8000 }
  ]
};

// Run tests
console.log('=== Test Case 1: Basic Calculation ===');
const result1 = buildHouseholdBudgetPlan(testCase1);
console.log('Monthly bucket allocations:', result1.months[0].buckets);
console.log('Annual totals:', result1.annualBuckets);
console.log('Emergency gap:', result1.emergencyGap);
console.log('Reserve gap:', result1.reserveGap);

console.log('\n=== Test Case 2: Emergency Fund Gap ===');
const result2 = buildHouseholdBudgetPlan(testCase2);
console.log('Emergency gap should be positive:', result2.emergencyGap);
console.log('Monthly emergency allocation:', result2.months[0].buckets.emergencySavings);

console.log('\n=== Test Case 3: Goal Routing ===');
const result3 = buildHouseholdBudgetPlan(testCase3);
console.log('Routed goal name:', result3.months[0].routedGoalName);
console.log('Routed amount:', result3.months[0].routedGoalAmount);
console.log('Goal savings bucket:', result3.months[0].buckets.goalSavings);

// Verification calculations
console.log('\n=== Manual Verification ===');
const salary = 5000;
const emergencyTargetMonths = 6;
const currentBalance = 5000;
const monthlyExpenses = 3000;
const expectedEmergencyGap = Math.max(0, monthlyExpenses * emergencyTargetMonths - currentBalance);
console.log('Expected emergency gap:', expectedEmergencyGap);

// Check percentage calculations
const emergencyPct = 0.07;
const expectedEmergencyMonthly = Math.max(expectedEmergencyGap / 12, salary * emergencyPct);
console.log('Expected emergency monthly allocation:', expectedEmergencyMonthly);
