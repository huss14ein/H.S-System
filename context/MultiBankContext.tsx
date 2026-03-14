import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface Bank {
  id: string;
  name: string;
  logo?: string;
  website?: string;
  supportedFormats: string[];
  regions: string[];
  features: BankFeature[];
  isActive: boolean;
  priority: number;
}

export interface BankFeature {
  id: string;
  name: string;
  description: string;
  supported: boolean;
}

export interface BankAccount {
  id: string;
  bankId: string;
  accountNumber: string;
  accountType: 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
  nickname?: string;
  isActive: boolean;
  lastImport?: Date;
  balance?: number;
  currency: string;
}

export interface BankTemplate {
  id: string;
  bankId: string;
  templateName: string;
  patterns: {
    date: RegExp;
    description: RegExp;
    amount: RegExp;
    balance?: RegExp;
    transactionStart?: RegExp;
    transactionEnd?: RegExp;
    summary?: {
      openingBalance?: RegExp;
      closingBalance?: RegExp;
      totalCredits?: RegExp;
      totalDebits?: RegExp;
    };
  };
  dateFormat: string;
  amountFormat: 'US' | 'EU';
  skipPatterns: RegExp[];
  confidence: number;
}

export interface MultiBankContextType {
  banks: Bank[];
  accounts: BankAccount[];
  templates: BankTemplate[];
  supportedBanks: Bank[];
  addBank: (bank: Omit<Bank, 'id'>) => Promise<void>;
  updateBank: (bankId: string, updates: Partial<Bank>) => Promise<void>;
  removeBank: (bankId: string) => Promise<void>;
  addAccount: (account: Omit<BankAccount, 'id'>) => Promise<void>;
  updateAccount: (accountId: string, updates: Partial<BankAccount>) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  getBankById: (bankId: string) => Bank | undefined;
  getAccountsByBank: (bankId: string) => BankAccount[];
  detectBankFromStatement: (statementText: string) => Bank | null;
  getTemplateForBank: (bankId: string) => BankTemplate | null;
  addCustomTemplate: (template: BankTemplate) => Promise<void>;
  updateTemplate: (templateId: string, updates: Partial<BankTemplate>) => Promise<void>;
  removeTemplate: (templateId: string) => Promise<void>;
  testTemplate: (template: BankTemplate, sampleText: string) => Promise<TemplateTestResult>;
}

export interface TemplateTestResult {
  success: boolean;
  extractedTransactions: number;
  confidence: number;
  errors: string[];
  sampleData?: any;
}

const MultiBankContext = createContext<MultiBankContextType | null>(null);

export const useMultiBank = () => {
  const context = React.useContext(MultiBankContext);
  if (!context) {
    throw new Error('useMultiBank must be used within a MultiBankProvider');
  }
  return context;
};

interface MultiBankProviderProps {
  children: ReactNode;
}

