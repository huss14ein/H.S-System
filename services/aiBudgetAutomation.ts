/**
 * AI-Powered Budget Automation Service
 * Automatically categorizes expenses, learns from patterns, and provides dynamic recommendations
 */

import { Transaction, Budget } from '../types';
import { invokeAI } from './geminiService';

export interface SpendingPattern {
  category: string;
  averageAmount: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'irregular';
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
  lastSeen: string;
}

export interface AICategorySuggestion {
  transactionId: string;
  description: string;
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  alternativeCategories?: string[];
}

export interface BudgetRecommendation {
  category: string;
  currentLimit: number;
  recommendedLimit: number;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  expectedSavings?: number;
}

export interface PredictiveInsight {
  category: string;
  predictedAmount: number;
  confidence: number;
  factors: string[];
  month: number;
}

/**
 * AI-powered automatic expense categorization
 */
export async function autoCategorizeExpense(
  transaction: Transaction,
  historicalTransactions: Transaction[],
  existingBudgets: Budget[]
): Promise<AICategorySuggestion> {
  const similarTransactions = historicalTransactions
    .filter(t => 
      t.type === 'expense' && 
      t.budgetCategory &&
      Math.abs(t.amount - transaction.amount) < Math.abs(transaction.amount * 0.5)
    )
    .slice(0, 10);

  // Context is used in the prompt below

  const prompt = `Analyze this expense transaction and suggest the most appropriate budget category.

Transaction:
- Description: "${transaction.description}"
- Amount: ${transaction.amount} SAR
- Date: ${transaction.date}

Similar historical transactions:
${similarTransactions.map(t => `- "${t.description}" → ${t.budgetCategory} (${t.amount} SAR)`).join('\n')}

Available categories: ${existingBudgets.map(b => b.category).join(', ')}

For KSA context, consider:
- Housing: rent, apartment, villa, compound
- Groceries: supermarket, hypermarket, food, groceries
- Utilities: SEC (electricity), NWC (water), utilities
- Telecommunications: STC, Mobily, Zain, internet, fiber
- Transportation: petrol, fuel, gas station, metro, uber, careem
- Domestic Help: maid, driver, domestic
- Dining & Entertainment: restaurant, cafe, netflix, shahid, entertainment
- Health: clinic, hospital, pharmacy, medical, insurance
- Education: school, tuition, books, uniform
- Remittances: remittance, transfer, western union, moneygram

Respond in JSON format:
{
  "suggestedCategory": "category name",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "alternativeCategories": ["alt1", "alt2"]
}`;

  try {
    const response = await invokeAI({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || '';
    const parsed = JSON.parse(text);
    
    return {
      transactionId: transaction.id,
      description: transaction.description,
      suggestedCategory: parsed.suggestedCategory || 'Miscellaneous',
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || 'AI analysis',
      alternativeCategories: parsed.alternativeCategories || []
    };
  } catch (error) {
    // Fallback to pattern matching
    return fallbackCategorization(transaction, historicalTransactions, existingBudgets);
  }
}

/**
 * Fallback categorization using pattern matching
 */
function fallbackCategorization(
  transaction: Transaction,
  historicalTransactions: Transaction[],
  existingBudgets: Budget[]
): AICategorySuggestion {
  const desc = transaction.description.toLowerCase();
  
  // Pattern matching for common KSA expenses
  const patterns: Record<string, string[]> = {
    'Housing': ['rent', 'apartment', 'villa', 'compound', 'housing'],
    'Groceries': ['supermarket', 'hypermarket', 'panda', 'carrefour', 'danube', 'lulu', 'food', 'grocery'],
    'Utilities': ['sec', 'nwc', 'electricity', 'water', 'utility'],
    'Telecommunications': ['stc', 'mobily', 'zain', 'internet', 'fiber', '5g', 'mobile'],
    'Transportation': ['petrol', 'fuel', 'gas station', 'metro', 'uber', 'careem', 'taxi'],
    'Dining & Entertainment': ['restaurant', 'cafe', 'netflix', 'shahid', 'entertainment', 'cinema'],
    'Health': ['clinic', 'hospital', 'pharmacy', 'medical', 'doctor'],
    'Education': ['school', 'tuition', 'books', 'uniform', 'education'],
    'Remittances': ['remittance', 'transfer', 'western union', 'moneygram']
  };

  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some(keyword => desc.includes(keyword))) {
      return {
        transactionId: transaction.id,
        description: transaction.description,
        suggestedCategory: category,
        confidence: 0.7,
        reasoning: `Matched pattern: ${keywords.find(k => desc.includes(k))}`
      };
    }
  }

  // Check historical patterns
  const similar = historicalTransactions.find(t => 
    t.type === 'expense' && 
    t.budgetCategory &&
    desc.includes(t.description.toLowerCase().split(' ')[0])
  );

  return {
    transactionId: transaction.id,
    description: transaction.description,
    suggestedCategory: similar?.budgetCategory || existingBudgets[0]?.category || 'Miscellaneous',
    confidence: similar ? 0.6 : 0.3,
    reasoning: similar ? 'Matched historical pattern' : 'Default category'
  };
}

