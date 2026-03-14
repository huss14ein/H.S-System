// Debug the emergency gap calculation step by step
import { buildHouseholdBudgetPlan, HouseholdEngineInput, DEFAULT_HOUSEHOLD_ENGINE_CONFIG } from './services/householdBudgetEngine';

// Create a minimal test case
const testCase: HouseholdEngineInput = {
  monthlySalaryPlan: Array(12).fill(12000),
  monthlyActualIncome: Array(12).fill(12000),
  monthlyActualExpense: Array(12).fill(4000),
  householdDefaults: { adults: 2, kids: 0 },
  liquidBalance: 15000,
  emergencyBalance: 5000,
  reserveBalance: 3000,
  goals: [],
  config: DEFAULT_HOUSEHOLD_ENGINE_CONFIG
};

// Manual calculation of emergency gap
const monthlyExpenses = 4000;
const emergencyTargetMonths = 6;
const currentEmergencyBalance = 5000;
const expectedEmergencyGap = Math.max(0, monthlyExpenses * emergencyTargetMonths - currentEmergencyBalance);

console.log('=== Manual Emergency Gap Calculation ===');
console.log('Monthly expenses:', monthlyExpenses);
console.log('Emergency target months:', emergencyTargetMonths);
console.log('Current emergency balance:', currentEmergencyBalance);
console.log('Expected emergency gap:', expectedEmergencyGap);

// Now test the engine
console.log('\n=== Engine Calculation ===');
const result = buildHouseholdBudgetPlan(testCase);
console.log('Engine emergency gap:', result.emergencyGap);

// Let's trace the calculation step by step
console.log('\n=== Step-by-Step Trace ===');
const config = DEFAULT_HOUSEHOLD_ENGINE_CONFIG;
const monthlySalaryPlan = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((testCase.monthlySalaryPlan[i] || 0) * 100) / 100));
const monthlyActualExpense = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((testCase.monthlyActualExpense?.[i] || 0) * 100) / 100));

console.log('monthlyActualExpense[0]:', monthlyActualExpense[0]);
console.log('monthlySalaryPlan[0]:', monthlySalaryPlan[0]);
console.log('emergencyTargetMonths:', config.emergencyTargetMonths);
console.log('emergencyBalance:', testCase.emergencyBalance);

const toCurrency = (v: number) => Math.max(0, Math.round(Number(v) * 100) / 100);
const calculatedGap = Math.max(0, toCurrency((monthlyActualExpense[0] || monthlySalaryPlan[0] || 0) * config.emergencyTargetMonths - toCurrency(testCase.emergencyBalance)));
console.log('Manually calculated gap with engine logic:', calculatedGap);
