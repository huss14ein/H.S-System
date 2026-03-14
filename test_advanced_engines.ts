/**
 * Comprehensive Test Suite for Advanced Investment and Budget Logic
 * Tests all new engines and integration layer
 */

import {
  calculatePositionRisk,
  calculatePortfolioRisk,
  calculatePositionSizeLimits,
  calculateSleeveRiskAllocation,
  RiskMetrics
} from '../services/advancedRiskScoring';

import {
  calculateOptimalSleeveAllocation,
  classifyPositionsIntoSleeves,
  calculateSleeveRebalanceActions,
  isRebalancingNeeded,
  RebalancePolicy
} from '../services/sleeveAllocation';

import {
  calculateTradeScore,
  rankTradeCandidates,
  TradeCandidate,
  DEFAULT_RANKING_WEIGHTS,
  CONSERVATIVE_WEIGHTS
} from '../services/tradeRanking';

import {
  calculateDynamicBaselines,
  generatePredictiveSpend,
  generateCashflowStressSignals,
  analyzeSpendingPatterns,
  calculateBudgetHealthMetrics,
  generateSmartBudgetRecommendations
} from '../services/enhancedBudgetEngine';

import {
  classifyTransaction,
  batchClassifyTransactions,
  detectRecurringBillPatterns,
  EXPENSE_CATEGORIES,
  RecurringBillPattern
} from '../services/hybridBudgetCategorization';

import {
  buildUnifiedFinancialContext,
  runCrossEngineAnalysis,
  validateInvestmentAction,
  generatePrioritizedActionQueue,
  UnifiedFinancialContext
} from '../services/engineIntegration';

// Mock data for testing
const mockTransactions = [
  { id: '1', amount: -2500, type: 'expense', category: 'Housing', description: 'Rent payment', date: '2024-03-01' },
  { id: '2', amount: -150, type: 'expense', category: 'Utilities', description: 'Electric bill', date: '2024-03-05' },
  { id: '3', amount: -80, type: 'expense', category: 'Food', description: 'Grocery shopping', date: '2024-03-07' },
  { id: '4', amount: -45, type: 'expense', category: 'Food', description: 'Grocery shopping', date: '2024-03-10' },
  { id: '5', amount: -120, type: 'expense', category: 'Transport', description: 'Gas station', date: '2024-03-12' },
  { id: '6', amount: -2000, type: 'income', category: 'Salary', description: 'Monthly salary', date: '2024-03-01' }
];

const mockAccounts = [
  { id: 'acc1', name: 'Checking', type: 'Checking', balance: 5000 },
  { id: 'acc2', name: 'Savings', type: 'Savings', balance: 15000 },
  { id: 'acc3', name: 'Investment', type: 'Investment', balance: 50000 }
];

const mockInvestments = [
  { symbol: 'AAPL', shares: 10, avgCost: 150, currentPrice: 175, sector: 'Technology' },
  { symbol: 'MSFT', shares: 5, avgCost: 200, currentPrice: 220, sector: 'Technology' },
  { symbol: 'JNJ', shares: 8, avgCost: 160, currentPrice: 165, sector: 'Healthcare' }
];

const mockBudgets = [
  { id: 'b1', category: 'Housing', limit: 2500, spent: 2500, monthlyLimit: 2500 },
  { id: 'b2', category: 'Food', limit: 500, spent: 350, monthlyLimit: 500 },
  { id: 'b3', category: 'Transport', limit: 300, spent: 120, monthlyLimit: 300 }
];

// Test 1: Risk Scoring
console.log('\n=== Test 1: Advanced Risk Scoring ===');
function testRiskScoring() {
  const position = {
    symbol: 'AAPL',
    shares: 10,
    currentPrice: 175,
    marketValue: 1750,
    avgCost: 150,
    sector: 'Technology',
    assetClass: 'Equity',
    priceHistory: [170, 172, 175, 173, 175, 176, 175],
    returns: [0.012, 0.017, 0, -0.011, 0.012, 0, -0.006]
  };
  
  const otherPositions = [{
    symbol: 'MSFT',
    shares: 5,
    currentPrice: 220,
    marketValue: 1100,
    avgCost: 200,
    sector: 'Technology',
    assetClass: 'Equity',
    returns: [0.005, 0.008, 0.003, 0.001, 0.004, 0.002, 0.003]
  }];
  
  const risk = calculatePositionRisk(position, 50000, otherPositions);
  
  console.log('Position Risk Metrics:');
  console.log(`  Volatility: ${(risk.volatility * 100).toFixed(2)}%`);
  console.log(`  Max Drawdown: ${(risk.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  VaR (95%): ${risk.var95.toFixed(2)}`);
  console.log(`  Risk Score: ${risk.overallRiskScore}/100`);
  console.log(`  Risk Rating: ${risk.riskRating}`);
  
  // Test position size limits
  const limits = calculatePositionSizeLimits(risk, 50000, 'Moderate');
  console.log('\nPosition Size Limits:');
  console.log(`  Max Position: ${(limits.maxPositionSize).toFixed(0)}`);
  console.log(`  Recommended: ${(limits.recommendedPositionSize).toFixed(0)}`);
  
  return risk.overallRiskScore > 0 && risk.overallRiskScore <= 100;
}

