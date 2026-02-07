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
        // When modal closes or transactions change, reset index
        if (!isOpen) {
            setCurrentIndex(0);
        }
    }, [isOpen, transactions]);

    useEffect(() => {
        // When the visible transaction changes, reset the category
        if(isOpen) {
           setSelectedCategory('');
        }
    }, [currentIndex, isOpen]);

    const handleSuggest = async () => {
        if (!currentTransaction) return;
        setIsSuggesting(true);
        try {
            const suggestion = await getAICategorySuggestion(currentTransaction.description, budgetCategories);
            if (suggestion && budgetCategories.includes(suggestion)) {
                setSelectedCategory(suggestion);
            }
        } catch (error) {
            console.error("AI Category Suggestion failed:", error);
        } finally {
            setIsSuggesting(false);
        }
    };

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
                    <label htmlFor="category-select" className="block text-sm font-medium text-gray-700">
                        Budget Category
                    </label>
                    <div className="mt-1 flex items-center space-x-2">
                        <select
                            id="category-select"
                            value={selectedCategory}
                            onChange={e => setSelectedCategory(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
                        >
                            <option value="" disabled>-- Select a category --</option>
                            {budgetCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <button 
                            type="button" 
                            onClick={handleSuggest} 
                            disabled={isSuggesting} 
                            className="p-2 bg-primary text-white rounded-md hover:bg-secondary disabled:bg-gray-400 flex-shrink-0"
                            title="Suggest Category with AI"
                        >
                            {isSuggesting ? (
                                 <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            ) : <SparklesIcon className="h-5 w-5"/>}
                        </button>
                    </div>
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