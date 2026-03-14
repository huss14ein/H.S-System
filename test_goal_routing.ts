// Test goal routing and surplus allocation logic
import { buildHouseholdBudgetPlan, HouseholdEngineInput } from './services/householdBudgetEngine';

// Test Case 1: Single goal with surplus
const testCase1: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(15000),
  monthlyActualIncome: Array(12).fill(15000),
  monthlyActualExpense: Array(12).fill(5000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 30000,
  emergencyBalance: 30000, // Fully funded (5000 * 6)
  reserveBalance: 8000, // Should be sufficient
  goals: [
    { name: 'House Down Payment', remaining: 50000 }
  ]
};

// Test Case 2: Multiple goals with priority routing
const testCase2: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(12000),
  monthlyActualIncome: Array(12).fill(12000),
  monthlyActualExpense: Array(12).fill(4000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 25000,
  emergencyBalance: 24000, // Fully funded
  reserveBalance: 6000,
  goals: [
    { name: 'House', remaining: 30000 },
    { name: 'Car', remaining: 15000 },
    { name: 'Vacation', remaining: 5000 }
  ],
  config: {
    autoRouteGoalPriority: ['House', 'Car', 'Vacation']
  }
};

// Test Case 3: No surplus (all funds allocated to essentials)
const testCase3: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(6000),
  monthlyActualIncome: Array(12).fill(6000),
  monthlyActualExpense: Array(12).fill(3000),
  householdDefaults: { adults: 2, kids: 2 },
  liquidBalance: 10000,
  emergencyBalance: 8000,
  reserveBalance: 2000,
  goals: [
    { name: 'Emergency Fund', remaining: 10000 }
  ]
};

console.log('=== Goal Routing Test 1: Single Goal with Surplus ===');
const result1 = buildHouseholdBudgetPlan(testCase1);
const month1_1 = result1.months[0];
console.log('Routed goal name:', month1_1.routedGoalName);
console.log('Routed amount:', month1_1.routedGoalAmount);
console.log('Goal savings bucket:', month1_1.buckets.goalSavings);
console.log('Total goal allocation:', month1_1.routedGoalAmount + month1_1.buckets.goalSavings);

console.log('\n=== Goal Routing Test 2: Multiple Goals with Priority ===');
const result2 = buildHouseholdBudgetPlan(testCase2);
const month1_2 = result2.months[0];
console.log('Routed goal name:', month1_2.routedGoalName);
console.log('Routed amount:', month1_2.routedGoalAmount);
console.log('Goal savings bucket:', month1_2.buckets.goalSavings);

// Check goal priority logic
console.log('\n=== Goal Priority Verification ===');
const goals = testCase2.goals;
const priority = testCase2.config?.autoRouteGoalPriority || [];
console.log('Goals:', goals.map(g => `${g.name}: ${g.remaining}`));
console.log('Priority:', priority);

// Check if goals are being reduced correctly
console.log('\n=== Goal Reduction Over Time ===');
const goalRemaining = [];
result2.months.forEach((month, index) => {
  if (month.routedGoalName && (month.routedGoalAmount + month.buckets.goalSavings) > 0) {
    console.log(`Month ${index + 1}: ${month.routedGoalName} - Total: ${month.routedGoalAmount + month.buckets.goalSavings}`);
  }
});

console.log('\n=== Goal Routing Test 3: No Surplus ===');
const result3 = buildHouseholdBudgetPlan(testCase3);
const month1_3 = result3.months[0];
console.log('Routed goal name:', month1_3.routedGoalName);
console.log('Routed amount:', month1_3.routedGoalAmount);
console.log('Remaining after all allocations:', month1_3.incomePlanned - month1_3.totalPlannedOutflow);
