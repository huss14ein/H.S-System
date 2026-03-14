import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { DataContext } from './DataContext';
import { invokeAI } from '../services/geminiService';

export interface FinancialStatement {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'csv' | 'xlsx' | 'ofx' | 'qfx';
  fileSize: number;
  uploadedAt: Date;
  processedAt?: Date;
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'reviewing';
  bankName?: string;
  accountNumber?: string;
  accountType?: 'checking' | 'savings' | 'credit' | 'investment';
  statementPeriod: {
    startDate: Date;
    endDate: Date;
  };
  openingBalance: number;
  closingBalance: number;
  transactions: ExtractedTransaction[];
  summary: StatementSummary;
  confidence: number;
  errors?: string[];
}

export interface ExtractedTransaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  balance?: number;
  category?: string;
  subcategory?: string;
  tags: string[];
  confidence: number;
  rawText: string;
  matchedTransaction?: string;
  reconciliationStatus: 'unmatched' | 'matched' | 'duplicate' | 'discrepancy';
}

export interface StatementSummary {
  totalCredits: number;
  totalDebits: number;
  netChange: number;
  transactionCount: number;
  categories: Record<string, number>;
  averageTransaction: number;
  largestTransaction: number;
  smallestTransaction: number;
  dailySpending: Record<string, number>;
}

export interface StatementProcessingContextType {
  statements: FinancialStatement[];
  currentStatement: FinancialStatement | null;
  isProcessing: boolean;
  uploadStatement: (file: File, bankInfo?: BankInfo) => Promise<FinancialStatement>;
  processStatement: (statementId: string) => Promise<void>;
  reviewStatement: (statementId: string) => void;
  approveStatement: (statementId: string) => Promise<void>;
  rejectStatement: (statementId: string, reason: string) => Promise<void>;
  deleteStatement: (statementId: string) => void;
  reconcileTransactions: (statementId: string) => Promise<ReconciliationResult>;
  exportTransactions: (statementId: string) => string;
  getStatementById: (id: string) => FinancialStatement | undefined;
  getStatementsByAccount: (accountNumber: string) => FinancialStatement[];
  getProcessingStats: () => ProcessingStats;
}

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountType: 'checking' | 'savings' | 'credit' | 'investment';
}

export interface ReconciliationResult {
  totalTransactions: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  duplicateTransactions: number;
  discrepancies: TransactionDiscrepancy[];
  confidence: number;
}

