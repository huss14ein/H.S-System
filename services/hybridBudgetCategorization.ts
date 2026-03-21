/**
 * Hybrid AI/Local Budget Categorization System
 * Combines AI-powered classification with local rule-based fallback
 */

import { Transaction } from '../types';

// Category definitions with price benchmarks
export interface CategoryDefinition {
  name: string;
  description: string;
  typicalRange: { min: number; max: number };
  frequency: 'daily' | 'weekly' | 'monthly' | 'annual' | 'variable';
  essentialLevel: 'critical' | 'important' | 'discretionary' | 'luxury';
  keywords: string[];
  merchantPatterns: string[];
  priceBenchmarks: PriceBenchmark[];
  aiTrainingExamples: string[];
}

export interface PriceBenchmark {
  item: string;
  typicalPrice: number;
  unit: string;
  priceRange: { low: number; high: number };
  region?: string;
  lastUpdated: Date;
  source: 'ai_aggregated' | 'local_data' | 'user_historical';
}

export interface ClassificationResult {
  category: string;
  confidence: number;
  method: 'ai' | 'rule' | 'hybrid';
  suggestedBudgetCategory: string;
  priceAssessment?: {
    typicalPrice: number;
    actualPrice: number;
    variance: number;
    assessment: 'below_typical' | 'typical' | 'above_typical' | 'premium';
  };
  similarTransactions?: string[];
}

export interface RecurringBillPattern {
  merchant: string;
  category: string;
  typicalAmount: number;
  amountVariance: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  /** Average interval in days between occurrences; use for exact month calculation (e.g. semi-annual ~180d) */
  avgIntervalDays?: number;
  nextExpectedDate: Date;
  reliabilityScore: number; // 0-100
  isSubscription: boolean;
  canBeNegotiated: boolean;
  benchmarkComparison?: {
    marketAverage: number;
    userPays: number;
    percentile: number;
    recommendation?: string;
  };
}

