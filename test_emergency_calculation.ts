// Test emergency fund calculation with gap
import { buildHouseholdBudgetPlan, HouseholdEngineInput } from './services/householdBudgetEngine';

// Test case with emergency fund gap
const testCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(12000),
  monthlyActualIncome: Array(12).fill(12000),
  monthlyActualExpense: Array(12).fill(4000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 15000,
  emergencyBalance: 5000, // Only 5k, need 24k (4k * 6 months)
  reserveBalance: 3000,
  goals: [{ name: 'House', remaining: 10000 }]
};

console.log('=== Emergency Fund Gap Test ===');
const result = buildHouseholdBudgetPlan(testCase);

const month1 = result.months[0];
console.log('Month 1 salary:', month1.incomePlanned);
console.log('Base obligations total:', 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);
console.log('Remaining for savings:', month1.incomePlanned - 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);

console.log('Emergency gap:', result.emergencyGap);
console.log('Emergency bucket allocation:', month1.buckets.emergencySavings);
console.log('Reserve gap:', result.reserveGap);
console.log('Reserve bucket allocation:', month1.buckets.reserveSavings);

// Manual calculation verification
const monthlyExpenses = 4000;
const emergencyTargetMonths = 6;
const currentEmergencyBalance = 5000;
const expectedGap = Math.max(0, monthlyExpenses * emergencyTargetMonths - currentEmergencyBalance);
console.log('\nExpected emergency gap:', expectedGap);

const salary = 12000;
const emergencyPct = 0.07;
const monthlyGapAllocation = expectedGap / 12;
const percentageAllocation = salary * emergencyPct;
console.log('Monthly gap allocation:', monthlyGapAllocation);
console.log('Percentage allocation:', percentageAllocation);
console.log('Expected emergency allocation:', Math.max(monthlyGapAllocation, percentageAllocation));