export interface TransactionDiscrepancy {
  extractedTransaction: ExtractedTransaction;
  existingTransaction?: any;
  type: 'amount_mismatch' | 'date_mismatch' | 'description_mismatch' | 'missing_transaction';
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface ProcessingStats {
  totalStatements: number;
  processedStatements: number;
  failedStatements: number;
  totalTransactions: number;
  averageProcessingTime: number;
  supportedBanks: string[];
  successRate: number;
}

const StatementProcessingContext = createContext<StatementProcessingContextType | null>(null);

export const useStatementProcessing = () => {
  const context = React.useContext(StatementProcessingContext);
  if (!context) {
    throw new Error('useStatementProcessing must be used within a StatementProcessingProvider');
  }
  return context;
};

interface StatementProcessingProviderProps {
  children: ReactNode;
}

export const StatementProcessingProvider: React.FC<StatementProcessingProviderProps> = ({ children }) => {
  const [statements, setStatements] = useState<FinancialStatement[]>([]);
  const [currentStatement, setCurrentStatement] = useState<FinancialStatement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const auth = useContext(AuthContext);
  const dataContext = useContext(DataContext);

  // Load statements from database and localStorage (fallback)
  useEffect(() => {
    const loadStatements = async () => {
      // Try to load from database first
      if (supabase && auth?.user) {
        const supabaseClient = supabase; // Type narrowing
        const user = auth.user;
        if (!user) return;
        
        try {
          const { data: dbStatements, error } = await supabaseClient
            .from('financial_statements')
            .select('*')
            .eq('user_id', user.id)
            .order('uploaded_at', { ascending: false });

          if (!error && dbStatements) {
            const loaded = dbStatements.map((s: any) => ({
              id: s.id,
              fileName: s.file_name,
              fileType: s.file_type as FinancialStatement['fileType'],
              fileSize: s.file_size,
              uploadedAt: new Date(s.uploaded_at),
              processedAt: s.processed_at ? new Date(s.processed_at) : undefined,
              status: s.status as FinancialStatement['status'],
              bankName: s.bank_name,
              accountNumber: s.account_number,
              accountType: s.account_type as FinancialStatement['accountType'],
              statementPeriod: {
                startDate: s.statement_period_start ? new Date(s.statement_period_start) : new Date(),
                endDate: s.statement_period_end ? new Date(s.statement_period_end) : new Date()
              },
              openingBalance: s.opening_balance ?? 0,
              closingBalance: s.closing_balance ?? 0,
              transactions: [], // Load separately if needed
              summary: (s.summary as StatementSummary) || {
                totalCredits: 0,
                totalDebits: 0,
                netChange: 0,
                transactionCount: 0,
                categories: {},
                averageTransaction: 0,
                largestTransaction: 0,
                smallestTransaction: 0,
                dailySpending: {}
              },
              confidence: s.confidence ?? 0,
              errors: s.errors ? (Array.isArray(s.errors) ? s.errors : []) : []
            }));
            setStatements(loaded);
            return;
          }
        } catch (error) {
          console.error('Failed to load statements from database:', error);
        }
      }

      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('financialStatements');
        if (stored) {
          const statementData = JSON.parse(stored);
          setStatements(statementData.map((s: any) => ({
            ...s,
            uploadedAt: new Date(s.uploadedAt),
            processedAt: s.processedAt ? new Date(s.processedAt) : undefined,
            statementPeriod: {
              ...s.statementPeriod,
              startDate: new Date(s.statementPeriod.startDate),
              endDate: new Date(s.statementPeriod.endDate)
            },
            transactions: s.transactions?.map((t: any) => ({
              ...t,
              date: new Date(t.date)
            })) || []
          })));
        }
      } catch (error) {
        console.error('Failed to load statements from localStorage:', error);
      }
    };

    loadStatements();
  }, [auth?.user]);

