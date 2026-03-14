import React, { createContext, useState, useEffect, ReactNode } from 'react';

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

  // Load statements from localStorage
  useEffect(() => {
    const loadStatements = () => {
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
            transactions: s.transactions.map((t: any) => ({
              ...t,
              date: new Date(t.date)
            }))
          })));
        }
      } catch (error) {
        console.error('Failed to load statements:', error);
      }
    };

    loadStatements();
  }, []);

  // Save statements to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('financialStatements', JSON.stringify(statements));
    } catch (error) {
      console.error('Failed to save statements:', error);
    }
  }, [statements]);

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

  const processPDFStatement = async (statement: FinancialStatement): Promise<ExtractedTransaction[]> => {
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

    // Simulate reconciliation process
    await new Promise(resolve => setTimeout(resolve, 2000));

    const matchedTransactions = Math.floor(statement.transactions.length * 0.8);
    const unmatchedTransactions = statement.transactions.length - matchedTransactions;
    const duplicateTransactions = Math.floor(statement.transactions.length * 0.1);

    return {
      totalTransactions: statement.transactions.length,
      matchedTransactions,
      unmatchedTransactions,
      duplicateTransactions,
      discrepancies: [],
      confidence: (matchedTransactions / statement.transactions.length) * 100
    };
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
