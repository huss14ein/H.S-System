import React, { useState, useContext, useCallback, useEffect, useRef, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert, PriceAlertCurrency, WatchlistItem, type Page } from '../types';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { TrashIcon } from '../components/icons/TrashIcon';
import { getExchangeAndCurrencyForSymbol, getStockCandles1M, type CandlePoint, getHoldingFundamentals, type HoldingFundamentals } from '../services/finnhubService';
import { getAITradeAnalysis, getAIWatchlistAdvice, formatAiError, translateFinancialInsightToArabic } from '../services/geminiService';
import { fetchCompanyNameForSymbol, useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel, formatSymbolWithCompany, type SymbolNamesMap } from '../components/SymbolWithCompanyName';
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
import { useCurrency } from '../context/CurrencyContext';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { XMarkIcon } from '../components/icons';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { rsi, rsiSignal, zScore, zScoreSignal, bollingerBands, shortTermCrossoverSignal } from '../services/technicalIndicators';
import { rankWatchlistIdeas } from '../services/decisionEngine';
import { inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useSelfLearning } from '../context/SelfLearningContext';

/** Merge live/simulated quote with daily-candle close when quote is missing (e.g. stale Tadawul). */
function resolveWatchlistPriceInfo(
    _symbol: string,
    sim: { price: number; change: number; changePercent: number } | undefined,
    candles: CandlePoint[] | null | undefined,
): { price: number; change: number; changePercent: number; source: 'live' | 'candle_close' | 'none' } {
    const live = sim?.price;
    if (sim && Number.isFinite(live) && (live as number) > 0) {
        return {
            price: live as number,
            change: Number.isFinite(sim.change) ? sim.change : 0,
            changePercent: Number.isFinite(sim.changePercent) ? sim.changePercent : 0,
            source: 'live',
        };
    }
    const c = candles ?? [];
    if (c.length >= 1) {
        const last = c[c.length - 1]?.price;
        const prev = c.length >= 2 ? c[c.length - 2]?.price : last;
        if (Number.isFinite(last) && (last as number) > 0) {
            const lastN = last as number;
            const prevN = Number.isFinite(prev) ? (prev as number) : lastN;
            const change = lastN - prevN;
            const changePercent = prevN > 0 ? (change / prevN) * 100 : 0;
            return { price: lastN, change, changePercent, source: 'candle_close' };
        }
    }
    return { price: 0, change: 0, changePercent: 0, source: 'none' };
}

interface WatchlistBucket {
    id: string;
    name: string;
    currency: PriceAlertCurrency;
    symbols: string[];
}

const ALERT_CURRENCY_OPTIONS: { value: PriceAlertCurrency; label: string }[] = [
    { value: 'USD', label: 'USD' },
    { value: 'SAR', label: 'SAR' },
];

