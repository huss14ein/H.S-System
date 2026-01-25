
import React, { useState, useMemo } from 'react';
import { CheckIcon } from './icons/CheckIcon';
import { ChevronUpDownIcon } from './icons/ChevronUpDownIcon';

interface ComboboxProps {
    items: string[];
    selectedItem: string;
    onSelectItem: (item: string) => void;
    placeholder?: string;
}

const Combobox: React.FC<ComboboxProps> = ({ items, selectedItem, onSelectItem, placeholder = "Select or create..." }) => {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    const filteredItems = useMemo(() => {
        if (query === '') {
            return items;
        }
        return items.filter(item => item.toLowerCase().includes(query.toLowerCase()));
    }, [query, items]);

    const handleSelect = (item: string) => {
        onSelectItem(item);
        setQuery('');
        setIsOpen(false);
    };

    const isNewItem = query.length > 0 && !items.some(item => item.toLowerCase() === query.toLowerCase());

    return (
        <div className="relative">
            <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-primary sm:text-sm border border-gray-300">
                <input
                    className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:ring-0"
                    placeholder={placeholder}
                    value={query || selectedItem}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setIsOpen(true)}
                    onBlur={() => setTimeout(() => setIsOpen(false), 200)} // Delay to allow click on options
                />
                <button type="button" onClick={() => setIsOpen(!isOpen)} className="absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </button>
            </div>
            {isOpen && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                    {isNewItem && (
                        <li
                            className="relative cursor-default select-none py-2 px-4 text-gray-700 hover:bg-primary hover:text-white"
                            onClick={() => handleSelect(query)}
                        >
                           <span className="font-medium">Create "{query}"</span>
                        </li>
                    )}
                    {filteredItems.map((item) => (
                        <li
                            key={item}
                            className="relative cursor-default select-none py-2 pl-10 pr-4 text-gray-900 hover:bg-primary hover:text-white"
                            onClick={() => handleSelect(item)}
                        >
                           <span className={`block truncate ${selectedItem === item ? 'font-medium' : 'font-normal'}`}>{item}</span>
                            {selectedItem === item && (
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-dark">
                                    <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                </span>
                            )}
                        </li>
                    ))}
                     {filteredItems.length === 0 && !isNewItem && (
                        <div className="relative cursor-default select-none py-2 px-4 text-gray-700">
                            Nothing found.
                        </div>
                    )}
                </ul>
            )}
        </div>
    );
};

export default Combobox;
