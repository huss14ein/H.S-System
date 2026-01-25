
import React, { useState, useEffect, useContext } from 'react';
import Modal from './Modal';
import { Transaction } from '../types';
import { DataContext } from '../context/DataContext';
import { getAICategorySuggestion } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

interface TransactionReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    transactions: Transaction[];
    budgetCategories: string[];
}

const TransactionReviewModal: React.FC<TransactionReviewModalProps> = ({ isOpen, onClose, transactions, budgetCategories }) => {
    const { updateTransaction } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [isSuggesting, setIsSuggesting] = useState(false);

    const currentTransaction = transactions[currentIndex];

    useEffect(() => {
        if (isOpen && currentTransaction) {
            setIsSuggesting(true);
            setSelectedCategory(''); // Reset on new transaction
            getAICategorySuggestion(currentTransaction.description, budgetCategories)
                .then(suggestion => {
                    if (suggestion && budgetCategories.includes(suggestion)) {
                        setSelectedCategory(suggestion);
                    }
                })
                .finally(() => setIsSuggesting(false));
        }
    }, [isOpen, currentTransaction, budgetCategories]);

    const handleSave = async () => {
        if (!currentTransaction || !selectedCategory) return;

        await updateTransaction({ ...currentTransaction, budgetCategory: selectedCategory });

        if (currentIndex < transactions.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            onClose();
        }
    };
    
    const handleSkip = () => {
        if (currentIndex < transactions.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            onClose();
        }
    }

    // Reset index when modal is closed/reopened
    useEffect(() => {
        if (!isOpen) {
            setCurrentIndex(0);
        }
    }, [isOpen]);

    if (!isOpen || !currentTransaction) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Review Transactions (${currentIndex + 1} of ${transactions.length})`}>
            <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg border">
                    <div className="flex justify-between items-baseline">
                        <p className="font-semibold text-lg text-dark">{currentTransaction.description}</p>
                        <p className="font-bold text-red-600">{formatCurrencyString(currentTransaction.amount)}</p>
                    </div>
                    <p className="text-sm text-gray-500">{new Date(currentTransaction.date).toLocaleDateString()}</p>
                </div>

                <div>
                    <label htmlFor="category-select" className="block text-sm font-medium text-gray-700 flex items-center">
                        <SparklesIcon className="h-4 w-4 mr-1 text-primary"/>
                        Suggested Budget Category
                    </label>
                    {isSuggesting ? (
                         <div className="mt-1 w-full p-2 h-10 bg-gray-100 rounded-md animate-pulse"></div>
                    ) : (
                        <select
                            id="category-select"
                            value={selectedCategory}
                            onChange={e => setSelectedCategory(e.target.value)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
                        >
                            <option value="" disabled>-- Select a category --</option>
                            {budgetCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                    )}
                </div>

                <div className="flex justify-end space-x-2 pt-4 border-t">
                    <button onClick={handleSkip} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">
                        Skip
                    </button>
                    <button onClick={handleSave} disabled={!selectedCategory || isSuggesting} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">
                        Save & Next
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default TransactionReviewModal;
