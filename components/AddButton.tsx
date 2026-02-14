import React from 'react';
import { PlusIcon } from './icons/PlusIcon';

interface AddButtonProps {
    onClick: () => void;
    children: React.ReactNode;
}

const AddButton: React.FC<AddButtonProps> = ({ onClick, children }) => {
    return (
        <button 
            onClick={onClick} 
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"
        >
            <PlusIcon className="h-5 w-5"/>
            {children}
        </button>
    );
};

export default AddButton;