// Test 2: Sleeve Allocation
console.log('\n=== Test 2: Sleeve Allocation ===');
function testSleeveAllocation() {
  const optimal = calculateOptimalSleeveAllocation('Moderate', 20, 5);
  console.log('Optimal Sleeve Allocation (Moderate, 5 years):');
  console.log(`  Core: ${(optimal.core * 100).toFixed(1)}%`);
  console.log(`  Upside: ${(optimal.upside * 100).toFixed(1)}%`);
  console.log(`  Speculative: ${(optimal.speculative * 100).toFixed(1)}%`);
  
  const total = optimal.core + optimal.upside + optimal.speculative;
  console.log(`  Total: ${(total * 100).toFixed(1)}%`);
  
  return Math.abs(total - 1) < 0.01;
}

// Test 3: Trade Ranking
console.log('\n=== Test 3: Trade Ranking ===');
function testTradeRanking() {
  const candidates: TradeCandidate[] = [
    {
      symbol: 'AAPL',
      currentPrice: 175,
      sector: 'Technology',
      assetClass: 'Equity',
      peRatio: 28,
      epsGrowth: 15,
      roe: 25,
      priceVsSMA50: 8,
      rsi14: 58,
      beta: 1.2
    },
    {
      symbol: 'JNJ',
      currentPrice: 165,
      sector: 'Healthcare',
      assetClass: 'Equity',
      peRatio: 18,
      epsGrowth: 8,
      roe: 18,
      priceVsSMA50: 3,
      rsi14: 48,
      beta: 0.7,
      dividendYield: 2.6
    }
  ];
  
  const scores = rankTradeCandidates(candidates, undefined, DEFAULT_RANKING_WEIGHTS);
  
  console.log('Trade Rankings:');
  scores.forEach(score => {
    console.log(`  ${score.rank}. ${score.symbol}: ${score.overallScore}/100 (${score.recommendation})`);
    console.log(`    Value: ${score.valueScore}, Growth: ${score.growthScore}, Momentum: ${score.momentumScore}, Risk: ${score.riskScore}`);
  });
  
  return scores.length > 0 && scores[0].overallScore > 0;
}

// Test 4: Enhanced Budget Engine
console.log('\n=== Test 4: Enhanced Budget Engine ===');
function testEnhancedBudgetEngine() {
  const baselines = calculateDynamicBaselines(mockTransactions, 3);
  console.log('Dynamic Baselines:');
  baselines.forEach(b => {
    console.log(`  ${b.category}: ${b.baselineAmount.toFixed(0)} (${b.trendDirection}, confidence: ${b.confidenceInterval.lower.toFixed(0)}-${b.confidenceInterval.upper.toFixed(0)})`);
  });
  
  // Test predictive spend
  const predictions = generatePredictiveSpend(baselines, 3, mockTransactions, []);
  console.log('\nPredictive Spend (March):');
  predictions.slice(0, 3).forEach(p => {
    console.log(`  ${p.category}: ${p.predictedAmount} (confidence: ${p.confidence}%, risk: ${p.riskOfOverrun}%)`);
  });
  
  // Test stress signals
  const stressSignals = generateCashflowStressSignals(
    5000, 2000, 2000, 1500, 10000, 15
  );
  console.log('\nCashflow Stress Signals:');
  stressSignals.forEach(s => {
    console.log(`  [${s.type.toUpperCase()}] ${s.message} (impact: ${s.impactScore})`);
  });
  
  return baselines.length > 0;
}

// Test 5: Hybrid Budget Categorization
console.log('\n=== Test 5: Hybrid Budget Categorization ===');
function testHybridCategorization() {
  // Test transaction classification
  const testTx = {
    id: 'test1',
    amount: -45,
    type: 'expense' as const,
    description: 'Whole Foods Market',
    date: '2024-03-15'
  };
  
  const result = classifyTransaction(testTx, false);
  console.log('Transaction Classification:');
  console.log(`  Description: "${testTx.description}"`);
  console.log(`  Category: ${result.category} (confidence: ${result.confidence}%, method: ${result.method})`);
  
  // Test recurring bill detection
  const recurringBills = detectRecurringBillPatterns(mockTransactions, 2);
  console.log('\nRecurring Bill Patterns:');
  recurringBills.forEach(bill => {
    console.log(`  ${bill.merchant}: ${bill.typicalAmount}/month (reliability: ${bill.reliabilityScore}%)`);
  });
  
  return result.category !== 'Uncategorized';
}

