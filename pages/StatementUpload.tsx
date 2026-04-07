import React, { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useStatementProcessing } from '../context/StatementProcessingContext';
import PageLayout from '../components/PageLayout';
import PageLoading from '../components/PageLoading';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import { DocumentArrowUpIcon, CheckCircleIcon, ClockIcon } from '../components/icons';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { StatementIcons } from '../constants/statementIcons';
import { parseBankStatement, parseSMSTransactions, parseTradingStatement, validateFile } from '../services/statementParser';
import { Transaction, InvestmentTransaction, Page } from '../types';
import InfoHint from '../components/InfoHint';
import { findDuplicateTransactions } from '../services/dataQuality';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel } from '../components/SymbolWithCompanyName';

interface StatementUploadProps {
  setActivePage?: (page: Page) => void;
}

const StatementUpload: React.FC<StatementUploadProps> = ({ setActivePage }) => {
  const { data, loading, addTransaction, recordTrade } = useContext(DataContext)!;
  const { commitParsedStatementFromUpload } = useStatementProcessing();
  const { formatCurrencyString } = useFormatCurrency();
  const [activeTab, setActiveTab] = useState<'bank' | 'sms' | 'trading'>('bank');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [smsText, setSmsText] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [extractedTransactions, setExtractedTransactions] = useState<Transaction[]>([]);
  const [extractedInvestmentTransactions, setExtractedInvestmentTransactions] = useState<InvestmentTransaction[]>([]);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [duplicateTransactions, setDuplicateTransactions] = useState<Set<number>>(new Set());
  const [selectedTransactions, setSelectedTransactions] = useState<Set<number>>(new Set());
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [parseStats, setParseStats] = useState<{
    totalTransactions: number;
    validTransactions: number;
    invalidTransactions: number;
    duplicateCount: number;
    dateRange: { start: string; end: string } | null;
    amountRange: { min: number; max: number; total: number } | null;
  } | null>(null);
  const [currentStatementId, setCurrentStatementId] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<{
    kind: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stmtInvSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          extractedInvestmentTransactions
            .map((tx) => (tx.symbol || '').trim())
            .filter((s) => s.length >= 2 && s !== 'CASH'),
        ),
      ),
    [extractedInvestmentTransactions],
  );
  const { names: stmtCompanyNames } = useCompanyNames(stmtInvSymbols);

  const bankAccounts = (data?.accounts ?? []).filter(a => a.type !== 'Investment');
  const investmentAccounts = (data?.accounts ?? []).filter(a => a.type === 'Investment');
  const budgetCategories = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.budgets ?? [])
            .map((b) => (b.category ?? '').trim())
            .filter((c) => c.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [data?.budgets],
  );
  const suggestedCategories = useMemo(
    () =>
      Array.from(
        new Set(
          ['Food', 'Transportation', 'Housing', 'Utilities', 'Shopping', 'Entertainment', 'Health', 'Education', 'Income', ...(budgetCategories ?? [])]
            .map((c) => String(c || '').trim())
            .filter((c) => c.length > 0),
        ),
      ),
    [budgetCategories],
  );
  const selectedAccountObj = useMemo(
    () => (data?.accounts ?? []).find((a) => a.id === selectedAccount) ?? null,
    [data?.accounts, selectedAccount],
  );
  const selectedAccountCurrency = selectedAccountObj?.currency === 'USD' ? 'USD' : 'SAR';
  const selectedAccountTypeForStatement = useMemo<'checking' | 'savings' | 'credit' | 'investment'>(() => {
    if (!selectedAccountObj) return activeTab === 'trading' ? 'investment' : 'checking';
    if (selectedAccountObj.type === 'Savings') return 'savings';
    if (selectedAccountObj.type === 'Credit') return 'credit';
    if (selectedAccountObj.type === 'Investment') return 'investment';
    return 'checking';
  }, [selectedAccountObj, activeTab]);
  const setupValidationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if ((activeTab === 'bank' || activeTab === 'sms') && bankAccounts.length === 0) {
      warnings.push('No cash accounts are available for statement import.');
    }
    if (activeTab === 'trading' && investmentAccounts.length === 0) {
      warnings.push('No investment accounts are available for trading statement import.');
    }
    if (parseStats?.invalidTransactions && parseStats.invalidTransactions > 0) {
      warnings.push(`${parseStats.invalidTransactions} extracted transaction(s) failed validation and may be skipped.`);
    }
    return warnings;
  }, [activeTab, bankAccounts.length, investmentAccounts.length, parseStats]);

  const showNotice = (kind: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    setUiNotice({ kind, title, message });
  };

  const normalizeExtractedTransactions = useMemo(
    () => (rows: Transaction[]) =>
      rows.map((tx) => ({
        ...tx,
        accountId: tx.accountId || selectedAccount || '',
        category: tx.category || 'Uncategorized',
        budgetCategory: tx.budgetCategory ?? '',
      })),
    [selectedAccount],
  );

  // When switching tabs, clear file state and fix account selection so it matches the tab
  useEffect(() => {
    setUploadedFile(null);
    setProcessingError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (activeTab === 'trading') {
      if (selectedAccount && !investmentAccounts.some(a => a.id === selectedAccount)) setSelectedAccount('');
    } else {
      if (selectedAccount && !bankAccounts.some(a => a.id === selectedAccount)) setSelectedAccount('');
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps -- only run when tab changes

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (activeTab === 'bank' && !selectedAccount) {
      showNotice('warning', 'Account required', 'Please select an account before uploading a bank statement.');
      return;
    }
    if (activeTab === 'trading' && !selectedAccount) {
      showNotice('warning', 'Investment account required', 'Please select an investment account before uploading a trading statement.');
      return;
    }

    setUploadedFile(file);
    setProcessingError(null);
    setValidationWarnings([]);
    setValidationErrors([]);
    setParseStats(null);
    setIsProcessingFile(true);
    setProcessingProgress(10);

    try {
      // Validate file
      const fileValidation = validateFile(file);
      if (!fileValidation.isValid) {
        throw new Error(fileValidation.error || 'Invalid file');
      }

      setProcessingProgress(20);
      
      // Parse based on file type using real parser
      let transactions: Transaction[] = [];
      let investmentTransactions: InvestmentTransaction[] = [];

      setProcessingProgress(40);
      
      if (activeTab === 'trading') {
        const result = await parseTradingStatement(file, selectedAccount);
        investmentTransactions = result.transactions;
        setExtractedInvestmentTransactions(investmentTransactions);
        if (result.warnings) setValidationWarnings(result.warnings);
        if (result.errors) setValidationErrors(result.errors);
        setParseStats(result.validation?.statistics ?? null);
      } else {
        const result = await parseBankStatement(file, selectedAccount);
        transactions = normalizeExtractedTransactions(result.transactions);
        setExtractedTransactions(transactions);
        if (result.warnings) setValidationWarnings(result.warnings);
        if (result.errors) setValidationErrors(result.errors);
        setParseStats(result.validation?.statistics ?? null);
      }
      
      setProcessingProgress(80);

      setProcessingProgress(90);
      
      if (transactions.length > 0 || investmentTransactions.length > 0) {
        // Check for duplicates before showing review modal
        checkForDuplicates(transactions, investmentTransactions);
        
        setProcessingProgress(95);
        
        // History + Supabase: metadata and extracted rows (when signed in + migration applied)
        try {
          const statement = await commitParsedStatementFromUpload({
            file,
            bankInfo: {
              bankName: 'Auto-detected',
              accountNumber: selectedAccount || 'Unknown',
              accountType: activeTab === 'trading' ? 'investment' : selectedAccountTypeForStatement,
            },
            accountId: selectedAccount || null,
            bankTransactions: activeTab === 'trading' ? undefined : transactions,
            investmentTransactions: activeTab === 'trading' ? investmentTransactions : undefined,
          });
          setCurrentStatementId(statement.id);
        } catch (error) {
          console.warn('Failed to save statement to history:', error);
        }
        
        setProcessingProgress(100);
        setIsReviewModalOpen(true);
      } else {
        showNotice('warning', 'No transactions found', 'No transactions were extracted from the uploaded file. Please check the file format/content.');
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to process file');
      showNotice('error', 'Upload failed', error instanceof Error ? error.message : 'Unknown error while processing file.');
    } finally {
      setIsProcessingFile(false);
      setProcessingProgress(0);
    }
  };

  const handleSMSPaste = async () => {
    if (!smsText.trim()) {
      showNotice('warning', 'SMS text required', 'Please paste SMS transaction text.');
      return;
    }

    if (!selectedAccount) {
      showNotice('warning', 'Account required', 'Please select an account for SMS transactions.');
      return;
    }

    setProcessingError(null);
    setIsProcessingFile(true);
    setProcessingProgress(10);

    try {
      setProcessingProgress(30);
      const result = await parseSMSTransactions(smsText, selectedAccount);
      const normalizedSms = normalizeExtractedTransactions(result.transactions);
      setExtractedTransactions(normalizedSms);
      if (result.warnings) setValidationWarnings(result.warnings);
      if (result.errors) setValidationErrors(result.errors);
      setParseStats(result.validation?.statistics ?? null);
      setProcessingProgress(70);
      
      if (normalizedSms.length > 0) {
        try {
          const statement = await commitParsedStatementFromUpload({
            file: new File([smsText], `sms-transactions-${Date.now()}.txt`, { type: 'text/plain' }),
            bankInfo: {
              bankName: 'SMS Import',
              accountNumber: selectedAccount || 'Unknown',
              accountType: selectedAccountTypeForStatement,
            },
            accountId: selectedAccount || null,
            bankTransactions: normalizedSms,
          });
          setCurrentStatementId(statement.id);
        } catch (error) {
          console.warn('Failed to save SMS statement to history:', error);
        }
        
        // Check for duplicates
        checkForDuplicates(normalizedSms, []);
        setProcessingProgress(100);
        setIsReviewModalOpen(true);
      } else {
        showNotice('warning', 'No SMS transactions found', 'No transactions were extracted from the SMS text. Please check message format.');
      }
    } catch (error) {
      console.error('Error parsing SMS:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to parse SMS');
      showNotice('error', 'SMS parsing failed', error instanceof Error ? error.message : 'Unknown error while parsing SMS.');
    } finally {
      setIsProcessingFile(false);
      setProcessingProgress(0);
    }
  };

  // Check for duplicate transactions
  const checkForDuplicates = (transactions: Transaction[], investmentTransactions: InvestmentTransaction[]) => {
    const existingTransactions = data?.transactions || [];
    const existingInvestmentTransactions = data?.investmentTransactions || [];
    const duplicates = new Set<number>();

    // Check regular transactions (shared heuristic: services/dataQuality)
    transactions.forEach((tx, index) => {
      const matches = findDuplicateTransactions(
        {
          date: tx.date,
          amount: tx.amount,
          description: tx.description,
          accountId: tx.accountId || '',
          type: tx.type,
        },
        existingTransactions,
        { dateToleranceDays: 3, requireSameAccount: false }
      );
      if (matches.length > 0) duplicates.add(index);
    });

    // Check investment transactions
    investmentTransactions.forEach((tx, index) => {
      const txDate = new Date(tx.date);
      const txSymbol = tx.symbol?.toUpperCase();
      const txQuantity = Math.abs(tx.quantity);
      const txPrice = tx.price;

      const isDuplicate = existingInvestmentTransactions.some(existing => {
        const existingDate = new Date(existing.date);
        const existingSymbol = existing.symbol?.toUpperCase();
        const existingQuantity = Math.abs(existing.quantity);
        const existingPrice = existing.price;

        const dateDiff = Math.abs(txDate.getTime() - existingDate.getTime());
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24);

        return daysDiff <= 3 && 
               txSymbol === existingSymbol && 
               Math.abs(txQuantity - existingQuantity) <= 0.01 &&
               Math.abs(txPrice - existingPrice) <= 0.01;
      });

      if (isDuplicate) {
        duplicates.add(transactions.length + index);
      }
    });

    setDuplicateTransactions(duplicates);
    // Auto-select non-duplicates
    const allCount = transactions.length + investmentTransactions.length;
    const nonDuplicates = new Set<number>();
    for (let i = 0; i < allCount; i++) {
      if (!duplicates.has(i)) {
        nonDuplicates.add(i);
      }
    }
    setSelectedTransactions(nonDuplicates);
  };

  const updateExtractedTransaction = (index: number, patch: Partial<Transaction>) => {
    setExtractedTransactions((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const updateExtractedTransactionAmount = (index: number, rawValue: string) => {
    const n = Number(rawValue);
    updateExtractedTransaction(index, { amount: Number.isFinite(n) ? n : 0 });
  };

  const handleApproveTransactions = async () => {
    try {
      const transactionsToImport = extractedTransactions.filter((_, i) => selectedTransactions.has(i));
      const investmentTransactionsToImport = extractedInvestmentTransactions.filter((_, i) => 
        selectedTransactions.has(extractedTransactions.length + i)
      );

      if (transactionsToImport.length === 0 && investmentTransactionsToImport.length === 0) {
        showNotice('warning', 'Nothing selected', 'Please select at least one transaction to import.');
        return;
      }

      const missingAccountRows = transactionsToImport.filter((tx) => !(tx.accountId || selectedAccount));
      if (missingAccountRows.length > 0) {
        showNotice('error', 'Missing account mapping', `${missingAccountRows.length} transaction(s) are missing an account. Please choose an account per row before importing.`);
        return;
      }

      const invalidDateRows = transactionsToImport.filter((tx) => Number.isNaN(new Date(tx.date).getTime()));
      if (invalidDateRows.length > 0) {
        showNotice('error', 'Invalid dates', `${invalidDateRows.length} transaction(s) have invalid dates. Please fix dates in review table.`);
        return;
      }

      const invalidAmountRows = transactionsToImport.filter((tx) => !Number.isFinite(Number(tx.amount)) || Number(tx.amount) === 0);
      if (invalidAmountRows.length > 0) {
        showNotice('warning', 'Amount check', `${invalidAmountRows.length} transaction(s) have zero/invalid amounts. Update amounts or deselect them.`);
        return;
      }

      setProcessingProgress(0);
      const total = transactionsToImport.length + investmentTransactionsToImport.length;
      let processed = 0;

      // Save regular transactions
      for (const tx of transactionsToImport) {
        await addTransaction({
          date: tx.date,
          description: (tx.description || '').trim() || 'Statement Import',
          amount: Number(tx.amount),
          category: tx.category || 'Uncategorized',
          accountId: tx.accountId || selectedAccount,
          budgetCategory: tx.budgetCategory || undefined,
          subcategory: tx.subcategory,
          type: tx.type,
          transactionNature: tx.transactionNature,
          expenseType: tx.expenseType,
          status: tx.status || 'Approved',
          statementId: currentStatementId || undefined
        });
        processed++;
        setProcessingProgress((processed / total) * 100);
      }

      // Save investment transactions using recordTrade
      for (const tx of investmentTransactionsToImport) {
        await recordTrade({
          accountId: tx.accountId,
          date: tx.date,
          type: tx.type,
          symbol: tx.symbol,
          quantity: tx.quantity,
          price: tx.price,
          total: tx.total,
          currency: tx.currency
        });
        processed++;
        setProcessingProgress((processed / total) * 100);
      }

      showNotice('success', 'Import complete', `Successfully imported ${transactionsToImport.length + investmentTransactionsToImport.length} transaction(s).`);
      setIsReviewModalOpen(false);
      setExtractedTransactions([]);
      setExtractedInvestmentTransactions([]);
      setDuplicateTransactions(new Set());
      setSelectedTransactions(new Set());
      setValidationWarnings([]);
      setValidationErrors([]);
      setParseStats(null);
      setCurrentStatementId(null);
      setProcessingProgress(0);
      setSmsText('');
      setUploadedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error saving transactions:', error);
      showNotice('error', 'Import failed', error instanceof Error ? error.message : 'Unknown error while saving transactions.');
    }
  };

  const handleSelectAll = () => {
    const allCount = extractedTransactions.length + extractedInvestmentTransactions.length;
    const nonDuplicates = new Set<number>();
    for (let i = 0; i < allCount; i++) {
      if (!duplicateTransactions.has(i)) {
        nonDuplicates.add(i);
      }
    }
    setSelectedTransactions(nonDuplicates);
  };

  const handleDeselectAll = () => {
    setSelectedTransactions(new Set());
  };

  const handleToggleTransaction = (index: number) => {
    setSelectedTransactions(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (loading || !data) {
    return <PageLoading ariaLabel="Loading statement upload" message="Loading…" />;
  }

  return (
    <PageLayout
      title="Upload Statements"
      description="Upload bank statements, paste SMS transactions, or upload trading statements to automatically import transactions"
      action={
        setActivePage && (
          <button
            type="button"
            onClick={() => setActivePage('Statement History')}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
          >
            <ClockIcon className="h-5 w-5" />
            View History
          </button>
        )
      }
    >
      <div className="space-y-6">
        {uiNotice && (
          <div
            className={`rounded-xl border px-4 py-3 flex items-start justify-between gap-3 ${
              uiNotice.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : uiNotice.kind === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : uiNotice.kind === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-sky-50 border-sky-200 text-sky-900'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2">
              {uiNotice.kind === 'success' ? (
                <CheckCircleIcon className="h-5 w-5 mt-0.5 text-emerald-600" />
              ) : uiNotice.kind === 'error' || uiNotice.kind === 'warning' ? (
                <ExclamationTriangleIcon className="h-5 w-5 mt-0.5 text-amber-600" />
              ) : (
                <InformationCircleIcon className="h-5 w-5 mt-0.5 text-sky-600" />
              )}
              <div>
                <p className="text-sm font-semibold">{uiNotice.title}</p>
                <p className="text-sm opacity-90">{uiNotice.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUiNotice(null)}
              className="text-xs px-2 py-1 rounded-md bg-white/70 hover:bg-white border border-current/20"
            >
              Dismiss
            </button>
          </div>
        )}
        {setupValidationWarnings.length > 0 && (
          <SectionCard title="Statement upload validation checks" collapsible collapsibleSummary="Setup and parser checks" defaultExpanded>
            <ul className="space-y-1 text-sm text-amber-800">
              {setupValidationWarnings.map((w, idx) => (
                <li key={`sv-${idx}`}>- {w}</li>
              ))}
            </ul>
          </SectionCard>
        )}
        {/* Tabs */}
        <div className="bg-white rounded-xl border border-slate-200 p-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('bank')}
              aria-pressed={activeTab === 'bank'}
              aria-label="Upload bank statements"
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'bank'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <StatementIcons.bank className="h-5 w-5 inline-block mr-2" />
              Bank Statements
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sms')}
              aria-pressed={activeTab === 'sms'}
              aria-label="Paste SMS transactions"
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'sms'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <StatementIcons.sms className="h-5 w-5 inline-block mr-2" />
              SMS Transactions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trading')}
              aria-pressed={activeTab === 'trading'}
              aria-label="Upload trading statements"
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'trading'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <StatementIcons.trading className="h-5 w-5 inline-block mr-2" />
              Trading Statements
            </button>
          </div>
        </div>

        {/* Bank Statement Upload */}
        {activeTab === 'bank' && (
          <SectionCard
            title="Upload Bank Statement"
            headerAction={
              <InfoHint text="Supported formats: PDF, CSV, Excel. The system will extract transactions automatically using AI." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="bank-account-select">
                  Select Account
                </label>
                <select
                  id="bank-account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  aria-label="Select bank account for statement"
                >
                  <option value="">Select an account...</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="mt-1 text-sm text-amber-700">Add bank accounts in Settings or Accounts first.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="bank-statement-upload">
                  Upload Statement File
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls,.ofx,.qfx"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="bank-statement-upload"
                    aria-label="Upload bank statement file"
                  />
                  <label
                    htmlFor="bank-statement-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <DocumentArrowUpIcon className="h-12 w-12 text-slate-400 mb-4" />
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, CSV, Excel, OFX, QFX (Max 10MB)
                    </p>
                  </label>
                </div>
                {uploadedFile && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    <span>{uploadedFile.name}</span>
                  </div>
                )}
              </div>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}

              {isProcessingFile && (
                <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm font-medium text-blue-700">Processing statement...</p>
                  </div>
                  {processingProgress > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-blue-600">
                        <span>Extracting transactions</span>
                        <span>{Math.round(processingProgress)}%</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${processingProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* SMS Transaction Paste */}
        {activeTab === 'sms' && (
          <SectionCard
            title="Paste SMS Transactions"
            headerAction={
              <InfoHint text="Paste SMS transaction messages from your bank. The system will extract date, amount, description, and merchant automatically." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="sms-account-select">
                  Select Account
                </label>
                <select
                  id="sms-account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  aria-label="Select account for SMS transactions"
                >
                  <option value="">Select an account...</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="mt-1 text-sm text-amber-700">Add bank accounts in Settings or Accounts first.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="sms-paste-textarea">
                  Paste SMS Text
                </label>
                <textarea
                  id="sms-paste-textarea"
                  value={smsText}
                  onChange={(e) => setSmsText(e.target.value)}
                  placeholder="Paste SMS messages here, one per line or separated by newlines. Example:&#10;Al Rajhi: SAR 500.00 debited from A/C *1234 on 15/01/2024. Bal: SAR 5,000.00&#10;STC: Payment of SAR 100.00 received on 16/01/2024"
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary h-48 font-mono text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  You can paste multiple SMS messages. The system will extract all transactions automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSMSPaste}
                disabled={!smsText.trim() || !selectedAccount || isProcessingFile}
                className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isProcessingFile ? 'Processing...' : 'Extract Transactions'}
              </button>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Trading Statement Upload */}
        {activeTab === 'trading' && (
          <SectionCard
            title="Upload Trading Statement"
            headerAction={
              <InfoHint text="Upload trading statements from brokers (PDF, CSV, Excel). The system will extract buy/sell transactions, dividends, and fees automatically." />
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="trading-account-select">
                  Select Investment Account
                </label>
                <select
                  id="trading-account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  aria-label="Select investment account for trading statement"
                >
                  <option value="">Select an investment account...</option>
                  {investmentAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
                {investmentAccounts.length === 0 && (
                  <p className="mt-1 text-sm text-amber-700">Add an investment account (platform) in Settings or Accounts first.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="trading-statement-upload">
                  Upload Trading Statement
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="trading-statement-upload"
                    aria-label="Upload trading statement file"
                  />
                  <label
                    htmlFor="trading-statement-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <DocumentArrowUpIcon className="h-12 w-12 text-slate-400 mb-4" />
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, CSV, Excel (Max 10MB)
                    </p>
                  </label>
                </div>
                {uploadedFile && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    <span>{uploadedFile.name}</span>
                  </div>
                )}
              </div>

              {processingError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{processingError}</p>
                </div>
              )}

              {isProcessingFile && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-blue-700">Processing trading statement...</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Review Modal */}
        <Modal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          title="Review Extracted Transactions"
          maxWidthClass="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Review the extracted transactions before importing. Select which transactions to import.
              </p>
              <div className="flex gap-2">
                {duplicateTransactions.size > 0 && (
                  <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-medium text-amber-800">
                      {duplicateTransactions.size} potential duplicate(s) detected
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg">
                <p className="text-sm font-semibold text-rose-800 mb-2">
                  Validation Errors ({validationErrors.length})
                </p>
                <ul className="list-disc list-inside space-y-1 max-h-32 overflow-y-auto">
                  {validationErrors.slice(0, 5).map((error, idx) => (
                    <li key={idx} className="text-xs text-rose-700">{error}</li>
                  ))}
                  {validationErrors.length > 5 && (
                    <li className="text-xs text-rose-600 italic">
                      + {validationErrors.length - 5} more error(s)
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Validation Warnings */}
            {validationWarnings.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-semibold text-amber-800 mb-2">
                  Validation Warnings ({validationWarnings.length})
                </p>
                <ul className="list-disc list-inside space-y-1 max-h-32 overflow-y-auto">
                  {validationWarnings.slice(0, 5).map((warning, idx) => (
                    <li key={idx} className="text-xs text-amber-700">{warning}</li>
                  ))}
                  {validationWarnings.length > 5 && (
                    <li className="text-xs text-amber-600 italic">
                      + {validationWarnings.length - 5} more warning(s)
                    </li>
                  )}
                </ul>
              </div>
            )}
            {parseStats && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-sm font-semibold text-slate-800 mb-2">Extraction quality summary</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-700">
                  <div>Total: {parseStats.totalTransactions}</div>
                  <div>Valid: {parseStats.validTransactions}</div>
                  <div>Invalid: {parseStats.invalidTransactions}</div>
                  <div>In-file duplicates: {parseStats.duplicateCount}</div>
                  <div>
                    Range: {parseStats.dateRange ? `${parseStats.dateRange.start} to ${parseStats.dateRange.end}` : 'N/A'}
                  </div>
                  <div>
                    Abs total: {parseStats.amountRange ? formatCurrencyString(parseStats.amountRange.total, { inCurrency: selectedAccountCurrency }) : 'N/A'}
                  </div>
                </div>
              </div>
            )}

            {/* Progress Indicator */}
            {processingProgress > 0 && processingProgress < 100 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">Importing transactions...</span>
                  <span className="font-medium text-primary">{Math.round(processingProgress)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${processingProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Bulk Actions */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">
                  {selectedTransactions.size} of {extractedTransactions.length + extractedInvestmentTransactions.length} selected
                </span>
                {duplicateTransactions.size > 0 && (
                  <span className="text-xs text-amber-600">
                    ({duplicateTransactions.size} duplicates excluded)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Deselect All
                </button>
              </div>
            </div>

            {/* Regular Transactions */}
            {extractedTransactions.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3">
                  Bank Transactions ({extractedTransactions.length})
                </h3>
                <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase w-12">
                          <input
                            type="checkbox"
                            checked={extractedTransactions.length > 0 && extractedTransactions.every((_, i) => 
                              duplicateTransactions.has(i) || selectedTransactions.has(i)
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleSelectAll();
                              } else {
                                handleDeselectAll();
                              }
                            }}
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Account</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Budget Link</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {extractedTransactions.map((tx, index) => {
                        const isDuplicate = duplicateTransactions.has(index);
                        const isSelected = selectedTransactions.has(index);
                        return (
                          <tr
                            key={index}
                            className={isDuplicate ? 'bg-amber-50' : isSelected ? 'bg-blue-50' : ''}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleTransaction(index)}
                                disabled={isDuplicate}
                                className="rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <input
                                type="date"
                                value={tx.date}
                                onChange={(e) => updateExtractedTransaction(index, { date: e.target.value })}
                                className="w-36 p-1.5 border border-slate-300 rounded-md text-xs"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <input
                                value={tx.description || ''}
                                onChange={(e) => updateExtractedTransaction(index, { description: e.target.value })}
                                className="w-56 p-1.5 border border-slate-300 rounded-md text-xs"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <select
                                value={tx.accountId || selectedAccount}
                                onChange={(e) => updateExtractedTransaction(index, { accountId: e.target.value })}
                                className="w-44 p-1.5 border border-slate-300 rounded-md text-xs"
                              >
                                <option value="">Select account...</option>
                                {bankAccounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>{acc.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className={`px-4 py-3 text-sm text-right font-medium ${tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              <input
                                type="number"
                                step="0.01"
                                value={Number.isFinite(Number(tx.amount)) ? tx.amount : 0}
                                onChange={(e) => updateExtractedTransactionAmount(index, e.target.value)}
                                className="w-28 p-1.5 border border-slate-300 rounded-md text-xs text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              <input
                                list="statement-category-suggestions"
                                value={tx.category || ''}
                                onChange={(e) => updateExtractedTransaction(index, { category: e.target.value })}
                                className="w-40 p-1.5 border border-slate-300 rounded-md text-xs"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              <select
                                value={tx.budgetCategory || ''}
                                onChange={(e) => updateExtractedTransaction(index, { budgetCategory: e.target.value || undefined })}
                                className="w-40 p-1.5 border border-slate-300 rounded-md text-xs"
                              >
                                <option value="">No budget link</option>
                                {budgetCategories.map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isDuplicate ? (
                                <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                                  Duplicate
                                </span>
                              ) : isSelected ? (
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                                  Selected
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                                  Not Selected
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <datalist id="statement-category-suggestions">
                  {suggestedCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            )}

            {/* Investment Transactions */}
            {extractedInvestmentTransactions.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3">
                  Investment Transactions ({extractedInvestmentTransactions.length})
                </h3>
                <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase w-12">
                          <input
                            type="checkbox"
                            checked={extractedInvestmentTransactions.length > 0 && extractedInvestmentTransactions.every((_, i) => 
                              duplicateTransactions.has(extractedTransactions.length + i) || 
                              selectedTransactions.has(extractedTransactions.length + i)
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleSelectAll();
                              } else {
                                handleDeselectAll();
                              }
                            }}
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {extractedInvestmentTransactions.map((tx, index) => {
                        const actualIndex = extractedTransactions.length + index;
                        const isDuplicate = duplicateTransactions.has(actualIndex);
                        const isSelected = selectedTransactions.has(actualIndex);
                        return (
                          <tr
                            key={index}
                            className={isDuplicate ? 'bg-amber-50' : isSelected ? 'bg-blue-50' : ''}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleTransaction(actualIndex)}
                                disabled={isDuplicate}
                                className="rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">{new Date(tx.date).toLocaleDateString()}</td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                tx.type === 'buy' ? 'bg-emerald-100 text-emerald-800' :
                                tx.type === 'sell' ? 'bg-rose-100 text-rose-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {tx.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-slate-900 min-w-0 max-w-[180px]">
                              {tx.symbol === 'CASH' || !tx.symbol ? (
                                '—'
                              ) : (
                                <ResolvedSymbolLabel
                                  symbol={tx.symbol}
                                  names={stmtCompanyNames}
                                  layout="inline"
                                  symbolClassName="font-medium text-slate-900"
                                />
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900">{tx.quantity}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900">{tx.price.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-slate-900">
                              {tx.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tx.currency || 'SAR'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isDuplicate ? (
                                <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                                  Duplicate
                                </span>
                              ) : isSelected ? (
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                                  Selected
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                                  Not Selected
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => {
                  setIsReviewModalOpen(false);
                  setSelectedTransactions(new Set());
                  setDuplicateTransactions(new Set());
                  setValidationWarnings([]);
                  setValidationErrors([]);
                }}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveTransactions}
                disabled={selectedTransactions.size === 0 || processingProgress > 0}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingProgress > 0 
                  ? `Importing... ${Math.round(processingProgress)}%`
                  : `Import ${selectedTransactions.size} Selected Transaction(s)`
                }
              </button>
            </div>
          </div>
        </Modal>
        <AIAdvisor
          pageContext="cashflow"
          contextData={{ transactions: extractedTransactions, budgets: data?.budgets ?? [] }}
          title="Statement Import Advisor"
          subtitle="Review extraction quality and import risks before approving."
          buttonLabel="Get AI Import Insights"
        />
      </div>
    </PageLayout>
  );
};

export default StatementUpload;
