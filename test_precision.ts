/* eslint-disable no-console */
// Test rounding and currency handling precision
import { buildHouseholdBudgetPlan, HouseholdEngineInput } from './services/householdBudgetEngine';

// Test with values that should expose rounding issues
const testCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(8333.33), // Creates fractional cents
  monthlyActualIncome: Array(12).fill(8333.33),
  monthlyActualExpense: Array(12).fill(2777.77),
  householdDefaults: { adults: 1, kids: 1 },
  liquidBalance: 12345.67,
  emergencyBalance: 6789.01,
  reserveBalance: 2345.99,
  goals: [
    { name: 'Test Goal', remaining: 12345.67 }
  ]
};

console.log('=== Rounding and Precision Test ===');
console.log('Input salary:', testCase.monthlySalaryPlan[0]);
console.log('Input expenses:', testCase.monthlyActualExpense[0]);
console.log('Input balances:', { liquid: testCase.liquidBalance, emergency: testCase.emergencyBalance, reserve: testCase.reserveBalance });

const result = buildHouseholdBudgetPlan(testCase);
const month1 = result.months[0];

console.log('\n=== Bucket Calculations ===');
Object.entries(month1.buckets).forEach(([key, value]) => {
  console.log(`${key}: ${value}`);
});

console.log('\n=== Precision Checks ===');
console.log('Total planned outflow:', month1.totalPlannedOutflow);
console.log('Planned net:', month1.plannedNet);

// Check if totals add up correctly
const bucketSum = Object.values(month1.buckets).reduce((sum: number, val: number) => sum + val, 0);
const totalWithRouted = bucketSum + month1.routedGoalAmount;
console.log('\n=== Verification ===');
console.log('Bucket sum + routed:', totalWithRouted);
console.log('Reported total outflow:', month1.totalPlannedOutflow);
console.log('Difference:', Math.abs(totalWithRouted - month1.totalPlannedOutflow));

// Test edge cases with very small numbers
console.log('\n=== Edge Case: Small Numbers ===');
const smallTestCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(0.01),
  householdDefaults: { adults: 1, kids: 0 },
  liquidBalance: 0.01,
  emergencyBalance: 0.01,
  reserveBalance: 0.01,
  goals: []
};

const smallResult = buildHouseholdBudgetPlan(smallTestCase);
console.log('Small salary result:', smallResult.months[0].incomePlanned);
const nonZeroBuckets = Object.values(smallResult.months[0].buckets).filter((v: number) => v > 0);
console.log('Small bucket values:', nonZeroBuckets);
