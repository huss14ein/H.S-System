/**
 * Integration tests for Household, Budget, and Wealth Ultra engine glue.
 * To run: use a test runner that compiles the project (e.g. Vitest/Jest with ts-node), or run the app and verify Plan/Budgets/Wealth Ultra/Investment Plan pages use the integration.
 * Ensures buildUnifiedFinancialContext, runCrossEngineAnalysis, and validateInvestmentAction
 * run without errors and share constraints consistently.
 */

import {
  buildUnifiedFinancialContext,
  runCrossEngineAnalysis,
  validateInvestmentAction,
  generatePrioritizedActionQueue,
} from '../services/engineIntegration';

const mockTransactions = [
  { id: '1', date: '2025-01-15', type: 'expense' as const, amount: -500, description: 'Rent', budgetCategory: 'Housing' },
  { id: '2', date: '2025-01-20', type: 'expense' as const, amount: -80, description: 'Electric Bill', budgetCategory: 'Utilities' },
  { id: '3', date: '2025-02-01', type: 'income' as const, amount: 8000 },
  { id: '4', date: '2025-02-15', type: 'expense' as const, amount: -500, description: 'Rent', budgetCategory: 'Housing' },
  { id: '5', date: '2025-03-01', type: 'income' as const, amount: 8000 },
  { id: '6', date: '2025-03-15', type: 'expense' as const, amount: -500, description: 'Rent', budgetCategory: 'Housing' },
];

const mockAccounts = [
  { id: 'a1', type: 'Checking', balance: 15000, name: 'Main' },
  { id: 'a2', type: 'Savings', balance: 5000, name: 'Savings' },
];

const mockBudgets = [
  { id: 'b1', category: 'Housing', limit: 600, month: 1, year: 2025 },
  { id: 'b2', category: 'Utilities', limit: 150, month: 1, year: 2025 },
];

const mockGoals = [
  { id: 'g1', name: 'Emergency', targetAmount: 20000, currentAmount: 5000, deadline: '2026-12-31' },
];

const mockInvestments = [
  {
    id: 'inv1',
    symbol: 'AAPL',
    quantity: 10,
    shares: 10,
    averageCost: 150,
    avgCost: 150,
    currentPrice: 175,
    type: 'stock',
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTests(): void {
  // buildUnifiedFinancialContext
  const context = buildUnifiedFinancialContext(
    mockTransactions as any,
    mockAccounts as any,
    mockBudgets as any,
    mockGoals as any,
    mockInvestments as any
  );
  assert(!!context, 'context defined');
  assert(!!context.cash, 'cash defined');
  assert(!!context.risk, 'risk defined');
  assert(!!context.household, 'household defined');
  assert(typeof context.cash.availableCash === 'number', 'availableCash number');
  assert(typeof context.cash.cashflowBuffer === 'number', 'cashflowBuffer number');
  assert(typeof context.risk.currentPortfolioRisk === 'number', 'currentPortfolioRisk number');
  assert(Array.isArray(context.household.recurringBills), 'recurringBills array');
  assert(Array.isArray(context.household.cashflowStressSignals), 'cashflowStressSignals array');

  const emptyContext = buildUnifiedFinancialContext([], [], [], [], []);
  assert(emptyContext.cash.availableCash === 0, 'empty availableCash 0');
  assert(emptyContext.cash.cashflowBuffer === 0, 'empty cashflowBuffer 0');

  // runCrossEngineAnalysis
  const analysis = runCrossEngineAnalysis(context);
  assert(!!analysis, 'analysis defined');
  assert(analysis.cashConstraints === context.cash, 'cashConstraints ref');
  assert(analysis.riskConstraints === context.risk, 'riskConstraints ref');
  assert(Array.isArray(analysis.investmentRecommendations), 'investmentRecommendations array');
  assert(Array.isArray(analysis.budgetRecommendations), 'budgetRecommendations array');
  assert(Array.isArray(analysis.alerts), 'alerts array');
  assert(typeof analysis.summary === 'string', 'summary string');

  // validateInvestmentAction
  const buyResult = validateInvestmentAction({ type: 'buy', symbol: 'AAPL', amount: 5000 }, context);
  assert(!!buyResult, 'buy validation result');
  assert(typeof buyResult.isValid === 'boolean', 'isValid boolean');
  assert(Array.isArray(buyResult.reasons), 'reasons array');
  assert(Array.isArray(buyResult.warnings), 'warnings array');

  const sellResult = validateInvestmentAction({ type: 'sell', symbol: 'AAPL', amount: 1000 }, context);
  assert(sellResult.isValid === true, 'sell valid');

  // generatePrioritizedActionQueue
  const queue = generatePrioritizedActionQueue(analysis);
  assert(Array.isArray(queue), 'queue array');
  queue.forEach((item, i) => {
    assert(typeof item.action === 'string', `queue[${i}].action string`);
    assert(typeof item.priority === 'number', `queue[${i}].priority number`);
    assert(typeof item.category === 'string', `queue[${i}].category string`);
    assert(typeof item.details === 'string', `queue[${i}].details string`);
  });
}

runTests();