/**
 * Analyze spending patterns using AI
 */
export async function analyzeSpendingPatternsAI(
  transactions: Transaction[],
  _budgets: Budget[]
): Promise<SpendingPattern[]> {
  const expenses = transactions.filter(t => t.type === 'expense' && t.budgetCategory);
  const categoryGroups = new Map<string, Transaction[]>();
  
  expenses.forEach(t => {
    const cat = t.budgetCategory || 'Miscellaneous';
    if (!categoryGroups.has(cat)) {
      categoryGroups.set(cat, []);
    }
    categoryGroups.get(cat)!.push(t);
  });

  const patterns: SpendingPattern[] = [];

  for (const [category, txs] of categoryGroups.entries()) {
    if (txs.length === 0) continue;

    const amounts = txs.map(t => Math.abs(t.amount));
    const averageAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    
    // Calculate frequency
    const dates = txs.map(t => new Date(t.date)).sort((a, b) => a.getTime() - b.getTime());
    const daysBetween = dates.length > 1 
      ? (dates[dates.length - 1].getTime() - dates[0].getTime()) / (1000 * 60 * 60 * 24) / dates.length
      : 30;
    
    let frequency: 'daily' | 'weekly' | 'monthly' | 'irregular';
    if (daysBetween <= 2) frequency = 'daily';
    else if (daysBetween <= 8) frequency = 'weekly';
    else if (daysBetween <= 35) frequency = 'monthly';
    else frequency = 'irregular';

    // Calculate trend
    const recent = amounts.slice(-3);
    const older = amounts.slice(0, -3);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
    
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (recentAvg > olderAvg * 1.1) trend = 'increasing';
    else if (recentAvg < olderAvg * 0.9) trend = 'decreasing';
    else trend = 'stable';

    patterns.push({
      category,
      averageAmount,
      frequency,
      trend,
      confidence: Math.min(txs.length / 10, 1), // More transactions = higher confidence
      lastSeen: dates[dates.length - 1].toISOString()
    });
  }

  return patterns;
}

/**
 * Generate AI-powered budget recommendations
 */
