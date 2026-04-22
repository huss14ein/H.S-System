import React, { useState, useMemo } from 'react';
import { Page } from '../types';
import { useSelfLearning } from '../context/SelfLearningContext';
import { PlusIcon } from './icons/PlusIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { BuildingLibraryIcon } from './icons/BuildingLibraryIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { BookOpenIcon } from './icons/BookOpenIcon';

interface QuickActionsSidebarProps {
    onAction: (page: Page, action: string) => void;
}

const BASE_ACTIONS = [
    { name: 'Add Transaction', icon: CreditCardIcon, page: 'Transactions' as Page, action: 'open-transaction-modal', actionId: 'add-transaction' },
    { name: 'Add Asset', icon: BuildingLibraryIcon, page: 'Assets' as Page, action: 'open-asset-modal', actionId: 'add-asset' },
    { name: 'Log a Trade', icon: ArrowTrendingUpIcon, page: 'Investments' as Page, action: 'open-trade-modal', actionId: 'log-trade' },
    { name: 'Notes & ideas', icon: BookOpenIcon, page: 'Engines & Tools' as Page, action: 'openJournal', actionId: 'notes-ideas' },
];

const QuickActionsSidebar: React.FC<QuickActionsSidebarProps> = ({ onAction }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { getTopActions, trackAction } = useSelfLearning();

    const actions = useMemo(() => {
        const top = getTopActions(undefined, 10);
        if (top.length === 0) return BASE_ACTIONS;
        return [...BASE_ACTIONS].sort((a, b) => {
            const aRank = top.findIndex(t => t.actionId === a.actionId);
            const bRank = top.findIndex(t => t.actionId === b.actionId);
            if (aRank === -1 && bRank === -1) return 0;
            if (aRank === -1) return 1;
            if (bRank === -1) return -1;
            return aRank - bRank;
        });
    }, [getTopActions]);

    const handleActionClick = (page: Page, action: string, actionId: string) => {
        trackAction(actionId, page);
        onAction(page, action);
        setIsOpen(false);
    };

    return (
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-20">
            <div className={`flex flex-col items-center space-y-3 transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {actions.map((action, index) => (
                    <button
                        key={action.name}
                        onClick={() => handleActionClick(action.page, action.action, action.actionId)}
                        className="group relative flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full shadow-lg hover:bg-primary transition-colors"
                        style={{ transitionDelay: `${index * 30}ms` }}
                    >
                        <action.icon className="h-6 w-6 sm:h-7 sm:w-7 text-primary group-hover:text-white" />
                        <span className="absolute right-full mr-3 hidden sm:inline-block px-2 py-1 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {action.name}
                        </span>
                    </button>
                ))}
            </div>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 sm:w-16 sm:h-16 bg-primary text-white rounded-full shadow-lg flex items-center justify-center mt-3 sm:mt-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 hover:bg-secondary transition-transform duration-300 ease-in-out"
                style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0)' }}
            >
                <PlusIcon className="h-7 w-7 sm:h-8 sm:w-8" />
            </button>
        </div>
    );
};

export default QuickActionsSidebar;