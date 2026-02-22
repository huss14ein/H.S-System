import React, { useMemo, useState, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Transaction, Account, Page, UserRole } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import AIAdvisor from '../components/AIAdvisor';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import ExpenseBreakdownChart from '../components/charts/ExpenseBreakdownChart';
import { getAICategorySuggestion, formatAiError } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from '../context/AuthContext';

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
    const { formatCurrencyString } = useFormatCurrency();
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
    const [isSuggestingCategory, setIsSuggestingCategory] = useState(false);


    React.useEffect(() => {
        if (transactionToEdit) {
            setDate(new Date(transactionToEdit.date).toISOString().split('T')[0]);
            setDescription(transactionToEdit.description);
            setAmount(String(Math.abs(transactionToEdit.amount)));
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
            setCategory(allCategories[0] || 'Groceries');
            setSubcategory('');
            setBudgetCategory(budgetCategories[0] || '');
            setType('expense');
            setAccountId(accounts[0]?.id || '');
            setTransactionNature('Variable');
            setExpenseType('Core');
        }
    }, [transactionToEdit, isOpen, budgetCategories, allCategories, accounts]);

    const buildTransactionData = (): Omit<Transaction, 'id'> => ({
        date,
        description,
        amount: type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount)),
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
        try {
            const suggested = await getAICategorySuggestion(description, allCategories);
            if (suggested && allCategories.includes(suggested)) {
                setCategory(suggested);
                const matchingBudgetCategory = budgetCategories.find(bc => bc.toLowerCase().includes(suggested.toLowerCase()) || suggested.toLowerCase().includes(bc.toLowerCase()));
                if(matchingBudgetCategory) setBudgetCategory(matchingBudgetCategory);
            } else if (suggested) {
                setCategory(suggested);
            }
        } catch (e) {
            console.error("Category suggestion failed", e);
            alert(`AI suggestion failed:\n\n${formatAiError(e)}`);
        } finally {
            setIsSuggestingCategory(false);
        }
    };
    
    const isInvestmentTransfer = type === 'expense' && budgetCategory === 'Savings & Investments';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={transactionToEdit ? 'Edit Transaction' : 'Add Transaction'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                    <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-2 border border-gray-300 rounded-md"/>
                </div>
                <input type="text" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <select id="account" value={accountId} onChange={e => setAccountId(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                    <option value="" disabled>Select an Account</option>
                    {accounts.filter(a => a.type !== 'Investment').map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrencyString(acc.balance)})</option>)}
                </select>
                <div className="flex space-x-4">
                    <label className="flex items-center"><input type="radio" value="expense" checked={type === 'expense'} onChange={() => setType('expense')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Expense</span></label>
                    <label className="flex items-center"><input type="radio" value="income" checked={type === 'income'} onChange={() => setType('income')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Income</span></label>
                </div>
                 {type === 'expense' && (
                     <div className="space-y-4 border-t pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                                <div className="relative">
                                    <input list="categories" id="category-input" value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md pr-10"/>
                                    <datalist id="categories">{allCategories.map(c => <option key={c} value={c} />)}</datalist>
                                    <button type="button" onClick={handleSuggestCategory} disabled={!description || isSuggestingCategory} className="absolute inset-y-0 right-0 flex items-center pr-3 disabled:opacity-50" title="Suggest Category with AI">
                                        {isSuggestingCategory ? <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <SparklesIcon className="h-5 w-5 text-primary hover:text-secondary" />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="subcategory" className="block text-sm font-medium text-gray-700">Subcategory (Optional)</label>
                                <input type="text" id="subcategory" value={subcategory} onChange={e => setSubcategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                            </div>
                        </div>
                        <select id="budget-category" value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                            <option value="" disabled>Map to Budget</option>
                            {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-4">
                            <select value={transactionNature} onChange={e => setTransactionNature(e.target.value as any)} className="w-full p-2 border border-gray-300 rounded-md">
                                <option value="Variable">Variable Nature</option>
                                <option value="Fixed">Fixed Nature</option>
                            </select>
                            <select value={expenseType} onChange={e => setExpenseType(e.target.value as any)} className="w-full p-2 border border-gray-300 rounded-md">
                                <option value="Core">Core Expense</option>
                                <option value="Discretionary">Discretionary Expense</option>
                            </select>
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

const Transactions: React.FC<TransactionsProps> = ({ pageAction, clearPageAction, triggerPageAction }) => {
    const { data, updateTransaction, addTransaction, deleteTransaction } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const [userRole, setUserRole] = useState<UserRole>('Restricted');
    const [permittedBudgetCategories, setPermittedBudgetCategories] = useState<string[]>([]);
    const [adminPendingTransactions, setAdminPendingTransactions] = useState<any[]>([]);

    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Transaction | null>(null);
    
    const [filters, setFilters] = useState({ 
        accountId: 'all', 
        month: new Date().toISOString().slice(0, 7),
        nature: 'all' as 'all' | 'Fixed' | 'Variable',
        expenseType: 'all' as 'all' | 'Core' | 'Discretionary',
    });

    useEffect(() => {
        if (pageAction === 'open-transaction-modal') {
            handleOpenTransactionModal();
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

            const role = (userRecord?.role === 'Admin' ? 'Admin' : 'Restricted') as UserRole;
            setUserRole(role);

            if (role === 'Restricted') {
                const { data: permissions } = await supabase
                    .from('permissions')
                    .select('category_id, categories(name)')
                    .eq('user_id', auth.user.id);

                const allowed = (permissions || []).map((p: any) => p.categories?.name).filter(Boolean);
                setPermittedBudgetCategories(allowed);
            } else {
                setPermittedBudgetCategories([]);
            }
        };

        loadGovernanceData();
    }, [auth?.user?.id]);

    useEffect(() => {
        const loadPendingTransactions = async () => {
            if (!supabase || userRole !== 'Admin') {
                setAdminPendingTransactions([]);
                return;
            }
            const { data: pendingRows } = await supabase
                .from('transactions')
                .select('id, user_id, description, amount, budgetCategory, budget_category, date, status')
                .eq('status', 'Pending')
                .order('date', { ascending: false });
            const normalized = (pendingRows || []).map((row: any) => ({
                ...row,
                budgetCategory: row.budgetCategory ?? row.budget_category ?? null,
            }));
            setAdminPendingTransactions(normalized);
        };

        loadPendingTransactions();
    }, [userRole, data.transactions.length]);

    const filteredTransactions = useMemo(() => {
        const [year, month] = filters.month.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        return data.transactions.filter(t => {
            const transactionDate = new Date(t.date);
            const isMonthMatch = transactionDate >= startDate && transactionDate <= endDate;
            const isAccountMatch = filters.accountId === 'all' || t.accountId === filters.accountId;
            const isNatureMatch = filters.nature === 'all' || t.transactionNature === filters.nature;
            const isExpenseTypeMatch = filters.expenseType === 'all' || t.expenseType === filters.expenseType;
            const isPermitted = userRole === 'Admin' || !t.budgetCategory || permittedBudgetCategories.includes(t.budgetCategory);
            return isMonthMatch && isAccountMatch && isNatureMatch && isExpenseTypeMatch && isPermitted;
        });
    }, [data.transactions, filters, userRole, permittedBudgetCategories]);

    const { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown } = useMemo(() => {
        const approvedTransactions = filteredTransactions.filter(t => (t.status ?? 'Approved') === 'Approved');
        const monthlyIncome = approvedTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const monthlyExpenses = approvedTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const netCashflow = monthlyIncome - monthlyExpenses;
        
        const spending = new Map<string, number>();
        approvedTransactions
            .filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        
        const expenseBreakdown = Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

        return { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown };
    }, [filteredTransactions]);
    
    const allCategories = useMemo(() => Array.from(new Set(data.transactions.map(t => t.category))), [data.transactions]);
    const budgetCategories = useMemo(() => {
        const categories = data.budgets.map(b => b.category);
        if (userRole === 'Admin') return categories;
        return categories.filter(c => permittedBudgetCategories.includes(c));
    }, [data.budgets, userRole, permittedBudgetCategories]);

    const handleOpenTransactionModal = (transaction: Transaction | null = null) => {
        setTransactionToEdit(transaction);
        setIsTransactionModalOpen(true);
    };

    const handleSaveTransaction = (transaction: Omit<Transaction, 'id'> | Transaction) => {
        if (userRole === 'Restricted' && transaction.type === 'expense' && (!transaction.budgetCategory || !permittedBudgetCategories.includes(transaction.budgetCategory))) {
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
        if (userRole === 'Restricted' && (!transaction.budgetCategory || !permittedBudgetCategories.includes(transaction.budgetCategory))) {
            alert('You can only submit expenses under your assigned budget categories.');
            return;
        }
        const nextStatus = userRole === 'Restricted' ? 'Pending' : 'Approved';
        addTransaction({ ...transaction, status: nextStatus }); // This is async but we don't need to wait
        triggerPageAction('Investments', `open-trade-modal:with-amount:${Math.abs(transaction.amount)}`);
    };
    
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        deleteTransaction(itemToDelete.id);
        setItemToDelete(null);
    };
    
    const toHijri = (gregorianDateStr: string): string => {
        const date = new Date(gregorianDateStr);
        return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).format(date);
    };

    const reviewPendingTransaction = async (transactionId: string, status: 'Approved' | 'Rejected') => {
        if (!supabase) return;

        if (status === 'Approved') {
            const { error: approveError } = await supabase.rpc('approve_pending_transaction', {
                p_transaction_id: transactionId,
            });

            if (approveError) {
                // Backward-compatible fallback for environments where the new RPC isn't deployed yet.
                const { error: statusError } = await supabase.from('transactions').update({ status }).eq('id', transactionId);
                if (statusError) {
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
        } else {
            const reason = window.prompt('Optional rejection reason for audit/history:') || '';
            const { error: rejectError } = await supabase.rpc('reject_pending_transaction', {
                p_transaction_id: transactionId,
                p_reason: reason,
            });

            if (rejectError) {
                const { error } = await supabase.from('transactions').update({ status, rejection_reason: reason || null }).eq('id', transactionId);
                if (error) {
                    alert(`Failed to reject transaction: ${rejectError.message}`);
                    return;
                }
            }
        }

        setAdminPendingTransactions(prev => prev.filter(t => t.id !== transactionId));
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Cash Flow</h1>
                <button onClick={() => handleOpenTransactionModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Transaction</button>
            </div>

            {userRole === 'Admin' && adminPendingTransactions.length > 0 && (
                <div className="bg-white p-5 rounded-xl shadow-md border border-amber-200">
                    <h2 className="text-xl font-semibold text-dark mb-3">Admin Review Queue</h2>
                    <div className="space-y-3">
                        {adminPendingTransactions.map((pending) => (
                            <div key={pending.id} className="p-3 rounded-lg border flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                <div>
                                    <p className="font-semibold">{pending.description}</p>
                                    <p className="text-xs text-gray-500">{pending.budgetCategory || 'Unmapped'} • {new Date(pending.date).toLocaleDateString()}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-amber-700">{formatCurrency(Number(pending.amount), { colorize: false })}</span>
                                    <button onClick={() => reviewPendingTransaction(pending.id, 'Approved')} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Approve</button>
                                    <button onClick={() => reviewPendingTransaction(pending.id, 'Rejected')} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Income" value={formatCurrencyString(monthlyIncome)} />
                <Card title="Expenses" value={formatCurrencyString(monthlyExpenses)} />
                <Card title="Net Flow" value={formatCurrency(netCashflow, { colorize: true })} trend={netCashflow >= 0 ? 'SURPLUS' : 'DEFICIT'} />
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <AIAdvisor pageContext="cashflow" contextData={{ transactions: filteredTransactions, budgets: data.budgets }} />
                 <div className="bg-white p-6 rounded-lg shadow-md h-[400px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Expense Breakdown</h3>
                    <ExpenseBreakdownChart data={expenseBreakdown} />
                </div>
            </div>
            
            <div>
                 <h2 className="text-2xl font-semibold text-dark mb-4">Transaction History</h2>
                 <div className="bg-white p-4 rounded-lg shadow mb-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="month" value={filters.month} onChange={(e) => setFilters({...filters, month: e.target.value})} className="p-2 border border-gray-300 rounded-md"/>
                        <select value={filters.accountId} onChange={(e) => setFilters({...filters, accountId: e.target.value})} className="p-2 border border-gray-300 rounded-md">
                            <option value="all">All Accounts</option>
                            {data.accounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-2 bg-gray-50 rounded-lg">
                            <label className="text-xs font-medium text-gray-500">Nature</label>
                            <div className="flex items-center space-x-2 mt-1">
                                <FilterButton label="All" value="all" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                                <FilterButton label="Variable" value="Variable" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                                <FilterButton label="Fixed" value="Fixed" current={filters.nature} onClick={(v) => setFilters(f => ({...f, nature: v as any}))} />
                            </div>
                        </div>
                        <div className="p-2 bg-gray-50 rounded-lg">
                            <label className="text-xs font-medium text-gray-500">Expense Type</label>
                            <div className="flex items-center space-x-2 mt-1">
                                <FilterButton label="All" value="all" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                                <FilterButton label="Core" value="Core" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                                <FilterButton label="Discretionary" value="Discretionary" current={filters.expenseType} onClick={(v) => setFilters(f => ({...f, expenseType: v as any}))} />
                            </div>
                        </div>
                    </div>
                 </div>
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <ul className="divide-y divide-gray-200">
                        {filteredTransactions.map(transaction => (
                            <li key={transaction.id} className="p-4 hover:bg-gray-50">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <p className="font-semibold text-dark">{transaction.description}</p>
                                        <div className="text-sm text-gray-500 flex items-center space-x-2">
                                            <span>{new Date(transaction.date).toLocaleDateString()} ({toHijri(transaction.date)})</span>
                                            <span className="text-gray-300">|</span>
                                            <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs">{transaction.category}</span>
                                            {transaction.status && (
                                                <span className={`px-2 py-0.5 rounded-full text-xs ${transaction.status === 'Approved' ? 'bg-green-100 text-green-700' : transaction.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{transaction.status}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <p className="font-bold text-lg">{formatCurrency(transaction.amount, { colorize: true })}</p>
                                        <button onClick={() => handleOpenTransactionModal(transaction)} className="text-gray-400 hover:text-primary"><PencilIcon className="h-5 w-5"/></button>
                                        <button onClick={() => setItemToDelete(transaction)} className="text-gray-400 hover:text-danger"><TrashIcon className="h-5 w-5"/></button>
                                    </div>
                                </div>
                            </li>
                        ))}
                         {filteredTransactions.length === 0 && <li className="p-8 text-center text-gray-500">No transactions found for the selected period.</li>}
                    </ul>
                </div>
            </div>
            
            <TransactionModal 
                isOpen={isTransactionModalOpen} 
                onClose={() => setIsTransactionModalOpen(false)} 
                onSave={handleSaveTransaction}
                onSaveAndTrade={handleSaveAndTrade}
                transactionToEdit={transactionToEdit} 
                budgetCategories={budgetCategories}
                allCategories={allCategories}
                accounts={data.accounts}
            />
             <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.description || ''} />
        </div>
    );
};

export default Transactions;
