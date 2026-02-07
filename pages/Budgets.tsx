
import React, { useMemo, useState, useContext } from 'react';
import ProgressBar from '../components/ProgressBar';
import { DataContext } from '../context/DataContext';
import Modal from '../components/Modal';
import { Budget } from '../types';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

interface BudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (budget: Budget) => void;
    budgetToEdit: Budget | null;
}

const BudgetModal: React.FC<BudgetModalProps> = ({ isOpen, onClose, onSave, budgetToEdit }) => {
    const [category, setCategory] = useState('');
    const [limit, setLimit] = useState('');

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
        // FIX: Construct a full Budget object to satisfy the onSave prop type.
        // The original implementation was missing id, month, and year.
        if (budgetToEdit) {
            onSave({
                ...budgetToEdit,
                limit: parseFloat(limit) || 0,
            });
        } else {
            const today = new Date();
            onSave({
                id: `budget-${Date.now()}`, // Temporary ID for a new budget
                category,
                limit: parseFloat(limit) || 0,
                month: today.getMonth() + 1,
                year: today.getFullYear(),
            });
        }
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={budgetToEdit ? 'Edit Budget' : 'Add Budget'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                    <input type="text" id="category" value={category} onChange={e => setCategory(e.target.value)} required disabled={!!budgetToEdit} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary disabled:bg-gray-100" />
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
    const { data, addBudget, updateBudget, deleteBudget } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);

    const budgetData = useMemo(() => {
        const spending = new Map<string, number>();
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        data.transactions
            .filter(t => t.type === 'expense' && new Date(t.date) >= firstDayOfMonth && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });

        return data.budgets.map(budget => {
            const spent = spending.get(budget.category) || 0;
            const percentage = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
            let colorClass = 'bg-primary';
            if (percentage > 100) colorClass = 'bg-danger';
            else if (percentage > 90) colorClass = 'bg-warning';
            
            return { ...budget, spent, percentage, colorClass };
        }).sort((a,b) => b.spent - a.spent);
    }, [data.transactions, data.budgets]);

    const handleOpenModal = (budget: Budget | null = null) => {
        setBudgetToEdit(budget);
        setIsModalOpen(true);
    };

    const handleSaveBudget = (budget: Budget) => {
        if (data.budgets.some(b => b.category === budget.category)) {
            updateBudget(budget);
        } else {
            addBudget(budget);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Monthly Budgets</h1>
                <button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors">
                    Add Budget
                </button>
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
                            <button onClick={() => deleteBudget(budget.category)} className="p-2 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                        </div>
                    </div>
                ))}
            </div>
            <BudgetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveBudget} budgetToEdit={budgetToEdit} />
        </div>
    );
};

export default Budgets;