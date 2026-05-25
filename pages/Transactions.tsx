import React, { useMemo, useState, useContext, useEffect, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { Transaction, Account, Budget, Page, UserRole, RecurringTransaction } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import AIAdvisor from '../components/AIAdvisor';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import ExpenseBreakdownChart from '../components/charts/ExpenseBreakdownChart';
import { getAICategorySuggestion } from '../services/geminiService';
import { useAI } from '../context/AiContext';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import InfoHint from '../components/InfoHint';
import { StatementIcons } from '../constants/statementIcons';
import { supabase } from '../services/supabaseClient';
import { encodeInstallmentPaymentNote } from '../services/installments/installmentLinkNote';
import { AuthContext } from '../context/AuthContext';
import { useSelfLearning } from '../context/SelfLearningContext';
import { useConfirmAction } from '../hooks/useConfirmAction';
import {
  summarizeApplyRecurringForConfirm,
  summarizeRecurringForConfirm,
} from '../utils/recordConfirmMessages';
import { inferIsAdmin } from '../utils/role';
import {
    validateTransactionRequiredFields,
    findDuplicateTransactions,
} from '../services/dataQuality';
import {
    countsAsExpenseForCashflowKpi,
    countsAsIncomeForCashflowKpi,
    isInternalTransferTransaction,
} from '../services/transactionFilters';
import { validateSplitTotal } from '../services/transactionIntelligence';
import { encodeNoteWithSplits } from '../services/transactionSplitNote';
import { getTransactionBudgetAllocations } from '../services/transactionBudgetAllocations';
import { evaluateTransactionBudgetCoverageState } from '../services/transactionBudgetCoverage';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR, fromSAR } from '../utils/currencyMath';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { accountBookCurrency, transactionBookCurrency } from '../utils/cashAccountDisplay';
import { exportCashTransactionsToCsv } from '../services/reportingEngine';
import { computeMonthlyCashflowKpisSar } from '../services/financeTruth';
import {
    financialMonthKey,
    financialMonthRangeFromKey,
    resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { sortByNewestFirst } from '../utils/sortRecency';
import { summarizeIncomeTaxonomy } from '../services/incomeTaxonomy';
import { computeIncomeStability } from '../services/incomeStability';

/** Financial month key as YYYY-MM (aligned with Budgets storage). */
function financialMonthIso(date: Date, monthStartDay: number) {
    const key = financialMonthKey(date, monthStartDay);
    return `${key.year}-${String(key.month).padStart(2, '0')}`;
}

function startOfUtcDayFromYmd(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function endOfUtcDayFromYmd(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

/**
 * Income-specific categories. Do not include "Transfer" / "Transfers": those labels are reserved for
 * internal account moves and are excluded from cashflow KPIs (`isInternalTransferTransaction` in
 * `transactionFilters.ts`), so offering them here would suggest income that never appears in KPIs.
 */
const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Investment Income', 'Freelance', 'Rental Income', 'Other Income'];

/** Map AI/local strings onto a real category from `allowed` (exact, case-insensitive, then substring fuzzy). */
function matchToAllowedCategory(suggested: string, allowed: string[]): string | null {
    const s = String(suggested ?? '').trim();
    if (!s || allowed.length === 0) return null;
    if (allowed.includes(s)) return s;
    const lower = s.toLowerCase();
    const ci = allowed.find((a) => a.toLowerCase() === lower);
    if (ci) return ci;
    return (
        allowed.find(
            (a) => a.toLowerCase().includes(lower) || lower.includes(a.toLowerCase())
        ) ?? null
    );
}

const TransactionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (transaction: Omit<Transaction, 'id'> | Transaction) => void;
    onSaveAndTrade: (transaction: Omit<Transaction, 'id'>) => void;
    transactionToEdit: Transaction | null;
    budgetCategories: string[],
    budgets: Budget[],
    allCategories: string[],
    accounts: Account[],
    existingTransactions: Transaction[],
    sarPerUsd: number;
    monthStartDay: number;
}> = ({ isOpen, onClose, onSave, onSaveAndTrade, transactionToEdit, budgetCategories, budgets, allCategories, accounts, existingTransactions, sarPerUsd, monthStartDay }) => {
    const { data } = useContext(DataContext)!;
    const confirmAction = useConfirmAction();
    const { aiActionsEnabled } = useAI();
    const { formatCurrencyString } = useFormatCurrency();
    const { getLearnedDefault, trackFormDefault } = useSelfLearning();
    const incomeCategoryOptions = React.useMemo(
        () => [
            ...new Set([
                ...INCOME_CATEGORIES,
                ...(existingTransactions ?? [])
                    .filter((t) => countsAsIncomeForCashflowKpi(t))
                    .map((t) => t.category)
                    .filter(Boolean),
            ]),
        ],
        [existingTransactions]
    );
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState(allCategories[0] || '');
    const [subcategory, setSubcategory] = useState('');
    const [budgetCategory, setBudgetCategory] = useState(budgetCategories[0] || '');
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [accountId, setAccountId] = useState('');
    const [transactionNature, setTransactionNature] = useState<'Fixed' | 'Variable'>('Variable');
    const [expenseType, setExpenseType] = useState<'Core' | 'Discretionary'>('Core');
    const [userNote, setUserNote] = useState('');
    const [linkInstallmentId, setLinkInstallmentId] = useState<string>('');
    const [linkInstallmentOptions, setLinkInstallmentOptions] = useState<Array<{ id: string; label: string }>>([]);
    const [useSplitExpense, setUseSplitExpense] = useState(false);
    const [splitRows, setSplitRows] = useState<{ category: string; amount: string }[]>([
        { category: '', amount: '' },
        { category: '', amount: '' },
    ]);
    const [isSuggestingCategory, setIsSuggestingCategory] = useState(false);
    const [aiSuggestionNote, setAiSuggestionNote] = useState<{ tone: 'info' | 'success' | 'warning'; text: string } | null>(null);

    const suggestCategoryLocally = (rawDescription: string): string | null => {
        const normalized = rawDescription.toLowerCase();
        const keywordMap: Array<{ keywords: string[]; category: string }> = [
            { keywords: ['grocery', 'groceries', 'supermarket', 'food', 'restaurant', 'cafe', 'coffee'], category: 'Food' },
            { keywords: ['uber', 'taxi', 'fuel', 'gas', 'petrol', 'bus', 'metro', 'transport'], category: 'Transportation' },
            { keywords: ['rent', 'mortgage', 'lease', 'home'], category: 'Housing' },
            { keywords: ['electric', 'water', 'internet', 'phone', 'utility'], category: 'Utilities' },
            { keywords: ['doctor', 'clinic', 'hospital', 'pharmacy', 'medicine', 'health'], category: 'Health' },
            { keywords: ['tuition', 'school', 'course', 'education', 'book'], category: 'Education' },
            { keywords: ['movie', 'cinema', 'game', 'subscription', 'entertainment'], category: 'Entertainment' },
            { keywords: ['shopping', 'clothes', 'fashion', 'mall'], category: 'Shopping' },
            { keywords: ['investment', 'saving', 'savings'], category: 'Savings & Investments' },
        ];

        for (const row of keywordMap) {
            if (row.keywords.some((k) => normalized.includes(k))) {
                return row.category;
            }
        }

        return null;
    };


    React.useEffect(() => {
        if (transactionToEdit) {
            setDate(new Date(transactionToEdit.date).toISOString().split('T')[0]);
            setDescription(transactionToEdit.description);
            setAmount(String(Math.abs(transactionToEdit.amount)));
            setCategory(transactionToEdit.type === 'income' && !incomeCategoryOptions.includes(transactionToEdit.category)
                ? (incomeCategoryOptions[0] || 'Salary')
                : transactionToEdit.category);
            setSubcategory(transactionToEdit.subcategory || '');
            setBudgetCategory(transactionToEdit.budgetCategory || '');
            setType(transactionToEdit.type);
            setAccountId(transactionToEdit.accountId);
            setTransactionNature(transactionToEdit.transactionNature || 'Variable');
            setExpenseType(transactionToEdit.expenseType || 'Core');
            setUserNote((transactionToEdit.note || '').trim());
            setLinkInstallmentId('');
            const sl = transactionToEdit.splitLines;
            if (sl && sl.length > 0) {
                setUseSplitExpense(true);
                setSplitRows(
                    sl.map((x) => ({ category: x.category, amount: String(x.amount) })).concat({ category: '', amount: '' })
                );
            } else {
                setUseSplitExpense(false);
                setSplitRows([
                    { category: budgetCategories[0] || 'Food and Groceries', amount: '' },
                    { category: budgetCategories[1] || 'Transportation', amount: '' },
                ]);
            }
        } else {
            const learnedAccount = getLearnedDefault('transaction-add', 'accountId') as string | undefined;
            const learnedType = getLearnedDefault('transaction-add', 'type') as 'income' | 'expense' | undefined;
            const learnedCategory = getLearnedDefault('transaction-add', 'category') as string | undefined;
            const learnedBudgetCat = getLearnedDefault('transaction-add', 'budgetCategory') as string | undefined;
            const validAccount = learnedAccount && accounts.some(a => a.id === learnedAccount) ? learnedAccount : accounts[0]?.id || '';
            const validCategory = learnedCategory && allCategories.includes(learnedCategory) ? learnedCategory : allCategories[0] || 'Groceries';
            const validBudgetCat = learnedBudgetCat && budgetCategories.includes(learnedBudgetCat) ? learnedBudgetCat : budgetCategories[0] || '';
            setDate(new Date().toISOString().split('T')[0]);
            setDescription('');
            setAmount('');
            setCategory(validCategory);
            setSubcategory('');
            setBudgetCategory(validBudgetCat);
            setType(learnedType === 'income' || learnedType === 'expense' ? learnedType : 'expense');
            setAccountId(validAccount);
            setTransactionNature('Variable');
            setExpenseType('Core');
            setUserNote('');
            setLinkInstallmentId('');
            setUseSplitExpense(false);
            setSplitRows([
                { category: budgetCategories[0] || 'Food and Groceries', amount: '' },
                { category: budgetCategories[1] || 'Transportation', amount: '' },
            ]);
        }
        setAiSuggestionNote(null);
    }, [transactionToEdit, isOpen, budgetCategories, allCategories, accounts, incomeCategoryOptions, getLearnedDefault]);

    React.useEffect(() => {
        const loadInstallmentOptions = async () => {
            if (!supabase || !isOpen || transactionToEdit || type !== 'expense') {
                setLinkInstallmentOptions([]);
                return;
            }
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
            const startDay = start.toISOString().slice(0, 10);
            const endDay = end.toISOString().slice(0, 10);
            const { data: rows, error } = await supabase
                .from('installments')
                .select('id,sequence,due_date,amount_minor,status,installment_plans!inner(currency,metadata)')
                .gte('due_date', startDay)
                .lte('due_date', endDay);
            if (error) {
                setLinkInstallmentOptions([]);
                return;
            }
            const opts = (rows ?? [])
                .filter((r: any) => !['PAID', 'REFUNDED', 'CANCELLED', 'WAIVED'].includes(String(r.status ?? '').toUpperCase()))
                .map((r: any) => {
                    const plan = r.installment_plans as any;
                    const meta = plan?.metadata && typeof plan.metadata === 'object' ? plan.metadata : {};
                    const bc = String(meta?.budgetCategory ?? meta?.budget_category ?? 'Installments').trim() || 'Installments';
                    const amt = (Number(r.amount_minor) || 0) / 100;
                    const cur = plan?.currency === 'USD' ? 'USD' : 'SAR';
                    return { id: String(r.id), label: `#${Number(r.sequence)} · ${String(r.due_date)} · ${bc} · ${amt.toFixed(2)} ${cur}` };
                });
            setLinkInstallmentOptions(opts);
        };
        loadInstallmentOptions();
    }, [isOpen, transactionToEdit, type]);

    const selectedAccountCurrency = useMemo<'SAR' | 'USD'>(() => {
        const acc = accounts.find((a) => a.id === accountId);
        return acc?.currency === 'USD' ? 'USD' : 'SAR';
    }, [accounts, accountId]);

    const currentBudgetRows = useMemo(() => {
        const parsedDate = new Date(date || new Date().toISOString().slice(0, 10));
        const key = financialMonthKey(parsedDate, monthStartDay);
        return budgets.filter((b) => b.month === key.month && b.year === key.year);
    }, [budgets, date, monthStartDay]);

    const transactionFinancialMonthBounds = useMemo(() => {
        const parsedDate = new Date(date || new Date().toISOString().slice(0, 10));
        const key = financialMonthKey(parsedDate, monthStartDay);
        return financialMonthRangeFromKey(key, monthStartDay);
    }, [date, monthStartDay]);

    const remainingByCategory = useMemo(() => {
        const map = new Map<string, number>();
        currentBudgetRows.forEach((b) => map.set(b.category, Number(b.limit) || 0));
        const { start, end } = transactionFinancialMonthBounds;
        existingTransactions
            .filter(
                (t) => {
                    const d = new Date(t.date);
                    return (
                        d >= start &&
                        d <= end &&
                        countsAsExpenseForCashflowKpi(t) &&
                        (t.status ?? 'Approved') === 'Approved' &&
                        t.id !== transactionToEdit?.id
                    );
                },
            )
            .forEach((t) => {
                const acc = accounts.find((a) => a.id === t.accountId);
                const txCur = acc?.currency === 'USD' ? 'USD' : 'SAR';
                const allocations = getTransactionBudgetAllocations(t);
                allocations.forEach((allocation) => {
                    const usedInSar = toSAR(Math.abs(Number(allocation.amount) || 0), txCur, sarPerUsd);
                    const current = map.get(allocation.category);
                    if (current == null) return;
                    map.set(allocation.category, current - usedInSar);
                });
            });
        return map;
    }, [accounts, currentBudgetRows, existingTransactions, sarPerUsd, transactionToEdit?.id, transactionFinancialMonthBounds]);

    const inputAmountSar = useMemo(() => {
        const abs = Math.abs(Number(amount) || 0);
        return toSAR(abs, selectedAccountCurrency, sarPerUsd);
    }, [amount, selectedAccountCurrency, sarPerUsd]);

    const splitCoverage = useMemo(() => {
        if (type !== 'expense') return [];
        const parsedLines = splitRows
            .map((row) => {
                const raw = Math.abs(Number(row.amount) || 0);
                const amountSar = toSAR(raw, selectedAccountCurrency, sarPerUsd);
                return {
                    category: String(row.category || '').trim(),
                    amountSar,
                };
            })
            .filter((row) => row.category && row.amountSar > 0);
        if (parsedLines.length === 0) {
            const cat = String(budgetCategory || '').trim();
            const entry = currentBudgetRows.find((b) => b.category === cat);
            return cat
                ? [{
                    category: cat,
                    amountSar: inputAmountSar,
                    remainingSar: remainingByCategory.get(cat) ?? 0,
                    shortfallSar: Math.max(0, inputAmountSar - (remainingByCategory.get(cat) ?? 0)),
                    limitSar: entry ? Number(entry.limit) || 0 : 0,
                }]
                : [];
        }
        return parsedLines.map((line) => {
            const remainingSar = remainingByCategory.get(line.category) ?? 0;
            const entry = currentBudgetRows.find((b) => b.category === line.category);
            return {
                category: line.category,
                amountSar: line.amountSar,
                remainingSar,
                shortfallSar: Math.max(0, line.amountSar - remainingSar),
                limitSar: entry ? Number(entry.limit) || 0 : 0,
            };
        });
    }, [type, splitRows, selectedAccountCurrency, sarPerUsd, budgetCategory, inputAmountSar, remainingByCategory, currentBudgetRows]);

    const splitCoverageRows = useMemo(
        () =>
            splitRows.map((row, index) => {
                const category = String(row.category || '').trim();
                const entry = currentBudgetRows.find((b) => b.category === category);
                const remainingSar = remainingByCategory.get(category) ?? 0;
                const rawAmount = Math.abs(Number(row.amount) || 0);
                const amountSar = toSAR(rawAmount, selectedAccountCurrency, sarPerUsd);
                const shortfall = Math.max(0, amountSar - remainingSar);
                return {
                    index,
                    category,
                    entry,
                    amountSar,
                    remainingSar,
                    shortfall,
                    remainingLabel: formatCurrencyString(Math.max(0, remainingSar), { inCurrency: 'SAR' }),
                    shortfallLabel: formatCurrencyString(shortfall, { inCurrency: 'SAR' }),
                };
            }),
        [splitRows, currentBudgetRows, remainingByCategory, selectedAccountCurrency, sarPerUsd, formatCurrencyString],
    );

    const budgetCoverageSummary = useMemo(() => {
        if (type !== 'expense') return null;
        const cat = String(budgetCategory || '').trim();
        if (!cat) return null;
        const entry = currentBudgetRows.find((b) => b.category === cat);
        const limitSar = entry ? Number(entry.limit) || 0 : 0;
        const remainingSar = remainingByCategory.get(cat) ?? limitSar;
        const spentSar = Math.max(0, limitSar - remainingSar);
        const shortfallSar = Math.max(0, inputAmountSar - remainingSar);
        return {
            category: cat,
            limitSar,
            spentSar,
            remainingSar,
            shortfallSar,
            limitLabel: formatCurrencyString(limitSar, { inCurrency: 'SAR' }),
            spentLabel: formatCurrencyString(spentSar, { inCurrency: 'SAR' }),
            remainingLabel: formatCurrencyString(Math.max(0, remainingSar), { inCurrency: 'SAR' }),
            shortfallLabel: formatCurrencyString(shortfallSar, { inCurrency: 'SAR' }),
        };
    }, [type, budgetCategory, currentBudgetRows, remainingByCategory, inputAmountSar, formatCurrencyString]);
    const selectedBudgetOverview = budgetCoverageSummary
        ? {
            category: budgetCoverageSummary.category,
            remainingSar: budgetCoverageSummary.remainingSar,
        }
        : null;
    const budgetCoverageState = useMemo(
        () =>
            evaluateTransactionBudgetCoverageState({
                transactionType: type,
                hasAmount: Boolean(String(amount || '').trim()),
                budgetCategory,
                useSplitExpense,
                splitCoverage,
                budgetCoverageSummary: budgetCoverageSummary
                    ? { limitSar: budgetCoverageSummary.limitSar, remainingSar: budgetCoverageSummary.remainingSar }
                    : null,
                inputAmountSar,
            }),
        [type, amount, budgetCategory, splitCoverage, useSplitExpense, budgetCoverageSummary, inputAmountSar],
    );
    const splitCoverageError = useMemo(() => {
        if (!useSplitExpense) return '';
        const missing = splitRows.some((row) => String(row.category || '').trim() === '');
        if (missing) return 'Each split line needs a budget category.';
        const invalid = splitRows.some((row) => String(row.amount || '').trim() !== '' && !(Number(row.amount) > 0));
        if (invalid) return 'Each split line amount must be a positive number.';
        return '';
    }, [splitRows, useSplitExpense]);
    const buildTransactionData = (): Omit<Transaction, 'id'> | null => {
        const absAmt = Math.abs(parseFloat(amount));
        let noteOut: string | undefined = userNote.trim() || undefined;
        if (type === 'income') {
            noteOut = userNote.trim() || undefined;
        } else if (type === 'expense' && useSplitExpense) {
            const lines = splitRows
                .map((r) => ({
                    category: r.category.trim() || 'Uncategorized',
                    amount: parseFloat(r.amount),
                }))
                .filter((r) => Number.isFinite(r.amount) && r.amount > 0);
            if (lines.length < 2) {
                window.alert('Split expense: add at least two lines with amounts.');
                return null;
            }
            const v = validateSplitTotal(absAmt, lines);
            if (!v.ok) {
                window.alert(v.message);
                return null;
            }
            noteOut = encodeNoteWithSplits(userNote, lines);
        } else if (type === 'expense') {
            noteOut = userNote.trim() || undefined;
        }
        if (type === 'expense' && linkInstallmentId) {
            noteOut = encodeInstallmentPaymentNote(noteOut, linkInstallmentId);
        }
        return {
            date,
            description,
            amount: type === 'expense' ? -absAmt : absAmt,
            category,
            subcategory: subcategory || undefined,
            budgetCategory: type === 'expense' ? budgetCategory : undefined,
            type,
            accountId,
            transactionNature: type === 'expense' ? transactionNature : undefined,
            expenseType: type === 'expense' ? expenseType : undefined,
            note: noteOut,
        };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const transactionData = buildTransactionData();
        if (!transactionData) return;

        const validation = validateTransactionRequiredFields({
            date: transactionData.date,
            description: transactionData.description,
            amount: transactionData.amount,
            accountId: transactionData.accountId,
            type: transactionData.type,
            category: transactionData.category,
        });
        if (!validation.valid) {
            window.alert(validation.errors.join('\n'));
            return;
        }

        const dupOpts = {
            excludeId: transactionToEdit?.id,
            dateToleranceDays: 2,
            requireSameAccount: true,
        };
        const dups = findDuplicateTransactions(
            {
                date: transactionData.date,
                amount: transactionData.amount,
                description: transactionData.description,
                accountId: transactionData.accountId,
                type: transactionData.type,
            },
            existingTransactions,
            dupOpts
        );
        if (dups.length > 0) {
            const sample = dups[0];
            const sampleDate = new Date(sample.date).toLocaleDateString();
            const dupOk = await confirmAction({
                title: 'Possible duplicate',
                message:
                    `A similar transaction already exists (${sampleDate} · ${sample.description.slice(0, 60)}). Save anyway?`,
                confirmLabel: 'Save anyway',
                variant: 'danger',
            });
            if (!dupOk) return;
        }
        if (type === 'expense' && useSplitExpense && splitCoverageError) {
            window.alert(splitCoverageError);
            return;
        }

        const acc = accounts.find((a) => a.id === accountId);
        const confirmOk = await confirmAction({
            title: transactionToEdit ? 'Save transaction?' : 'Add transaction?',
            message: transactionToEdit
                ? 'Update this transaction in your ledger?'
                : 'Add this transaction to your ledger?',
            confirmLabel: transactionToEdit ? 'Save' : 'Add',
            details: [
                `Date: ${transactionData.date}`,
                `Description: ${transactionData.description}`,
                `Amount: ${transactionData.amount} (${transactionData.type})`,
                acc ? `Account: ${acc.name}` : '',
                transactionData.budgetCategory ? `Budget: ${transactionData.budgetCategory}` : '',
            ].filter(Boolean),
        });
        if (!confirmOk) return;

        try {
            if (type === 'expense' && budgetCategory === 'Savings & Investments') {
                await onSaveAndTrade(transactionData);
            } else if (transactionToEdit) {
                await onSave({ ...transactionData, id: transactionToEdit.id });
            } else {
                await onSave(transactionData);
            }
            if (!transactionToEdit) {
                trackFormDefault('transaction-add', 'accountId', accountId);
                trackFormDefault('transaction-add', 'type', type);
                trackFormDefault('transaction-add', 'category', category);
                trackFormDefault('transaction-add', 'budgetCategory', budgetCategory);
            }
            onClose();
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    /** Budget select only lists `budgetCategories`; never set state to a value not in that list. */
    const applyBudgetForSuggestedCategory = (suggestedCat: string) => {
        if (budgetCategories.length === 0) {
            setBudgetCategory('');
            return;
        }
        if (budgetCategories.includes(suggestedCat)) {
            setBudgetCategory(suggestedCat);
            return;
        }
        const matching = budgetCategories.find(
            (bc) =>
                bc.toLowerCase().includes(suggestedCat.toLowerCase()) ||
                suggestedCat.toLowerCase().includes(bc.toLowerCase())
        );
        if (matching) setBudgetCategory(matching);
    };

    const handleSuggestCategory = async () => {
        if (!description) return;
        setIsSuggestingCategory(true);
        setAiSuggestionNote(null);
        try {
            const categoriesToUse = budgetCategories.length > 0 ? budgetCategories : allCategories;
            if (!aiActionsEnabled) {
                const fallback = suggestCategoryLocally(description);
                const matched = fallback ? matchToAllowedCategory(fallback, allCategories) : null;
                if (matched) {
                    setCategory(matched);
                    applyBudgetForSuggestedCategory(matched);
                    setAiSuggestionNote({ tone: 'warning', text: `AI proxy off — smart fallback: ${matched}` });
                } else {
                    setAiSuggestionNote({ tone: 'info', text: 'AI unavailable. Pick a category from the list.' });
                }
                return;
            }
            const suggested = await getAICategorySuggestion(description, categoriesToUse, {
                data,
                amount: Math.abs(Number(amount) || 0),
                date,
                type,
            });
            if (suggested && categoriesToUse.includes(suggested)) {
                setCategory(suggested);
                applyBudgetForSuggestedCategory(suggested);
                setAiSuggestionNote({ tone: 'success', text: `Category suggested: ${suggested}` });
            } else if (suggested) {
                const matched =
                    matchToAllowedCategory(suggested, categoriesToUse) ??
                    matchToAllowedCategory(suggested, allCategories);
                if (matched) {
                    setCategory(matched);
                    applyBudgetForSuggestedCategory(matched);
                    const relabel =
                        matched !== suggested.trim()
                            ? `Category suggested: ${matched} (matched from “${suggested.trim()}”)`
                            : `Category suggested: ${matched}`;
                    setAiSuggestionNote({ tone: 'success', text: relabel });
                } else {
                    setAiSuggestionNote({
                        tone: 'warning',
                        text: `AI suggested “${String(suggested).trim()}”, which doesn’t match your categories. Pick one from the list.`,
                    });
                }
            } else {
                const fallback = suggestCategoryLocally(description);
                const matched = fallback ? matchToAllowedCategory(fallback, allCategories) : null;
                if (matched) {
                    setCategory(matched);
                    applyBudgetForSuggestedCategory(matched);
                    setAiSuggestionNote({ tone: 'warning', text: `AI unavailable, applied smart fallback: ${matched}` });
                } else {
                    setAiSuggestionNote({ tone: 'info', text: 'No suggestion available. You can continue with your selected category.' });
                }
            }
        } catch (e) {
            console.error("Category suggestion failed", e);
            const fallback = suggestCategoryLocally(description);
            const matched = fallback ? matchToAllowedCategory(fallback, allCategories) : null;
            if (matched) {
                setCategory(matched);
                applyBudgetForSuggestedCategory(matched);
                setAiSuggestionNote({ tone: 'warning', text: `AI timeout/unavailable. Smart fallback applied: ${matched}` });
            } else {
                setAiSuggestionNote({ tone: 'warning', text: 'AI timeout/unavailable. Please continue manually.' });
            }
        } finally {
            setIsSuggestingCategory(false);
        }
    };

    const handleSuggestCategoryRef = React.useRef(handleSuggestCategory);
    handleSuggestCategoryRef.current = handleSuggestCategory;

    // Auto-suggest when adding new expense: debounced on description (5+ chars)
    React.useEffect(() => {
        if (!isOpen || transactionToEdit || type !== 'expense' || !description?.trim() || description.trim().length < 5) return;
        const t = window.setTimeout(() => handleSuggestCategoryRef.current(), 700);
        return () => clearTimeout(t);
    }, [description, type, isOpen, transactionToEdit, aiActionsEnabled]);

    const isInvestmentTransfer = type === 'expense' && budgetCategory === 'Savings & Investments';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={transactionToEdit ? 'Edit Transaction' : 'Add Transaction'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Date <InfoHint text="Transaction date; used for monthly reports and budget tracking." hintId="transaction-date" hintPage="Transactions" /></label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                        Amount{' '}
                        <InfoHint text="Enter a positive number in this account’s currency (SAR or USD—same as the account balance). Stored as + for income and − for expense. Transfers use one expense and one income leg and are excluded from Income/Expense KPIs when labeled Transfer/Transfers." hintId="transaction-amount" hintPage="Transactions" />
                    </label>
                        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-2 border border-gray-300 rounded-md"/>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Description <InfoHint text="Short description for the transaction; AI can suggest category from this." hintId="transaction-description" hintPage="Transactions" /></label>
                    <input type="text" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Account <InfoHint text="The cash or credit account this transaction affects." /></label>
                    <select id="account" value={accountId} onChange={e => setAccountId(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                        <option value="" disabled>Select an Account</option>
                        {accounts.filter(a => a.type !== 'Investment').map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                </div>
                <div className="flex space-x-4">
                    <label className="flex items-center"><input type="radio" value="expense" checked={type === 'expense'} onChange={() => { setType('expense'); setCategory(allCategories[0] || 'Groceries'); }} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Expense</span></label>
                    <label className="flex items-center"><input type="radio" value="income" checked={type === 'income'} onChange={() => { setType('income'); setCategory(incomeCategoryOptions[0] || 'Salary'); }} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Income</span></label>
                </div>
                {type === 'income' && (
                    <div>
                        <label htmlFor="income-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select id="income-category" value={incomeCategoryOptions.includes(category) ? category : (incomeCategoryOptions[0] || 'Salary')} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                            {incomeCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                )}
                 {type === 'expense' && (
                     <div className="space-y-4 border-t pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="category" className="block text-sm font-medium text-gray-700 flex items-center">Category <InfoHint text="Spending category; use AI suggest (sparkle) to auto-fill from description." hintId="transaction-category" hintPage="Transactions" /></label>
                                <div className="relative">
                                    <input list="categories" id="category-input" value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md pr-10"/>
                                    <datalist id="categories">{allCategories.map(c => <option key={c} value={c} />)}</datalist>
                                    <button type="button" onClick={handleSuggestCategory} disabled={!description || isSuggestingCategory} className="absolute inset-y-0 right-0 flex items-center pr-3 disabled:opacity-50" title="Suggest Category with AI">
                                        {isSuggestingCategory ? <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <SparklesIcon className="h-5 w-5 text-primary hover:text-secondary" />}
                                    </button>
                                </div>
                                {aiSuggestionNote && (
                                    <p className={`mt-1 text-xs ${aiSuggestionNote.tone === 'success' ? 'text-emerald-700' : aiSuggestionNote.tone === 'warning' ? 'text-amber-700' : 'text-slate-600'}`}>
                                        {aiSuggestionNote.text}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="subcategory" className="block text-sm font-medium text-gray-700 flex items-center">Subcategory (Optional) <InfoHint text="Optional finer grouping (e.g. Groceries → Supermarket)." /></label>
                                <input type="text" id="subcategory" value={subcategory} onChange={e => setSubcategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="budget-category" className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Map to Budget <InfoHint text="Links this expense to a budget category so spending is tracked against limits." /></label>
                            <select
                                id="budget-category"
                                value={budgetCategory}
                                onChange={(e) => setBudgetCategory(e.target.value)}
                                required={budgetCategories.length > 0}
                                className="w-full p-2 border border-gray-300 rounded-md"
                            >
                                <option value="">
                                    {budgetCategories.length > 0 ? 'Select budget category' : '— No budget categories —'}
                                </option>
                                {budgetCategories.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                            {!useSplitExpense && budgetCoverageSummary && (
                                <div
                                    className={`rounded-md border p-2 text-xs ${
                                        budgetCoverageSummary.remainingSar - inputAmountSar <= 0
                                            ? 'border-rose-300 bg-rose-50 text-rose-900'
                                            : (budgetCoverageSummary.limitSar > 0 &&
                                                  (budgetCoverageSummary.limitSar - (budgetCoverageSummary.remainingSar - inputAmountSar)) / budgetCoverageSummary.limitSar >= 0.9)
                                              ? 'border-amber-300 bg-amber-50 text-amber-900'
                                              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                    }`}
                                >
                                    <div className="font-semibold">
                                        Budget limit {budgetCoverageSummary.shortfallSar > 0 ? 'exceeded' : 'ok'} for this amount
                                    </div>
                                    <div>
                                        Limit {budgetCoverageSummary.limitLabel} • Spent {budgetCoverageSummary.spentLabel} • Remaining {budgetCoverageSummary.remainingLabel}
                                    </div>
                                    {budgetCoverageSummary.shortfallSar > 0 && (
                                        <div className="mt-1">
                                            Over by {budgetCoverageSummary.shortfallLabel}. You can still save; spending will show as over budget.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        {type === 'expense' && (
                            <div
                                className={`rounded-lg border p-3 text-sm ${
                                    budgetCoverageState.tone === 'red'
                                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                                        : budgetCoverageState.tone === 'yellow'
                                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                                          : budgetCoverageState.tone === 'green'
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                            : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-medium">Budget limit check</p>
                                    {selectedBudgetOverview && (
                                        <p className="text-xs">
                                            {selectedBudgetOverview.category}: {formatCurrencyString(Math.max(0, selectedBudgetOverview.remainingSar), { inCurrency: 'SAR' })} remaining
                                        </p>
                                    )}
                                </div>
                                <p className="mt-1">
                                    {budgetCoverageState.summary}
                                </p>
                                {budgetCoverageState.shortfalls.length > 0 && (
                                    <ul className="mt-2 list-disc list-inside text-xs space-y-1">
                                        {budgetCoverageState.shortfalls.map((row, idx) => (
                                            <li key={`${row.category}-${idx}`}>
                                                {row.category}: short by {formatCurrencyString(row.shortfallSar, { inCurrency: 'SAR' })}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Nature <InfoHint text="Fixed: recurring (rent). Variable: changes each month (groceries)." /></label>
                                <select value={transactionNature} onChange={e => setTransactionNature(e.target.value as any)} className="w-full p-2 border border-gray-300 rounded-md">
                                    <option value="Variable">Variable Nature</option>
                                    <option value="Fixed">Fixed Nature</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Core: essentials. Discretionary: optional spending for analytics." /></label>
                                <select value={expenseType} onChange={e => setExpenseType(e.target.value as any)} className="w-full p-2 border border-gray-300 rounded-md">
                                    <option value="Core">Core Expense</option>
                                    <option value="Discretionary">Discretionary Expense</option>
                                </select>
                            </div>
                        </div>
                        <div className="border border-dashed border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50/80">
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useSplitExpense}
                                    onChange={(e) => setUseSplitExpense(e.target.checked)}
                                    className="rounded border-slate-300"
                                />
                                Split across budget categories
                            </label>
                            {useSplitExpense && (
                                <>
                                    <p className="text-xs text-slate-500">
                                        Line amounts must sum to the expense total. Over-budget lines show a warning but can still be saved.
                                    </p>
                                    {splitCoverageError && (
                                        <p className="text-xs text-rose-700 font-medium">
                                            {splitCoverageError}
                                        </p>
                                    )}
                                    {splitRows.map((row, i) => (
                                        <div key={i} className="flex gap-2 flex-wrap items-end">
                                            <select
                                                value={row.category}
                                                onChange={(e) => {
                                                    const next = [...splitRows];
                                                    next[i] = { ...next[i], category: e.target.value };
                                                    setSplitRows(next);
                                                }}
                                                className="flex-1 min-w-[140px] p-2 border rounded-md text-sm"
                                            >
                                                {budgetCategories.map((c) => (
                                                    <option key={c} value={c}>
                                                        {c}
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                min="0.01"
                                                step="0.01"
                                                placeholder="Amount"
                                                value={row.amount}
                                                onChange={(e) => {
                                                    const next = [...splitRows];
                                                    next[i] = { ...next[i], amount: e.target.value };
                                                    setSplitRows(next);
                                                }}
                                                className="w-28 p-2 border rounded-md text-sm"
                                            />
                                            <div className="min-w-[220px] text-[11px] text-slate-600">
                                                {(() => {
                                                    const cover = splitCoverageRows.find((x) => x.index === i);
                                                    if (!cover || !cover.category) return 'Select budget + amount';
                                                    if (!cover.entry) return 'Budget category not found for current month';
                                                    if (!(cover.amountSar > 0)) {
                                                        return `Remaining ${cover.remainingLabel}`;
                                                    }
                                                    return cover.shortfall > 0
                                                        ? `Remaining ${cover.remainingLabel} • short ${cover.shortfallLabel}`
                                                        : `Remaining ${cover.remainingLabel} • covers line`;
                                                })()}
                                            </div>
                                            {splitRows.length > 2 && (
                                                <button
                                                    type="button"
                                                    className="text-xs text-red-600 px-2"
                                                    onClick={() => setSplitRows(splitRows.filter((_, j) => j !== i))}
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="text-sm text-primary font-medium"
                                        onClick={() => setSplitRows([...splitRows, { category: budgetCategories[0] || '', amount: '' }])}
                                    >
                                        + Add split line
                                    </button>
                                </>
                            )}
                            {!useSplitExpense && budgetCoverageSummary?.shortfallSar && budgetCoverageSummary.shortfallSar > 0.0001 && (
                                <button
                                    type="button"
                                    className="text-sm text-primary font-medium"
                                    onClick={() => {
                                        const firstCat = String(budgetCategory || '').trim() || (budgetCategories[0] || '');
                                        const firstRemainingSar = Math.max(0, remainingByCategory.get(firstCat) ?? 0);
                                        const firstAmountInAccountCur = selectedAccountCurrency === 'SAR'
                                            ? firstRemainingSar
                                            : fromSAR(firstRemainingSar, selectedAccountCurrency, sarPerUsd);
                                        const secondAmount = Math.max(0, Math.abs(Number(amount) || 0) - firstAmountInAccountCur);
                                        const fallbackSecond = budgetCategories.find((c) => c !== firstCat) || firstCat;
                                        setUseSplitExpense(true);
                                        setSplitRows([
                                            { category: firstCat, amount: firstAmountInAccountCur > 0 ? firstAmountInAccountCur.toFixed(2) : '' },
                                            { category: fallbackSecond, amount: secondAmount > 0 ? secondAmount.toFixed(2) : '' },
                                        ]);
                                    }}
                                >
                                    Auto-split by remaining budget
                                </button>
                            )}
                        </div>
                    </div>
                 )}
                {(type === 'income' || (type === 'expense' && !useSplitExpense)) && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Memo (optional)</label>
                        <textarea
                            value={userNote}
                            onChange={(e) => setUserNote(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1"
                            placeholder="Private notes"
                        />
                    </div>
                )}
                {type === 'expense' && !useSplitExpense && linkInstallmentOptions.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Link to installment (prevents double counting)</label>
                        <select
                            value={linkInstallmentId}
                            onChange={(e) => setLinkInstallmentId(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1"
                        >
                            <option value="">Not an installment payment</option>
                            {linkInstallmentOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">
                            When linked, this payment will mark the installment as paid so Budgets won’t count it twice.
                        </p>
                    </div>
                )}
                {type === 'expense' && useSplitExpense && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Memo (optional, prepended to split record)</label>
                        <textarea
                            value={userNote}
                            onChange={(e) => setUserNote(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1"
                        />
                    </div>
                )}
                <button type="submit" className={`w-full px-4 py-2 text-white rounded-lg transition-colors ${isInvestmentTransfer ? 'bg-secondary hover:bg-violet-700' : 'bg-primary hover:bg-secondary'}`}>
                    {isInvestmentTransfer ? 'Save & Record Trade' : 'Save Transaction'}
                </button>
            </form>
        </Modal>
    );
};

const FilterButton: React.FC<{ label: string, value: string, current: string, onClick: (value: string) => void }> = ({ label, value, current, onClick }) => (
    <button onClick={() => onClick(value)} className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${current === value ? 'bg-primary text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
        {label}
    </button>
);

interface TransactionsProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
}

const RecurringModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (r: Omit<RecurringTransaction, 'id' | 'user_id'>) => void;
    recurring: RecurringTransaction | null;
    accounts: Account[];
    budgetCategories: string[];
}> = ({ isOpen, onClose, onSave, recurring, accounts, budgetCategories }) => {
    const confirmAction = useConfirmAction();
    const incomeCategoryOptions = React.useMemo(() => [...new Set([...INCOME_CATEGORIES, ...(recurring?.type === 'income' && recurring?.category && !INCOME_CATEGORIES.includes(recurring.category) ? [recurring.category] : [])])], [recurring]);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [accountId, setAccountId] = useState('');
    const [budgetCategory, setBudgetCategory] = useState('');
    const [category, setCategory] = useState('');
    const [dayOfMonth, setDayOfMonth] = useState('1');
    const [enabled, setEnabled] = useState(true);
    const [addManually, setAddManually] = useState(false);

    React.useEffect(() => {
        if (recurring) {
            setDescription(recurring.description);
            setAmount(String(recurring.amount));
            setType(recurring.type);
            setAccountId(recurring.accountId);
            setBudgetCategory(recurring.budgetCategory ?? '');
            setCategory(recurring.type === 'income' ? (incomeCategoryOptions.includes(recurring.category) ? recurring.category : (incomeCategoryOptions[0] || 'Salary')) : recurring.category);
            setDayOfMonth(String(recurring.dayOfMonth));
            setEnabled(recurring.enabled);
            setAddManually(recurring.addManually === true);
        } else {
            setDescription('');
            setAmount('');
            setType('expense');
            setAccountId(accounts[0]?.id ?? '');
            setBudgetCategory(budgetCategories[0] ?? '');
            setCategory(budgetCategories[0] ?? 'Rent');
            setDayOfMonth('1');
            setEnabled(true);
            setAddManually(false);
        }
    }, [recurring, isOpen, accounts, budgetCategories, incomeCategoryOptions]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const num = parseFloat(amount);
        const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 1));
        if (!description.trim() || !Number.isFinite(num) || num <= 0 || !accountId) {
            alert('Please fill description, positive amount, and account.');
            return;
        }
        if (type === 'expense' && budgetCategories.length && !budgetCategory) {
            alert('Please select a budget category for expenses.');
            return;
        }
        const acc = accounts.find((a) => a.id === accountId);
        const ok = await confirmAction(
            summarizeRecurringForConfirm({
                description: description.trim(),
                amount: num,
                type,
                dayOfMonth: day,
                accountName: acc?.name,
                isEdit: !!recurring,
            }),
        );
        if (!ok) return;
        onSave({
            description: description.trim(),
            amount: num,
            type,
            accountId,
            budgetCategory: type === 'expense' ? (budgetCategory || undefined) : undefined,
            category: category.trim() || description.trim(),
            dayOfMonth: day,
            enabled,
            addManually,
        });
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={recurring ? 'Edit recurring transaction' : 'Add recurring transaction'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="input-base" placeholder="e.g. Salary, Rent" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                        <select value={type} onChange={e => {
                            const next = e.target.value as 'income' | 'expense';
                            setType(next);
                            setCategory(next === 'income' ? (incomeCategoryOptions[0] || 'Salary') : (budgetCategories[0] || 'Rent'));
                        }} className="select-base">
                            <option value="income">Income</option>
                            <option value="expense">Expense</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                        <input type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="input-base" required />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
                    <select value={accountId} onChange={e => setAccountId(e.target.value)} className="select-base" required>
                        <option value="">Select account</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
                {type === 'expense' && budgetCategories.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Budget category</label>
                        <select value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} className="select-base">
                            <option value="">—</option>
                            {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                )}
                {type === 'income' ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select value={incomeCategoryOptions.includes(category) ? category : (incomeCategoryOptions[0] || 'Salary')} onChange={e => setCategory(e.target.value)} className="select-base">
                            {incomeCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category (e.g. Rent)</label>
                        <input type="text" value={category} onChange={e => setCategory(e.target.value)} className="input-base" placeholder="Rent" />
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Day of month (1–28)</label>
                    <input type="number" min={1} max={28} value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} className="input-base" />
                </div>
                <div className="flex items-center gap-2">
                    <input type="checkbox" id="recurring-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                    <label htmlFor="recurring-enabled" className="text-sm text-gray-700">Enabled (include when applying)</label>
                </div>
                <div className="flex items-center gap-2">
                    <input type="checkbox" id="recurring-add-manually" checked={addManually} onChange={e => setAddManually(e.target.checked)} />
                    <label htmlFor="recurring-add-manually" className="text-sm text-gray-700">Add manually only (do not auto-record on the day)</label>
                </div>
                <p className="text-xs text-slate-500">When unchecked, the transaction is recorded automatically on the specified day of each month.</p>
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
                    <button type="submit" className="btn-primary">{recurring ? 'Update' : 'Add'}</button>
                </div>
            </form>
        </Modal>
    );
};

const Transactions: React.FC<TransactionsProps> = ({ pageAction, clearPageAction, setActivePage, triggerPageAction }) => {
    const { data, showBlockingLoader, updateTransaction, addTransaction, deleteTransaction, addRecurringTransaction, updateRecurringTransaction, deleteRecurringTransaction, applyRecurringForMonth, applyRecurringRuleForMonth } = useContext(DataContext)!;
    const confirmAction = useConfirmAction();
    const { exchangeRate } = useCurrency();
    const { sarPerUsd } = useCanonicalFinancialMetrics();
    const recurringList = data?.recurringTransactions ?? [];
    const auth = useContext(AuthContext);
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const [userRole, setUserRole] = useState<UserRole>('Restricted');
    const [permittedBudgetCategories, setPermittedBudgetCategories] = useState<string[]>([]);
    const [sharedBudgetCategories, setSharedBudgetCategories] = useState<string[]>([]);
    const [adminPendingTransactions, setAdminPendingTransactions] = useState<any[]>([]);
    const [isPendingLoading, setIsPendingLoading] = useState(false);
    const [pendingLoadError, setPendingLoadError] = useState<string | null>(null);
    const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
    const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
    const [isBulkReviewing, setIsBulkReviewing] = useState(false);
    const [pendingBudgetEdits, setPendingBudgetEdits] = useState<Record<string, string>>({});
    const [sharedAccounts, setSharedAccounts] = useState<Account[]>([]);

    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Transaction | null>(null);
    const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
    const [recurringToEdit, setRecurringToEdit] = useState<RecurringTransaction | null>(null);
    const [applyingRecurring, setApplyingRecurring] = useState(false);
    const [applyingRecurringRuleId, setApplyingRecurringRuleId] = useState<string | null>(null);
    
    const monthStartDay = useMemo(() => resolveMonthStartDayFromData(data), [data]);

    const [filters, setFilters] = useState({ 
        accountId: 'all', 
        month: financialMonthIso(new Date(), 1),
        nature: 'all' as 'all' | 'Fixed' | 'Variable',
        expenseType: 'all' as 'all' | 'Core' | 'Discretionary',
        budgetCategory: 'all' as 'all' | string,
    });

    useEffect(() => {
        setFilters((f) => ({ ...f, month: financialMonthIso(new Date(), monthStartDay) }));
    }, [monthStartDay]);

    const defaultMonthDateBounds = useMemo(() => {
        const [y, m] = filters.month.split('-').map(Number);
        if (!Number.isFinite(y) || !Number.isFinite(m)) {
            const { start, end } = financialMonthRangeFromKey(
                financialMonthKey(new Date(), monthStartDay),
                monthStartDay,
            );
            return {
                from: start.toISOString().slice(0, 10),
                to: end.toISOString().slice(0, 10),
            };
        }
        const { start, end } = financialMonthRangeFromKey({ year: y, month: m }, monthStartDay);
        return {
            from: start.toISOString().slice(0, 10),
            to: end.toISOString().slice(0, 10),
        };
    }, [filters.month, monthStartDay]);

    const [exportAccountId, setExportAccountId] = useState<string>('all');
    const [exportDateFrom, setExportDateFrom] = useState('');
    const [exportDateTo, setExportDateTo] = useState('');

    useEffect(() => {
        setExportDateFrom(defaultMonthDateBounds.from);
        setExportDateTo(defaultMonthDateBounds.to);
    }, [defaultMonthDateBounds.from, defaultMonthDateBounds.to]);

    useEffect(() => {
        setExportAccountId(filters.accountId);
    }, [filters.accountId]);

    useEffect(() => {
        const loadGovernanceData = async () => {
            if (!supabase || !auth?.user) return;

            const { data: userRecord } = await supabase
                .from('users')
                .select('role')
                .eq('id', auth.user.id)
                .maybeSingle();

            const role = (inferIsAdmin(auth.user, userRecord?.role ?? null) ? 'Admin' : 'Restricted') as UserRole;
            setUserRole(role);

            if (role === 'Restricted') {
                const { data: permissions } = await supabase
                    .from('permissions')
                    .select('category_id, categories(name)')
                    .eq('user_id', auth.user.id);

                const allowed = (permissions || []).map((p: any) => p.categories?.name).filter(Boolean);
                setPermittedBudgetCategories(allowed);

                const { data: sharedRows } = await supabase
                    .rpc('get_shared_budgets_for_me')
                    .then((r) => r, () => ({ data: [] as any[] } as any));
                const sharedCats = Array.from(new Set(((sharedRows || []) as any[])
                    .map((row) => String(row?.category || '').trim())
                    .filter(Boolean)));
                setSharedBudgetCategories(sharedCats);
            } else {
                setPermittedBudgetCategories([]);
                setSharedBudgetCategories([]);
            }
        };

        loadGovernanceData();
    }, [auth?.user?.id]);

    useEffect(() => {
        const loadSharedAccounts = async () => {
            if (!supabase || !auth?.user?.id) {
                setSharedAccounts([]);
                return;
            }
            const { data: sharedRows } = await supabase
                .rpc('get_shared_accounts_for_me')
                .then((r) => r, () => ({ data: [] as any[] } as any));
            const mapped = ((sharedRows || []) as any[])
                .map((r) => ({
                    id: String(r.account_id ?? r.id ?? ''),
                    name: String(r.name ?? 'Shared Account'),
                    type: (() => {
                        const t = String(r.type ?? '').trim().toLowerCase();
                        if (t.includes('credit')) return 'Credit';
                        if (t.includes('invest')) return 'Investment';
                        if (t.includes('sav')) return 'Savings';
                        return 'Checking';
                    })() as Account['type'],
                    balance: Number(r.balance ?? 0),
                    owner: r.owner ?? undefined,
                }))
                .filter((a) => !!a.id);
            setSharedAccounts(mapped);
        };
        loadSharedAccounts();
    }, [auth?.user?.id]);

    const availableAccounts = useMemo(() => {
        const personal = ((data as any)?.personalAccounts ?? data?.accounts ?? []) as Account[];
        const map = new Map<string, Account>();
        personal.forEach((a) => map.set(a.id, a));
        sharedAccounts.forEach((a) => {
            if (!map.has(a.id)) map.set(a.id, a);
        });
        return Array.from(map.values());
    }, [data?.accounts, (data as any)?.personalAccounts, sharedAccounts]);

    useEffect(() => {
        const loadPendingTransactions = async () => {
            const userId = auth?.user?.id;
            if (!supabase || !userId || userRole !== 'Admin') {
                setAdminPendingTransactions([]);
                setPendingLoadError(null);
                return;
            }
            setIsPendingLoading(true);
            setPendingLoadError(null);
            const db = supabase;
            const fetchPendingRows = async (selectClause: string) => {
                return db
                    .from('transactions')
                    .select(selectClause)
                    .eq('user_id', userId)
                    .in('status', ['Pending', 'pending'])
                    .order('date', { ascending: false });
            };

            let pendingRows: any[] = [];
            let pendingError: any = null;

            const rpcResult = await db.rpc('get_pending_transactions_for_admin').then((r) => r, () => ({ data: null, error: { message: 'RPC unavailable' } } as any));
            if (!rpcResult.error && Array.isArray(rpcResult.data)) {
                pendingRows = rpcResult.data;
            } else {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const snakeCaseResult = await fetchPendingRows('id, user_id, description, amount, budget_category, date, status');
                    pendingRows = snakeCaseResult.data || [];
                    pendingError = snakeCaseResult.error;

                    if (pendingError?.code === '42703' || pendingError?.code === 'PGRST204') {
                        const camelCaseResult = await fetchPendingRows('id, user_id, description, amount, budgetCategory, date, status');
                        pendingRows = camelCaseResult.data || [];
                        pendingError = camelCaseResult.error;
                    }

                    if (!pendingError) break;
                    if (attempt < 1) {
                        await new Promise((resolve) => setTimeout(resolve, 250));
                    }
                }

                if (pendingError) {
                    console.error('Error loading admin pending transactions:', pendingError);
                    setAdminPendingTransactions([]);
                    const base = pendingError.message || 'Could not load pending transactions.';
                    const hint = /approve_pending_transaction|reject_pending_transaction|get_pending_transactions_for_admin|transactions|policy|rls/i.test(base)
                        ? ' Verify latest DB SQL migrations are applied. If RLS limits direct transaction reads, install the get_pending_transactions_for_admin RPC.'
                        : /approve_pending_transaction|reject_pending_transaction|transactions/i.test(base)
                        ? ' Verify latest DB SQL migrations are applied.'
                        : '';
                    setPendingLoadError(`${base}${hint}`);
                    setIsPendingLoading(false);
                    return;
                }
            }

            const normalized = (pendingRows || []).map((row: any) => ({
                ...row,
                budgetCategory: row.budgetCategory ?? row.budget_category ?? null,
            }));
            setAdminPendingTransactions(normalized);
            setPendingBudgetEdits((prev) => {
                const next: Record<string, string> = {};
                normalized.forEach((row: any) => {
                    next[String(row.id)] = prev[String(row.id)] ?? String(row.budgetCategory ?? '').trim();
                });
                return next;
            });
            setSelectedPendingIds((prev) => prev.filter((id) => normalized.some((row: any) => row.id === id)));
            setIsPendingLoading(false);
        };

        loadPendingTransactions();
    }, [userRole, data?.transactions, pendingRefreshKey]);

    const accountsById = useMemo(
        () => new Map<string, Account>(availableAccounts.map((a: Account) => [a.id, a])),
        [availableAccounts],
    );

    const formatCashTransactionDisplay = useCallback(
        (t: Transaction) => {
            const book = transactionBookCurrency(t, accountsById);
            return formatCurrencyString(t.amount, { inCurrency: book, showSecondary: true });
        },
        [accountsById, formatCurrencyString],
    );

    const formatRecurringDisplay = useCallback(
        (r: RecurringTransaction) => {
            const book = accountBookCurrency(accountsById.get(r.accountId));
            return formatCurrencyString(r.amount, { inCurrency: book, showSecondary: true });
        },
        [accountsById, formatCurrencyString],
    );

    const filteredTransactions = useMemo(() => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        const [year, month] = filters.month.split('-').map(Number);
        const { start: startDate, end: endDate } = Number.isFinite(year) && Number.isFinite(month)
            ? financialMonthRangeFromKey({ year, month }, monthStartDay)
            : financialMonthRangeFromKey(financialMonthKey(new Date(), monthStartDay), monthStartDay);

        const baseTransactions = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const filtered = baseTransactions.filter((t) => {
            const transactionDate = new Date(t.date);
            const isMonthMatch = transactionDate >= startDate && transactionDate <= endDate;
            const isAccountMatch = filters.accountId === 'all' || t.accountId === filters.accountId;
            const isNatureMatch = filters.nature === 'all' || t.transactionNature === filters.nature;
            const isExpenseTypeMatch = filters.expenseType === 'all' || t.expenseType === filters.expenseType;
            const txBudget = String(t.budgetCategory ?? t.category ?? '').trim();
            const isBudgetMatch = filters.budgetCategory === 'all' || txBudget === filters.budgetCategory;
            const isPermitted = userRole === 'Admin' || !txBudget || allowedRestrictedCategories.has(txBudget);
            return isMonthMatch && isAccountMatch && isNatureMatch && isExpenseTypeMatch && isBudgetMatch && isPermitted;
        });
        return sortByNewestFirst(filtered);
    }, [data?.transactions, (data as any)?.personalTransactions, filters, userRole, permittedBudgetCategories, sharedBudgetCategories, monthStartDay]);

    const filteredTransactionsForExport = useMemo(() => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        const start = exportDateFrom ? startOfUtcDayFromYmd(exportDateFrom) : null;
        const end = exportDateTo ? endOfUtcDayFromYmd(exportDateTo) : null;
        const baseTransactions = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const filtered = baseTransactions.filter((t) => {
            const transactionDate = new Date(t.date);
            const inPeriod =
                start && end ? transactionDate >= start && transactionDate <= end : false;
            const isAccountMatch = exportAccountId === 'all' || t.accountId === exportAccountId;
            const txBudget = String(t.budgetCategory ?? t.category ?? '').trim();
            const isPermitted = userRole === 'Admin' || !txBudget || allowedRestrictedCategories.has(txBudget);
            return inPeriod && isAccountMatch && isPermitted;
        });
        return sortByNewestFirst(filtered);
    }, [
        data?.transactions,
        (data as any)?.personalTransactions,
        exportAccountId,
        exportDateFrom,
        exportDateTo,
        userRole,
        permittedBudgetCategories,
        sharedBudgetCategories,
    ]);

    const handleExportFilteredCsv = useCallback(() => {
        if (!exportDateFrom || !exportDateTo) {
            alert('Choose a start and end date for export.');
            return;
        }
        const start = startOfUtcDayFromYmd(exportDateFrom);
        const end = endOfUtcDayFromYmd(exportDateTo);
        if (start > end) {
            alert('End date must be on or after start date.');
            return;
        }
        if (filteredTransactionsForExport.length === 0) {
            alert('No transactions match this account and period.');
            return;
        }
        const rows = filteredTransactionsForExport.map((t: Transaction) => ({
            id: t.id,
            date: t.date,
            description: t.description,
            amount: t.amount,
            category: t.category,
            budgetCategory: t.budgetCategory,
            subcategory: t.subcategory,
            type: t.type,
            transactionNature: t.transactionNature,
            expenseType: t.expenseType,
            status: t.status,
            accountId: t.accountId,
            accountName: accountsById.get(t.accountId)?.name ?? '',
            transferGroupId: t.transferGroupId,
            transferRole: t.transferRole,
        }));
        const csv = exportCashTransactionsToCsv(rows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const accSlug =
            exportAccountId === 'all'
                ? 'all-accounts'
                : (accountsById.get(exportAccountId)?.name ?? exportAccountId).replace(/[^\w\-]+/g, '_').slice(0, 48);
        a.href = url;
        a.download = `finova-transactions-${accSlug}-${exportDateFrom}_to_${exportDateTo}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [exportDateFrom, exportDateTo, filteredTransactionsForExport, accountsById, exportAccountId]);

    const { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown } = useMemo(() => {
        const kpis = computeMonthlyCashflowKpisSar({
            data,
            uiSarPerUsd: exchangeRate,
            accounts: availableAccounts,
            transactions: filteredTransactions as Transaction[],
        });
        return {
            monthlyIncome: kpis.incomeSar,
            monthlyExpenses: kpis.expenseSar,
            netCashflow: kpis.netSar,
            expenseBreakdown: kpis.expenseBreakdown,
        };
    }, [filteredTransactions, data, exchangeRate, availableAccounts]);
    
    const allCategories = useMemo((): string[] => Array.from(new Set(((data as any)?.personalTransactions ?? data?.transactions ?? []).map((t: { category: string }) => t.category))), [data?.transactions, (data as any)?.personalTransactions]);
    const budgetCategories = useMemo(() => {
        const ownCategories = (data?.budgets ?? []).map(b => b.category);
        if (userRole === 'Admin') return ownCategories;
        const allowedSet = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        return Array.from(new Set([...ownCategories.filter(c => allowedSet.has(c)), ...sharedBudgetCategories]));
    }, [data?.budgets, userRole, permittedBudgetCategories, sharedBudgetCategories]);

    const transactionValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const approved = filteredTransactions.filter((t: Transaction) => (t.status ?? 'Approved') === 'Approved');
        const uncategorized = approved.filter((t: Transaction) => countsAsExpenseForCashflowKpi(t) && !String(t.budgetCategory ?? t.category ?? '').trim()).length;
        if (uncategorized > 0) warnings.push(`${uncategorized} approved expense transaction(s) are missing budget category mapping.`);
        const invalidDates = approved.filter((t: Transaction) => Number.isNaN(new Date(t.date).getTime())).length;
        if (invalidDates > 0) warnings.push(`${invalidDates} transaction(s) have invalid dates.`);
        const unknownAccounts = approved.filter((t: Transaction) => !availableAccounts.some((a) => a.id === t.accountId)).length;
        if (unknownAccounts > 0) warnings.push(`${unknownAccounts} transaction(s) reference missing accounts.`);
        const invalidAmounts = approved.filter((t: Transaction) => !Number.isFinite(Number(t.amount)) || Number(t.amount) === 0).length;
        if (invalidAmounts > 0) warnings.push(`${invalidAmounts} transaction(s) have invalid/zero amount.`);
        return warnings;
    }, [filteredTransactions, availableAccounts]);

    const handleOpenTransactionModal = (transaction: Transaction | null = null) => {
        setTransactionToEdit(transaction);
        setIsTransactionModalOpen(true);
    };

    useEffect(() => {
        if (!pageAction) return;
        if (pageAction === 'open-transaction-modal') {
            handleOpenTransactionModal();
            clearPageAction?.();
            return;
        }
        if (pageAction.startsWith('filter-by-budget:')) {
            const [, rawCategory, rawPeriod, rawYear, rawMonth] = pageAction.split(':');
            const category = rawCategory || '';
            const period = String(rawPeriod || 'monthly').toLowerCase();
            const year = Number(rawYear) || new Date().getFullYear();
            const month = Math.min(12, Math.max(1, Number(rawMonth) || new Date().getMonth() + 1));
            const monthIso = period === 'yearly'
                ? `${year.toString().padStart(4, '0')}-01`
                : `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`;
            setFilters((prev) => ({
                ...prev,
                month: monthIso,
                budgetCategory: category || 'all',
            }));
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    const handleSaveTransaction = (transaction: Omit<Transaction, 'id'> | Transaction) => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        if (userRole === 'Restricted' && transaction.type === 'expense' && (!transaction.budgetCategory || !allowedRestrictedCategories.has(transaction.budgetCategory))) {
            alert('You can only submit expenses under your assigned budget categories.');
            return;
        }

        if ('id' in transaction) {
            updateTransaction(transaction, { confirmed: true });
        } else {
            const nextStatus = userRole === 'Restricted' ? 'Pending' : 'Approved';
            addTransaction({ ...transaction, status: nextStatus }, { confirmed: true });
        }
    };
    
    const handleSaveAndTrade = (transaction: Omit<Transaction, 'id'>) => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        if (userRole === 'Restricted' && (!transaction.budgetCategory || !allowedRestrictedCategories.has(transaction.budgetCategory))) {
            alert('You can only submit expenses under your assigned budget categories.');
            return;
        }
        const nextStatus = userRole === 'Restricted' ? 'Pending' : 'Approved';
        addTransaction({ ...transaction, status: nextStatus }, { confirmed: true });
        triggerPageAction('Dashboard', `open-trade-modal:with-amount:${Math.abs(transaction.amount)}`);
    };
    
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        deleteTransaction(itemToDelete.id);
        setItemToDelete(null);
    };

    const handleSaveRecurring = (r: Omit<RecurringTransaction, 'id' | 'user_id'>) => {
        if (recurringToEdit) {
            updateRecurringTransaction({ ...recurringToEdit, ...r });
            setRecurringToEdit(null);
        } else {
            addRecurringTransaction(r, { confirmed: true });
        }
        setIsRecurringModalOpen(false);
    };

    const handleApplyRecurringForMonth = async () => {
        const [year, month] = filters.month.split('-').map(Number);
        const activeRules = recurringList.filter((r) => r.enabled && !r.addManually).length;
        const monthLabel = filters.month;
        const ok = await confirmAction(summarizeApplyRecurringForConfirm(monthLabel, activeRules));
        if (!ok) return;
        setApplyingRecurring(true);
        try {
            const { applied, skipped } = await applyRecurringForMonth(year, month);
            alert(
                `Recurring: ${applied} transaction(s) created, ${skipped} not posted (e.g. already in this month, rule missing, or post failed — see any error above).`,
            );
        } catch (e) {
            // already alerted in context
        } finally {
            setApplyingRecurring(false);
        }
    };

    const handleApplyOneRecurringForMonth = async (ruleId: string) => {
        const [year, month] = filters.month.split('-').map(Number);
        const rule = recurringList.find((r) => r.id === ruleId);
        const ok = await confirmAction({
            title: 'Apply this recurring rule?',
            message: `Create one transaction from "${rule?.description ?? 'this rule'}" for ${filters.month}?`,
            confirmLabel: 'Apply',
            details: rule
                ? [`${rule.type} · ${rule.amount}`, `Day ${rule.dayOfMonth} of month`]
                : [],
        });
        if (!ok) return;
        setApplyingRecurringRuleId(ruleId);
        try {
            const res = await applyRecurringRuleForMonth(ruleId, year, month);
            if (res.applied) {
                alert('Created 1 transaction from this rule for the selected month.');
            } else if (res.skipReason === 'already') {
                alert('This rule already has a matching transaction in that month (nothing added).');
            } else if (res.skipReason === 'disabled') {
                alert('This recurring rule is paused. Enable it, then apply again.');
            } else if (res.skipReason === 'manual') {
                alert('This rule is set to add manually only — use Add transaction instead.');
            } else if (res.skipReason === 'not_found') {
                alert('That recurring rule no longer exists. Refresh the page.');
            } else {
                alert('Could not create the transaction. If an error appeared above, fix it and try again.');
            }
        } finally {
            setApplyingRecurringRuleId(null);
        }
    };
    
    const toHijri = (gregorianDateStr: string): string => {
        const date = new Date(gregorianDateStr);
        return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).format(date);
    };


    const ensurePendingStatusCleared = async (transactionId: string, nextStatus: 'Approved' | 'Rejected', rejectionReason?: string) => {
        if (!supabase || !auth?.user?.id) return;
        const uid = auth.user.id;
        const { data: verifyRow } = await supabase
            .from('transactions')
            .select('id, status')
            .eq('id', transactionId)
            .eq('user_id', uid)
            .maybeSingle();
        const status = String((verifyRow as any)?.status || '').toLowerCase();
        if (status && status !== 'pending') return;
        const patch: Record<string, unknown> = { status: nextStatus };
        if (nextStatus === 'Rejected') patch.rejection_reason = rejectionReason || null;
        await supabase
            .from('transactions')
            .update(patch)
            .eq('id', transactionId)
            .eq('user_id', uid)
            .in('status', ['Pending', 'pending']);
    };

    const persistPendingBudgetCategory = async (transactionId: string, budgetCategory: string | undefined) => {
        if (!supabase || !auth?.user?.id) return;
        const uid = auth.user.id;
        const normalizedBudget = String(budgetCategory ?? '').trim();
        const payloads = [{ budget_category: normalizedBudget || null }, { budgetCategory: normalizedBudget || null }];
        for (const payload of payloads) {
            const { error } = await supabase
                .from('transactions')
                .update(payload as any)
                .eq('id', transactionId)
                .eq('user_id', uid)
                .in('status', ['Pending', 'pending']);
            if (!error) break;
        }
        setAdminPendingTransactions((prev) =>
            prev.map((t) => (String(t.id) === String(transactionId) ? { ...t, budgetCategory: normalizedBudget || undefined } : t)),
        );
    };

    const reviewPendingTransaction = async (transactionId: string, status: 'Approved' | 'Rejected') => {
        if (!supabase || !auth?.user?.id) return;
        const uid = auth.user.id;
        const pendingRow = adminPendingTransactions.find((t) => String(t.id) === String(transactionId));
        const selectedBudget = String(pendingBudgetEdits[transactionId] ?? pendingRow?.budgetCategory ?? '').trim();
        if (status === 'Approved') {
            if (!selectedBudget) {
                alert('Please map this transaction to a budget category before approval.');
                return;
            }
            await persistPendingBudgetCategory(transactionId, selectedBudget);
        }

        if (status === 'Approved') {
            const { data: approved, error: approveError } = await supabase.rpc('approve_pending_transaction', {
                p_transaction_id: transactionId,
            });

            // DB returns false when transaction not found (no exception); or we get P0001 from old DB
            const notFound = approved === false || approveError?.code === 'P0001' || approveError?.message?.includes('not found');
            if (notFound) {
                setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                return;
            }

            if (approveError) {
                // Backward-compatible fallback for environments where the new RPC isn't deployed yet.
                const { error: statusError } = await supabase
                    .from('transactions')
                    .update({ status })
                    .eq('id', transactionId)
                    .eq('user_id', uid);
                if (statusError) {
                    // If transaction doesn't exist, remove from UI instead of showing error
                    if (statusError.message?.includes('not found') || statusError.code === 'PGRST116') {
                        setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                        setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                        return;
                    }
                    alert(`Failed to approve transaction: ${approveError.message}`);
                    return;
                }

                const row = adminPendingTransactions.find((t) => t.id === transactionId);
                if (row?.budgetCategory && row.amount) {
                    const { error: applyError } = await supabase.rpc('apply_approved_transaction_to_category', {
                        p_category_name: row.budgetCategory,
                        p_amount: Math.abs(Number(row.amount))
                    });
                    if (applyError) {
                        alert(`Transaction approved but category balance update failed: ${applyError.message}`);
                    }
                }
            }

            await ensurePendingStatusCleared(transactionId, 'Approved');
            
            // Refresh transaction data to get updated status and sync to shared budgets
            const { data: updatedTx } = await supabase
                .from('transactions')
                .select('*')
                .eq('id', transactionId)
                .eq('user_id', uid)
                .maybeSingle();
            
            if (updatedTx) {
                // Find the transaction in local state and update it, which will trigger sync to shared budgets
                const existingTx = data?.transactions?.find(t => t.id === transactionId);
                if (existingTx) {
                    // Use updateTransaction which handles syncSharedBudgetTransactionMirror
                    await updateTransaction({
                        ...existingTx,
                        status: 'Approved' as const,
                    });
                } else {
                    // If not in local state, add it
                    const newTx = {
                        id: updatedTx.id,
                        date: updatedTx.date,
                        description: updatedTx.description,
                        amount: Number(updatedTx.amount),
                        category: updatedTx.category,
                        subcategory: updatedTx.subcategory,
                        budgetCategory: updatedTx.budget_category || updatedTx.budgetCategory,
                        type: updatedTx.type,
                        accountId: updatedTx.account_id || updatedTx.accountId,
                        status: 'Approved' as const,
                        transactionNature: updatedTx.transaction_nature || updatedTx.transactionNature,
                        expenseType: updatedTx.expense_type || updatedTx.expenseType,
                    };
                    await updateTransaction(newTx as Transaction);
                }
            }
            
            // Successfully approved - remove from UI
            setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
            setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
            setPendingBudgetEdits((prev) => {
                const next = { ...prev };
                delete next[transactionId];
                return next;
            });
            setPendingRefreshKey((k) => k + 1);
        } else {
            const reason = window.prompt('Optional rejection reason for audit/history:');
            if (reason === null) {
                // User cancelled the prompt
                return;
            }
            const rejectionReason = reason || '';
            const { data: rejected, error: rejectError } = await supabase.rpc('reject_pending_transaction', {
                p_transaction_id: transactionId,
                p_reason: rejectionReason,
            });

            // DB returns false when transaction not found (no exception); or we get P0001 from old DB
            const notFoundReject = rejected === false || rejectError?.code === 'P0001' || rejectError?.message?.includes('not found');
            if (notFoundReject) {
                setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                return;
            }

            if (rejectError) {
                // Backward-compatible fallback for environments where the new RPC isn't deployed yet
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({ status: 'Rejected', rejection_reason: rejectionReason || null })
                    .eq('id', transactionId)
                    .eq('user_id', uid);
                if (updateError) {
                    // If transaction doesn't exist, remove from UI instead of showing error
                    if (updateError.message?.includes('not found') || updateError.code === 'PGRST116') {
                        setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                        setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                        return;
                    }
                    alert(`Failed to reject transaction: ${rejectError.message}`);
                    return;
                }
            }

            await ensurePendingStatusCleared(transactionId, 'Rejected', rejectionReason);
            // Successfully rejected - remove from UI
            setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
            setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
            setPendingBudgetEdits((prev) => {
                const next = { ...prev };
                delete next[transactionId];
                return next;
            });
            setPendingRefreshKey((k) => k + 1);
        }
    };

    const togglePendingSelection = (transactionId: string) => {
        setSelectedPendingIds((prev) => prev.includes(transactionId) ? prev.filter((id) => id !== transactionId) : [...prev, transactionId]);
    };

    const handleBulkReview = async (status: 'Approved' | 'Rejected') => {
        if (selectedPendingIds.length === 0) return;
        setIsBulkReviewing(true);
        for (const id of selectedPendingIds) {
            await reviewPendingTransaction(id, status);
        }
        setIsBulkReviewing(false);
    };

    if (showBlockingLoader) {
        return (
            <div className="flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading transactions" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Transactions"
            description="Track income and expenses. Import from bank or trading statements for less manual entry."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    {setActivePage && (
                        <button type="button" onClick={() => setActivePage('Statement Upload')} className="btn-outline flex items-center gap-2">
                            <StatementIcons.upload className="h-5 w-5" />
                            Import from statements
                        </button>
                    )}
                    <button type="button" onClick={() => handleOpenTransactionModal()} className="btn-primary">Add Transaction</button>
                </div>
            }
        >
            <SectionCard
                title="Recurring (monthly) transactions"
                collapsible
                collapsibleSummary="Templates, apply for month"
                defaultExpanded
                headerAction={
                    <div className="flex items-center gap-2">
                        <InfoHint text="Define templates (e.g. salary deposit, rent). Use Apply all for the month shown in filters, or Apply on each row for one rule only. Each eligible rule posts once per month on the chosen day." />
                        <button
                            type="button"
                            onClick={handleApplyRecurringForMonth}
                            disabled={applyingRecurring || applyingRecurringRuleId !== null || recurringList.length === 0}
                            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {applyingRecurring ? 'Applying…' : `Apply all for ${new Date(filters.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                        </button>
                        <button type="button" onClick={() => { setRecurringToEdit(null); setIsRecurringModalOpen(true); }} className="btn-outline">
                            Add recurring
                        </button>
                    </div>
                }
            >
                {recurringList.length === 0 ? (
                    <p className="empty-state">No recurring rules yet. Add one (e.g. salary to an account, or rent from an account and budget).</p>
                ) : (
                    <ul className="space-y-2">
                        {recurringList.map((r) => (
                            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border ${r.enabled ? 'bg-slate-50/50 border-slate-200' : 'bg-gray-100/50 border-gray-200 opacity-75'}`}>
                                <div className="flex-1 min-w-0">
                                    <span className="font-medium text-dark">{r.description}</span>
                                    <span className={`ml-2 text-sm font-medium ${r.type === 'income' ? 'text-green-700' : 'text-red-700'}`}>
                                        {r.type === 'income' ? '+' : '−'}{formatRecurringDisplay(r)}
                                    </span>
                                    <span className="text-xs text-gray-500 ml-2">
                                        • Day {r.dayOfMonth} • {availableAccounts.find(a => a.id === r.accountId)?.name ?? r.accountId}
                                        {r.type === 'expense' && r.budgetCategory && ` • ${r.budgetCategory}`}
                                        {r.addManually ? <span className="ml-1 text-slate-500">(manual)</span> : <span className="ml-1 text-emerald-600">(auto)</span>}
                                    </span>
                                    {!r.enabled && <span className="ml-2 text-xs text-amber-600">(paused)</span>}
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => handleApplyOneRecurringForMonth(r.id)}
                                        disabled={
                                            applyingRecurring ||
                                            applyingRecurringRuleId !== null ||
                                            !r.enabled ||
                                            r.addManually === true
                                        }
                                        className="btn-outline text-xs px-2 py-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={
                                            !r.enabled
                                                ? 'Enable this rule to post from it.'
                                                : r.addManually
                                                  ? 'Manual-only rules are not auto-posted.'
                                                  : `Post this rule once for ${new Date(filters.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                                        }
                                    >
                                        {applyingRecurringRuleId === r.id ? 'Applying…' : 'Apply'}
                                    </button>
                                    <button type="button" onClick={() => { setRecurringToEdit(r); setIsRecurringModalOpen(true); }} className="p-1.5 text-gray-500 hover:text-primary rounded" title="Edit"><PencilIcon className="h-4 w-4" /></button>
                                    <button type="button" onClick={() => deleteRecurringTransaction(r.id)} className="p-1.5 text-gray-500 hover:text-red-600 rounded" title="Delete"><TrashIcon className="h-4 w-4" /></button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            {userRole === 'Admin' && (
                <div className="bg-white p-5 rounded-xl shadow-md border border-amber-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-semibold text-dark">Admin Review Queue</h2>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">{adminPendingTransactions.length} pending</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" disabled={selectedPendingIds.length === 0 || isBulkReviewing} onClick={() => handleBulkReview('Approved')} className="btn-outline text-xs disabled:opacity-50">Approve selected</button>
                            <button type="button" disabled={selectedPendingIds.length === 0 || isBulkReviewing} onClick={() => handleBulkReview('Rejected')} className="btn-outline text-xs disabled:opacity-50">Reject selected</button>
                            <button type="button" onClick={() => setPendingRefreshKey((k) => k + 1)} className="btn-outline text-xs">Refresh pending</button>
                        </div>
                    </div>
                    {pendingLoadError && <p className="text-xs text-rose-700 mb-2">{pendingLoadError}</p>}
                    {isPendingLoading ? (
                        <p className="text-sm text-slate-500">Loading pending transactions…</p>
                    ) : adminPendingTransactions.length === 0 ? (
                        <p className="text-sm text-slate-600">No pending transactions right now. When restricted users submit expenses, they appear here for approval.</p>
                    ) : (
                        <div className="space-y-3">
                            {adminPendingTransactions.map((pending) => (
                                <div key={pending.id} className="p-3 rounded-lg border flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                    <div>
                                        <label className="inline-flex items-center gap-2 mr-2">
                                            <input type="checkbox" checked={selectedPendingIds.includes(pending.id)} onChange={() => togglePendingSelection(pending.id)} />
                                            <span className="text-xs text-slate-500">Select</span>
                                        </label>
                                        <p className="font-semibold">{pending.description}</p>
                                        <p className="text-xs text-gray-500">{pending.budgetCategory || 'Unmapped'} • {new Date(pending.date).toLocaleDateString()}</p>
                                        <div className="mt-1">
                                            <label htmlFor={`pending-budget-${pending.id}`} className="sr-only">Map to budget</label>
                                            <select
                                                id={`pending-budget-${pending.id}`}
                                                value={pendingBudgetEdits[String(pending.id)] ?? pending.budgetCategory ?? ''}
                                                onChange={(e) => setPendingBudgetEdits((prev) => ({ ...prev, [String(pending.id)]: e.target.value }))}
                                                className="text-xs rounded border border-slate-300 px-2 py-1"
                                            >
                                                <option value="">Map to budget…</option>
                                                {budgetCategories.map((c) => (
                                                    <option key={`${pending.id}-${c}`} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-amber-700">
                                            {formatCurrencyString(Number(pending.amount) || 0, {
                                                inCurrency: accountBookCurrency(
                                                    accountsById.get(String((pending as { accountId?: string }).accountId ?? (pending as { account_id?: string }).account_id ?? '')),
                                                ),
                                                showSecondary: true,
                                            })}
                                        </span>
                                        <button onClick={() => reviewPendingTransaction(pending.id, 'Approved')} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Approve</button>
                                        <button onClick={() => reviewPendingTransaction(pending.id, 'Rejected')} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 md:grid-cols-3">
                <Card title="Income" value={formatCurrencyString(monthlyIncome)} />
                <Card title="Expenses" value={formatCurrencyString(monthlyExpenses)} />
                <Card title="Net Flow" value={formatCurrency(netCashflow, { colorize: true })} trend={netCashflow >= 0 ? 'SURPLUS' : 'DEFICIT'} />
            </div>

            {data && (() => {
                const incomeStability = computeIncomeStability(data);
                const incomeTaxonomy = summarizeIncomeTaxonomy(filteredTransactions);
                if (incomeTaxonomy.length === 0 && incomeStability.label === 'moderate') return null;
                return (
                    <SectionCard title="Income taxonomy & stability" collapsible collapsibleSummary="Classified income sources" defaultExpanded={false}>
                        <p className="text-sm text-slate-600 mb-2">
                            Stability score <strong>{incomeStability.score}</strong> ({incomeStability.label}) — coefficient of variation {incomeStability.cvPct.toFixed(0)}% over recent financial months.
                        </p>
                        {incomeTaxonomy.length > 0 ? (
                            <ul className="text-sm space-y-1">
                                {incomeTaxonomy.map((row) => (
                                    <li key={row.label}>
                                        <span className="font-medium capitalize">{row.label}</span>: {row.count} tx · {formatCurrencyString(row.totalSar)}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-slate-500">No classified income in the filtered month.</p>
                        )}
                    </SectionCard>
                );
            })()}

            {transactionValidationWarnings.length > 0 && (
                <SectionCard title="Transactions validation checks" collapsible collapsibleSummary="Data quality checks" defaultExpanded>
                    <ul className="space-y-1 text-sm text-amber-800">
                        {transactionValidationWarnings.slice(0, 6).map((w, i) => (
                            <li key={`tv-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                 <AIAdvisor pageContext="cashflow" contextData={{ transactions: filteredTransactions, budgets: data?.budgets ?? [] }} />
                 <SectionCard title="Expense Breakdown" className="h-[400px] flex flex-col" collapsible collapsibleSummary="Category chart" defaultExpanded>
                    <div className="flex-1 min-h-0"><ExpenseBreakdownChart data={expenseBreakdown} /></div>
                </SectionCard>
            </div>

            <SectionCard title="Transaction History" collapsible collapsibleSummary="List, filters" defaultExpanded>
                <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-slate-50 rounded-xl">
                    <input type="month" value={filters.month} onChange={(e) => setFilters({...filters, month: e.target.value})} className="input-base w-auto min-w-[140px]" />
                    <select value={filters.accountId} onChange={(e) => setFilters({...filters, accountId: e.target.value})} className="select-base w-auto min-w-[160px]">
                        <option value="all">All Accounts</option>
                        {availableAccounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-slate-500 mr-1">Nature:</span>
                        <FilterButton label="All" value="all" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                        <FilterButton label="Variable" value="Variable" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                        <FilterButton label="Fixed" value="Fixed" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-slate-500 mr-1">Type:</span>
                        <FilterButton label="All" value="all" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                        <FilterButton label="Core" value="Core" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                        <FilterButton label="Discretionary" value="Discretionary" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                    </div>
                    <span className="hidden sm:inline text-xs text-slate-400 shrink-0" aria-hidden="true">·</span>
                    <button
                        type="button"
                        onClick={() => {
                            setExportDateFrom(defaultMonthDateBounds.from);
                            setExportDateTo(defaultMonthDateBounds.to);
                            setExportAccountId(filters.accountId);
                        }}
                        className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
                        title="Set export dates to match the selected month and account filter"
                    >
                        Sync export with filters
                    </button>
                </div>
                <div className="mb-4 p-3 rounded-xl border border-slate-200 bg-white flex flex-wrap items-end gap-3">
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Export account</label>
                        <select
                            value={exportAccountId}
                            onChange={(e) => setExportAccountId(e.target.value)}
                            className="select-base text-sm min-w-[180px]"
                            aria-label="Account for CSV export"
                        >
                            <option value="all">All accounts</option>
                            {availableAccounts.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">From date</label>
                        <input
                            type="date"
                            value={exportDateFrom}
                            onChange={(e) => setExportDateFrom(e.target.value)}
                            className="input-base text-sm"
                            aria-label="Export period start date"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">To date</label>
                        <input
                            type="date"
                            value={exportDateTo}
                            onChange={(e) => setExportDateTo(e.target.value)}
                            className="input-base text-sm"
                            aria-label="Export period end date"
                        />
                    </div>
                    <button type="button" className="btn-primary text-sm py-2" onClick={handleExportFilteredCsv}>
                        Export CSV ({filteredTransactionsForExport.length})
                    </button>
                    <p className="text-xs text-slate-500 w-full sm:w-auto flex-1 min-w-[200px]">
                        Includes every cash-account transaction row in range (including transfers between accounts). Investment trades use the Investments page exports.
                    </p>
                </div>
                <ul className="divide-y divide-slate-100">
                    {filteredTransactions.map((transaction: Transaction) => (
                        <li key={transaction.id} className="list-row flex-col items-start sm:flex-row sm:items-center">
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-dark">{transaction.description}</p>
                                <div className="text-sm text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                    <span>{new Date(transaction.date).toLocaleDateString()} ({toHijri(transaction.date)})</span>
                                    <span className="badge-neutral">{transaction.category}</span>
                                    {isInternalTransferTransaction(transaction) && (
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 bg-sky-100 px-1.5 py-0.5 rounded">
                                            Between accounts
                                        </span>
                                    )}
                                    {transaction.status && (
                                        <span className={transaction.status === 'Approved' ? 'badge-success' : transaction.status === 'Rejected' ? 'badge-danger' : 'badge-warning'}>{transaction.status}</span>
                                    )}
                                    {transaction.splitLines && transaction.splitLines.length > 0 && (
                                        <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">Split ×{transaction.splitLines.length}</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-2 sm:gap-3 flex-shrink-0">
                                <p
                                    className={`font-bold text-base sm:text-lg tabular-nums text-right leading-tight break-words max-w-[13.5rem] sm:max-w-none ${
                                        transaction.amount > 0 ? 'text-success' : transaction.amount < 0 ? 'text-danger' : 'text-dark'
                                    }`}
                                >
                                    {formatCashTransactionDisplay(transaction)}
                                </p>
                                <button type="button" onClick={() => handleOpenTransactionModal(transaction)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Edit"><PencilIcon className="h-5 w-5"/></button>
                                <button type="button" onClick={() => setItemToDelete(transaction)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-danger/50" aria-label="Delete"><TrashIcon className="h-5 w-5"/></button>
                            </div>
                        </li>
                    ))}
                    {filteredTransactions.length === 0 && (
                        <li className="empty-state flex flex-col items-center gap-2 py-6">
                            <span>No transactions found for the selected period.</span>
                            {setActivePage && (
                                <button type="button" onClick={() => setActivePage('Statement Upload')} className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1.5">
                                    <StatementIcons.upload className="h-4 w-4" />
                                    Import from statements →
                                </button>
                            )}
                        </li>
                    )}
                </ul>
            </SectionCard>
            
            <TransactionModal 
                isOpen={isTransactionModalOpen} 
                onClose={() => setIsTransactionModalOpen(false)} 
                onSave={handleSaveTransaction}
                onSaveAndTrade={handleSaveAndTrade}
                transactionToEdit={transactionToEdit} 
                budgetCategories={budgetCategories}
                budgets={data?.budgets ?? []}
                allCategories={allCategories}
                accounts={availableAccounts}
                existingTransactions={(data as any)?.personalTransactions ?? data?.transactions ?? []}
                sarPerUsd={sarPerUsd}
                monthStartDay={monthStartDay}
            />
             <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.description || ''} />
            <RecurringModal
                isOpen={isRecurringModalOpen}
                onClose={() => { setIsRecurringModalOpen(false); setRecurringToEdit(null); }}
                onSave={handleSaveRecurring}
                recurring={recurringToEdit}
                accounts={availableAccounts}
                budgetCategories={budgetCategories}
            />
        </PageLayout>
    );
};

export default Transactions;
