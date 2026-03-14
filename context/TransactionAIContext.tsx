import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { ocrParser, ParsedStatement, ParsedTransaction } from '../services/ocrDocumentParser';

export interface AIContextType {
  isCategorizing: boolean;
  categorizeTransactions: (transactions: ParsedTransaction[]) => Promise<CategorizedTransaction[]>;
  detectDuplicates: (transactions: ParsedTransaction[], existingTransactions: any[]) => Promise<DuplicateResult[]>;
  suggestCategories: (description: string) => Promise<CategorySuggestion[]>;
  learnFromCorrections: (original: ParsedTransaction, corrected: CategorizedTransaction) => Promise<void>;
  getCategoryRules: () => CategoryRule[];
  addCategoryRule: (rule: CategoryRule) => Promise<void>;
  updateCategoryRule: (ruleId: string, updates: Partial<CategoryRule>) => Promise<void>;
  deleteCategoryRule: (ruleId: string) => Promise<void>;
}

export interface CategorizedTransaction extends ParsedTransaction {
  category: string;
  subcategory: string;
  tags: string[];
  confidence: number;
  aiReasoning?: string;
}

export interface DuplicateResult {
  transaction: ParsedTransaction;
  duplicates: any[];
  confidence: number;
  action: 'keep' | 'merge' | 'skip';
}

export interface CategorySuggestion {
  category: string;
  subcategory: string;
  confidence: number;
  reasoning: string;
}

export interface CategoryRule {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  tags: string[];
  patterns: string[];
  priority: number;
  isActive: boolean;
  createdAt: Date;
  usageCount: number;
  successRate: number;
}

const AIContext = createContext<AIContextType | null>(null);

export const useAI = () => {
  const context = React.useContext(AIContext);
  if (!context) {
    throw new Error('useAI must be used within an AIProvider');
  }
  return context;
};

interface AIProviderProps {
  children: ReactNode;
}