export const MultiBankProvider: React.FC<MultiBankProviderProps> = ({ children }) => {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [templates, setTemplates] = useState<BankTemplate[]>([]);

  // Initialize with default banks
  useEffect(() => {
    const initializeData = () => {
      const defaultBanks = getDefaultBanks();
      const defaultTemplates = getDefaultTemplates();
      
      setBanks(defaultBanks);
      setTemplates(defaultTemplates);
      
      // Load custom data from localStorage
      loadCustomData();
    };

    initializeData();
  }, []);

  // Save data to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('multiBankAccounts', JSON.stringify(accounts));
    } catch (error) {
      console.error('Failed to save accounts:', error);
    }
  }, [accounts]);

  useEffect(() => {
    try {
      localStorage.setItem('multiBankTemplates', JSON.stringify(templates));
    } catch (error) {
      console.error('Failed to save templates:', error);
    }
  }, [templates]);

  const getDefaultBanks = (): Bank[] => [
    {
      id: 'chase',
      name: 'Chase Bank',
      website: 'https://www.chase.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US', 'CA'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'real-time-sync', name: 'Real-time Sync', description: 'Real-time transaction synchronization', supported: true },
        { id: 'bill-pay', name: 'Bill Pay', description: 'Bill payment integration', supported: true },
        { id: 'investment-tracking', name: 'Investment Tracking', description: 'Investment account tracking', supported: true }
      ],
      isActive: true,
      priority: 1
    },
    {
      id: 'bankofamerica',
      name: 'Bank of America',
      website: 'https://www.bankofamerica.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'real-time-sync', name: 'Real-time Sync', description: 'Real-time transaction synchronization', supported: true },
        { id: 'bill-pay', name: 'Bill Pay', description: 'Bill payment integration', supported: true },
        { id: 'fraud-alerts', name: 'Fraud Alerts', description: 'Fraud detection alerts', supported: true }
      ],
      isActive: true,
      priority: 2
    },
    {
      id: 'wellsfargo',
      name: 'Wells Fargo',
      website: 'https://www.wellsfargo.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'real-time-sync', name: 'Real-time Sync', description: 'Real-time transaction synchronization', supported: false },
        { id: 'bill-pay', name: 'Bill Pay', description: 'Bill payment integration', supported: true }
      ],
      isActive: true,
      priority: 3
    },
    {
      id: 'citibank',
      name: 'Citibank',
      website: 'https://www.citi.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US', 'Global'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'real-time-sync', name: 'Real-time Sync', description: 'Real-time transaction synchronization', supported: true },
        { id: 'multi-currency', name: 'Multi-Currency', description: 'Multi-currency account support', supported: true },
        { id: 'global-transfer', name: 'Global Transfers', description: 'International money transfers', supported: true }
      ],
      isActive: true,
      priority: 4
    },
    {
      id: 'capitalone',
      name: 'Capital One',
      website: 'https://www.capitalone.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US', 'CA', 'UK'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'real-time-sync', name: 'Real-time Sync', description: 'Real-time transaction synchronization', supported: true },
        { id: 'credit-monitoring', name: 'Credit Monitoring', description: 'Credit score monitoring', supported: true }
      ],
      isActive: true,
      priority: 5
    },
    {
      id: 'usbank',
      name: 'US Bank',
      website: 'https://www.usbank.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'bill-pay', name: 'Bill Pay', description: 'Bill payment integration', supported: true }
      ],
      isActive: true,
      priority: 6
    },
    {
      id: 'tdbank',
      name: 'TD Bank',
      website: 'https://www.td.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US', 'CA'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'cross-border', name: 'Cross-Border Banking', description: 'US-Canada cross-border services', supported: true }
      ],
      isActive: true,
      priority: 7
    },
    {
      id: 'pncbank',
      name: 'PNC Bank',
      website: 'https://www.pnc.com',
      supportedFormats: ['PDF', 'CSV', 'QFX', 'OFX'],
      regions: ['US'],
      features: [
        { id: 'auto-categorization', name: 'Auto Categorization', description: 'Automatic transaction categorization', supported: true },
        { id: 'virtual-wallet', name: 'Virtual Wallet', description: 'Digital money management tools', supported: true }
      ],
      isActive: true,
      priority: 8
    }
  ];

  const getDefaultTemplates = (): BankTemplate[] => [
    // Chase Template
    {
      id: 'chase-standard',
      bankId: 'chase',
      templateName: 'Chase Standard',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transactions/i,
        transactionEnd: /Summary|Total/i,
        summary: {
          openingBalance: /Opening Balance.*?\$?([\d,]+\.\d{2})/i,
          closingBalance: /Closing Balance.*?\$?([\d,]+\.\d{2})/i,
          totalCredits: /Total Credits.*?\$?([\d,]+\.\d{2})/i,
          totalDebits: /Total Debits.*?\$?([\d,]+\.\d{2})/i
        }
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [/^Page \d+ of \d+$/i, /^Chase Bank/i, /^Account Summary/i, /^\s*$/],
      confidence: 0.95
    },
    // Bank of America Template
    {
      id: 'boa-standard',
      bankId: 'bankofamerica',
      templateName: 'Bank of America Standard',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transaction Detail/i,
        transactionEnd: /Account Summary/i,
        summary: {
          openingBalance: /Beginning Balance.*?\$?([\d,]+\.\d{2})/i,
          closingBalance: /Ending Balance.*?\$?([\d,]+\.\d{2})/i
        }
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [/^Bank of America/i, /^Account Detail/i, /^\s*$/],
      confidence: 0.93
    },
    // Wells Fargo Template
    {
      id: 'wells-fargo-standard',
      bankId: 'wellsfargo',
      templateName: 'Wells Fargo Standard',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transaction History/i,
        transactionEnd: /Account Summary/i
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [/^Wells Fargo/i, /^Account Activity/i, /^\s*$/],
      confidence: 0.91
    }
  ];

  const loadCustomData = () => {
    try {
      const storedAccounts = localStorage.getItem('multiBankAccounts');
      if (storedAccounts) {
        const accountsData = JSON.parse(storedAccounts);
        setAccounts(accountsData.map((a: any) => ({
          ...a,
          lastImport: a.lastImport ? new Date(a.lastImport) : undefined
        })));
      }

      const storedTemplates = localStorage.getItem('multiBankTemplates');
      if (storedTemplates) {
        const templatesData = JSON.parse(storedTemplates);
        setTemplates([...templates, ...templatesData]);
      }
    } catch (error) {
      console.error('Failed to load custom data:', error);
    }
  };

  const supportedBanks = banks.filter(bank => bank.isActive);

  const addBank = async (bank: Omit<Bank, 'id'>) => {
    const newBank: Bank = {
      ...bank,
      id: `bank-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    setBanks(prev => [...prev, newBank]);
  };

  const updateBank = async (bankId: string, updates: Partial<Bank>) => {
    setBanks(prev => prev.map(bank => 
      bank.id === bankId ? { ...bank, ...updates } : bank
    ));
  };

  const removeBank = async (bankId: string) => {
    setBanks(prev => prev.filter(bank => bank.id !== bankId));
    // Also remove associated accounts and templates
    setAccounts(prev => prev.filter(account => account.bankId !== bankId));
    setTemplates(prev => prev.filter(template => template.bankId !== bankId));
  };

  const addAccount = async (account: Omit<BankAccount, 'id'>) => {
    const newAccount: BankAccount = {
      ...account,
      id: `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    setAccounts(prev => [...prev, newAccount]);
  };

  const updateAccount = async (accountId: string, updates: Partial<BankAccount>) => {
    setAccounts(prev => prev.map(account => 
      account.id === accountId ? { ...account, ...updates } : account
    ));
  };

  const removeAccount = async (accountId: string) => {
    setAccounts(prev => prev.filter(account => account.id !== accountId));
  };

  const getBankById = (bankId: string): Bank | undefined => {
    return banks.find(bank => bank.id === bankId);
  };

  const getAccountsByBank = (bankId: string): BankAccount[] => {
    return accounts.filter(account => account.bankId === bankId);
  };

  const detectBankFromStatement = (statementText: string): Bank | null => {
    const lowerText = statementText.toLowerCase();
    
    // Score each bank based on text matches
    const bankScores = banks.map(bank => {
      let score = 0;
      
      // Bank name match
      if (lowerText.includes(bank.name.toLowerCase())) {
        score += 10;
      }
      
      // Website match
      if (bank.website && lowerText.includes(bank.website.toLowerCase())) {
        score += 5;
      }
      
      // Check for bank-specific keywords
      const keywords = getBankKeywords(bank.id);
      keywords.forEach(keyword => {
        if (lowerText.includes(keyword.toLowerCase())) {
          score += 3;
        }
      });
      
      return { bank, score };
    });
    
    // Return bank with highest score
    const bestMatch = bankScores.reduce((best, current) => 
      current.score > best.score ? current : best
    );
    
    return bestMatch.score > 0 ? bestMatch.bank : null;
  };

  const getBankKeywords = (bankId: string): string[] => {
    const keywordMap: Record<string, string[]> = {
      'chase': ['jp morgan', 'chase.com', 'chase bank'],
      'bankofamerica': ['boa', 'bankofamerica.com', 'bank of america'],
      'wellsfargo': ['wellsfargo.com', 'wells fargo'],
      'citibank': ['citi.com', 'citi bank'],
      'capitalone': ['capitalone.com', 'capital one'],
      'usbank': ['usbank.com', 'us bank'],
      'tdbank': ['td.com', 'td bank'],
      'pncbank': ['pnc.com', 'pnc bank']
    };
    
    return keywordMap[bankId] || [];
  };

  const getTemplateForBank = (bankId: string): BankTemplate | null => {
    return templates.find(template => template.bankId === bankId) || null;
  };

  const addCustomTemplate = async (template: BankTemplate) => {
    const newTemplate = {
      ...template,
      id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    setTemplates(prev => [...prev, newTemplate]);
  };

  const updateTemplate = async (templateId: string, updates: Partial<BankTemplate>) => {
    setTemplates(prev => prev.map(template => 
      template.id === templateId ? { ...template, ...updates } : template
    ));
  };

  const removeTemplate = async (templateId: string) => {
    setTemplates(prev => prev.filter(template => template.id !== templateId));
  };

  const testTemplate = async (template: BankTemplate, sampleText: string): Promise<TemplateTestResult> => {
    try {
      // Simulate template testing
      const lines = sampleText.split('\n');
      let extractedTransactions = 0;
      const errors: string[] = [];
      
      for (const line of lines) {
        if (template.patterns.date.test(line) && 
            template.patterns.amount.test(line) && 
            template.patterns.description.test(line)) {
          extractedTransactions++;
        }
      }
      
      const confidence = extractedTransactions > 0 ? 
        Math.min(0.95, 0.5 + (extractedTransactions / lines.length) * 0.45) : 0;
      
      return {
        success: extractedTransactions > 0,
        extractedTransactions,
        confidence,
        errors,
        sampleData: {
          totalLines: lines.length,
          matchedLines: extractedTransactions
        }
      };
    } catch (error) {
      return {
        success: false,
        extractedTransactions: 0,
        confidence: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  };

  const value: MultiBankContextType = {
    banks,
    accounts,
    templates,
    supportedBanks,
    addBank,
    updateBank,
    removeBank,
    addAccount,
    updateAccount,
    removeAccount,
    getBankById,
    getAccountsByBank,
    detectBankFromStatement,
    getTemplateForBank,
    addCustomTemplate,
    updateTemplate,
    removeTemplate,
    testTemplate
  };

  return React.createElement(
    MultiBankContext.Provider,
    { value },
    children
  );
};

export default MultiBankContext;
