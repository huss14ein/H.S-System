#!/usr/bin/env node
/**
 * CI guard — household budget + add flows stay wired end-to-end.
 * Static wiring checks here; behavioral assertions in completion vitest files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const failures = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`Missing required file: ${rel}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function expectContains(content, needle, label) {
  if (!content.includes(needle)) failures.push(`${label} missing: ${needle}`);
}

function expectNotMatch(content, pattern, label) {
  if (pattern.test(content)) failures.push(`${label} forbidden pattern: ${pattern}`);
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  if (start < 0) return '';
  const end = content.indexOf(endNeedle, start);
  return end < 0 ? content.slice(start) : content.slice(start, end);
}

// --- Required modules ---
for (const f of [
  'services/householdAutoSetup.ts',
  'services/householdEngineFromData.ts',
  'services/householdBudgetAnalytics.ts',
]) {
  read(f);
}

// --- DataContext: budget insert path ---
const dataContext = read('context/DataContext.tsx');
const addBudgetBody = sliceBetween(dataContext, 'const addBudget = async', 'const updateBudget = async');
expectContains(addBudgetBody, 'payload.goal_id', 'context/DataContext.tsx addBudget');
expectContains(addBudgetBody, 'destination_account_id', 'context/DataContext.tsx addBudget');
expectContains(addBudgetBody, 'Could not add budget:', 'context/DataContext.tsx addBudget error toast');
expectNotMatch(addBudgetBody, /\{\s*\.\.\.withUser\(budget\)/, 'context/DataContext.tsx addBudget');

const copyBody = sliceBetween(dataContext, 'const copyBudgetsFromPreviousMonth', 'const deleteBudget');
expectContains(copyBody, 'goal_id:', 'context/DataContext.tsx copyBudgetsFromPreviousMonth');

// --- Budgets page entry points ---
const budgets = read('pages/Budgets.tsx');
expectContains(budgets, 'await addBudget(budget, { confirmed: true })', 'pages/Budgets.tsx manual save');
expectContains(budgets, 'resolveHouseholdAutoSetup', 'pages/Budgets.tsx auto-setup');
expectContains(budgets, 'persistHouseholdProfileSnapshot', 'pages/Budgets.tsx auto-setup persist');
expectContains(budgets, 'selectHouseholdTrendMonths', 'pages/Budgets.tsx trends');
expectContains(budgets, 'resolveHouseholdTrendsThroughMonth', 'pages/Budgets.tsx trends cap');
expectContains(budgets, 'trendsThroughMonth', 'pages/Budgets.tsx trends through');
expectContains(budgets, 'effectiveMonthIncome', 'pages/Budgets.tsx trends income');
expectContains(budgets, 'YTD actual net', 'pages/Budgets.tsx KPI label');
expectContains(budgets, 'throw err', 'pages/Budgets.tsx save rethrow for modal');
expectNotMatch(budgets, /householdBudgetEngine\.months\.slice\(-6\)/, 'pages/Budgets.tsx trends window');
expectNotMatch(budgets, /selectHouseholdTrendMonths\(householdBudgetEngine\.months,\s*currentMonth/, 'pages/Budgets.tsx uncapped trends');

const smartFill = sliceBetween(budgets, 'const handleSmartFillBudgets', 'const handleSuggestBudgetAdjustments');
expectContains(smartFill, 'await addBudget', 'pages/Budgets.tsx smart-fill await');
expectContains(smartFill, '{ confirmed: true }', 'pages/Budgets.tsx smart-fill confirmed');

const bulkSection = sliceBetween(budgets, 'Household engine: Bulk add budgets', 'Create/update');
expectContains(bulkSection, 'await addBudget', 'pages/Budgets.tsx bulk add await');
expectContains(bulkSection, '{ confirmed: true }', 'pages/Budgets.tsx bulk add confirmed');
expectContains(bulkSection, 'canonicalBudgetStorageMonth', 'pages/Budgets.tsx bulk yearly month');

expectContains(read('utils/financialMonth.ts'), 'canonicalBudgetStorageMonth', 'utils/financialMonth.ts yearly storage month');
expectContains(read('utils/financialMonth.ts'), "return budgetView === 'Yearly' ? 250 : 150", 'utils/financialMonth.ts yearly match score');
expectContains(addBudgetBody, 'canonicalBudgetStorageMonth', 'context/DataContext.tsx addBudget yearly month');
expectContains(budgets, 'yearly-anchor-month', 'pages/Budgets.tsx yearly month picker');
expectContains(read('context/DataContext.tsx'), '.match({ id, user_id: auth.user.id })', 'context/DataContext.tsx updateBudget by id');
expectNotMatch(read('components/BudgetOwnPortfolioCard.tsx'), /disabled=\{budgetView === 'Yearly'\}/, 'BudgetOwnPortfolioCard edit enabled in Yearly view');

expectContains(budgets, 'householdEngineRequested', 'pages/Budgets.tsx engine request gate');
expectContains(budgets, 'setHouseholdEngineRequested(true)', 'pages/Budgets.tsx engine request on expand/setup');
expectContains(budgets, 'await updateBudget', 'pages/Budgets.tsx suggested adjustments await');
expectContains(budgets, 'engineLoaded', 'pages/Budgets.tsx autopilot waits for engine months');
expectContains(budgets, 'householdEngineComputeReady', 'pages/Budgets.tsx deferred ready');
expectContains(budgets, 'householdEngineComputeError', 'pages/Budgets.tsx deferred error');
expectContains(budgets, 'householdProfileLocalEpochRef', 'pages/Budgets.tsx cloud race epoch');
expectContains(budgets, 'planYearFullyElapsed', 'pages/Budgets.tsx elapsed-year caption');
expectContains(read('hooks/useDeferredIdleCompute.ts'), 'waitUntilBackgroundWorkResumed', 'hooks/useDeferredIdleCompute.ts pause wait');
expectContains(read('hooks/useDeferredIdleCompute.ts'), 'DeferredIdleComputeResult', 'hooks/useDeferredIdleCompute.ts result shape');
expectContains(read('hooks/useDeferredIdleCompute.ts'), 'setError', 'hooks/useDeferredIdleCompute.ts error state');

const plan = read('pages/Plan.tsx');
expectContains(plan, 'persistHouseholdProfileSnapshot', 'pages/Plan.tsx auto-setup persist');
expectContains(plan, 'runHouseholdAutoSetup', 'pages/Plan.tsx auto-setup');
expectContains(plan, 'useDeferredIdleCompute', 'pages/Plan.tsx deferred engine');
expectContains(plan, 'planHouseholdEngineReady', 'pages/Plan.tsx idle gate');
expectContains(plan, 'householdProfileLocalEpochRef', 'pages/Plan.tsx cloud race epoch');
expectContains(plan, 'value: householdBudgetEngine', 'pages/Plan.tsx deferred value destructure');
// --- Engine KPI helpers ---
const engine = read('services/householdBudgetEngine.ts');
for (const fn of [
  'sumHouseholdYtdActualNet',
  'resolveHouseholdPlanMonthIndex',
  'projectYearEndLiquidFromCurrent',
  'sumHouseholdCashflowNetAfterPlanYear',
  'estimateYearStartLiquidFromOpening',
  'suggestProfileFromIncomeVariance',
  'suggestedProfile',
  'postPlanYearCashflowNetSar',
]) {
  expectContains(engine, fn, `services/householdBudgetEngine.ts ${fn}`);
}
expectContains(engine, 'isHouseholdPlanYearFullyElapsed', 'services/householdBudgetEngine.ts elapsed helper');
expectContains(engine, 'consumptionAliasKeys', 'services/householdBudgetEngine.ts expense alias dedupe');
expectContains(read('services/householdAutoSetup.ts'), ': null', 'services/householdAutoSetup.ts persist null salary clear');
expectContains(budgets, 'resolveHouseholdPlanMonthIndex(currentYear, new Date()', 'pages/Budgets.tsx KPI month index uses today');
expectContains(budgets, 'expectedMonthlySalary > 0 ? expectedMonthlySalary : null', 'pages/Budgets.tsx salary null persist');
expectContains(plan, 'expectedMonthlySalary > 0 ? expectedMonthlySalary : null', 'pages/Plan.tsx salary null persist');
expectContains(read('services/householdAutoSetup.ts'), 'currentProfile', 'services/householdAutoSetup.ts preserves manual profile');
expectContains(read('context/DataContext.tsx'), 'Budget may have been saved but could not be loaded', 'context/DataContext.tsx silent-insert toast');
expectContains(read('context/NotificationsContext.tsx'), 'void deferredNotificationsFingerprint', 'context/NotificationsContext.tsx deferred gate');
expectContains(read('services/budgetSpendFingerprint.ts'), 'salarySignalCents', 'services/budgetSpendFingerprint.ts salary amount invalidation');

const analytics = read('services/householdBudgetAnalytics.ts');
expectContains(analytics, 'selectHouseholdTrendMonths', 'services/householdBudgetAnalytics.ts');
expectContains(analytics, 'effectiveMonthIncome', 'services/householdBudgetAnalytics.ts');
expectContains(analytics, 'effectiveMonthExpenseForProjection', 'services/householdBudgetAnalytics.ts projection expense');
expectContains(analytics, 'effectiveMonthExpenseForProjection(m)', 'forecast/seasonality uses projection expense');

// --- System surfaces use canonical builder ---
const stress = read('services/householdBudgetStress.ts');
expectContains(stress, 'buildHouseholdPlanFromFinancialData', 'services/householdBudgetStress.ts');
expectNotMatch(stress, /buildHouseholdEngineInputFromData\(/, 'services/householdBudgetStress.ts direct input');

const shock = read('services/shockDrillEngine.ts');
expectContains(shock, 'buildHouseholdPlanFromFinancialData', 'services/shockDrillEngine.ts');

const wealth = read('services/wealthSummaryReportModel.ts');
expectContains(wealth, 'buildHouseholdPlanFromFinancialData', 'services/wealthSummaryReportModel.ts');

if (failures.length > 0) {
  console.error('Household budget E2E wiring verification failed:\n');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log('Household budget E2E wiring checks passed. Running completion tests…');

const testFiles = [
  'tests/budgetAddCompletion.vitest.test.ts',
  'tests/householdTrendsCompletion.vitest.test.ts',
  'tests/householdAutoSetupCompletion.vitest.test.ts',
  'tests/householdBudgetPageCompletion.vitest.test.ts',
  'tests/householdEngineSystemCompletion.vitest.test.ts',
  'tests/householdBudgetE2EAudit.vitest.test.ts',
  'tests/interactiveResponsivenessCompletion.vitest.test.ts',
];

try {
  execSync(`npx vitest run ${testFiles.join(' ')}`, { stdio: 'inherit', cwd: root });
} catch {
  process.exit(1);
}

console.log('Household budget E2E verification passed (wiring + completion tests).');
