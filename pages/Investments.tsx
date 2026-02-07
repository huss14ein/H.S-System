import React, { useMemo, useState, useCallback, useContext, useEffect, lazy, Suspense } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIStockAnalysis } from '../services/geminiService';
import { InvestmentPortfolio, Holding, InvestmentTransaction, Account, Goal, PlannedTrade } from '../types';
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
import { MoonIcon } from '../components/icons/MoonIcon';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import InvestmentOverview from './InvestmentOverview';
import { useMarketData } from '../context/MarketDataContext';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { LinkIcon } from '../components/icons/LinkIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';

const InvestmentPlanView = lazy(() => import('./InvestmentPlanView'));


type InvestmentSubPage = 'Overview' | 'Portfolios' | 'Investment Plan' | 'Watchlist' | 'AI Rebalancer' | 'Trade Advices';

const INVESTMENT_SUB_PAGES: { name: InvestmentSubPage; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { name: 'Overview', icon: ChartPieIcon },
    { name: 'Portfolios', icon: Squares2X2Icon },
    { name: 'Investment Plan', icon: ClipboardDocumentListIcon },
    { name: 'AI Rebalancer', icon: ScaleIcon },
    { name: 'Watchlist', icon: EyeIcon },
    { name: 'Trade Advices', icon: BookOpenIcon },
];

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

    const handleGetAIAnalysis = useCallback(async () => {
        if (!holding) return;
        setIsLoading(true);
        const analysis = await getAIStockAnalysis(holding);
        setAiAnalysis(analysis);
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
                        <h4 className="font-semibold text-gray-800">Fictional AI Analyst Report</h4>
                        <button onClick={handleGetAIAnalysis} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                            <SparklesIcon className="h-4 w-4 mr-2" />
                            {isLoading ? 'Generating...' : 'Generate Report'}
                        </button>
                    </div>
                    {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating fictional analysis...</div>}
                    {aiAnalysis && !isLoading && (
                        <div className="mt-2">
                           <SafeMarkdownRenderer content={aiAnalysis} />
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
    onSave: (p: any) => void;
    portfolioToEdit: InvestmentPortfolio | null;
    accountId: string | null;
    investmentAccounts: Account[];
}> = ({ isOpen, onClose, onSave, portfolioToEdit, accountId, investmentAccounts }) => {
    const [name, setName] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState('');

    useEffect(() => {
        if (isOpen) {
            setName(portfolioToEdit?.name || '');
            setSelectedAccountId(accountId || investmentAccounts[0]?.id || '');
        }
    }, [portfolioToEdit, isOpen, accountId, investmentAccounts]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (portfolioToEdit) {
            onSave({ ...portfolioToEdit, name });
        } else {
            if (!selectedAccountId) {
                alert("Please select an account for the new portfolio.");
                return;
            }
            onSave({ name, accountId: selectedAccountId });
        }
        onClose();
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
                <button type="submit" disabled={!portfolioToEdit && investmentAccounts.length === 0} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">Save Portfolio</button>
            </form>
        </Modal>
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

    const { totalValue, totalGainLoss, roi, dailyPnL } = useMemo(() => {
        const allHoldings = portfolios.flatMap(p => p.holdings);
        const totalValue = allHoldings.reduce((sum, h) => sum + h.currentValue, 0);
        const totalInvested = transactions.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
        const totalWithdrawn = Math.abs(transactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
        const netCapital = totalInvested - totalWithdrawn;
        const totalGainLoss = totalValue - netCapital;
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
        const dailyPnL = allHoldings.reduce((sum, h) => {
            const priceInfo = simulatedPrices[h.symbol];
            return priceInfo ? sum + (priceInfo.change * h.quantity) : sum;
        }, 0);
        return { totalValue, totalGainLoss, roi, dailyPnL };
    }, [portfolios, transactions, simulatedPrices]);

    const holdingsWithGains = (holdings: Holding[]) => holdings.map(h => {
        const totalCost = h.avgCost * h.quantity;
        const gainLoss = h.currentValue - totalCost;
        return { ...h, totalCost, gainLoss };
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
                <div className="mt-4 grid grid-cols-3 gap-x-2 text-center pt-3 border-t">
                    <div><dt className="text-xs text-gray-500">Unrealized P/L</dt><dd className={`font-semibold ${totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrencyString(totalGainLoss, { digits: 0 })}</dd></div>
                    <div><dt className="text-xs text-gray-500">Daily P/L</dt><dd className={`font-semibold ${dailyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrencyString(dailyPnL, { digits: 0 })}</dd></div>
                    <div><dt className="text-xs text-gray-500">Total ROI</dt><dd className={`font-semibold ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>{roi.toFixed(2)}%</dd></div>
                </div>
            </div>
            
            {/* Portfolios Section */}
            <div className="space-y-4">
                {portfolios.map(portfolio => (
                    <div key={portfolio.id} className="border rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-gray-800">{portfolio.name}</h4>
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
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...(platformToEdit || {}), id: platformToEdit?.id || '', name, type: 'Investment', balance: platformToEdit?.balance || 0 }); onClose(); };
    return ( <Modal isOpen={isOpen} onClose={onClose} title={platformToEdit ? 'Edit Platform' : 'Add New Platform'}><form onSubmit={handleSubmit} className="space-y-4"><div><label htmlFor="platform-name" className="block text-sm font-medium text-gray-700">Platform Name</label><input type="text" id="platform-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div><button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Platform</button></form></Modal> );
};
// #endregion

interface InvestmentsProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
}

const Investments: React.FC<InvestmentsProps> = ({ pageAction, clearPageAction }) => {
  const { data, addPlatform, updatePlatform, deletePlatform, recordTrade, addPortfolio, updatePortfolio, deletePortfolio, updateHolding } = useContext(DataContext)!;
  const { simulatedPrices } = useMarketData();
  const [activeTab, setActiveTab] = useState<InvestmentSubPage>('Portfolios');
  
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
  const handleSaveHolding = (holding: Holding) => { updateHolding(holding); };
  
  const handleOpenPlatformModal = (platform: Account | null = null) => { setPlatformToEdit(platform); setIsPlatformModalOpen(true); };
  const handleSavePlatform = (platform: Account) => { if (platform.id) updatePlatform(platform); else addPlatform(platform); };

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
  const handleSavePortfolio = (portfolio: any) => {
      if(portfolio.id) updatePortfolio(portfolio);
      else addPortfolio(portfolio);
  };
  
  const handleExecutePlan = (plan: PlannedTrade) => {
      setTradeInitialData({
          tradeType: plan.tradeType,
          symbol: plan.symbol,
          name: plan.name,
          quantity: plan.quantity,
          amount: plan.amount,
          executedPlanId: plan.id,
      });
      setIsTradeModalOpen(true);
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
      case 'Investment Plan': return <InvestmentPlanView onExecutePlan={handleExecutePlan} />;
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