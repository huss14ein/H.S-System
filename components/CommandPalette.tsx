import React, { useState, useEffect, useMemo, useContext } from 'react';
import { NAVIGATION_ITEMS, PAGE_DISPLAY_NAMES, INVESTMENT_SUB_NAV_ITEMS } from '../constants';
import { Page } from '../types';
import { DataContext } from '../context/DataContext';
import { useSelfLearning } from '../context/SelfLearningContext';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';

interface CommandPaletteProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    setActivePage: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
    onOpenLiveAdvisor?: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, setIsOpen, setActivePage, triggerPageAction, onOpenLiveAdvisor }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const { data } = useContext(DataContext)!;
    const { getTopPages, trackAction } = useSelfLearning();
    const topPages = getTopPages(5);

    const commands = useMemo(() => {
        const navItems = [...NAVIGATION_ITEMS];
        if (topPages.length > 0) {
            navItems.sort((a, b) => {
                const aRank = topPages.findIndex(t => t.page === a.name);
                const bRank = topPages.findIndex(t => t.page === b.name);
                if (aRank === -1 && bRank === -1) return 0;
                if (aRank === -1) return 1;
                if (bRank === -1) return -1;
                return aRank - bRank;
            });
        }
        const nav = navItems.map(item => ({
            name: `Go to ${PAGE_DISPLAY_NAMES[item.name] ?? item.name}`,
            action: () => {
                trackAction(`go-to-${item.name}`, item.name);
                setActivePage(item.name);
                setIsOpen(false);
            },
            icon: item.icon,
        }));
        const subPages: { name: string; action: () => void; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [];
        if (triggerPageAction) {
            subPages.push({ name: 'Go to Safety & rules', action: () => { trackAction('safety-rules', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openRiskTradingHub'); setIsOpen(false); }, icon: NAVIGATION_ITEMS.find(i => i.name === 'Engines & Tools')!.icon });
            subPages.push({ name: 'Go to Sell priority', action: () => { trackAction('liquidation', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openLiquidation'); setIsOpen(false); }, icon: NAVIGATION_ITEMS.find(i => i.name === 'Engines & Tools')!.icon });
            subPages.push({ name: 'Go to Notes & ideas', action: () => { trackAction('journal', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openJournal'); setIsOpen(false); }, icon: NAVIGATION_ITEMS.find(i => i.name === 'Engines & Tools')!.icon });
            INVESTMENT_SUB_NAV_ITEMS.forEach((item) => {
                subPages.push({
                    name: `Go to Investments → ${PAGE_DISPLAY_NAMES[item.name] ?? item.name}`,
                    action: () => {
                        trackAction(`go-to-inv-${item.name}`, 'Investments');
                        triggerPageAction('Investments', `investment-tab:${item.name}`);
                        setIsOpen(false);
                    },
                    icon: item.icon,
                });
            });
        }
        const quick: { name: string; action: () => void; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [];
        if (onOpenLiveAdvisor) {
            quick.push({ name: 'Open AI Advisor', action: () => { trackAction('open-advisor', 'Dashboard'); onOpenLiveAdvisor(); setIsOpen(false); }, icon: HeadsetIcon });
        }
        quick.push({
            name: 'Export my data (backup)',
            action: () => {
                trackAction('export-backup', 'Dashboard');
                const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `finova-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setIsOpen(false);
            },
            icon: ArrowDownTrayIcon,
        });
        return [...quick, ...subPages, ...nav];
    }, [setActivePage, setIsOpen, triggerPageAction, onOpenLiveAdvisor, data, topPages, trackAction]);

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
                        className="w-full bg-transparent border-0 focus:ring-2 focus:ring-primary focus:outline-none rounded text-lg placeholder-gray-400"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                     <kbd className="ml-2 text-xs font-medium text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 hidden sm:inline">ESC</kbd>
                </div>
                <p className="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-100">Quick: Open AI Advisor · Export data · Go to any page</p>
                <ul className="max-h-80 overflow-y-auto p-2">
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