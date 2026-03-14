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

// eslint-disable-next-line no-console
console.log('=== Debug Budget Calculation ===');
const result = buildHouseholdBudgetPlan(testCase);

const month1 = result.months[0];
// eslint-disable-next-line no-console
console.log('Month 1 salary:', month1.incomePlanned);
// eslint-disable-next-line no-console
console.log('Month 1 base outflow (before savings):', 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);

// eslint-disable-next-line no-console
console.log('Remaining after base outflow:', month1.incomePlanned - 
  Object.entries(month1.buckets)
    .filter(([key]) => !['emergencySavings', 'reserveSavings', 'goalSavings', 'kidsFutureSavings', 'retirementSavings', 'investing'].includes(key))
    .reduce((sum, [_, value]) => sum + value, 0)
);

// eslint-disable-next-line no-console
console.log('Emergency gap:', result.emergencyGap);
// eslint-disable-next-line no-console
console.log('Emergency bucket:', month1.buckets.emergencySavings);
// eslint-disable-next-line no-console
console.log('Reserve gap:', result.reserveGap);
// eslint-disable-next-line no-console
console.log('Reserve bucket:', month1.buckets.reserveSavings);

// Check if emergency fund is fully funded
const monthlyExpenses = 3000;
const emergencyTargetMonths = 6;
const currentEmergencyBalance = 18000;
const expectedGap = Math.max(0, monthlyExpenses * emergencyTargetMonths - currentEmergencyBalance);
// eslint-disable-next-line no-console
console.log('Expected emergency gap:', expectedGap);

// Check the calculation step by step
// eslint-disable-next-line no-console
console.log('\n=== Step-by-step calculation ===');
const salary = 10000;
const emergencyGap = result.emergencyGap;
const emergencyPct = 0.07;
const reserveGap = result.reserveGap;
const reservePct = 0.05;

// eslint-disable-next-line no-console
console.log('Emergency gap / (13 - month):', emergencyGap / 12);
// eslint-disable-next-line no-console
console.log('Salary * emergencyPct:', salary * emergencyPct);
// eslint-disable-next-line no-console
console.log('Max of both:', Math.max(emergencyGap / 12, salary * emergencyPct));

// eslint-disable-next-line no-console
console.log('Reserve gap / (13 - month):', reserveGap / 12);
// eslint-disable-next-line no-console
console.log('Salary * reservePct:', salary * reservePct);
// eslint-disable-next-line no-console
console.log('Max of both:', Math.max(reserveGap / 12, salary * reservePct));
