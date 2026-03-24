/**
 * Integration Layer for Household, Budget, and Wealth Ultra Engines
 * Ensures consistent constraint sharing and cross-engine communication
 */

import { Transaction, Account, Budget, Goal } from '../types';
import { generateCashflowStressSignals, calculateDynamicBaselines } from './enhancedBudgetEngine';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { detectRecurringBillPatterns } from './hybridBudgetCategorization';
import { calculatePortfolioRisk } from './advancedRiskScoring';

interface Investment {
  id: string;
  symbol: string;
  quantity: number;
  shares: number;
  averageCost: number;
  avgCost: number;
  currentPrice: number;
  type: string;
}

/** Composite risk scores are weighted sums of floats; clamp to 0–100 and round for stable UI and alerts. */
export function roundRiskScore0to100(score: number): number {
  const x = Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0));
  return Math.round(x * 10) / 10;
}

function mapRecurringBillsToInfo(transactions: Transaction[]): RecurringBillInfo[] {
  const patterns = detectRecurringBillPatterns(transactions, 2);
  return patterns.map(p => ({
    merchant: p.merchant,
    amount: p.typicalAmount,
    frequency: p.frequency,
    nextDueDate: p.nextExpectedDate,
    category: p.category,
    isNegotiable: p.canBeNegotiated,
  }));
}

// Constraint interfaces for cross-engine communication
export interface CashConstraints {
  availableCash: number;
  emergencyReserve: number;
  monthlyRequiredExpenses: number;
  discretionaryBudget: number;
  cashflowBuffer: number; // Months of expenses covered
}

export interface RiskConstraints {
  maxPortfolioVolatility: number;
  maxPositionConcentration: number;
  maxSectorExposure: number;
  currentPortfolioRisk: number;
  riskBudgetRemaining: number; // 0-100
}

export interface HouseholdConstraints {
  fixedMonthlyObligations: number;
  essentialSpending: number;
  recurringBills: RecurringBillInfo[];
  upcomingLargeExpenses: UpcomingExpense[];
  cashflowStressSignals: CashflowStressSignal[];
}

export interface RecurringBillInfo {
  merchant: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  nextDueDate: Date;
  category: string;
  isNegotiable: boolean;
}

export interface UpcomingExpense {
  description: string;
  amount: number;
  dueDate: Date;
  category: string;
  isFlexible: boolean;
}

export interface CashflowStressSignal {
  type: 'warning' | 'critical' | 'opportunity';
  message: string;
  impact: number;
  recommendedAction?: string;
}

// Unified context for all engines
export interface UnifiedFinancialContext {
  cash: CashConstraints;
  risk: RiskConstraints;
  household: HouseholdConstraints;
  goals: Goal[];
  transactions: Transaction[];
  accounts: Account[];
  budgets: Budget[];
  investments: Investment[];
}

// Cross-engine integration result
export interface CrossEngineAnalysis {
  cashConstraints: CashConstraints;
  riskConstraints: RiskConstraints;
  householdConstraints: HouseholdConstraints;
  investmentRecommendations: InvestmentRecommendation[];
  budgetRecommendations: BudgetRecommendation[];
  alerts: CrossEngineAlert[];
  summary: string;
}

export interface InvestmentRecommendation {
  type: 'buy' | 'sell' | 'hold' | 'rebalance';
  symbol?: string;
  reason: string;
  priority: number;
  cashImpact: number;
  riskImpact: number;
  householdAlignment: number; // 0-100 how well it fits household constraints
}

export interface BudgetRecommendation {
  category: string;
  currentBudget: number;
  recommendedBudget: number;
  reason: string;
  confidence: number;
}

export interface CrossEngineAlert {
  severity: 'info' | 'warning' | 'critical';
  category: 'cash' | 'risk' | 'household' | 'investment' | 'budget';
  message: string;
  suggestedAction?: string;
  relatedMetrics?: Record<string, number>;
}

/**
 * Build unified financial context from all data sources
 */
