import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { CategorizedTransaction, DuplicateResult } from '../context/TransactionAIContext';

export interface ReconciliationContextType {
  reconciliations: ReconciliationSession[];
  currentReconciliation: ReconciliationSession | null;
  isReconciling: boolean;
  startReconciliation: (statementId: string, transactions: CategorizedTransaction[]) => Promise<ReconciliationSession>;
  processReconciliation: (sessionId: string) => Promise<ReconciliationResult>;
  resolveConflict: (sessionId: string, conflictId: string, resolution: ConflictResolution) => Promise<void>;
  approveReconciliation: (sessionId: string) => Promise<void>;
  rejectReconciliation: (sessionId: string, reason: string) => Promise<void>;
  getReconciliationHistory: () => ReconciliationSession[];
  exportReconciliationReport: (sessionId: string) => string;
}

export interface ReconciliationSession {
  id: string;
  statementId: string;
  status: 'pending' | 'processing' | 'review' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  totalTransactions: number;
  processedTransactions: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  duplicateTransactions: number;
  conflicts: ReconciliationConflict[];
  summary: ReconciliationSummary;
  confidence: number;
}

export interface ReconciliationConflict {
  id: string;
  type: 'duplicate' | 'amount_mismatch' | 'date_mismatch' | 'description_mismatch' | 'missing_transaction';
  severity: 'low' | 'medium' | 'high';
  extractedTransaction: CategorizedTransaction;
  existingTransaction?: any;
  description: string;
  suggestedAction: 'keep' | 'merge' | 'skip' | 'manual_review';
  reasoning: string;
  resolved: boolean;
  resolution?: ConflictResolution;
}

export interface ConflictResolution {
  action: 'keep' | 'merge' | 'skip' | 'manual_review';
  notes?: string;
  correctedData?: Partial<CategorizedTransaction>;
}

export interface ReconciliationSummary {
  totalAmount: number;
  matchedAmount: number;
  unmatchedAmount: number;
  duplicateAmount: number;
  categoryBreakdown: Record<string, { count: number; amount: number }>;
  confidenceScore: number;
  processingTime: number;
}

export interface ReconciliationResult {
  sessionId: string;
  success: boolean;
  importedTransactions: number;
  skippedTransactions: number;
  mergedTransactions: number;
  conflicts: ReconciliationConflict[];
  summary: ReconciliationSummary;
  errors?: string[];
}

const ReconciliationContext = createContext<ReconciliationContextType | null>(null);

export const useReconciliation = () => {
  const context = React.useContext(ReconciliationContext);
  if (!context) {
    throw new Error('useReconciliation must be used within a ReconciliationProvider');
  }
  return context;
};

interface ReconciliationProviderProps {
  children: ReactNode;
}

