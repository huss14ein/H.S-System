
import React, { useMemo, useState, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { Budget, Transaction, Account } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import AIAdvisor from '../components/AIAdvisor';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import ExpenseBreakdownChart from '../components/charts/ExpenseBreakdownChart';
import { getAICategorySuggestion } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';

const SinkingFundsAutopilot: React.FC = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const funds = [
        { name: 'Rent (Biannual)', saved: 12000, target: 18000 },
        { name: 'Iqama / Fees (Annual)', saved: 1600, target: 2000 },
        { name: 'School Fees (Annual)', saved: 3000, target: 5500 },
    ];
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold text-dark mb-4">Sinking Funds Autopilot</h3>
            <p className="text-sm text-gray-500 mb-4">Automatically setting aside money for large, predictable future expenses.</p>
            <div className="space-y-4">
                {funds.map(fund => (
                    <div key={fund.name}>
                        <div className="flex justify-between items-baseline text-sm mb-1">
                            <span className="font-medium">{fund.name}</span>
                            <span>{formatCurrencyString(fund.saved, {digits: 0})} / {formatCurrencyString(fund.target, {digits: 0})}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div className="bg-secondary h-2.5 rounded-full" style={{ width: `${(fund.saved/fund.target)*100}%`}}></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


const TransactionModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (transaction: Omit<Transaction, 'id'> | Transaction) => void; transactionToEdit: Transaction | null; budgetCategories: string[], allCategories: string[], accounts: Account[] }> = ({ isOpen, onClose, onSave, transactionToEdit, budgetCategories, allCategories, accounts }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState(allCategories[0] || '');
    const [budgetCategory, setBudgetCategory] = useState(budgetCategories[0] || '');
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [accountId, setAccountId] = useState('');
    const [isSuggestingCategory, setIsSuggestingCategory] = useState(false);


    React.useEffect(() => {
        if (transactionToEdit) {
            setDate(new Date(transactionToEdit.date).toISOString().split('T')[0]);
            setDescription(transactionToEdit.description);
            setAmount(String(Math.abs(transactionToEdit.amount)));
            setCategory(transactionToEdit.category);
            setBudgetCategory(transactionToEdit.budgetCategory || '');
            setType(transactionToEdit.type);
            setAccountId(transactionToEdit.accountId);
        } else {
            setDate(new Date().toISOString().split('T')[0]);
            setDescription('');
            setAmount('');
            setCategory(allCategories[0] || 'Groceries');
            setBudgetCategory(budgetCategories[0] || 'Food and Groceries');
            setType('expense');
            setAccountId(accounts[0]?.id || '');
        }
    }, [transactionToEdit, isOpen, budgetCategories, allCategories, accounts]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const transactionData = {
            date,
            description,
            amount: type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount)),
            category,
            budgetCategory: type === 'expense' ? budgetCategory : undefined,
            type,
            accountId,
        };
        
        if (transactionToEdit) {
            onSave({ ...transactionData, id: transactionToEdit.id });
        } else {
            onSave(transactionData);
        }
        onClose();
    };

    const handleSuggestCategory = async () => {
        if (!description) return;
        setIsSuggestingCategory(true);
        try {
            const suggested = await getAICategorySuggestion(description, allCategories);
            if (suggested && allCategories.includes(suggested)) {
                setCategory(suggested);
                
                // Attempt to map to a budget category
                const matchingBudgetCategory = budgetCategories.find(bc => bc.toLowerCase().includes(suggested.toLowerCase()) || suggested.toLowerCase().includes(bc.toLowerCase()));
                if(matchingBudgetCategory) {
                    setBudgetCategory(matchingBudgetCategory);
                }

            } else if (suggested) { // If AI suggests a new category
                setCategory(suggested);
            }
        } catch (e) {
            console.error("Category suggestion failed", e);
        } finally {
            setIsSuggestingCategory(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={transactionToEdit ? 'Edit Transaction' : 'Add Transaction'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                    <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-2 border border-gray-300 rounded-md"/>
                </div>
                <input type="text" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <div>
                    <label htmlFor="account" className="block text-sm font-medium text-gray-700">Account</label>
                    <select id="account" value={accountId} onChange={e => setAccountId(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                        {accounts.filter(a => a.type !== 'Investment').map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrencyString(acc.balance)})</option>)}
                    </select>
                </div>
                 <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700">Expense Category</label>
                     <div className="relative">
                        <input list="categories" id="category-input" value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md pr-10"/>
                         <datalist id="categories">
                            {allCategories.map(c => <option key={c} value={c} />)}
                         </datalist>
                         <button 
                            type="button" 
                            onClick={handleSuggestCategory} 
                            disabled={!description || isSuggestingCategory}
                            className="absolute inset-y-0 right-0 flex items-center pr-3 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Suggest Category with AI"
                        >
                            {isSuggestingCategory ? (
                                <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <SparklesIcon className="h-5 w-5 text-primary hover:text-secondary" />
                            )}
                        </button>
                    </div>
                </div>
                 {type === 'expense' && (
                     <div>
                        <label htmlFor="budget-category" className="block text-sm font-medium text-gray-700">Map to Budget</label>
                        <select id="budget-category" value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md">
                            {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                 )}
                <div className="flex space-x-4">
                    <label className="flex items-center"><input type="radio" value="expense" checked={type === 'expense'} onChange={() => setType('expense')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Expense</span></label>
                    <label className="flex items-center"><input type="radio" value="income" checked={type === 'income'} onChange={() => setType('income')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Income</span></label>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Transaction</button>
            </form>
        </Modal>
    );
};

const TransactionsPage: React.FC = () => {
    const { data, updateTransaction, addTransaction, deleteTransaction } = useContext(DataContext)!;
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();

    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Transaction | null>(null);
    
    const [filters, setFilters] = useState({ accountId: 'all', month: new Date().toISOString().slice(0, 7) });

    const filteredTransactions = useMemo(() => {
        const [year, month] = filters.month.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        return data.transactions.filter(t => {
            const transactionDate = new Date(t.date);
            const isMonthMatch = transactionDate >= startDate && transactionDate <= endDate;
            const isAccountMatch = filters.accountId === 'all' || t.accountId === filters.accountId;
            return isMonthMatch && isAccountMatch;
        });
    }, [data.transactions, filters]);

    const { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown } = useMemo(() => {
        const monthlyIncome = filteredTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const monthlyExpenses = filteredTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const netCashflow = monthlyIncome - monthlyExpenses;
        
        const spending = new Map<string, number>();
        filteredTransactions
            .filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        
        const expenseBreakdown = Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

        return { monthlyIncome, monthlyExpenses, netCashflow, expenseBreakdown };
    }, [filteredTransactions]);
    
    const allCategories = useMemo(() => Array.from(new Set(data.transactions.map(t => t.category))), [data.transactions]);
    const budgetCategories = useMemo(() => data.budgets.map(b => b.category), [data.budgets]);

    const handleOpenTransactionModal = (transaction: Transaction | null = null) => {
        setTransactionToEdit(transaction);
        setIsTransactionModalOpen(true);
    };

    const handleSaveTransaction = (transaction: Omit<Transaction, 'id'> | Transaction) => {
        if ('id' in transaction) {
            updateTransaction(transaction);
        } else {
            addTransaction(transaction);
        }
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

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Cash Flow</h1>
                <button onClick={() => handleOpenTransactionModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Transaction</button>
            </div>

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

            <SinkingFundsAutopilot />
            
            <div>
                 <h2 className="text-2xl font-semibold text-dark mb-4">Transaction History</h2>
                 <div className="bg-white p-4 rounded-lg shadow mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="month" value={filters.month} onChange={(e) => setFilters({...filters, month: e.target.value})} className="p-2 border border-gray-300 rounded-md"/>
                        <select value={filters.accountId} onChange={(e) => setFilters({...filters, accountId: e.target.value})} className="p-2 border border-gray-300 rounded-md">
                            <option value="all">All Accounts</option>
                            {data.accounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                 </div>
                 <div className="bg-white shadow rounded-lg overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                         <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                             {filteredTransactions.map((t) => (
                                <tr key={t.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        <div>{new Date(t.date).toLocaleDateString()}</div>
                                        <div className="text-xs text-gray-500">{toHijri(t.date)}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.description}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{data.accounts.find(a => a.id === t.accountId)?.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.category}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-semibold`}>
                                        {formatCurrency(t.amount, { colorize: true })}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                                        <button onClick={() => handleOpenTransactionModal(t)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                                        <button onClick={() => setItemToDelete(t)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                                    </td>
                                </tr>
                             ))}
                        </tbody>
                    </table>
                 </div>
            </div>

            <TransactionModal isOpen={isTransactionModalOpen} onClose={() => setIsTransactionModalOpen(false)} onSave={handleSaveTransaction} transactionToEdit={transactionToEdit} budgetCategories={budgetCategories} allCategories={allCategories} accounts={data.accounts} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.description || ''}/>
        </div>
    );
};

export default TransactionsPage;
