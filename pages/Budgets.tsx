import React, { useMemo, useState, useContext } from 'react';
import ProgressBar from '../components/ProgressBar';
import { DataContext } from '../context/DataContext';
import Modal from '../components/Modal';
import { Budget } from '../types';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { DocumentDuplicateIcon } from '../components/icons/DocumentDuplicateIcon';

interface BudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => void;
    budgetToEdit: Budget | null;
    currentMonth: number;
    currentYear: number;
}

const BudgetModal: React.FC<BudgetModalProps> = ({ isOpen, onClose, onSave, budgetToEdit, currentMonth, currentYear }) => {
    const { data } = useContext(DataContext)!;
    const [category, setCategory] = useState('');
    const [limit, setLimit] = useState('');

    const existingCategories = useMemo(() => new Set(data.budgets.filter(b => b.year === currentYear && b.month === currentMonth).map(b => b.category)), [data.budgets, currentYear, currentMonth]);

    React.useEffect(() => {
        if (budgetToEdit) {
            setCategory(budgetToEdit.category);
            setLimit(String(budgetToEdit.limit));
        } else {
            setCategory('');
            setLimit('');
        }
    }, [budgetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            category,
            limit: parseFloat(limit) || 0,
            month: budgetToEdit ? budgetToEdit.month : currentMonth,
            year: budgetToEdit ? budgetToEdit.year : currentYear,
        }, !!budgetToEdit);
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={budgetToEdit ? 'Edit Budget' : 'Add Budget'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                    <input list="category-list" type="text" id="category" value={category} onChange={e => setCategory(e.target.value)} required disabled={!!budgetToEdit} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary disabled:bg-gray-100" />
                    <datalist id="category-list">
                        {['Food', 'Transportation', 'Housing', 'Utilities', 'Shopping', 'Entertainment', 'Health', 'Education', 'Savings & Investments', 'Personal Care'].filter(c => !existingCategories.has(c)).map(c => <option key={c} value={c} />)}
                    </datalist>
                </div>
                 <div>
                    <label htmlFor="limit" className="block text-sm font-medium text-gray-700">Monthly Limit</label>
                    <input type="number" id="limit" value={limit} onChange={e => setLimit(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Budget</button>
            </form>
        </Modal>
    );
}

const Budgets: React.FC = () => {
    const { data, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);

    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const budgetData = useMemo(() => {
        const spending = new Map<string, number>();
        
        data.transactions
            .filter(t => t.type === 'expense' && new Date(t.date).getFullYear() === currentYear && new Date(t.date).getMonth() + 1 === currentMonth && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });

        return data.budgets
            .filter(b => b.year === currentYear && b.month === currentMonth)
            .map(budget => {
                const spent = spending.get(budget.category) || 0;
                const percentage = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
                let colorClass = 'bg-primary';
                if (percentage > 100) colorClass = 'bg-danger';
                else if (percentage > 90) colorClass = 'bg-warning';
                
                return { ...budget, spent, percentage, colorClass };
            }).sort((a,b) => b.spent - a.spent);
    }, [data.transactions, data.budgets, currentYear, currentMonth]);

    const handleOpenModal = (budget: Budget | null = null) => {
        setBudgetToEdit(budget);
        setIsModalOpen(true);
    };

    const handleSaveBudget = (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => {
        if (isEditing) {
            updateBudget(budget as Budget);
        } else {
            addBudget(budget);
        }
    };
    
    const changeMonth = (offset: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    }

    const handleCopyBudgets = () => {
        if (window.confirm("This will copy budgets from the previous month for any categories that don't already have one this month. Continue?")) {
            copyBudgetsFromPreviousMonth(currentYear, currentMonth);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Monthly Budgets</h1>
                <div className="flex items-center gap-2">
                    <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon className="h-5 w-5"/></button>
                    <span className="font-semibold text-lg w-36 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                    <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon className="h-5 w-5"/></button>
                </div>
                 <div className="flex items-center gap-2">
                    <button onClick={handleCopyBudgets} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm flex items-center gap-2"><DocumentDuplicateIcon className="h-5 w-5"/>Copy Last Month</button>
                    <button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Budget</button>
                 </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {budgetData.map(budget => (
                    <div key={budget.category} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 flex flex-col">
                        <div className="flex-grow">
                            <h3 className="text-lg font-semibold text-dark">{budget.category}</h3>
                            <div className="mt-4">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-medium text-secondary">{formatCurrencyString(budget.spent, { digits: 0 })}</span>
                                    <span className="text-sm text-gray-500">/ {formatCurrencyString(budget.limit, { digits: 0 })}</span>
                                </div>
                                <ProgressBar value={budget.spent} max={budget.limit} color={budget.colorClass} />
                                <p className={`text-right text-sm mt-1 ${budget.limit - budget.spent >= 0 ? 'text-gray-600' : 'text-danger font-medium'}`}>
                                    {budget.limit - budget.spent >= 0 
                                        ? `${formatCurrencyString(budget.limit - budget.spent, { digits: 0 })} remaining`
                                        : `${formatCurrencyString(Math.abs(budget.limit - budget.spent), { digits: 0 })} over`
                                    }
                                </p>
                            </div>
                        </div>
                         <div className="border-t mt-4 pt-2 flex justify-end space-x-2">
                            <button onClick={() => handleOpenModal(budget)} className="p-2 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                            {/* FIX: The deleteBudget function requires month and year in addition to the category. */}
                            <button onClick={() => deleteBudget(budget.category, budget.month, budget.year)} className="p-2 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                        </div>
                    </div>
                ))}
            </div>
             {budgetData.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                    <p className="text-gray-500">No budgets set for this month.</p>
                </div>
            )}
            <BudgetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveBudget} budgetToEdit={budgetToEdit} currentMonth={currentMonth} currentYear={currentYear} />
        </div>
    );
};

export default Budgets;