export const AIProvider: React.FC<AIProviderProps> = ({ children }) => {
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);

  // Load category rules from localStorage
  useEffect(() => {
    const loadRules = () => {
      try {
        const stored = localStorage.getItem('aiCategoryRules');
        if (stored) {
          const rules = JSON.parse(stored);
          setCategoryRules(rules.map((r: any) => ({
            ...r,
            createdAt: new Date(r.createdAt)
          })));
        } else {
          // Initialize with default rules
          const defaultRules = getDefaultCategoryRules();
          setCategoryRules(defaultRules);
        }
      } catch (error) {
        console.error('Failed to load category rules:', error);
        setCategoryRules(getDefaultCategoryRules());
      }
    };

    loadRules();
  }, []);

  // Save category rules to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('aiCategoryRules', JSON.stringify(categoryRules));
    } catch (error) {
      console.error('Failed to save category rules:', error);
    }
  }, [categoryRules]);

  const getDefaultCategoryRules = (): CategoryRule[] => [
    {
      id: 'rule-1',
      name: 'Coffee Shops',
      description: 'Identify coffee shop purchases',
      category: 'Food & Dining',
      subcategory: 'Coffee',
      tags: ['coffee', 'daily', 'morning'],
      patterns: ['starbucks', 'dunkin', 'coffee bean', 'peets', 'caribou', 'caffe'],
      priority: 1,
      isActive: true,
      createdAt: new Date(),
      usageCount: 0,
      successRate: 0.95
    },
    {
      id: 'rule-2',
      name: 'Streaming Services',
      description: 'Identify streaming subscription payments',
      category: 'Entertainment',
      subcategory: 'Streaming',
      tags: ['streaming', 'monthly', 'subscription'],
      patterns: ['netflix', 'hulu', 'disney+', 'amazon prime', 'hbo max', 'paramount+', 'apple tv+'],
      priority: 1,
      isActive: true,
      createdAt: new Date(),
      usageCount: 0,
      successRate: 0.98
    },
    {
      id: 'rule-3',
      name: 'Grocery Stores',
      description: 'Identify grocery purchases',
      category: 'Food & Dining',
      subcategory: 'Groceries',
      tags: ['grocery', 'food', 'essential'],
      patterns: ['walmart', 'target', 'kroger', 'safeway', 'whole foods', 'trader joe', 'albertsons', 'publix'],
      priority: 2,
      isActive: true,
      createdAt: new Date(),
      usageCount: 0,
      successRate: 0.92
    },
    {
      id: 'rule-4',
      name: 'Gas Stations',
      description: 'Identify fuel purchases',
      category: 'Transportation',
      subcategory: 'Fuel',
      tags: ['fuel', 'gas', 'car', 'transportation'],
      patterns: ['shell', 'chevron', 'exxon', 'mobil', 'bp', 'sunoco', 'speedway', 'wawa gas'],
      priority: 2,
      isActive: true,
      createdAt: new Date(),
      usageCount: 0,
      successRate: 0.96
    },
    {
      id: 'rule-5',
      name: 'Salary Income',
      description: 'Identify salary deposits',
      category: 'Income',
      subcategory: 'Salary',
      tags: ['salary', 'income', 'payroll', 'monthly'],
      patterns: ['salary', 'payroll', 'direct deposit', 'employer'],
      priority: 1,
      isActive: true,
      createdAt: new Date(),
      usageCount: 0,
      successRate: 0.99
    }
  ];

  const categorizeTransactions = async (transactions: ParsedTransaction[]): Promise<CategorizedTransaction[]> => {
    setIsCategorizing(true);

    try {
      const categorized: CategorizedTransaction[] = [];

      for (const transaction of transactions) {
        const category = await categorizeTransaction(transaction);
        categorized.push(category);
      }

      return categorized;
    } catch (error) {
      console.error('Categorization failed:', error);
      return transactions.map(t => ({
        ...t,
        category: 'Uncategorized',
        subcategory: 'Other',
        tags: [],
        confidence: 0.1
      }));
    } finally {
      setIsCategorizing(false);
    }
  };

  const categorizeTransaction = async (transaction: ParsedTransaction): Promise<CategorizedTransaction> => {
    const description = transaction.description.toLowerCase();
    const activeRules = categoryRules.filter(rule => rule.isActive).sort((a, b) => a.priority - b.priority);

    // Try to match against rules
    for (const rule of activeRules) {
      for (const pattern of rule.patterns) {
        if (description.includes(pattern.toLowerCase())) {
          // Update rule usage
          updateRuleUsage(rule.id);

          return {
            ...transaction,
            category: rule.category,
            subcategory: rule.subcategory,
            tags: [...rule.tags],
            confidence: rule.successRate,
            aiReasoning: `Matched rule "${rule.name}" based on pattern "${pattern}"`
          };
        }
      }
    }

    // Use AI-based categorization as fallback
    const aiSuggestion = await getAICategorySuggestion(description);
    
    return {
      ...transaction,
      category: aiSuggestion.category,
      subcategory: aiSuggestion.subcategory,
      tags: aiSuggestion.tags || [],
      confidence: aiSuggestion.confidence,
      aiReasoning: aiSuggestion.reasoning
    };
  };

  const getAICategorySuggestion = async (description: string): Promise<CategorySuggestion & { tags?: string[] }> => {
    // Simulate AI categorization
    const aiCategories: Record<string, { category: string; subcategory: string; tags: string[]; reasoning: string }> = {
      'coffee': { category: 'Food & Dining', subcategory: 'Coffee', tags: ['coffee', 'daily'], reasoning: 'Coffee-related purchase detected' },
      'netflix': { category: 'Entertainment', subcategory: 'Streaming', tags: ['streaming', 'monthly'], reasoning: 'Streaming service subscription' },
      'amazon': { category: 'Shopping', subcategory: 'Online', tags: ['online', 'shopping'], reasoning: 'Online marketplace purchase' },
      'gas': { category: 'Transportation', subcategory: 'Fuel', tags: ['fuel', 'car'], reasoning: 'Fuel purchase detected' },
      'salary': { category: 'Income', subcategory: 'Salary', tags: ['income', 'monthly'], reasoning: 'Salary deposit identified' },
      'rent': { category: 'Bills & Utilities', subcategory: 'Rent', tags: ['housing', 'monthly'], reasoning: 'Rent payment detected' },
      'restaurant': { category: 'Food & Dining', subcategory: 'Restaurants', tags: ['dining', 'food'], reasoning: 'Restaurant purchase identified' }
    };

    for (const [keyword, category] of Object.entries(aiCategories)) {
      if (description.includes(keyword)) {
        return {
          ...category,
          confidence: 0.85
        };
      }
    }

    return {
      category: 'Uncategorized',
      subcategory: 'Other',
      tags: [],
      confidence: 0.3,
      reasoning: 'No specific pattern detected'
    };
  };

  const detectDuplicates = async (transactions: ParsedTransaction[], existingTransactions: any[]): Promise<DuplicateResult[]> => {
    const results: DuplicateResult[] = [];

    for (const transaction of transactions) {
      const duplicates = existingTransactions.filter(existing => {
        // Check for duplicates based on amount, date, and description similarity
        const dateMatch = Math.abs(existing.date.getTime() - transaction.date.getTime()) < 24 * 60 * 60 * 1000; // Within 24 hours
        const amountMatch = Math.abs(existing.amount - transaction.amount) < 0.01; // Within 1 cent
        const descriptionMatch = existing.description.toLowerCase().includes(transaction.description.toLowerCase()) ||
                                transaction.description.toLowerCase().includes(existing.description.toLowerCase());

        return dateMatch && amountMatch && descriptionMatch;
      });

      const confidence = duplicates.length > 0 ? 0.9 : 0.1;
      const action = duplicates.length > 0 ? 'skip' : 'keep';

      results.push({
        transaction,
        duplicates,
        confidence,
        action
      });
    }

    return results;
  };

  const suggestCategories = async (description: string): Promise<CategorySuggestion[]> => {
    const suggestions: CategorySuggestion[] = [];
    const desc = description.toLowerCase();

    // Get suggestions from rules
    const matchingRules = categoryRules
      .filter(rule => rule.isActive && rule.patterns.some(pattern => desc.includes(pattern.toLowerCase())))
      .slice(0, 3);

    for (const rule of matchingRules) {
      suggestions.push({
        category: rule.category,
        subcategory: rule.subcategory,
        confidence: rule.successRate,
        reasoning: `Matches rule "${rule.name}"`
      });
    }

    // Add AI suggestion if no rules match
    if (suggestions.length === 0) {
      const aiSuggestion = await getAICategorySuggestion(description);
      suggestions.push(aiSuggestion);
    }

    return suggestions;
  };

  const learnFromCorrections = async (original: ParsedTransaction, corrected: CategorizedTransaction): Promise<void> => {
    // Learn from user corrections to improve future categorization
    const description = original.description.toLowerCase();
    
    // Check if there's an existing rule that could be improved
    const existingRule = categoryRules.find(rule => 
      rule.category === corrected.category && 
      rule.subcategory === corrected.subcategory
    );

    if (existingRule) {
      // Add new pattern to existing rule if description contains unique keywords
      const keywords = extractKeywords(description);
      const newPatterns = keywords.filter(keyword => 
        !existingRule.patterns.some(pattern => pattern.toLowerCase().includes(keyword.toLowerCase()))
      );

      if (newPatterns.length > 0) {
        await updateCategoryRule(existingRule.id, {
          patterns: [...existingRule.patterns, ...newPatterns],
          usageCount: existingRule.usageCount + 1,
          successRate: (existingRule.successRate * existingRule.usageCount + 1) / (existingRule.usageCount + 1)
        });
      }
    } else {
      // Create new rule from correction
      const keywords = extractKeywords(description);
      if (keywords.length > 0) {
        const newRule: CategoryRule = {
          id: `rule-${Date.now()}`,
          name: `Auto-generated: ${corrected.category}`,
          description: `Auto-generated rule for ${corrected.category} - ${corrected.subcategory}`,
          category: corrected.category,
          subcategory: corrected.subcategory,
          tags: corrected.tags,
          patterns: keywords,
          priority: 5,
          isActive: true,
          createdAt: new Date(),
          usageCount: 1,
          successRate: 1.0
        };

        await addCategoryRule(newRule);
      }
    }
  };

  const extractKeywords = (description: string): string[] => {
    // Simple keyword extraction
    const words = description.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !isStopWord(word));

    // Remove duplicates and return top keywords
    return [...new Set(words)].slice(0, 5);
  };

  const isStopWord = (word: string): boolean => {
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'under', 'over'];
    return stopWords.includes(word.toLowerCase());
  };

  const updateRuleUsage = (ruleId: string) => {
    setCategoryRules(prev => prev.map(rule => 
      rule.id === ruleId 
        ? { ...rule, usageCount: rule.usageCount + 1 }
        : rule
    ));
  };

  const getCategoryRules = (): CategoryRule[] => {
    return categoryRules;
  };

  const addCategoryRule = async (rule: CategoryRule): Promise<void> => {
    setCategoryRules(prev => [...prev, rule]);
  };

  const updateCategoryRule = async (ruleId: string, updates: Partial<CategoryRule>): Promise<void> => {
    setCategoryRules(prev => prev.map(rule => 
      rule.id === ruleId 
        ? { ...rule, ...updates }
        : rule
    ));
  };

  const deleteCategoryRule = async (ruleId: string): Promise<void> => {
    setCategoryRules(prev => prev.filter(rule => rule.id !== ruleId));
  };

  const value: AIContextType = {
    isCategorizing,
    categorizeTransactions,
    detectDuplicates,
    suggestCategories,
    learnFromCorrections,
    getCategoryRules,
    addCategoryRule,
    updateCategoryRule,
    deleteCategoryRule
  };

  return React.createElement(
    AIContext.Provider,
    { value },
    children
  );
};

export default AIContext;
