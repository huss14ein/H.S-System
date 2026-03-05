import React, { useMemo, useState, useCallback, useContext, useEffect, lazy, Suspense } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIStockAnalysis, buildFallbackAnalystReport, executeInvestmentPlanStrategy, formatAiError, getSuggestedAnalystEligibility } from '../services/geminiService';
import { InvestmentPortfolio, Holding, HoldingAssetClass, InvestmentTransaction, Account, Goal, InvestmentPlanSettings, TickerStatus, InvestmentPlanExecutionResult, InvestmentPlanExecutionLog, UniverseTicker, TradeCurrency } from '../types';
import type { Page } from '../types';
import Modal from '../components/Modal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';
import { EyeIcon } from '../components/icons/EyeIcon';
import AIRebalancerView from './AIRebalancerView';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import WatchlistView from './WatchlistView';
import RecoveryPlanView from './RecoveryPlanView';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { fetchCompanyNameForSymbol, useCompanyNames } from '../hooks/useSymbolCompanyName';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { PlusIcon } from '../components/icons/PlusIcon';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import InvestmentOverview from './InvestmentOverview';
import { useMarketData } from '../context/MarketDataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useAI } from '../context/AiContext';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import InfoHint from '../components/InfoHint';
import { LinkIcon } from '../components/icons/LinkIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import Card from '../components/Card';
import SectionCard from '../components/SectionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import LivePricesStatus from '../components/LivePricesStatus';
import { CurrencyDollarIcon } from '../components/icons/CurrencyDollarIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import type { HoldingFundamentals } from '../services/finnhubService';
import { getHoldingFundamentals } from '../services/finnhubService';


const DividendTrackerView = lazy(() => import('./DividendTrackerView'));




type InvestmentSubPage = 'Overview' | 'Portfolios' | 'Investment Plan' | 'Recovery Plan' | 'Watchlist' | 'AI Rebalancer' | 'Dividend Tracker';

class InvestmentTabErrorBoundary extends React.Component<
    { activeTab: InvestmentSubPage; onReset: () => void; children: React.ReactNode },
    { hasError: boolean; errorMessage: string | null }