// Test 6: Engine Integration
console.log('\n=== Test 6: Engine Integration ===');
function testEngineIntegration() {
  const context = buildUnifiedFinancialContext(
    mockTransactions,
    mockAccounts,
    mockBudgets,
    [],
    mockInvestments
  );
  
  console.log('Unified Financial Context:');
  console.log(`  Available Cash: ${context.cash.availableCash}`);
  console.log(`  Cashflow Buffer: ${context.cash.cashflowBuffer.toFixed(1)} months`);
  console.log(`  Portfolio Risk: ${context.risk.currentPortfolioRisk}/100`);
  console.log(`  Recurring Bills: ${context.household.recurringBills.length}`);
  
  // Run cross-engine analysis
  const analysis = runCrossEngineAnalysis(context);
  console.log('\nCross-Engine Analysis:');
  console.log(`  Alerts: ${analysis.alerts.length}`);
  console.log(`  Investment Recs: ${analysis.investmentRecommendations.length}`);
  console.log(`  Budget Recs: ${analysis.budgetRecommendations.length}`);
  console.log(`  Summary: ${analysis.summary}`);
  
  // Test investment validation
  const validation = validateInvestmentAction(
    { type: 'buy', symbol: 'AAPL', amount: 5000 },
    context
  );
  console.log('\nInvestment Validation (Buy AAPL $5000):');
  console.log(`  Valid: ${validation.isValid}`);
  if (validation.reasons.length > 0) {
    console.log(`  Reasons: ${validation.reasons.join(', ')}`);
  }
  if (validation.warnings.length > 0) {
    console.log(`  Warnings: ${validation.warnings.join(', ')}`);
  }
  
  // Generate action queue
  const actionQueue = generatePrioritizedActionQueue(analysis);
  console.log('\nPrioritized Action Queue:');
  actionQueue.slice(0, 3).forEach((action, i) => {
    console.log(`  ${i + 1}. [${action.priority}] ${action.action}`);
  });
  
  return context.cash.availableCash > 0;
}

// Test 7: Constraint Validation
console.log('\n=== Test 7: Constraint Validation ===');
function testConstraintValidation() {
  const context = buildUnifiedFinancialContext(
    mockTransactions,
    mockAccounts,
    mockBudgets,
    [],
    mockInvestments
  );
  
  // Test large purchase (should fail due to cash constraints)
  const largePurchase = validateInvestmentAction(
    { type: 'buy', symbol: 'TSLA', amount: 30000 },
    context
  );
  
  console.log('Large Purchase Validation ($30,000):');
  console.log(`  Valid: ${largePurchase.isValid}`);
  console.log(`  Expected: false (exceeds available cash)`);
  
  // Test reasonable purchase
  const reasonablePurchase = validateInvestmentAction(
    { type: 'buy', symbol: 'VTI', amount: 2000 },
    context
  );
  
  console.log('\nReasonable Purchase Validation ($2,000):');
  console.log(`  Valid: ${reasonablePurchase.isValid}`);
  console.log(`  Expected: true`);
  
  return !largePurchase.isValid && reasonablePurchase.isValid;
}

// Test 8: Budget Health Metrics
console.log('\n=== Test 8: Budget Health Metrics ===');
function testBudgetHealthMetrics() {
  const budgetsWithSpending = mockBudgets.map(b => ({
    ...b,
    spent: b.category === 'Housing' ? b.limit : b.limit * 0.7
  }));
  
  const metrics = calculateBudgetHealthMetrics(
    budgetsWithSpending,
    mockTransactions,
    3
  );
  
  console.log('Budget Health Metrics:');
  console.log(`  Adherence Score: ${metrics.adherenceScore}/100`);
  console.log(`  Forecast Accuracy: ${metrics.forecastAccuracy}/100`);
  console.log(`  Stress Resilience: ${metrics.stressResilience}/100`);
  console.log(`  Optimization Potential: ${metrics.optimizationPotential}/100`);
  console.log(`  Behavioral Risk: ${metrics.behavioralRiskScore}/100`);
  
  return metrics.adherenceScore > 0;
}

// Run all tests
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  ADVANCED INVESTMENT & BUDGET ENGINE TEST SUITE      ║');
console.log('╚════════════════════════════════════════════════════════╝');

const tests = [
  { name: 'Risk Scoring', fn: testRiskScoring },
  { name: 'Sleeve Allocation', fn: testSleeveAllocation },
  { name: 'Trade Ranking', fn: testTradeRanking },
  { name: 'Enhanced Budget Engine', fn: testEnhancedBudgetEngine },
  { name: 'Hybrid Categorization', fn: testHybridCategorization },
  { name: 'Engine Integration', fn: testEngineIntegration },
  { name: 'Constraint Validation', fn: testConstraintValidation },
  { name: 'Budget Health Metrics', fn: testBudgetHealthMetrics }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  try {
    const result = test.fn();
    if (result) {
      passed++;
      console.log(`\n✅ ${test.name}: PASSED`);
    } else {
      failed++;
      console.log(`\n❌ ${test.name}: FAILED`);
    }
  } catch (error) {
    failed++;
    console.log(`\n❌ ${test.name}: ERROR - ${error.message}`);
  }
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`\nTest Results: ${passed}/${tests.length} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n✅ All tests passed! Systems ready for integration.');
} else {
  console.log('\n⚠️  Some tests failed. Review and fix before deployment.');
}

process.exit(failed > 0 ? 1 : 0);
