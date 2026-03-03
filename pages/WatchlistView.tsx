import React, { useState, useContext, useCallback, useEffect, useRef, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert, PriceAlertCurrency, WatchlistItem } from '../types';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { TrashIcon } from '../components/icons/TrashIcon';
import { getExchangeAndCurrencyForSymbol, getStockCandles1M, type CandlePoint, getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { getAITradeAnalysis, getAIWatchlistAdvice, formatAiError } from '../services/geminiService';
import { fetchCompanyNameForSymbol } from '../hooks/useSymbolCompanyName';
import Modal from '../components/Modal';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import PriceAlertModal from '../components/PriceAlertModal';
import { BellAlertIcon } from '../components/icons/BellAlertIcon';
import { BellIcon } from '../components/icons/BellIcon';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { useMarketData } from '../context/MarketDataContext';
import LivePricesStatus from '../components/LivePricesStatus';
import InfoHint from '../components/InfoHint';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';

const ALERT_CURRENCY_OPTIONS: { value: PriceAlertCurrency; label: string }[] = [
    { value: 'USD', label: 'USD' },
    { value: 'SAR', label: 'SAR' },
];

const AddWatchlistItemModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onAdd: (item: WatchlistItem) => void;
    onAddAlert?: (symbol: string, targetPrice: number, currency: PriceAlertCurrency) => void;
}> = ({ isOpen, onClose, onAdd, onAddAlert }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [setAlert, setSetAlert] = useState(false);
    const [targetPrice, setTargetPrice] = useState('');
    const [alertCurrency, setAlertCurrency] = useState<PriceAlertCurrency>('USD');
    const nameRef = useRef(name);
    nameRef.current = name;

    useEffect(() => {
        if (isOpen) {
            setSymbol('');
            setName('');
            setSetAlert(false);
            setTargetPrice('');
            setAlertCurrency('USD');
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) return;
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((apiName) => {
                if (apiName && !nameRef.current.trim()) setName(apiName);
            });
        }, 600);
        return () => clearTimeout(t);
    }, [symbol, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        const displayName = name.trim() || sym;
        onAdd({ symbol: sym, name: displayName });
        if (onAddAlert && setAlert && targetPrice.trim()) {
            const price = parseFloat(targetPrice.replace(/,/g, ''));
            if (Number.isFinite(price) && price > 0) onAddAlert(sym, price, alertCurrency);
        }
        setSymbol('');
        setName('');
        setSetAlert(false);
        setTargetPrice('');
        setAlertCurrency('USD');
        onClose();
    };
    const handleClose = () => {
        setSetAlert(false);
        setTargetPrice('');
        setAlertCurrency('USD');
        onClose();
    };
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Add to Watchlist">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="stock-symbol" className="block text-sm font-medium text-gray-700">Stock Symbol</label>
                    <input type="text" id="stock-symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" placeholder="e.g. AAPL or 2222.SR" />
                </div>
                <div>
                    <label htmlFor="stock-name" className="block text-sm font-medium text-gray-700">Company Name</label>
                    <input type="text" id="stock-name" value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 rounded-md" placeholder="Auto-filled from symbol (edit if needed)" />
                </div>
                {onAddAlert && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={setAlert} onChange={e => setSetAlert(e.target.checked)} className="rounded border-gray-300 text-primary" />
                            <span className="text-sm font-medium text-gray-700">Set a price alert</span>
                            <BellIcon className="h-4 w-4 text-amber-500" />
                        </label>
                        {setAlert && (
                            <div className="space-y-2">
                                <div className="flex gap-2 items-end">
                                    <div className="w-24">
                                        <label htmlFor="add-alert-currency" className="block text-xs font-medium text-gray-500 mb-0.5">Currency</label>
                                        <select
                                            id="add-alert-currency"
                                            value={alertCurrency}
                                            onChange={e => setAlertCurrency(e.target.value as PriceAlertCurrency)}
                                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                        >
                                            {ALERT_CURRENCY_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <label htmlFor="add-alert-price" className="block text-xs font-medium text-gray-500 mb-0.5">Notify when price reaches</label>
                                        <input
                                            type="number"
                                            id="add-alert-price"
                                            value={targetPrice}
                                            onChange={e => setTargetPrice(e.target.value)}
                                            min="0.01"
                                            step="0.01"
                                            placeholder={alertCurrency === 'SAR' ? 'e.g. 350.50' : 'e.g. 185.00'}
                                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Add to Watchlist</button>
            </form>
        </Modal>
    );
};

const WatchlistItemRow: React.FC<{
    item: WatchlistItem;
    priceInfo: { price: number; change: number; changePercent: number };
    activeAlerts: PriceAlert[];
    historical1M?: CandlePoint[] | null;
    fundamentals?: HoldingFundamentals | null;
    fundamentalsLoading?: boolean;
    onOpenAlertModal: (item: WatchlistItem) => void;
    onOpenDeleteModal: (item: WatchlistItem) => void;
}> = ({ item, priceInfo, activeAlerts, historical1M, fundamentals, fundamentalsLoading, onOpenAlertModal, onOpenDeleteModal }) => {
    const market = getExchangeAndCurrencyForSymbol(item.symbol);
    const priceCurrency: 'USD' | 'SAR' = (market?.currency === 'SAR' ? 'SAR' : 'USD');
    const formatInCurrency = (value: number, currency: 'USD' | 'SAR', digits = 2) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    const formatPrice = (p: number) => formatInCurrency(p, priceCurrency);
    const fundamentalsCurrencyRaw = (fundamentals?.currency || '').toUpperCase();
    const fundamentalsCurrency: 'USD' | 'SAR' = fundamentalsCurrencyRaw === 'SAR' ? 'SAR' : 'USD';
    const formatFundamentalValue = (value: number, digits = 0) =>
        formatInCurrency(value, fundamentalsCurrency, digits);
    const [flashClass, setFlashClass] = useState('');
    const prevPriceRef = useRef<number | undefined>(undefined);

    const targetValues = activeAlerts.map(a => {
        const raw = a.targetPrice ?? (a as any).target_price;
        const price = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
        return { price: Number.isFinite(price) ? price : 0, currency: (a.currency ?? 'USD') as 'USD' | 'SAR' };
    }).filter(t => t.price > 0);
    const targetsSameCurrency = targetValues.filter(t => t.currency === priceCurrency).map(t => t.price);
    const nearestTarget = targetsSameCurrency.length > 0 ? targetsSameCurrency.reduce((a, b) => (Math.abs(priceInfo.price - a) < Math.abs(priceInfo.price - b) ? a : b)) : null;
    const targetPrice = nearestTarget;
    const formatTarget = (p: number, curr: 'USD' | 'SAR') => `${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}`;
    const targetDistancePercent = targetPrice && targetPrice > 0 ? ((priceInfo.price - targetPrice) / targetPrice) * 100 : null;
    const targetStatusClass = !targetPrice
        ? 'bg-gray-100 text-gray-600'
        : Math.abs(targetDistancePercent || 0) <= 1
            ? 'bg-yellow-100 text-yellow-800'
            : (targetDistancePercent || 0) >= 0
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700';
    const targetStatusLabel = !targetPrice
        ? (targetValues.length > 0 && targetsSameCurrency.length === 0 ? 'Alert (other currency)' : 'No alert')
        : targetsSameCurrency.length > 1
            ? `${targetsSameCurrency.length} alerts`
            : Math.abs(targetDistancePercent || 0) <= 1
                ? 'Near target'
                : (targetDistancePercent || 0) >= 0
                    ? 'Above target'
                    : 'Below target';

    useEffect(() => {
        if (priceInfo) {
            if (prevPriceRef.current !== undefined && priceInfo.price !== prevPriceRef.current) {
                setFlashClass(priceInfo.price > prevPriceRef.current ? 'flash-green-bg' : 'flash-red-bg');
                const timer = setTimeout(() => setFlashClass(''), 1000);
                
                prevPriceRef.current = priceInfo.price;
                return () => clearTimeout(timer);
            } else {
                 prevPriceRef.current = priceInfo.price;
            }
        }
    }, [priceInfo]);

    return (
        <tr className={`transition-colors duration-1000 ${flashClass}`}>
            <td className="px-4 py-2 whitespace-nowrap">
                <div className="font-medium text-gray-900">{item.symbol}</div>
                <div className="text-xs text-gray-500 truncate max-w-[150px]">{item.name}{market ? ` · ${market.exchange}` : ''}</div>
            </td>
            <td className="px-4 py-2 w-36">
                <MiniPriceChart symbol={item.symbol} currentPrice={priceInfo.price} changePercent={priceInfo.changePercent} formatPrice={formatPrice} showIllustrativeLabel historicalData={historical1M} />
            </td>
            <td className="px-4 py-2 text-right font-semibold text-dark whitespace-nowrap tabular-nums">
                {formatInCurrency(priceInfo.price, priceCurrency)}
                {market && <span className="block text-[10px] text-slate-500 font-normal">{market.exchange}</span>}
            </td>
            <td className={`px-4 py-2 text-right font-medium text-sm whitespace-nowrap tabular-nums ${priceInfo.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {priceInfo.change >= 0 ? '+' : ''}{formatInCurrency(priceInfo.change, priceCurrency)} ({priceInfo.changePercent.toFixed(2)}%)
            </td>
            <td className="px-4 py-2 text-left align-top whitespace-nowrap text-xs text-slate-600 max-w-[220px]">
                {fundamentalsLoading && !fundamentals && <span className="text-[11px] text-slate-400">Loading events…</span>}
                {!fundamentalsLoading && !fundamentals && <span className="text-[11px] text-slate-400">No event data</span>}
                {fundamentals && (
                    <div className="space-y-0.5">
                        <div className="text-[11px] text-slate-700">
                            {fundamentals.nextEarnings?.date ? (
                                <>
                                    {new Date(fundamentals.nextEarnings.date).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                    })}
                                    {fundamentals.nextEarnings.quarter != null && fundamentals.nextEarnings.year != null && (
                                        <span className="text-[10px] text-slate-500 ml-1">
                                            · Q{fundamentals.nextEarnings.quarter} {fundamentals.nextEarnings.year}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-[11px] text-slate-400">No upcoming earnings</span>
                            )}
                        </div>
                        {typeof fundamentals.nextEarnings?.revenueEstimate === 'number' &&
                            fundamentals.nextEarnings.revenueEstimate > 0 && (
                                <div className="text-[11px] text-slate-500">
                                    Rev est ({fundamentalsCurrency}):{' '}
                                    {formatFundamentalValue(fundamentals.nextEarnings.revenueEstimate, 0)}
                                </div>
                            )}
                        {fundamentals.dividend &&
                            (typeof fundamentals.dividend.dividendYieldPct === 'number' ||
                                typeof fundamentals.dividend.dividendPerShareAnnual === 'number') && (
                                <div className="text-[11px] text-slate-500">
                                    Div
                                    {typeof fundamentals.dividend.dividendYieldPct === 'number' &&
                                        fundamentals.dividend.dividendYieldPct > 0 &&
                                        ` ${fundamentals.dividend.dividendYieldPct.toFixed(2)}%`}
                                    {typeof fundamentals.dividend.dividendPerShareAnnual === 'number' &&
                                        fundamentals.dividend.dividendPerShareAnnual > 0 && (
                                            <>
                                                {' '}
                                                · {formatFundamentalValue(fundamentals.dividend.dividendPerShareAnnual, 2)}
                                                /sh
                                            </>
                                        )}
                                </div>
                            )}
                    </div>
                )}
            </td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
                <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-gray-500">
                        {targetValues.length > 0 ? (targetValues.length === 1 ? formatTarget(targetValues[0].price, targetValues[0].currency) : targetValues.map(t => formatTarget(t.price, t.currency)).join(', ')) : '--'}
                    </span>
                    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${targetStatusClass}`}>
                        {targetStatusLabel}
                        {targetDistancePercent !== null && targetsSameCurrency.length <= 1 && ` (${targetDistancePercent >= 0 ? '+' : ''}${targetDistancePercent.toFixed(1)}%)`}
                    </span>
                </div>
            </td>
            <td className="px-4 py-2 text-center">
                <div className="flex justify-center items-center space-x-1">
                    <button onClick={() => onOpenAlertModal(item)} className="text-gray-400 hover:text-yellow-500 p-1" title={activeAlerts.length > 0 ? 'Manage price alerts' : 'Set price alert'}>
                        {activeAlerts.length > 0 ? <BellAlertIcon className="h-5 w-5 text-yellow-500"/> : <BellIcon className="h-5 w-5" />}
                    </button>
                    <button onClick={() => onOpenDeleteModal(item)} className="text-gray-400 hover:text-red-500 p-1" title="Delete">
                        <TrashIcon className="h-5 w-5" />
                    </button>
                </div>
            </td>
        </tr>
    );
};


interface WatchlistViewProps {
  onNavigateToTab?: (tab: string) => void;
}

const WatchlistView: React.FC<WatchlistViewProps> = ({ onNavigateToTab }) => {
    const { data, addWatchlistItem, deleteWatchlistItem, addPriceAlert, deletePriceAlert } = useContext(DataContext)!;
    const { simulatedPrices } = useMarketData();
    const { isAiAvailable } = useAI();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<WatchlistItem | null>(null);
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
    const [stockForAlert, setStockForAlert] = useState<{ symbol: string, name: string, price: number } | null>(null);
    const [aiTradeAnalysis, setAiTradeAnalysis] = useState('');
    const [aiTradeLoading, setAiTradeLoading] = useState(false);
    const [aiTradeError, setAiTradeError] = useState<string | null>(null);
    const [aiWatchlistTips, setAiWatchlistTips] = useState('');
    const [aiWatchlistLoading, setAiWatchlistLoading] = useState(false);
    const [aiWatchlistError, setAiWatchlistError] = useState<string | null>(null);
    const [historicalBySymbol, setHistoricalBySymbol] = useState<Record<string, CandlePoint[] | null>>({});
    const [fundamentalsBySymbol, setFundamentalsBySymbol] = useState<Record<string, HoldingFundamentals | null>>({});
    const [fundamentalsLoading, setFundamentalsLoading] = useState(false);

    const watchlistSymbolKey = useMemo(() => data.watchlist.map((w) => w.symbol.trim().toUpperCase()).filter(Boolean).join(','), [data.watchlist]);
    useEffect(() => {
        if (!import.meta.env.VITE_FINNHUB_API_KEY) return;
        const symbols = watchlistSymbolKey ? watchlistSymbolKey.split(',') : [];
        if (symbols.length === 0) {
            setHistoricalBySymbol({});
            return;
        }
        let cancelled = false;
        const delayMs = 1200;
        (async () => {
            const next: Record<string, CandlePoint[] | null> = {};
            for (const symbol of symbols) {
                if (cancelled) break;
                try {
                    const points = await getStockCandles1M(symbol);
                    if (!cancelled) next[symbol] = points.length > 0 ? points : null;
                } catch {
                    if (!cancelled) next[symbol] = null;
                }
                if (!cancelled && symbols.indexOf(symbol) < symbols.length - 1) await new Promise((r) => setTimeout(r, delayMs));
            }
            if (!cancelled) setHistoricalBySymbol((prev) => ({ ...prev, ...next }));
        })();
        return () => { cancelled = true; };
    }, [watchlistSymbolKey]);

    useEffect(() => {
        if (!import.meta.env.VITE_FINNHUB_API_KEY) return;
        const symbols = watchlistSymbolKey ? watchlistSymbolKey.split(',') : [];
        if (symbols.length === 0) {
            setFundamentalsBySymbol({});
            return;
        }
        let cancelled = false;
        setFundamentalsLoading(true);
        (async () => {
            try {
                const entries = await Promise.all(
                    symbols.map(async (raw) => {
                        const sym = raw.trim().toUpperCase();
                        if (!sym) return [sym, null] as const;
                        try {
                            const data = await getHoldingFundamentals(sym);
                            return [sym, data] as const;
                        } catch {
                            return [sym, null] as const;
                        }
                    }),
                );
                if (cancelled) return;
                const next: Record<string, HoldingFundamentals | null> = {};
                for (const [sym, info] of entries) {
                    if (sym) next[sym] = info;
                }
                setFundamentalsBySymbol(next);
            } finally {
                if (!cancelled) setFundamentalsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [watchlistSymbolKey]);

    const watchlistInsights = useMemo(() => {
        const rows = data.watchlist.map((item) => ({
            ...item,
            priceInfo: simulatedPrices[item.symbol] || { price: 0, change: 0, changePercent: 0 },
            activeAlerts: data.priceAlerts.filter(a => (a.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && a.status === 'active'),
        }));
        const positiveMovers = rows.filter(r => r.priceInfo.changePercent > 0).length;
        const negativeMovers = rows.filter(r => r.priceInfo.changePercent < 0).length;
        const alertCoverage = rows.filter(r => r.activeAlerts.length > 0).length;
        return { positiveMovers, negativeMovers, alertCoverage, total: rows.length };
    }, [data.watchlist, data.priceAlerts, simulatedPrices]);

    const handleOpenDeleteModal = (item: WatchlistItem) => { setItemToDelete(item); setIsDeleteModalOpen(true); };
    const handleConfirmDelete = () => { if (itemToDelete) { deleteWatchlistItem(itemToDelete.symbol); setIsDeleteModalOpen(false); setItemToDelete(null); } };
    const handleOpenAlertModal = (item: WatchlistItem) => { setStockForAlert({ ...item, price: simulatedPrices[item.symbol]?.price || 0 }); setIsAlertModalOpen(true); };

    const recentTransactions = (data.investmentTransactions ?? []).slice(0, 10);
    const analysisContext = useMemo(() => {
        const holdings = (data.investments ?? []).flatMap(p => p.holdings ?? []);
        const bySymbol = new Map<string, number>();
        holdings.forEach(h => bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + h.currentValue));
        const summary = Array.from(bySymbol.entries()).map(([s, v]) => `${s}: ${v.toFixed(0)}`).join('; ') || 'None';
        const watchlistSymbols = (data.watchlist ?? []).map(w => w.symbol);
        const plan = data.investmentPlan;
        return {
            holdingsSummary: summary,
            watchlistSymbols: watchlistSymbols.length > 0 ? watchlistSymbols : undefined,
            planBudget: plan?.monthlyBudget,
            corePct: plan?.coreAllocation,
            upsidePct: plan?.upsideAllocation,
        };
    }, [data.investments, data.watchlist, data.investmentPlan]);

    const handleAnalyzeTrades = useCallback(async () => {
        setAiTradeError(null);
        setAiTradeLoading(true);
        try {
            const analysis = await getAITradeAnalysis(recentTransactions, analysisContext);
            setAiTradeAnalysis(analysis);
        } catch (err) {
            setAiTradeError(formatAiError(err));
            setAiTradeAnalysis('');
        } finally {
            setAiTradeLoading(false);
        }
    }, [recentTransactions, analysisContext]);

    const handleGetWatchlistTips = useCallback(async () => {
        if (!data.watchlist?.length) {
            setAiWatchlistError('Add at least one symbol to your watchlist first.');
            return;
        }
        setAiWatchlistError(null);
        setAiWatchlistLoading(true);
        try {
            const tips = await getAIWatchlistAdvice(data.watchlist.map(w => w.symbol));
            setAiWatchlistTips(tips);
        } catch (err) {
            setAiWatchlistError(formatAiError(err));
            setAiWatchlistTips('');
        } finally {
            setAiWatchlistLoading(false);
        }
    }, [data.watchlist]);
    const handleSaveAlert = (symbol: string, targetPrice: number, currency: 'USD' | 'SAR') => { addPriceAlert({ symbol, targetPrice, currency }); };
    const handleDeleteAlert = (alertId: string) => { deletePriceAlert(alertId); };

    return (
        <div className="mt-6 space-y-6">
            {/* Hero */}
            <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold text-slate-800">Watchlist</h2><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Enabled' : 'Unavailable'}</span></div>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                    Track symbols, prices, and 1M trend. Set price alerts and get AI trade insights and watchlist tips. Sync tickers with <strong>Investment Plan</strong> and <strong>Portfolio Universe</strong> for allocation.
                </p>
                {onNavigateToTab && (
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
                        <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-sm font-medium text-primary hover:underline">Portfolios</button>
                        <span className="text-slate-300">·</span>
                        <button type="button" onClick={() => onNavigateToTab('Investment Plan')} className="text-sm font-medium text-primary hover:underline">Investment Plan</button>
                        <span className="text-slate-300">·</span>
                        <button type="button" onClick={() => onNavigateToTab('Recovery Plan')} className="text-sm font-medium text-primary hover:underline">Recovery Plan</button>
                    </div>
                )}
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Positive Movers</p><p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{watchlistInsights.positiveMovers}</p></div>
                <div className="rounded-xl border border-rose-100 bg-gradient-to-br from-white to-rose-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Negative Movers</p><p className="text-2xl font-bold text-rose-700 tabular-nums mt-1">{watchlistInsights.negativeMovers}</p></div>
                <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Alerts</p><p className="text-2xl font-bold text-amber-700 tabular-nums mt-1">{watchlistInsights.alertCoverage}/{watchlistInsights.total}</p></div>
            </div>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold text-dark">My Watchlist</h2>
                        <LivePricesStatus variant="inline" className="flex-shrink-0" />
                    </div>
                    <button onClick={() => setIsAddModalOpen(true)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary text-sm w-full sm:w-auto">Add Stock</button>
                </div>
                <div className="overflow-x-auto overflow-y-visible"><table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase align-middle"><span className="inline-flex items-center gap-1 flex-nowrap whitespace-nowrap">1M trend <InfoHint placement="bottom" text="When available, the chart and percentage show real 1-month daily history from market data. Otherwise an illustrative curve is shown." /></span></th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Day's Change</th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next event</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Target</th><th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.watchlist.map((item) => {
                            const priceInfo = simulatedPrices[item.symbol] || { price: 0, change: 0, changePercent: 0 };
                            const activeAlerts = data.priceAlerts.filter(a => (a.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && a.status === 'active');
                            const symKey = item.symbol.trim().toUpperCase();
                            return (
                               <WatchlistItemRow
                                  key={item.symbol}
                                  item={item}
                                  priceInfo={priceInfo}
                                  activeAlerts={activeAlerts}
                                  historical1M={historicalBySymbol[symKey] ?? undefined}
                                  fundamentals={fundamentalsBySymbol[symKey] ?? undefined}
                                  fundamentalsLoading={fundamentalsLoading && !fundamentalsBySymbol[symKey]}
                                  onOpenAlertModal={handleOpenAlertModal}
                                  onOpenDeleteModal={handleOpenDeleteModal}
                               />
                            );
                        })}
                    </tbody>
                </table>
                {data.watchlist.length === 0 && (<div className="text-center py-10 text-slate-500">Your watchlist is empty. Add symbols to track prices and get AI tips.</div>)}</div>
            </div>

            <div className="lg:col-span-1 space-y-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h4 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><SparklesIcon className="h-5 w-5 text-primary"/>AI Trade Insights</h4>
                    <p className="text-xs text-slate-600 mb-3">Educational feedback on your recent trades, patterns, and portfolio impact.</p>
                    {recentTransactions.length > 0 ? (
                        <>
                            <button onClick={handleAnalyzeTrades} disabled={aiTradeLoading || !isAiAvailable} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-60 text-sm font-medium">
                                <SparklesIcon className="h-4 w-4" /> {aiTradeLoading ? 'Analyzing...' : 'Analyze Trades'}
                            </button>
                            {aiTradeError && <div className="mt-2"><p className="text-xs text-red-600">{aiTradeError}</p><button type="button" onClick={handleAnalyzeTrades} className="mt-1 text-xs font-medium text-primary hover:underline">Retry</button></div>}
                            {aiTradeAnalysis && <div className="mt-3 prose prose-sm max-w-none text-left max-h-[280px] overflow-y-auto rounded-lg bg-violet-50/80 p-3 border border-violet-100"><SafeMarkdownRenderer content={aiTradeAnalysis} /></div>}
                        </>
                    ) : (
                        <p className="text-xs text-slate-500">Record trades from Investments to get AI feedback here.</p>
                    )}
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h4 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><SparklesIcon className="h-5 w-5 text-amber-500"/>Watchlist Tips</h4>
                    <p className="text-xs text-slate-600 mb-3">AI suggestions for your watchlist symbols (diversification, themes, concepts).</p>
                    <button onClick={handleGetWatchlistTips} disabled={aiWatchlistLoading || !data.watchlist?.length || !isAiAvailable} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60 text-sm font-medium">
                        <SparklesIcon className="h-4 w-4" /> {aiWatchlistLoading ? 'Generating...' : 'Get Recommendations'}
                    </button>
                    {aiWatchlistError && <div className="mt-2"><p className="text-xs text-red-600">{aiWatchlistError}</p><button type="button" onClick={handleGetWatchlistTips} className="mt-1 text-xs font-medium text-primary hover:underline">Retry</button></div>}
                    {aiWatchlistTips && <div className="mt-3 prose prose-sm max-w-none text-left max-h-[220px] overflow-y-auto rounded-lg bg-amber-50/80 p-3 border border-amber-100"><SafeMarkdownRenderer content={aiWatchlistTips} /></div>}
                </div>
                {!isAiAvailable && <p className="text-xs text-amber-700">AI is currently unavailable. Core watchlist tracking and alerts continue to work.</p>}<p className="text-[10px] text-slate-500">Not financial advice. For education only.</p>
            </div>
            </div>

            <AddWatchlistItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addWatchlistItem} onAddAlert={(sym, targetPrice, currency) => addPriceAlert({ symbol: sym, targetPrice, currency: currency ?? 'USD' })} />
            <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
            <PriceAlertModal isOpen={isAlertModalOpen} onClose={() => setIsAlertModalOpen(false)} onSave={handleSaveAlert} onDeleteAlert={handleDeleteAlert} stock={stockForAlert} existingAlerts={stockForAlert ? data.priceAlerts.filter(a => (a.symbol || '').toUpperCase() === (stockForAlert.symbol || '').toUpperCase()) : []} />
        </div>
    );
};

export default WatchlistView;