export function buildUnifiedFinancialContext(
  transactions: Transaction[],
  accounts: Account[],
  budgets: Budget[],
  goals: Goal[],
  investments: Investment[]
): UnifiedFinancialContext {
  // Calculate cash constraints
  const cashAccounts = accounts.filter(a => a.type === 'Checking' || a.type === 'Savings');
  const totalCash = cashAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  
  // Get recurring bills (hybrid categorization + pattern detection)
  const recurringBills = mapRecurringBillsToInfo(transactions);
  
  const monthlyRecurring = recurringBills
    .filter(b => b.frequency === 'monthly')
    .reduce((sum, b) => sum + (b.amount ?? 0), 0);
  
  // Calculate risk constraints using advanced risk scoring
  const portfolioRisk = computeRiskFromInvestments(investments);
  const portfolioRiskScore = roundRiskScore0to100(portfolioRisk.overallRiskScore || 50);
  
  // Generate cashflow stress signals
  const lastMonthTransactions = transactions.filter(t => {
    const txDate = new Date(t.date);
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return txDate >= monthAgo;
  });
  
  const totalExpenses = lastMonthTransactions
    .filter(t => countsAsExpenseForCashflowKpi(t))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) ?? 0), 0);
  
  const stressSignals = generateCashflowStressSignals(
    totalCash,
    totalExpenses,
    totalCash * 0.1, // Assume 10% is upcoming income
    monthlyRecurring,
    monthlyRecurring * 6, // 6 months emergency fund target
    15 // Assume 15 days until payday
  );
  
  return {
    cash: {
      availableCash: totalCash,
      emergencyReserve: Math.min(totalCash, monthlyRecurring * 6),
      monthlyRequiredExpenses: monthlyRecurring,
      discretionaryBudget: Math.max(0, totalCash - monthlyRecurring * 2),
      cashflowBuffer: totalCash / Math.max(monthlyRecurring, 1)
    },
    risk: {
      maxPortfolioVolatility: 0.25,
      maxPositionConcentration: 0.25,
      maxSectorExposure: 0.30,
      currentPortfolioRisk: portfolioRiskScore,
      riskBudgetRemaining: roundRiskScore0to100(100 - portfolioRiskScore),
    },
    household: {
      fixedMonthlyObligations: monthlyRecurring,
      essentialSpending: monthlyRecurring * 1.2,
      recurringBills,
      upcomingLargeExpenses: [], // Would be populated from calendar/events
      cashflowStressSignals: stressSignals.map(s => ({
        type: s.type,
        message: s.message,
        impact: s.impactScore,
        recommendedAction: s.recommendedAction
      }))
    },
    goals,
    transactions,
    accounts,
    budgets,
    investments
  };
}

function computeRiskFromInvestments(investments: Investment[]): { overallRiskScore: number; concentrationRisk: number } {
  if (investments.length === 0) {
    return { overallRiskScore: 50, concentrationRisk: 0 };
  }
  const positions = investments.map(inv => {
    const shares = inv.shares ?? inv.quantity ?? 0;
    const price = inv.currentPrice || inv.avgCost || inv.averageCost || 0;
    const marketValue = shares * price;
    return {
      symbol: inv.symbol || inv.id,
      shares,
      currentPrice: price,
      marketValue,
      avgCost: inv.avgCost ?? inv.averageCost ?? 0,
      sector: 'Unknown',
      assetClass: inv.type || 'stock',
    };
  });
  const totalPortfolioValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  if (totalPortfolioValue <= 0) {
    return { overallRiskScore: 50, concentrationRisk: 0 };
  }
  const { portfolioMetrics } = calculatePortfolioRisk({
    positions,
    cashBalance: 0,
    totalPortfolioValue,
  });
  return {
    overallRiskScore: portfolioMetrics.overallRiskScore,
    concentrationRisk: portfolioMetrics.concentrationRisk,
  };
}

/**
 * Run cross-engine analysis to generate integrated recommendations
 */