const POPULAR_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', '2222.SR', '1120.SR', '1180.SR'];

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
    const [isLoadingName, setIsLoadingName] = useState(false);
    const [step, setStep] = useState<'main' | 'details'>('main');
    const [validationError, setValidationError] = useState<string | null>(null);
    const symbolInputRef = useRef<HTMLInputElement | null>(null);
    const priceInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setSymbol('');
            setName('');
            setSetAlert(false);
            setTargetPrice('');
            setAlertCurrency('USD');
            setStep('main');
            setIsLoadingName(false);
            setValidationError(null);
            setTimeout(() => symbolInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) {
            setName('');
            setIsLoadingName(false);
            return;
        }
        let cancelled = false;
        setIsLoadingName(true);
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((apiName) => {
                if (cancelled) return;
                if (apiName) setName(apiName);
                setIsLoadingName(false);
            }).catch(() => {
                if (!cancelled) setIsLoadingName(false);
            });
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [symbol, isOpen]);

    useEffect(() => {
        if (setAlert && priceInputRef.current) setTimeout(() => priceInputRef.current?.focus(), 100);
    }, [setAlert]);

    const handleQuickAdd = (sym: string) => {
        setSymbol(sym);
        setValidationError(null);
        symbolInputRef.current?.focus();
    };

    const handleSubmitMain = (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError(null);
        const sym = symbol.toUpperCase().trim();
        if (!sym) {
            setValidationError('Enter a stock symbol.');
            return;
        }
        if (sym.length > 10) {
            setValidationError('Symbol must be 1–10 characters.');
            return;
        }
        setStep('details');
    };

    const handleFinalSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError(null);
        const sym = symbol.toUpperCase().trim();
        if (!sym) {
            setValidationError('Enter a stock symbol.');
            return;
        }
        if (sym.length > 10) {
            setValidationError('Symbol must be 1–10 characters.');
            return;
        }
        const displayName = name.trim() || sym;
        if (displayName.length < 1) {
            setValidationError('Enter or confirm a name for the symbol.');
            return;
        }
        if (onAddAlert && setAlert && targetPrice.trim()) {
            const price = parseFloat(targetPrice.replace(/,/g, ''));
            if (!Number.isFinite(price) || price <= 0) {
                setValidationError('Target price must be a positive number.');
                return;
            }
            onAddAlert(sym, price, alertCurrency);
        }
        onAdd({ symbol: sym, name: displayName });
        onClose();
    };

    const handleClose = () => {
        setSetAlert(false);
        setTargetPrice('');
        setValidationError(null);
        onClose();
    };

    const handleBack = () => {
        setStep('main');
        setSetAlert(false);
        setTargetPrice('');
        setValidationError(null);
        setTimeout(() => symbolInputRef.current?.focus(), 100);
    };

    const sym = symbol.toUpperCase().trim();

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Add to Watchlist" maxWidthClass="max-w-lg">
            {step === 'main' ? (
                <form onSubmit={handleSubmitMain} className="space-y-5">
                    <div>
                        <label htmlFor="add-wl-symbol" className="block text-sm font-medium text-slate-700 mb-1">Symbol or ticker</label>
                        <div className="relative">
                            <input
                                ref={symbolInputRef}
                                type="text"
                                id="add-wl-symbol"
                                value={symbol}
                                onChange={e => { setSymbol(e.target.value.toUpperCase()); setValidationError(null); }}
                                className="w-full p-3 pr-10 border border-slate-300 rounded-xl text-lg font-semibold tracking-wide uppercase focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                                placeholder="e.g. AAPL"
                                maxLength={10}
                                aria-describedby="add-wl-hint add-wl-popular"
                            />
                            {symbol && (
                                <button type="button" onClick={() => { setSymbol(''); setValidationError(null); symbolInputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear symbol">
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            )}
                        </div>
                        <p id="add-wl-hint" className="text-xs text-slate-500 mt-1">Company name will be filled automatically when possible.</p>
                        <div id="add-wl-popular" className="flex flex-wrap gap-2 mt-3">
                            <span className="text-xs text-slate-500 self-center mr-1">Quick add:</span>
                            {POPULAR_SYMBOLS.map(s => (
                                <button key={s} type="button" onClick={() => handleQuickAdd(s)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-primary/10 hover:border-primary/30 transition-colors">
                                    {s}
                                </button>
                            ))}
                        </div>
                        {validationError && <p className="text-sm text-rose-600 mt-1" role="alert">{validationError}</p>}
                    </div>
                    <button type="submit" disabled={!sym} className="w-full py-3 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        Continue
                    </button>
                </form>
            ) : (
                <form onSubmit={handleFinalSubmit} className="space-y-5">
                    <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
                        <button type="button" onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors" aria-label="Back to symbol">
                            <ChevronLeftIcon className="h-5 w-5 text-slate-600" />
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xl font-bold text-slate-900 tracking-wide">{sym}</span>
                                {isLoadingName && <div className="w-4 h-4 border-2 border-slate-300 border-t-primary rounded-full animate-spin" aria-hidden />}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">Confirm details and add</p>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="add-wl-name" className="block text-sm font-medium text-slate-700 mb-1">Display name (optional)</label>
                        <input
                            type="text"
                            id="add-wl-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                            placeholder={isLoadingName ? 'Looking up…' : 'Leave blank to use symbol'}
                        />
                    </div>

                    {onAddAlert && (
                        <div className="space-y-3">
                            <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                                <input type="checkbox" checked={setAlert} onChange={e => setSetAlert(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" />
                                <div className="flex-1">
                                    <span className="text-sm font-medium text-slate-700">Set price alert</span>
                                    <p className="text-xs text-slate-500">Notify when price reaches target</p>
                                </div>
                                <BellIcon className="h-5 w-5 text-amber-500" />
                            </label>
                            {setAlert && (
                                <div className="flex gap-3 p-3 bg-slate-50 rounded-xl">
                                    <div className="w-28">
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                                        <select value={alertCurrency} onChange={e => setAlertCurrency(e.target.value as PriceAlertCurrency)} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary">
                                            {ALERT_CURRENCY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Target price</label>
                                        <input ref={priceInputRef} type="number" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} min="0.01" step="0.01" placeholder={alertCurrency === 'SAR' ? 'e.g. 350.50' : 'e.g. 185.00'} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {validationError && <p className="text-sm text-rose-600" role="alert">{validationError}</p>}

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={handleBack} className="flex-1 py-3 px-4 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors">
                            Back
                        </button>
                        <button type="submit" className="flex-1 py-3 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors">
                            Add to Watchlist
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

const WatchlistItemRow: React.FC<{
    item: WatchlistItem;
    companyNames: SymbolNamesMap;
    priceInfo: { price: number; change: number; changePercent: number; source?: 'live' | 'candle_close' | 'none' };
    activeAlerts: PriceAlert[];
    historical1M?: CandlePoint[] | null;
    fundamentals?: HoldingFundamentals | null;
    fundamentalsLoading?: boolean;
    preferredCurrency?: 'USD' | 'SAR';
    exchangeRate: number;
    onOpenAlertModal: (item: WatchlistItem) => void;
    onOpenDeleteModal: (item: WatchlistItem) => void;
}> = ({ item, companyNames, priceInfo, activeAlerts, historical1M, fundamentals, fundamentalsLoading, preferredCurrency, exchangeRate, onOpenAlertModal, onOpenDeleteModal }) => {
    const quoteSource = priceInfo.source ?? (priceInfo.price > 0 ? 'live' : 'none');
    const market = getExchangeAndCurrencyForSymbol(item.symbol);
    const priceCurrency: 'USD' | 'SAR' = (market?.currency === 'SAR' ? 'SAR' : 'USD');
    const displayCurrency: 'USD' | 'SAR' = preferredCurrency || priceCurrency;
    const convertCurrency = (value: number, from: 'USD' | 'SAR', to: 'USD' | 'SAR') => {
        if (!Number.isFinite(value)) return 0;
        if (from === to) return value;
        if (from === 'USD' && to === 'SAR') return value * exchangeRate;
        if (from === 'SAR' && to === 'USD') return value / exchangeRate;
        return value;
    };
    const formatInCurrency = (value: number, currency: 'USD' | 'SAR', digits = 2) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    const displayPrice = convertCurrency(priceInfo.price, priceCurrency, displayCurrency);
    const displayChange = convertCurrency(priceInfo.change, priceCurrency, displayCurrency);
    const formatPrice = (p: number) => formatInCurrency(p, displayCurrency);
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
    const targetsSameCurrency = targetValues.filter(t => t.currency === displayCurrency).map(t => t.price);
    const nearestTarget = targetsSameCurrency.length > 0 ? targetsSameCurrency.reduce((a, b) => (Math.abs(displayPrice - a) < Math.abs(displayPrice - b) ? a : b)) : null;
    const targetPrice = nearestTarget;
    const formatTarget = (p: number, curr: 'USD' | 'SAR') => `${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}`;
    const targetDistancePercent = targetPrice && targetPrice > 0 ? ((displayPrice - targetPrice) / targetPrice) * 100 : null;
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

    const techSignals = useMemo(() => {
        const prices = (historical1M ?? []).map(c => c.price).filter((p): p is number => Number.isFinite(p));
        if (prices.length < 20) return null;
        const rsiArr = rsi(prices, 14);
        const lastRsi = rsiArr[rsiArr.length - 1];
        const lastZ = zScore(prices, 20)[prices.length - 1];
        const bb = bollingerBands(prices, 20, 2);
        const lastPrice = prices[prices.length - 1];
        const lastUpper = bb.upper[bb.upper.length - 1];
        const lastLower = bb.lower[bb.lower.length - 1];
        let bbLabel: string | null = null;
        if (Number.isFinite(lastUpper) && Number.isFinite(lastLower) && Number.isFinite(lastPrice)) {
            if (lastPrice >= lastUpper * 0.98) bbLabel = 'BB: near upper';
            else if (lastPrice <= lastLower * 1.02) bbLabel = 'BB: near lower';
            else bbLabel = 'BB: mid';
        }
        const stCross = shortTermCrossoverSignal(prices, 5, 10);
        return {
            rsi: Number.isFinite(lastRsi) ? lastRsi : null,
            rsiSig: lastRsi != null ? rsiSignal(lastRsi) : null,
            zScore: Number.isFinite(lastZ) ? lastZ : null,
            zSig: lastZ != null ? zScoreSignal(lastZ) : null,
            bb: bbLabel,
            smaCross: stCross?.golden ? 'golden' as const : stCross?.death ? 'death' as const : null,
        };
    }, [historical1M]);

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
            <td className="px-4 py-2 whitespace-nowrap min-w-0 max-w-[240px]">
                <ResolvedSymbolLabel
                    symbol={item.symbol}
                    storedName={item.name}
                    names={companyNames}
                    layout="stacked"
                    symbolClassName="font-medium text-gray-900"
                    companyClassName="text-xs text-gray-500 break-words"
                />
                {market ? (
                    <div className="text-[10px] text-gray-400 mt-0.5">{market.exchange}</div>
                ) : null}
            </td>
            <td className="px-4 py-2 w-36">
                <MiniPriceChart symbol={item.symbol} currentPrice={priceInfo.price} changePercent={priceInfo.changePercent} formatPrice={formatPrice} showIllustrativeLabel historicalData={historical1M} realDataOnly />
            </td>
            <td className="px-4 py-2 text-right font-semibold text-dark whitespace-nowrap tabular-nums">
                {quoteSource === 'none' ? (
                    <>
                        <span className="text-slate-400">—</span>
                        <span className="block text-[10px] text-amber-800 font-normal mt-0.5">No live quote</span>
                    </>
                ) : (
                    <>
                        {formatInCurrency(displayPrice, displayCurrency)}
                        {quoteSource === 'candle_close' && (
                            <span className="block text-[10px] text-slate-500 font-normal">Daily close (backup)</span>
                        )}
                    </>
                )}
                {market && <span className="block text-[10px] text-slate-500 font-normal">{market.exchange}</span>}
                {fundamentals?.priceContext &&
                    (fundamentals.priceContext.week52High != null || fundamentals.priceContext.week52Low != null) && (
                        <span className="block text-[10px] text-slate-500 font-normal mt-0.5">
                            52w{' '}
                            {fundamentals.priceContext.week52Low != null
                                ? formatFundamentalValue(fundamentals.priceContext.week52Low, 2)
                                : '—'}
                            –
                            {fundamentals.priceContext.week52High != null
                                ? formatFundamentalValue(fundamentals.priceContext.week52High, 2)
                                : '—'}{' '}
                            <InfoHint
                                placement="bottom"
                                text="52-week high/low from Finnhub stock metrics when available. Today’s high/low from the latest quote (candle session)."
                            />
                        </span>
                    )}
            </td>
            <td className={`px-4 py-2 text-right font-medium text-sm whitespace-nowrap tabular-nums ${quoteSource === 'none' ? 'text-slate-400' : priceInfo.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {quoteSource === 'none' ? (
                    <span className="text-slate-400">—</span>
                ) : (
                    <>
                        {priceInfo.change >= 0 ? '+' : ''}
                        {formatInCurrency(displayChange, displayCurrency)} ({priceInfo.changePercent.toFixed(2)}%)
                    </>
                )}
                <span className="block text-[10px] text-slate-500 font-normal">
                    {quoteSource === 'live' ? 'Period: 1D' : quoteSource === 'candle_close' ? 'vs prior close' : '—'}
                </span>
            </td>
            <td className="px-4 py-2 text-left align-top whitespace-nowrap text-xs text-slate-600 max-w-[200px]">
                {techSignals && (
                    <div className="space-y-0.5">
                        {techSignals.rsi != null && (
                            <span className={techSignals.rsiSig === 'overbought' ? 'text-amber-700 font-medium' : techSignals.rsiSig === 'oversold' ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
                                RSI {techSignals.rsi.toFixed(0)}{techSignals.rsiSig !== 'neutral' ? ` (${techSignals.rsiSig})` : ''}
                            </span>
                        )}
                        {techSignals.zScore != null && techSignals.zSig !== 'neutral' && (
                            <span className="text-slate-600">Z {techSignals.zScore.toFixed(2)} ({techSignals.zSig})</span>
                        )}
                        {techSignals.bb && (
                            <span className={techSignals.bb.includes('upper') ? 'text-amber-600' : techSignals.bb.includes('lower') ? 'text-emerald-600' : 'text-slate-600'}>
                                {techSignals.bb}
                            </span>
                        )}
                        {techSignals.smaCross && (
                            <span className={techSignals.smaCross === 'golden' ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
                                SMA(5/10): {techSignals.smaCross === 'golden' ? 'golden cross' : 'death cross'}
                            </span>
                        )}
                    </div>
                )}
                {!techSignals && historical1M && historical1M.length < 20 && <span className="text-slate-400">Need 20+ days</span>}
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
                                <span className="text-[11px] text-slate-400">No upcoming earnings from market data</span>
                            )}
                        </div>
                        {typeof fundamentals.nextEarnings?.revenueEstimate === 'number' &&
                            fundamentals.nextEarnings.revenueEstimate > 0 && (
                                <div className="text-[11px] text-slate-500">
                                    Revenue est ({fundamentalsCurrency}):{' '}
                                    {formatFundamentalValue(fundamentals.nextEarnings.revenueEstimate, 0)}
                                </div>
                            )}
                        {fundamentals.dividend &&
                            (typeof fundamentals.dividend.dividendYieldPct === 'number' ||
                                typeof fundamentals.dividend.dividendPerShareAnnual === 'number') && (
                                <div className="text-[11px] text-slate-500">
                                    Dividend est.
                                    {typeof fundamentals.dividend.dividendYieldPct === 'number' &&
                                        fundamentals.dividend.dividendYieldPct > 0 &&
                                        ` yield ${fundamentals.dividend.dividendYieldPct.toFixed(2)}%`}
                                    {typeof fundamentals.dividend.dividendPerShareAnnual === 'number' &&
                                        fundamentals.dividend.dividendPerShareAnnual > 0 && (
                                            <>
                                                {' '}
                                                · {formatFundamentalValue(fundamentals.dividend.dividendPerShareAnnual, 2)}
                                                per share
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


type WatchlistViewProps = {
  onNavigateToTab?: (tab: string) => void;
  setActivePage?: (page: Page) => void;
};

const WATCHLIST_AI_LANG_KEY = 'finova_default_ai_lang_v1';

const WatchlistView: React.FC<WatchlistViewProps> = ({ onNavigateToTab, setActivePage: _setActivePage }) => {
    const { data, loading, addWatchlistItem, deleteWatchlistItem, addPriceAlert, deletePriceAlert } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
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
    const [watchlistAiLang, setWatchlistAiLang] = useState<'en' | 'ar'>(() => {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(WATCHLIST_AI_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const [tradeAnalysisAr, setTradeAnalysisAr] = useState<string | null>(null);
    const [watchlistTipsAr, setWatchlistTipsAr] = useState<string | null>(null);
    const [tradeTranslating, setTradeTranslating] = useState(false);
    const [tipsTranslating, setTipsTranslating] = useState(false);
    const [historicalBySymbol, setHistoricalBySymbol] = useState<Record<string, CandlePoint[] | null>>({});
    const [fundamentalsBySymbol, setFundamentalsBySymbol] = useState<Record<string, HoldingFundamentals | null>>({});
    const [fundamentalsLoading, setFundamentalsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [marketFilter, setMarketFilter] = useState<'All' | 'US' | 'SAR'>('All');
    const [watchlistBuckets, setWatchlistBuckets] = useState<WatchlistBucket[]>([]);
    const [activeBucketId, setActiveBucketId] = useState('all');
    const [newBucketName, setNewBucketName] = useState('');
    const [newBucketCurrency, setNewBucketCurrency] = useState<PriceAlertCurrency>('USD');

    const watchlistSymbolKey = useMemo(() => (data?.watchlist ?? []).map((w) => (w.symbol ?? '').trim().toUpperCase()).filter(Boolean).join(','), [data?.watchlist]);
    /** 1M candles: Finnhub when key is set, else Stooq (required for Tadawul / no-key dev). Throttled per symbol to respect Finnhub limits. */
    useEffect(() => {
        const symbols = watchlistSymbolKey ? watchlistSymbolKey.split(',') : [];
        if (symbols.length === 0) {
            setHistoricalBySymbol({});
            return;
        }
        let cancelled = false;
        const delayMs = import.meta.env.VITE_FINNHUB_API_KEY?.trim() ? 1200 : 400;
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
        return () => {
            cancelled = true;
        };
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


    const bucketStorageKey = 'watchlist-buckets:v1';

    useEffect(() => {
        try {
            const raw = localStorage.getItem(bucketStorageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as WatchlistBucket[];
            if (Array.isArray(parsed)) {
                setWatchlistBuckets(parsed.filter((b) => b && b.id && b.name));
            }
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(bucketStorageKey, JSON.stringify(watchlistBuckets));
        } catch {
            // ignore
        }
    }, [watchlistBuckets]);

    useEffect(() => {
        const symbols = new Set((data?.watchlist ?? []).map((w) => (w.symbol ?? '').toUpperCase()));
        setWatchlistBuckets((prev) => prev.map((b) => ({ ...b, symbols: b.symbols.filter((s) => symbols.has((s || '').toUpperCase())) })));
    }, [data?.watchlist]);

    const activeBucket = useMemo(() => watchlistBuckets.find((b) => b.id === activeBucketId) || null, [watchlistBuckets, activeBucketId]);

    const filteredWatchlist = useMemo(() => {
        const q = searchQuery.trim().toUpperCase();
        const bucketSymbolSet = activeBucket ? new Set((activeBucket.symbols || []).map((s) => s.toUpperCase())) : null;
        const filtered = (data?.watchlist ?? []).filter((item) => {
            const symbol = (item.symbol || '').toUpperCase();
            const name = (item.name || '').toUpperCase();
            const market = getExchangeAndCurrencyForSymbol(symbol);
            const marketBucket = market?.currency === 'SAR' ? 'SAR' : 'US';
            const marketOk = marketFilter === 'All' || marketFilter === marketBucket;
            const queryOk = !q || symbol.includes(q) || name.includes(q);
            const bucketOk = !bucketSymbolSet || bucketSymbolSet.has(symbol);
            return marketOk && queryOk && bucketOk;
        });
        // Sort by symbol name for consistent display
        return filtered.sort((a, b) => {
            const symbolA = (a.symbol || '').toUpperCase();
            const symbolB = (b.symbol || '').toUpperCase();
            return symbolA.localeCompare(symbolB);
        });
    }, [data?.watchlist, searchQuery, marketFilter, activeBucket]);

    const watchlistInsights = useMemo(() => {
        const rows = (data?.watchlist ?? []).map((item) => {
            const sym = (item.symbol ?? '').trim().toUpperCase();
            const resolved = resolveWatchlistPriceInfo(sym, simulatedPrices[sym], historicalBySymbol[sym]);
            return {
                ...item,
                priceInfo: { price: resolved.price, change: resolved.change, changePercent: resolved.changePercent, source: resolved.source },
                activeAlerts: (data?.priceAlerts ?? []).filter(a => (a.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && a.status === 'active'),
            };
        });
        const positiveMovers = rows.filter(r => r.priceInfo.changePercent > 0).length;
        const negativeMovers = rows.filter(r => r.priceInfo.changePercent < 0).length;
        const alertCoverage = rows.filter(r => r.activeAlerts.length > 0).length;
        return { positiveMovers, negativeMovers, alertCoverage, total: rows.length };
    }, [data?.watchlist, data?.priceAlerts, simulatedPrices, historicalBySymbol]);

    const ideaRanks = useMemo(() => {
        const items = (data?.watchlist ?? []).map((w) => {
            const sym = (w.symbol ?? '').toUpperCase();
            const resolved = resolveWatchlistPriceInfo(sym, simulatedPrices[sym], historicalBySymbol[sym]);
            const ch = resolved.source === 'none' ? 0 : resolved.changePercent;
            const signalScore = Math.max(0, Math.min(100, 50 + ch * 3));
            return { symbol: sym, userScore: 50, signalScore };
        });
        return rankWatchlistIdeas(items);
    }, [data?.watchlist, simulatedPrices, historicalBySymbol]);

    const watchlistSymbolsForNames = useMemo(() => {
        const wl = (data?.watchlist ?? []).map((w) => (w.symbol || '').trim()).filter((s) => s.length >= 2);
        const ir = ideaRanks.map((r) => r.symbol).filter(Boolean);
        return Array.from(new Set([...wl, ...ir]));
    }, [data?.watchlist, ideaRanks]);
    const { names: wlCompanyNames } = useCompanyNames(watchlistSymbolsForNames);

    const handleOpenDeleteModal = (item: WatchlistItem) => { setItemToDelete(item); setIsDeleteModalOpen(true); };
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        try {
            if (activeBucket) {
                handleRemoveFromActiveBucket(itemToDelete.symbol);
            } else {
                deleteWatchlistItem(itemToDelete.symbol);
            }
            setIsDeleteModalOpen(false);
            setItemToDelete(null);
        } catch (error) {
            alert(`Failed to delete item: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const personalAccountsLedger = useMemo(() => getPersonalAccounts(data), [data]);
    const personalInvestmentsLedger = useMemo(() => getPersonalInvestments(data), [data]);

    const handleOpenAlertModal = (item: WatchlistItem) => {
        const sym = (item.symbol ?? '').trim().toUpperCase();
        const r = resolveWatchlistPriceInfo(sym, simulatedPrices[sym], historicalBySymbol[sym]);
        const price = r.price > 0 ? r.price : simulatedPrices[sym]?.price ?? 0;
        setStockForAlert({ ...item, symbol: sym, price });
        setIsAlertModalOpen(true);
    };

    const recentTransactionsForAnalysis = useMemo(() => {
        const personalAccountIds = new Set(personalAccountsLedger.map((a) => a.id));
        return (data?.investmentTransactions ?? [])
            .filter((t) => personalAccountIds.has(t.accountId ?? ''))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 20);
    }, [data?.investmentTransactions, personalAccountsLedger]);

    const tradeActivitySummary = useMemo(() => {
        const list = recentTransactionsForAnalysis;
        if (!list.length) return undefined;
        const buys = list.filter((t) => t.type === 'buy').length;
        const sells = list.filter((t) => t.type === 'sell').length;
        const symCount = new Set(list.map((t) => (t.symbol ?? '').toUpperCase()).filter(Boolean)).size;
        return `${list.length} recent txs (${buys} buy / ${sells} sell), ${symCount} symbols (personal accounts)`;
    }, [recentTransactionsForAnalysis]);

    const analysisContext = useMemo(() => {
        const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const holdings = portfolios.flatMap((p: { holdings?: { symbol?: string; currentValue?: number }[]; currency?: string }) => (p.holdings ?? []).map((h: { symbol?: string; currentValue?: number }) => ({ ...h, portfolioCurrency: p.currency ?? 'USD' })));
        const bySymbol = new Map<string, number>();
        holdings.forEach((h: { symbol?: string; currentValue?: number; portfolioCurrency?: string }) => {
        const sym = h.symbol ?? '';
        if (sym) bySymbol.set(sym, (bySymbol.get(sym) ?? 0) + toSAR(h.currentValue ?? 0, (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR', exchangeRate));
      });
        const summary = Array.from(bySymbol.entries()).map(([s, v]) => `${s}: ${v.toFixed(0)}`).join('; ') || 'None';
        const watchlistSymbols = (data?.watchlist ?? []).map(w => w.symbol ?? '');
        const plan = data?.investmentPlan;
        const settings = data?.settings;
        return {
            holdingsSummary: summary,
            watchlistSymbols: watchlistSymbols.length > 0 ? watchlistSymbols : undefined,
            planBudget: plan?.monthlyBudget,
            corePct: plan?.coreAllocation,
            upsidePct: plan?.upsideAllocation,
            planBudgetCurrency: plan?.budgetCurrency,
            planExecutionCurrency: plan?.executionCurrency,
            riskProfile: settings?.riskProfile,
            tradeActivitySummary,
            asOfDate: new Date().toISOString().slice(0, 10),
        };
    }, [data?.investments, (data as any)?.personalInvestments, data?.watchlist, data?.investmentPlan, data?.settings, exchangeRate, tradeActivitySummary]);

    useEffect(() => {
        if (watchlistAiLang !== 'ar' || !aiTradeAnalysis.trim() || tradeAnalysisAr != null || !isAiAvailable) return;
        let cancelled = false;
        (async () => {
            setTradeTranslating(true);
            try {
                const ar = await translateFinancialInsightToArabic(aiTradeAnalysis);
                if (!cancelled) setTradeAnalysisAr(ar);
            } finally {
                if (!cancelled) setTradeTranslating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [watchlistAiLang, aiTradeAnalysis, tradeAnalysisAr, isAiAvailable]);

    useEffect(() => {
        if (watchlistAiLang !== 'ar' || !aiWatchlistTips.trim() || watchlistTipsAr != null || !isAiAvailable) return;
        let cancelled = false;
        (async () => {
            setTipsTranslating(true);
            try {
                const ar = await translateFinancialInsightToArabic(aiWatchlistTips);
                if (!cancelled) setWatchlistTipsAr(ar);
            } finally {
                if (!cancelled) setTipsTranslating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [watchlistAiLang, aiWatchlistTips, watchlistTipsAr, isAiAvailable]);

    const handleAnalyzeTrades = useCallback(async () => {
        setAiTradeError(null);
        setAiTradeLoading(true);
        setTradeAnalysisAr(null);
        try {
            const analysis = await getAITradeAnalysis(recentTransactionsForAnalysis, analysisContext);
            setAiTradeAnalysis(analysis);
        } catch (err) {
            setAiTradeError(formatAiError(err));
            setAiTradeAnalysis('');
        } finally {
            setAiTradeLoading(false);
        }
    }, [recentTransactionsForAnalysis, analysisContext]);

    const handleGetWatchlistTips = useCallback(async () => {
        if (!data?.watchlist?.length) {
            setAiWatchlistError('Add at least one symbol to your watchlist first.');
            return;
        }
        setAiWatchlistError(null);
        setAiWatchlistLoading(true);
        setWatchlistTipsAr(null);
        try {
            const tips = await getAIWatchlistAdvice((data?.watchlist ?? []).map(w => w.symbol ?? ''));
            setAiWatchlistTips(tips);
        } catch (err) {
            setAiWatchlistError(formatAiError(err));
            setAiWatchlistTips('');
        } finally {
            setAiWatchlistLoading(false);
        }
    }, [data?.watchlist]);
    const handleSaveAlert = (symbol: string, targetPrice: number, currency: 'USD' | 'SAR') => { addPriceAlert({ symbol, targetPrice, currency }); };
    const handleDeleteAlert = (alertId: string) => { deletePriceAlert(alertId); };

    const handleCreateBucket = () => {
        const name = newBucketName.trim();
        if (!name) {
            alert('Please enter a name for the new watchlist bucket.');
            return;
        }
        if (name.length < 2 || name.length > 50) {
            alert('Bucket name must be between 2 and 50 characters.');
            return;
        }
        // Check for duplicate bucket names
        const existing = watchlistBuckets.find(b => b.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            if (!window.confirm(`A bucket named "${name}" already exists. Create anyway?`)) {
                return;
            }
        }
        const id = `bucket-${Date.now()}`;
        setWatchlistBuckets((prev) => [...prev, { id, name, currency: newBucketCurrency, symbols: [] }]);
        setActiveBucketId(id);
        setNewBucketName('');
        setNewBucketCurrency('USD');
    };

    const handleRemoveBucket = (bucketId: string) => {
        setWatchlistBuckets((prev) => prev.filter((b) => b.id !== bucketId));
        setActiveBucketId('all');
    };

    const handleAddToActiveBucket = (symbol: string) => {
        if (!activeBucket) return;
        const sym = symbol.trim().toUpperCase();
        setWatchlistBuckets((prev) => prev.map((b) => b.id === activeBucket.id ? { ...b, symbols: Array.from(new Set([...(b.symbols || []), sym])) } : b));
    };

    const handleRemoveFromActiveBucket = (symbol: string) => {
        if (!activeBucket) return;
        const sym = symbol.trim().toUpperCase();
        setWatchlistBuckets((prev) => prev.map((b) => b.id === activeBucket.id ? { ...b, symbols: (b.symbols || []).filter((s) => s.toUpperCase() !== sym) } : b));
    };

    const handleAddWatchlistItemWithBucket = (item: WatchlistItem) => {
        trackAction('add-watchlist', 'Watchlist');
        addWatchlistItem(item);
        handleAddToActiveBucket(item.symbol);
    };

    const handleExportWatchlist = () => {
        const csv = [
            ['Symbol', 'Name', 'Price', 'Change', 'Change %', 'Target Price', 'Status'].join(','),
            ...filteredWatchlist.map(item => {
                const symK = (item.symbol ?? '').trim().toUpperCase();
                const r = resolveWatchlistPriceInfo(symK, simulatedPrices[symK], historicalBySymbol[symK]);
                const priceInfo = { price: r.price, change: r.change, changePercent: r.changePercent };
                const activeAlerts = (data?.priceAlerts ?? []).filter(a => (a.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && a.status === 'active');
                const targetPrice = activeAlerts.length > 0 ? (activeAlerts[0].targetPrice ?? 0) : 0;
                const market = getExchangeAndCurrencyForSymbol(item.symbol ?? '');
                const priceCurrency: 'USD' | 'SAR' = (market?.currency === 'SAR' ? 'SAR' : 'USD');
                const displayCurrency: 'USD' | 'SAR' = activeBucket?.currency || priceCurrency;
                const convertCurrency = (value: number, from: 'USD' | 'SAR', to: 'USD' | 'SAR') => {
                    if (!Number.isFinite(value)) return 0;
                    if (from === to) return value;
                    if (from === 'USD' && to === 'SAR') return value * sarPerUsd;
                    if (from === 'SAR' && to === 'USD') return value / sarPerUsd;
                    return value;
                };
                const displayPrice = convertCurrency(priceInfo.price, priceCurrency, displayCurrency);
                const displayChange = convertCurrency(priceInfo.change, priceCurrency, displayCurrency);
                return [
                    item.symbol ?? '',
                    item.name ?? '',
                    displayPrice.toFixed(2),
                    displayChange.toFixed(2),
                    priceInfo.changePercent.toFixed(2),
                    targetPrice > 0 ? targetPrice.toFixed(2) : '',
                    activeAlerts.length > 0 ? 'Has Alert' : 'No Alert'
                ].join(',');
            })
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `watchlist-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading || !data) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center" aria-busy="true">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading watchlist" />
                    <p className="text-sm text-slate-600">Loading watchlist data...</p>
                </div>
            </div>
        );
    }

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

            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <button type="button" onClick={() => setActiveBucketId('all')} className={`px-3 py-1.5 text-xs rounded-full border ${activeBucketId === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>All symbols</button>
                    {watchlistBuckets.map((b) => (
                        <div key={b.id} className="inline-flex items-center gap-1">
                            <button type="button" onClick={() => setActiveBucketId(b.id)} className={`px-3 py-1.5 text-xs rounded-full border ${activeBucketId === b.id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{b.name} ({b.currency})</button>
                            <button type="button" onClick={() => handleRemoveBucket(b.id)} className="text-xs text-rose-600">×</button>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input value={newBucketName} onChange={(e) => setNewBucketName(e.target.value)} placeholder="New watchlist name" className="input-base max-w-xs" />
                    <select value={newBucketCurrency} onChange={(e) => setNewBucketCurrency(e.target.value as PriceAlertCurrency)} className="select-base w-auto">
                        {ALERT_CURRENCY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <button type="button" onClick={handleCreateBucket} className="btn-outline text-xs">Add watchlist</button>
                    {activeBucket && <span className="text-xs text-slate-500">Active watchlist currency: {activeBucket.currency}</span>}
                </div>
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Positive Movers</p><p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{watchlistInsights.positiveMovers}</p></div>
                <div className="rounded-xl border border-rose-100 bg-gradient-to-br from-white to-rose-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Negative Movers</p><p className="text-2xl font-bold text-rose-700 tabular-nums mt-1">{watchlistInsights.negativeMovers}</p></div>
                <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50 p-4"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Alerts</p><p className="text-2xl font-bold text-amber-700 tabular-nums mt-1">{watchlistInsights.alertCoverage}/{watchlistInsights.total}</p></div>
            </div>

            {ideaRanks.length > 0 && (
                <section className="rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                    <h3 className="text-sm font-semibold text-violet-900 mb-1">Idea rank (rules)</h3>
                    <p className="text-xs text-slate-600 mb-3">Lightweight ordering from recent price momentum + neutral user weight—not a buy recommendation.</p>
                    <ol className="flex flex-wrap gap-2 text-sm list-none p-0 m-0">
                        {ideaRanks.slice(0, 12).map((r, i) => (
                            <li key={r.symbol} className="rounded-lg bg-white border border-violet-100 px-2.5 py-1 font-medium text-slate-800">
                                #{i + 1}{' '}
                                {formatSymbolWithCompany(r.symbol, undefined, wlCompanyNames)}{' '}
                                <span className="text-violet-600 text-xs">({r.rank.toFixed(0)})</span>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold text-dark">My Watchlist</h2>
                        <LivePricesStatus variant="inline" className="flex-shrink-0" />
                    </div>
                    <div className="flex gap-2">
                        {filteredWatchlist.length > 0 && (
                            <button
                                type="button"
                                onClick={handleExportWatchlist}
                                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                            >
                                Export CSV
                            </button>
                        )}
                        <button onClick={() => setIsAddModalOpen(true)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary text-sm w-full sm:w-auto">Add Stock</button>
                    </div>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search symbol or name..." className="input-base max-w-xs" />
                    <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value as any)} className="select-base w-auto">
                        <option value="All">All markets</option>
                        <option value="US">US / Non-SAR</option>
                        <option value="SAR">Saudi (SAR)</option>
                    </select>
                    <button type="button" className="btn-outline text-xs" onClick={() => { setSearchQuery(''); setMarketFilter('All'); }}>Clear filters</button>
                    <span className="text-xs text-slate-500">Showing {filteredWatchlist.length} of {(data?.watchlist ?? []).length}</span>
                </div>
                <div className="overflow-x-auto overflow-y-visible"><table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase align-middle"><span className="inline-flex items-center gap-1 flex-nowrap whitespace-nowrap">1M trend <InfoHint placement="bottom" text="When available, the chart and percentage show real 1-month daily history from market data. Otherwise an illustrative curve is shown." /></span></th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"><span className="inline-flex items-center gap-1">1D Change <InfoHint placement="bottom" text="Latest session/1-day move from live price feed." /></span></th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Signals</th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next event</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Target</th><th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredWatchlist.map((item) => {
                            const symKey = item.symbol.trim().toUpperCase();
                            const r = resolveWatchlistPriceInfo(symKey, simulatedPrices[symKey], historicalBySymbol[symKey]);
                            const priceInfo = { price: r.price, change: r.change, changePercent: r.changePercent, source: r.source };
                            const activeAlerts = (data?.priceAlerts ?? []).filter(a => (a.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && a.status === 'active');
                            return (
                               <WatchlistItemRow
                                  key={item.symbol}
                                  item={item}
                                  companyNames={wlCompanyNames}
                                  priceInfo={priceInfo}
                                  activeAlerts={activeAlerts}
                                  historical1M={historicalBySymbol[symKey] ?? undefined}
                                  fundamentals={fundamentalsBySymbol[symKey] ?? undefined}
                                  fundamentalsLoading={fundamentalsLoading && !fundamentalsBySymbol[symKey]}
                                  preferredCurrency={activeBucket?.currency}
                                  exchangeRate={sarPerUsd}
                                  onOpenAlertModal={handleOpenAlertModal}
                                  onOpenDeleteModal={handleOpenDeleteModal}
                               />
                            );
                        })}
                    </tbody>
                </table>
                {((data?.watchlist ?? []).length === 0 || filteredWatchlist.length === 0) && (
                    <div className="text-center py-10 px-4">
                        <p className="text-slate-600">{(data?.watchlist ?? []).length === 0 ? "Your watchlist is empty. Add symbols to track prices and get AI tips." : "No symbols match the selected filters."}</p>
                        {(data?.watchlist ?? []).length === 0 && (
                            <button type="button" onClick={() => setIsAddModalOpen(true)} className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium">
                                Add your first symbol
                            </button>
                        )}
                    </div>
                )}</div>
            </div>

            <div className="lg:col-span-1 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">AI insight language</span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                        <button
                            type="button"
                            onClick={() => {
                                try {
                                    localStorage.setItem(WATCHLIST_AI_LANG_KEY, 'en');
                                } catch {
                                    /* ignore */
                                }
                                setWatchlistAiLang('en');
                            }}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md ${watchlistAiLang === 'en' ? 'bg-violet-100 text-violet-900' : 'text-slate-600'}`}
                        >
                            English
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                try {
                                    localStorage.setItem(WATCHLIST_AI_LANG_KEY, 'ar');
                                } catch {
                                    /* ignore */
                                }
                                setWatchlistAiLang('ar');
                                setTradeAnalysisAr(null);
                                setWatchlistTipsAr(null);
                            }}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md ${watchlistAiLang === 'ar' ? 'bg-violet-100 text-violet-900' : 'text-slate-600'}`}
                        >
                            العربية
                        </button>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-violet-500">
                    <h4 className="font-semibold text-slate-800 flex items-center gap-2 mb-1 flex-wrap">
                        <SparklesIcon className="h-5 w-5 text-primary" aria-hidden />
                        Trade advices (AI)
                        <InfoHint
                            placement="bottom"
                            text="Uses your last 20 investment transactions on personal accounts, plus holdings (SAR), watchlist, plan budget, and risk profile. Same educational scope as the former Trade Advices tab—Markdown sections: Summary, Patterns, Impact, Do’s, Don’ts, Suggestions, Concept."
                        />
                    </h4>
                    <p className="text-xs text-slate-600 mb-3">
                        Structured feedback on recent activity—not buy/sell advice. Grounding includes plan + portfolio context passed to the model.
                    </p>
                    {recentTransactionsForAnalysis.length > 0 ? (
                        <>
                            <div className="rounded-lg border border-slate-200 bg-slate-50/80 mb-3 overflow-hidden">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-2 py-1.5 border-b border-slate-200 bg-white/80">Recent trades (preview)</p>
                                <ul className="max-h-[140px] overflow-y-auto divide-y divide-slate-100 text-xs">
                                    {recentTransactionsForAnalysis.slice(0, 8).map((t) => {
                                        const txCur = inferInvestmentTransactionCurrency(t, personalAccountsLedger, personalInvestmentsLedger);
                                        return (
                                        <li key={t.id} className="px-2 py-1.5 flex justify-between gap-2">
                                            <span className="font-medium text-slate-800 truncate">
                                                {(t.symbol ?? '—').toUpperCase()}{' '}
                                                <span className="font-normal text-slate-500">{t.type}</span>
                                            </span>
                                            <span className="text-slate-600 tabular-nums shrink-0">{t.date}</span>
                                            <span className="text-slate-700 tabular-nums shrink-0">{formatCurrencyString(t.total ?? 0, { inCurrency: txCur })}</span>
                                        </li>
                                        );
                                    })}
                                </ul>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button type="button" onClick={handleAnalyzeTrades} disabled={aiTradeLoading} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-60 text-sm font-medium">
                                    <SparklesIcon className="h-4 w-4" aria-hidden /> {aiTradeLoading ? 'Analyzing…' : 'Analyze trades'}
                                </button>
                                {onNavigateToTab && (
                                    <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-xs font-medium text-primary hover:underline text-center">
                                        Record trades under Portfolios → Record trade
                                    </button>
                                )}
                            </div>
                            {aiTradeError && (
                                <div className="mt-2 rounded-md bg-rose-50 border border-rose-100 px-2 py-2">
                                    <p className="text-xs text-rose-800">{aiTradeError}</p>
                                    <button type="button" onClick={handleAnalyzeTrades} className="mt-1 text-xs font-medium text-primary hover:underline">
                                        Retry
                                    </button>
                                </div>
                            )}
                            {aiTradeAnalysis && (
                                <div className="mt-3 prose prose-sm max-w-none text-left max-h-[min(420px,55vh)] overflow-y-auto rounded-lg bg-violet-50/80 p-3 border border-violet-100" dir={watchlistAiLang === 'ar' ? 'rtl' : 'ltr'}>
                                    {watchlistAiLang === 'ar' && tradeTranslating && (
                                        <p className="text-xs text-slate-500 mb-2">Translating to Arabic…</p>
                                    )}
                                    {watchlistAiLang === 'ar' && !isAiAvailable && !tradeAnalysisAr && aiTradeAnalysis.trim() && !tradeTranslating && (
                                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">Arabic needs AI enabled. Showing English.</p>
                                    )}
                                    <SafeMarkdownRenderer content={watchlistAiLang === 'ar' ? (tradeAnalysisAr ?? aiTradeAnalysis) : aiTradeAnalysis} />
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-xs text-slate-500 space-y-2">
                            <p>No recent trades on <strong>personal</strong> investment accounts yet.</p>
                            {onNavigateToTab && (
                                <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-primary font-medium hover:underline">
                                    Open Portfolios to record a trade
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h4 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><SparklesIcon className="h-5 w-5 text-amber-500"/>Watchlist Tips</h4>
                    <p className="text-xs text-slate-600 mb-3">AI suggestions for your watchlist symbols (diversification, themes, concepts).</p>
                    <button onClick={handleGetWatchlistTips} disabled={aiWatchlistLoading || !data?.watchlist?.length} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60 text-sm font-medium">
                        <SparklesIcon className="h-4 w-4" /> {aiWatchlistLoading ? 'Generating...' : 'Get Recommendations'}
                    </button>
                    {aiWatchlistError && <div className="mt-2"><p className="text-xs text-red-600">{aiWatchlistError}</p><button type="button" onClick={handleGetWatchlistTips} className="mt-1 text-xs font-medium text-primary hover:underline">Retry</button></div>}
                    {aiWatchlistTips && (
                        <div className="mt-3 prose prose-sm max-w-none text-left max-h-[220px] overflow-y-auto rounded-lg bg-amber-50/80 p-3 border border-amber-100" dir={watchlistAiLang === 'ar' ? 'rtl' : 'ltr'}>
                            {watchlistAiLang === 'ar' && tipsTranslating && (
                                <p className="text-xs text-slate-500 mb-2">Translating to Arabic…</p>
                            )}
                            {watchlistAiLang === 'ar' && !isAiAvailable && !watchlistTipsAr && aiWatchlistTips.trim() && !tipsTranslating && (
                                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">Arabic needs AI enabled. Showing English.</p>
                            )}
                            <SafeMarkdownRenderer content={watchlistAiLang === 'ar' ? (watchlistTipsAr ?? aiWatchlistTips) : aiWatchlistTips} />
                        </div>
                    )}
                </div>
                {!isAiAvailable && <p className="text-xs text-amber-700">AI is currently unavailable. Actions still run with deterministic fallback logic.</p>}<p className="text-[10px] text-slate-500">Not financial advice. For education only.</p>
            </div>
            </div>

            <AddWatchlistItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={handleAddWatchlistItemWithBucket} onAddAlert={(sym, targetPrice, currency) => addPriceAlert({ symbol: sym, targetPrice, currency: currency ?? 'USD' })} />
            <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
            <PriceAlertModal isOpen={isAlertModalOpen} onClose={() => setIsAlertModalOpen(false)} onSave={handleSaveAlert} onDeleteAlert={handleDeleteAlert} stock={stockForAlert} existingAlerts={stockForAlert ? (data?.priceAlerts ?? []).filter(a => (a.symbol || '').toUpperCase() === (stockForAlert.symbol || '').toUpperCase()) : []} />
        </div>
    );
};

export default WatchlistView;