export async function generateBudgetRecommendations(
  transactions: Transaction[],
  budgets: Budget[],
  currentMonth: number,
  currentYear: number
): Promise<BudgetRecommendation[]> {
  const expenses = transactions.filter(t => 
    t.type === 'expense' && 
    t.budgetCategory &&
    new Date(t.date).getMonth() + 1 === currentMonth &&
    new Date(t.date).getFullYear() === currentYear
  );

  const categorySpending = new Map<string, number>();
  expenses.forEach(t => {
    const cat = t.budgetCategory || 'Miscellaneous';
    categorySpending.set(cat, (categorySpending.get(cat) || 0) + Math.abs(t.amount));
  });

  const recommendations: BudgetRecommendation[] = [];

  for (const budget of budgets) {
    if (budget.month !== currentMonth || budget.year !== currentYear) continue;

    const spent = categorySpending.get(budget.category) || 0;
    const limit = budget.period === 'yearly' ? budget.limit / 12 : budget.limit;
    const utilization = limit > 0 ? (spent / limit) * 100 : 0;

    // Analyze historical spending for this category
    const historical = transactions.filter(t =>
      t.type === 'expense' &&
      t.budgetCategory === budget.category &&
      new Date(t.date).getFullYear() === currentYear
    );
    const historicalAvg = historical.length > 0
      ? historical.reduce((sum, t) => sum + Math.abs(t.amount), 0) / historical.length
      : 0;

    let recommendedLimit = limit;
    let reason = '';
    let priority: 'high' | 'medium' | 'low' = 'low';
    let expectedSavings = 0;

    if (utilization > 110) {
      // Over budget - recommend increase or spending reduction
      recommendedLimit = Math.max(limit, spent * 1.1);
      reason = `Currently ${utilization.toFixed(0)}% over budget. Consider increasing limit or reducing spending.`;
      priority = 'high';
    } else if (utilization > 90 && utilization <= 110) {
      // Near limit
      recommendedLimit = spent * 1.15;
      reason = `At ${utilization.toFixed(0)}% of budget. Slight increase recommended for buffer.`;
      priority = 'medium';
    } else if (utilization < 50 && historicalAvg > 0) {
      // Underutilized - might be too high
      recommendedLimit = Math.max(historicalAvg * 1.1, limit * 0.7);
      expectedSavings = limit - recommendedLimit;
      reason = `Only ${utilization.toFixed(0)}% utilized. Budget may be too high. Consider reducing to free up funds.`;
      priority = 'medium';
    } else if (historicalAvg > limit * 1.2) {
      // Historical spending consistently higher
      recommendedLimit = historicalAvg * 1.1;
      reason = `Historical average (${historicalAvg.toFixed(0)} SAR) is ${((historicalAvg / limit - 1) * 100).toFixed(0)}% above current limit.`;
      priority = 'high';
    }

    if (recommendedLimit !== limit) {
      recommendations.push({
        category: budget.category,
        currentLimit: limit,
        recommendedLimit: Math.round(recommendedLimit),
        reason,
        priority,
        expectedSavings: expectedSavings > 0 ? Math.round(expectedSavings) : undefined
      });
    }
  }

  // Use AI to refine recommendations
  if (recommendations.length > 0) {
    try {
      const prompt = `Analyze these budget recommendations and provide AI insights:

${recommendations.map(r => `
Category: ${r.category}
Current: ${r.currentLimit} SAR
Recommended: ${r.recommendedLimit} SAR
Reason: ${r.reason}
`).join('\n')}

Provide refined recommendations considering:
1. KSA-specific expense patterns
2. Seasonal variations (summer utility spikes)
3. Household size and lifestyle
4. Financial goals

Respond with JSON array of refined recommendations with enhanced reasoning.`;

      const aiResponse = await invokeAI({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const text = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || aiResponse?.text || '';
      const aiRecommendations = JSON.parse(text);
      
      // Merge AI insights with existing recommendations
      return recommendations.map((rec, idx) => {
        const aiRec = aiRecommendations[idx];
        if (aiRec) {
          return {
            ...rec,
            reason: aiRec.reason || rec.reason,
            priority: aiRec.priority || rec.priority
          };
        }
        return rec;
      });
    } catch (error) {
      console.warn('AI recommendation refinement failed, using base recommendations:', error);
    }
  }

  return recommendations;
}

/**
 * Predict future expenses using AI
 */
export async function predictFutureExpenses(
  transactions: Transaction[],
  _budgets: Budget[],
  monthsAhead: number = 3
): Promise<PredictiveInsight[]> {
  const insights: PredictiveInsight[] = [];
  const now = new Date();
  
  // Group by category
  const categoryData = new Map<string, Transaction[]>();
  transactions.filter(t => t.type === 'expense' && t.budgetCategory).forEach(t => {
    const cat = t.budgetCategory!;
    if (!categoryData.has(cat)) {
      categoryData.set(cat, []);
    }
    categoryData.get(cat)!.push(t);
  });

  for (let monthOffset = 1; monthOffset <= monthsAhead; monthOffset++) {
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    
    for (const [category, txs] of categoryData.entries()) {
      if (txs.length < 3) continue; // Need at least 3 transactions for prediction

      // Calculate trend
      const monthlyTotals = new Map<number, number>();
      txs.forEach(t => {
        const date = new Date(t.date);
        const monthKey = date.getFullYear() * 12 + date.getMonth();
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + Math.abs(t.amount));
      });

      const totals = Array.from(monthlyTotals.values());
      const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
      
      // Simple linear trend
      let trend = 0;
      if (totals.length >= 2) {
        const recent = totals.slice(-3);
        const older = totals.slice(0, -3);
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
        trend = (recentAvg - olderAvg) / olderAvg;
      }

      // Apply seasonal adjustments (summer utilities, etc.)
      let seasonalMultiplier = 1;
      const targetMonthNum = targetMonth.getMonth() + 1;
      if (category.toLowerCase().includes('utilit') && (targetMonthNum >= 6 && targetMonthNum <= 8)) {
        seasonalMultiplier = 1.5; // Summer spike
      }

      const predicted = avg * (1 + trend * monthOffset) * seasonalMultiplier;
      const confidence = Math.min(txs.length / 20, 0.9); // More data = higher confidence

      insights.push({
        category,
        predictedAmount: Math.round(predicted),
        confidence,
        factors: [
          `Historical average: ${Math.round(avg)} SAR`,
          trend > 0 ? `Increasing trend: +${(trend * 100).toFixed(1)}%` : 
          trend < 0 ? `Decreasing trend: ${(trend * 100).toFixed(1)}%` : 'Stable trend',
          seasonalMultiplier !== 1 ? `Seasonal adjustment: ${(seasonalMultiplier * 100).toFixed(0)}%` : ''
        ].filter(f => f),
        month: targetMonthNum
      });
    }
  }

  // Use AI to refine predictions
  try {
    const prompt = `Analyze these expense predictions and provide AI-enhanced insights:

${insights.slice(0, 10).map(i => `
Category: ${i.category}
Month: ${i.month}
Predicted: ${i.predictedAmount} SAR
Confidence: ${(i.confidence * 100).toFixed(0)}%
Factors: ${i.factors.join(', ')}
`).join('\n')}

Consider KSA-specific factors:
- Summer utility spikes (June-August)
- School fees (semester-based)
- Annual expenses (Iqama, dependent fees)
- Holiday spending patterns
- Economic trends

Provide refined predictions with enhanced confidence and factors.`;

    const aiResponse = await invokeAI({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    const text = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || aiResponse?.text || '';
    const aiInsights = JSON.parse(text);
    
    return insights.map((insight, idx) => {
      const aiInsight = aiInsights[idx];
      if (aiInsight) {
        return {
          ...insight,
          predictedAmount: aiInsight.predictedAmount || insight.predictedAmount,
          confidence: aiInsight.confidence || insight.confidence,
          factors: aiInsight.factors || insight.factors
        };
      }
      return insight;
    });
  } catch (error) {
    console.warn('AI prediction refinement failed, using base predictions:', error);
    return insights;
  }
}

/**
 * Learn from user behavior and auto-adjust budgets
 */
export async function learnAndAutoAdjust(
  transactions: Transaction[],
  budgets: Budget[],
  currentMonth: number,
  currentYear: number
): Promise<Budget[]> {
  const expenses = transactions.filter(t =>
    t.type === 'expense' &&
    t.budgetCategory &&
    new Date(t.date).getFullYear() === currentYear
  );

  const categorySpending = new Map<string, { total: number; count: number; months: Set<number> }>();
  
  expenses.forEach(t => {
    const cat = t.budgetCategory!;
    const month = new Date(t.date).getMonth() + 1;
    if (!categorySpending.has(cat)) {
      categorySpending.set(cat, { total: 0, count: 0, months: new Set() });
    }
    const data = categorySpending.get(cat)!;
    data.total += Math.abs(t.amount);
    data.count++;
    data.months.add(month);
  });

  const adjustedBudgets = budgets.map(budget => {
    if (budget.month !== currentMonth || budget.year !== currentYear) return budget;

    const spending = categorySpending.get(budget.category);
    if (!spending || spending.months.size < 2) return budget; // Need at least 2 months of data

    const avgMonthlySpending = spending.total / spending.months.size;
    const currentLimit = budget.period === 'yearly' ? budget.limit / 12 : budget.limit;

    // Auto-adjust if spending consistently differs by more than 20%
    if (avgMonthlySpending > currentLimit * 1.2) {
      // Spending is consistently higher - increase budget
      const newLimit = Math.round(avgMonthlySpending * 1.1); // 10% buffer
      return {
        ...budget,
        limit: budget.period === 'yearly' ? newLimit * 12 : newLimit
      };
    } else if (avgMonthlySpending < currentLimit * 0.7 && spending.months.size >= 3) {
      // Spending is consistently lower - decrease budget (but only after 3+ months)
      const newLimit = Math.round(avgMonthlySpending * 1.1);
      return {
        ...budget,
        limit: budget.period === 'yearly' ? newLimit * 12 : newLimit
      };
    }

    return budget;
  });

  return adjustedBudgets;
}