export function runCrossEngineAnalysis(context: UnifiedFinancialContext): CrossEngineAnalysis {
  const recommendations: InvestmentRecommendation[] = [];
  const budgetRecommendations: BudgetRecommendation[] = [];
  const alerts: CrossEngineAlert[] = [];
  
  // Check cash constraints
  if (context.cash.cashflowBuffer < 2) {
    alerts.push({
      severity: 'critical',
      category: 'cash',
      message: `Cashflow buffer critically low (${context.cash.cashflowBuffer.toFixed(1)} months)`,
      suggestedAction: 'Pause non-essential investments, focus on building emergency reserve',
      relatedMetrics: { cashflowBuffer: context.cash.cashflowBuffer }
    });
    
    recommendations.push({
      type: 'hold',
      reason: 'Insufficient cash reserves for new investments',
      priority: 100,
      cashImpact: 0,
      riskImpact: 0,
      householdAlignment: 100
    });
  }
  
  // Check risk constraints
  if (context.risk.currentPortfolioRisk > 70) {
    alerts.push({
      severity: 'warning',
      category: 'risk',
      message: `Portfolio risk elevated (${context.risk.currentPortfolioRisk}/100)`,
      suggestedAction: 'Consider rebalancing to reduce concentration risk',
      relatedMetrics: { portfolioRisk: context.risk.currentPortfolioRisk }
    });
  }
  
  // Check household stress signals
  const criticalStress = context.household.cashflowStressSignals.find(s => s.type === 'critical');
  if (criticalStress) {
    alerts.push({
      severity: 'critical',
      category: 'household',
      message: criticalStress.message,
      suggestedAction: criticalStress.recommendedAction,
      relatedMetrics: { impact: criticalStress.impact }
    });
  }
  
  // Check budget health
  const dynamicBaselines = calculateDynamicBaselines(context.transactions);
  context.budgets.forEach(budget => {
    const baseline = dynamicBaselines.find(b => b.category === budget.category);
    if (baseline && baseline.trendDirection === 'increasing') {
      budgetRecommendations.push({
        category: budget.category,
        currentBudget: budget.limit || 0,
        recommendedBudget: Math.round(baseline.baselineAmount * 1.1),
        reason: `Spending trending up, align budget with actual usage`,
        confidence: 75
      });
    }
  });
  
  // Generate investment recommendations if cash allows
  if (context.cash.cashflowBuffer > 3 && context.cash.discretionaryBudget > 5000) {
    recommendations.push({
      type: 'buy',
      reason: 'Healthy cash position allows for investment opportunities',
      priority: 50,
      cashImpact: -Math.min(context.cash.discretionaryBudget * 0.3, 10000),
      riskImpact: 5,
      householdAlignment: 80
    });
  }
  
  // Summary
  const summary = generateAnalysisSummary(context, alerts, recommendations);
  
  return {
    cashConstraints: context.cash,
    riskConstraints: context.risk,
    householdConstraints: context.household,
    investmentRecommendations: recommendations.sort((a, b) => b.priority - a.priority),
    budgetRecommendations: budgetRecommendations.sort((a, b) => b.confidence - a.confidence),
    alerts: alerts.sort((a, b) => severityToScore(b.severity) - severityToScore(a.severity)),
    summary
  };
}

/**
 * Validate if an investment action is safe given all constraints
 */
