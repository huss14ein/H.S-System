import React, { useState } from 'react';
import { PlusIcon } from './icons/PlusIcon';
import useClickOutside from '../hooks/useClickOutside';

interface ActionItem {
    label: string;
    icon: React.FC<{className?: string}>;
    onClick: () => void;
}

interface AddMenuProps {
    actions: ActionItem[];
}

const AddMenu: React.FC<AddMenuProps> = ({ actions }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const wrapperRef = useClickOutside<HTMLDivElement>(() => {
        setIsOpen(false);
    });

    const handleActionClick = (onClick: () => void) => {
        onClick();
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <button 
                onClick={() => setIsOpen(prev => !prev)} 
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"
            >
                <PlusIcon className="h-5 w-5"/>
                Add New
            </button>
            {isOpen && (
                 <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-20">
                    {actions.map((action, index) => (
                        <button
                            key={index}
                            onClick={() => handleActionClick(action.onClick)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        >
                            <action.icon className="h-5 w-5 text-gray-500" />
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AddMenu;
