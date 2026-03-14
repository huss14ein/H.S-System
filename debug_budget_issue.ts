// Debug the budget calculation issue
import { buildHouseholdBudgetPlan, HouseholdEngineInput } from './services/householdBudgetEngine';

// Simple test case with high salary
const testCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(10000),
  monthlyActualIncome: Array(12).fill(10000),
  monthlyActualExpense: Array(12).fill(3000),
  householdDefaults: { adults: 2, kids: 1 },
  liquidBalance: 20000,
  emergencyBalance: 18000, // Should be fully funded (3000 * 6 = 18000)
  reserveBalance: 4000,
  goals: [{ name: 'House', remaining: 15000 }]
};

console.log('=== Debug Budget Calculation ===');
const result = buildHouseholdBudgetPlan(testCase);

const month1 = result.months[0];
console.log('Month 1 salary:', month1.incomePlanned);
console.log('Month 1 base outflow (before savings):', 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);

console.log('Remaining after base outflow:', month1.incomePlanned - 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);

console.log('Emergency gap:', result.emergencyGap);
console.log('Emergency bucket:', month1.buckets.emergencySavings);
console.log('Reserve gap:', result.reserveGap);
console.log('Reserve bucket:', month1.buckets.reserveSavings);

// Check if emergency fund is fully funded
const monthlyExpenses = 3000;
const emergencyTargetMonths = 6;
const currentEmergencyBalance = 18000;
const expectedGap = Math.max(0, monthlyExpenses * emergencyTargetMonths - currentEmergencyBalance);
console.log('Expected emergency gap:', expectedGap);

// Check the calculation step by step
console.log('\n=== Step-by-step calculation ===');
const salary = 10000;
const emergencyGap = result.emergencyGap;
const emergencyPct = 0.07;
const reserveGap = result.reserveGap;
const reservePct = 0.05;

console.log('Emergency gap / (13 - month):', emergencyGap / 12);
console.log('Salary * emergencyPct:', salary * emergencyPct);
console.log('Max of both:', Math.max(emergencyGap / 12, salary * emergencyPct));

console.log('Reserve gap / (13 - month):', reserveGap / 12);
console.log('Salary * reservePct:', salary * reservePct);
console.log('Max of both:', Math.max(reserveGap / 12, salary * reservePct));