export function validateInvestmentAction(
  action: { type: 'buy' | 'sell'; symbol: string; amount: number },
  context: UnifiedFinancialContext
): { isValid: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  
  // Cash constraint check
  const amount = action.amount ?? 0;
  if (action.type === 'buy') {
    if (amount > context.cash.discretionaryBudget) {
      reasons.push(`Insufficient discretionary cash (${context.cash.discretionaryBudget.toFixed(0)} available)`);
    }
    
    if (amount > context.cash.availableCash * 0.3) {
      warnings.push('Large purchase may impact liquidity');
    }
    
    if (context.cash.cashflowBuffer < 3) {
      warnings.push('Low cashflow buffer - consider building reserves first');
    }
  }
  
  // Risk constraint check
  const availableCash = Math.max(0, context.cash.availableCash);
  const newPositionSize = availableCash > 0 ? amount / availableCash : 0;
  if (newPositionSize > context.risk.maxPositionConcentration) {
    reasons.push(`Position size (${(newPositionSize * 100).toFixed(1)}%) exceeds max concentration (${(context.risk.maxPositionConcentration * 100).toFixed(1)}%)`);
  }
  
  // Household constraint check
  const upcomingBills = context.household.recurringBills
    .filter(b => {
      const daysUntil = Math.floor((b.nextDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return daysUntil > 0 && daysUntil < 30;
    })
    .reduce((sum, b) => sum + (b.amount ?? 0), 0);
  
  if (action.type === 'buy' && amount > context.cash.availableCash - upcomingBills - context.household.fixedMonthlyObligations) {
    warnings.push('Purchase may leave insufficient funds for near-term essential expenses');
  }
  
  return {
    isValid: reasons.length === 0,
    reasons,
    warnings
  };
}

/**
 * Generate prioritized action queue across all engines
 */
export function generatePrioritizedActionQueue(
  analysis: CrossEngineAnalysis
): Array<{ action: string; priority: number; category: string; details: string }> {
  const actions: Array<{ action: string; priority: number; category: string; details: string }> = [];
  
  // Critical alerts first
  analysis.alerts
    .filter(a => a.severity === 'critical')
    .forEach(alert => {
      actions.push({
        action: 'URGENT: ' + alert.message,
        priority: 100,
        category: alert.category,
        details: alert.suggestedAction || 'Immediate attention required'
      });
    });
  
  // High priority recommendations
  analysis.investmentRecommendations
    .filter(r => r.priority > 70)
    .forEach(rec => {
      actions.push({
        action: `Investment: ${rec.type.toUpperCase()}`,
        priority: rec.priority,
        category: 'investment',
        details: rec.reason
      });
    });
  
  // Budget adjustments
  analysis.budgetRecommendations
    .filter(b => b.confidence > 80)
    .forEach(rec => {
      actions.push({
        action: `Budget: Adjust ${rec.category}`,
        priority: rec.confidence * 0.8,
        category: 'budget',
        details: rec.reason
      });
    });
  
  // Warning alerts
  analysis.alerts
    .filter(a => a.severity === 'warning')
    .forEach(alert => {
      actions.push({
        action: 'Warning: ' + alert.message,
        priority: 50,
        category: alert.category,
        details: alert.suggestedAction || 'Review recommended'
      });
    });
  
  return actions.sort((a, b) => b.priority - a.priority);
}

// Helper functions
function severityToScore(severity: string): number {
  return { critical: 100, warning: 50, info: 10 }[severity] || 0;
}

function generateAnalysisSummary(
  context: UnifiedFinancialContext,
  alerts: CrossEngineAlert[],
  recommendations: InvestmentRecommendation[]
): string {
  const parts: string[] = [];
  
  // Cash status
  if (context.cash.cashflowBuffer >= 6) {
    parts.push(`Strong cash position (${context.cash.cashflowBuffer.toFixed(1)} months buffer)`);
  } else if (context.cash.cashflowBuffer >= 3) {
    parts.push(`Adequate cash (${context.cash.cashflowBuffer.toFixed(1)} months buffer)`);
  } else {
    parts.push(`Tight cash position (${context.cash.cashflowBuffer.toFixed(1)} months buffer)`);
  }
  
  // Risk status
  parts.push(`Portfolio risk: ${context.risk.currentPortfolioRisk}/100`);
  
  // Alert count
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  
  if (criticalCount > 0) {
    parts.push(`${criticalCount} critical issues require immediate attention`);
  } else if (warningCount > 0) {
    parts.push(`${warningCount} warnings to review`);
  } else {
    parts.push('All systems healthy');
  }
  
  // Recommendations
  if (recommendations.length > 0) {
    parts.push(`${recommendations.length} investment recommendations available`);
  }
  
  return parts.join('. ') + '.';
}

// Export all new services
export * from './advancedRiskScoring';
export * from './sleeveAllocation';
export * from './tradeRanking';
export * from './enhancedBudgetEngine';
export * from './hybridBudgetCategorization';
