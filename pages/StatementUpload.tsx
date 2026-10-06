import React, { useState, useContext, useRef, useEffect, useMemo, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { useStatementProcessing } from '../context/StatementProcessingContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import { DocumentArrowUpIcon, CheckCircleIcon, ClockIcon } from '../components/icons';
import { StatementIcons } from '../constants/statementIcons';
import { parseBankStatement, parseSMSTransactions, parseTradingStatement, validateFile, type TradingParseDebug } from '../services/statementParser';
import { Transaction, InvestmentTransaction, Page } from '../types';
import InfoHint from '../components/InfoHint';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import { sortByNewestFirst } from '../utils/sortRecency';
import { buildDividendDedupeKey, normalizeDividendForDedupe } from '../services/dividendLedgerGuards';
import {
  computeStatementReviewDuplicates,
  planStatementImport,
  type StatementImportContext,
} from '../services/statementImportPrepare';
import { parseSmsCardLast4FromNote } from '../services/smsImportRouting';
import {
  isSmsAtmWithdrawalTx,
  parseSmsAtmCashToFromNote,
  shouldImportSmsAtmAsTransfer,
  smsNoteWithAtmMeta,
  stripSmsAtmMeta,
} from '../services/smsAtmCashTransfer';
import {
  isSmsCcPaymentTx,
  parseSmsCcFundedFromNote,
  shouldImportSmsCcPaymentAsTransfer,
  smsNoteWithCcPaymentMeta,
  stripSmsCcPaymentMeta,
  isEligibleCcFundingAccount,
} from '../services/smsCcPaymentTransfer';
import {
  isSmsAccountTransferTx,
  parseSmsAccountTransferToFromNote,
  parseSmsTransferDestLast4FromNote,
  parseSmsTransferFeeFromNote,
  shouldImportSmsAccountAsTransfer,
  smsAccountTransferPrincipalAmount,
  smsNoteWithAccountTransferMeta,
  stripSmsAccountTransferMeta,
  isEligibleAccountTransferDestination,
} from '../services/smsAccountTransfer';
import { isSmsLedgerTransferTx } from '../services/smsImportTransferGuards';
import { useCanonicalSpotFx } from '../hooks/useCanonicalFinancialMetrics';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { summarizeStatementImportForConfirm } from '../utils/recordConfirmMessages';
import {
  financialMonthKeyFromTransactionDate,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { budgetCardCategoryNames } from '../utils/budgetCardCategories';

interface StatementUploadProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  pageAction?: string | null;
  clearPageAction?: () => void;
}

const StatementUpload: React.FC<StatementUploadProps> = ({ setActivePage, triggerPageAction, pageAction, clearPageAction }) => {
  const { data, addTransaction, addTransfer, recordTrade } = useContext(DataContext)!;
  const confirmAction = useConfirmAction();
  const { commitParsedStatementFromUpload } = useStatementProcessing();
  const { formatCurrencyString } = useFormatCurrency();
  const sarPerUsd = useCanonicalSpotFx();
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
  /** Prevents double-clicks on Import (review modal) from duplicating `addTransaction` / `recordTrade` rows. */
  const [isImporting, setIsImporting] = useState(false);
  const importSubmitLockRef = useRef(false);
  /** Blocks duplicate import clicks while the confirm modal is open (before `importSubmitLockRef` is set). */
  const importConfirmPendingRef = useRef(false);
  const smsExtractLockRef = useRef(false);
  const fileParseLockRef = useRef(false);
  const [duplicateTransactions, setDuplicateTransactions] = useState<Set<number>>(new Set());
  const [selectedTransactions, setSelectedTransactions] = useState<Set<number>>(new Set());
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [importResultMessage, setImportResultMessage] = useState<string | null>(null);
  const [parseStats, setParseStats] = useState<{
    totalTransactions: number;
    validTransactions: number;
    invalidTransactions: number;
    duplicateCount: number;
    dateRange: { start: string; end: string } | null;
    amountRange: { min: number; max: number; total: number } | null;
  } | null>(null);
  const [tradingParseDebug, setTradingParseDebug] = useState<TradingParseDebug | null>(null);
  const [currentStatementId, setCurrentStatementId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bankAccounts = (data?.accounts ?? []).filter(a => a.type !== 'Investment');
  const investmentAccounts = (data?.accounts ?? []).filter(a => a.type === 'Investment');
  const physicalCashAccountChoices = useMemo(
    () => bankAccounts.filter((a) => a.type === 'Checking' || a.type === 'Savings'),
    [bankAccounts],
  );
  /** Checking/Savings that can fund a card payment (excludes physical cash wallets). */
  const ccFundingAccountChoices = useMemo(
    () => bankAccounts.filter((a) => isEligibleCcFundingAccount(a)),
    [bankAccounts],
  );
  /** Destinations for outgoing حوالة (Checking / Savings / Credit). */
  const accountTransferDestinationChoices = useMemo(
    () => bankAccounts.filter((a) => isEligibleAccountTransferDestination(a)),
    [bankAccounts],
  );
  const selectedAccountObj = useMemo(
    () => (data?.accounts ?? []).find((a) => a.id === selectedAccount) ?? null,
    [data?.accounts, selectedAccount],
  );
  const selectedAccountCurrency = selectedAccountObj?.currency === 'USD' ? 'USD' : 'SAR';

  const monthStartDay = useMemo(() => resolveMonthStartDayFromData(data), [data]);
  const finalizedNewCategoryNames = useMemo(
    () =>
      (data?.budgetRequests ?? [])
        .filter((r) => r.status === 'Finalized' && r.requestType === 'NewCategory')
        .map((r) => String(r.categoryName || '').trim())
        .filter(Boolean),
    [data?.budgetRequests],
  );
  /** Budget cards for the financial month that contains the transaction date (not "today"). */
  const budgetCategoriesForTransactionDate = useCallback(
    (ymd: string) => {
      const dateStr = String(ymd || '').trim() || new Date().toISOString().slice(0, 10);
      const viewKey = financialMonthKeyFromTransactionDate(dateStr, monthStartDay);
      return budgetCardCategoryNames({
        budgets: data?.budgets ?? [],
        viewKey,
        monthStartDay,
        userRole: 'Admin',
        finalizedNewCategoryNames,
      });
    },
    [data?.budgets, finalizedNewCategoryNames, monthStartDay],
  );
  const transactionCategoryOptions = useMemo(() => {
    const existing = (data?.transactions ?? []).map((t) => String(t.category || '').trim()).filter(Boolean);
    const extracted = extractedTransactions.map((t) => String(t.category || '').trim()).filter(Boolean);
    return Array.from(new Set([...existing, ...extracted])).sort((a, b) => a.localeCompare(b));
  }, [data?.transactions, extractedTransactions]);
  const selectedAccountTypeForStatement = useMemo<'checking' | 'savings' | 'credit' | 'investment'>(() => {
    const routedPrimary =
      extractedTransactions.find((t) => String(t.accountId || '').trim())?.accountId ||
      selectedAccount ||
      '';
    const accountObj =
      (data?.accounts ?? []).find((a) => a.id === routedPrimary) ?? selectedAccountObj;
    if (!accountObj) return activeTab === 'trading' ? 'investment' : 'checking';
    if (accountObj.type === 'Savings') return 'savings';
    if (accountObj.type === 'Credit') return 'credit';
    if (accountObj.type === 'Investment') return 'investment';
    return 'checking';
  }, [selectedAccountObj, activeTab, extractedTransactions, selectedAccount, data?.accounts]);

  const enrichTransactionsWithBudgetMapping = useCallback((rows: Transaction[]): Transaction[] => {
    const userHistory = data?.transactions ?? [];
    return rows.map((tx) => {
      if (isSmsLedgerTransferTx(tx)) {
        return {
          ...tx,
          category: 'Transfer',
          budgetCategory: undefined,
        };
      }
      const budgetCategoryNames = budgetCategoriesForTransactionDate(tx.date);
      const mapped = categorizeImportedTransaction(tx, { budgetCategoryNames, userHistory });
      const nextBudget = mapped.budgetCategory;
      // Never keep a budget link that is not on this transaction's financial-month cards.
      const budgetCategory =
        nextBudget && budgetCategoryNames.includes(nextBudget)
          ? nextBudget
          : tx.budgetCategory && budgetCategoryNames.includes(String(tx.budgetCategory))
            ? tx.budgetCategory
            : undefined;
      return {
        ...tx,
        category: mapped.category || tx.category,
        budgetCategory,
      };
    });
  }, [budgetCategoriesForTransactionDate, data?.transactions]);
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

  // When switching tabs, clear file state and fix account selection so it matches the tab
  useEffect(() => {
    setUploadedFile(null);
    setProcessingError(null);
    setTradingParseDebug(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (activeTab === 'trading') {
      if (selectedAccount && !investmentAccounts.some(a => a.id === selectedAccount)) setSelectedAccount('');
    } else {
      if (selectedAccount && !bankAccounts.some(a => a.id === selectedAccount)) setSelectedAccount('');
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps -- only run when tab changes

  useEffect(() => {
    if (!pageAction) return;
    if (pageAction === 'focus-sms-tab') setActiveTab('sms');
    else if (pageAction === 'focus-bank-tab') setActiveTab('bank');
    else if (pageAction === 'focus-trading-tab') setActiveTab('trading');
    clearPageAction?.();
  }, [pageAction, clearPageAction]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileParseLockRef.current) return;
    fileParseLockRef.current = true;

    if (activeTab === 'bank' && !selectedAccount) {
      alert('Please select an account before uploading a bank statement.');
      fileParseLockRef.current = false;
      return;
    }
    if (activeTab === 'trading' && !selectedAccount) {
      alert('Please select an investment account before uploading a trading statement.');
      fileParseLockRef.current = false;
      return;
    }

    setUploadedFile(file);
    setProcessingError(null);
    setValidationWarnings([]);
    setValidationErrors([]);
    setImportResultMessage(null);
    setImportResultMessage(null);
    setParseStats(null);
    setTradingParseDebug(null);
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
        setExtractedInvestmentTransactions(sortByNewestFirst(investmentTransactions));
        if (result.warnings) setValidationWarnings(result.warnings);
        if (result.errors) setValidationErrors(result.errors);
        setParseStats(result.validation?.statistics ?? null);
        setTradingParseDebug(result.debug ?? null);
      } else {
        const result = await parseBankStatement(file, selectedAccount);
        transactions = enrichTransactionsWithBudgetMapping(result.transactions);
        setExtractedTransactions(sortByNewestFirst(transactions));
        if (result.warnings) setValidationWarnings(result.warnings);
        if (result.errors) setValidationErrors(result.errors);
        setParseStats(result.validation?.statistics ?? null);
        setTradingParseDebug(null);
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
        alert('No transactions found in the uploaded file. Please check the file format.');
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to process file');
      alert(`Error processing file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      fileParseLockRef.current = false;
      setIsProcessingFile(false);
      setProcessingProgress(0);
    }
  };

  const handleSMSPaste = async () => {
    if (!smsText.trim()) {
      alert('Please paste SMS transaction text');
      return;
    }

    if (smsExtractLockRef.current) return;
    smsExtractLockRef.current = true;

    setProcessingError(null);
    setImportResultMessage(null);
    setValidationWarnings([]);
    setValidationErrors([]);
    setIsProcessingFile(true);
    setProcessingProgress(10);

    try {
      setProcessingProgress(30);
      const fallbackAccountId = selectedAccount || '';
      const result = await parseSMSTransactions(smsText, fallbackAccountId, {
        accounts: data?.accounts ?? [],
      });
      const mapped = enrichTransactionsWithBudgetMapping(result.transactions);
      setExtractedTransactions(sortByNewestFirst(mapped));
      setValidationWarnings(result.warnings ?? []);
      setValidationErrors(result.errors ?? []);
      setParseStats(result.validation?.statistics ?? null);
      setProcessingProgress(70);
      
      if (mapped.length > 0) {
        try {
          const primaryAccountId =
            mapped.find((t) => String(t.accountId || '').trim())?.accountId ||
            fallbackAccountId ||
            null;
          const statement = await commitParsedStatementFromUpload({
            file: new File([smsText], `sms-transactions-${Date.now()}.txt`, { type: 'text/plain' }),
            bankInfo: {
              bankName: 'SMS Import',
              accountNumber: primaryAccountId || 'SMS (card last-4)',
              accountType: selectedAccountTypeForStatement,
            },
            accountId: primaryAccountId,
            bankTransactions: mapped,
          });
          setCurrentStatementId(statement.id);
        } catch (error) {
          console.warn('Failed to save SMS statement to history:', error);
        }
        
        // Check for duplicates
        checkForDuplicates(mapped, []);
        setProcessingProgress(100);
        setIsReviewModalOpen(true);
      } else {
        const guidance = 'No transactions were detected from this SMS text. Try pasting each SMS as a separate block (blank line between messages), and keep amount/date lines intact.';
        setProcessingError(guidance);
        setValidationWarnings((prev) => [...prev, guidance]);
        alert(guidance);
      }
    } catch (error) {
      console.error('Error parsing SMS:', error);
      setProcessingError(error instanceof Error ? error.message : 'Failed to parse SMS');
      alert(`Error parsing SMS: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      smsExtractLockRef.current = false;
      setIsProcessingFile(false);
      setProcessingProgress(0);
    }
  };

  const statementImportCtx = useMemo((): StatementImportContext => ({
    accounts: data?.accounts ?? [],
    portfolios: data?.investments ?? [],
    existingBankTransactions: data?.transactions ?? [],
    existingInvestmentTransactions: data?.investmentTransactions ?? [],
    sarPerUsd,
    preferredAccountId: selectedAccount || undefined,
  }), [data, sarPerUsd, selectedAccount]);

  const applyReviewDuplicateFlags = useCallback((
    transactions: Transaction[],
    investmentTransactions: InvestmentTransaction[],
    options?: { resetSelection?: boolean },
  ) => {
    const duplicates = computeStatementReviewDuplicates(
      transactions,
      investmentTransactions,
      statementImportCtx,
      activeTab === 'sms'
        ? { dateToleranceDays: 1, requireSameAccount: true }
        : { dateToleranceDays: 3, requireSameAccount: false },
    );
    setDuplicateTransactions(duplicates);
    if (options?.resetSelection !== false) {
      const allCount = transactions.length + investmentTransactions.length;
      const nonDuplicates = new Set<number>();
      for (let i = 0; i < allCount; i++) {
        if (!duplicates.has(i)) nonDuplicates.add(i);
      }
      setSelectedTransactions(nonDuplicates);
    } else {
      setSelectedTransactions((prev) => {
        const next = new Set(prev);
        for (const d of duplicates) next.delete(d);
        return next;
      });
    }
  }, [statementImportCtx, activeTab]);

  const checkForDuplicates = useCallback((
    transactions: Transaction[],
    investmentTransactions: InvestmentTransaction[],
  ) => {
    applyReviewDuplicateFlags(transactions, investmentTransactions, { resetSelection: true });
  }, [applyReviewDuplicateFlags]);

  useEffect(() => {
    if (!isReviewModalOpen) return;
    if (extractedTransactions.length === 0 && extractedInvestmentTransactions.length === 0) return;
    applyReviewDuplicateFlags(extractedTransactions, extractedInvestmentTransactions, {
      resetSelection: false,
    });
  }, [
    extractedTransactions,
    extractedInvestmentTransactions,
    isReviewModalOpen,
    applyReviewDuplicateFlags,
    data?.investmentTransactions,
    data?.transactions,
  ]);

  const selectedImportPlan = useMemo(() => {
    if (!isReviewModalOpen) return null;
    return planStatementImport({
      bankTransactions: extractedTransactions,
      investmentTransactions: extractedInvestmentTransactions,
      selectedIndices: selectedTransactions,
      duplicateIndices: duplicateTransactions,
      ctx: statementImportCtx,
    });
  }, [
    isReviewModalOpen,
    extractedTransactions,
    extractedInvestmentTransactions,
    selectedTransactions,
    duplicateTransactions,
    statementImportCtx,
  ]);

  const handleApproveTransactions = async () => {
    if (importSubmitLockRef.current || importConfirmPendingRef.current) return;
    try {
      setImportResultMessage(null);
      const parserParsedCount = extractedInvestmentTransactions.length;

      if (selectedTransactions.size === 0) {
        alert('Please select at least one transaction to import.');
        return;
      }

      const selectedMissingAccount = [...selectedTransactions].filter((idx) => {
        if (idx < extractedTransactions.length) {
          return !String(extractedTransactions[idx]?.accountId || '').trim();
        }
        return false;
      });
      if (selectedMissingAccount.length > 0) {
        alert(
          `${selectedMissingAccount.length} selected row(s) have no account. Assign an account in the review table (or set Card last-4 on Accounts) before importing.`,
        );
        return;
      }

      const selectedAtmMissingCash = [...selectedTransactions].filter((idx) => {
        if (idx >= extractedTransactions.length) return false;
        const tx = extractedTransactions[idx];
        if (!isSmsAtmWithdrawalTx(tx) || !(Number(tx.amount) < 0)) return false;
        const cashTo = parseSmsAtmCashToFromNote(tx.note);
        if (!cashTo) return true;
        if (cashTo === String(tx.accountId || '').trim()) return true;
        return !physicalCashAccountChoices.some((a) => a.id === cashTo);
      });
      if (selectedAtmMissingCash.length > 0) {
        alert(
          `${selectedAtmMissingCash.length} ATM withdrawal(s) need a Cash account destination (different from the card/account withdrawn from). Set Cash role “Physical cash / wallet” on Accounts, or pick Cash on each ATM row.`,
        );
        return;
      }

      const selectedCcMissingFunding = [...selectedTransactions].filter((idx) => {
        if (idx >= extractedTransactions.length) return false;
        const tx = extractedTransactions[idx];
        if (!isSmsCcPaymentTx(tx)) return false;
        const fundedFrom = parseSmsCcFundedFromNote(tx.note);
        if (!fundedFrom) return true;
        if (fundedFrom === String(tx.accountId || '').trim()) return true;
        return !ccFundingAccountChoices.some((a) => a.id === fundedFrom);
      });
      if (selectedCcMissingFunding.length > 0) {
        alert(
          `${selectedCcMissingFunding.length} card payment(s) (سداد) need a Paid-from Checking/Savings account (different from the card). Set Cash role “Debt servicing” / “Bills payment” on Accounts, or pick Paid from on each سداد row.`,
        );
        return;
      }

      const plan = planStatementImport({
        bankTransactions: extractedTransactions,
        investmentTransactions: extractedInvestmentTransactions,
        selectedIndices: selectedTransactions,
        duplicateIndices: duplicateTransactions,
        ctx: statementImportCtx,
      });

      if (plan.importableCount === 0) {
        const hint = plan.validationMessages.slice(0, 3).join(' | ');
        alert(
          hint
            ? `Nothing to import. ${hint}`
            : 'Nothing to import. Selected rows are duplicates or failed validation.',
        );
        return;
      }

      importConfirmPendingRef.current = true;
      const importOk = await confirmAction(
        summarizeStatementImportForConfirm({
          bankCount: plan.importableBankRows.length,
          investmentCount: plan.importableInvestmentRows.length,
          skippedDuplicates: plan.skippedDuplicates,
          skippedValidation: plan.skippedValidation,
        }),
      );
      importConfirmPendingRef.current = false;
      if (!importOk) return;

      importSubmitLockRef.current = true;
      setIsImporting(true);
      setProcessingProgress(0);
      let processed = 0;

      const importErrors: string[] = [];
      const rejectionReasons = [...plan.validationMessages];
      const succeededIndices = new Set<number>();
      const failedIndices = new Set<number>();
      let insertedTradeTransactions = 0;
      let insertedCashLedgerRows = 0;
      let recomputeExecuted = false;
      let finalCashDelta = 0;
      let finalPositionDelta = 0;

      const validatedInvestmentRows = plan.importableInvestmentRows;
      const validatedBankRows = plan.importableBankRows;
      const total = validatedBankRows.length + validatedInvestmentRows.length;

      const bankTasks: Array<() => Promise<void>> = [
        ...validatedBankRows.map(({ tx, idx, displayIdx }) => async () => {
          try {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const cashTo = parseSmsAtmCashToFromNote(tx.note);
                const fundedFrom = parseSmsCcFundedFromNote(tx.note);
                const transferTo = parseSmsAccountTransferToFromNote(tx.note);
                if (shouldImportSmsAtmAsTransfer(tx) && cashTo) {
                  const fromAccountId = String(tx.accountId || '').trim();
                  const absAmt = Math.abs(Number(tx.amount) || 0);
                  const transferNote =
                    stripSmsAtmMeta(tx.note) ||
                    String(tx.description || '')
                      .replace(/^ATM\s*→[^·]*·?\s*/i, '')
                      .trim() ||
                    'ATM cash withdrawal';
                  await addTransfer(
                    fromAccountId,
                    cashTo,
                    absAmt,
                    tx.date,
                    transferNote,
                    0,
                    { system: true },
                  );
                } else if (shouldImportSmsCcPaymentAsTransfer(tx) && fundedFrom) {
                  const cardAccountId = String(tx.accountId || '').trim();
                  const absAmt = Math.abs(Number(tx.amount) || 0);
                  const transferNote =
                    stripSmsCcPaymentMeta(tx.note) ||
                    String(tx.description || '')
                      .replace(/^CC payment\s*(?:←[^·]*·?\s*)?/i, '')
                      .trim() ||
                    'Card payment (سداد)';
                  await addTransfer(
                    fundedFrom,
                    cardAccountId,
                    absAmt,
                    tx.date,
                    transferNote,
                    0,
                    { system: true },
                  );
                } else if (shouldImportSmsAccountAsTransfer(tx) && transferTo) {
                  const fromAccountId = String(tx.accountId || '').trim();
                  const principal = smsAccountTransferPrincipalAmount(tx);
                  const fee = parseSmsTransferFeeFromNote(tx.note);
                  const transferNote =
                    stripSmsAccountTransferMeta(tx.note) ||
                    String(tx.description || '')
                      .replace(/^Transfer\s*→[^·]*·?\s*/i, '')
                      .replace(/^Transfer\s*·\s*/i, '')
                      .trim() ||
                    'Local transfer (حوالة)';
                  await addTransfer(
                    fromAccountId,
                    transferTo,
                    principal,
                    tx.date,
                    transferNote,
                    fee,
                    { system: true },
                  );
                } else if (isSmsAtmWithdrawalTx(tx) || isSmsCcPaymentTx(tx)) {
                  throw new Error(
                    isSmsAtmWithdrawalTx(tx)
                      ? 'ATM withdrawal must import as a transfer to Cash (pick Cash destination).'
                      : 'Card payment (سداد) must import as a transfer from a funding account (pick Paid from).',
                  );
                } else {
                  await addTransaction({
                    date: tx.date,
                    description: tx.description,
                    amount: tx.amount,
                    category: tx.category,
                    accountId: tx.accountId,
                    budgetCategory: tx.budgetCategory,
                    subcategory: tx.subcategory,
                    type: tx.type,
                    transactionNature: tx.transactionNature,
                    expenseType: tx.expenseType,
                    status: tx.status || 'Approved',
                    statementId: currentStatementId || undefined,
                    note: tx.note,
                    transferGroupId: tx.transferGroupId,
                    transferRole: tx.transferRole,
                  }, { system: true });
                }
                succeededIndices.add(idx);
                failedIndices.delete(idx);
                return;
              } catch (inner) {
                if (attempt >= 1) throw inner;
              }
            }
          } catch (e) {
            failedIndices.add(idx);
            importErrors.push(`Bank tx #${displayIdx}: ${e instanceof Error ? e.message : String(e || 'Unknown error')}`);
          } finally {
            processed++;
            setProcessingProgress((processed / total) * 100);
          }
        }),
      ];
      const importPendingKeys = new Set<string>();
      const investmentTasks: Array<() => Promise<void>> = [
        ...validatedInvestmentRows.map(({ tx, absoluteIdx, displayIdx }, taskIdx) => async () => {
          try {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const result = await recordTrade({
                  portfolioId: tx.portfolioId,
                  accountId: tx.accountId,
                  date: tx.date,
                  type: tx.type,
                  symbol: tx.symbol,
                  quantity: tx.quantity,
                  price: tx.price,
                  total: tx.total,
                  currency: tx.currency,
                }, undefined, { system: true });
                insertedTradeTransactions += Number(result?.insertedTradeTransactions || 0);
                insertedCashLedgerRows += Number(result?.insertedCashLedgerRows || 0);
                if (result?.recomputed) recomputeExecuted = true;
                finalCashDelta += Number(result?.cashDelta || 0);
                finalPositionDelta += Number(result?.positionDelta || 0);
                succeededIndices.add(absoluteIdx);
                failedIndices.delete(absoluteIdx);
                if (String(tx.type).toLowerCase() === 'dividend') {
                  const norm = normalizeDividendForDedupe(
                    tx,
                    data?.investments ?? [],
                    sarPerUsd,
                  );
                  if (norm) {
                    importPendingKeys.add(
                      buildDividendDedupeKey(
                        {
                          portfolioId: tx.portfolioId,
                          accountId: tx.accountId,
                          symbol: tx.symbol,
                          payDate: tx.date,
                          totalBook: norm.totalBook,
                          bookCurrency: norm.bookCurrency,
                        },
                        data?.accounts ?? [],
                      ),
                    );
                  }
                }
                return;
              } catch (inner) {
                if (attempt >= 1) throw inner;
              }
            }
          } catch (e) {
            failedIndices.add(absoluteIdx);
            importErrors.push(`Investment tx #${taskIdx + 1} (row ${displayIdx}): ${e instanceof Error ? e.message : String(e || 'Unknown error')}`);
          } finally {
            processed++;
            setProcessingProgress((processed / total) * 100);
          }
        }),
      ];

      // Serialize writes to prevent account balance overwrite races and recordTrade in-flight lock conflicts.
      for (const run of bankTasks) {
        await run();
      }
      for (const run of investmentTasks) {
        await run();
      }

      const importSummary = {
        parsed: parserParsedCount,
        normalized: validatedInvestmentRows.length,
        rejected: plan.skippedValidation,
        duplicate: plan.skippedDuplicates,
        validated: validatedInvestmentRows.length,
        imported: insertedTradeTransactions,
        cashLedgerInserted: insertedCashLedgerRows,
        recomputed: recomputeExecuted,
        finalCashDelta,
        finalPositionDelta,
      };
      const selectedInvestmentCount = validatedInvestmentRows.length;
      if (selectedInvestmentCount > 0 && insertedTradeTransactions === 0) {
        throw new Error(`Import failed: ${selectedInvestmentCount} investment row(s) validated but 0 trades inserted. ${[...rejectionReasons, ...importErrors].slice(0, 3).join(' | ') || 'All rows failed.'}`);
      }
      const validatedCashImpact = validatedInvestmentRows.filter(({ tx }) => ['buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'fee', 'vat'].includes(tx.type)).length;
      if (validatedCashImpact > 0 && insertedCashLedgerRows === 0) {
        throw new Error('Import failed: cash-impact rows were validated but 0 cash-ledger rows were inserted.');
      }
      const importedCount = succeededIndices.size;
      const failedCount = failedIndices.size;

      if (failedCount === 0) {
        alert(
          `Successfully imported ${importedCount} transaction(s).\nSummary: parsed=${importSummary.parsed}, normalized=${importSummary.normalized}, duplicates=${importSummary.duplicate}, rejected=${importSummary.rejected}, imported=${importSummary.imported}, cashLedgerInserted=${importSummary.cashLedgerInserted}, recomputed=${importSummary.recomputed ? 'yes' : 'no'}, cashDelta=${importSummary.finalCashDelta}, positionDelta=${importSummary.finalPositionDelta}.`,
        );
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
        setImportResultMessage(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setSelectedTransactions(new Set(failedIndices));
        setProcessingProgress(0);
        setImportResultMessage(
          `Imported ${importedCount} transaction(s). ${failedCount} failed. Summary: parsed=${importSummary.parsed}, normalized=${importSummary.normalized}, duplicates=${importSummary.duplicate}, rejected=${importSummary.rejected}, imported=${importSummary.imported}, cashLedgerInserted=${importSummary.cashLedgerInserted}, recomputed=${importSummary.recomputed ? 'yes' : 'no'}.`,
        );
      }

      if (importErrors.length > 0) {
        alert(`Import completed with issues: ${importErrors.slice(0, 3).join(' | ')}`);
      }
    } catch (error) {
      console.error('Error saving transactions:', error);
      alert(`Failed to save transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      importConfirmPendingRef.current = false;
      importSubmitLockRef.current = false;
      setIsImporting(false);
    }
  };

  const dismissReviewModal = () => {
    if (importSubmitLockRef.current || importConfirmPendingRef.current) return;
    setIsReviewModalOpen(false);
    setSelectedTransactions(new Set());
    setDuplicateTransactions(new Set());
    setValidationWarnings([]);
    setValidationErrors([]);
    setImportResultMessage(null);
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


  const handleExtractedTransactionEdit = (index: number, patch: Partial<Transaction>) => {
    setExtractedTransactions((prev) => {
      const nextRows = prev.map((tx, i) => {
        if (i !== index) return tx;
        const next = { ...tx, ...patch };
        if (isSmsLedgerTransferTx(next)) {
          return {
            ...next,
            category: 'Transfer',
            budgetCategory: undefined,
          };
        }
        if (
          (Object.prototype.hasOwnProperty.call(patch, 'description') ||
            Object.prototype.hasOwnProperty.call(patch, 'date')) &&
          !Object.prototype.hasOwnProperty.call(patch, 'category') &&
          !Object.prototype.hasOwnProperty.call(patch, 'budgetCategory')
        ) {
          const budgetCategoryNames = budgetCategoriesForTransactionDate(next.date);
          const mapped = categorizeImportedTransaction(next, {
            budgetCategoryNames,
            userHistory: data?.transactions ?? [],
          });
          const nextBudget = mapped.budgetCategory;
          const budgetCategory =
            nextBudget && budgetCategoryNames.includes(nextBudget)
              ? nextBudget
              : next.budgetCategory && budgetCategoryNames.includes(String(next.budgetCategory))
                ? next.budgetCategory
                : undefined;
          return {
            ...next,
            category: mapped.category || next.category,
            budgetCategory,
          };
        }
        return next;
      });
      if (Object.prototype.hasOwnProperty.call(patch, 'accountId')) {
        queueMicrotask(() => {
          applyReviewDuplicateFlags(nextRows, extractedInvestmentTransactions, { resetSelection: false });
        });
      }
      return nextRows;
    });
  };

  const handleExtractedInvestmentTransactionEdit = (index: number, patch: Partial<InvestmentTransaction>) => {
    setExtractedInvestmentTransactions((prev) =>
      prev.map((tx, i) => {
        if (i !== index) return tx;
        const next = { ...tx, ...patch };
        const qtyChanged = Object.prototype.hasOwnProperty.call(patch, 'quantity');
        const priceChanged = Object.prototype.hasOwnProperty.call(patch, 'price');
        const totalChanged = Object.prototype.hasOwnProperty.call(patch, 'total');
        if ((qtyChanged || priceChanged) && !totalChanged) {
          const q = Number(next.quantity) || 0;
          const p = Number(next.price) || 0;
          if (q > 0 && p > 0) next.total = q * p;
        }
        return next;
      }),
    );
  };

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
        {(setActivePage || triggerPageAction) && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 flex flex-wrap items-center justify-between gap-2">
            <span>
              If the closing balance on the statement still differs from the account after import, post the
              residual as an audited delta — never by overwriting the balance.
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {triggerPageAction && (
                <button
                  type="button"
                  className="text-primary font-medium hover:underline"
                  onClick={() =>
                    triggerPageAction(
                      'Accounts',
                      selectedAccount ? `open-reconcile-balance:${selectedAccount}` : 'open-reconcile-balance',
                    )
                  }
                >
                  Reconcile Balance →
                </button>
              )}
              {setActivePage && (
                <button
                  type="button"
                  className="text-slate-600 font-medium hover:underline"
                  onClick={() => setActivePage('System & APIs Health')}
                >
                  Open data reconciliation →
                </button>
              )}
            </div>
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
              <p className="text-sm text-indigo-900 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                Broker <strong>dividend</strong> SMS (cash dividend / توزيع) should not go here — they book to your investment ledger on{' '}
                {setActivePage || triggerPageAction ? (
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => {
                      if (triggerPageAction) {
                        triggerPageAction('Investments', 'focus-dividend-sms');
                      } else {
                        setActivePage?.('Dividend Tracker');
                      }
                    }}
                  >
                    Dividend Tracker → Import from SMS
                  </button>
                ) : (
                  <strong>Dividend Tracker → Import from SMS</strong>
                )}
                .
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2" htmlFor="sms-account-select">
                  Default / fallback account (optional)
                </label>
                <select
                  id="sms-account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  aria-label="Optional fallback account for SMS transactions"
                >
                  <option value="">Auto-detect from card last 4…</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                      {acc.lastFourDigits || acc.platformDetails?.cardLast4
                        ? ` (••••${acc.lastFourDigits || acc.platformDetails?.cardLast4})`
                        : ''}
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="mt-1 text-sm text-amber-700">Add bank accounts in Settings or Accounts first.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  Rows route automatically when each account’s <strong>Card / account last 4</strong> matches the SMS (بطاقة / عبر / من). Use this fallback only when a message has no card digits or the card is not configured. You can still change the account per row in review.
                </p>
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
                disabled={!smsText.trim() || isProcessingFile}
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
          onClose={dismissReviewModal}
          title="Review Extracted Transactions"
          maxWidthClass="max-w-6xl"
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
                      {duplicateTransactions.size} potential duplicate(s) — unchecked by default; tick a row to import anyway
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
            {activeTab === 'trading' && tradingParseDebug && (
              <details className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                <summary className="text-sm font-semibold text-indigo-800 cursor-pointer">
                  Parser diagnostics (for troubleshooting)
                </summary>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-indigo-900">
                  <div>Detected file type: {tradingParseDebug.fileType}</div>
                  <div>Extracted text length: {tradingParseDebug.extractedTextLength}</div>
                  <div>Structured matches: {tradingParseDebug.parserMatches.structured}</div>
                  <div>Awaed-table matches: {tradingParseDebug.parserMatches.awaedTable}</div>
                  <div>Token-stream matches: {tradingParseDebug.parserMatches.tokenStream}</div>
                  <div>Global-pattern matches: {tradingParseDebug.parserMatches.globalPattern}</div>
                  <div>Heuristic matches: {tradingParseDebug.parserMatches.heuristic}</div>
                  <div>AI matches: {tradingParseDebug.parserMatches.ai}</div>
                  <div className="md:col-span-3">Final deduped rows: {tradingParseDebug.parserMatches.totalDeduped}</div>
                  <div className="md:col-span-3">
                    <p className="font-medium mb-1">Extracted text preview:</p>
                    <p className="rounded border border-indigo-200 bg-white p-2 break-words">
                      {tradingParseDebug.sampleText || 'No text preview available'}
                    </p>
                  </div>
                </div>
              </details>
            )}

            {importResultMessage && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">{importResultMessage}</p>
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
                  disabled={isImporting || (processingProgress > 0 && processingProgress < 100)}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  disabled={isImporting || (processingProgress > 0 && processingProgress < 100)}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Budget</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {extractedTransactions.map((tx, index) => {
                        const isDuplicate = duplicateTransactions.has(index);
                        const isSelected = selectedTransactions.has(index);
                        const cardLast4 = parseSmsCardLast4FromNote(tx.note);
                        const rowAccount = bankAccounts.find((a) => a.id === tx.accountId);
                        const rowCurrency = rowAccount?.currency === 'USD' ? 'USD' : selectedAccountCurrency;
                        const budgetSelectOptions = budgetCategoriesForTransactionDate(tx.date);
                        const isAtmRow = isSmsAtmWithdrawalTx(tx) && Number(tx.amount) < 0;
                        const isCcPayRow = isSmsCcPaymentTx(tx);
                        const isAcctXferRow = isSmsAccountTransferTx(tx);
                        const isTransferRow = isAtmRow || isCcPayRow || isAcctXferRow;
                        const atmCashTo = parseSmsAtmCashToFromNote(tx.note);
                        const ccFundedFrom = parseSmsCcFundedFromNote(tx.note);
                        const acctXferTo = parseSmsAccountTransferToFromNote(tx.note);
                        const acctXferDestLast4 = parseSmsTransferDestLast4FromNote(tx.note);
                        const cashChoicesForRow = physicalCashAccountChoices.filter(
                          (a) => a.id !== String(tx.accountId || '').trim(),
                        );
                        const fundingChoicesForRow = ccFundingAccountChoices.filter(
                          (a) => a.id !== String(tx.accountId || '').trim(),
                        );
                        const acctXferChoicesForRow = accountTransferDestinationChoices.filter(
                          (a) => a.id !== String(tx.accountId || '').trim(),
                        );
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
                                className="rounded border-slate-300 text-primary focus:ring-primary"
                                title={isDuplicate ? 'Duplicate — tick to import anyway' : undefined}
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900 min-w-[140px]">
                              <input
                                type="date"
                                value={String(tx.date || '').slice(0, 10)}
                                onChange={(e) =>
                                  handleExtractedTransactionEdit(index, {
                                    date: e.target.value || tx.date,
                                  })
                                }
                                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                aria-label={`Date for ${tx.description}`}
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <div>{tx.description}</div>
                              {cardLast4 && (
                                <div className="text-xs text-slate-500 mt-0.5">Card ••••{cardLast4}</div>
                              )}
                              {isAtmRow && (
                                <div className="text-xs text-sky-700 mt-0.5">ATM → cash transfer (no budget)</div>
                              )}
                              {isCcPayRow && (
                                <div className="text-xs text-sky-700 mt-0.5">Card payment → transfer (no budget)</div>
                              )}
                              {isAcctXferRow && (
                                <div className="text-xs text-sky-700 mt-0.5">
                                  {acctXferTo
                                    ? 'Account transfer (حوالة) — no budget'
                                    : acctXferDestLast4
                                      ? `حوالة to ••••${acctXferDestLast4} — pick Transfer to if that is your account`
                                      : 'حوالة — pick Transfer to for between-account import, or leave blank for external'}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 min-w-[160px]">
                              <select
                                value={tx.accountId || ''}
                                onChange={(e) => {
                                  const nextSource = e.target.value;
                                  if (isAtmRow) {
                                    const prevCash = parseSmsAtmCashToFromNote(tx.note);
                                    const cashTo =
                                      prevCash && prevCash !== nextSource
                                        ? prevCash
                                        : physicalCashAccountChoices.find((a) => a.id !== nextSource)?.id ?? null;
                                    handleExtractedTransactionEdit(index, {
                                      accountId: nextSource,
                                      note: smsNoteWithAtmMeta(tx.note, {
                                        kind: 'atm',
                                        cashToAccountId: cashTo,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    });
                                    return;
                                  }
                                  if (isCcPayRow) {
                                    const prevFunding = parseSmsCcFundedFromNote(tx.note);
                                    const fundedFrom =
                                      prevFunding && prevFunding !== nextSource
                                        ? prevFunding
                                        : ccFundingAccountChoices.find((a) => a.id !== nextSource)?.id ?? null;
                                    handleExtractedTransactionEdit(index, {
                                      accountId: nextSource,
                                      note: smsNoteWithCcPaymentMeta(tx.note, {
                                        fundedFromAccountId: fundedFrom,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    });
                                    return;
                                  }
                                  if (isAcctXferRow) {
                                    const prevTo = parseSmsAccountTransferToFromNote(tx.note);
                                    const transferTo =
                                      prevTo && prevTo !== nextSource ? prevTo : null;
                                    handleExtractedTransactionEdit(index, {
                                      accountId: nextSource,
                                      note: smsNoteWithAccountTransferMeta(tx.note, {
                                        transferToAccountId: transferTo,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    });
                                    return;
                                  }
                                  handleExtractedTransactionEdit(index, { accountId: nextSource });
                                }}
                                className={`w-full rounded-md border px-2 py-1 text-sm ${
                                  tx.accountId ? 'border-slate-300' : 'border-amber-400 bg-amber-50'
                                }`}
                                aria-label={`Account for ${tx.description}`}
                              >
                                <option value="">Select account…</option>
                                {bankAccounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.name}
                                    {acc.lastFourDigits || acc.platformDetails?.cardLast4
                                      ? ` (••••${acc.lastFourDigits || acc.platformDetails?.cardLast4})`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                              {isAtmRow && (
                                <select
                                  value={atmCashTo || ''}
                                  onChange={(e) =>
                                    handleExtractedTransactionEdit(index, {
                                      note: smsNoteWithAtmMeta(tx.note, {
                                        kind: 'atm',
                                        cashToAccountId: e.target.value || null,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    })
                                  }
                                  className={`mt-1 w-full rounded-md border px-2 py-1 text-sm ${
                                    atmCashTo && atmCashTo !== tx.accountId
                                      ? 'border-slate-300'
                                      : 'border-amber-400 bg-amber-50'
                                  }`}
                                  aria-label={`Cash destination for ${tx.description}`}
                                >
                                  <option value="">Cash account…</option>
                                  {cashChoicesForRow.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      → {acc.name}
                                      {acc.accountRole === 'physical_cash' ? ' (wallet)' : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {isCcPayRow && (
                                <select
                                  value={ccFundedFrom || ''}
                                  onChange={(e) =>
                                    handleExtractedTransactionEdit(index, {
                                      note: smsNoteWithCcPaymentMeta(tx.note, {
                                        fundedFromAccountId: e.target.value || null,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    })
                                  }
                                  className={`mt-1 w-full rounded-md border px-2 py-1 text-sm ${
                                    ccFundedFrom && ccFundedFrom !== tx.accountId
                                      ? 'border-slate-300'
                                      : 'border-amber-400 bg-amber-50'
                                  }`}
                                  aria-label={`Funding account for ${tx.description}`}
                                >
                                  <option value="">Paid from…</option>
                                  {fundingChoicesForRow.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      ← {acc.name}
                                      {acc.accountRole === 'debt_servicing' || acc.accountRole === 'bills_payment'
                                        ? ' (bills)'
                                        : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {isAcctXferRow && (
                                <select
                                  value={acctXferTo || ''}
                                  onChange={(e) =>
                                    handleExtractedTransactionEdit(index, {
                                      note: smsNoteWithAccountTransferMeta(tx.note, {
                                        transferToAccountId: e.target.value || null,
                                      }),
                                      category: 'Transfer',
                                      budgetCategory: undefined,
                                    })
                                  }
                                  className={`mt-1 w-full rounded-md border px-2 py-1 text-sm ${
                                    acctXferTo && acctXferTo !== tx.accountId
                                      ? 'border-slate-300'
                                      : 'border-slate-300'
                                  }`}
                                  aria-label={`Transfer destination for ${tx.description}`}
                                >
                                  <option value="">
                                    {acctXferDestLast4
                                      ? `Transfer to… (SMS ••••${acctXferDestLast4})`
                                      : 'Transfer to… (optional)'}
                                  </option>
                                  {acctXferChoicesForRow.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      → {acc.name}
                                      {acc.lastFourDigits || acc.platformDetails?.cardLast4
                                        ? ` (••••${acc.lastFourDigits || acc.platformDetails?.cardLast4})`
                                        : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className={`px-4 py-3 text-sm text-right font-medium ${tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {tx.amount >= 0 ? '+' : '-'}
                              {formatCurrencyString(Math.abs(tx.amount), { inCurrency: rowCurrency })}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 min-w-[180px]">
                              {isTransferRow ? (
                                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-sm text-slate-700">
                                  Transfer
                                </span>
                              ) : (
                                <>
                                  <input
                                    value={tx.category || ''}
                                    onChange={(e) => handleExtractedTransactionEdit(index, { category: e.target.value })}
                                    list={`stmt-category-options-${index}`}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                    placeholder="Category"
                                  />
                                  <datalist id={`stmt-category-options-${index}`}>
                                    {transactionCategoryOptions.map((opt) => (
                                      <option key={opt} value={opt} />
                                    ))}
                                  </datalist>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 min-w-[180px]">
                              {isTransferRow ? (
                                <span className="text-xs text-slate-500">Not applicable (transfer)</span>
                              ) : (
                                <>
                                  <select
                                    value={tx.budgetCategory || ''}
                                    onChange={(e) => handleExtractedTransactionEdit(index, { budgetCategory: e.target.value || undefined })}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                  >
                                    <option value="">No budget link</option>
                                    {budgetSelectOptions.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                  {budgetSelectOptions.length === 0 && (
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      No budget cards for this transaction’s financial month. Create budgets for that month on Budgets, or leave unlinked.
                                    </p>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isDuplicate ? (
                                <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                                  {isSelected ? 'Import anyway' : 'Duplicate'}
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
                            <td className="px-4 py-3 text-sm text-slate-900 min-w-[140px]">
                              <input
                                type="date"
                                value={String(tx.date || '').slice(0, 10)}
                                onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { date: e.target.value })}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              <select
                                value={tx.type}
                                onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { type: e.target.value as InvestmentTransaction['type'] })}
                                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                              >
                                <option value="buy">BUY</option>
                                <option value="sell">SELL</option>
                                <option value="deposit">DEPOSIT</option>
                                <option value="withdrawal">WITHDRAWAL</option>
                                <option value="dividend">DIVIDEND</option>
                                <option value="fee">FEE</option>
                                <option value="vat">VAT</option>
                              </select>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-slate-900 min-w-[180px]">
                              <input
                                value={tx.symbol || ''}
                                onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { symbol: e.target.value.toUpperCase() })}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                placeholder="Symbol (e.g. AAPL)"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900 min-w-[120px]">
                              <input
                                type="number"
                                step="0.0001"
                                value={Number.isFinite(Number(tx.quantity)) ? tx.quantity : 0}
                                onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { quantity: Number(e.target.value) || 0 })}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900 min-w-[120px]">
                              <input
                                type="number"
                                step="0.0001"
                                value={Number.isFinite(Number(tx.price)) ? tx.price : 0}
                                onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { price: Number(e.target.value) || 0 })}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-slate-900 min-w-[170px]">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number.isFinite(Number(tx.total)) ? tx.total : 0}
                                  onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { total: Number(e.target.value) || 0 })}
                                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-right"
                                />
                                <select
                                  value={(tx.currency === 'USD' ? 'USD' : 'SAR') as 'USD' | 'SAR'}
                                  onChange={(e) => handleExtractedInvestmentTransactionEdit(index, { currency: e.target.value as 'USD' | 'SAR' })}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value="SAR">SAR</option>
                                  <option value="USD">USD</option>
                                </select>
                              </div>
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
                onClick={dismissReviewModal}
                disabled={isImporting || (processingProgress > 0 && processingProgress < 100)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveTransactions}
                disabled={selectedTransactions.size === 0 || processingProgress > 0 || isImporting}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingProgress > 0 || isImporting
                  ? `Importing... ${Math.round(processingProgress)}%`
                  : `Import ${selectedImportPlan?.importableCount ?? selectedTransactions.size} Transaction(s)`
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
