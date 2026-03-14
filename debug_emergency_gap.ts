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

// eslint-disable-next-line no-console
console.log('=== Manual Emergency Gap Calculation ===');
// eslint-disable-next-line no-console
console.log('Monthly expenses:', monthlyExpenses);
// eslint-disable-next-line no-console
console.log('Emergency target months:', emergencyTargetMonths);
// eslint-disable-next-line no-console
console.log('Current emergency balance:', currentEmergencyBalance);
// eslint-disable-next-line no-console
console.log('Expected emergency gap:', expectedEmergencyGap);

// Now test the engine
// eslint-disable-next-line no-console
console.log('\n=== Engine Calculation ===');
const result = buildHouseholdBudgetPlan(testCase);
// eslint-disable-next-line no-console
console.log('Engine emergency gap:', result.emergencyGap);

// Let's trace the calculation step by step
// eslint-disable-next-line no-console
console.log('\n=== Step-by-Step Trace ===');
const config = DEFAULT_HOUSEHOLD_ENGINE_CONFIG;
const monthlySalaryPlan = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((testCase.monthlySalaryPlan[i] || 0) * 100) / 100));
const monthlyActualExpense = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((testCase.monthlyActualExpense?.[i] || 0) * 100) / 100));

// eslint-disable-next-line no-console
console.log('monthlyActualExpense[0]:', monthlyActualExpense[0]);
// eslint-disable-next-line no-console
console.log('monthlySalaryPlan[0]:', monthlySalaryPlan[0]);
// eslint-disable-next-line no-console
console.log('emergencyTargetMonths:', config.emergencyTargetMonths);
// eslint-disable-next-line no-console
console.log('emergencyBalance:', testCase.emergencyBalance);

const toCurrency = (v: number) => Math.max(0, Math.round(Number(v) * 100) / 100);
const calculatedGap = Math.max(0, toCurrency((monthlyActualExpense[0] || monthlySalaryPlan[0] || 0) * config.emergencyTargetMonths - toCurrency(testCase.emergencyBalance)));
// eslint-disable-next-line no-console
console.log('Manually calculated gap with engine logic:', calculatedGap);
