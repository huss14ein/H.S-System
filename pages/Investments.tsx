import React, { useMemo, useState, useCallback, useContext, useEffect, lazy, Suspense } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIStockAnalysis, executeInvestmentPlanStrategy } from '../services/geminiService';
import { InvestmentPortfolio, Holding, InvestmentTransaction, Account, Goal, InvestmentPlanSettings, TickerStatus, InvestmentPlanExecutionResult, InvestmentPlanExecutionLog, UniverseTicker } from '../types';
import Modal from '../components/Modal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';
import { EyeIcon } from '../components/icons/EyeIcon';
import AIRebalancerView from './AIRebalancerView';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import WatchlistView from './WatchlistView';
import TradeAdvicesView from './TradeAdvicesView';
import { BookOpenIcon } from '../components/icons/BookOpenIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { PlusIcon } from '../components/icons/PlusIcon';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import InvestmentOverview from './InvestmentOverview';
import { useMarketData } from '../context/MarketDataContext';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { LinkIcon } from '../components/icons/LinkIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import Card from '../components/Card';
import { CurrencyDollarIcon } from '../components/icons/CurrencyDollarIcon';


const DividendTrackerView = lazy(() => import('./DividendTrackerView'));




type InvestmentSubPage = 'Overview' | 'Portfolios' | 'Investment Plan' | 'Execution History' | 'Watchlist' | 'AI Rebalancer' | 'Trade Advices' | 'Dividend Tracker';

const INVESTMENT_SUB_PAGES: { name: InvestmentSubPage; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { name: 'Overview', icon: ChartPieIcon },
    { name: 'Portfolios', icon: Squares2X2Icon },
    { name: 'Investment Plan', icon: ClipboardDocumentListIcon },
    { name: 'Execution History', icon: BookOpenIcon },
    { name: 'Dividend Tracker', icon: CurrencyDollarIcon },
    { name: 'AI Rebalancer', icon: ScaleIcon },
    { name: 'Watchlist', icon: EyeIcon },
    { name: 'Trade Advices', icon: BookOpenIcon },
];