> {
    state = { hasError: false, errorMessage: null as string | null };

    static getDerivedStateFromError(error: unknown) {
        return {
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Unexpected rendering error.',
        };
    }

    componentDidUpdate(prevProps: { activeTab: InvestmentSubPage }) {
        if (prevProps.activeTab !== this.props.activeTab && this.state.hasError) {
            this.setState({ hasError: false, errorMessage: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <SectionCard title="Section temporarily unavailable" className="border-amber-200 bg-amber-50/50">
                    <p className="text-sm text-amber-900">This section failed to render after inactivity. We prevented a full-page crash.</p>
                    {this.state.errorMessage && <p className="text-xs text-amber-700 mt-2">{this.state.errorMessage}</p>}
                    <button
                        type="button"
                        onClick={this.props.onReset}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-secondary text-sm font-medium"
                    >
                        Return to Overview
                    </button>
                </SectionCard>
            );
        }
        return this.props.children;
    }
}

const INVESTMENT_SUB_PAGES: { name: InvestmentSubPage; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { name: 'Overview', icon: ChartPieIcon },
    { name: 'Portfolios', icon: Squares2X2Icon },
    { name: 'Investment Plan', icon: ClipboardDocumentListIcon },
    { name: 'Recovery Plan', icon: ArrowsRightLeftIcon },
    { name: 'Dividend Tracker', icon: CurrencyDollarIcon },
    { name: 'AI Rebalancer', icon: ScaleIcon },
    { name: 'Watchlist', icon: EyeIcon },
];



const PlanSummary: React.FC<{ onEditPlan?: () => void }> = ({ onEditPlan }) => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0, corePct: 0.7, upsidePct: 0.3, specPct: 0 };
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const monthlyInvested = data.investmentTransactions
            .filter(t => {
                const d = new Date(t.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy';
            })
            .reduce((sum, t) => sum + t.total, 0);
        
        const corePct = data.investmentPlan.coreAllocation ?? 0.7;
        const upsidePct = data.investmentPlan.upsideAllocation ?? 0.3;
        const specPct = Math.max(0, 1 - corePct - upsidePct);
        return {
            percent: Math.min((monthlyInvested / (data.investmentPlan.monthlyBudget || 1)) * 100, 100),
            amount: monthlyInvested,
            target: data.investmentPlan.monthlyBudget,
            corePct,
            upsidePct,
            specPct,
        };
    }, [data]);

    if (!data?.investmentPlan) return null;

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center space-x-2">
                            <ClipboardDocumentListIcon className="h-5 w-5 text-primary" />
                            <h3 className="text-lg font-bold text-dark">Active Investment Plan</h3>
                        </div>
                        {onEditPlan && (
                            <button type="button" onClick={onEditPlan} className="text-sm font-medium text-primary hover:underline">Edit plan</button>
                        )}
                    </div>
                    <p className="text-sm text-gray-500 mb-4">Your monthly strategy is set to invest <span className="font-bold text-dark">{formatCurrencyString(investmentProgress.target)}</span> with a {(investmentProgress.corePct * 100).toFixed(0)}% Core, {(investmentProgress.upsidePct * 100).toFixed(0)}% High-Upside{investmentProgress.specPct > 0 ? ` and ${(investmentProgress.specPct * 100).toFixed(0)}% Spec` : ''} split.</p>
                    
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

                <div className={`grid gap-3 min-w-[240px] ${investmentProgress.specPct > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                        <p className="metric-label text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 w-full">Core Target</p>
                        <p className="metric-value text-sm font-bold text-dark w-full">{formatCurrencyString(investmentProgress.target * investmentProgress.corePct)}</p>
                        <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.corePct * 100).toFixed(0)}%</p>
                    </div>
                    <div className="p-3 rounded-xl border border-violet-100 bg-violet-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                        <p className="metric-label text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1 w-full">Upside Target</p>
                        <p className="metric-value text-sm font-bold text-dark w-full">{formatCurrencyString(investmentProgress.target * investmentProgress.upsidePct)}</p>
                        <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.upsidePct * 100).toFixed(0)}%</p>
                    </div>
                    {investmentProgress.specPct > 0 && (
                        <div className="p-3 rounded-xl border border-amber-100 bg-amber-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                            <p className="metric-label text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1 w-full">Spec Target</p>
                            <p className="metric-value text-sm font-bold text-dark w-full">{formatCurrencyString(investmentProgress.target * investmentProgress.specPct)}</p>
                            <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.specPct * 100).toFixed(0)}%</p>
                        </div>
                    )}
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
        tradeCurrency: TradeCurrency;
        executedPlanId: string;
        accountId: string;
        portfolioId: string;
        reason?: string;
    }> | null;
}> = ({ isOpen, onClose, onSave, investmentAccounts, portfolios, initialData }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const { currency: appCurrency } = useCurrency();
    const [accountId, setAccountId] = useState('');
    const [portfolioId, setPortfolioId] = useState('');
    const [type, setType] = useState<'buy' | 'sell' | 'deposit' | 'withdrawal'>('buy');
    const [tradeCurrency, setTradeCurrency] = useState<TradeCurrency>(appCurrency);
    const [cashAmount, setCashAmount] = useState('');
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [goalId, setGoalId] = useState<string | undefined>(undefined);
    const [holdingName, setHoldingName] = useState('');
    const [executedPlanId, setExecutedPlanId] = useState<string | undefined>();
    const [amountToInvest, setAmountToInvest] = useState<number | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const availableGoals = useMemo(() => data.goals || [], [data.goals]);
    const availableCashByCurrency = useMemo(() => (accountId ? getAvailableCashForAccount(accountId) : { SAR: 0, USD: 0 }), [accountId, getAvailableCashForAccount]);
    const selectedPortfolio = useMemo(
        () => (portfolioId ? portfolios.find(p => p.id === portfolioId) : null),
        [portfolioId, portfolios]
    );
    const availableCashInTradeCurrency = (selectedPortfolio?.currency === 'SAR' ? availableCashByCurrency.SAR : availableCashByCurrency.USD) ?? 0;

    const portfoliosForAccount = useMemo(() => accountId ? portfolios.filter(p => p.accountId === accountId) : [], [accountId, portfolios]);
    
    const isNewHolding = useMemo(() => {
        if (type === 'buy' && portfolioId && symbol) {
            const portfolio = portfolios.find(p => p.id === portfolioId);
            return !portfolio?.holdings.some(h => h.symbol.toLowerCase() === symbol.toLowerCase().trim());
        }
        return false;
    }, [type, portfolioId, symbol, portfolios]);
    
    const resetForm = () => {
        setType('buy'); setSymbol(''); setQuantity(''); setPrice(''); setCashAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setHoldingName('');
        setTradeCurrency(appCurrency);
        setExecutedPlanId(undefined);
        setAmountToInvest(null);
        setSubmitError(null);
        setIsSubmitting(false);
        setAccountId(investmentAccounts[0]?.id || '');
    };
    const isCashFlow = type === 'deposit' || type === 'withdrawal';

    useEffect(() => {
        if (isOpen) {
            setSubmitError(null);
            setIsSubmitting(false);
            setTradeCurrency(appCurrency);
            if (initialData) {
                setType(initialData.tradeType || 'buy');
                setSymbol(initialData.symbol || '');
                setHoldingName(initialData.name || '');
                const prefAmount = initialData.amount || null;
                const prefQuantity = initialData.quantity ?? null;
                const prefPrice = initialData.price ?? null;
                const resolvedPrice = prefPrice ?? (prefAmount && prefQuantity && prefQuantity > 0 ? prefAmount / prefQuantity : null);
                const resolvedQuantity = prefQuantity ?? (prefAmount && resolvedPrice && resolvedPrice > 0 ? prefAmount / resolvedPrice : null);
                setQuantity(typeof resolvedQuantity === 'number' && Number.isFinite(resolvedQuantity) ? String(Number(resolvedQuantity.toFixed(8))) : '');
                setPrice(typeof resolvedPrice === 'number' && Number.isFinite(resolvedPrice) ? String(Number(resolvedPrice.toFixed(8))) : '');
                setAmountToInvest(prefAmount);
                setExecutedPlanId(initialData.executedPlanId);
                if (initialData.tradeCurrency) setTradeCurrency(initialData.tradeCurrency);
                if (initialData.accountId) setAccountId(initialData.accountId);
                if (initialData.portfolioId) setPortfolioId(initialData.portfolioId);
                if (initialData.amount && !initialData.quantity && !initialData.price) {
                    setPrice('');
                    setQuantity('');
                }
            } else {
                resetForm();
            }
        }
    }, [isOpen, initialData, investmentAccounts, appCurrency]);

    useEffect(() => {
        if (initialData?.portfolioId && portfoliosForAccount.some((p) => p.id === initialData.portfolioId)) {
            setPortfolioId(initialData.portfolioId);
            return;
        }
        if (portfoliosForAccount.length > 0) {
            setPortfolioId(portfoliosForAccount[0].id);
        } else {
            setPortfolioId('');
        }
    }, [portfoliosForAccount, initialData?.portfolioId]);

    useEffect(() => {
        if (portfolioId && portfolios.length > 0) {
            if (initialData?.tradeCurrency) {
                setTradeCurrency(initialData.tradeCurrency);
                return;
            }
            const portfolio = portfolios.find(p => p.id === portfolioId);
            setTradeCurrency((portfolio?.currency as TradeCurrency) || 'USD');
        }
    }, [portfolioId, portfolios, initialData]);
    
    useEffect(() => {
        if (amountToInvest && price && type === 'buy') {
            const numPrice = parseFloat(price);
            if(numPrice > 0) {
                const calcQty = amountToInvest / numPrice;
                setQuantity(calcQty.toFixed(8).replace(/\.?0+$/, ""));
            }
        }
    }, [amountToInvest, price, type]);

    // Auto-fill company name from API when user enters a symbol (new holding)
    const holdingNameRef = React.useRef(holdingName);
    holdingNameRef.current = holdingName;
    useEffect(() => {
        if (!isOpen || type !== 'buy' || !symbol.trim() || symbol.trim().length < 2) return;
        const sym = symbol.trim().toUpperCase();
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((name) => {
                if (name && !holdingNameRef.current.trim()) setHoldingName(name);
            });
        }, 700);
        return () => clearTimeout(t);
    }, [symbol, isOpen, type]);

    const validationError = useMemo(() => {
        if (isCashFlow) {
            if (!accountId) return 'Please select a platform.';
            const amt = parseFloat(cashAmount);
            if (!Number.isFinite(amt) || amt <= 0) return 'Amount must be greater than 0.';
            return null;
        }
        if (!portfolioId) return 'Please select a portfolio.';
        const parsedQuantity = parseFloat(quantity);
        const parsedPrice = parseFloat(price);
        if (!symbol.trim()) return 'Symbol is required.';
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return 'Quantity must be greater than 0.';
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return 'Price must be greater than 0.';
        if (type === 'buy' && isNewHolding && !holdingName.trim()) return 'Company name is required for a new holding.';
        if (type === 'sell' && portfolioId) {
            const portfolio = portfolios.find(p => p.id === portfolioId);
            const normalized = symbol.toUpperCase().trim();
            const holding = portfolio?.holdings.find(h => h.symbol.toUpperCase().trim() == normalized);
            if (!holding) return 'Cannot sell: holding not found in selected portfolio.';
            if (holding.quantity < parsedQuantity) return `Cannot sell ${parsedQuantity}. Available quantity is ${holding.quantity}.`;
        }
        return null;
    }, [isCashFlow, accountId, cashAmount, portfolioId, quantity, price, symbol, type, isNewHolding, holdingName, portfolios]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setSubmitError(null);
        if (validationError) {
            setSubmitError(validationError);
            return;
        }
        try {
            setIsSubmitting(true);
            if (isCashFlow) {
                await onSave({
                    accountId,
                    type,
                    date,
                    symbol: 'CASH',
                    quantity: 0,
                    price: 0,
                    total: parseFloat(cashAmount) || 0,
                    currency: tradeCurrency,
                }, undefined);
            } else {
                await onSave({
                    accountId, portfolioId, type,
                    symbol: symbol.toUpperCase().trim(),
                    name: isNewHolding ? holdingName : undefined,
                    quantity: parseFloat(quantity) || 0,
                    price: parseFloat(price) || 0,
                    date,
                    currency: tradeCurrency,
                    ...(goalId && { goalId }),
                }, executedPlanId);
            }
            onClose();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const hasNoAccounts = !investmentAccounts.length;
    const hasNoPortfolios = accountId ? portfoliosForAccount.length === 0 : true;
    const submitDisabled = isCashFlow ? !accountId || !cashAmount || !!validationError || isSubmitting : (!!validationError || isSubmitting || hasNoPortfolios);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record a Trade">
            {initialData?.reason && (
                <div className="mb-4 p-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-xs font-medium">From plan execution: {initialData.reason}</div>
            )}
            {hasNoAccounts ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                    <p className="font-medium">No investment account yet</p>
                    <p className="mt-1">Add an <strong>Investment</strong> account in Accounts, then create a portfolio under Investments. After that you can record trades here.</p>
                </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
                 {accountId && !isCashFlow && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 space-y-1">
                        <p>Available cash in this platform (by currency):</p>
                        <p className="font-medium">SAR: <span className="font-semibold">{formatCurrencyString(availableCashByCurrency.SAR, { inCurrency: 'SAR', digits: 0 })}</span> · USD: <span className="font-semibold">{formatCurrencyString(availableCashByCurrency.USD, { inCurrency: 'USD', digits: 0 })}</span></p>
                        {selectedPortfolio && (
                            <p className="text-xs text-slate-600">Recording in <strong>{selectedPortfolio.currency || 'USD'}</strong>. Use the &quot;Record in&quot; dropdown to match your trade currency. You can record buys/sells for record-keeping even when cash is zero.</p>
                        )}
                    </div>
                 )}
                 {amountToInvest && <div className="p-2 bg-blue-50 text-blue-800 text-sm rounded-md text-center">Funds available from transfer: <span className="font-bold">{amountToInvest.toLocaleString()} {tradeCurrency}</span></div>}
                 {hasNoPortfolios && accountId && !isCashFlow && (
                    <div className="p-2 bg-amber-50 text-amber-800 text-sm rounded-md">No portfolio in this account. Create a portfolio first from the Investments page.</div>
                 )}
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="account-id" className="block text-sm font-medium text-gray-700">Platform</label>
                        <select id="account-id" value={accountId} onChange={e => setAccountId(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                            <option value="" disabled>Select Platform</option>
                            {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                    </div>
                    {!isCashFlow && (
                    <div>
                        <label htmlFor="portfolio-id" className="block text-sm font-medium text-gray-700">Portfolio</label>
                        <select id="portfolio-id" value={portfolioId} onChange={e => setPortfolioId(e.target.value)} required disabled={portfoliosForAccount.length === 0} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary disabled:bg-gray-100">
                             <option value="" disabled>Select Portfolio</option>
                            {portfoliosForAccount.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <label className="flex items-center"><input type="radio" value="buy" checked={type === 'buy'} onChange={() => setType('buy')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Buy</span></label>
                        <label className="flex items-center"><input type="radio" value="sell" checked={type === 'sell'} onChange={() => setType('sell')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Sell</span></label>
                        <label className="flex items-center"><input type="radio" value="deposit" checked={type === 'deposit'} onChange={() => setType('deposit')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Deposit</span></label>
                        <label className="flex items-center"><input type="radio" value="withdrawal" checked={type === 'withdrawal'} onChange={() => setType('withdrawal')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Withdrawal</span></label>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Record in</span>
                        <select value={tradeCurrency} onChange={e => setTradeCurrency(e.target.value as TradeCurrency)} className="text-sm font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 focus:ring-2 focus:ring-primary focus:border-primary">
                            <option value="USD">USD</option>
                            <option value="SAR">SAR</option>
                        </select>
                    </div>
                </div>
                {isCashFlow ? (
                    <>
                        <div>
                            <label htmlFor="cash-amount" className="block text-sm font-medium text-gray-700">Amount</label>
                            <input type="number" id="cash-amount" value={cashAmount} onChange={e => setCashAmount(e.target.value)} required min="0.01" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" placeholder="e.g. 50000" />
                        </div>
                        {type === 'withdrawal' && accountId && (
                            <p className="text-xs text-slate-500">Available to withdraw: {formatCurrencyString(availableCashInTradeCurrency, { inCurrency: tradeCurrency, digits: 0 })} (in {tradeCurrency})</p>
                        )}
                    </>
                ) : (
                <>
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
                    <label htmlFor="trade-goal" className="block text-sm font-medium text-gray-700">Link to Goal (Optional)</label>
                    <select id="trade-goal" value={goalId || ''} onChange={e => setGoalId(e.target.value || undefined)} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        <option value="">None</option>
                        {availableGoals.map(goal => (
                            <option key={goal.id} value={goal.id}>{goal.name}</option>
                        ))}
                    </select>
                </div>
                </>
                )}
                <div>
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                {(submitError || validationError) && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded p-2">{submitError || validationError}</p>}
                <button type="submit" disabled={submitDisabled} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">{isSubmitting ? 'Recording...' : isCashFlow ? (type === 'deposit' ? 'Record Deposit' : 'Record Withdrawal') : 'Record Trade'}</button>
            </form>
            )}
        </Modal>
    );
};

// ... other modals ...

// #region Portfolio View Components
const HoldingDetailModal: React.FC<{ isOpen: boolean; onClose: () => void; holding: (Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number }) | null; portfolio: InvestmentPortfolio | null }> = ({ isOpen, onClose, holding, portfolio }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);
    const [fundamentals, setFundamentals] = useState<HoldingFundamentals | null>(null);
    const [isFundamentalsLoading, setIsFundamentalsLoading] = useState(false);
    const [fundamentalsError, setFundamentalsError] = useState<string | null>(null);

    const handleGetAIAnalysis = useCallback(async (forceRefresh = false) => {
        if (!holding) return;
        setIsLoading(true);
        setAiAnalysisError(null);
        setGroundingChunks([]);
        try {
            const { content, groundingChunks: chunks } = await getAIStockAnalysis(holding, { forceRefresh });
            setAiAnalysis(content || buildFallbackAnalystReport(holding));
            setGroundingChunks(chunks ?? []);
        } catch (e) {
            setAiAnalysisError(formatAiError(e));
            setAiAnalysis(buildFallbackAnalystReport(holding));
        } finally {
            setIsLoading(false);
        }
    }, [holding]);

    useEffect(() => {
        if (holding && isOpen && !aiAnalysis && !isLoading) {
            setAiAnalysis(buildFallbackAnalystReport(holding));
        }
    }, [holding, isOpen, aiAnalysis, isLoading]);

    const lastAnalystRequestRef = React.useRef<string | null>(null);


    useEffect(() => {
        if (!isOpen) {
            lastAnalystRequestRef.current = null;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!holding || !isOpen || isLoading) return;
        if (lastAnalystRequestRef.current === holding.id) return;
        lastAnalystRequestRef.current = holding.id;
        handleGetAIAnalysis(false);
    }, [holding, isOpen, isLoading, handleGetAIAnalysis]);

    useEffect(() => {
        if (!holding || !isOpen) return;
        let cancelled = false;
        setIsFundamentalsLoading(true);
        setFundamentalsError(null);
        getHoldingFundamentals(holding.symbol)
            .then((data) => {
                if (!cancelled) {
                    setFundamentals(data);
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setFundamentalsError(e instanceof Error ? e.message : 'Unable to load upcoming events.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsFundamentalsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [holding?.symbol, isOpen]);

    if (!holding) return null;

    const portfolioCurrency: TradeCurrency = (portfolio?.currency as TradeCurrency) || 'USD';
    const fundamentalsCurrencyRaw = (fundamentals?.currency || '').toUpperCase();
    const fundamentalsCurrency: TradeCurrency =
        fundamentalsCurrencyRaw === 'SAR' ? 'SAR' : 'USD';

    const fmt = (val: number, opts?: { digits?: number }) => formatCurrencyString(val, { inCurrency: portfolioCurrency, ...opts });
    const fmtColor = (val: number, opts?: { digits?: number }) => formatCurrency(val, { inCurrency: portfolioCurrency, colorize: false, ...opts });
    const fmtFundamentals = (val: number, opts?: { digits?: number }) =>
        formatCurrencyString(val, { inCurrency: fundamentalsCurrency, ...opts });

    const displayName = holding.name || (holding as any).name || holding.symbol;
    const priceTrendPercent = holding.priceChangePercent ?? holding.gainLossPercent;
    const currentPrice = holding.quantity > 0 ? holding.currentValue / holding.quantity : holding.avgCost ?? 0;
    const totalCost = (holding.avgCost ?? 0) * holding.quantity;
    const toSAR = (valueUsd: number) => valueUsd * exchangeRate;
    const toUSD = (valueSar: number) => valueSar / exchangeRate;
    const formatSAR = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    const formatUSD = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`${holding.symbol} — Share details`}>
            <div className="space-y-6 min-w-0">
                {/* Hero: symbol, name, price, change — in portfolio currency; content contained */}
                <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-white border border-slate-100 p-5 sm:p-6 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-1 sm:gap-x-3 min-w-0">
                        <span className="metric-label text-2xl font-bold text-slate-900 break-words" title={holding.symbol}>{holding.symbol}</span>
                        <span className="hidden sm:inline text-slate-500 shrink-0">·</span>
                        <span className="metric-label text-base text-slate-600 font-medium min-w-0 break-words" title={displayName}>{displayName}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 min-w-0">
                        <span className="metric-value text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums max-w-full" title={fmt(currentPrice)}>{fmt(currentPrice)}</span>
                        <span className={`metric-value text-lg font-semibold tabular-nums shrink-0 ${priceTrendPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {priceTrendPercent >= 0 ? '+' : ''}{priceTrendPercent.toFixed(2)}%
                        </span>
                        <span className="text-sm text-slate-500 shrink-0">today · per share · {portfolioCurrency}</span>
                    </div>
                </div>

                {/* Key metrics grid — in portfolio currency */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 min-w-0">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0 flex flex-col items-center justify-between text-center min-h-[132px] shadow-sm">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Market Value</p>
                        <p className="share-detail-metric-value w-full mt-1 text-xl font-bold text-slate-900 tabular-nums whitespace-nowrap leading-tight" title={fmt(holding.currentValue)}>{fmt(holding.currentValue)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0 flex flex-col items-center justify-between text-center min-h-[132px] shadow-sm">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Quantity</p>
                        <p className="metric-value w-full mt-1 text-xl font-bold text-slate-900 tabular-nums whitespace-nowrap leading-tight">{holding.quantity.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0 flex flex-col items-center justify-between text-center min-h-[132px] shadow-sm">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg. Cost</p>
                        <p className="share-detail-metric-value w-full mt-1 text-xl font-bold text-slate-900 tabular-nums whitespace-nowrap leading-tight" title={fmt(holding.avgCost ?? 0)}>{fmt(holding.avgCost ?? 0)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0 flex flex-col items-center justify-between text-center min-h-[132px] shadow-sm">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Unrealized G/L</p>
                        <p className={`share-detail-metric-value w-full mt-1 text-xl font-bold tabular-nums whitespace-nowrap leading-tight ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={fmt(holding.gainLoss)}>{fmtColor(holding.gainLoss)}</p>
                        <p className="w-full text-xs text-slate-500 mt-2 leading-tight" title={fmt(totalCost)}>on cost {fmt(totalCost)}</p>
                    </div>
                </div>

                {/* Converted value — SAR when portfolio is USD, USD when portfolio is SAR (hint/side) */}
                {portfolioCurrency === 'USD' ? (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 min-w-0 overflow-hidden">
                        <p className="share-detail-metric-label text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-2">≈ In Saudi Riyal (SAR)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm min-w-0">
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Market value</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatSAR(toSAR(holding.currentValue))}>{formatSAR(toSAR(holding.currentValue))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Cost basis</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatSAR(toSAR(totalCost))}>{formatSAR(toSAR(totalCost))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Unrealized G/L</p>
                                <p className={`share-detail-metric-value w-full font-bold tabular-nums ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={formatSAR(toSAR(holding.gainLoss))}>{formatSAR(toSAR(holding.gainLoss))}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 overflow-hidden">
                        <p className="share-detail-metric-label text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">≈ In USD</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm min-w-0">
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Market value</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatUSD(toUSD(holding.currentValue))}>{formatUSD(toUSD(holding.currentValue))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Cost basis</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatUSD(toUSD(totalCost))}>{formatUSD(toUSD(totalCost))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Unrealized G/L</p>
                                <p className={`share-detail-metric-value w-full font-bold tabular-nums ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={formatUSD(toUSD(holding.gainLoss))}>{formatUSD(toUSD(holding.gainLoss))}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Upcoming financials & income */}
                <div className="rounded-xl border border-slate-100 bg-white p-4 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-slate-700 break-words">Next financial statement & dividends</p>
                        {isFundamentalsLoading && <p className="text-xs text-slate-400">Loading...</p>}
                    </div>
                    {fundamentalsError && (
                        <p className="text-xs text-rose-600 mb-2">Could not load event details right now.</p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 text-sm">
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Next financial statement</p>
                            {fundamentals?.nextEarnings?.date ? (
                                <>
                                    <p className="text-slate-800">
                                        {new Date(fundamentals.nextEarnings.date).toLocaleDateString(undefined, {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                        {fundamentals.nextEarnings.quarter != null && fundamentals.nextEarnings.year != null && (
                                            <span className="text-xs text-slate-500 ml-1">
                                                · Q{fundamentals.nextEarnings.quarter} {fundamentals.nextEarnings.year}
                                            </span>
                                        )}
                                    </p>
                                    {typeof fundamentals.nextEarnings.revenueEstimate === 'number' && fundamentals.nextEarnings.revenueEstimate > 0 && (
                                        <p className="text-xs text-slate-600">
                                            Expected revenue ({fundamentalsCurrency}):{' '}
                                            {fmtFundamentals(fundamentals.nextEarnings.revenueEstimate, { digits: 0 })}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-slate-500">No upcoming earnings date available.</p>
                            )}
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dividends</p>
                            {fundamentals?.dividend ? (
                                <>
                                    {typeof fundamentals.dividend.dividendYieldPct === 'number' && fundamentals.dividend.dividendYieldPct > 0 && (
                                        <p className="text-slate-800">
                                            Dividend yield: {fundamentals.dividend.dividendYieldPct.toFixed(2)}%
                                        </p>
                                    )}
                                    {typeof fundamentals.dividend.dividendPerShareAnnual === 'number' &&
                                        fundamentals.dividend.dividendPerShareAnnual > 0 && (
                                            <p className="text-xs text-slate-600">
                                                Est. annual dividends on your position ({fundamentalsCurrency}):{' '}
                                                {fmtFundamentals(fundamentals.dividend.dividendPerShareAnnual * holding.quantity, { digits: 0 })}
                                            </p>
                                        )}
                                    {!fundamentals.dividend.dividendYieldPct && !fundamentals.dividend.dividendPerShareAnnual && (
                                        <p className="text-xs text-slate-500">No dividend data available.</p>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-slate-500">No dividend data available.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Price trend chart */}
                <div className="rounded-xl border border-slate-100 bg-white p-4 min-w-0 overflow-hidden">
                    <p className="text-sm font-semibold text-slate-700 mb-3 break-words">Price trend</p>
                    <MiniPriceChart
                        symbol={holding.symbol}
                        currentPrice={currentPrice}
                        changePercent={priceTrendPercent}
                        formatPrice={(p) => fmt(p)}
                    />
                </div>

                {/* AI Analyst */}
                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-amber-50/50 to-white p-5 min-w-0 overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 min-w-0">
                        <div className="min-w-0">
                            <h4 className="font-semibold text-slate-800 break-words">Analyst Report</h4>
                            <p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleGetAIAnalysis(true)}
                            disabled={isLoading}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-secondary disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                            <SparklesIcon className="h-4 w-4" />
                            {isLoading ? 'Generating...' : 'Generate Report'}
                        </button>
                    </div>
                    {isLoading && <div className="text-center py-8 text-sm text-slate-500">Generating analysis...</div>}
                    {aiAnalysisError && !isLoading && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">AI analyst service is temporarily unavailable ({aiAnalysisError}). We loaded a resilient fallback report below. Use Generate Report to retry live AI analysis.</p>
                    )}
                    {aiAnalysis && !isLoading && (
                        <div className="prose prose-sm max-w-none mt-3 text-slate-700 min-w-0 overflow-hidden break-words">
                            <SafeMarkdownRenderer content={aiAnalysis} />
                        </div>
                    )}
                    {groundingChunks.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Sources</p>
                            <ul className="text-xs text-slate-500 space-y-1">
                                {groundingChunks.map((chunk, index) => (
                                    chunk.web && (
                                        <li key={index}>
                                            <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                                {chunk.web.title || chunk.web.uri}
                                            </a>
                                        </li>
                                    )
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

const HoldingEditModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (holding: Holding) => void, holding: Holding | null }> = ({ isOpen, onClose, onSave, holding }) => {
    const { data } = useContext(DataContext)!;
    const [name, setName] = useState('');
    const [zakahClass, setZakahClass] = useState<'Zakatable' | 'Non-Zakatable'>('Zakatable');
    const [assetClass, setAssetClass] = useState<HoldingAssetClass>('Stock');
    const [goalId, setGoalId] = useState<string | undefined>();
    
    useEffect(() => {
        if (holding) {
            const currentName = holding.name || (holding as any).name || '';
            setName(currentName);
            setZakahClass(holding.zakahClass);
            setAssetClass((holding.assetClass as HoldingAssetClass) || 'Stock');
            setGoalId(holding.goalId);
            if (!currentName.trim() && holding.symbol.trim().length >= 2) {
                fetchCompanyNameForSymbol(holding.symbol).then((apiName) => {
                    if (apiName) setName(apiName);
                });
            }
        }
    }, [holding, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (holding) {
            onSave({ ...holding, name, zakahClass, assetClass, goalId });
            onClose();
        }
    };
    if (!holding) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${holding.symbol}`}>
             <form onSubmit={handleSubmit} className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700">Holding Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Asset Class</label>
                    <select value={assetClass} onChange={e => setAssetClass(e.target.value as HoldingAssetClass)} className="mt-1 w-full p-2 border border-gray-300 rounded-md">
                        <option value="Stock">Stock</option>
                        <option value="Sukuk">Sukuk</option>
                        <option value="ETF">ETF</option>
                        <option value="Mutual Fund">Mutual Fund</option>
                        <option value="REIT">REIT</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
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
    const [currency, setCurrency] = useState<TradeCurrency>('USD');

    useEffect(() => {
        if (isOpen) {
            setName(portfolioToEdit?.name || '');
            setSelectedAccountId(accountId || investmentAccounts[0]?.id || '');
            setGoalId(portfolioToEdit?.goalId);
            setCurrency((portfolioToEdit?.currency as TradeCurrency) || 'USD');
        }
    }, [portfolioToEdit, isOpen, accountId, investmentAccounts]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (portfolioToEdit) {
                await onSave({ ...portfolioToEdit, name, goalId, currency });
            } else {
                if (!selectedAccountId) {
                    alert("Please select an account for the new portfolio.");
                    return;
                }
                await onSave({ name, accountId: selectedAccountId, goalId, currency });
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
                    <label htmlFor="portfolio-currency" className="block text-sm font-medium text-gray-700">Base currency</label>
                    <select id="portfolio-currency" value={currency} onChange={e => setCurrency(e.target.value as TradeCurrency)} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        <option value="USD">USD (US market)</option>
                        <option value="SAR">SAR (Tadawul / Saudi)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">All holdings in this portfolio are shown in this currency. Record trades in the same currency.</p>
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

// #endregion

// #region Platform View Components

const TransactionHistoryModal: React.FC<{ isOpen: boolean, onClose: () => void, transactions: InvestmentTransaction[], platformName: string }> = ({ isOpen, onClose, transactions, platformName }) => {
    const { formatCurrencyString } = useFormatCurrency();
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Transaction History: ${platformName}`}>
            <div className="max-h-[60vh] overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Currency</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map(t => {
                            const cur = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency;
                            return (
                                <tr key={t.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium ${t.type === 'buy' || t.type === 'deposit' ? 'text-green-600' : t.type === 'sell' || t.type === 'withdrawal' ? 'text-red-600' : 'text-blue-600'}`}>{t.type.toUpperCase()}</td>
                                    <td className="px-4 py-2 whitespace-nowrap text-sm font-semibold text-dark">{t.symbol === 'CASH' ? '—' : t.symbol}</td>
                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-center font-bold text-dark">{formatCurrencyString(t.total ?? 0, { inCurrency: cur })}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-center text-xs font-medium text-slate-600">{cur}</td>
                                </tr>
                            );
                        })}
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
    availableCashByCurrency?: { SAR: number; USD: number };
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }, portfolio: InvestmentPortfolio) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
}> = (props) => {
    const { platform, portfolios, transactions, goals, availableCashByCurrency = { SAR: 0, USD: 0 }, onEditPlatform, onDeletePlatform, onEditPortfolio, onDeletePortfolio, onHoldingClick, onEditHolding, simulatedPrices } = props;
    const { formatCurrencyString, formatCurrency } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);

    const platformCurrency = useMemo(() => {
        const currencies = [...new Set(portfolios.map(p => p.currency || 'USD'))];
        return currencies.length === 1 ? (currencies[0] as TradeCurrency) : undefined;
    }, [portfolios]);
    const hasMixedCurrencies = platformCurrency === undefined && portfolios.length > 1;

    const { totalValue, totalValueInSAR, totalGainLoss, dailyPnL, totalInvested, totalWithdrawn, roi, totalAvailable } = useMemo(() => {
        const allHoldings = portfolios.flatMap(p => p.holdings || []);
        const rate = exchangeRate;
        let valueSAR = 0, valueUSD = 0;
        portfolios.forEach(p => {
            const cur = (p.currency || 'USD') as TradeCurrency;
            const v = (p.holdings || []).reduce((s, h) => s + (simulatedPrices[h.symbol] ? simulatedPrices[h.symbol].price * h.quantity : h.currentValue), 0);
            if (cur === 'SAR') valueSAR += v; else valueUSD += v;
        });
        const totalValueInSAR = valueSAR + valueUSD * rate;
        const totalValue =
            platformCurrency === 'SAR'
                ? valueSAR + valueUSD * rate
                : platformCurrency === 'USD'
                ? valueUSD + valueSAR / rate
                : totalValueInSAR;

        let invSAR = 0, invUSD = 0, wdrSAR = 0, wdrUSD = 0;
        transactions.filter(t => t.type === 'buy').forEach(t => {
            const c = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency;
            if (c === 'SAR') invSAR += t.total ?? 0;
            else invUSD += t.total ?? 0;
        });
        transactions.filter(t => t.type === 'sell').forEach(t => {
            const c = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency;
            if (c === 'SAR') wdrSAR += t.total ?? 0;
            else wdrUSD += t.total ?? 0;
        });
        const totalInvested =
            platformCurrency === 'SAR'
                ? invSAR + invUSD * rate
                : platformCurrency === 'USD'
                ? invUSD + invSAR / rate
                : invSAR + invUSD * rate;
        const totalWithdrawn =
            platformCurrency === 'SAR'
                ? wdrSAR + wdrUSD * rate
                : platformCurrency === 'USD'
                ? wdrUSD + wdrSAR / rate
                : wdrSAR + wdrUSD * rate;

        const netCapital = totalInvested - totalWithdrawn;
        const totalGainLoss = totalValue - netCapital;
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
        const dailyPnL = allHoldings.reduce(
            (s, h) => s + (simulatedPrices[h.symbol] ? simulatedPrices[h.symbol].change * h.quantity : 0),
            0
        );

        const cashSAR = availableCashByCurrency.SAR ?? 0;
        const cashUSD = availableCashByCurrency.USD ?? 0;
        const totalAvailable =
            platformCurrency === 'SAR'
                ? cashSAR + cashUSD * rate
                : platformCurrency === 'USD'
                ? cashUSD + cashSAR / rate
                : cashSAR + cashUSD * rate;

        return {
            totalValue,
            totalValueInSAR,
            totalGainLoss,
            dailyPnL,
            totalInvested,
            totalWithdrawn,
            roi,
            totalAvailable,
        };
    }, [portfolios, transactions, simulatedPrices, platformCurrency, exchangeRate, availableCashByCurrency]);

    const holdingsWithGains = (holdings: Holding[]) => holdings.map(h => {
        const priceInfo = simulatedPrices[h.symbol];
        const currentMktPrice = priceInfo ? priceInfo.price : (h.currentValue / (h.quantity || 1));
        const liveValue = currentMktPrice * h.quantity;
        const totalCost = h.avgCost * h.quantity;
        const gainLoss = liveValue - totalCost;
        return { ...h, currentValue: liveValue, totalCost, gainLoss };
    }).sort((a,b) => b.currentValue - a.currentValue);
    
    const getGoalName = (goalId?: string) => goalId ? goals.find(g => g.id === goalId)?.name : undefined;

    const symbolsNeedingName = useMemo(() => {
        const set = new Set<string>();
        portfolios.forEach((p) => (p.holdings || []).forEach((h) => {
            if (!(h.name || (h as any).name)) set.add(h.symbol.trim().toUpperCase());
        }));
        return Array.from(set);
    }, [portfolios]);
    const { names: symbolNames } = useCompanyNames(symbolsNeedingName);

    const displayName = (h: Holding) => {
        const n = h.name || (h as any).name;
        if (n) return n;
        const key = h.symbol.trim().toUpperCase();
        return symbolNames[key] ?? null;
    };

    const totalHoldings = portfolios.reduce((sum, p) => sum + (p.holdings?.length ?? 0), 0);

    return (
        <article className="platform-card bg-white rounded-xl shadow-md flex flex-col overflow-hidden border border-slate-200 hover:shadow-lg transition-shadow duration-300 ease-in-out min-w-0">
            {/* Platform Header — compact, professional */}
            <header className="platform-card-header bg-gradient-to-br from-slate-50 via-white to-slate-50/50 border-b border-slate-200 min-w-0">
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-start">
                    <div className="flex items-start gap-3 min-w-0 flex-1 overflow-hidden">
                        <div className="w-1 h-12 rounded-full bg-primary shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <h3 className="text-xl sm:text-2xl font-bold text-slate-800 break-words min-w-0" title={platform.name}>{platform.name}</h3>
                                <span className="flex items-center gap-0.5 shrink-0">
                                    <button type="button" onClick={() => onEditPlatform(platform)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit platform" aria-label="Edit platform"><PencilIcon className="h-4 w-4" /></button>
                                    <button type="button" onClick={() => onDeletePlatform(platform)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Remove platform" aria-label="Remove platform"><TrashIcon className="h-4 w-4" /></button>
                                </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-bold text-primary mt-1 tabular-nums break-words" title={platformCurrency ? formatCurrencyString(totalValue, { inCurrency: platformCurrency, showSecondary: true }) : formatCurrencyString(totalValueInSAR, { inCurrency: 'SAR' })}>{platformCurrency ? formatCurrencyString(totalValue, { inCurrency: platformCurrency }) : formatCurrencyString(totalValueInSAR, { inCurrency: 'SAR' })}</p>
                            <p className="text-xs text-slate-500 mt-1 font-medium">{hasMixedCurrencies ? 'Mixed SAR/USD · ' : ''}Contains {portfolios.length} portfolio{portfolios.length !== 1 ? 's' : ''} · {totalHoldings} holding{totalHoldings !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => setIsTxnModalOpen(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-primary rounded-xl border-2 border-primary/30 hover:bg-primary/5 shrink-0 w-full sm:w-auto transition-colors">
                        <ArrowsRightLeftIcon className="h-4 w-4" /> Transaction Log
                    </button>
                </div>
                <dl className="platform-metrics grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-label="Platform metrics">
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">Available Cash</dt>
                        <dd className="metric-value w-full text-sm mt-0.5 tabular-nums">
                            {availableCashByCurrency.SAR === 0 && availableCashByCurrency.USD === 0 ? (
                                <span className="font-bold text-slate-500">—</span>
                            ) : (
                                <>
                                    <span className="font-bold text-slate-800 block">
                                        {platformCurrency
                                            ? formatCurrencyString(totalAvailable, {
                                                  inCurrency: platformCurrency,
                                                  digits: 0,
                                                  showSecondary:
                                                      availableCashByCurrency.SAR > 0 && availableCashByCurrency.USD > 0,
                                              })
                                            : formatCurrencyString(totalAvailable, {
                                                  inCurrency: 'SAR',
                                                  digits: 0,
                                                  showSecondary:
                                                      availableCashByCurrency.SAR > 0 && availableCashByCurrency.USD > 0,
                                              })}
                                    </span>
                                    <span className="block text-[11px] text-slate-500">
                                        {formatCurrencyString(availableCashByCurrency.SAR, {
                                            inCurrency: 'SAR',
                                            digits: 0,
                                        })}{' '}
                                        ·{' '}
                                        {formatCurrencyString(availableCashByCurrency.USD, {
                                            inCurrency: 'USD',
                                            digits: 0,
                                        })}
                                    </span>
                                </>
                            )}
                        </dd>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">Unrealized P/L</dt>
                        <dd className="metric-value w-full font-bold text-base sm:text-lg">{platformCurrency ? formatCurrency(totalGainLoss, { inCurrency: platformCurrency, colorize: true, digits: 0 }) : formatCurrency(totalGainLoss, { colorize: true, digits: 0 })}</dd>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">Daily P/L</dt>
                        <dd className="metric-value w-full font-bold text-base sm:text-lg">{platformCurrency ? formatCurrency(dailyPnL, { inCurrency: platformCurrency, colorize: true, digits: 0 }) : formatCurrency(dailyPnL, { colorize: true, digits: 0 })}</dd>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">ROI</dt>
                        <dd className={`metric-value w-full font-bold text-base sm:text-lg tabular-nums ${roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{roi.toFixed(1)}%</dd>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">Invested</dt>
                        <dd className="metric-value w-full font-bold text-slate-800 text-base sm:text-lg mt-0.5 tabular-nums" title={platformCurrency ? formatCurrencyString(totalInvested, { inCurrency: platformCurrency, digits: 0, showSecondary: true }) : formatCurrencyString(totalInvested, { digits: 0 })}>{platformCurrency ? formatCurrencyString(totalInvested, { inCurrency: platformCurrency, digits: 0 }) : formatCurrencyString(totalInvested, { digits: 0 })}</dd>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 min-w-0 shadow-sm flex flex-col items-center justify-start text-center min-h-[108px]">
                        <dt className="metric-label w-full text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">Withdrawn</dt>
                        <dd className="metric-value w-full font-bold text-slate-800 text-base sm:text-lg mt-0.5 tabular-nums" title={platformCurrency ? formatCurrencyString(totalWithdrawn, { inCurrency: platformCurrency, digits: 0, showSecondary: true }) : formatCurrencyString(totalWithdrawn, { digits: 0 })}>{platformCurrency ? formatCurrencyString(totalWithdrawn, { inCurrency: platformCurrency, digits: 0 }) : formatCurrencyString(totalWithdrawn, { digits: 0 })}</dd>
                    </div>
                </dl>
            </header>

            {/* Portfolios & Holdings — compact hierarchy; spacing from design system */}
            <div className="platform-card-body">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Portfolios · {portfolios.length}</h4>
                </div>
                {portfolios.length === 0 ? (
                    <div className="rounded-xl bg-slate-50/80 border-2 border-dashed border-slate-200 py-8 px-4 text-center">
                        <p className="text-sm text-slate-600">No portfolios in this platform yet.</p>
                        <p className="text-xs text-slate-500 mt-1">Use <strong>Add Portfolio</strong> above and select this platform.</p>
                    </div>
                ) : null}
                {portfolios.map(portfolio => {
                    const portfolioCurrency = (portfolio.currency as TradeCurrency) || 'USD';
                    const portfolioHoldings = holdingsWithGains(portfolio.holdings || []);
                    const portfolioValue = portfolioHoldings.reduce((sum, h) => sum + h.currentValue, 0);
                    const fmt = (val: number, opts?: { digits?: number; showSecondary?: boolean }) => formatCurrencyString(val, { inCurrency: portfolioCurrency, ...opts });
                    const fmtColor = (val: number, opts?: { digits?: number }) => formatCurrency(val, { inCurrency: portfolioCurrency, colorize: false, ...opts });
                    return (
                        <section key={portfolio.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                            {/* Portfolio header: name, value, goal, actions — contained in box */}
                            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 min-w-0">
                                <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                                    <div className="w-1 h-8 rounded-full bg-primary shrink-0" />
                                    <div className="min-w-0 flex-1 overflow-hidden">
                                        <h4 className="font-bold text-slate-800 text-base break-words" title={portfolio.name}>{portfolio.name}</h4>
                                        <p className="text-sm font-semibold text-primary tabular-nums mt-0.5 break-words" title={fmt(portfolioValue, { showSecondary: true })}>{fmt(portfolioValue)}</p>
                                        {(portfolio.holdings?.length ?? 0) > 0 && (
                                            <p className="text-xs text-slate-500 mt-0.5">{(portfolio.holdings?.length ?? 0)} holding{(portfolio.holdings?.length ?? 0) !== 1 ? 's' : ''}</p>
                                        )}
                                    </div>
                                    {portfolio.goalId && (
                                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100 shrink-0" title={`Linked to: ${getGoalName(portfolio.goalId)}`}>
                                            <LinkIcon className="h-3.5 w-3.5" />
                                            {getGoalName(portfolio.goalId)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button type="button" onClick={() => onEditPortfolio(portfolio)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit portfolio" aria-label="Edit portfolio"><PencilIcon className="h-4 w-4"/></button>
                                    <button type="button" onClick={() => onDeletePortfolio(portfolio)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Remove portfolio" aria-label="Remove portfolio"><TrashIcon className="h-4 w-4"/></button>
                                </div>
                            </div>
                            {/* Holdings */}
                            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                {portfolioHoldings.length === 0 ? (
                                    <div className="px-5 py-8 text-center text-sm text-slate-500 rounded-b-2xl bg-slate-50/30">No holdings yet. Record a buy from <strong>Record Trade</strong> or the Transaction Log.</div>
                                ) : (
                                    <>
                                        <table className="w-full min-w-[640px] border-collapse table-auto" aria-label={`Holdings for ${portfolio.name}`}>
                                            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                                                <tr className="text-left">
                                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Share</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right w-20">Alloc.</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Qty</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">Avg cost</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Value</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">P/L</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Today</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center w-20">Zakat</th>
                                                    <th className="w-9" aria-label="Actions" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {portfolioHoldings.map(h => {
                                                    const allocationPct = portfolioValue > 0 ? (h.currentValue / portfolioValue) * 100 : 0;
                                                    const dailyPnL = simulatedPrices[h.symbol]?.change * h.quantity || 0;
                                                    const gainLossPct = (h.totalCost && h.totalCost > 0) ? (h.gainLoss / h.totalCost) * 100 : 0;
                                                    return (
                                                        <tr key={h.id} className="group hover:bg-slate-50/80 transition-colors">
                                                            <td className="px-4 py-3 min-w-0 max-w-[200px]">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onHoldingClick({ ...h, gainLossPercent: gainLossPct, priceChangePercent: simulatedPrices[h.symbol]?.changePercent ?? 0 }, portfolio)}
                                                                        className="text-left rounded-lg py-0.5 pr-1 -ml-1 hover:bg-slate-100/80 transition-colors min-w-0 flex-1 overflow-hidden"
                                                                    >
                                                                        <span className="metric-value font-bold text-slate-900 block w-full" title={h.symbol}>{h.symbol}</span>
                                                                        {displayName(h) && displayName(h) !== h.symbol && (
                                                                            <span className="metric-value text-xs text-slate-500 block w-full" title={displayName(h)!}>{displayName(h)}</span>
                                                                        )}
                                                                    </button>
                                                                    {h.goalId && <span title={getGoalName(h.goalId)}><LinkIcon className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden /></span>}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-right">
                                                                {portfolioValue > 0 && (
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden" title={`${allocationPct.toFixed(1)}%`}>
                                                                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, allocationPct)}%` }} />
                                                                        </div>
                                                                        <span className="text-sm font-medium text-slate-700 tabular-nums w-10">{allocationPct.toFixed(1)}%</span>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-3 text-center text-sm font-medium text-slate-800 tabular-nums">{h.quantity}</td>
                                                            <td className="px-3 py-3 text-center text-sm font-medium text-slate-700 tabular-nums">{fmt(h.avgCost ?? 0, { digits: 2 })}</td>
                                                            <td className="px-3 py-3 text-center text-sm font-bold text-slate-900 tabular-nums" title={portfolioCurrency === 'USD' ? formatCurrencyString(h.currentValue, { inCurrency: 'USD', showSecondary: true }) : undefined}>{fmt(h.currentValue, { digits: 0 })}</td>
                                                            <td className="px-3 py-3 text-center whitespace-nowrap">
                                                                <span
                                                                    className={`inline-flex items-center justify-center gap-1 tabular-nums ${
                                                                        h.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                                                    }`}
                                                                >
                                                                    <span className="text-sm font-semibold">
                                                                        {fmtColor(h.gainLoss, { digits: 0 })}
                                                                    </span>
                                                                    <span className="text-xs">
                                                                        ({gainLossPct >= 0 ? '+' : ''}
                                                                        {gainLossPct.toFixed(1)}%)
                                                                    </span>
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-3 text-center">
                                                                <span className={`text-sm font-medium tabular-nums ${dailyPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtColor(dailyPnL, { digits: 0 })}</span>
                                                            </td>
                                                            <td className="px-3 py-3 text-center">
                                                                <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full ${h.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{h.zakahClass === 'Zakatable' ? 'Zak.' : 'Non'}</span>
                                                            </td>
                                                            <td className="px-1 py-3">
                                                                <button type="button" onClick={() => onEditHolding(h)} className="p-1.5 rounded-md text-slate-300 group-hover:text-primary hover:bg-primary/5 transition-all" title="Edit holding" aria-label="Edit holding"><PencilIcon className="h-4 w-4" /></button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>

            <TransactionHistoryModal isOpen={isTxnModalOpen} onClose={() => setIsTxnModalOpen(false)} transactions={transactions} platformName={platform.name} />
        </article>
    );
};


const PlatformView: React.FC<{
    onAddPlatform: () => void;
    onOpenAddPortfolio: () => void;
    setActivePage?: (page: Page) => void;
    setActiveTab?: (tab: InvestmentSubPage) => void;
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }, portfolio: InvestmentPortfolio) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
}> = (props) => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const { setActivePage, setActiveTab, onOpenAddPortfolio } = props;

    const platformsData = useMemo(() => {
        const investmentAccounts = data.accounts.filter(acc => acc.type === 'Investment').sort((a,b) => a.name.localeCompare(b.name));
        return investmentAccounts.map(account => ({
            account,
            portfolios: data.investments.filter(p => (p.accountId ?? (p as any).account_id) === account.id),
            transactions: data.investmentTransactions.filter(t => (t.accountId ?? (t as any).account_id) === account.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
            availableCashByCurrency: getAvailableCashForAccount(account.id),
        }));
    }, [data, getAvailableCashForAccount]);

    const totalPlatforms = platformsData.length;
    const totalPortfolios = platformsData.reduce((sum, p) => sum + p.portfolios.length, 0);
    const aggregateValue = platformsData.reduce((sum, p) => {
        const holdings = p.portfolios.flatMap(port => port.holdings || []);
        return sum + holdings.reduce((s, h) => s + (props.simulatedPrices[h.symbol] ? props.simulatedPrices[h.symbol].price * h.quantity : h.currentValue), 0);
    }, 0);
    const hasAnyPlatforms = totalPlatforms > 0;
    const hasAnyPortfolios = totalPortfolios > 0;

    return (
        <div className="space-y-6 mt-2">
            <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-800">Portfolios</h2><span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Integrated with plan + execution</span></div>
                        <p className="text-sm text-slate-600 mt-0.5 max-w-2xl">
                            Manage platforms and portfolios. Each portfolio has a base currency (SAR or USD). Record trades in that currency. Click a share for full details. Integrated with Investment Plan, Recovery Plan, and Wealth Ultra.
                        </p>
                        {(setActiveTab || setActivePage) && (
                            <div className="flex flex-wrap items-center gap-2 pt-2">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
                                {setActiveTab && (
                                    <>
                                        <button type="button" onClick={() => setActiveTab('Investment Plan')} className="text-sm font-medium text-primary hover:underline">Investment Plan</button>
                                        <span className="text-slate-300">·</span>
                                        <button type="button" onClick={() => setActiveTab('Recovery Plan')} className="text-sm font-medium text-primary hover:underline">Recovery Plan</button>
                                        <span className="text-slate-300">·</span>
                                        <button type="button" onClick={() => setActiveTab('Watchlist')} className="text-sm font-medium text-primary hover:underline">Watchlist</button>
                                    </>
                                )}
                                {setActivePage && <>{setActiveTab && <span className="text-slate-300">·</span>}<button type="button" onClick={() => setActivePage('Wealth Ultra')} className="text-sm font-medium text-primary hover:underline">Wealth Ultra</button></>}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Accounts')} className="text-sm font-medium text-primary hover:underline py-2 px-1">
                                Go to Accounts
                            </button>
                        )}
                        <button type="button" onClick={onOpenAddPortfolio} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium shadow-sm">
                            <PlusIcon className="h-4 w-4" /> Add Portfolio
                        </button>
                        <button type="button" onClick={props.onAddPlatform} className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors">
                            Add platform
                        </button>
                    </div>
                </div>
                {hasAnyPlatforms && (
                    <div className="mt-5 pt-5 border-t border-slate-200">
                        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                            <div className="flex items-baseline gap-2">
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total value</span>
                                <span className="text-xl sm:text-2xl font-bold text-primary tabular-nums tracking-tight">{formatCurrencyString(aggregateValue)}</span>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-4">
                                <div className="flex items-center gap-1.5 rounded-lg bg-slate-100/80 px-3 py-1.5">
                                    <Squares2X2Icon className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
                                    <span className="text-sm font-semibold text-slate-700 tabular-nums">{totalPlatforms}</span>
                                    <span className="text-xs text-slate-500 hidden sm:inline">accounts</span>
                                </div>
                                <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5">
                                    <ChartPieIcon className="h-4 w-4 text-primary shrink-0" aria-hidden />
                                    <span className="text-sm font-semibold text-primary tabular-nums">{totalPortfolios}</span>
                                    <span className="text-xs text-primary/80 hidden sm:inline">portfolios</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {!hasAnyPlatforms ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 sm:p-12 text-center">
                    <Squares2X2Icon className="mx-auto h-12 w-12 text-slate-400" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold text-slate-800">No investment platforms yet</h3>
                    <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">Add an <strong>Investment</strong> account from Accounts, then create portfolios here and record trades.</p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Accounts')} className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium">
                                Go to Accounts
                            </button>
                        )}
                        <button type="button" onClick={props.onAddPlatform} className="px-4 py-2.5 border border-slate-300 rounded-xl hover:bg-slate-100 text-slate-700 text-sm font-medium">
                            Add platform
                        </button>
                    </div>
                </div>
            ) : !hasAnyPortfolios ? (
                <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 p-8 sm:p-12 text-center">
                    <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-amber-500" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold text-slate-800">No portfolios yet</h3>
                    <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">Create a portfolio under one of your platforms below, then record buys and sells.</p>
                    <button type="button" onClick={onOpenAddPortfolio} className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium">
                        <PlusIcon className="h-4 w-4" /> Add Portfolio
                    </button>
                </div>
            ) : null}

            <div className="platform-cards-grid grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch min-w-0" data-platform-count={platformsData.length}>
                {platformsData.map(p => (
                    <PlatformCard
                        key={p.account.id}
                        platform={p.account}
                        portfolios={p.portfolios}
                        transactions={p.transactions}
                        goals={data.goals}
                        availableCashByCurrency={p.availableCashByCurrency}
                        onEditPlatform={props.onEditPlatform}
                        onDeletePlatform={props.onDeletePlatform}
                        onEditPortfolio={props.onEditPortfolio}
                        onDeletePortfolio={props.onDeletePortfolio}
                        onHoldingClick={props.onHoldingClick}
                        onEditHolding={props.onEditHolding}
                        simulatedPrices={props.simulatedPrices}
                    />
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

const ANALYST_DEFAULTS = {
    minimumUpsidePercentage: 25,
    stale_days: 30,
    min_coverage_threshold: 3,
    redirect_policy: 'pro-rata' as const,
    target_provider: 'TipRanks',
};

const InvestmentPlan: React.FC<{ onNavigateToTab?: (tab: InvestmentSubPage) => void; onOpenWealthUltra?: () => void; onOpenRecordTrade?: (trade: { ticker: string; amount: number; reason?: string; price?: number; quantity?: number; tradeCurrency?: TradeCurrency }) => void }> = ({ onNavigateToTab, onOpenWealthUltra, onOpenRecordTrade }) => {
    const { data, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const { isAiAvailable } = useAI();
    const { exchangeRate } = useCurrency();
    const { simulatedPrices } = useMarketData();

    const planFromData = data.investmentPlan;
    const planWithAnalystDefaults: InvestmentPlanSettings = useMemo(() => ({
        ...planFromData,
        minimumUpsidePercentage: Number(planFromData.minimumUpsidePercentage) || ANALYST_DEFAULTS.minimumUpsidePercentage,
        stale_days: Number(planFromData.stale_days) || ANALYST_DEFAULTS.stale_days,
        min_coverage_threshold: Number(planFromData.min_coverage_threshold) || ANALYST_DEFAULTS.min_coverage_threshold,
        redirect_policy: planFromData.redirect_policy || ANALYST_DEFAULTS.redirect_policy,
        target_provider: String(planFromData.target_provider || ANALYST_DEFAULTS.target_provider).trim() || ANALYST_DEFAULTS.target_provider,
    }), [planFromData]);

    const [plan, setPlan] = useState<InvestmentPlanSettings>(planWithAnalystDefaults);
    const [newTicker, setNewTicker] = useState({ ticker: '', name: '' });
    const hasSyncedFromServerRef = React.useRef(false);
    useEffect(() => {
        const sym = newTicker.ticker.trim().toUpperCase();
        if (!sym || sym.length < 2) return;
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((apiName) => {
                if (apiName) setNewTicker((prev) => (prev.name.trim() ? prev : { ...prev, name: apiName }));
            });
        }, 700);
        return () => clearTimeout(t);
    }, [newTicker.ticker]);
    const [executionResult, setExecutionResult] = useState<InvestmentPlanExecutionResult | null>(null);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [showFlowNote, setShowFlowNote] = useState(true);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [planAdvancedOpen, setPlanAdvancedOpen] = useState(false);
    const [isFillingAnalyst, setIsFillingAnalyst] = useState(false);
    const analystAutoFilledRef = React.useRef(false);

    // Sync plan from server only on first load (or when data first becomes available), so refetches don't overwrite unsaved edits
    useEffect(() => {
        const dataJustLoaded = planFromData && !hasSyncedFromServerRef.current;
        if (dataJustLoaded) {
            setPlan(planWithAnalystDefaults);
            hasSyncedFromServerRef.current = true;
        }
    }, [planWithAnalystDefaults, planFromData]);

    const unifiedUniverse = useMemo(() => {
        const universeMap = new Map<string, UniverseTicker & { source?: string }>();
        const portfolioUniverse = data.portfolioUniverse ?? [];
        const investments = data.investments ?? [];
        const watchlist = data.watchlist ?? [];
        const plannedTrades = data.plannedTrades ?? [];

        // 1. Start with explicit universe
        portfolioUniverse.forEach(t => universeMap.set(t.ticker, { ...t, source: 'Universe' }));

        // 2. Add holdings
        investments.flatMap(p => p.holdings || []).forEach(h => {
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
        watchlist.forEach(w => {
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
        plannedTrades.forEach(t => {
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

    const universeHealth = useMemo(() => {
        const actionable = unifiedUniverse.filter(t => t.status === 'Core' || t.status === 'High-Upside');
        const monthlyWeightTotal = actionable.reduce((sum, t) => sum + (t.monthly_weight || 0), 0);
        const overMaxCount = actionable.filter(t => (t.monthly_weight || 0) > (t.max_position_weight || 1)).length;
        const unmappedCount = unifiedUniverse.filter(t => !t.source?.includes('Universe')).length;
        return {
            totalCount: unifiedUniverse.length,
            actionableCount: actionable.length,
            monthlyWeightTotal,
            overMaxCount,
            unmappedCount,
        };
    }, [unifiedUniverse]);

    useEffect(() => {
        if (data.investmentPlan) {
            setPlan(data.investmentPlan);
        }
    }, [data.investmentPlan]);

    // Auto-derive suggested monthly budget from recent buy activity (last 6 months)
    const suggestedMonthlyBudget = useMemo(() => {
        const buys = (data.investmentTransactions || []).filter(t => t.type === 'buy');
        if (buys.length === 0) return 0;
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const recent = buys.filter(t => new Date(t.date) >= sixMonthsAgo);
        const byMonth = new Map<string, number>();
        recent.forEach(t => {
            const d = new Date(t.date);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const amt = t.total ?? (t.quantity * (t.price ?? 0));
            byMonth.set(key, (byMonth.get(key) ?? 0) + amt);
        });
        const amounts = Array.from(byMonth.values());
        if (amounts.length === 0) return 0;
        return Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    }, [data.investmentTransactions]);

    const addWatchlistAndHoldingsToUniverse = async () => {
        const toAdd = unifiedUniverse.filter(t => t.source !== 'Universe' && !t.source?.includes('Universe'));
        for (const t of toAdd) {
            try {
                await addUniverseTicker({ ticker: t.ticker, name: t.name, status: t.status });
            } catch (_) {
                // Skip duplicates or errors
            }
        }
    };
    const canAddWatchlistHoldings = unifiedUniverse.some(t => t.source !== 'Universe' && !t.source?.includes('Universe'));

    if (!plan || !plan.brokerConstraints) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-lg shadow">
                <LoadingSpinner message="Loading investment plan strategy..." size="md" className="py-8" />
            </div>
        );
    }

    const handlePlanChange = (field: keyof InvestmentPlanSettings, value: any) => {
        setPlan(prev => ({ ...prev, [field]: value }));
    };

    const toClampedFraction = (rawPercent: string, fallbackFraction: number) => {
        const parsed = Number.parseFloat(rawPercent);
        if (!Number.isFinite(parsed)) return fallbackFraction;
        const clampedPercent = Math.max(0, Math.min(100, parsed));
        return clampedPercent / 100;
    };

    const handleCoreAllocationPercentChange = (rawPercent: string) => {
        setPlan(prev => {
            const core = toClampedFraction(rawPercent, prev.coreAllocation ?? 0.7);
            return { ...prev, coreAllocation: core, upsideAllocation: Math.max(0, 1 - core) };
        });
    };

    const handleUpsideAllocationPercentChange = (rawPercent: string) => {
        setPlan(prev => {
            const upside = toClampedFraction(rawPercent, prev.upsideAllocation ?? 0.3);
            return { ...prev, upsideAllocation: upside, coreAllocation: Math.max(0, 1 - upside) };
        });
    };

    const handleAutoFillAnalyst = useCallback(async () => {
        setIsFillingAnalyst(true);
        try {
            const suggested = await getSuggestedAnalystEligibility(unifiedUniverse, plan);
            setPlan(prev => ({
                ...prev,
                minimumUpsidePercentage: suggested.minimumUpsidePercentage,
                stale_days: suggested.stale_days,
                min_coverage_threshold: suggested.min_coverage_threshold,
                redirect_policy: suggested.redirect_policy,
                target_provider: suggested.target_provider,
            }));
            analystAutoFilledRef.current = true;
        } catch (e) {
            alert(`Could not auto-fill analyst settings. ${formatAiError(e)}`);
        } finally {
            setIsFillingAnalyst(false);
        }
    }, [unifiedUniverse, plan]);

    useEffect(() => {
        if (!planAdvancedOpen || !isAiAvailable || analystAutoFilledRef.current) return;
        analystAutoFilledRef.current = true;
        getSuggestedAnalystEligibility(unifiedUniverse).then(suggested => {
            setPlan(prev => ({
                ...prev,
                minimumUpsidePercentage: suggested.minimumUpsidePercentage,
                stale_days: suggested.stale_days,
                min_coverage_threshold: suggested.min_coverage_threshold,
                redirect_policy: suggested.redirect_policy,
                target_provider: suggested.target_provider,
            }));
        }).catch(() => { analystAutoFilledRef.current = false; });
    }, [planAdvancedOpen, isAiAvailable, unifiedUniverse]);

    const handleAddNewTicker = async () => {
        if (!newTicker.ticker || !newTicker.name) return;
        try {
            await addUniverseTicker({ ...newTicker, status: 'Watchlist' });
            setNewTicker({ ticker: '', name: '' });
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const allocationSum = (plan.coreAllocation + plan.upsideAllocation) * 100;
    const allocationWarning = Math.abs(allocationSum - 100) > 0.5 ? `Core + High-Upside = ${allocationSum.toFixed(1)}%; should equal 100%. Remaining is treated as Spec.` : null;
    const planCurrency = plan.budgetCurrency ?? 'SAR';
    const coreShareAmount = (plan.monthlyBudget ?? 0) * (plan.coreAllocation ?? 0);
    const upsideShareAmount = (plan.monthlyBudget ?? 0) * (plan.upsideAllocation ?? 0);

    const minOrder = plan.brokerConstraints?.minimumOrderSize ?? 0;
    const budget = plan.monthlyBudget ?? 0;
    const minOrderWarning = budget > 0 && minOrder > 0 && minOrder > budget * 0.5
        ? `Minimum order size (${formatCurrencyString(minOrder)}) is more than 50% of monthly budget. You may only place 1–2 orders per month. Consider lowering it or increasing budget.`
        : budget > 0 && minOrder > budget
        ? `Minimum order size is higher than your monthly budget; no single order can be placed.`
        : null;

    const actionableCount = (data.portfolioUniverse ?? []).filter(t => t.status === 'Core' || t.status === 'High-Upside').length;
    const noActionableWarning = actionableCount === 0 ? 'Add at least one Core or High-Upside ticker in the universe below (or from Watchlist) before executing the plan.' : null;

    const planHealth = useMemo(() => {
        let score = 100;
        const reasons: string[] = [];
        const monthly = plan.monthlyBudget ?? 0;
        const corePct = (plan.coreAllocation ?? 0) * 100;
        const upsidePct = (plan.upsideAllocation ?? 0) * 100;

        if (monthly <= 0) {
            score -= 25;
            reasons.push('Monthly budget not set');
        }
        if (allocationWarning) {
            score -= 20;
            reasons.push('Core + High-Upside not equal to 100%');
        }
        if (universeHealth.actionableCount === 0) {
            score -= 30;
            reasons.push('No Core / High-Upside tickers in universe');
        }
        if (Math.abs(universeHealth.monthlyWeightTotal - 1) > 0.05 && universeHealth.actionableCount > 0) {
            score -= 10;
            reasons.push('Universe weights not close to 100%');
        }
        if (minOrderWarning) {
            score -= 10;
            reasons.push('Broker minimum order conflicts with budget');
        }
        score = Math.max(0, Math.min(100, score));

        let label: string;
        let summary: string;
        if (score >= 85) {
            label = 'Ready to execute';
            summary = 'Budget, allocations, and universe look solid. You can run Execute & View Results or Wealth Ultra.';
        } else if (score >= 65) {
            label = 'Minor tweaks';
            summary = (reasons[0] || 'Small configuration gaps.') + (reasons[1] ? ` · ${reasons[1]}` : '');
        } else {
            label = 'Action needed';
            summary = reasons.slice(0, 3).join(' · ') || 'Set budget, tickers, and weights before executing.';
        }

        return {
            score,
            label,
            summary,
            corePct,
            upsidePct,
        };
    }, [plan, allocationWarning, universeHealth, minOrderWarning, noActionableWarning]);

    const syncPlanFromUniverse = () => {
        const core = (data.portfolioUniverse || []).filter(t => t.status === 'Core').map(t => ({ ticker: t.ticker, weight: t.monthly_weight ?? 0 }));
        const upside = (data.portfolioUniverse || []).filter(t => t.status === 'High-Upside').map(t => ({ ticker: t.ticker, weight: t.monthly_weight ?? 0 }));
        setPlan(prev => ({ ...prev, corePortfolio: core, upsideSleeve: upside }));
    };

    const applySmartPlan = () => {
        const investedBase = (data.investments || []).reduce((sum, portfolio) => {
            const portfolioTotal = (portfolio.holdings || []).reduce((inner, h) => inner + (h.currentValue || 0), 0);
            return sum + portfolioTotal;
        }, 0);

        const historyBudget = suggestedMonthlyBudget > 0 ? suggestedMonthlyBudget : 0;
        const derivedFromPortfolio = investedBase > 0 ? Math.round(Math.max(1000, Math.min(30000, investedBase * 0.025))) : 0;
        const fallbackBudget = 2500;
        const monthly = historyBudget || plan.monthlyBudget || derivedFromPortfolio || fallbackBudget;

        const coreUniverse = (data.portfolioUniverse || []).filter(t => t.status === 'Core');
        const upsideUniverse = (data.portfolioUniverse || []).filter(t => t.status === 'High-Upside');

        let coreAlloc = plan.coreAllocation ?? 0.7;
        let upsideAlloc = plan.upsideAllocation ?? 0.3;

        const coreWt = coreUniverse.reduce((s, t) => s + (t.monthly_weight || 0), 0);
        const upWt = upsideUniverse.reduce((s, t) => s + (t.monthly_weight || 0), 0);
        const totalWt = coreWt + upWt;
        if (totalWt > 0) {
            coreAlloc = coreWt / totalWt;
            upsideAlloc = upWt / totalWt;
        } else if (unifiedUniverse.length > 0) {
            coreAlloc = 0.8;
            upsideAlloc = 0.2;
        }

        const nextMinOrder = Math.max(100, Math.round((monthly * 0.1) / 100) * 100);

        setPlan(prev => ({
            ...prev,
            monthlyBudget: monthly,
            coreAllocation: coreAlloc,
            upsideAllocation: upsideAlloc,
            brokerConstraints: {
                ...prev.brokerConstraints,
                minimumOrderSize: nextMinOrder,
            },
        }));

        const budgetSource = historyBudget > 0
            ? 'recent buy history'
            : (plan.monthlyBudget > 0 ? 'your existing plan value' : (derivedFromPortfolio > 0 ? 'current holdings size' : 'smart default'));
        setSaveMessage(`Smart-fill applied using ${budgetSource}. Review and save before execution.`);
        setTimeout(() => setSaveMessage(null), 5000);
    };

    const handleSave = () => {
        if (allocationWarning && !window.confirm(`${allocationWarning}

Save anyway?`)) return;
        setSaveMessage(null);
        saveInvestmentPlan(plan);
        setSaveMessage('Plan saved. You can view allocation & orders in Wealth Ultra.');
        setTimeout(() => setSaveMessage(null), 6000);
    };

    const isUniverseTicker = (ticker: UniverseTicker & { source?: string }) => ticker.source === 'Universe' || ticker.source?.includes('Universe');
    const isActionableUniverseStatus = (status: TickerStatus) => status === 'Core' || status === 'High-Upside';

    const autoConfigureUniverseWeights = useCallback(async () => {
        const universe = [...(data.portfolioUniverse || [])];
        if (universe.length === 0) return;

        const actionable = universe.filter(t => isActionableUniverseStatus(t.status));
        const actionableCount = actionable.length;
        const rawWeightsById = new Map(actionable.map((t) => [t.id, (t.monthly_weight && t.monthly_weight > 0) ? t.monthly_weight : 1]));
        const rawTotal = Array.from(rawWeightsById.values()).reduce((sum, v) => sum + v, 0);
        const fallbackWeight = actionableCount > 0 ? 1 / actionableCount : 0;

        for (const ticker of universe) {
            if (!isActionableUniverseStatus(ticker.status)) {
                const shouldResetWeight = (ticker.monthly_weight ?? 0) !== 0;
                const shouldDefaultMax = !ticker.max_position_weight || ticker.max_position_weight <= 0;
                if (shouldResetWeight || shouldDefaultMax) {
                    await updateUniverseTickerStatus(ticker.id, ticker.status, {
                        monthly_weight: 0,
                        max_position_weight: shouldDefaultMax ? 0.25 : ticker.max_position_weight,
                    });
                }
                continue;
            }

            const sourceWeight = rawWeightsById.get(ticker.id) ?? 1;
            const normalizedWeight = rawTotal > 0 ? (sourceWeight / rawTotal) : fallbackWeight;
            const nextMax = (ticker.max_position_weight && ticker.max_position_weight > 0)
                ? ticker.max_position_weight
                : (ticker.status === 'Core' ? 0.25 : 0.2);

            await updateUniverseTickerStatus(ticker.id, ticker.status, {
                monthly_weight: Number(normalizedWeight.toFixed(6)),
                max_position_weight: nextMax,
            });
        }

        setSaveMessage('Universe weights auto-configured for actionable tickers.');
        setTimeout(() => setSaveMessage(null), 5000);
    }, [data.portfolioUniverse, updateUniverseTickerStatus]);

    const handleStatusUpdate = async (ticker: UniverseTicker & { source?: string }, newStatus: TickerStatus) => {
        if (isUniverseTicker(ticker)) {
            const defaultMax = isActionableUniverseStatus(newStatus)
                ? (newStatus === 'Core' ? 0.25 : 0.2)
                : 0.25;
            await updateUniverseTickerStatus(ticker.id, newStatus, {
                monthly_weight: isActionableUniverseStatus(newStatus) ? (ticker.monthly_weight ?? 0) : 0,
                max_position_weight: ticker.max_position_weight && ticker.max_position_weight > 0 ? ticker.max_position_weight : defaultMax,
            });
            await autoConfigureUniverseWeights();
        } else {
            // Promote virtual ticker to universe
            await addUniverseTicker({
                ticker: ticker.ticker,
                name: ticker.name,
                status: newStatus
            });
            setSaveMessage('Ticker added to universe. Click Auto-configure weights to distribute defaults.');
            setTimeout(() => setSaveMessage(null), 5000);
        }
    };

    const tickerCurrencyMap = useMemo<Record<string, TradeCurrency>>(() => {
        const map: Record<string, TradeCurrency> = {};
        (data.investments ?? []).forEach((portfolio) => {
            const portfolioCurrency = (portfolio.currency === 'SAR' || portfolio.currency === 'USD') ? portfolio.currency : 'USD';
            (portfolio.holdings ?? []).forEach((holding) => {
                const symbol = (holding.symbol || '').trim().toUpperCase();
                if (symbol) map[symbol] = portfolioCurrency;
            });
        });
        return map;
    }, [data.investments]);

    const holdingPriceFallbackMap = useMemo<Record<string, number>>(() => {
        const map: Record<string, number> = {};
        (data.investments ?? []).forEach((portfolio) => {
            (portfolio.holdings ?? []).forEach((holding) => {
                const symbol = (holding.symbol || '').trim().toUpperCase();
                if (!symbol) return;
                const inferred = holding.quantity > 0 ? (holding.currentValue / holding.quantity) : (holding.avgCost || 0);
                if (inferred > 0 && !Number.isNaN(inferred)) map[symbol] = inferred;
            });
        });
        return map;
    }, [data.investments]);

    const getTradeExecutionSuggestion = useCallback((trade: InvestmentPlanExecutionResult['trades'][number]) => {
        const symbol = (trade.ticker || '').trim().toUpperCase();
        const tradeCurrency = trade.tradeCurrency || planCurrency;
        const amountInTradeCurrency = tradeCurrency === planCurrency
            ? trade.amount
            : (typeof trade.amountInTradeCurrency === 'number' ? trade.amountInTradeCurrency : trade.amount);
        const suggestedPrice = simulatedPrices[symbol]?.price || holdingPriceFallbackMap[symbol] || 0;
        const suggestedQuantity = suggestedPrice > 0 ? amountInTradeCurrency / suggestedPrice : undefined;
        return {
            tradeCurrency,
            amountInTradeCurrency,
            suggestedPrice: suggestedPrice > 0 ? suggestedPrice : undefined,
            suggestedQuantity,
        };
    }, [planCurrency, simulatedPrices, holdingPriceFallbackMap]);

    const handleExecutePlan = async (forceRuleBased = false) => {
        setIsExecuting(true);
        setExecutionResult(null);
        setExecutionError(null);
        try {
            const result = await executeInvestmentPlanStrategy(plan, data.portfolioUniverse, {
                forceRuleBased,
                planCurrency: plan.budgetCurrency,
                tickerCurrencyMap,
                fxRate: exchangeRate,
            });
            setExecutionResult(result);
            setExecutionError(null);

            const logEntry: InvestmentPlanExecutionLog = {
                ...result,
                id: `log-${Date.now()}`,
                user_id: '',
                created_at: new Date().toISOString(),
            };
            await saveExecutionLog(logEntry);
        } catch (error) {
            console.error("Error executing plan:", error);
            const details = formatAiError(error);

            if (!forceRuleBased) {
                try {
                    const fallbackResult = await executeInvestmentPlanStrategy(plan, data.portfolioUniverse, {
                        forceRuleBased: true,
                        planCurrency: plan.budgetCurrency,
                        tickerCurrencyMap,
                        fxRate: exchangeRate,
                    });
                    setExecutionResult(fallbackResult);
                    setExecutionError(null);

                    const logEntry: InvestmentPlanExecutionLog = {
                        ...fallbackResult,
                        log_details: `${fallbackResult.log_details}

> AI execution failed. Automatically switched to rule-based mode.
> AI error: ${details}`,
                        id: `log-${Date.now()}`,
                        user_id: '',
                        created_at: new Date().toISOString(),
                    };
                    await saveExecutionLog(logEntry);
                    setSaveMessage('AI execution failed. Plan executed in rule-based mode successfully.');
                    setTimeout(() => setSaveMessage(null), 7000);
                } catch (fallbackError) {
                    setExecutionError(formatAiError(fallbackError));
                }
            } else {
                setExecutionError(details);
            }
        }
        setIsExecuting(false);
    };

    return (
        <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-5 sm:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-white">Monthly Core + Analyst-Upside Sleeve Strategy</h1>
                        <p className="mt-1 text-sm text-slate-200 max-w-2xl">Design, validate, and execute your monthly allocation in one professional workflow connected to universe signals and Wealth Ultra.</p>
                        <span className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'}`}>AI {isAiAvailable ? 'Enabled' : 'Unavailable'}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button onClick={handleSave} className="px-6 py-2.5 bg-white text-slate-900 rounded-xl hover:bg-slate-100 transition-colors font-semibold">Save Plan</button>
                    </div>
                </div>
            </section>
            {saveMessage && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm flex items-center justify-between">
                    <span>{saveMessage}</span>
                    {onOpenWealthUltra && <button type="button" onClick={onOpenWealthUltra} className="text-green-700 font-medium hover:underline whitespace-nowrap ml-2">Open Wealth Ultra</button>}
                </div>
            )}
            {(onNavigateToTab || onOpenWealthUltra) && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
                    {onNavigateToTab && (
                        <>
                            <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-primary font-medium hover:underline">Portfolios</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('Watchlist')} className="text-primary font-medium hover:underline">Watchlist</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('AI Rebalancer')} className="text-primary font-medium hover:underline">AI Rebalancer</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('Recovery Plan')} className="text-primary font-medium hover:underline">Recovery Plan</button>
                        </>
                    )}
                    {onOpenWealthUltra && <>{onNavigateToTab && <span className="text-slate-300">·</span>}<button type="button" onClick={onOpenWealthUltra} className="text-primary font-medium hover:underline">Wealth Ultra</button></>}
                </div>
            )}

            {/* How it works — Plan → Universe → Execute / Wealth Ultra */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setShowFlowNote(!showFlowNote)} className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-medium text-slate-800 hover:bg-slate-100">
                    <span>How this works: Plan → Universe → Execute / Wealth Ultra</span>
                    <span className="text-slate-500">{showFlowNote ? '▼' : '▶'}</span>
                </button>
                {showFlowNote && (
                    <div className="px-4 pb-4 pt-3 border-t border-slate-200 bg-white/70">
                        <ol className="space-y-2.5 text-sm text-slate-700">
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">1</span>
                                <p><strong>Set budget & allocation</strong> (monthly amount, Core % vs High-Upside %).</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">2</span>
                                <p><strong>Build your universe</strong> via Watchlist or the table below. Set status to <em>Core</em> / <em>High-Upside</em> and optional weights (target ~100% combined).</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">3</span>
                                <p><strong>Sync (optional)</strong> using “Sync Core/Upside from Universe” so plan + execution + Wealth Ultra all use the same ticker set.</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">4</span>
                                <p><strong>Execute or open Wealth Ultra</strong> to generate allocations/orders and then record actual trades directly from results.</p>
                            </li>
                        </ol>
                    </div>
                )}
            </div>

            {/* Plan health — smart readiness summary */}
            <SectionCard title="Plan health" className="bg-gradient-to-r from-emerald-50/60 to-slate-50/80 border-emerald-100">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 lg:gap-6">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-emerald-200">
                            <span className="text-lg font-bold text-emerald-700 tabular-nums">{planHealth.score}</span>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">{planHealth.label}</p>
                            <p className="text-xs text-slate-600 mt-0.5">{planHealth.summary}</p>
                        </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 sm:gap-3 text-xs text-slate-600 w-full lg:w-auto lg:min-w-[360px]">
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Monthly budget</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5 whitespace-nowrap">{formatCurrencyString(plan.monthlyBudget ?? 0, { inCurrency: planCurrency, digits: 0 })}</dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Core / Upside mix</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5 whitespace-nowrap">{planHealth.corePct.toFixed(0)}% / {planHealth.upsidePct.toFixed(0)}%</dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Actionable tickers</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5">{universeHealth.actionableCount}</dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Weight coverage</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5">{(universeHealth.monthlyWeightTotal * 100).toFixed(1)}%</dd>
                        </div>
                    </dl>
                </div>
            </SectionCard>

            <div className="cards-grid grid grid-cols-1 xl:grid-cols-5">
                <div className="xl:col-span-3 space-y-6">
                    {/* Allocation Settings — essential fields first */}
                    <div className="bg-white p-6 rounded-lg shadow space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold text-dark">Monthly Plan</h2>
                                <p className="text-sm text-gray-500 mt-1">Set how much to invest each month and how to split it between Core (stable) and High-Upside (growth) tickers.</p>
                            </div>
                            <button
                                type="button"
                                onClick={applySmartPlan}
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-secondary"
                            >
                                <SparklesIcon className="h-4 w-4" />
                                Smart-fill plan
                            </button>
                        </div>
                        {allocationWarning && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">{allocationWarning}</div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">Monthly Budget <InfoHint text="Amount you allocate to invest each month; split between Core and High-Upside by the percentages below. You can use the suggested value from your recent buy activity." /></label>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <input type="number" value={plan.monthlyBudget} onChange={e => handlePlanChange('monthlyBudget', parseFloat(e.target.value) || 0)} className="flex-1 min-w-0 p-2 border rounded-md" />
                                    {suggestedMonthlyBudget > 0 && (
                                        <button type="button" onClick={() => handlePlanChange('monthlyBudget', suggestedMonthlyBudget)} className="text-sm text-primary hover:underline whitespace-nowrap">Use suggested ({formatCurrencyString(suggestedMonthlyBudget, { digits: 0 })})</button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">Budget Currency <InfoHint text="Currency for plan amounts (e.g. SAR); read from app defaults." /></label>
                                <input type="text" value={plan.budgetCurrency} disabled className="mt-1 w-full p-2 border rounded-md bg-gray-100" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">Core Allocation (%) <InfoHint text="Share of monthly budget for stable Core assets (e.g. index funds); the rest goes to High-Upside." /></label>
                                <input type="number" value={plan.coreAllocation * 100} onChange={e => handleCoreAllocationPercentChange(e.target.value)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">High-Upside Allocation (%) <InfoHint text="Share for analyst-upside assets; only tickers meeting analyst targets get this allocation." /></label>
                                <input type="number" value={plan.upsideAllocation * 100} onChange={e => handleUpsideAllocationPercentChange(e.target.value)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                        </div>

                        <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                                <span className="font-semibold text-slate-700">Execution split ({planCurrency})</span>
                                <span className="tabular-nums text-slate-700">Core {planHealth.corePct.toFixed(0)}% → <strong>{formatCurrencyString(coreShareAmount, { inCurrency: planCurrency, digits: 0 })}</strong></span>
                                <span className="tabular-nums text-slate-700">High-Upside {planHealth.upsidePct.toFixed(0)}% → <strong>{formatCurrencyString(upsideShareAmount, { inCurrency: planCurrency, digits: 0 })}</strong></span>
                            </div>
                        </div>

                        {planAdvancedOpen && (
                            <>
                                <div className="mt-6 pt-4 border-t border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-1">Analyst & eligibility</h3>
                                    <p className="text-xs text-slate-500 mb-3">Values are auto-filled from defaults or AI (not manually entered). Use &quot;Auto-fill with AI&quot; to refresh from your universe.</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 flex items-center">Minimum Analyst Upside (%) <InfoHint text="Minimum price upside from analyst targets to be eligible for High-Upside sleeve." /></label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.minimumUpsidePercentage}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Stale Days (Analyst Target)</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.stale_days}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Min Coverage (Analysts)</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.min_coverage_threshold}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Redirect Policy</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800">{plan.redirect_policy === 'priority' ? 'Priority (Sequential)' : 'Pro-rata (Balanced)'}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Target Provider</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800">{plan.target_provider || '—'}</div>
                                        </div>
                                    </div>
                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            onClick={handleAutoFillAnalyst}
                                            disabled={isFillingAnalyst}
                                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <SparklesIcon className="h-4 w-4" />
                                            {isFillingAnalyst ? 'Filling…' : 'Auto-fill with AI'}
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-6 pt-4 border-t border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                                        Broker & execution
                                        <InfoHint text="These settings match your broker so Execute & View Results produces realistic orders. Minimum order size: trades below this are redirected to Core. Rounding and fractional shares affect how amounts are converted to share quantities. Leftover cash can be re-invested in Core or held." />
                                    </h3>
                                    {minOrderWarning && (
                                        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">{minOrderWarning}</div>
                                    )}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 flex items-center">Minimum Order Size ({plan.budgetCurrency})</label>
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
                            </>
                        )}
                        <button type="button" onClick={() => setPlanAdvancedOpen(!planAdvancedOpen)} className="mt-4 text-sm font-medium text-primary hover:underline">
                            {planAdvancedOpen ? '▲ Hide advanced options' : '▼ Show advanced options (analyst rules, broker)'}
                        </button>
                    </div>

                    {/* Portfolio Universe */}
                    <div className="bg-white p-6 rounded-lg shadow">
                        <div className="mb-4">
                            <h2 className="text-xl font-semibold text-dark flex items-center gap-2 min-w-0">
                                <span>Portfolio Universe & Weights</span>
                                <span className="inline-flex items-center flex-shrink-0">
                                    <InfoHint text="Tickers and their status (Core, High-Upside, Speculative, etc.) with optional monthly weights. Core and High-Upside drive allocation; weights define how the monthly budget is split between them. Sync from Watchlist or add manually." />
                                </span>
                            </h2>
                            <p className="text-sm text-gray-500 mt-1">Define your assets, their status, and their monthly investment weights. Core and High-Upside assets will be invested according to these weights.</p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Tickers</p><p className="font-semibold text-dark">{universeHealth.totalCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Actionable</p><p className="font-semibold text-dark">{universeHealth.actionableCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Weight total</p><p className={`font-semibold ${Math.abs(universeHealth.monthlyWeightTotal - 1) <= 0.01 ? 'text-green-700' : 'text-amber-700'}`}>{(universeHealth.monthlyWeightTotal * 100).toFixed(1)}%</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Over max</p><p className={`font-semibold ${universeHealth.overMaxCount === 0 ? 'text-green-700' : 'text-rose-700'}`}>{universeHealth.overMaxCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Needs mapping</p><p className={`font-semibold ${universeHealth.unmappedCount === 0 ? 'text-green-700' : 'text-amber-700'}`}>{universeHealth.unmappedCount}</p></div>
                        </div>
                        {Math.abs(universeHealth.monthlyWeightTotal - 1) > 0.01 && (
                            <p className="text-xs mb-4 text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Actionable monthly weights should usually sum close to 100% for predictable allocation behavior.</p>
                        )}
                        <div className="flex flex-wrap gap-2 mb-4">
                            {canAddWatchlistHoldings && (
                                <button type="button" onClick={addWatchlistAndHoldingsToUniverse} className="px-3 py-2 text-sm border border-primary/40 text-primary rounded-md hover:bg-primary/5">Add Watchlist & Holdings to Universe</button>
                            )}
                            <button type="button" onClick={syncPlanFromUniverse} className="px-3 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50 text-slate-700">Sync Core/Upside from Universe</button>
                            <button type="button" onClick={autoConfigureUniverseWeights} className="px-3 py-2 text-sm border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50">Auto-configure weights</button>
                            <input type="text" placeholder="Ticker (e.g., AAPL)" value={newTicker.ticker} onChange={e => setNewTicker(p => ({...p, ticker: e.target.value.toUpperCase()}))} className="p-2 border rounded-md" />
                            <input type="text" placeholder="Company Name" value={newTicker.name} onChange={e => setNewTicker(p => ({...p, name: e.target.value}))} className="flex-grow min-w-[120px] p-2 border rounded-md" />
                            <button onClick={handleAddNewTicker} className="p-2 bg-primary text-white rounded-md hover:bg-secondary"><PlusIcon className="h-5 w-5" /></button>
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 sticky top-0"><tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">Ticker</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">Name</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center gap-1 whitespace-nowrap">Status <InfoHint text="Core and High-Upside get allocation; Speculative gets a small share; Quarantine/Excluded get none." /></span>
                                    </th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap">Monthly Wt <InfoHint text="Share of this sleeve's budget (e.g. 50% = half of Core budget goes here). Weights should sum to ~100% per sleeve." /></span>
                                    </th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap">Max Pos Wt <InfoHint text="Cap on a single ticker's share of the sleeve (e.g. 0.25 = max 25%)." /></span>
                                    </th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-500 align-middle">Actions</th>
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
                                                {isUniverseTicker(ticker) ? (
                                                    isActionableUniverseStatus(ticker.status) ? (
                                                        <>
                                                            <input 
                                                                type="number" 
                                                                value={ticker.monthly_weight ? ticker.monthly_weight * 100 : ''} 
                                                                onChange={e => updateUniverseTickerStatus(ticker.id, ticker.status, { monthly_weight: parseFloat(e.target.value) / 100 })}
                                                                onBlur={autoConfigureUniverseWeights}
                                                                className="w-16 p-1 border rounded text-right text-xs"
                                                                placeholder="auto"
                                                            />
                                                            <span className="text-[10px] ml-1 text-gray-400">%</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400" title="Auto-managed: non-actionable statuses do not receive allocation">Auto</span>
                                                    )
                                                ) : (
                                                    <span className="text-[10px] text-gray-400" title="Add to universe above to set weights">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                {isUniverseTicker(ticker) ? (
                                                    <>
                                                        <input 
                                                            type="number" 
                                                            value={ticker.max_position_weight ? ticker.max_position_weight * 100 : ''} 
                                                            onChange={e => updateUniverseTickerStatus(ticker.id, ticker.status, { max_position_weight: parseFloat(e.target.value) / 100 })}
                                                            onBlur={autoConfigureUniverseWeights}
                                                            className="w-16 p-1 border rounded text-right text-xs"
                                                            placeholder="auto"
                                                        />
                                                        <span className="text-[10px] ml-1 text-gray-400">%</span>
                                                    </>
                                                ) : (
                                                    <span className="text-[10px] text-gray-400" title="Add to universe above to set weights">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {isUniverseTicker(ticker) && (
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

                {/* Execution & View Results — allocation from Monthly Plan + Portfolio Universe */}
                <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="text-xl font-bold text-slate-800 mb-1">Execute & Results</h2>
                        <p className="text-sm text-slate-600">Run once and get a clear execution summary with direct trade actions.</p>
                    </div>
                    <div className="p-6">
                        {noActionableWarning && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">{noActionableWarning}</div>
                        )}
                        {executionError && (
                            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex flex-col gap-2">
                                <span>{executionError}</span>
                                {onOpenWealthUltra && /quota|Wealth Ultra/i.test(executionError) && (
                                    <button type="button" onClick={onOpenWealthUltra} className="self-start px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-secondary">
                                        Open Wealth Ultra (rule-based, no AI)
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                            <button onClick={() => handleExecutePlan(false)} disabled={isExecuting || actionableCount === 0} className="flex-1 flex items-center justify-center px-4 py-2.5 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium" title={actionableCount === 0 ? 'Add Core or High-Upside tickers first' : 'Try AI first, then fall back to rule-based if needed'}>
                                <SparklesIcon className="h-5 w-5 mr-2" />
                                {isExecuting ? 'Executing...' : 'Execute now'}
                            </button>
                            <button onClick={() => handleExecutePlan(true)} disabled={isExecuting || actionableCount === 0} className="flex items-center justify-center px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:bg-gray-100 disabled:cursor-not-allowed font-medium" title="Skip AI and use rule-based allocation only">
                                Run rule-based only
                            </button>
                        </div>

                        {isExecuting && <div className="text-center p-4 text-sm text-slate-500 font-medium">Executing plan…</div>}

                        {executionResult && (
                            <div className="mt-6 space-y-5">
                                <p className="text-xs text-slate-500">All amounts in <strong>{planCurrency}</strong>. Execution date: {executionResult.date ? new Date(executionResult.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}.</p>

                                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                    <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                                        <h3 className="font-semibold text-slate-800">Execution Summary</h3>
                                        <div className="flex items-center gap-2">
                                            {executionResult.log_details?.includes('Rule-based execution') && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-200 text-slate-700" title="Computed without AI (rule-based fallback)">Rule-based</span>
                                            )}
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${executionResult.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {executionResult.status.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                    {executionResult.status === 'failure' && (
                                        <p className="text-sm text-amber-800 mb-3">No allocation could be generated. Add Core or High-Upside tickers in Portfolio Universe and set weights, then run again.</p>
                                    )}
                                    <dl className="grid grid-cols-2 xl:grid-cols-3 gap-2 text-sm">
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Monthly budget</dt>
                                            <dd className="mt-1 font-mono font-semibold tabular-nums text-slate-800 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(plan.monthlyBudget ?? 0, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total deployed</dt>
                                            <dd className="mt-1 font-mono font-semibold tabular-nums text-slate-800 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.totalInvestment, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Core</dt>
                                            <dd className="mt-1 font-mono tabular-nums text-slate-700 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.coreInvestment, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">High-Upside</dt>
                                            <dd className="mt-1 font-mono tabular-nums text-slate-700 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.upsideInvestment, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Speculative</dt>
                                            <dd className="mt-1 font-mono tabular-nums text-slate-700 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.speculativeInvestment, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Redirected</dt>
                                            <dd className="mt-1 font-mono tabular-nums text-slate-700 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.redirectedInvestment, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-0 col-span-2 xl:col-span-3">
                                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Unused (not allocated)</dt>
                                            <dd className="mt-1 font-mono tabular-nums text-slate-700 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(executionResult.unusedUpsideFunds, { inCurrency: planCurrency, digits: 0 })}</dd>
                                        </div>
                                    </dl>
                                    <p className="text-xs text-slate-500 mt-2">Total deployed + unused should match monthly budget (within rounding).</p>
                                </div>

                                <div>
                                    <h3 className="font-semibold text-slate-800 mb-2">Proposed Trades</h3>
                                    {executionResult.trades.length === 0 ? (
                                        <p className="text-sm text-slate-500 py-2">No trades proposed (e.g. amounts below minimum order or no eligible tickers).</p>
                                    ) : (
                                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                                            <table className="w-full table-fixed text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                                                        <th className="w-[22%] px-3 py-2 font-semibold">Ticker</th>
                                                        <th className="px-3 py-2 font-semibold">Sleeve / Reason</th>
                                                        <th className="w-[30%] px-3 py-2 font-semibold text-right whitespace-nowrap">Amount (Plan / Share Currency)</th>
                                                        {onOpenRecordTrade && <th className="w-[132px] px-3 py-2" />}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {executionResult.trades.map((trade, index) => {
                                                        const suggestion = getTradeExecutionSuggestion(trade);
                                                        return (
                                                        <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 align-top">
                                                            <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{trade.ticker}</td>
                                                            <td className="px-3 py-2 text-slate-600 break-words leading-snug">{trade.reason}</td>
                                                            <td className="px-3 py-2 text-right">
                                                                <div className="font-mono font-semibold tabular-nums text-primary whitespace-nowrap">{formatCurrencyString(trade.amount, { inCurrency: planCurrency, digits: 0 })}</div>
                                                                {trade.tradeCurrency && trade.tradeCurrency !== planCurrency && typeof trade.amountInTradeCurrency === 'number' && (
                                                                    <div className="text-[11px] text-slate-500 mt-0.5 whitespace-nowrap">≈ {formatCurrencyString(trade.amountInTradeCurrency, { inCurrency: trade.tradeCurrency, digits: 0 })} ({trade.tradeCurrency})</div>
                                                                )}
                                                                {suggestion.suggestedPrice && suggestion.suggestedQuantity && (
                                                                    <div className="text-[11px] text-slate-500 mt-0.5 whitespace-nowrap">{suggestion.suggestedQuantity.toFixed(4)} sh @ {formatCurrencyString(suggestion.suggestedPrice, { inCurrency: suggestion.tradeCurrency, digits: 2 })}</div>
                                                                )}
                                                            </td>
                                                            {onOpenRecordTrade && (
                                                                <td className="px-3 py-2 text-right">
                                                                    <button type="button" onClick={() => onOpenRecordTrade({ ticker: trade.ticker, amount: trade.amount, reason: trade.reason, price: suggestion.suggestedPrice, quantity: suggestion.suggestedQuantity, tradeCurrency: suggestion.tradeCurrency })} className="text-xs px-2.5 py-1.5 rounded-md border border-primary text-primary hover:bg-primary hover:text-white transition-colors whitespace-nowrap">Record trade</button>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );})}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {onOpenWealthUltra && (
                                        <p className="text-xs text-slate-500 mt-3">Use <button type="button" onClick={onOpenWealthUltra} className="text-primary font-medium hover:underline">Wealth Ultra</button> to see live allocation and export orders.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
// #endregion

interface InvestmentsProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const Investments: React.FC<InvestmentsProps> = ({ pageAction, clearPageAction, setActivePage, triggerPageAction: _triggerPageAction }) => {
  const { data, addPlatform, updatePlatform, deletePlatform, recordTrade, addPortfolio, updatePortfolio, deletePortfolio, updateHolding } = useContext(DataContext)!;
  const { isAiAvailable } = useAI();
  const { simulatedPrices } = useMarketData();
  const { formatCurrency, formatCurrencyString } = useFormatCurrency();
  const [activeTab, setActiveTab] = useState<InvestmentSubPage>('Overview');
  
  const [isHoldingModalOpen, setIsHoldingModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<(Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }) | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<InvestmentPortfolio | null>(null);
  
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

  const { exchangeRate } = useCurrency();
  const { totalValue, totalGainLoss, roi, totalDailyPnL, trendPercentage } = useMemo(() => {
    if (!data || !data.investments) {
        return { totalValue: 0, totalGainLoss: 0, roi: 0, totalDailyPnL: 0, trendPercentage: 0 };
    }
    const rate = exchangeRate;
    let valueSAR = 0, valueUSD = 0;
    data.investments.forEach((p: InvestmentPortfolio) => {
        const cur = (p.currency || 'USD') as TradeCurrency;
        const v = (p.holdings || []).reduce((s: number, h: Holding) => s + (simulatedPrices[h.symbol] ? simulatedPrices[h.symbol].price * h.quantity : h.currentValue), 0);
        if (cur === 'SAR') valueSAR += v; else valueUSD += v;
    });
    const totalInvestmentsValueSAR = valueSAR + valueUSD * rate;
    const allCommodities = data.commodityHoldings || [];
    const totalCommoditiesValue = allCommodities.reduce((sum, ch) => sum + (simulatedPrices[ch.symbol] ? simulatedPrices[ch.symbol].price * ch.quantity : ch.currentValue), 0);
    const totalValue = totalInvestmentsValueSAR + totalCommoditiesValue;

    let invSAR = 0, invUSD = 0, wdrSAR = 0, wdrUSD = 0;
    data.investmentTransactions.filter((t: InvestmentTransaction) => t.type === 'buy').forEach((t: InvestmentTransaction) => { const c = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency; if (c === 'SAR') invSAR += t.total ?? 0; else invUSD += t.total ?? 0; });
    data.investmentTransactions.filter((t: InvestmentTransaction) => t.type === 'sell').forEach((t: InvestmentTransaction) => { const c = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency; if (c === 'SAR') wdrSAR += t.total ?? 0; else wdrUSD += t.total ?? 0; });
    const totalInvestedSAR = invSAR + invUSD * rate;
    const totalWithdrawnSAR = wdrSAR + wdrUSD * rate;
    const commodityCost = allCommodities.reduce((sum, ch) => sum + ch.purchaseValue, 0);
    const netCapital = totalInvestedSAR - totalWithdrawnSAR + commodityCost;
    const totalGainLoss = totalValue - netCapital;
    const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;

    const allHoldings = data.investments.flatMap((p: InvestmentPortfolio) => p.holdings || []);
    const totalDailyPnL = [...allHoldings, ...allCommodities].reduce((sum, item) => (simulatedPrices[item.symbol] ? sum + simulatedPrices[item.symbol].change * item.quantity : sum), 0);
    const previousTotalValue = totalValue - totalDailyPnL;
    const trendPercentage = previousTotalValue > 0 ? (totalDailyPnL / previousTotalValue) * 100 : 0;

    return { totalValue, totalGainLoss, roi, totalDailyPnL, trendPercentage };
  }, [data.investments, data.investmentTransactions, data.commodityHoldings, simulatedPrices, exchangeRate]);


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
    if (pageAction === 'focus-investment-plan') {
        setActiveTab('Investment Plan');
        clearPageAction?.();
    }
  }, [pageAction, clearPageAction]);

  const investmentAccounts = useMemo(() => data.accounts.filter(acc => acc.type === 'Investment'), [data.accounts]);

  const handleHoldingClick = (holding: (Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }), portfolio: InvestmentPortfolio) => { setSelectedHolding(holding); setSelectedPortfolio(portfolio); setIsHoldingModalOpen(true); };
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
            onOpenAddPortfolio={() => handleOpenPortfolioModal(null, null)}
            setActivePage={setActivePage}
            setActiveTab={setActiveTab}
            onEditPlatform={handleOpenPlatformModal} 
            onDeletePlatform={(p) => handleOpenDeleteModal(p)}
            onEditPortfolio={(p) => handleOpenPortfolioModal(p, p.accountId)}
            onDeletePortfolio={(p) => handleOpenDeleteModal(p)}
            onHoldingClick={handleHoldingClick}
            onEditHolding={handleOpenHoldingEditModal}
        />;
      case 'Investment Plan': return (
                <InvestmentPlan
                    onNavigateToTab={(tab) => setActiveTab(tab)}
                    onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined}
                    onOpenRecordTrade={(trade) => {
                        const normalizedSymbol = trade.ticker.trim().toUpperCase();
                        const targetPortfolio = data.investments.find((portfolio) =>
                            (portfolio.holdings || []).some((holding) => (holding.symbol || '').trim().toUpperCase() === normalizedSymbol)
                        ) || data.investments.find((portfolio) => ((portfolio.currency as TradeCurrency) || 'USD') === (trade.tradeCurrency || 'USD')) || data.investments[0];
                        setTradeInitialData({
                            symbol: trade.ticker,
                            amount: trade.amount,
                            tradeType: 'buy' as const,
                            reason: trade.reason,
                            price: trade.price,
                            quantity: trade.quantity,
                            tradeCurrency: trade.tradeCurrency,
                            accountId: targetPortfolio?.accountId,
                            portfolioId: targetPortfolio?.id,
                            name: targetPortfolio?.holdings?.find((holding) => (holding.symbol || '').trim().toUpperCase() === normalizedSymbol)?.name,
                        });
                        setIsTradeModalOpen(true);
                    }}
                />
            );
      case 'Dividend Tracker': return <DividendTrackerView />;
      case 'Recovery Plan': return <RecoveryPlanView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined} />;
      case 'AI Rebalancer': return <AIRebalancerView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined} />;
      case 'Watchlist': return <WatchlistView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-6 sm:px-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight text-white">Investments</h1>
                        <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100 backdrop-blur">Unified portfolio workspace</span>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm text-slate-200/90">Track every portfolio, evaluate share-level insights, and run AI workflows from one professional command center.</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <LivePricesStatus variant="inline" className="flex-shrink-0 text-slate-100" />
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${isAiAvailable ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'}`}>
                            {isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Enabled' : 'Unavailable'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setActiveTab('Investment Plan')} className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/20">
                        <SparklesIcon className="h-4 w-4" /> Smart Plan
                    </button>
                    <button onClick={() => setIsTradeModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100">
                        <ArrowsRightLeftIcon className="h-4 w-4" /> Record Trade
                    </button>
                </div>
            </div>
        </header>

        <section className="cards-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" aria-label="Investment summary">
            <Card
                title="Total Value"
                value={formatCurrencyString(totalValue)}
                density="compact"
                indicatorColor="green"
                valueColor="text-emerald-700"
                icon={<ChartPieIcon className="h-5 w-5 text-emerald-600" aria-hidden />}
                tooltip="Combined value of all portfolios and commodity holdings at current prices."
            />
            <Card
                title="Unrealized P/L"
                value={formatCurrency(totalGainLoss, { colorize: true })}
                density="compact"
                indicatorColor={totalGainLoss >= 0 ? 'green' : 'red'}
                valueColor={totalGainLoss >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                icon={<ArrowsRightLeftIcon className={`h-5 w-5 ${totalGainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
                tooltip="Profit or loss on holdings vs cost basis (not yet realized)."
            />
            <Card
                title="Portfolio ROI"
                value={`${roi.toFixed(2)}%`}
                valueColor={roi >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                density="compact"
                indicatorColor={roi >= 0 ? 'green' : 'red'}
                icon={<ArrowTrendingUpIcon className={`h-5 w-5 ${roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
                tooltip="Return on investment based on total capital invested across portfolios."
            />
            <Card
                title="Daily P/L"
                value={formatCurrency(totalDailyPnL, { colorize: true, digits: 2 })}
                trend={getTrendString(trendPercentage)}
                tooltip="Total profit or loss for all investments based on today's simulated market changes."
                density="compact"
                indicatorColor={totalDailyPnL >= 0 ? 'green' : 'red'}
                valueColor={totalDailyPnL >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                icon={<ArrowsRightLeftIcon className={`h-5 w-5 ${totalDailyPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
            />
        </section>

        <PlanSummary onEditPlan={() => setActiveTab('Investment Plan')} />
      
        <nav className="rounded-2xl border border-slate-200 bg-white p-2" aria-label="Investment sections">
            <div className="flex gap-1 overflow-x-auto scrollbar-thin">
              {INVESTMENT_SUB_PAGES.map(tab => (
                <button
                  key={tab.name}
                  onClick={() => setActiveTab(tab.name)}
                  className={`inline-flex items-center gap-2 whitespace-nowrap py-2.5 px-4 rounded-xl font-medium text-sm transition-colors ${
                    activeTab === tab.name
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <tab.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {tab.name}
                </button>
              ))}
            </div>
        </nav>
      
      <InvestmentTabErrorBoundary activeTab={activeTab} onReset={() => setActiveTab('Overview')}>
        <Suspense fallback={<LoadingSpinner message="Loading..." className="min-h-[12rem]" />}>
          {renderContent()}
        </Suspense>
      </InvestmentTabErrorBoundary>

      <HoldingDetailModal isOpen={isHoldingModalOpen} onClose={() => { setIsHoldingModalOpen(false); setSelectedPortfolio(null); }} holding={selectedHolding} portfolio={selectedPortfolio} />
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