  // Save statements to database (and localStorage as backup)
  useEffect(() => {
    if (!statements.length) return;

    // Save to database if available
    if (supabase && auth?.user) {
      const user = auth.user;
      if (!user || !supabase) return;
      
      const supabaseClient = supabase; // Type narrowing
      
      statements.forEach(async (statement) => {
        try {
          const { error } = await supabaseClient
            .from('financial_statements')
            .upsert({
              id: statement.id,
              user_id: user.id,
              file_name: statement.fileName,
              file_type: statement.fileType,
              file_size: statement.fileSize,
              bank_name: statement.bankName,
              account_number: statement.accountNumber,
              account_type: statement.accountType,
              statement_period_start: statement.statementPeriod.startDate.toISOString().split('T')[0],
              statement_period_end: statement.statementPeriod.endDate.toISOString().split('T')[0],
              opening_balance: statement.openingBalance,
              closing_balance: statement.closingBalance,
              status: statement.status,
              confidence: statement.confidence,
              summary: statement.summary,
              errors: statement.errors || [],
              uploaded_at: statement.uploadedAt.toISOString(),
              processed_at: statement.processedAt?.toISOString(),
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

          if (error) {
            console.error('Failed to save statement to database:', error);
          }
        } catch (error) {
          console.error('Error saving statement:', error);
        }
      });
    }

    // Also save to localStorage as backup
    try {
      localStorage.setItem('financialStatements', JSON.stringify(statements));
    } catch (error) {
      console.error('Failed to save statements to localStorage:', error);
    }
  }, [statements, auth?.user]);

  const uploadStatement = async (file: File, bankInfo?: BankInfo): Promise<FinancialStatement> => {
    const statement: FinancialStatement = {
      id: `statement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fileName: file.name,
      fileType: getFileType(file.name),
      fileSize: file.size,
      uploadedAt: new Date(),
      status: 'uploading',
      bankName: bankInfo?.bankName,
      accountNumber: bankInfo?.accountNumber,
      accountType: bankInfo?.accountType,
      statementPeriod: {
        startDate: new Date(),
        endDate: new Date()
      },
      openingBalance: 0,
      closingBalance: 0,
      transactions: [],
      summary: {
        totalCredits: 0,
        totalDebits: 0,
        netChange: 0,
        transactionCount: 0,
        categories: {},
        averageTransaction: 0,
        largestTransaction: 0,
        smallestTransaction: 0,
        dailySpending: {}
      },
      confidence: 0
    };

    setStatements(prev => [...prev, statement]);
    setCurrentStatement(statement);

    // Simulate file upload
    await new Promise(resolve => setTimeout(resolve, 2000));

    statement.status = 'processing';
    setStatements(prev => prev.map(s => s.id === statement.id ? statement : s));

    return statement;
  };

  const processStatement = async (statementId: string) => {
    const statement = statements.find(s => s.id === statementId);
    if (!statement) return;

    setIsProcessing(true);

    try {
      // Simulate OCR and processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      const processedStatement = await processStatementData(statement);
      
      setStatements(prev => prev.map(s => 
        s.id === statementId 
          ? { ...processedStatement, status: 'completed', processedAt: new Date() }
          : s
      ));

      setCurrentStatement(processedStatement);
    } catch (error) {
      setStatements(prev => prev.map(s => 
        s.id === statementId 
          ? { ...s, status: 'failed', errors: [error instanceof Error ? error.message : 'Processing failed'] }
          : s
      ));
    } finally {
      setIsProcessing(false);
    }
  };

  const processStatementData = async (statement: FinancialStatement): Promise<FinancialStatement> => {
    // Simulate different processing based on file type
    let transactions: ExtractedTransaction[] = [];
    
    if (statement.fileType === 'pdf') {
      transactions = await processPDFStatement(statement);
    } else if (statement.fileType === 'csv') {
      transactions = await processCSVStatement(statement);
    } else if (statement.fileType === 'xlsx') {
      transactions = await processExcelStatement(statement);
    } else {
      throw new Error('Unsupported file type');
    }

    // Auto-categorize transactions
    transactions = await categorizeTransactions(transactions);

    // Calculate summary
    const summary = calculateStatementSummary(transactions);

    return {
      ...statement,
      transactions,
      summary,
      statementPeriod: {
        startDate: new Date(Math.min(...transactions.map(t => t.date.getTime()))),
        endDate: new Date(Math.max(...transactions.map(t => t.date.getTime())))
      },
      openingBalance: transactions[0]?.balance || 0,
      closingBalance: transactions[transactions.length - 1]?.balance || 0,
      confidence: calculateConfidence(transactions)
    };
  };

  const processPDFStatement = async (_statement: FinancialStatement): Promise<ExtractedTransaction[]> => {
    // Simulate PDF OCR processing
    const mockTransactions: ExtractedTransaction[] = [
      {
        id: '1',
        date: new Date('2024-01-15'),
        description: 'Starbucks Coffee',
        amount: -5.50,
        type: 'debit',
        balance: 1000.00,
        category: 'Food & Dining',
        subcategory: 'Coffee',
        tags: ['coffee', 'daily'],
        confidence: 0.95,
        rawText: 'STARBUCKS COFFEE 5.50',
        reconciliationStatus: 'unmatched'
      },
      {
        id: '2',
        date: new Date('2024-01-16'),
        description: 'Salary Deposit',
        amount: 3000.00,
        type: 'credit',
        balance: 4000.00,
        category: 'Income',
        subcategory: 'Salary',
        tags: ['salary', 'monthly'],
        confidence: 0.98,
        rawText: 'SALARY DEPOSIT 3000.00',
        reconciliationStatus: 'unmatched'
      },
      {
        id: '3',
        date: new Date('2024-01-17'),
        description: 'Amazon Purchase',
        amount: -125.99,
        type: 'debit',
        balance: 3874.01,
        category: 'Shopping',
        subcategory: 'Online',
        tags: ['amazon', 'electronics'],
        confidence: 0.92,
        rawText: 'AMAZON PURCHASE 125.99',
        reconciliationStatus: 'unmatched'
      }
    ];

    return mockTransactions;
  };

  const processCSVStatement = async (statement: FinancialStatement): Promise<ExtractedTransaction[]> => {
    // Simulate CSV parsing
    return processPDFStatement(statement);
  };

  const processExcelStatement = async (statement: FinancialStatement): Promise<ExtractedTransaction[]> => {
    // Simulate Excel parsing
    return processPDFStatement(statement);
  };

  const categorizeTransactions = async (transactions: ExtractedTransaction[]): Promise<ExtractedTransaction[]> => {
    // AI-powered categorization
    const categoryRules: Record<string, { category: string; subcategory: string; tags: string[] }> = {
      'starbucks': { category: 'Food & Dining', subcategory: 'Coffee', tags: ['coffee', 'daily'] },
      'salary': { category: 'Income', subcategory: 'Salary', tags: ['salary', 'monthly'] },
      'amazon': { category: 'Shopping', subcategory: 'Online', tags: ['amazon', 'electronics'] },
      'netflix': { category: 'Entertainment', subcategory: 'Streaming', tags: ['streaming', 'monthly'] },
      'gas': { category: 'Transportation', subcategory: 'Fuel', tags: ['fuel', 'car'] },
      'grocery': { category: 'Food & Dining', subcategory: 'Groceries', tags: ['food', 'essential'] }
    };

    return transactions.map(transaction => {
      const description = transaction.description.toLowerCase();
      
      for (const [keyword, category] of Object.entries(categoryRules)) {
        if (description.includes(keyword)) {
          return {
            ...transaction,
            category: category.category,
            subcategory: category.subcategory,
            tags: [...transaction.tags, ...category.tags]
          };
        }
      }

      return {
        ...transaction,
        category: 'Uncategorized',
        subcategory: 'Other',
        tags: transaction.tags
      };
    });
  };

  const calculateStatementSummary = (transactions: ExtractedTransaction[]): StatementSummary => {
    const credits = transactions.filter(t => t.type === 'credit');
    const debits = transactions.filter(t => t.type === 'debit');
    
    const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);
    const totalDebits = Math.abs(debits.reduce((sum, t) => sum + t.amount, 0));
    const netChange = totalCredits - totalDebits;

    const categories: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.category) {
        categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
      }
    });

    const amounts = transactions.map(t => Math.abs(t.amount));
    const averageTransaction = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const largestTransaction = amounts.length > 0 ? Math.max(...amounts) : 0;
    const smallestTransaction = amounts.length > 0 ? Math.min(...amounts) : 0;

    const dailySpending: Record<string, number> = {};
    transactions.forEach(t => {
      const dateKey = t.date.toISOString().split('T')[0];
      dailySpending[dateKey] = (dailySpending[dateKey] || 0) + Math.abs(t.amount);
    });

    return {
      totalCredits,
      totalDebits,
      netChange,
      transactionCount: transactions.length,
      categories,
      averageTransaction,
      largestTransaction,
      smallestTransaction,
      dailySpending
    };
  };

  const calculateConfidence = (transactions: ExtractedTransaction[]): number => {
    if (transactions.length === 0) return 0;
    
    const totalConfidence = transactions.reduce((sum, t) => sum + t.confidence, 0);
    return totalConfidence / transactions.length;
  };

  const reviewStatement = (statementId: string) => {
    const statement = statements.find(s => s.id === statementId);
    if (statement) {
      setCurrentStatement(statement);
      setStatements(prev => prev.map(s => 
        s.id === statementId ? { ...s, status: 'reviewing' } : s
      ));
    }
  };

  const approveStatement = async (statementId: string) => {
    setStatements(prev => prev.map(s => 
      s.id === statementId ? { ...s, status: 'completed' } : s
    ));
  };

  const rejectStatement = async (statementId: string, reason: string) => {
    setStatements(prev => prev.map(s => 
      s.id === statementId 
        ? { ...s, status: 'failed', errors: [reason] }
        : s
    ));
  };

  const deleteStatement = (statementId: string) => {
    setStatements(prev => prev.filter(s => s.id !== statementId));
    if (currentStatement?.id === statementId) {
      setCurrentStatement(null);
    }
  };

  const reconcileTransactions = async (statementId: string): Promise<ReconciliationResult> => {
    const statement = statements.find(s => s.id === statementId);
    if (!statement) {
      throw new Error('Statement not found');
    }

    if (!dataContext) {
      throw new Error('DataContext not available');
    }

    const existingTransactions = dataContext.data.transactions || [];
    const discrepancies: TransactionDiscrepancy[] = [];
    let matchedCount = 0;
    let duplicateCount = 0;
    const matchedIds = new Set<string>();

    // Match extracted transactions with existing ones
    for (const extractedTx of statement.transactions) {
      const extractedDate = extractedTx.date instanceof Date ? extractedTx.date : new Date(extractedTx.date);
      const extractedAmount = Math.abs(extractedTx.amount);
      const extractedDesc = extractedTx.description.toLowerCase().trim();

      // Find potential matches
      const potentialMatches = existingTransactions.filter(existingTx => {
        const existingDate = new Date(existingTx.date);
        const existingAmount = Math.abs(existingTx.amount);
        const existingDesc = existingTx.description.toLowerCase().trim();

        // Date tolerance: ±3 days
        const dateDiff = Math.abs(extractedDate.getTime() - existingDate.getTime());
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
        
        // Amount tolerance: ±0.01 (for rounding differences)
        const amountDiff = Math.abs(extractedAmount - existingAmount);

        // Match criteria:
        // 1. Same date (±3 days) AND same amount (±0.01) AND similar description
        // 2. OR same date (±3 days) AND same amount (±0.01) (description might differ)
        const dateMatch = daysDiff <= 3;
        const amountMatch = amountDiff <= 0.01;
        const descSimilarity = calculateStringSimilarity(extractedDesc, existingDesc) > 0.6;

        return dateMatch && amountMatch && (descSimilarity || amountMatch);
      });

      if (potentialMatches.length === 0) {
        // Unmatched transaction
        extractedTx.reconciliationStatus = 'unmatched';
      } else if (potentialMatches.length === 1) {
        // Single match - likely a match
        const match = potentialMatches[0];
        if (!matchedIds.has(match.id)) {
          matchedIds.add(match.id);
          extractedTx.matchedTransaction = match.id;
          extractedTx.reconciliationStatus = 'matched';
          matchedCount++;

          // Check for discrepancies
          const dateDiff = Math.abs(extractedDate.getTime() - new Date(match.date).getTime());
          const amountDiff = Math.abs(extractedAmount - Math.abs(match.amount));
          const descSimilarity = calculateStringSimilarity(extractedDesc, match.description.toLowerCase().trim());

          if (dateDiff > 0) {
            discrepancies.push({
              extractedTransaction: extractedTx,
              existingTransaction: match,
              type: 'date_mismatch',
              severity: dateDiff > 86400000 ? 'medium' : 'low', // > 1 day
              suggestion: `Date differs by ${Math.floor(dateDiff / (1000 * 60 * 60 * 24))} days`
            });
          }
          if (amountDiff > 0.01) {
            discrepancies.push({
              extractedTransaction: extractedTx,
              existingTransaction: match,
              type: 'amount_mismatch',
              severity: amountDiff > 10 ? 'high' : amountDiff > 1 ? 'medium' : 'low',
              suggestion: `Amount differs by ${amountDiff.toFixed(2)}`
            });
          }
          if (descSimilarity < 0.7) {
            discrepancies.push({
              extractedTransaction: extractedTx,
              existingTransaction: match,
              type: 'description_mismatch',
              severity: 'low',
              suggestion: 'Description differs significantly'
            });
          }
        } else {
          // Already matched to another transaction - potential duplicate
          extractedTx.reconciliationStatus = 'duplicate';
          duplicateCount++;
        }
      } else {
        // Multiple matches - potential duplicate or ambiguous
        extractedTx.reconciliationStatus = 'duplicate';
        duplicateCount++;
        discrepancies.push({
          extractedTransaction: extractedTx,
          existingTransaction: potentialMatches[0],
          type: 'missing_transaction',
          severity: 'medium',
          suggestion: `Multiple potential matches found (${potentialMatches.length}). Please review manually.`
        });
      }
    }

    // Update statement with reconciliation status
    setStatements(prev => prev.map(s => 
      s.id === statementId 
        ? { ...s, transactions: statement.transactions }
        : s
    ));

    const unmatchedCount = statement.transactions.length - matchedCount - duplicateCount;
    const confidence = statement.transactions.length > 0 
      ? (matchedCount / statement.transactions.length) * 100 
      : 0;

    // Enhance discrepancies with AI-powered suggestions if there are any
    let enhancedDiscrepancies = discrepancies;
    if (discrepancies.length > 0) {
      try {
        enhancedDiscrepancies = await enhanceDiscrepanciesWithAI(discrepancies, statement);
      } catch (error) {
        console.warn('Failed to get AI suggestions for reconciliation:', error);
        // Continue with original discrepancies if AI fails
      }
    }

    return {
      totalTransactions: statement.transactions.length,
      matchedTransactions: matchedCount,
      unmatchedTransactions: unmatchedCount,
      duplicateTransactions: duplicateCount,
      discrepancies: enhancedDiscrepancies,
      confidence
    };
  };

  // AI-powered reconciliation suggestions
  const enhanceDiscrepanciesWithAI = async (
    discrepancies: TransactionDiscrepancy[],
    statement: FinancialStatement
  ): Promise<TransactionDiscrepancy[]> => {
    if (discrepancies.length === 0) return discrepancies;

    try {
      const prompt = `You are a financial reconciliation expert. Analyze these transaction discrepancies and provide intelligent suggestions for resolution.

Statement: ${statement.fileName}
Bank: ${statement.bankName || 'Unknown'}
Account: ${statement.accountNumber || 'Unknown'}
Total Transactions: ${statement.transactions.length}

Discrepancies to analyze:
${discrepancies.map((disc, idx) => `
${idx + 1}. Type: ${disc.type}
   Extracted: ${disc.extractedTransaction.description} | ${disc.extractedTransaction.date.toISOString().split('T')[0]} | ${disc.extractedTransaction.amount}
   ${disc.existingTransaction ? `Existing: ${disc.existingTransaction.description} | ${disc.existingTransaction.date} | ${disc.existingTransaction.amount}` : 'No existing match'}
   Current Suggestion: ${disc.suggestion}
   Severity: ${disc.severity}
`).join('\n')}

For each discrepancy, provide:
1. A more intelligent, actionable suggestion
2. Likely cause (e.g., "timing difference", "rounding error", "different merchant name", "duplicate entry")
3. Recommended action (e.g., "merge", "keep both", "update existing", "create new")

Return a JSON array with the same length as the input, where each object has:
- "suggestion": improved suggestion text
- "cause": likely cause
- "action": recommended action

Return ONLY valid JSON, no markdown or extra text.`;

      const response = await invokeAI({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });

      // Parse AI response
      let aiSuggestions: Array<{ suggestion?: string; cause?: string; action?: string }> = [];
      try {
        const text = response.text || '';
        if (!text) {
          console.warn('AI response has no text content');
          return discrepancies;
        }
        
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = text.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          try {
            aiSuggestions = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(aiSuggestions)) {
              console.warn('AI suggestions is not an array');
              return discrepancies;
            }
          } catch (parseError) {
            console.warn('Failed to parse AI JSON:', parseError);
            return discrepancies;
          }
        } else {
          console.warn('No JSON array found in AI response');
          return discrepancies;
        }
      } catch (parseError) {
        console.warn('Failed to parse AI suggestions:', parseError);
        return discrepancies;
      }

      // Enhance discrepancies with AI suggestions
      return discrepancies.map((disc, idx) => {
        const aiSuggestion = aiSuggestions[idx];
        if (aiSuggestion && aiSuggestion.suggestion) {
          return {
            ...disc,
            suggestion: `${aiSuggestion.suggestion}${aiSuggestion.cause ? ` (Likely cause: ${aiSuggestion.cause})` : ''}${aiSuggestion.action ? ` [Action: ${aiSuggestion.action}]` : ''}`
          };
        }
        return disc;
      });
    } catch (error) {
      console.error('Error getting AI reconciliation suggestions:', error);
      return discrepancies; // Return original if AI fails
    }
  };

  // Helper function to calculate string similarity (Levenshtein-based)
  const calculateStringSimilarity = (str1: string, str2: string): number => {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    // Check if one string contains the other (fuzzy match)
    if (longer.includes(shorter)) {
      return shorter.length / longer.length;
    }

    // Calculate Levenshtein distance
    const matrix: number[][] = [];
    for (let i = 0; i <= longer.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= shorter.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= longer.length; i++) {
      for (let j = 1; j <= shorter.length; j++) {
        if (longer[i - 1] === shorter[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    const distance = matrix[longer.length][shorter.length];
    const maxLength = Math.max(longer.length, shorter.length);
    return 1 - (distance / maxLength);
  };

  const exportTransactions = (statementId: string): string => {
    const statement = statements.find(s => s.id === statementId);
    if (!statement) return '';

    const csvContent = [
      'Date,Description,Amount,Type,Category,Subcategory,Tags',
      ...statement.transactions.map(t => 
        `${t.date.toISOString().split('T')[0]},${t.description},${t.amount},${t.type},${t.category || ''},${t.subcategory || ''},${t.tags.join(';')}`
      )
    ].join('\n');

    return csvContent;
  };

  const getStatementById = (id: string): FinancialStatement | undefined => {
    return statements.find(s => s.id === id);
  };

  const getStatementsByAccount = (accountNumber: string): FinancialStatement[] => {
    return statements.filter(s => s.accountNumber === accountNumber);
  };

  const getProcessingStats = (): ProcessingStats => {
    const processedStatements = statements.filter(s => s.status === 'completed').length;
    const failedStatements = statements.filter(s => s.status === 'failed').length;
    const totalTransactions = statements.reduce((sum, s) => sum + s.transactions.length, 0);
    const successRate = statements.length > 0 ? (processedStatements / statements.length) * 100 : 0;

    return {
      totalStatements: statements.length,
      processedStatements,
      failedStatements,
      totalTransactions,
      averageProcessingTime: 2.5, // Simulated
      supportedBanks: ['Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'Capital One'],
      successRate
    };
  };

  const getFileType = (fileName: string): 'pdf' | 'csv' | 'xlsx' | 'ofx' | 'qfx' => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'pdf': return 'pdf';
      case 'csv': return 'csv';
      case 'xlsx':
      case 'xls': return 'xlsx';
      case 'ofx': return 'ofx';
      case 'qfx': return 'qfx';
      default: return 'pdf';
    }
  };

  const value: StatementProcessingContextType = {
    statements,
    currentStatement,
    isProcessing,
    uploadStatement,
    processStatement,
    reviewStatement,
    approveStatement,
    rejectStatement,
    deleteStatement,
    reconcileTransactions,
    exportTransactions,
    getStatementById,
    getStatementsByAccount,
    getProcessingStats
  };

  return React.createElement(
    StatementProcessingContext.Provider,
    { value },
    children
  );
};

export default StatementProcessingContext;
