import React, { useMemo, useState, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Transaction, Account, Page, UserRole, RecurringTransaction } from '../types';
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
import { SparklesIcon } from '../components/icons/SparklesIcon';
import InfoHint from '../components/InfoHint';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from '../context/AuthContext';
import { inferIsAdmin } from '../utils/role';
import { DemoDataButton } from '../components/DemoDataButton';

const TransactionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (transaction: Omit<Transaction, 'id'> | Transaction) => void;
    onSaveAndTrade: (transaction: Omit<Transaction, 'id'>) => void;
    transactionToEdit: Transaction | null;
    budgetCategories: string[],
    allCategories: string[],
    accounts: Account[]
}> = ({ isOpen, onClose, onSave, onSaveAndTrade, transactionToEdit, budgetCategories, allCategories, accounts }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState(allCategories?.[0] || '');
    const [subcategory, setSubcategory] = useState('');
    const [budgetCategory, setBudgetCategory] = useState(budgetCategories[0] || '');
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [accountId, setAccountId] = useState('');
    const [transactionNature, setTransactionNature] = useState<'Fixed' | 'Variable'>('Variable');
    const [expenseType, setExpenseType] = useState<'Core' | 'Discretionary'>('Core');
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
            setAmount(String(Math.abs(Number(transactionToEdit?.amount) || 0)));
            setCategory(transactionToEdit.category);
            setSubcategory(transactionToEdit.subcategory || '');
            setBudgetCategory(transactionToEdit.budgetCategory || '');
            setType(transactionToEdit.type);
            setAccountId(transactionToEdit.accountId);
            setTransactionNature(transactionToEdit.transactionNature || 'Variable');
            setExpenseType(transactionToEdit.expenseType || 'Core');
        } else {
            setDate(new Date().toISOString().split('T')[0]);
            setDescription('');
            setAmount('');
            setCategory(allCategories?.[0] || 'Groceries');
            setSubcategory('');
            setBudgetCategory(budgetCategories?.[0] || '');
            setType('expense');
            setAccountId(accounts[0]?.id || '');
            setTransactionNature('Variable');
            setExpenseType('Core');
        }
        setAiSuggestionNote(null);
    }, [transactionToEdit, isOpen, budgetCategories, allCategories, accounts]);

    const buildTransactionData = (): Omit<Transaction, 'id'> => ({
        date,
        description,
        amount: type === 'expense' ? -Math.abs(parseFloat(amount) || 0) : Math.abs(parseFloat(amount) || 0),
        category,
        subcategory: subcategory || undefined,
        budgetCategory: type === 'expense' ? budgetCategory : undefined,
        type,
        accountId,
        transactionNature: type === 'expense' ? transactionNature : undefined,
        expenseType: type === 'expense' ? expenseType : undefined,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const transactionData = buildTransactionData();
        
        try {
            if (type === 'expense' && budgetCategory === 'Savings & Investments') {
                await onSaveAndTrade(transactionData);
            } else if (transactionToEdit) {
                await onSave({ ...transactionData, id: transactionToEdit.id });
            } else {
                await onSave(transactionData);
            }
            onClose();
        } catch (error) {
            // Error already alerted in DataContext
        }
    };
    
    const handleSuggestCategory = async () => {
        if (!description) return;
        setIsSuggestingCategory(true);
        setAiSuggestionNote(null);
        try {
            const suggested = await getAICategorySuggestion(description, allCategories);
            if (suggested && allCategories.includes(suggested)) {
                setCategory(suggested);
                const matchingBudgetCategory = budgetCategories.find(bc => bc.toLowerCase().includes(suggested.toLowerCase()) || suggested.toLowerCase().includes(bc.toLowerCase()));
                if(matchingBudgetCategory) setBudgetCategory(matchingBudgetCategory);
                setAiSuggestionNote({ tone: 'success', text: `Category suggested: ${suggested}` });
            } else if (suggested) {
                setCategory(suggested);
                setAiSuggestionNote({ tone: 'success', text: `Category suggested: ${suggested}` });
            } else {
                const fallback = suggestCategoryLocally(description);
                if (fallback) {
                    setCategory(fallback);
                    const matchingBudgetCategory = budgetCategories.find(bc => bc.toLowerCase().includes(fallback.toLowerCase()) || fallback.toLowerCase().includes(bc.toLowerCase()));
                    if (matchingBudgetCategory) setBudgetCategory(matchingBudgetCategory);
                    setAiSuggestionNote({ tone: 'warning', text: `AI unavailable, applied smart fallback: ${fallback}` });
                } else {
                    setAiSuggestionNote({ tone: 'info', text: 'No suggestion available. You can continue with your selected category.' });
                }
            }
        } catch (e) {
            console.error("Category suggestion failed", e);
            const fallback = suggestCategoryLocally(description);
            if (fallback) {
                setCategory(fallback);
                const matchingBudgetCategory = budgetCategories.find(bc => bc.toLowerCase().includes(fallback.toLowerCase()) || fallback.toLowerCase().includes(bc.toLowerCase()));
                if (matchingBudgetCategory) setBudgetCategory(matchingBudgetCategory);
                setAiSuggestionNote({ tone: 'warning', text: `AI timeout/unavailable. Smart fallback applied: ${fallback}` });
            } else {
                setAiSuggestionNote({ tone: 'warning', text: 'AI timeout/unavailable. Please continue manually.' });
            }
        } finally {
            setIsSuggestingCategory(false);
        }
    };
    
    const isInvestmentTransfer = type === 'expense' && budgetCategory === 'Savings & Investments';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={transactionToEdit ? 'Edit Transaction' : 'Add Transaction'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Date <InfoHint text="Transaction date; used for monthly reports and budget tracking." /></label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Amount <InfoHint text="Enter a positive number; the system records income as positive and expense as negative." /></label>
                        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-2 border border-gray-300 rounded-md"/>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Description <InfoHint text="Short description for the transaction; AI can suggest category from this." /></label>
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
                    <label className="flex items-center"><input type="radio" value="expense" checked={type === 'expense'} onChange={() => setType('expense')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Expense</span></label>
                    <label className="flex items-center"><input type="radio" value="income" checked={type === 'income'} onChange={() => setType('income')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Income</span></label>
                </div>
                 {type === 'expense' && (
                     <div className="space-y-4 border-t pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="category" className="block text-sm font-medium text-gray-700 flex items-center">Category <InfoHint text="Spending category; use AI suggest (sparkle) to auto-fill from description." /></label>
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
                        <div>
                            <label htmlFor="budget-category" className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Map to Budget <InfoHint text="Links this expense to a budget category so spending is tracked against limits." /></label>
                            <select id="budget-category" value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                                <option value="" disabled>Map to Budget</option>
                                {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
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
            setAmount(String(recurring?.amount ?? 0));
            setType(recurring.type);
            setAccountId(recurring.accountId);
            setBudgetCategory(recurring.budgetCategory ?? '');
            setCategory(recurring.category);
            setDayOfMonth(String(recurring.dayOfMonth));
            setEnabled(recurring.enabled);
            setAddManually(recurring.addManually === true);
        } else {
            setDescription('');
            setAmount('');
            setType('expense');
            setAccountId(accounts[0]?.id ?? '');
            setBudgetCategory(budgetCategories[0] ?? '');
            setCategory('Rent');
            setDayOfMonth('1');
            setEnabled(true);
            setAddManually(false);
        }
    }, [recurring, isOpen, accounts, budgetCategories]);

    const handleSubmit = (e: React.FormEvent) => {
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
                        <select value={type} onChange={e => setType(e.target.value as 'income' | 'expense')} className="select-base">
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
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category (e.g. Rent, Salary)</label>
                    <input type="text" value={category} onChange={e => setCategory(e.target.value)} className="input-base" placeholder="Rent" />
                </div>
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

const Transactions: React.FC<TransactionsProps> = ({ pageAction, clearPageAction, triggerPageAction }) => {
    const { data, updateTransaction, addTransaction, deleteTransaction, addRecurringTransaction, updateRecurringTransaction, deleteRecurringTransaction, applyRecurringForMonth } = useContext(DataContext)!;
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

    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Transaction | null>(null);
    const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
    const [recurringToEdit, setRecurringToEdit] = useState<RecurringTransaction | null>(null);
    const [applyingRecurring, setApplyingRecurring] = useState(false);
    
    const [filters, setFilters] = useState({ 
        accountId: 'all', 
        month: new Date().toISOString().slice(0, 7),
        nature: 'all' as 'all' | 'Fixed' | 'Variable',
        expenseType: 'all' as 'all' | 'Core' | 'Discretionary',
        budgetCategory: 'all' as 'all' | string,
    });

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
        const loadPendingTransactions = async () => {
            if (!supabase || userRole !== 'Admin') {
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
                    const camelCaseResult = await fetchPendingRows('id, user_id, description, amount, budgetCategory, date, status');
                    pendingRows = camelCaseResult.data || [];
                    pendingError = camelCaseResult.error;

                    if (pendingError?.code === '42703' || pendingError?.code === 'PGRST204') {
                        const snakeCaseResult = await fetchPendingRows('id, user_id, description, amount, budget_category, date, status');
                        pendingRows = snakeCaseResult.data || [];
                        pendingError = snakeCaseResult.error;
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
            setSelectedPendingIds((prev) => prev.filter((id) => normalized.some((row: any) => row.id === id)));
            setIsPendingLoading(false);
        };

        loadPendingTransactions();
    }, [userRole, data?.transactions, pendingRefreshKey]);

    const filteredTransactions = useMemo(() => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        const [year, month] = filters.month.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        return (data?.transactions ?? []).filter(t => {
            const transactionDate = new Date(t.date);
            const isMonthMatch = transactionDate >= startDate && transactionDate <= endDate;
            const isAccountMatch = filters.accountId === 'all' || t.accountId === filters.accountId;
            const isNatureMatch = filters.nature === 'all' || t.transactionNature === filters.nature;
            const isExpenseTypeMatch = filters.expenseType === 'all' || t.expenseType === filters.expenseType;
            const isPermitted = userRole === 'Admin' || !t.budgetCategory || allowedRestrictedCategories.has(t.budgetCategory);
            return isMonthMatch && isAccountMatch && isNatureMatch && isExpenseTypeMatch && isPermitted;
        });
    }, [data?.transactions, filters, userRole, permittedBudgetCategories, sharedBudgetCategories]);

    const { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown } = useMemo(() => {
        const approvedTransactions = filteredTransactions.filter(t => (t.status ?? 'Approved') === 'Approved');
        const monthlyIncome = approvedTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + (Number(t.amount) ?? 0), 0);
        const monthlyExpenses = approvedTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(Number(t.amount) ?? 0), 0);
        const netCashflow = monthlyIncome - monthlyExpenses;
        
        const spending = new Map<string, number>();
        approvedTransactions
            .filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(Number(t.amount) ?? 0));
            });
        
        const expenseBreakdown = Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

        return { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown };
    }, [filteredTransactions]);
    
    const allCategories = useMemo(() => Array.from(new Set((data?.transactions ?? []).map(t => t.category))), [data?.transactions]);
    const budgetCategories = useMemo(() => {
        const ownCategories = (data?.budgets ?? []).map(b => b.category);
        if (userRole === 'Admin') return ownCategories;
        const allowedSet = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        return Array.from(new Set([...ownCategories.filter(c => allowedSet.has(c)), ...sharedBudgetCategories]));
    }, [data?.budgets, userRole, permittedBudgetCategories, sharedBudgetCategories]);

    const handleOpenTransactionModal = (transaction: Transaction | null = null) => {
        setTransactionToEdit(transaction);
        setIsTransactionModalOpen(true);
    };

    const handleSaveTransaction = (transaction: Omit<Transaction, 'id'> | Transaction) => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        if (userRole === 'Restricted' && transaction.type === 'expense' && (!transaction.budgetCategory || !allowedRestrictedCategories.has(transaction.budgetCategory))) {
            alert('You can only submit expenses under your assigned budget categories.');
            return;
        }

        if ('id' in transaction) {
            updateTransaction(transaction);
        } else {
            const nextStatus = userRole === 'Restricted' ? 'Pending' : 'Approved';
            addTransaction({ ...transaction, status: nextStatus });
        }
    };
    
    const handleSaveAndTrade = (transaction: Omit<Transaction, 'id'>) => {
        const allowedRestrictedCategories = new Set([...permittedBudgetCategories, ...sharedBudgetCategories]);
        if (userRole === 'Restricted' && (!transaction.budgetCategory || !allowedRestrictedCategories.has(transaction.budgetCategory))) {
            alert('You can only submit expenses under your assigned budget categories.');
            return;
        }
        const nextStatus = userRole === 'Restricted' ? 'Pending' : 'Approved';
        addTransaction({ ...transaction, status: nextStatus }); // This is async but we don't need to wait
        triggerPageAction('Dashboard', `open-trade-modal:with-amount:${Math.abs(Number(transaction.amount) ?? 0)}`);
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
            addRecurringTransaction(r);
        }
        setIsRecurringModalOpen(false);
    };

    const handleApplyRecurringForMonth = async () => {
        const [year, month] = filters.month.split('-').map(Number);
        setApplyingRecurring(true);
        try {
            const { applied, skipped } = await applyRecurringForMonth(year, month);
            alert(`Recurring: ${applied} transaction(s) created, ${skipped} already applied for this month.`);
        } catch (e) {
            // already alerted in context
        } finally {
            setApplyingRecurring(false);
        }
    };
    
    const toHijri = (gregorianDateStr: string): string => {
        const date = new Date(gregorianDateStr);
        return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).format(date);
    };


    const reviewPendingTransaction = async (transactionId: string, status: 'Approved' | 'Rejected') => {
        if (!supabase) return;

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
                // If transaction not found, it may have been deleted or already processed - remove from UI
                if (approveError.message?.includes('not found')) {
                    setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                    setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                    return;
                }

                // Backward-compatible fallback for environments where the new RPC isn't deployed yet.
                const { error: statusError } = await supabase.from('transactions').update({ status }).eq('id', transactionId);
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

            // Successfully approved - remove from UI
            setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
            setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
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
                // If transaction not found, it may have been deleted or already processed - remove from UI
                if (rejectError.message?.includes('not found')) {
                    setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
                    setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
                    return;
                }

                // Backward-compatible fallback for environments where the new RPC isn't deployed yet
                const { error: updateError } = await supabase.from('transactions').update({ status: 'Rejected', rejection_reason: rejectionReason || null }).eq('id', transactionId);
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

            // Successfully rejected - remove from UI
            setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
            setSelectedPendingIds((prev) => prev.filter((id) => id !== transactionId));
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

    return (
        <PageLayout
            title="Cash Flow"
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <DemoDataButton page="Transactions" options={{ includeTransactions: true }} />
                    <button type="button" onClick={() => handleOpenTransactionModal()} className="btn-primary">Add Transaction</button>
                </div>
            }
        >
            <SectionCard
                title="Recurring (monthly) transactions"
                headerAction={
                    <div className="flex items-center gap-2">
                        <InfoHint text="Define templates (e.g. salary deposit, rent). Use &quot;Apply for this month&quot; to create actual transactions from them. Each rule runs once per month on the chosen day." />
                        <button
                            type="button"
                            onClick={handleApplyRecurringForMonth}
                            disabled={applyingRecurring || recurringList.length === 0}
                            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {applyingRecurring ? 'Applying…' : `Apply for ${new Date(filters.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
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
                                        {r.type === 'income' ? '+' : '−'}{formatCurrencyString(r.amount ?? 0)}
                                    </span>
                                    <span className="text-xs text-gray-500 ml-2">
                                        • Day {r.dayOfMonth} • {(data?.accounts ?? []).find(a => a.id === r.accountId)?.name ?? r.accountId}
                                        {r.type === 'expense' && r.budgetCategory && ` • ${r.budgetCategory}`}
                                        {r.addManually ? <span className="ml-1 text-slate-500">(manual)</span> : <span className="ml-1 text-emerald-600">(auto)</span>}
                                    </span>
                                    {!r.enabled && <span className="ml-2 text-xs text-amber-600">(paused)</span>}
                                </div>
                                <div className="flex items-center gap-1">
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
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-amber-700">{formatCurrency(Number(pending.amount ?? 0), { colorize: false })}</span>
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
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                 <AIAdvisor pageContext="cashflow" contextData={{ transactions: filteredTransactions, budgets: data?.budgets ?? [] }} />
                 <SectionCard title="Expense Breakdown" className="h-[400px] flex flex-col">
                    <div className="flex-1 min-h-0"><ExpenseBreakdownChart data={expenseBreakdown} /></div>
                </SectionCard>
            </div>

            <SectionCard title="Transaction History">
                <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-slate-50 rounded-xl">
                    <input type="month" value={filters.month} onChange={(e) => setFilters({...filters, month: e.target.value})} className="input-base w-auto min-w-[140px]" />
                    <select value={filters.accountId} onChange={(e) => setFilters({...filters, accountId: e.target.value})} className="select-base w-auto min-w-[160px]">
                        <option value="all">All Accounts</option>
                        {(data?.accounts ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                </div>
                <ul className="divide-y divide-slate-100">
                    {filteredTransactions.map(transaction => (
                        <li key={transaction.id} className="list-row">
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-dark">{transaction.description}</p>
                                <div className="text-sm text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                    <span>{new Date(transaction.date).toLocaleDateString()} ({toHijri(transaction.date)})</span>
                                    <span className="badge-neutral">{transaction.category}</span>
                                    {transaction.status && (
                                        <span className={transaction.status === 'Approved' ? 'badge-success' : transaction.status === 'Rejected' ? 'badge-danger' : 'badge-warning'}>{transaction.status}</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                                <p className="font-bold text-lg tabular-nums">{formatCurrency(transaction?.amount ?? 0, { colorize: true })}</p>
                                <button type="button" onClick={() => handleOpenTransactionModal(transaction)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Edit"><PencilIcon className="h-5 w-5"/></button>
                                <button type="button" onClick={() => setItemToDelete(transaction)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-danger/50" aria-label="Delete"><TrashIcon className="h-5 w-5"/></button>
                            </div>
                        </li>
                    ))}
                    {filteredTransactions.length === 0 && <li className="empty-state">No transactions found for the selected period.</li>}
                </ul>
            </SectionCard>
            
            <TransactionModal 
                isOpen={isTransactionModalOpen} 
                onClose={() => setIsTransactionModalOpen(false)} 
                onSave={handleSaveTransaction}
                onSaveAndTrade={handleSaveAndTrade}
                transactionToEdit={transactionToEdit} 
                budgetCategories={budgetCategories}
                allCategories={allCategories}
                accounts={data?.accounts ?? []}
            />
             <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.description || ''} />
            <RecurringModal
                isOpen={isRecurringModalOpen}
                onClose={() => { setIsRecurringModalOpen(false); setRecurringToEdit(null); }}
                onSave={handleSaveRecurring}
                recurring={recurringToEdit}
                accounts={data?.accounts ?? []}
                budgetCategories={budgetCategories}
            />
        </PageLayout>
    );
};

export default Transactions;
