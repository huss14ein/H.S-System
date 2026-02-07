import React, { useState, useEffect, useMemo } from 'react';
import { NAVIGATION_ITEMS } from '../constants';
import { Page } from '../types';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';

interface CommandPaletteProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    setActivePage: (page: Page) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, setIsOpen, setActivePage }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    const commands = useMemo(() => {
        return NAVIGATION_ITEMS.map(item => ({
            name: `Go to ${item.name}`,
            action: () => setActivePage(item.name),
            icon: item.icon,
        }));
    }, [setActivePage]);

    const filteredCommands = useMemo(() => {
        if (!query) return commands;
        return commands.filter(command =>
            command.name.toLowerCase().includes(query.toLowerCase())
        );
    }, [query, commands]);
    
    // Effect to reset state when the palette is closed
    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    // Effect to reset selection when the query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isOpen) return;
            
            if (event.key === 'Escape') {
                setIsOpen(false);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (filteredCommands.length > 0) {
                    setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
                }
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (filteredCommands.length > 0) {
                    setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
                }
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (filteredCommands[selectedIndex]) {
                    filteredCommands[selectedIndex].action();
                    setIsOpen(false);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredCommands, selectedIndex, setIsOpen]);


    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24" onClick={() => setIsOpen(false)}>
            <div
                className="relative w-full max-w-xl bg-white rounded-lg shadow-2xl border"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center border-b p-2">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 mx-2" />
                    <input
                        type="text"
                        placeholder="Search for pages or actions..."
                        className="w-full bg-transparent border-0 focus:ring-0 text-lg placeholder-gray-400"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                     <kbd className="ml-4 mr-2 text-xs font-semibold text-gray-400 border rounded px-2 py-1">ESC</kbd>
                </div>
                <ul className="max-h-96 overflow-y-auto p-2">
                    {filteredCommands.length > 0 ? (
                        filteredCommands.map((command, index) => (
                           <li
                                key={command.name}
                                onMouseDown={() => {
                                    command.action();
                                    setIsOpen(false);
                                }}
                                className={`flex items-center space-x-3 p-3 rounded-md cursor-pointer ${selectedIndex === index ? 'bg-primary text-white' : 'hover:bg-gray-100'}`}
                           >
                               <command.icon className={`h-6 w-6 ${selectedIndex === index ? 'text-white' : 'text-gray-500'}`} />
                               <span className="text-base">{command.name}</span>
                           </li>
                        ))
                    ) : (
                        <p className="text-center text-gray-500 p-4">No results found.</p>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default CommandPalette;