export const ReconciliationProvider: React.FC<ReconciliationProviderProps> = ({ children }) => {
  const [reconciliations, setReconciliations] = useState<ReconciliationSession[]>([]);
  const [currentReconciliation, setCurrentReconciliation] = useState<ReconciliationSession | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  // Load reconciliations from localStorage
  useEffect(() => {
    const loadReconciliations = () => {
      try {
        const stored = localStorage.getItem('reconciliationSessions');
        if (stored) {
          const sessions = JSON.parse(stored);
          setReconciliations(sessions.map((s: any) => ({
            ...s,
            startedAt: new Date(s.startedAt),
            completedAt: s.completedAt ? new Date(s.completedAt) : undefined
          })));
        }
      } catch (error) {
        console.error('Failed to load reconciliations:', error);
      }
    };

    loadReconciliations();
  }, []);

  // Save reconciliations to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('reconciliationSessions', JSON.stringify(reconciliations));
    } catch (error) {
      console.error('Failed to save reconciliations:', error);
    }
  }, [reconciliations]);

  const startReconciliation = async (statementId: string, transactions: CategorizedTransaction[]): Promise<ReconciliationSession> => {
    const session: ReconciliationSession = {
      id: `reconciliation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      statementId,
      status: 'pending',
      startedAt: new Date(),
      totalTransactions: transactions.length,
      processedTransactions: 0,
      matchedTransactions: 0,
      unmatchedTransactions: 0,
      duplicateTransactions: 0,
      conflicts: [],
      summary: {
        totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
        matchedAmount: 0,
        unmatchedAmount: 0,
        duplicateAmount: 0,
        categoryBreakdown: {},
        confidenceScore: 0,
        processingTime: 0
      },
      confidence: 0
    };

    setReconciliations(prev => [...prev, session]);
    setCurrentReconciliation(session);

    return session;
  };

  const processReconciliation = async (sessionId: string): Promise<ReconciliationResult> => {
    const session = reconciliations.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Reconciliation session not found');
    }

    setIsReconciling(true);
    
    try {
      // Update session status
      updateSessionStatus(sessionId, 'processing');

      // Get existing transactions from the system
      const existingTransactions = await getExistingTransactions();
      
      // Process each transaction
      const conflicts: ReconciliationConflict[] = [];
      let matchedCount = 0;
      let unmatchedCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < session.totalTransactions; i++) {
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 100));

        const conflict = await processTransaction(i, existingTransactions);
        if (conflict) {
          conflicts.push(conflict);
          
          switch (conflict.type) {
            case 'duplicate':
              duplicateCount++;
              break;
            case 'missing_transaction':
              unmatchedCount++;
              break;
            default:
              matchedCount++;
              break;
          }
        } else {
          matchedCount++;
        }

        // Update progress
        updateSessionProgress(sessionId, i + 1, matchedCount, unmatchedCount, duplicateCount, conflicts);
      }

      // Calculate summary
      const summary = calculateReconciliationSummary(session, conflicts);
      
      // Update session with results
      const updatedSession = {
        ...session,
        status: conflicts.length > 0 ? 'review' : 'completed',
        completedAt: new Date(),
        processedTransactions: session.totalTransactions,
        matchedTransactions: matchedCount,
        unmatchedTransactions: unmatchedCount,
        duplicateTransactions: duplicateCount,
        conflicts,
        summary,
        confidence: calculateConfidence(conflicts, session.totalTransactions)
      };

      setReconciliations(prev => prev.map(s => s.id === sessionId ? updatedSession : s));
      setCurrentReconciliation(updatedSession);

      return {
        sessionId,
        success: true,
        importedTransactions: matchedCount,
        skippedTransactions: unmatchedCount,
        mergedTransactions: duplicateCount,
        conflicts,
        summary,
        errors: []
      };

    } catch (error) {
      updateSessionStatus(sessionId, 'failed');
      throw error;
    } finally {
      setIsReconciling(false);
    }
  };

  const processTransaction = async (transactionIndex: number, existingTransactions: any[]): Promise<ReconciliationConflict | null> => {
    // Simulate transaction processing
    // In a real implementation, you would compare with existing transactions
    
    const random = Math.random();
    
    if (random < 0.1) {
      // 10% chance of duplicate
      return {
        id: `conflict-${Date.now()}-${transactionIndex}`,
        type: 'duplicate',
        severity: 'medium',
        extractedTransaction: {
          id: `tx-${transactionIndex}`,
          date: new Date(),
          description: 'Sample Transaction',
          amount: 100,
          type: 'debit',
          category: 'Uncategorized',
          subcategory: 'Other',
          tags: [],
          confidence: 0.9,
          rawText: 'Sample transaction text'
        },
        existingTransaction: {
          id: 'existing-123',
          description: 'Existing similar transaction',
          amount: 100,
          date: new Date()
        },
        description: 'Potential duplicate transaction found',
        suggestedAction: 'skip',
        reasoning: 'Transaction with same amount and date already exists',
        resolved: false
      };
    } else if (random < 0.15) {
      // 5% chance of amount mismatch
      return {
        id: `conflict-${Date.now()}-${transactionIndex}`,
        type: 'amount_mismatch',
        severity: 'high',
        extractedTransaction: {
          id: `tx-${transactionIndex}`,
          date: new Date(),
          description: 'Sample Transaction',
          amount: 100,
          type: 'debit',
          category: 'Uncategorized',
          subcategory: 'Other',
          tags: [],
          confidence: 0.8,
          rawText: 'Sample transaction text'
        },
        description: 'Amount mismatch detected',
        suggestedAction: 'manual_review',
        reasoning: 'Extracted amount may be incorrect',
        resolved: false
      };
    }

    return null; // No conflict
  };

  const getExistingTransactions = async (): Promise<any[]> => {
    // Simulate fetching existing transactions
    // In a real implementation, you would fetch from your database
    return [
      {
        id: 'existing-123',
        description: 'Existing similar transaction',
        amount: 100,
        date: new Date(),
        category: 'Food & Dining'
      }
    ];
  };

  const updateSessionStatus = (sessionId: string, status: ReconciliationSession['status']) => {
    setReconciliations(prev => prev.map(s => 
      s.id === sessionId ? { ...s, status } : s
    ));
  };

  const updateSessionProgress = (
    sessionId: string, 
    processed: number, 
    matched: number, 
    unmatched: number, 
    duplicate: number, 
    conflicts: ReconciliationConflict[]
  ) => {
    setReconciliations(prev => prev.map(s => 
      s.id === sessionId 
        ? { ...s, processedTransactions: processed, matchedTransactions: matched, unmatchedTransactions: unmatched, duplicateTransactions: duplicate, conflicts }
        : s
    ));
  };

  const calculateReconciliationSummary = (session: ReconciliationSession, conflicts: ReconciliationConflict[]): ReconciliationSummary => {
    const categoryBreakdown: Record<string, { count: number; amount: number }> = {};
    
    // Simulate category breakdown
    const categories = ['Food & Dining', 'Transportation', 'Shopping', 'Entertainment', 'Bills & Utilities'];
    categories.forEach(category => {
      categoryBreakdown[category] = {
        count: Math.floor(Math.random() * 10) + 1,
        amount: Math.floor(Math.random() * 1000) + 100
      };
    });

    return {
      totalAmount: session.summary.totalAmount,
      matchedAmount: session.summary.totalAmount * 0.8,
      unmatchedAmount: session.summary.totalAmount * 0.15,
      duplicateAmount: session.summary.totalAmount * 0.05,
      categoryBreakdown,
      confidenceScore: calculateConfidence(conflicts, session.totalTransactions),
      processingTime: Date.now() - session.startedAt.getTime()
    };
  };

  const calculateConfidence = (conflicts: ReconciliationConflict[], totalTransactions: number): number => {
    if (totalTransactions === 0) return 0;
    
    const highSeverityConflicts = conflicts.filter(c => c.severity === 'high').length;
    const mediumSeverityConflicts = conflicts.filter(c => c.severity === 'medium').length;
    
    const conflictPenalty = (highSeverityConflicts * 0.3 + mediumSeverityConflicts * 0.1) / totalTransactions;
    return Math.max(0, 1 - conflictPenalty);
  };

  const resolveConflict = async (sessionId: string, conflictId: string, resolution: ConflictResolution) => {
    setReconciliations(prev => prev.map(session => {
      if (session.id === sessionId) {
        const updatedConflicts = session.conflicts.map(conflict =>
          conflict.id === conflictId 
            ? { ...conflict, resolved: true, resolution }
            : conflict
        );
        
        // Check if all conflicts are resolved
        const allResolved = updatedConflicts.every(c => c.resolved);
        const newStatus = allResolved ? 'completed' : session.status;
        
        return {
          ...session,
          conflicts: updatedConflicts,
          status: newStatus
        };
      }
      return session;
    }));
  };

  const approveReconciliation = async (sessionId: string) => {
    const session = reconciliations.find(s => s.id === sessionId);
    if (!session) return;

    // Import approved transactions to the main system
    await importTransactions(session);
    
    setReconciliations(prev => prev.map(s => 
      s.id === sessionId 
        ? { ...s, status: 'completed', completedAt: new Date() }
        : s
    ));
  };

  const rejectReconciliation = async (sessionId: string, reason: string) => {
    setReconciliations(prev => prev.map(s => 
      s.id === sessionId 
        ? { ...s, status: 'failed', completedAt: new Date() }
        : s
    ));
  };

  const importTransactions = async (session: ReconciliationSession) => {
    // Simulate importing transactions to the main system
    console.log(`Importing ${session.matchedTransactions} transactions from session ${session.id}`);
  };

  const getReconciliationHistory = (): ReconciliationSession[] => {
    return reconciliations.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  };

  const exportReconciliationReport = (sessionId: string): string => {
    const session = reconciliations.find(s => s.id === sessionId);
    if (!session) return '';

    const report = {
      sessionId: session.id,
      statementId: session.statementId,
      status: session.status,
      period: {
        started: session.startedAt.toISOString(),
        completed: session.completedAt?.toISOString()
      },
      summary: {
        totalTransactions: session.totalTransactions,
        matchedTransactions: session.matchedTransactions,
        unmatchedTransactions: session.unmatchedTransactions,
        duplicateTransactions: session.duplicateTransactions,
        confidence: session.confidence
      },
      conflicts: session.conflicts.map(c => ({
        id: c.id,
        type: c.type,
        severity: c.severity,
        description: c.description,
        resolved: c.resolved,
        resolution: c.resolution
      })),
      categoryBreakdown: session.summary.categoryBreakdown,
      exportedAt: new Date().toISOString()
    };

    return JSON.stringify(report, null, 2);
  };

  const value: ReconciliationContextType = {
    reconciliations,
    currentReconciliation,
    isReconciling,
    startReconciliation,
    processReconciliation,
    resolveConflict,
    approveReconciliation,
    rejectReconciliation,
    getReconciliationHistory,
    exportReconciliationReport
  };

  return React.createElement(
    ReconciliationContext.Provider,
    { value },
    children
  );
};

export default ReconciliationContext;