// Comprehensive category taxonomy
export const EXPENSE_CATEGORIES: CategoryDefinition[] = [
  {
    name: 'Housing',
    description: 'Rent, mortgage, HOA and housing charges',
    typicalRange: { min: 800, max: 5000 },
    frequency: 'monthly',
    essentialLevel: 'critical',
    keywords: ['rent', 'mortgage', 'hoa', 'housing', 'apartment', 'lease'],
    merchantPatterns: ['*rent*', '*mortgage*', '*property*', '*hoa*'],
    priceBenchmarks: [
      { item: '1BR Apartment (City Center)', typicalPrice: 2500, unit: 'monthly', priceRange: { low: 1500, high: 4000 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: '3BR House (Suburban)', typicalPrice: 3500, unit: 'monthly', priceRange: { low: 2000, high: 6000 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Monthly rent payment', 'Mortgage payment to bank', 'HOA or housing fee']
  },
  {
    name: 'Utilities',
    description: 'Electricity, water, gas, internet, phone',
    typicalRange: { min: 100, max: 500 },
    frequency: 'monthly',
    essentialLevel: 'critical',
    keywords: ['electric', 'water', 'gas', 'internet', 'wifi', 'phone', 'bill', 'utility'],
    merchantPatterns: ['*electric*', '*water*', '*gas*', '*internet*', '*telecom*', '*utility*'],
    priceBenchmarks: [
      { item: 'Electricity (Apartment)', typicalPrice: 100, unit: 'monthly', priceRange: { low: 60, high: 200 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Internet 100Mbps', typicalPrice: 60, unit: 'monthly', priceRange: { low: 40, high: 100 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Mobile Plan Unlimited', typicalPrice: 50, unit: 'monthly', priceRange: { low: 30, high: 80 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Electric bill payment', 'Internet service fee', 'Mobile phone bill']
  },
  {
    name: 'Food & Dining',
    description: 'Groceries, restaurants, food delivery',
    typicalRange: { min: 300, max: 1500 },
    frequency: 'monthly',
    essentialLevel: 'important',
    keywords: ['grocery', 'restaurant', 'food', 'dining', 'takeout', 'delivery', 'supermarket'],
    merchantPatterns: ['*grocery*', '*supermarket*', '*restaurant*', '*food*', '*dining*'],
    priceBenchmarks: [
      { item: 'Weekly Groceries (1 person)', typicalPrice: 80, unit: 'weekly', priceRange: { low: 50, high: 150 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Restaurant Meal (Casual)', typicalPrice: 25, unit: 'per meal', priceRange: { low: 15, high: 40 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Restaurant Meal (Fine)', typicalPrice: 80, unit: 'per meal', priceRange: { low: 50, high: 150 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Weekly grocery shopping', 'Dinner at Italian restaurant', 'Uber Eats delivery']
  },
  {
    name: 'Transportation',
    description: 'Car payment, gas, maintenance, public transit, rideshare',
    typicalRange: { min: 200, max: 1500 },
    frequency: 'monthly',
    essentialLevel: 'important',
    keywords: ['gas', 'fuel', 'car', 'auto', 'maintenance', 'uber', 'lyft', 'transit', 'bus', 'train'],
    merchantPatterns: ['*gas*', '*fuel*', '*auto*', '*car*', '*uber*', '*lyft*', '*transit*'],
    priceBenchmarks: [
      { item: 'Gas (per gallon)', typicalPrice: 3.50, unit: 'per gallon', priceRange: { low: 3.00, high: 5.00 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Rideshare (per mile)', typicalPrice: 2.50, unit: 'per mile', priceRange: { low: 1.50, high: 4.00 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Monthly Transit Pass', typicalPrice: 100, unit: 'monthly', priceRange: { low: 50, high: 200 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Gas station purchase', 'Uber ride', 'Car maintenance service']
  },
  {
    name: 'Subscriptions',
    description: 'Streaming, software, memberships, recurring services',
    typicalRange: { min: 50, max: 300 },
    frequency: 'monthly',
    essentialLevel: 'discretionary',
    keywords: ['subscription', 'netflix', 'spotify', 'software', 'membership', 'recurring'],
    merchantPatterns: ['*netflix*', '*spotify*', '*apple*', '*subscription*', '*membership*'],
    priceBenchmarks: [
      { item: 'Netflix Standard', typicalPrice: 15, unit: 'monthly', priceRange: { low: 10, high: 20 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Spotify Premium', typicalPrice: 10, unit: 'monthly', priceRange: { low: 5, high: 15 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Gym Membership', typicalPrice: 50, unit: 'monthly', priceRange: { low: 20, high: 150 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Monthly Netflix subscription', 'Spotify Premium', 'Gym membership fee']
  },
  {
    name: 'Shopping',
    description: 'Clothing, electronics, home goods, personal items',
    typicalRange: { min: 100, max: 1000 },
    frequency: 'variable',
    essentialLevel: 'discretionary',
    keywords: ['shopping', 'clothing', 'electronics', 'amazon', 'retail', 'store'],
    merchantPatterns: ['*amazon*', '*retail*', '*store*', '*shopping*', '*mall*'],
    priceBenchmarks: [
      { item: 'Clothing Item (Average)', typicalPrice: 50, unit: 'per item', priceRange: { low: 20, high: 150 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Electronics (Accessory)', typicalPrice: 100, unit: 'per item', priceRange: { low: 20, high: 300 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Amazon purchase', 'Clothing store purchase', 'Electronics store']
  },
  {
    name: 'Entertainment',
    description: 'Movies, events, hobbies, games, concerts',
    typicalRange: { min: 50, max: 500 },
    frequency: 'variable',
    essentialLevel: 'discretionary',
    keywords: ['entertainment', 'movie', 'concert', 'event', 'ticket', 'game', 'hobby'],
    merchantPatterns: ['*ticket*', '*movie*', '*theater*', '*concert*', '*event*', '*game*'],
    priceBenchmarks: [
      { item: 'Movie Ticket', typicalPrice: 15, unit: 'per ticket', priceRange: { low: 10, high: 25 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Concert Ticket', typicalPrice: 100, unit: 'per ticket', priceRange: { low: 40, high: 300 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Video Game', typicalPrice: 60, unit: 'per game', priceRange: { low: 20, high: 80 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Movie theater tickets', 'Concert tickets', 'Steam game purchase']
  },
  {
    name: 'Health & Wellness',
    description: 'Doctor visits, pharmacy, therapy, wellness services',
    typicalRange: { min: 50, max: 500 },
    frequency: 'variable',
    essentialLevel: 'important',
    keywords: ['health', 'medical', 'pharmacy', 'doctor', 'therapy', 'wellness', 'gym'],
    merchantPatterns: ['*medical*', '*pharmacy*', '*doctor*', '*health*', '*wellness*', '*gym*'],
    priceBenchmarks: [
      { item: 'Doctor Visit (Copay)', typicalPrice: 30, unit: 'per visit', priceRange: { low: 20, high: 50 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Prescription (Generic)', typicalPrice: 15, unit: 'per prescription', priceRange: { low: 5, high: 50 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Therapy Session', typicalPrice: 150, unit: 'per session', priceRange: { low: 100, high: 250 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Doctor appointment copay', 'Pharmacy prescription', 'Therapy session']
  },
  {
    name: 'Education',
    description: 'Courses, books, training, tuition, professional development',
    typicalRange: { min: 50, max: 2000 },
    frequency: 'variable',
    essentialLevel: 'important',
    keywords: ['education', 'course', 'book', 'training', 'tuition', 'learning', 'certification'],
    merchantPatterns: ['*course*', '*education*', '*book*', '*training*', '*learning*', '*tuition*'],
    priceBenchmarks: [
      { item: 'Online Course', typicalPrice: 50, unit: 'per course', priceRange: { low: 15, high: 200 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Book (Physical)', typicalPrice: 20, unit: 'per book', priceRange: { low: 10, high: 50 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Certification Exam', typicalPrice: 300, unit: 'per exam', priceRange: { low: 100, high: 1000 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Online course purchase', 'Bookstore purchase', 'Certification exam fee']
  },
  {
    name: 'Financial Services',
    description: 'Bank fees, investment fees, insurance, interest',
    typicalRange: { min: 10, max: 500 },
    frequency: 'monthly',
    essentialLevel: 'critical',
    keywords: ['fee', 'interest', 'insurance', 'investment', 'bank', 'financial'],
    merchantPatterns: ['*bank*', '*insurance*', '*investment*', '*financial*'],
    priceBenchmarks: [
      { item: 'Bank Monthly Fee', typicalPrice: 12, unit: 'monthly', priceRange: { low: 0, high: 25 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Investment Advisory Fee', typicalPrice: 50, unit: 'monthly', priceRange: { low: 0, high: 200 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Bank account fee', 'Investment management fee', 'Insurance premium']
  },
  {
    name: 'Travel',
    description: 'Flights, hotels, vacation expenses, travel booking',
    typicalRange: { min: 500, max: 5000 },
    frequency: 'variable',
    essentialLevel: 'luxury',
    keywords: ['travel', 'flight', 'hotel', 'vacation', 'booking', 'trip', 'airbnb'],
    merchantPatterns: ['*airline*', '*hotel*', '*booking*', '*travel*', '*airbnb*', '*trip*'],
    priceBenchmarks: [
      { item: 'Domestic Flight', typicalPrice: 300, unit: 'per flight', priceRange: { low: 150, high: 600 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Hotel Night (Mid-range)', typicalPrice: 150, unit: 'per night', priceRange: { low: 80, high: 300 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Flight booking', 'Hotel reservation', 'Vacation package']
  },
  {
    name: 'Gifts & Donations',
    description: 'Gifts, charitable donations, contributions',
    typicalRange: { min: 20, max: 500 },
    frequency: 'variable',
    essentialLevel: 'discretionary',
    keywords: ['gift', 'donation', 'charity', 'contribution', 'present'],
    merchantPatterns: ['*gift*', '*charity*', '*donation*', '*present*'],
    priceBenchmarks: [
      { item: 'Birthday Gift (Friend)', typicalPrice: 50, unit: 'per gift', priceRange: { low: 25, high: 100 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Charitable Donation', typicalPrice: 100, unit: 'per donation', priceRange: { low: 20, high: 500 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Birthday gift purchase', 'Charitable donation', 'Holiday presents']
  },
  {
    name: 'Personal Care',
    description: 'Haircut, salon, spa, grooming, cosmetics',
    typicalRange: { min: 30, max: 300 },
    frequency: 'monthly',
    essentialLevel: 'important',
    keywords: ['hair', 'salon', 'spa', 'grooming', 'cosmetics', 'beauty', 'personal care'],
    merchantPatterns: ['*hair*', '*salon*', '*spa*', '*beauty*', '*grooming*'],
    priceBenchmarks: [
      { item: 'Haircut', typicalPrice: 40, unit: 'per cut', priceRange: { low: 20, high: 80 }, source: 'ai_aggregated', lastUpdated: new Date() },
      { item: 'Salon Service', typicalPrice: 80, unit: 'per service', priceRange: { low: 40, high: 200 }, source: 'ai_aggregated', lastUpdated: new Date() }
    ],
    aiTrainingExamples: ['Haircut appointment', 'Salon service', 'Spa treatment']
  }
];

/**
 * Classify a transaction using hybrid AI/Local approach
 */
export function classifyTransaction(
  transaction: Transaction,
  useAI: boolean = false,
  userHistory?: Transaction[]
): ClassificationResult {
  // First try local rule-based classification
  const localResult = classifyWithLocalRules(transaction);
  
  if (localResult.confidence >= 0.85) {
    return localResult;
  }
  
  // If AI is enabled and local confidence is low, use AI
  if (useAI && localResult.confidence < 0.85) {
    // In a real implementation, this would call the AI service
    // For now, we use the local fallback
    const aiResult = classifyWithAIFallback(transaction, userHistory);
    
    // Merge results if both have decent confidence
    if (aiResult.confidence >= 0.6) {
      return mergeClassifications(localResult, aiResult);
    }
  }
  
  return localResult;
}

/**
 * Classify using local rules and keywords
 */
function classifyWithLocalRules(transaction: Transaction): ClassificationResult {
  const description = (transaction.description || '').toLowerCase();
  const merchantRaw = (transaction as Transaction & { merchant?: string }).merchant;
  const merchant = (typeof merchantRaw === 'string' ? merchantRaw : '').toLowerCase();
  const combinedText = `${description} ${merchant}`;
  
  let bestMatch: CategoryDefinition | null = null;
  let bestScore = 0;
  
  for (const category of EXPENSE_CATEGORIES) {
    let score = 0;
    
    // Check keywords
    for (const keyword of category.keywords) {
      if (combinedText.includes(keyword.toLowerCase())) {
        score += 0.3;
      }
    }
    
    // Check merchant patterns
    for (const pattern of category.merchantPatterns) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
      if (regex.test(merchant) || regex.test(description)) {
        score += 0.5;
      }
    }
    
    // Check amount against typical range
    const amount = Math.abs(transaction.amount);
    if (amount >= category.typicalRange.min && amount <= category.typicalRange.max) {
      score += 0.2;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }
  
  // Check for price benchmarks
  let priceAssessment = undefined;
  if (bestMatch) {
    priceAssessment = assessPriceAgainstBenchmarks(
      Math.abs(transaction.amount),
      bestMatch.priceBenchmarks
    );
  }
  
  const confidence = Math.min(0.95, bestScore);
  
  return {
    category: bestMatch?.name || 'Uncategorized',
    confidence: Math.round(confidence * 100),
    method: confidence > 0.5 ? 'rule' : 'hybrid',
    suggestedBudgetCategory: bestMatch?.name || 'Miscellaneous',
    priceAssessment: priceAssessment ?? undefined
  };
}

/**
 * AI fallback classification (simulated for now)
 */
function classifyWithAIFallback(
  transaction: Transaction,
  _userHistory?: Transaction[]
): ClassificationResult {
  // In production, this would call the AI service
  // For now, return a lower confidence result for the top category match
  const localResult = classifyWithLocalRules(transaction);
  localResult.confidence = Math.max(50, localResult.confidence - 20);
  localResult.method = 'hybrid';
  return localResult;
}

/**
 * Merge local and AI classification results
 */
function mergeClassifications(
  local: ClassificationResult,
  ai: ClassificationResult
): ClassificationResult {
  // If both agree on category, boost confidence
  if (local.category === ai.category) {
    return {
      ...local,
      confidence: Math.min(95, Math.round((local.confidence + ai.confidence) / 2 * 1.2)),
      method: 'hybrid'
    };
  }
  
  // If disagree, use higher confidence
  return local.confidence >= ai.confidence ? local : ai;
}

/**
 * Assess transaction price against benchmarks
 */
function assessPriceAgainstBenchmarks(
  actualPrice: number,
  benchmarks: PriceBenchmark[]
): ClassificationResult['priceAssessment'] {
  if (benchmarks.length === 0) return undefined;
  
  // Find closest benchmark
  let closestBenchmark = benchmarks[0];
  let minDiff = Math.abs(actualPrice - benchmarks[0].typicalPrice);
  
  for (const benchmark of benchmarks) {
    const diff = Math.abs(actualPrice - benchmark.typicalPrice);
    if (diff < minDiff) {
      minDiff = diff;
      closestBenchmark = benchmark;
    }
  }
  
  const variance = actualPrice - closestBenchmark.typicalPrice;
  const variancePct = (variance / closestBenchmark.typicalPrice) * 100;
  
  let assessment: 'below_typical' | 'typical' | 'above_typical' | 'premium';
  if (variancePct < -20) assessment = 'below_typical';
  else if (variancePct <= 10) assessment = 'typical';
  else if (variancePct <= 40) assessment = 'above_typical';
  else assessment = 'premium';
  
  return {
    typicalPrice: closestBenchmark.typicalPrice,
    actualPrice,
    variance: Math.round(variancePct * 10) / 10,
    assessment
  };
}

/**
 * Detect recurring bill patterns from transaction history
 */
export function detectRecurringBillPatterns(
  transactions: Transaction[],
  minOccurrences: number = 3
): RecurringBillPattern[] {
  const merchantGroups: { [merchant: string]: Transaction[] } = {};
  
  // Group by merchant
  transactions.forEach(tx => {
    const m = (tx as Transaction & { merchant?: string }).merchant;
    const merchant = (typeof m === 'string' && m.trim() ? m : tx.description) || 'Unknown';
    if (!merchantGroups[merchant]) {
      merchantGroups[merchant] = [];
    }
    merchantGroups[merchant].push(tx);
  });
  
  const patterns: RecurringBillPattern[] = [];
  
  for (const [merchant, txs] of Object.entries(merchantGroups)) {
    if (txs.length < minOccurrences) continue;
    
    // Sort by date
    txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Calculate intervals between transactions
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      const days = Math.floor(
        (new Date(txs[i].date).getTime() - new Date(txs[i-1].date).getTime()) / (1000 * 60 * 60 * 24)
      );
      intervals.push(days);
    }
    
    // Detect pattern
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const reliabilityScore = Math.max(0, 100 - (variance / avgInterval) * 100);
    
    if (reliabilityScore < 50) continue; // Not reliable enough
    
    // Determine frequency
    let frequency: RecurringBillPattern['frequency'];
    if (avgInterval <= 10) frequency = 'weekly';
    else if (avgInterval <= 20) frequency = 'biweekly';
    else if (avgInterval <= 40) frequency = 'monthly';
    else if (avgInterval <= 100) frequency = 'quarterly';
    else frequency = 'annual';
    
    // Calculate typical amount and variance
    const amounts = txs.map(tx => Math.abs(tx.amount));
    const typicalAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const amountVariance = amounts.reduce((sum, a) => sum + Math.pow(a - typicalAmount, 2), 0) / amounts.length;
    
    // Predict next date
    const lastDate = new Date(txs[txs.length - 1].date);
    const nextExpectedDate = new Date(lastDate);
    nextExpectedDate.setDate(lastDate.getDate() + Math.round(avgInterval));
    
    // Detect if subscription (consistent amount)
    const isSubscription = amountVariance < typicalAmount * 0.05;
    
    // Check if negotiable (utility, insurance, etc)
    const canBeNegotiated = 
      merchant.toLowerCase().includes('insurance') ||
      merchant.toLowerCase().includes('internet') ||
      merchant.toLowerCase().includes('phone') ||
      merchant.toLowerCase().includes('cable');
    
    // Get category from classification
    const categoryResult = classifyWithLocalRules(txs[0]);
    
    patterns.push({
      merchant,
      category: categoryResult.category,
      typicalAmount: Math.round(typicalAmount),
      amountVariance: Math.round(amountVariance),
      frequency,
      avgIntervalDays: Math.round(avgInterval),
      nextExpectedDate,
      reliabilityScore: Math.round(reliabilityScore),
      isSubscription,
      canBeNegotiated
    });
  }
  
  // Sort by reliability
  return patterns.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
}

/**
 * Add benchmark comparison to recurring bill
 */
export function addBenchmarkComparison(
  pattern: RecurringBillPattern
): RecurringBillPattern {
  const category = EXPENSE_CATEGORIES.find(c => c.name === pattern.category);
  if (!category) return pattern;
  
  const relevantBenchmarks = category.priceBenchmarks.filter(b =>
    pattern.merchant.toLowerCase().includes(b.item.toLowerCase().split(' ')[0])
  );
  
  if (relevantBenchmarks.length === 0) return pattern;
  
  const benchmark = relevantBenchmarks[0];
  const userPays = pattern.typicalAmount;
  const marketAverage = benchmark.typicalPrice;
  
  // Calculate percentile (simplified)
  const variance = (userPays - marketAverage) / marketAverage;
  let percentile = 50;
  if (variance < -0.3) percentile = 10;
  else if (variance < -0.1) percentile = 30;
  else if (variance < 0.1) percentile = 50;
  else if (variance < 0.3) percentile = 70;
  else percentile = 90;
  
  let recommendation: string | undefined;
  if (percentile > 80) {
    recommendation = `Consider negotiating or switching - you're paying ${(variance * 100).toFixed(0)}% more than average`;
  } else if (percentile < 20) {
    recommendation = 'Great deal! You\'re paying significantly less than average';
  }
  
  return {
    ...pattern,
    benchmarkComparison: {
      marketAverage,
      userPays,
      percentile,
      recommendation
    }
  };
}

/**
 * Batch classify multiple transactions
 */
export function batchClassifyTransactions(
  transactions: Transaction[],
  useAI: boolean = false
): ClassificationResult[] {
  // Build user history for context
  const userHistory = [...transactions];
  
  return transactions.map(tx => classifyTransaction(tx, useAI, userHistory));
}

/**
 * Get price benchmark for a specific item in a category
 */
export function getPriceBenchmark(
  category: string,
  itemKeyword: string
): PriceBenchmark | undefined {
  const categoryDef = EXPENSE_CATEGORIES.find(c => c.name === category);
  if (!categoryDef) return undefined;
  
  return categoryDef.priceBenchmarks.find(b =>
    b.item.toLowerCase().includes(itemKeyword.toLowerCase())
  );
}

/**
 * Update price benchmarks with user data
 */
export function updatePriceBenchmarksWithUserData(
  transactions: Transaction[],
  minSamples: number = 5
): CategoryDefinition[] {
  const updatedCategories = [...EXPENSE_CATEGORIES];
  
  for (const category of updatedCategories) {
    const categoryTransactions = transactions.filter(tx => {
      const result = classifyWithLocalRules(tx);
      return result.category === category.name;
    });
    
    if (categoryTransactions.length < minSamples) continue;
    
    // Group by amount buckets to find patterns
    const amountGroups: { [key: string]: number[] } = {};
    categoryTransactions.forEach(tx => {
      const amount = Math.abs(tx.amount);
      // Round to nearest 10 for grouping
      const key = `${Math.floor(amount / 10) * 10}-${Math.ceil(amount / 10) * 10}`;
      if (!amountGroups[key]) amountGroups[key] = [];
      amountGroups[key].push(amount);
    });
    
    // Update benchmarks with user data
    for (const benchmark of category.priceBenchmarks) {
      const relevantAmounts = categoryTransactions
        .filter(tx => {
          const amt = Math.abs(tx.amount);
          return amt >= benchmark.priceRange.low && amt <= benchmark.priceRange.high;
        })
        .map(tx => Math.abs(tx.amount));
      
      if (relevantAmounts.length >= minSamples) {
        const userAvg = relevantAmounts.reduce((sum, a) => sum + a, 0) / relevantAmounts.length;
        
        // Blend AI and user data (70% user, 30% AI)
        benchmark.typicalPrice = Math.round(
          userAvg * 0.7 + benchmark.typicalPrice * 0.3
        );
        benchmark.source = 'user_historical';
        benchmark.lastUpdated = new Date();
      }
    }
  }
  
  return updatedCategories;
}
