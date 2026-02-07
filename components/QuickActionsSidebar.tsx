import React, { useState } from 'react';
import { Page } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { BuildingLibraryIcon } from './icons/BuildingLibraryIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';

interface QuickActionsSidebarProps {
    onAction: (page: Page, action: string) => void;
}

const QuickActionsSidebar: React.FC<QuickActionsSidebarProps> = ({ onAction }) => {
    const [isOpen, setIsOpen] = useState(false);

    const actions = [
        { name: 'Add Transaction', icon: CreditCardIcon, page: 'Transactions' as Page, action: 'open-transaction-modal' },
        { name: 'Add Asset', icon: BuildingLibraryIcon, page: 'Assets' as Page, action: 'open-asset-modal' },
        { name: 'Log a Trade', icon: ArrowTrendingUpIcon, page: 'Investments' as Page, action: 'open-trade-modal' },
    ];

    const handleActionClick = (page: Page, action: string) => {
        onAction(page, action);
        setIsOpen(false);
    };

    return (
        <div className="fixed bottom-6 right-6 z-20">
            <div className={`flex flex-col items-center space-y-3 transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {actions.map((action, index) => (
                    <button
                        key={action.name}
                        onClick={() => handleActionClick(action.page, action.action)}
                        className="group relative flex items-center justify-center w-14 h-14 bg-white rounded-full shadow-lg hover:bg-primary transition-colors"
                        style={{ transitionDelay: `${index * 30}ms` }}
                    >
                        <action.icon className="h-7 w-7 text-primary group-hover:text-white" />
                        <span className="absolute right-full mr-3 px-2 py-1 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {action.name}
                        </span>
                    </button>
                ))}
            </div>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-16 h-16 bg-primary text-white rounded-full shadow-lg flex items-center justify-center mt-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 hover:bg-secondary transition-transform duration-300 ease-in-out"
                style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0)' }}
            >
                <PlusIcon className="h-8 w-8" />
            </button>
        </div>
    );
};

export default QuickActionsSidebar;