const PlanSummary: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0, core: 0, upside: 0 };
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const monthlyInvested = data.investmentTransactions
            .filter(t => {
                const d = new Date(t.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy';
            })
            .reduce((sum, t) => sum + t.total, 0);
        
        return {
            percent: Math.min((monthlyInvested / (data.investmentPlan.monthlyBudget || 1)) * 100, 100),
            amount: monthlyInvested,
            target: data.investmentPlan.monthlyBudget,
            core: data.investmentPlan.coreAllocation,
            upside: data.investmentPlan.upsideAllocation
        };
    }, [data]);

    if (!data?.investmentPlan) return null;

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                        <ClipboardDocumentListIcon className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-bold text-dark">Active Investment Plan</h3>
                    </div>
                    <p className="text-sm text-gray-500 mb-4">Your monthly strategy is set to invest <span className="font-bold text-dark">{formatCurrencyString(investmentProgress.target)}</span> with a {investmentProgress.core}% Core and {investmentProgress.upside}% High-Upside split.</p>
                    
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-400">
                            <span>Monthly Progress</span>
                            <span>{investmentProgress.percent.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-primary transition-all duration-1000 ease-out" 
                                style={{ width: `${investmentProgress.percent}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                            <span>Invested: {formatCurrencyString(investmentProgress.amount)}</span>
                            <span>Remaining: {formatCurrencyString(Math.max(0, investmentProgress.target - investmentProgress.amount))}</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 lg:w-72">
                    <div className="p-4 bg-slate-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Core Target</p>
                        <p className="text-sm font-bold text-dark">{formatCurrencyString(investmentProgress.target * (investmentProgress.core / 100))}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Upside Target</p>
                        <p className="text-sm font-bold text-dark">{formatCurrencyString(investmentProgress.target * (investmentProgress.upside / 100))}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RecordTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (trade: any, executedPlanId?: string) => void;
    investmentAccounts: Account[];
    portfolios: InvestmentPortfolio[];
    initialData?: Partial<{
        tradeType: 'buy' | 'sell';
        symbol: string;
        name: string;
        quantity: number;
        amount: number;
        price: number;
        executedPlanId: string;
    }> | null;
}> = ({ isOpen, onClose, onSave, investmentAccounts, portfolios, initialData }) => {
    const [accountId, setAccountId] = useState('');
    const [portfolioId, setPortfolioId] = useState('');
    const [type, setType] = useState<'buy' | 'sell'>('buy');
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [holdingName, setHoldingName] = useState('');
    const [executedPlanId, setExecutedPlanId] = useState<string | undefined>();
    const [amountToInvest, setAmountToInvest] = useState<number | null>(null);

    const portfoliosForAccount = useMemo(() => accountId ? portfolios.filter(p => p.accountId === accountId) : [], [accountId, portfolios]);
    
    const isNewHolding = useMemo(() => {
        if (type === 'buy' && portfolioId && symbol) {
            const portfolio = portfolios.find(p => p.id === portfolioId);
            return !portfolio?.holdings.some(h => h.symbol.toLowerCase() === symbol.toLowerCase().trim());
        }
        return false;
    }, [type, portfolioId, symbol, portfolios]);
    
    const resetForm = () => {
        setType('buy'); setSymbol(''); setQuantity(''); setPrice('');
        setDate(new Date().toISOString().split('T')[0]);
        setHoldingName('');
        setExecutedPlanId(undefined);
        setAmountToInvest(null);
        setAccountId(investmentAccounts[0]?.id || '');
    };

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setType(initialData.tradeType || 'buy');
                setSymbol(initialData.symbol || '');
                setHoldingName(initialData.name || '');
                setQuantity(initialData.quantity ? String(initialData.quantity) : '');
                setAmountToInvest(initialData.amount || null);
                setExecutedPlanId(initialData.executedPlanId);
                if (initialData.amount && !initialData.quantity && !initialData.price) {
                    setPrice('');
                    setQuantity('');
                }
            } else {
                resetForm();
            }
        }
    }, [isOpen, initialData, investmentAccounts]);

    useEffect(() => {
        if (portfoliosForAccount.length > 0) {
            setPortfolioId(portfoliosForAccount[0].id);
        } else {
            setPortfolioId('');
        }
    }, [portfoliosForAccount]);
    
    useEffect(() => {
        if (amountToInvest && price && type === 'buy') {
            const numPrice = parseFloat(price);
            if(numPrice > 0) {
                const calcQty = amountToInvest / numPrice;
                setQuantity(calcQty.toFixed(8).replace(/\.?0+$/, ""));
            }
        }
    }, [amountToInvest, price, type]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await onSave({
                accountId, portfolioId, type,
                symbol: symbol.toUpperCase().trim(),
                name: isNewHolding ? holdingName : undefined,
                quantity: parseFloat(quantity) || 0,
                price: parseFloat(price) || 0,
                date,
            }, executedPlanId);
            onClose();
        } catch (error) {
            alert(`Error recording trade: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record a Trade">
            <form onSubmit={handleSubmit} className="space-y-4">
                 {amountToInvest && <div className="p-2 bg-blue-50 text-blue-800 text-sm rounded-md text-center">Funds available from transfer: <span className="font-bold">{amountToInvest.toLocaleString()} SAR</span></div>}
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="account-id" className="block text-sm font-medium text-gray-700">Platform</label>
                        <select id="account-id" value={accountId} onChange={e => setAccountId(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                            <option value="" disabled>Select Platform</option>
                            {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="portfolio-id" className="block text-sm font-medium text-gray-700">Portfolio</label>
                        <select id="portfolio-id" value={portfolioId} onChange={e => setPortfolioId(e.target.value)} required disabled={portfoliosForAccount.length === 0} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary disabled:bg-gray-100">
                             <option value="" disabled>Select Portfolio</option>
                            {portfoliosForAccount.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex space-x-4">
                    <label className="flex items-center"><input type="radio" value="buy" checked={type === 'buy'} onChange={() => setType('buy')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Buy</span></label>
                    <label className="flex items-center"><input type="radio" value="sell" checked={type === 'sell'} onChange={() => setType('sell')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Sell</span></label>
                </div>
                 <div>
                    <label htmlFor="symbol" className="block text-sm font-medium text-gray-700">Symbol</label>
                    <input type="text" id="symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                {isNewHolding && (
                    <div>
                        <label htmlFor="holdingName" className="block text-sm font-medium text-gray-700">Company Name</label>
                        <input type="text" id="holdingName" value={holdingName} onChange={e => setHoldingName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" placeholder="e.g., Saudi Aramco"/>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity</label>
                        <input type="number" id="quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                     <div>
                        <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price per Share</label>
                        <input type="number" id="price" value={price} onChange={e => setPrice(e.target.value)} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                </div>
                <div>
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <button type="submit" disabled={!portfolioId} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">Record Trade</button>
            </form>
        </Modal>
    );
};

// ... other modals ...

// #region Portfolio View Components
const HoldingDetailModal: React.FC<{ isOpen: boolean, onClose: () => void, holding: (Holding & { gainLoss: number, gainLossPercent: number }) | null }> = ({ isOpen, onClose, holding }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);

    const handleGetAIAnalysis = useCallback(async () => {
        if (!holding) return;
        setIsLoading(true);
        setAiAnalysis('');
        setGroundingChunks([]);
        const { content, groundingChunks } = await getAIStockAnalysis(holding);
        setAiAnalysis(content);
        setGroundingChunks(groundingChunks);
        setIsLoading(false);
    }, [holding]);

    if (!holding) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for ${holding.name} (${holding.symbol})`}>
            <div className="space-y-4">
                <MiniPriceChart />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-center">
                    <div><dt className="text-gray-500">Market Value</dt><dd className="font-semibold text-dark text-base">{formatCurrencyString(holding.currentValue)}</dd></div>
                    <div><dt className="text-gray-500">Quantity</dt><dd className="font-semibold text-dark text-base">{holding.quantity}</dd></div>
                    <div><dt className="text-gray-500">Avg. Cost</dt><dd className="font-semibold text-dark text-base">{formatCurrencyString(holding.avgCost)}</dd></div>
                    <div><dt className="text-gray-500">Unrealized G/L</dt><dd className="font-semibold text-base">{formatCurrency(holding.gainLoss, { colorize: true })}</dd></div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-800">AI Analyst Report</h4>
                        <button onClick={handleGetAIAnalysis} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                            <SparklesIcon className="h-4 w-4 mr-2" />
                            {isLoading ? 'Generating...' : 'Generate Report'}
                        </button>
                    </div>
                    {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating analysis...</div>}
                    {aiAnalysis && !isLoading && (
                        <div className="mt-2">
                           <SafeMarkdownRenderer content={aiAnalysis} />
                        </div>
                    )}
                    {groundingChunks.length > 0 && (
                        <div className="text-xs text-gray-500 mt-4 pt-2 border-t">
                            <p className="font-semibold text-gray-700">Sources:</p>
                            <ul className="list-disc pl-5 mt-1 space-y-1">
                                {groundingChunks.map((chunk, index) => (
                                    chunk.web && <li key={index}><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{chunk.web.title || chunk.web.uri}</a></li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}

const HoldingEditModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (holding: Holding) => void, holding: Holding | null }> = ({ isOpen, onClose, onSave, holding }) => {
    const { data } = useContext(DataContext)!;
    const [name, setName] = useState('');
    const [zakahClass, setZakahClass] = useState<'Zakatable' | 'Non-Zakatable'>('Zakatable');
    const [goalId, setGoalId] = useState<string | undefined>();
    
    useEffect(() => {
        if (holding) {
            setName(holding.name || '');
            setZakahClass(holding.zakahClass);
            setGoalId(holding.goalId);
        }
    }, [holding, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (holding) {
            onSave({ ...holding, name, zakahClass, goalId });
            onClose();
        }
    };
    if (!holding) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${holding.symbol}`}>
             <form onSubmit={handleSubmit} className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700">Holding Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div>
                <div><label className="block text-sm font-medium text-gray-700">Zakat Classification</label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="mt-1 w-full p-2 border border-gray-300 rounded-md"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <div>
                    <label htmlFor="goal-link" className="block text-sm font-medium text-gray-700">Link to Goal</label>
                    <select 
                        id="goal-link"
                        value={goalId || 'none'} 
                        onChange={e => setGoalId(e.target.value === 'none' ? undefined : e.target.value)} 
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                    >
                        <option value="none">-- Not Linked --</option>
                        {data.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Changes</button>
            </form>
        </Modal>
    );
};


export const PortfolioModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (p: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'> | InvestmentPortfolio) => void;
    portfolioToEdit: InvestmentPortfolio | null;
    accountId: string | null;
    investmentAccounts: Account[];
    goals: Goal[];
}> = ({ isOpen, onClose, onSave, portfolioToEdit, accountId, investmentAccounts, goals }) => {
    const [name, setName] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [goalId, setGoalId] = useState<string | undefined>();

    useEffect(() => {
        if (isOpen) {
            setName(portfolioToEdit?.name || '');
            setSelectedAccountId(accountId || investmentAccounts[0]?.id || '');
            setGoalId(portfolioToEdit?.goalId);
        }
    }, [portfolioToEdit, isOpen, accountId, investmentAccounts]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (portfolioToEdit) {
                await onSave({ ...portfolioToEdit, name, goalId });
            } else {
                if (!selectedAccountId) {
                    alert("Please select an account for the new portfolio.");
                    return;
                }
                await onSave({ name, accountId: selectedAccountId, goalId });
            }
            onClose();
        } catch (error) {
            // Error handled in DataContext
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={portfolioToEdit ? 'Edit Portfolio' : 'Add New Portfolio'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {!portfolioToEdit && investmentAccounts.length > 0 && (
                    <div>
                        <label htmlFor="portfolio-account-id" className="block text-sm font-medium text-gray-700">Platform / Account</label>
                        <select 
                            id="portfolio-account-id" 
                            value={selectedAccountId} 
                            onChange={e => setSelectedAccountId(e.target.value)} 
                            required 
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary"
                        >
                            {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                    </div>
                )}
                {!portfolioToEdit && investmentAccounts.length === 0 && (
                    <p className="text-sm text-center text-red-600 bg-red-50 p-3 rounded-md">You must have at least one investment account to create a portfolio. Please add one from the 'Accounts' page.</p>
                )}
                <div>
                    <label htmlFor="portfolio-name" className="block text-sm font-medium text-gray-700">Portfolio Name</label>
                    <input type="text" id="portfolio-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/>
                </div>
                <div>
                    <label htmlFor="portfolio-goal-link" className="block text-sm font-medium text-gray-700">Link to Goal</label>
                    <select 
                        id="portfolio-goal-link"
                        value={goalId || 'none'} 
                        onChange={e => setGoalId(e.target.value === 'none' ? undefined : e.target.value)} 
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                    >
                        <option value="none">-- Not Linked --</option>
                        {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1 italic">Linking a portfolio will associate its total value with the selected goal.</p>
                </div>
                <button type="submit" disabled={!portfolioToEdit && investmentAccounts.length === 0} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">Save Portfolio</button>
            </form>
        </Modal>
    );
};

const ExecutionHistoryView: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [selectedLog, setSelectedLog] = useState<InvestmentPlanExecutionLog | null>(null);

    return (
        <div className="space-y-6 mt-4">
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Invested</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Trades</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.executionLogs.map(log => (
                            <tr key={log.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {log.status.toUpperCase()}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-dark">{formatCurrencyString(log.totalInvestment)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{log.trades.length} trades</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                    <button onClick={() => setSelectedLog(log)} className="text-primary hover:text-secondary font-medium">View Details</button>
                                </td>
                            </tr>
                        ))}
                        {data.executionLogs.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-10 text-center text-gray-500 italic">No execution logs found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedLog && (
                <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)} title={`Execution Log: ${new Date(selectedLog.created_at).toLocaleString()}`}>
                    <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                            <SafeMarkdownRenderer content={selectedLog.log_details} />
                        </div>
                        <div className="border-t pt-4">
                            <h4 className="font-semibold text-dark mb-2">Trades Executed</h4>
                            <div className="space-y-2">
                                {selectedLog.trades.map((trade, i) => (
                                    <div key={i} className="flex justify-between items-center p-2 border rounded bg-white">
                                        <div>
                                            <span className="font-bold">{trade.ticker}</span>
                                            <span className="text-xs text-gray-500 ml-2">({trade.reason})</span>
                                        </div>
                                        <span className="font-mono">{formatCurrencyString(trade.amount)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

// #endregion

// #region Platform View Components

const TransactionHistoryModal: React.FC<{ isOpen: boolean, onClose: () => void, transactions: InvestmentTransaction[], platformName: string }> = ({ isOpen, onClose, transactions, platformName }) => {
    const { formatCurrency } = useFormatCurrency();
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Transaction History: ${platformName}`}>
            <div className="max-h-[60vh] overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0"><tr><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th><th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map(t => (
                            <tr key={t.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium ${t.type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>{t.type.toUpperCase()}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm font-semibold text-dark">{t.symbol}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-bold text-dark">{formatCurrency(t.total, { colorize: false })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Modal>
    )
}

const PlatformCard: React.FC<{ 
    platform: Account;
    portfolios: InvestmentPortfolio[];
    transactions: InvestmentTransaction[];
    goals: Goal[];
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onAddPortfolio: (accountId: string) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; }) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
}> = (props) => {
    const { platform, portfolios, transactions, goals, onEditPlatform, onDeletePlatform, onAddPortfolio, onEditPortfolio, onDeletePortfolio, onHoldingClick, onEditHolding, simulatedPrices } = props;
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);

    const { totalValue, totalGainLoss, dailyPnL, totalInvested, totalWithdrawn, roi } = useMemo(() => {
        const allHoldings = portfolios.flatMap(p => p.holdings);
        
        const totalValue = allHoldings.reduce((sum, h) => {
            const priceInfo = simulatedPrices[h.symbol];
            const currentVal = priceInfo ? (priceInfo.price * h.quantity) : h.currentValue;
            return sum + currentVal;
        }, 0);
        
        // Sum all 'buy' transactions to get the total capital invested.
        const totalInvested = transactions
            .filter(t => t.type === 'buy')
            .reduce((sum, t) => sum + t.total, 0);
        
        // Sum all 'sell' transactions to get the total capital withdrawn.
        // The 'total' for sell transactions is stored as a positive number.
        const totalWithdrawn = transactions
            .filter(t => t.type === 'sell')
            .reduce((sum, t) => sum + t.total, 0);
        
        // Net capital is the difference between money in and money out.
        const netCapital = totalInvested - totalWithdrawn;

        // Unrealized P/L is the current market value minus the net capital invested.
        const totalGainLoss = totalValue - netCapital;

        // ROI is the return (gain/loss) as a percentage of the net capital invested.
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
        
        const dailyPnL = allHoldings.reduce((sum, h) => {
            const priceInfo = simulatedPrices[h.symbol];
            return priceInfo ? sum + (priceInfo.change * h.quantity) : sum;
        }, 0);
        return { totalValue, totalGainLoss, dailyPnL, totalInvested, totalWithdrawn, roi };
    }, [portfolios, transactions, simulatedPrices]);

    const holdingsWithGains = (holdings: Holding[]) => holdings.map(h => {
        const priceInfo = simulatedPrices[h.symbol];
        const currentMktPrice = priceInfo ? priceInfo.price : (h.currentValue / (h.quantity || 1));
        const liveValue = currentMktPrice * h.quantity;
        const totalCost = h.avgCost * h.quantity;
        const gainLoss = liveValue - totalCost;
        return { ...h, currentValue: liveValue, totalCost, gainLoss };
    }).sort((a,b) => b.currentValue - a.currentValue);
    
    const getGoalName = (goalId?: string) => goalId ? goals.find(g => g.id === goalId)?.name : undefined;

    return (
        <div className="bg-white p-6 rounded-lg shadow flex flex-col hover:shadow-xl transition-shadow duration-300 ease-in-out">
            {/* Platform Header */}
            <div className="border-b pb-4 mb-4">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center space-x-2"><h3 className="text-xl font-semibold text-dark">{platform.name}</h3><button onClick={() => onEditPlatform(platform)} className="text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4" /></button><button onClick={() => onDeletePlatform(platform)} className="text-gray-400 hover:text-red-500"><TrashIcon className="h-4 w-4" /></button></div>
                        <p className="text-2xl font-bold text-secondary">{formatCurrencyString(totalValue)}</p>
                    </div>
                    <button onClick={() => setIsTxnModalOpen(true)} className="flex items-center text-sm text-primary hover:underline"><ArrowsRightLeftIcon className="h-4 w-4 mr-1"/>Transaction Log</button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-center pt-3 border-t">
                    <div><dt className="text-xs text-gray-500">Unrealized P/L</dt><dd className="font-semibold">{formatCurrency(totalGainLoss, { colorize: true, digits: 0 })}</dd></div>
                    <div><dt className="text-xs text-gray-500">Daily P/L</dt><dd className="font-semibold">{formatCurrency(dailyPnL, { colorize: true, digits: 0 })}</dd></div>
                    <div><dt className="text-xs text-gray-500">Total ROI</dt><dd className={`font-semibold ${roi >= 0 ? 'text-success' : 'text-danger'}`}>{roi.toFixed(1)}%</dd></div>
                    <div className="col-span-1"><dt className="text-xs text-gray-500">Total Invested</dt><dd className="font-semibold text-dark">{formatCurrencyString(totalInvested, { digits: 0 })}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-gray-500">Total Withdrawn</dt><dd className="font-semibold text-dark">{formatCurrencyString(totalWithdrawn, { digits: 0 })}</dd></div>
                </div>
            </div>
            
            {/* Portfolios Section */}
            <div className="space-y-4">
                {portfolios.map(portfolio => (
                    <div key={portfolio.id} className="border rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-gray-800">{portfolio.name}</h4>
                                {portfolio.goalId && (
                                    <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100" title={`Linked to: ${getGoalName(portfolio.goalId)}`}>
                                        <LinkIcon className="h-3 w-3 mr-1" />
                                        {getGoalName(portfolio.goalId)}
                                    </span>
                                )}
                            </div>
                            <div><button onClick={() => onEditPortfolio(portfolio)} className="text-gray-400 hover:text-primary p-1"><PencilIcon className="h-4 w-4"/></button><button onClick={() => onDeletePortfolio(portfolio)} className="text-gray-400 hover:text-red-500 p-1"><TrashIcon className="h-4 w-4"/></button></div>
                        </div>
                         <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                            <div className="flex items-center text-xs text-gray-500 font-medium px-2 py-1 bg-gray-100 rounded-t-md sticky top-0">
                                <div className="flex-grow">Symbol</div>
                                <div className="w-24 text-left">Zakat Class</div>
                                <div className="w-24 text-right">Mkt Value</div>
                                <div className="w-24 text-right">Unrealized P/L</div>
                                <div className="w-24 text-right">Daily P/L</div>
                            </div>
                            {holdingsWithGains(portfolio.holdings).map(h => (
                                 <div key={h.id} className="group rounded-md hover:bg-gray-100 border bg-white p-2">
                                    <div className="flex items-center text-sm">
                                        <div className="flex-grow flex items-center gap-2 truncate">
                                            <button onClick={() => onHoldingClick({ ...h, gainLossPercent: (h.gainLoss / (h.totalCost || 1)) * 100 })} className="font-medium text-gray-900 text-left bg-transparent border-none p-0 hover:underline truncate" title={h.name}>{h.symbol}</button>
                                             <button onClick={() => onEditHolding(h)} className="text-gray-300 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"><PencilIcon className="h-3 w-3" /></button>
                                             {h.goalId && <span title={`Linked to: ${getGoalName(h.goalId)}`}><LinkIcon className="h-3 w-3 text-green-500" /></span>}
                                        </div>
                                        <div className="w-24 text-left">
                                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${h.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                                                {h.zakahClass}
                                            </span>
                                        </div>
                                        <div className="w-24 text-right font-semibold text-dark tabular-nums">{formatCurrencyString(h.currentValue, { digits: 0 })}</div>
                                        <div className="w-24 text-right font-medium text-xs tabular-nums">{formatCurrency(h.gainLoss, { colorize: true, digits: 0 })}</div>
                                        <div className="w-24 text-right font-medium text-xs tabular-nums">
                                            {formatCurrency(simulatedPrices[h.symbol]?.change * h.quantity || 0, { colorize: true, digits: 0 })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                         </div>
                    </div>
                ))}
                 <button onClick={() => onAddPortfolio(platform.id)} className="w-full mt-2 text-sm flex items-center justify-center gap-2 text-primary hover:bg-primary-50 p-2 rounded-lg border-2 border-dashed">
                    <PlusIcon className="h-5 w-5"/> Add Portfolio
                </button>
            </div>
            
            <TransactionHistoryModal isOpen={isTxnModalOpen} onClose={() => setIsTxnModalOpen(false)} transactions={transactions} platformName={platform.name} />
        </div>
    );
};


const PlatformView: React.FC<{
    onAddPlatform: () => void;
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onAddPortfolio: (accountId: string) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; }) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
}> = (props) => {
    const { data } = useContext(DataContext)!;

    const platformsData = useMemo(() => {
        const investmentAccounts = data.accounts.filter(acc => acc.type === 'Investment').sort((a,b) => a.name.localeCompare(b.name));
        return investmentAccounts.map(account => ({
            account,
            portfolios: data.investments.filter(p => p.accountId === account.id),
            transactions: data.investmentTransactions.filter(t => t.accountId === account.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        }));
    }, [data]);

    return (
        <div className="space-y-6 mt-4">
            <div className="flex justify-end">
                 <button onClick={props.onAddPlatform} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Platform</button>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                {platformsData.map(p => (
                    <PlatformCard key={p.account.id} platform={p.account} portfolios={p.portfolios} transactions={p.transactions} goals={data.goals} {...props} />
                ))}
            </div>
        </div>
    );
};

interface PlatformModalProps { isOpen: boolean; onClose: () => void; onSave: (platform: Account) => void; platformToEdit: Account | null; }
const PlatformModal: React.FC<PlatformModalProps> = ({ isOpen, onClose, onSave, platformToEdit }) => {
    const [name, setName] = useState('');
    useEffect(() => { if (platformToEdit) setName(platformToEdit.name); else setName(''); }, [platformToEdit, isOpen]);
    const handleSubmit = async (e: React.FormEvent) => { 
        e.preventDefault(); 
        try {
            await onSave({ ...(platformToEdit || { id: '', balance: 0 }), name, type: 'Investment' }); 
            onClose(); 
        } catch (error) {
            // Error handled in DataContext
        }
    };
    return ( <Modal isOpen={isOpen} onClose={onClose} title={platformToEdit ? 'Edit Platform' : 'Add New Platform'}><form onSubmit={handleSubmit} className="space-y-4"><div><label htmlFor="platform-name" className="block text-sm font-medium text-gray-700">Platform Name</label><input type="text" id="platform-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div><button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Platform</button></form></Modal> );
};

const InvestmentPlan: React.FC = () => {
    const { data, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    const [plan, setPlan] = useState<InvestmentPlanSettings>(data.investmentPlan);
    const [newTicker, setNewTicker] = useState({ ticker: '', name: '' });
    const [executionResult, setExecutionResult] = useState<InvestmentPlanExecutionResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);

    const unifiedUniverse = useMemo(() => {
        const universeMap = new Map<string, UniverseTicker & { source?: string }>();
        
        // 1. Start with explicit universe
        data.portfolioUniverse.forEach(t => universeMap.set(t.ticker, { ...t, source: 'Universe' }));
        
        // 2. Add holdings
        data.investments.flatMap(p => p.holdings).forEach(h => {
            if (!universeMap.has(h.symbol)) {
                universeMap.set(h.symbol, {
                    id: `holding-${h.id}`,
                    ticker: h.symbol,
                    name: h.name || h.symbol,
                    status: 'Core',
                    source: 'Holding'
                });
            } else {
                const existing = universeMap.get(h.symbol)!;
                universeMap.set(h.symbol, { ...existing, source: existing.source === 'Universe' ? 'Universe + Holding' : 'Holding' });
            }
        });
        
        // 3. Add watchlist
        data.watchlist.forEach(w => {
            if (!universeMap.has(w.symbol)) {
                universeMap.set(w.symbol, {
                    id: `watchlist-${w.symbol}`,
                    ticker: w.symbol,
                    name: w.name,
                    status: 'Watchlist',
                    source: 'Watchlist'
                });
            } else {
                const existing = universeMap.get(w.symbol)!;
                if (!existing.source?.includes('Watchlist')) {
                    universeMap.set(w.symbol, { ...existing, source: `${existing.source} + Watchlist` });
                }
            }
        });
        
        // 4. Add planned trades
        data.plannedTrades.forEach(t => {
            if (!universeMap.has(t.symbol)) {
                universeMap.set(t.symbol, {
                    id: `planned-${t.id}`,
                    ticker: t.symbol,
                    name: t.name || t.symbol,
                    status: 'Watchlist',
                    source: 'Trade Request'
                });
            } else {
                const existing = universeMap.get(t.symbol)!;
                if (!existing.source?.includes('Trade Request')) {
                    universeMap.set(t.symbol, { ...existing, source: `${existing.source} + Trade Request` });
                }
            }
        });
        
        return Array.from(universeMap.values());
    }, [data.portfolioUniverse, data.investments, data.watchlist, data.plannedTrades]);

    useEffect(() => {
        if (data.investmentPlan) {
            setPlan(data.investmentPlan);
        }
    }, [data.investmentPlan]);

    if (!plan || !plan.brokerConstraints) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-lg shadow">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                <p className="text-gray-500">Loading investment plan strategy...</p>
            </div>
        );
    }

    const handlePlanChange = (field: keyof InvestmentPlanSettings, value: any) => {
        setPlan(prev => ({ ...prev, [field]: value }));
    };

    const handleAddNewTicker = async () => {
        if (!newTicker.ticker || !newTicker.name) return;
        try {
            await addUniverseTicker({ ...newTicker, status: 'Watchlist' });
            setNewTicker({ ticker: '', name: '' });
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const handleSave = () => {
        saveInvestmentPlan(plan);
        alert('Investment plan saved!');
    };

    const handleStatusUpdate = async (ticker: UniverseTicker & { source?: string }, newStatus: TickerStatus) => {
        if (ticker.source === 'Universe' || ticker.source?.includes('Universe')) {
            await updateUniverseTickerStatus(ticker.id, newStatus);
        } else {
            // Promote virtual ticker to universe
            await addUniverseTicker({
                ticker: ticker.ticker,
                name: ticker.name,
                status: newStatus
            });
        }
    };

    const handleExecutePlan = async () => {
        setIsExecuting(true);
        setExecutionResult(null);
        try {
            const result = await executeInvestmentPlanStrategy(plan, data.portfolioUniverse);
            setExecutionResult(result);
            
            // Save to audit log
            const logEntry: InvestmentPlanExecutionLog = {
                ...result,
                id: `log-${Date.now()}`,
                user_id: '', // Handled by context
                created_at: new Date().toISOString(),
            };
            await saveExecutionLog(logEntry);
            
        } catch (error) {
            console.error("Error executing plan:", error);
            alert(`Error executing plan: ${error instanceof Error ? error.message : String(error)}`);
        }
        setIsExecuting(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Monthly Core + Analyst-Upside Sleeve Strategy</h1>
                <div className="flex items-center space-x-2">
                    <button onClick={handleSave} className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors">Save Plan</button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {/* Allocation Settings */}
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-xl font-semibold text-dark mb-4">Allocation Settings</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Monthly Budget</label>
                                <input type="number" value={plan.monthlyBudget} onChange={e => handlePlanChange('monthlyBudget', parseFloat(e.target.value))} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Budget Currency</label>
                                <input type="text" value={plan.budgetCurrency} disabled className="mt-1 w-full p-2 border rounded-md bg-gray-100" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Core Allocation (%)</label>
                                <input type="number" value={plan.coreAllocation * 100} onChange={e => handlePlanChange('coreAllocation', parseFloat(e.target.value) / 100)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">High-Upside Allocation (%)</label>
                                <input type="number" value={plan.upsideAllocation * 100} onChange={e => handlePlanChange('upsideAllocation', parseFloat(e.target.value) / 100)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700">Minimum Analyst Upside (%)</label>
                                <input type="number" value={plan.minimumUpsidePercentage} onChange={e => handlePlanChange('minimumUpsidePercentage', parseFloat(e.target.value))} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Stale Days (Analyst Target)</label>
                                <input type="number" value={plan.stale_days} onChange={e => handlePlanChange('stale_days', parseInt(e.target.value))} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Min Coverage (Analysts)</label>
                                <input type="number" value={plan.min_coverage_threshold} onChange={e => handlePlanChange('min_coverage_threshold', parseInt(e.target.value))} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Redirect Policy</label>
                                <select value={plan.redirect_policy} onChange={e => handlePlanChange('redirect_policy', e.target.value)} className="mt-1 w-full p-2 border rounded-md">
                                    <option value="pro-rata">Pro-rata (Balanced)</option>
                                    <option value="priority">Priority (Sequential)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Target Provider</label>
                                <input type="text" value={plan.target_provider} onChange={e => handlePlanChange('target_provider', e.target.value)} className="mt-1 w-full p-2 border rounded-md" placeholder="e.g. TipRanks, Yahoo Finance" />
                            </div>
                        </div>
                    </div>

                    {/* Broker & Execution Rules */}
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-xl font-semibold text-dark mb-4">Broker & Execution Rules</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Minimum Order Size ({plan.budgetCurrency})</label>
                                <input type="number" value={plan.brokerConstraints.minimumOrderSize} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, minimumOrderSize: parseFloat(e.target.value)})} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div className="flex items-center">
                                <input type="checkbox" checked={plan.brokerConstraints.allowFractionalShares} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, allowFractionalShares: e.target.checked})} id="fractional-shares" className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" />
                                <label htmlFor="fractional-shares" className="ml-2 block text-sm text-gray-900">Allow Fractional Shares</label>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Rounding Rule</label>
                                <select value={plan.brokerConstraints.roundingRule} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, roundingRule: e.target.value as any})} className="mt-1 w-full p-2 border rounded-md">
                                    <option value="round">Round to nearest</option>
                                    <option value="floor">Floor (round down)</option>
                                    <option value="ceil">Ceiling (round up)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Leftover Cash Rule</label>
                                <select value={plan.brokerConstraints.leftoverCashRule} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, leftoverCashRule: e.target.value as any})} className="mt-1 w-full p-2 border rounded-md">
                                    <option value="reinvest_core">Re-invest in Core</option>
                                    <option value="hold">Hold in account</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Portfolio Universe */}
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-xl font-semibold text-dark mb-4">Portfolio Universe & Weights</h2>
                        <p className="text-sm text-gray-500 mb-4">Define your assets, their status, and their monthly investment weights. Core and High-Upside assets will be invested according to these weights.</p>
                        <div className="flex gap-2 mb-4">
                            <input type="text" placeholder="Ticker (e.g., AAPL)" value={newTicker.ticker} onChange={e => setNewTicker(p => ({...p, ticker: e.target.value.toUpperCase()}))} className="p-2 border rounded-md" />
                            <input type="text" placeholder="Company Name" value={newTicker.name} onChange={e => setNewTicker(p => ({...p, name: e.target.value}))} className="flex-grow p-2 border rounded-md" />
                            <button onClick={handleAddNewTicker} className="p-2 bg-primary text-white rounded-md hover:bg-secondary"><PlusIcon className="h-5 w-5" /></button>
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 sticky top-0"><tr>
                                    <th className="px-4 py-2 text-left font-medium text-gray-500">Ticker</th>
                                    <th className="px-4 py-2 text-left font-medium text-gray-500">Name</th>
                                    <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                                    <th className="px-4 py-2 text-center font-medium text-gray-500">Monthly Wt</th>
                                    <th className="px-4 py-2 text-center font-medium text-gray-500">Max Pos Wt</th>
                                    <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
                                </tr></thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {unifiedUniverse.map(ticker => (
                                        <tr key={ticker.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 font-bold text-dark">
                                                {ticker.ticker}
                                                <div className="text-[10px] text-gray-400 font-normal">{ticker.source}</div>
                                            </td>
                                            <td className="px-4 py-2 text-gray-600">{ticker.name}</td>
                                            <td className="px-4 py-2">
                                                <select value={ticker.status} onChange={e => handleStatusUpdate(ticker, e.target.value as TickerStatus)} className="p-1 border rounded-md text-xs">
                                                    <option>Core</option>
                                                    <option>High-Upside</option>
                                                    <option>Watchlist</option>
                                                    <option>Quarantine</option>
                                                    <option>Speculative</option>
                                                    <option>Excluded</option>
                                                </select>
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <input 
                                                    type="number" 
                                                    value={ticker.monthly_weight ? ticker.monthly_weight * 100 : ''} 
                                                    onChange={e => updateUniverseTickerStatus(ticker.id, ticker.status, { monthly_weight: parseFloat(e.target.value) / 100 })}
                                                    className="w-16 p-1 border rounded text-right text-xs"
                                                    placeholder="0"
                                                />
                                                <span className="text-[10px] ml-1 text-gray-400">%</span>
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <input 
                                                    type="number" 
                                                    value={ticker.max_position_weight ? ticker.max_position_weight * 100 : ''} 
                                                    onChange={e => updateUniverseTickerStatus(ticker.id, ticker.status, { max_position_weight: parseFloat(e.target.value) / 100 })}
                                                    className="w-16 p-1 border rounded text-right text-xs"
                                                    placeholder="0"
                                                />
                                                <span className="text-[10px] ml-1 text-gray-400">%</span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {(ticker.source === 'Universe' || ticker.source?.includes('Universe')) && (
                                                    <button onClick={() => deleteUniverseTicker(ticker.id)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4" /></button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Execution & Results */}
                <div className="bg-white p-6 rounded-lg shadow">
                    <h2 className="text-xl font-semibold text-dark mb-4">Execute & View Results</h2>
                    <button onClick={handleExecutePlan} disabled={isExecuting} className="w-full flex items-center justify-center px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        {isExecuting ? 'Executing...' : 'Execute Monthly Plan'}
                    </button>

                    {isExecuting && <div className="text-center p-4 text-sm text-gray-500">Executing plan...</div>}

                    {executionResult && (
                        <div className="mt-4 space-y-4 text-sm">
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-semibold text-dark">Execution Summary</h3>
                                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${executionResult.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {executionResult.status.toUpperCase()}
                                    </span>
                                </div>
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    <dt className="text-gray-600">Total Investment:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.totalInvestment)}</dd>
                                    <dt className="text-gray-600">Core Allocation:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.coreInvestment)}</dd>
                                    <dt className="text-gray-600">Upside Allocation:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.upsideInvestment)}</dd>
                                    <dt className="text-gray-600">Speculative Allocation:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.speculativeInvestment)}</dd>
                                    <dt className="text-gray-600">Redirected Funds:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.redirectedInvestment)}</dd>
                                    <dt className="text-gray-600">Unused Funds:</dt>
                                    <dd className="font-mono text-right">{formatCurrencyString(executionResult.unusedUpsideFunds)}</dd>
                                </dl>
                            </div>

                            <div className="bg-blue-50 p-3 rounded-lg max-h-60 overflow-y-auto">
                                <h3 className="font-semibold text-blue-800 mb-2">Audit Log</h3>
                                <SafeMarkdownRenderer content={executionResult.log_details} />
                            </div>

                            <div>
                                <h3 className="font-semibold text-dark mb-2">Proposed Trades</h3>
                                <div className="space-y-2">
                                    {executionResult.trades.map((trade, index) => (
                                        <div key={index} className="p-3 border rounded-lg bg-white">
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-dark">{trade.ticker}</span>
                                                <span className="font-mono font-semibold text-primary">{formatCurrencyString(trade.amount)}</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">{trade.reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
// #endregion

interface InvestmentsProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
}

const Investments: React.FC<InvestmentsProps> = ({ pageAction, clearPageAction }) => {
  const { data, addPlatform, updatePlatform, deletePlatform, recordTrade, addPortfolio, updatePortfolio, deletePortfolio, updateHolding } = useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const { formatCurrency, formatCurrencyString } = useFormatCurrency();
  const [activeTab, setActiveTab] = useState<InvestmentSubPage>('Overview');
  
  const [isHoldingModalOpen, setIsHoldingModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<(Holding & { gainLoss: number; gainLossPercent: number; }) | null>(null);
  
  const [isHoldingEditModalOpen, setIsHoldingEditModalOpen] = useState(false);
  const [holdingToEdit, setHoldingToEdit] = useState<Holding | null>(null);
  
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [platformToEdit, setPlatformToEdit] = useState<Account | null>(null);
  
  const [itemToDelete, setItemToDelete] = useState<Account | InvestmentPortfolio | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeInitialData, setTradeInitialData] = useState<any>(null);

  const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
  const [portfolioToEdit, setPortfolioToEdit] = useState<InvestmentPortfolio|null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string|null>(null);

  const { totalValue, totalGainLoss, roi, totalDailyPnL, trendPercentage } = useMemo(() => {
    if (!data || !data.investments) {
        return { totalValue: 0, totalGainLoss: 0, roi: 0, totalDailyPnL: 0, trendPercentage: 0 };
    }
    
    const allHoldings = data.investments.flatMap(p => p.holdings || []);
    const allCommodities = data.commodityHoldings || [];
    
    const totalInvestmentsValue = allHoldings.reduce((sum, h) => {
        const priceInfo = simulatedPrices[h.symbol];
        return sum + (priceInfo ? (priceInfo.price * h.quantity) : h.currentValue);
    }, 0);
    const totalCommoditiesValue = allCommodities.reduce((sum, ch) => {
        const priceInfo = simulatedPrices[ch.symbol];
        return sum + (priceInfo ? (priceInfo.price * ch.quantity) : ch.currentValue);
    }, 0);
    const totalValue = totalInvestmentsValue + totalCommoditiesValue;

    const totalInvested = data.investmentTransactions.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
    const commodityCost = allCommodities.reduce((sum, ch) => sum + ch.purchaseValue, 0);
    const totalWithdrawn = Math.abs(data.investmentTransactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
    const netCapital = totalInvested + commodityCost - totalWithdrawn;
    
    const totalGainLoss = totalValue - netCapital;
    const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;

    const totalDailyPnL = [...allHoldings, ...allCommodities].reduce((sum, item) => {
        const priceInfo = simulatedPrices[item.symbol];
        return priceInfo ? sum + (priceInfo.change * item.quantity) : sum;
    }, 0);

    const previousTotalValue = totalValue - totalDailyPnL;
    const trendPercentage = previousTotalValue > 0 ? (totalDailyPnL / previousTotalValue) * 100 : 0;

    return { totalValue, totalGainLoss, roi, totalDailyPnL, trendPercentage };
  }, [data.investments, data.investmentTransactions, data.commodityHoldings, simulatedPrices]);


  const getTrendString = (trend: number) => {
    return `${trend >= 0 ? '+' : ''}${trend.toFixed(2)}%`;
  }

  useEffect(() => {
    if (pageAction?.startsWith('open-trade-modal')) {
        if (pageAction.includes(':with-amount:')) {
            const amount = pageAction.split(':with-amount:')[1];
            setTradeInitialData({ amount: parseFloat(amount) });
        } else {
            setTradeInitialData(null);
        }
        setIsTradeModalOpen(true);
        clearPageAction?.();
    }
  }, [pageAction, clearPageAction]);

  const investmentAccounts = useMemo(() => data.accounts.filter(acc => acc.type === 'Investment'), [data.accounts]);
  
  const handleHoldingClick = (holding: (Holding & { gainLoss: number; gainLossPercent: number; })) => { setSelectedHolding(holding); setIsHoldingModalOpen(true); };
  const handleOpenHoldingEditModal = (holding: Holding) => { setHoldingToEdit(holding); setIsHoldingEditModalOpen(true); };
    const handleSaveHolding = async (holding: Holding) => { 
        try {
            await updateHolding(holding); 
        } catch (error) {
            // Error already alerted in DataContext
        }
    };
  
  const handleOpenPlatformModal = (platform: Account | null = null) => { setPlatformToEdit(platform); setIsPlatformModalOpen(true); };
  
  const handleSavePlatform = async (platform: Account) => {
      try {
          if (platform.id) {
              await updatePlatform(platform);
          } else {
              const { id, balance, ...newPlatformData } = platform;
              await addPlatform(newPlatformData);
          }
      } catch (error) {
          // Error already alerted in DataContext
      }
  };

  const handleOpenDeleteModal = (item: Account | InvestmentPortfolio) => { setItemToDelete(item); setIsDeleteModalOpen(true); };
  const handleConfirmDelete = () => {
    if (!itemToDelete) return;
    if ('accountId' in itemToDelete) { // It's a portfolio
        deletePortfolio(itemToDelete.id);
    } else { // It's a platform
        deletePlatform(itemToDelete.id);
    }
    setItemToDelete(null);
    setIsDeleteModalOpen(false);
  };
  
  const handleOpenPortfolioModal = (portfolio: InvestmentPortfolio | null, accountId: string | null) => {
      setPortfolioToEdit(portfolio);
      setCurrentAccountId(accountId);
      setIsPortfolioModalOpen(true);
  };
  const handleSavePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'> | InvestmentPortfolio) => {
      try {
          if ('id' in portfolio && portfolio.id) {
              const { holdings, ...portfolioToUpdate } = portfolio as InvestmentPortfolio;
              await updatePortfolio(portfolioToUpdate);
          } else {
              await addPortfolio(portfolio as Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>);
          }
      } catch (error) {
          // Error already alerted in DataContext
      }
  };
  


  const handleCloseTradeModal = () => {
      setIsTradeModalOpen(false);
      setTradeInitialData(null);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'Overview': return <InvestmentOverview />;
      case 'Portfolios':
        return <PlatformView 
            simulatedPrices={simulatedPrices}
            onAddPlatform={() => handleOpenPlatformModal()} 
            onEditPlatform={handleOpenPlatformModal} 
            onDeletePlatform={(p) => handleOpenDeleteModal(p)}
            onAddPortfolio={(accountId) => handleOpenPortfolioModal(null, accountId)}
            onEditPortfolio={(p) => handleOpenPortfolioModal(p, p.accountId)}
            onDeletePortfolio={(p) => handleOpenDeleteModal(p)}
            onHoldingClick={handleHoldingClick}
            onEditHolding={handleOpenHoldingEditModal}
        />;
      case 'Investment Plan': return <InvestmentPlan />;
      case 'Execution History': return <ExecutionHistoryView />;
      case 'Dividend Tracker': return <DividendTrackerView />;
      case 'AI Rebalancer': return <AIRebalancerView />;
      case 'Watchlist': return <WatchlistView />;
      case 'Trade Advices': return <TradeAdvicesView />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
             <h1 className="text-3xl font-bold text-dark">Investments</h1>
             <div className="flex items-center space-x-2">
                <button onClick={() => handleOpenPlatformModal(null)} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm flex items-center"><PlusIcon className="h-4 w-4 mr-2" />Add Platform</button>
                <button onClick={() => handleOpenPortfolioModal(null, null)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center"><PlusIcon className="h-4 w-4 mr-2" />Add Portfolio</button>
                <button onClick={() => setIsTradeModalOpen(true)} className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 transition-colors text-sm flex items-center"><ArrowsRightLeftIcon className="h-4 w-4 mr-2" />Record Trade</button>
             </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card title="Total Investment Value" value={formatCurrencyString(totalValue)} />
            <Card title="Total Unrealized P/L" value={formatCurrency(totalGainLoss, { colorize: true })} />
            <Card title="Overall Portfolio ROI" value={`${roi.toFixed(2)}%`} valueColor={roi >= 0 ? 'text-success' : 'text-danger'} />
            <Card 
                title="Total Daily P/L" 
                value={formatCurrency(totalDailyPnL, { colorize: true, digits: 2 })}
                trend={getTrendString(trendPercentage)}
                tooltip="Total profit or loss for all investments based on today's simulated market changes."
            />
        </div>

        <PlanSummary />
      
        <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
            {INVESTMENT_SUB_PAGES.map(tab => (
                <button key={tab.name} onClick={() => setActiveTab(tab.name)} className={`${ activeTab === tab.name ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300' } group inline-flex items-center whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}><tab.icon className="-ml-0.5 mr-2 h-5 w-5" />{tab.name}</button>
            ))}
            </nav>
        </div>
      
      <Suspense fallback={<div className="text-center p-8">Loading...</div>}>
        {renderContent()}
      </Suspense>

      <HoldingDetailModal isOpen={isHoldingModalOpen} onClose={() => setIsHoldingModalOpen(false)} holding={selectedHolding} />
      <HoldingEditModal isOpen={isHoldingEditModalOpen} onClose={() => setIsHoldingEditModalOpen(false)} onSave={handleSaveHolding} holding={holdingToEdit} />
      <PlatformModal isOpen={isPlatformModalOpen} onClose={() => setIsPlatformModalOpen(false)} onSave={handleSavePlatform} platformToEdit={platformToEdit} />
      <PortfolioModal 
        isOpen={isPortfolioModalOpen} 
        onClose={() => setIsPortfolioModalOpen(false)} 
        onSave={handleSavePortfolio} 
        portfolioToEdit={portfolioToEdit} 
        accountId={currentAccountId}
        investmentAccounts={investmentAccounts}
        goals={data.goals}
      />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
      <RecordTradeModal 
        isOpen={isTradeModalOpen} 
        onClose={handleCloseTradeModal} 
        onSave={recordTrade} 
        investmentAccounts={investmentAccounts} 
        portfolios={data.investments}
        initialData={tradeInitialData}
      />
    </div>
  );
};

export default Investments;