import React, { useState, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PlannedTrade, type Page, type TradeCurrency } from '../types';
import Modal from '../components/Modal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { PlusIcon } from '../components/icons/PlusIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { RocketLaunchIcon } from '../components/icons/RocketLaunchIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useMarketData } from '../context/MarketDataContext';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { computeHouseholdStressFromData } from '../services/householdBudgetStress';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { getPersonalTransactions, getPersonalInvestments } from '../utils/wealthScope';
import { engineSleeveKeyToTickerStatus, inferEngineSleeveKeyFromHolding } from '../services/inferHoldingUniverseClassification';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import PageIntro from '../components/PageIntro';
import EmptyState from '../components/EmptyState';
import InfoHint from '../components/InfoHint';
import { toast } from '../context/ToastContext';
import { PAGE_INTROS, EMPTY_STATE_MESSAGES, EXECUTE_PLAN_STORAGE_KEY } from '../content/plainLanguage';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { ChartBarIcon } from '../components/icons/ChartBarIcon';
import { ClockIcon, TargetIcon } from '../components/icons';
import { useSelfLearning } from '../context/SelfLearningContext';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd, convertBetweenTradeCurrencies, inferInstrumentCurrencyFromSymbol } from '../utils/currencyMath';
import CurrencyDualDisplay from '../components/CurrencyDualDisplay';
import { fetchCompanyNameForSymbol } from '../hooks/useSymbolCompanyName';
import { translateFinancialInsightToArabic, formatAiError } from '../services/geminiService';

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 0–100 scores: one decimal max, no trailing “.0” for whole numbers. */
function formatRiskPointsOn100(n: number): string {
  const r = Math.round(Math.min(100, Math.max(0, Number(n) || 0)) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const PlanTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (plan: Omit<PlannedTrade, 'id'|'user_id'> | PlannedTrade) => void | boolean | Promise<void | boolean>;
    planToEdit: PlannedTrade | null;
    universe?: { ticker?: string; name?: string; status?: string; id?: string }[];
    simulatedPrices?: Record<string, { price?: number }>;
    monthlyBudget?: number;
    /** Core sleeve fraction (0–1) from investment plan — improves default trade amount. */
    coreAllocation?: number;
    budgetCurrency?: TradeCurrency;
    /** When set, merge into a new-plan form (e.g. Smart add → Record plan). */
    newPlanFieldInjection?: { key: number; symbol: string; name?: string; targetPrice?: number; amount?: number; quantity?: number; tradeType?: 'buy' | 'sell'; notes?: string } | null;
    onNewPlanFieldInjectionConsumed?: () => void;
}> = ({ isOpen, onClose, onSave, planToEdit, universe = [], simulatedPrices = {}, monthlyBudget, coreAllocation, budgetCurrency, newPlanFieldInjection, onNewPlanFieldInjectionConsumed }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
    const [conditionType, setConditionType] = useState<'price' | 'date'>('price');
    const [targetValue, setTargetValue] = useState('');
    const [quantity, setQuantity] = useState('');
    const [amount, setAmount] = useState('');
    const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [notes, setNotes] = useState('');
    const lastSymbolAtFocusRef = useRef('');
    const skipUniverseAutofillRef = useRef(false);

    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const planCcy = (budgetCurrency || 'SAR') as TradeCurrency;
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data ?? null, exchangeRate), [data, exchangeRate]);
    const instrumentCurrency = useMemo(() => inferInstrumentCurrencyFromSymbol(symbol), [symbol]);

    useEffect(() => {
        if (!isOpen) {
            skipUniverseAutofillRef.current = false;
        }
        if (planToEdit) {
            setSymbol(planToEdit.symbol);
            setName(planToEdit.name);
            setTradeType(planToEdit.tradeType);
            setConditionType(planToEdit.conditionType);
            if (planToEdit.conditionType === 'date') {
                setTargetValue(new Date(planToEdit.targetValue).toISOString().split('T')[0]);
            } else {
                setTargetValue(String(planToEdit.targetValue));
            }
            setQuantity(String(planToEdit.quantity || ''));
            setAmount(String(planToEdit?.amount ?? ''));
            setPriority(planToEdit.priority);
            setNotes(planToEdit.notes || '');
        } else {
            // Reset form
            setSymbol(''); setName(''); setTradeType('buy'); setConditionType('price');
            setTargetValue(''); setQuantity(''); setAmount(''); setPriority('Medium'); setNotes('');
            lastSymbolAtFocusRef.current = '';
        }
    }, [planToEdit, isOpen]);

    // Apply one-shot prefill (Smart add, etc.): after base reset effects for new plans.
    useEffect(() => {
        if (!isOpen || planToEdit || !newPlanFieldInjection) return;
        const p = newPlanFieldInjection;
        setSymbol(p.symbol.toUpperCase().trim());
        if (p.name) setName(p.name);
        setTradeType(p.tradeType ?? 'buy');
        setConditionType('price');
        if (p.targetPrice != null && Number.isFinite(p.targetPrice) && p.targetPrice > 0) {
            setTargetValue(String(p.targetPrice));
        }
        if (p.amount != null && p.amount > 0) setAmount(String(p.amount));
        else setAmount('');
        if (p.quantity != null && p.quantity > 0) setQuantity(String(p.quantity));
        else setQuantity('');
        if (p.notes) setNotes(p.notes);
        lastSymbolAtFocusRef.current = p.symbol.toUpperCase().trim();
        skipUniverseAutofillRef.current = true;
        onNewPlanFieldInjectionConsumed?.();
    }, [isOpen, planToEdit, newPlanFieldInjection, onNewPlanFieldInjectionConsumed]);

    // Auto-pick first actionable universe ticker when creating a new plan (if nothing chosen yet and no injection this frame).
    useEffect(() => {
        if (!isOpen || planToEdit || newPlanFieldInjection || skipUniverseAutofillRef.current) return;
        const first = universe.find((t) => {
            const s = String(t.status ?? '');
            return s === 'Core' || s === 'High-Upside';
        });
        if (first?.ticker) {
            setSymbol(String(first.ticker).toUpperCase().trim());
            if (first.name) setName(String(first.name));
        }
    }, [isOpen, planToEdit, newPlanFieldInjection, universe]);

    // Default date trigger to ~30 days ahead when in date mode on a new plan (or after switching from price).
    useEffect(() => {
        if (!isOpen || planToEdit || conditionType !== 'date') return;
        if (targetValue && ISO_DATE_ONLY.test(targetValue.trim())) return;
        const d = new Date();
        d.setDate(d.getDate() + 30);
        setTargetValue(d.toISOString().split('T')[0]);
    }, [isOpen, planToEdit, conditionType, targetValue]);

    const handleSymbolInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        if (!planToEdit) {
            const n = next.trim().toUpperCase();
            const prev = (symbol || '').trim().toUpperCase();
            if (n.length >= 1 && n !== prev) {
                setTargetValue('');
                setAmount('');
                setQuantity('');
            }
        }
        setSymbol(next);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validations
        if (!symbol || symbol.trim() === '') {
            toast('Symbol is required.', 'error');
            return;
        }
        
        if (quantity && (parseFloat(quantity) <= 0 || !Number.isFinite(parseFloat(quantity)))) {
            toast('Quantity must be a positive number.', 'error');
            return;
        }
        
        if (amount && (parseFloat(amount) <= 0 || !Number.isFinite(parseFloat(amount)))) {
            toast('Amount must be a positive number.', 'error');
            return;
        }
        
        if (conditionType === 'price') {
            const price = parseFloat(targetValue);
            if (!Number.isFinite(price) || price <= 0) {
                toast('Target price must be a positive number.', 'error');
                return;
            }
            if (price > 1000000) {
                if (!confirm('Target price seems unusually high. Continue anyway?')) {
                    return;
                }
            }
        } else {
            const targetDate = new Date(targetValue);
            if (isNaN(targetDate.getTime())) {
                toast('Invalid target date.', 'error');
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const selectedDate = new Date(targetDate);
            selectedDate.setHours(0, 0, 0, 0);
            if (selectedDate < today) {
                if (!confirm('Target date is in the past. Continue anyway?')) {
                    return;
                }
            }
        }
        
        // Validate quantity/amount vs target (amount is plan currency; target price is in the symbol's traded currency)
        if (quantity && amount) {
            const qty = parseFloat(quantity);
            const amt = parseFloat(amount);
            if (qty > 0 && amt > 0) {
                if (conditionType === 'price') {
                    const targetPrice = parseFloat(targetValue);
                    if (targetPrice > 0) {
                        const instr = inferInstrumentCurrencyFromSymbol(symbol);
                        const amtInstr = convertBetweenTradeCurrencies(amt, planCcy, instr, sarPerUsd);
                        const impliedPriceInstr = amtInstr / qty;
                        const diff = Math.abs(impliedPriceInstr - targetPrice) / targetPrice;
                        if (diff > 0.1) {
                            if (
                                !confirm(
                                    `Quantity and ${planCcy} amount imply ~${impliedPriceInstr.toFixed(4)} ${instr}/share; target is ${targetPrice.toFixed(4)} ${instr}. Continue anyway?`,
                                )
                            ) {
                                return;
                            }
                        }
                    }
                }
            }
        }
        
        const planData = {
            symbol: symbol.toUpperCase().trim(),
            name: name.trim() || symbol.toUpperCase().trim(),
            tradeType,
            conditionType,
            targetValue: conditionType === 'date' ? new Date(targetValue).getTime() : parseFloat(targetValue),
            quantity: quantity ? parseFloat(quantity) : undefined,
            amount: amount ? parseFloat(amount) : undefined,
            priority,
            notes: notes.trim(),
            status: 'Planned' as const
        };
        
        const saveResult = planToEdit
            ? await onSave({ ...planToEdit, ...planData })
            : await onSave(planData);
        if (saveResult === false) return;
        toast(planToEdit ? 'Plan updated.' : 'Plan created.', 'success');
        onClose();
    };

    // Auto-fill company name: Investment Plan universe first, then Finnhub/static map (same as Record Trade / Watchlist).
    useEffect(() => {
        if (!isOpen || planToEdit) return;
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) return;
        const match = universe.find((t: { ticker?: string; name?: string }) => String(t.ticker || '').toUpperCase() === sym);
        if (match?.name) {
            setName(match.name);
            return;
        }
        let cancelled = false;
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((apiName) => {
                if (!cancelled && apiName) setName(apiName);
            });
        }, 450);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [symbol, isOpen, planToEdit, universe]);

    // Suggest target price from current price when creating new plan.
    // Omit targetValue from deps so clearing the field does not re-trigger fill.
    useEffect(() => {
        if (!isOpen || planToEdit || conditionType !== 'price' || targetValue) return;
        const sym = symbol.trim().toUpperCase();
        const price = simulatedPrices[sym]?.price;
        if (price && Number.isFinite(price)) setTargetValue(String(price));
    }, [isOpen, planToEdit, symbol, conditionType, simulatedPrices]);

    // Suggest amount from monthly budget when creating a buy plan (max of 10% budget vs ~20% of Core sleeve).
    // Omit amount/quantity from deps so clearing the field does not re-trigger fill.
    useEffect(() => {
        if (!isOpen || planToEdit || tradeType !== 'buy' || amount || quantity) return;
        if (monthlyBudget && monthlyBudget > 0) {
            const core = typeof coreAllocation === 'number' && Number.isFinite(coreAllocation) && coreAllocation > 0 ? coreAllocation : 0.7;
            const fromSleeve = monthlyBudget * core * 0.2;
            const fromTenPct = monthlyBudget * 0.1;
            const suggested = Math.round(Math.max(fromTenPct, fromSleeve, 100));
            if (suggested >= 100) setAmount(String(suggested));
        }
    }, [isOpen, planToEdit, tradeType, monthlyBudget, coreAllocation]);

    const planTargetPriceNum = useMemo(() => {
        if (conditionType !== 'price') return NaN;
        const t = parseFloat(targetValue);
        return Number.isFinite(t) && t > 0 ? t : NaN;
    }, [conditionType, targetValue]);

    const recalcPlanAmountQuantityFromTarget = useCallback(() => {
        if (conditionType !== 'price') return;
        const tp = planTargetPriceNum;
        if (!Number.isFinite(tp) || tp <= 0) return;
        const instr = instrumentCurrency;
        const a = parseFloat(amount);
        const q = parseFloat(quantity);
        if (Number.isFinite(a) && a > 0) {
            const amtInstr = convertBetweenTradeCurrencies(a, planCcy, instr, sarPerUsd);
            setQuantity((amtInstr / tp).toFixed(6).replace(/\.?0+$/, '') || '0');
        } else if (Number.isFinite(q) && q > 0) {
            const notionalInstr = q * tp;
            const aPlan = convertBetweenTradeCurrencies(notionalInstr, instr, planCcy, sarPerUsd);
            setAmount(aPlan.toFixed(2).replace(/\.?0+$/, '') || '0');
        }
    }, [conditionType, planTargetPriceNum, amount, quantity, instrumentCurrency, planCcy, sarPerUsd]);

    const handlePlanQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setQuantity(v);
        if (conditionType === 'price' && Number.isFinite(planTargetPriceNum) && planTargetPriceNum > 0) {
            const q = parseFloat(v);
            if (Number.isFinite(q) && q > 0) {
                const notionalInstr = q * planTargetPriceNum;
                const aPlan = convertBetweenTradeCurrencies(notionalInstr, instrumentCurrency, planCcy, sarPerUsd);
                setAmount(aPlan.toFixed(2).replace(/\.?0+$/, '') || '0');
            }
        }
    };

    const handlePlanAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setAmount(v);
        if (conditionType === 'price' && Number.isFinite(planTargetPriceNum) && planTargetPriceNum > 0) {
            const a = parseFloat(v);
            if (Number.isFinite(a) && a > 0) {
                const amtInstr = convertBetweenTradeCurrencies(a, planCcy, instrumentCurrency, sarPerUsd);
                setQuantity((amtInstr / planTargetPriceNum).toFixed(6).replace(/\.?0+$/, '') || '0');
            }
        }
    };

    const planTradeSizing = useMemo(() => {
        if (conditionType !== 'price' || !Number.isFinite(planTargetPriceNum)) return null;
        const q = parseFloat(quantity);
        const a = parseFloat(amount);
        const tp = planTargetPriceNum;
        const instr = instrumentCurrency;
        if (Number.isFinite(q) && q > 0 && Number.isFinite(tp)) {
            const notionalInstr = q * tp;
            const inPlan = convertBetweenTradeCurrencies(notionalInstr, instr, planCcy, sarPerUsd);
            return { notionalInstr, inPlan, instr };
        }
        if (Number.isFinite(a) && a > 0) return { notionalInstr: null as number | null, inPlan: a, instr: instrumentCurrency };
        return null;
    }, [conditionType, planTargetPriceNum, quantity, amount, instrumentCurrency, planCcy, sarPerUsd]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={planToEdit ? 'Edit plan' : 'Create plan'}>
            <p className="text-xs text-slate-600 -mt-2 mb-4">
                {planToEdit ? 'Update trigger and size.' : 'Fields pre-fill from your universe, live prices, and monthly investment plan when possible. Adjust before saving.'}
                {budgetCurrency ? ` Amounts are in plan currency (${budgetCurrency}) unless noted for the ticker.` : ''}
            </p>
            <form onSubmit={handleSubmit} className="space-y-6">
                {universe.length > 0 && (
                    <datalist id="plan-trade-universe-symbols">
                        {universe.map((t: { ticker?: string; name?: string; status?: string; id?: string }, i: number) => (
                            <option
                                key={`${t.id ?? t.ticker ?? 't'}-${i}`}
                                value={String(t.ticker ?? '').toUpperCase()}
                                label={t.name ? `${t.name} (${t.status ?? ''})` : undefined}
                            />
                        ))}
                    </datalist>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="symbol" className="block text-sm font-semibold text-gray-700 mb-2">Symbol</label>
                        <input 
                            type="text" 
                            id="symbol"
                            list={universe.length > 0 ? 'plan-trade-universe-symbols' : undefined}
                            value={symbol} 
                            onChange={handleSymbolInputChange} 
                            required 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., AAPL" 
                        />
                    </div>
                    <div>
                        <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">Company Name</label>
                        <input 
                            type="text" 
                            id="name"
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            required 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., Apple Inc." 
                        />
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="trade-type" className="block text-sm font-semibold text-gray-700 mb-2">Trade Type</label>
                        <select 
                            id="trade-type"
                            value={tradeType} 
                            onChange={e => setTradeType(e.target.value as any)} 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="buy">Buy</option>
                            <option value="sell">Sell</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="priority" className="block text-sm font-semibold text-gray-700 mb-2">
                            Priority <InfoHint text="High = act first when triggered. Medium = normal. Low = optional, can wait." hintId="plan-trade-priority" hintPage="Investment Plan" />
                        </label>
                        <select 
                            id="priority"
                            value={priority} 
                            onChange={e => setPriority(e.target.value as any)} 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                        </select>
                    </div>
                </div>
                
                <fieldset className="border border-gray-200 rounded-lg p-4">
                    <legend className="text-sm font-semibold text-gray-700 px-2 inline-flex items-center gap-1">
                        Trigger condition
                        <InfoHint text="When should this plan run? Price target = when the stock hits a price. Date target = on a specific date." hintId="plan-condition-type" hintPage="Investment Plan" />
                    </legend>
                    <div className="flex items-center space-x-6 mb-4">
                        <label className="flex items-center cursor-pointer">
                            <input 
                                type="radio" 
                                value="price" 
                                checked={conditionType === 'price'} 
                                onChange={() => setConditionType('price')} 
                                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary" 
                            /> 
                            <span className="ml-2 text-sm font-medium">Price Target</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                            <input 
                                type="radio" 
                                value="date" 
                                checked={conditionType === 'date'} 
                                onChange={() => setConditionType('date')} 
                                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary" 
                            /> 
                            <span className="ml-2 text-sm font-medium">Date Target</span>
                        </label>
                    </div>
                    <div>
                        <label htmlFor="target-value" className="block text-sm font-semibold text-gray-700 mb-2">
                            {conditionType === 'date' ? 'Target Date' : (
                                <>
                                    Trigger price (per share)
                                    <InfoHint
                                        text={
                                            tradeType === 'buy'
                                                ? 'Per share in the stock’s traded currency (e.g. USD). The plan is ready when the market price is at or below this level (≤).'
                                                : 'Per share in the stock’s traded currency. The plan is ready when the market price is at or above this level (≥).'
                                        }
                                        hintId="plan-target-price"
                                        hintPage="Investment Plan"
                                    />
                                </>
                            )}
                        </label>
                        <input 
                            id="target-value"
                            type={conditionType === 'date' ? 'date' : 'number'} 
                            value={targetValue} 
                            onChange={e => setTargetValue(e.target.value)} 
                            onBlur={conditionType === 'price' ? recalcPlanAmountQuantityFromTarget : undefined}
                            required 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder={conditionType === 'date' ? 'Select date' : 'Enter target price'}
                        />
                    </div>
                </fieldset>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="quantity" className="block text-sm font-semibold text-gray-700 mb-2">
                            Quantity (shares) <InfoHint text="Number of shares to buy or sell. Or use Amount below for a total (in plan currency, usually SAR)." hintId="plan-quantity" hintPage="Investment Plan" />
                        </label>
                        <input 
                            id="quantity"
                            type="number" 
                            value={quantity} 
                            onChange={handlePlanQuantityChange} 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., 100" 
                        />
                    </div>
                    <div>
                        <label htmlFor="amount" className="block text-sm font-semibold text-gray-700 mb-2">
                            Amount <InfoHint text="Total money for this trade (in plan currency, usually SAR). If you have a monthly budget set, we suggest 10% as a starting point." hintId="plan-amount" hintPage="Investment Plan" />
                        </label>
                        <input 
                            id="amount"
                            type="number" 
                            value={amount} 
                            onChange={handlePlanAmountChange} 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., 5000" 
                        />
                    </div>
                </div>
                {conditionType === 'price' && planTradeSizing != null && (
                    <p className="text-sm text-slate-600 -mt-2">
                        {planTradeSizing.notionalInstr != null ? (
                            <>
                                At target ({planTargetPriceNum.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                                {planTradeSizing.instr}/share): notional ≈{' '}
                                <span className="font-semibold tabular-nums">
                                    {planTradeSizing.notionalInstr.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                                    {planTradeSizing.instr}
                                </span>
                                {' · '}
                                <span className="text-slate-700">
                                    ≈ {planTradeSizing.inPlan.toLocaleString(undefined, { maximumFractionDigits: 2 })} {planCcy} (plan)
                                </span>
                                <span className="text-slate-500"> · FX {sarPerUsd.toFixed(4)} SAR/USD</span>
                            </>
                        ) : (
                            <>
                                Amount (plan):{' '}
                                <span className="font-semibold tabular-nums">
                                    {planTradeSizing.inPlan.toLocaleString(undefined, { maximumFractionDigits: 2 })} {planCcy}
                                </span>
                            </>
                        )}
                    </p>
                )}
                
                <div>
                    <label htmlFor="notes" className="block text-sm font-semibold text-gray-700 mb-2">Notes (Optional)</label>
                    <textarea 
                        id="notes"
                        value={notes} 
                        onChange={e => setNotes(e.target.value)} 
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none" 
                        rows={3}
                        placeholder="Add any notes or context for this trade..."
                    />
                </div>

                <div className="flex gap-3 pt-4">
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:from-primary/90 hover:to-secondary/90 transition-all font-medium shadow-sm"
                    >
                        {planToEdit ? 'Update Plan' : 'Create Plan'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

/** Control tower: cross-engine constraints, alerts, and prioritized actions for Investment Plan. */
const InvestmentPlanControlTower: React.FC = () => {
  const { data } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { analysis, actionQueue, cash, risk, household, ready } = useFinancialEnginesIntegration();
  const emergencyFund = useEmergencyFund(data ?? null);
  const nextBestActions = useMemo(() => {
    const txs = getPersonalTransactions(data);
    const salaryCov = salaryToExpenseCoverage(txs as import('../types').Transaction[], 6);
    const goalAlerts = (data?.goals ?? []).map((g: { id: string; name: string; savingsAllocationPercent?: number }) => ({
      goalId: g.id,
      name: g.name,
      allocPct: Number(g.savingsAllocationPercent) || 0,
    }));
    return generateNextBestActions({
      emergencyFundMonths: emergencyFund.monthsCovered,
      runwayMonths: emergencyFund.monthsCovered,
      goalAlerts,
      salaryCoverageRatio: salaryCov?.ratio ?? undefined,
      nwSnapshotCount: listNetWorthSnapshots().length,
    });
  }, [data, emergencyFund.monthsCovered]);

  const hasAlerts = (analysis?.alerts?.length ?? 0) > 0;
  const hasActions = actionQueue.length > 0;
  const hasNextBest = nextBestActions.length > 0;
  const hasStress = (household?.cashflowStressSignals?.length ?? 0) > 0;
  if (!ready && !hasNextBest) return null;
  if (!hasAlerts && !hasActions && !cash && !hasStress && !hasNextBest) return null;

  return (
    <SectionCard title="Your financial health check" collapsible collapsibleSummary="Cash, stress, runway" defaultExpanded={false}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cash && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Cash</p>
            <p className="text-sm text-slate-800">
              Buffer: {Number(cash.cashflowBuffer.toFixed(1))} mo ·
              Discretionary:{' '}
              {cash.discretionaryBudget >= 0
                ? formatCurrencyString(cash.discretionaryBudget, { digits: 0 })
                : '—'}
            </p>
          </div>
        )}
        {risk && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk</p>
            <p className="text-sm text-slate-800">
              Portfolio risk score: {formatRiskPointsOn100(risk.currentPortfolioRisk)}/100 · Risk headroom:{' '}
              {formatRiskPointsOn100(risk.riskBudgetRemaining)}/100
            </p>
            <p className="text-xs text-slate-500 mt-1">0–100 model score (not a cash balance).</p>
          </div>
        )}
        {household?.cashflowStressSignals && household.cashflowStressSignals.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Household</p>
            <p className="text-sm text-amber-900">{household.cashflowStressSignals[0].message}</p>
          </div>
        )}
      </div>
      {hasAlerts && analysis && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">Alerts</p>
          <ul className="space-y-1 text-sm text-amber-900">
            {analysis.alerts.slice(0, 3).map((a, i) => (
              <li key={i}>{a.message}</li>
            ))}
          </ul>
        </div>
      )}
      {hasActions && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-600 mb-2">Prioritized actions</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {actionQueue.slice(0, 4).map((item, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{item.action}</span>
                <span className="text-slate-500 text-xs">P{Math.round(item.priority)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasNextBest && (
        <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="text-xs font-semibold text-indigo-800 mb-2">Suggested actions</p>
          <ul className="space-y-1 text-sm text-indigo-900">
            {nextBestActions.slice(0, 3).map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Your plans are checked against cash and risk limits. For full allocation, use Wealth Ultra.</p>
    </SectionCard>
  );
};

const InvestmentPlanView: React.FC<{
    onExecutePlan: (plan?: PlannedTrade) => void;
    setActivePage?: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
    /** When true, skip PageLayout (e.g. inside Investments hub). */
    embedded?: boolean;
    /** Open create-plan with prefilled fields (e.g. Smart add → Record plan). Bump `key` for each new intent. */
    stagedAddOnPlanned?: { key: number; symbol: string; name?: string; targetPrice?: number; amount?: number; quantity?: number; tradeType?: 'buy' | 'sell'; notes?: string } | null;
    onStagedAddOnPlannedHandled?: () => void;
}> = ({ onExecutePlan, setActivePage: _setActivePage, triggerPageAction, embedded = false, stagedAddOnPlanned, onStagedAddOnPlannedHandled }) => {
    const { data, loading, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addUniverseTicker } = useContext(DataContext)!;
    const { trackAction, trackSuggestionFeedback } = useSelfLearning();
    const { simulatedPrices } = useMarketData();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data ?? null, exchangeRate), [data, exchangeRate]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [planToEdit, setPlanToEdit] = useState<PlannedTrade | null>(null);
    const [planToDelete, setPlanToDelete] = useState<PlannedTrade | null>(null);
    const [alignmentFilter, setAlignmentFilter] = useState<'All' | 'Aligned' | 'Conflict' | 'Needs mapping'>('All');
    const [symbolFocus, setSymbolFocus] = useState<string>('');
    const [alignmentSummaryAr, setAlignmentSummaryAr] = useState<string>('');
    const [alignmentSummaryArError, setAlignmentSummaryArError] = useState<string | null>(null);
    const [isTranslatingAlignment, setIsTranslatingAlignment] = useState(false);

    useEffect(() => {
        if (!stagedAddOnPlanned) return;
        setPlanToEdit(null);
        setIsModalOpen(true);
    }, [stagedAddOnPlanned?.key, stagedAddOnPlanned]);

    const householdStress = React.useMemo(
        () => computeHouseholdStressFromData(data),
        [data]
    );

    // Loading state
    if (loading || !data) {
        const loadingInner = (
            <div className="flex items-center justify-center py-12" aria-busy="true">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading trade plans" />
                    <p className="text-sm text-slate-600">Loading trade plans…</p>
                </div>
            </div>
        );
        if (embedded) return loadingInner;
        return (
            <PageLayout title="Trade plans" description="Schedule future buys or sells. We’ll flag when your rule is met.">
                {loadingInner}
            </PageLayout>
        );
    }

    const handleSave = async (planData: Omit<PlannedTrade, 'id' | 'user_id'> | PlannedTrade) => {
        if ('id' in planData) {
            return (await updatePlannedTrade(planData as PlannedTrade)) === true;
        }
        return (await addPlannedTrade(planData as Omit<PlannedTrade, 'id' | 'user_id'>)) === true;
    };

    const handleOpenPlanModal = (plan: PlannedTrade | null) => {
        if (!plan) trackAction('add-plan', 'Investment Plan');
        setPlanToEdit(plan);
        setIsModalOpen(true);
    };

    const handleExecutePlan = (plan: PlannedTrade) => {
        if (!triggerPageAction) {
            onExecutePlan(plan);
            return;
        }
        try {
            sessionStorage.setItem(EXECUTE_PLAN_STORAGE_KEY, JSON.stringify({
                symbol: plan.symbol,
                name: plan.name,
                tradeType: plan.tradeType,
                amount: plan.amount,
                quantity: plan.quantity,
                price: plan.conditionType === 'price' ? plan.targetValue : undefined,
                executedPlanId: plan.id,
                reason: 'From Investment Plan',
            }));
            triggerPageAction('Investments', 'open-trade-modal:from-plan');
        } catch {
            toast('Could not open Record Trade. Go to Investments to record manually.', 'error');
        }
    };
    
    const priorityClass = (p: PlannedTrade['priority']) => ({ High: 'bg-red-100 text-red-800', Medium: 'bg-yellow-100 text-yellow-800', Low: 'bg-blue-100 text-blue-800' }[p]);
    /** Per-share trigger in instrument currency (not derived from amount ÷ qty). */
    const getTriggerPriceForComparison = (plan: PlannedTrade): number | null => {
        if (plan.conditionType !== 'price') return null;
        const v = plan.targetValue;
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    };

    const getPriceSignalClass = (plan: PlannedTrade): string => {
        const plannedPrice = getTriggerPriceForComparison(plan);
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        if (!plannedPrice || !currentPrice) return 'bg-gray-100 text-gray-600';

        const ratio = (currentPrice - plannedPrice) / plannedPrice;
        if (Math.abs(ratio) <= 0.01) return 'bg-yellow-100 text-yellow-800';
        if (plan.tradeType === 'buy') {
            return currentPrice <= plannedPrice ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
        }
        return currentPrice >= plannedPrice ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
    };

    const getPriceSignalLabel = (plan: PlannedTrade): string => {
        const plannedPrice = getTriggerPriceForComparison(plan);
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        if (!plannedPrice || !currentPrice) return 'Waiting price';

        const ratio = Math.abs((currentPrice - plannedPrice) / plannedPrice);
        if (ratio <= 0.01) return 'Near plan';
        if (plan.tradeType === 'buy') return currentPrice <= plannedPrice ? 'Favorable' : 'Above trigger';
        return currentPrice >= plannedPrice ? 'Favorable' : 'Below plan';
    };

    
    const renderCondition = (plan: PlannedTrade) => {
        if (plan.conditionType === 'date') {
            return `On ${new Date(plan.targetValue).toLocaleDateString()}`;
        }
        const instr = inferInstrumentCurrencyFromSymbol(plan.symbol ?? '');
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        const side = plan.tradeType === 'buy' ? 'Buy when' : 'Sell when';
        return (
            <div className="space-y-1">
                <p className="text-xs text-slate-500">
                    {side} price {plan.tradeType === 'buy' ? '≤' : '≥'} trigger
                </p>
                <CurrencyDualDisplay value={plan.targetValue} inCurrency={instr} digits={2} size="base" weight="bold" className="text-slate-900" />
                {currentPrice != null && Number.isFinite(currentPrice) && (
                    <p className="text-xs text-slate-500">
                        Spot:{' '}
                        <CurrencyDualDisplay value={currentPrice} inCurrency={instr} digits={2} size="base" className="inline-flex" />
                    </p>
                )}
            </div>
        );
    };
    


    const planAlignment = useMemo(() => {
        const universe = data?.portfolioUniverse ?? [];
        const plannedTrades = data?.plannedTrades ?? [];
        const statusBySymbol = new Map(universe.map((t: any) => [String(t.ticker || '').toUpperCase(), t.status]));
        const inferredFromHoldings = new Map<string, string>();
        for (const p of getPersonalInvestments(data)) {
            for (const h of p.holdings ?? []) {
                const sym = String(h.symbol ?? '').toUpperCase();
                if (!sym) continue;
                inferredFromHoldings.set(
                    sym,
                    engineSleeveKeyToTickerStatus(inferEngineSleeveKeyFromHolding(h)),
                );
            }
        }
        const rowsBySymbol = new Map<string, {
            plan: PlannedTrade; universeStatus: string; recommendation: string; aligned: boolean | null; reason: string; suggestedTradeType: 'buy' | 'sell'; aiNudge: string;
        }>();
        for (const plan of plannedTrades) {
            const symbolKey = (plan.symbol ?? '').toUpperCase();
            // Important: show every distinct plan (do NOT collapse rows).
            // Use plan.id as the stable unique key; fall back to a composite if needed.
            const rowKey =
                (plan as any)?.id ??
                `${symbolKey}|${plan.tradeType}|${plan.conditionType}|${Number((plan as any)?.targetValue) || 0}`;
            const universeStatus =
                statusBySymbol.get(symbolKey)
                ?? inferredFromHoldings.get(symbolKey)
                ?? 'Untracked';
            const isBuy = plan.tradeType === 'buy';
            const recommendation = universeStatus === 'Core' || universeStatus === 'High-Upside'
                ? (universeStatus === 'Core' ? 'Core: steady accumulation' : 'High-upside: opportunistic adds within caps')
                : universeStatus === 'Speculative'
                ? 'Small sizing only'
                : universeStatus === 'Quarantine'
                ? 'Reduce / avoid new exposure'
                : universeStatus === 'Watchlist' || universeStatus === 'Excluded'
                ? 'Review manually'
                : 'Review manually';
            const suggestedTradeType: 'buy' | 'sell' = universeStatus === 'Quarantine' ? 'sell' : 'buy';
            const aligned = universeStatus === 'Untracked'
                ? null
                : (isBuy && !['Quarantine'].includes(universeStatus)) || (!isBuy && universeStatus === 'Quarantine');
            const reason = aligned === false
                ? (isBuy && universeStatus === 'Quarantine'
                    ? 'Buy conflicts with quarantine status.'
                    : !isBuy && universeStatus !== 'Quarantine'
                    ? 'Sell may reduce non-quarantine exposure.'
                    : 'Direction differs from AI universe posture.')
                : aligned === true
                ? (universeStatus === 'Core'
                    ? 'Core sleeve: your plan and universe both favor holding or adding in stages.'
                    : universeStatus === 'High-Upside'
                    ? 'High-upside sleeve: tilt matches a growth / momentum posture.'
                    : universeStatus === 'Quarantine'
                    ? 'Quarantine: de-risking direction matches a trim or hold-without-adds view.'
                    : 'Direction supports current universe posture.')
                : 'Symbol has no universe row and is not held — add a universe mapping or a holding to classify it.';
            const aiNudge = suggestedTradeType === 'sell'
                ? (universeStatus === 'Quarantine'
                    ? 'Prefer trimming or not adding new exposure while quarantine is active.'
                    : 'Favor a sell/trim posture for this name until the universe status changes.')
                : universeStatus === 'Core'
                ? 'Favor staged buys that respect your core sleeve and monthly weight in the universe table.'
                : universeStatus === 'High-Upside'
                ? 'Favor add-ons that stay within sleeve weight and the max position for this ticker.'
                : universeStatus === 'Untracked'
                ? 'Add a universe row or hold this symbol so sleeve classification can apply.'
                : 'Tune trigger and size in the plan editor to match your sleeve posture.';
            const row = { plan, universeStatus, recommendation, aligned, reason, suggestedTradeType, aiNudge };
            rowsBySymbol.set(rowKey, row);
        }
        const rows = Array.from(rowsBySymbol.values());

        const filteredRows = rows.filter(r => alignmentFilter === 'All'
            ? true
            : alignmentFilter === 'Aligned'
            ? r.aligned === true
            : alignmentFilter === 'Conflict'
            ? r.aligned === false
            : r.aligned === null
        );

        return {
            rows,
            filteredRows,
            alignedCount: rows.filter(r => r.aligned === true).length,
            conflictCount: rows.filter(r => r.aligned === false).length,
            untrackedCount: rows.filter(r => r.aligned === null).length,
        };
    }, [data, alignmentFilter]);

    const planValidationWarnings = useMemo(() => {
        const plans = data?.plannedTrades ?? [];
        const planCurrency = ((data as any)?.investmentPlan?.budgetCurrency || 'SAR') as TradeCurrency;
        const out: string[] = [];
        if (plans.length === 0) return out;
        let invalidDateCount = 0;
        let invalidPriceCount = 0;
        let stalePriceCount = 0;
        let sizingMismatchCount = 0;
        let missingSymbolCount = 0;
        plans.forEach((plan) => {
            const sym = String(plan.symbol ?? '').trim().toUpperCase();
            if (!sym) missingSymbolCount += 1;
            if (plan.conditionType === 'date') {
                const d = new Date(String(plan.targetValue ?? ''));
                if (!(d instanceof Date) || Number.isNaN(d.getTime())) invalidDateCount += 1;
            }
            if (plan.conditionType === 'price') {
                const target = Number(plan.targetValue);
                if (!Number.isFinite(target) || target <= 0) invalidPriceCount += 1;
                const spot = Number(simulatedPrices[sym]?.price);
                if (!Number.isFinite(spot) || spot <= 0) stalePriceCount += 1;
                const qty = Number(plan.quantity ?? 0);
                const amt = Number(plan.amount ?? 0);
                if (qty > 0 && amt > 0 && Number.isFinite(target) && target > 0) {
                    const instr = inferInstrumentCurrencyFromSymbol(sym);
                    const amtInstr = convertBetweenTradeCurrencies(amt, planCurrency, instr, sarPerUsd);
                    const impliedPrice = amtInstr / qty;
                    const drift = Math.abs((impliedPrice - target) / target);
                    if (Number.isFinite(drift) && drift > 0.35) sizingMismatchCount += 1;
                }
            }
        });
        if (missingSymbolCount > 0) out.push(`${missingSymbolCount} plan${missingSymbolCount > 1 ? 's' : ''} missing symbol.`);
        if (invalidDateCount > 0) out.push(`${invalidDateCount} date trigger${invalidDateCount > 1 ? 's are' : ' is'} invalid.`);
        if (invalidPriceCount > 0) out.push(`${invalidPriceCount} price trigger${invalidPriceCount > 1 ? 's are' : ' is'} invalid.`);
        if (stalePriceCount > 0) out.push(`${stalePriceCount} price-triggered plan${stalePriceCount > 1 ? 's' : ''} missing live price.`);
        if (sizingMismatchCount > 0) out.push(`${sizingMismatchCount} plan${sizingMismatchCount > 1 ? 's' : ''} have amount/quantity mismatch vs target price.`);
        return out;
    }, [data?.plannedTrades, data?.investmentPlan, simulatedPrices, sarPerUsd]);

    const alignmentSummaryEn = useMemo(
        () =>
            `Plan alignment summary: ${planAlignment.alignedCount} aligned, ${planAlignment.conflictCount} conflicts, ${planAlignment.untrackedCount} need mapping. ` +
            (planValidationWarnings.length > 0
                ? `Validation checks: ${planValidationWarnings.join(' ')}`
                : 'Validation checks: no critical issues found.'),
        [planAlignment, planValidationWarnings]
    );

    useEffect(() => {
        setAlignmentSummaryAr('');
        setAlignmentSummaryArError(null);
    }, [alignmentSummaryEn]);

    const handleTranslateAlignmentToArabic = useCallback(async () => {
        setIsTranslatingAlignment(true);
        setAlignmentSummaryArError(null);
        try {
            const ar = await translateFinancialInsightToArabic(alignmentSummaryEn);
            setAlignmentSummaryAr(ar);
        } catch (e) {
            setAlignmentSummaryArError(formatAiError(e));
        }
        setIsTranslatingAlignment(false);
    }, [alignmentSummaryEn]);




    const handleAddToUniverse = async (plan: PlannedTrade) => {
        trackAction('add-to-universe', 'Investment Plan');
        try {
            const universe = data?.portfolioUniverse ?? [];
            const exists = universe.some((t: { ticker?: string }) => (t.ticker ?? '').toUpperCase() === (plan.symbol ?? '').toUpperCase());
            if (exists) {
                setAlignmentFilter('All');
                setSymbolFocus(plan.symbol);
                toast(`${plan.symbol} is already in your universe.`, 'info');
                return;
            }

            await addUniverseTicker({
                ticker: (plan.symbol ?? '').toUpperCase(),
                name: plan.name ?? (plan.symbol ?? '').toUpperCase(),
                status: 'Watchlist',
                max_position_weight: 0.1,
            });
            setAlignmentFilter('All');
            setSymbolFocus(plan.symbol);
            toast(`${plan.symbol} added to universe. AI can now track it.`, 'success');
        } catch (error) {
            toast(`Could not add to universe: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };


    const handleAlignWithAi = async (plan: PlannedTrade, suggestedTradeType: 'buy' | 'sell') => {
        trackAction('align-with-ai', 'Investment Plan');
        if (plan.tradeType === suggestedTradeType) return;
        try {
            await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
            setSymbolFocus(plan.symbol);
            toast('Plan aligned with AI recommendation.', 'success');
        } catch (error) {
            toast(`Could not update plan: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const handleAlignAllConflicts = async () => {
        trackAction('align-all-conflicts', 'Investment Plan');
        const conflicts = planAlignment.rows.filter(r => r.aligned === false);
        if (conflicts.length === 0) return;
        
        try {
            for (const { plan, suggestedTradeType } of conflicts) {
                await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
            }
            setAlignmentFilter('Aligned');
            toast(`Aligned ${conflicts.length} plan${conflicts.length > 1 ? 's' : ''} with AI.`, 'success');
        } catch (error) {
            toast(`Could not align some plans: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const handleEditNextConflict = () => {
        const nextConflict = planAlignment.filteredRows.find(r => r.aligned === false) || planAlignment.rows.find(r => r.aligned === false);
        if (!nextConflict) return;
        setSymbolFocus(nextConflict.plan.symbol);
        handleOpenPlanModal(nextConflict.plan);
    };



    const strategyGuides = [
        {
            key: 'core',
            title: 'Build over time',
            when: 'For stocks you trust and want to hold long-term.',
            benefit: 'Buy in stages instead of all at once—reduces timing risk.',
            risk: 'Putting too much in one stock.',
            playbook: 'Create Buy plans at target prices. Use High or Medium priority.'
        },
        {
            key: 'tactical',
            title: 'Stay on track',
            when: 'When your mix has drifted from what you want.',
            benefit: 'Keeps your portfolio balanced without guesswork.',
            risk: 'Trading too often can add costs.',
            playbook: 'Check Plan vs AI alignment. Fix conflicts, then execute when ready.'
        },
        {
            key: 'defensive',
            title: 'Reduce risk',
            when: 'For stocks you want to trim or exit.',
            benefit: 'Locks in gains or limits losses before things get worse.',
            risk: 'Selling too early can miss a rebound.',
            playbook: 'Create Sell plans for stocks in quarantine. Add notes for when to reconsider.'
        },
    ] as const;

    const aiPlanCandidates = useMemo(() => {
        const plannedTrades = data?.plannedTrades ?? [];
        const universe = data?.portfolioUniverse ?? [];
        const plannedSymbols = new Set(plannedTrades.map(p => (p.symbol ?? '').toUpperCase()));
        const seenU = new Set<string>();
        return universe
            .filter((ticker: { ticker?: string; status?: string }) => {
                const k = String(ticker.ticker || '').toUpperCase();
                if (seenU.has(k)) return false;
                seenU.add(k);
                return ['Core', 'High-Upside', 'Quarantine'].includes(String(ticker.status));
            })
            .filter((ticker: { ticker?: string }) => !plannedSymbols.has(String(ticker.ticker || '').toUpperCase()))
            .slice(0, 8)
            .map((ticker: { ticker?: string; name?: string; status?: string; monthly_weight?: number }) => ({
                symbol: String(ticker.ticker || '').toUpperCase(),
                name: ticker.name || ticker.ticker,
                status: ticker.status,
                monthlyWeight: ticker.monthly_weight ?? 0,
                suggestion: ticker.status === 'Quarantine' ? 'sell' as const : 'buy' as const,
            }));
    }, [data?.portfolioUniverse, data?.plannedTrades]);

    const handleCreatePlanFromAi = async (candidate: { symbol: string; name?: string; status?: string; monthlyWeight: number; suggestion: 'buy' | 'sell' }) => {
        trackAction('create-plan-from-ai', 'Investment Plan');
        trackSuggestionFeedback(`ai-candidate-${candidate.symbol}`, 'Investment Plan', true);
        try {
            const plannedTrades = data?.plannedTrades ?? [];
            const existing = plannedTrades.some(plan => (plan.symbol ?? '').toUpperCase() === candidate.symbol.toUpperCase());
            if (existing) {
                setSymbolFocus(candidate.symbol);
                toast(`A plan for ${candidate.symbol} already exists.`, 'info');
                return;
            }

            const priceAnchor = simulatedPrices[candidate.symbol]?.price;
            if (priceAnchor == null || !Number.isFinite(priceAnchor) || priceAnchor <= 0) {
                toast(`No live price for ${candidate.symbol}. Wait for a quote or set the plan manually.`, 'error');
                return;
            }
            const invPlan: any = (data as any)?.investmentPlan;
            const monthlyBudget = Math.max(0, Number(invPlan?.monthlyBudget) || 0);
            const coreAlloc = typeof invPlan?.coreAllocation === 'number' && Number.isFinite(invPlan.coreAllocation) && invPlan.coreAllocation > 0
                ? invPlan.coreAllocation
                : 0.7;
            let amountPlan: number | undefined;
            if (monthlyBudget > 0) {
                const fromTen = monthlyBudget * 0.1;
                const fromSleeve = monthlyBudget * coreAlloc * 0.2;
                amountPlan = Math.round(Math.max(fromTen, fromSleeve, 100));
            }
            const ok = await addPlannedTrade({
                symbol: candidate.symbol,
                name: candidate.name || candidate.symbol,
                tradeType: candidate.suggestion,
                conditionType: 'price',
                targetValue: priceAnchor,
                quantity: undefined,
                amount: amountPlan,
                priority: candidate.status === 'Quarantine' ? 'High' : 'Medium',
                notes: `Created from AI rebalance posture (${candidate.status ?? 'unknown'}).`,
                status: 'Planned',
            });
            if (!ok) return;
            setSymbolFocus(candidate.symbol);
            toast(`Plan created for ${candidate.symbol}.`, 'success');
        } catch (error) {
            toast(`Could not create plan: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const visiblePlans = useMemo(() => {
        const plannedTrades = data?.plannedTrades ?? [];
        if (!symbolFocus) return plannedTrades;
        return plannedTrades.filter(plan => (plan.symbol ?? '').toUpperCase() === symbolFocus.toUpperCase());
    }, [data?.plannedTrades, symbolFocus]);

    const isTriggered = (plan: PlannedTrade) => {
        if (plan.status === 'Executed') return false;
        if (plan.conditionType === 'price') {
            const priceInfo = simulatedPrices[plan.symbol];
            if (!priceInfo) return false;
            return (plan.tradeType === 'buy' && priceInfo.price <= (plan.targetValue ?? 0)) || (plan.tradeType === 'sell' && priceInfo.price >= (plan.targetValue ?? 0));
        }
        if (plan.conditionType === 'date') {
            return new Date().getTime() >= (plan.targetValue ?? 0);
        }
        return false;
    }

    const plannedCount = (data?.plannedTrades ?? []).length;
    const triggeredCount = (data?.plannedTrades ?? []).filter(isTriggered).length;
    const executedCount = (data?.plannedTrades ?? []).filter(p => p.status === 'Executed').length;

    const planBody = (
            <div className="max-w-7xl mx-auto space-y-14 sm:space-y-16">
                {embedded ? (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 sm:px-5">
                        <p className="text-sm font-medium text-slate-900">Scheduled buy and sell rules</p>
                        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                            {PAGE_INTROS['Investment Plan']?.description ?? 'Pick a stock, set a price or date, and we’ll tell you when it’s time to act.'}{' '}
                            <span className="text-slate-500">Tip: use “Create plan” or add from the AI list below.</span>
                        </p>
                    </div>
                ) : (
                    <PageIntro
                        title={PAGE_INTROS['Investment Plan']?.title ?? 'Plan your trades ahead of time'}
                        description={PAGE_INTROS['Investment Plan']?.description ?? 'Set buy or sell plans that trigger when a price or date is reached. The system suggests ideas and checks them against AI recommendations.'}
                        tip="Start with “Create plan” or pick a suggestion from the AI list below. You stay in control—we only prepare the trade when your rule is met."
                    />
                )}
                <InvestmentPlanControlTower />
                {/* Single clear action row — avoids duplicate page titles */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-6 shadow-sm">
                    <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
                        <span className="font-semibold text-slate-800">What you do here: </span>
                        Save instructions like “buy when price drops to X” or “sell after this date.” Finova tracks them and shows what stage each plan is in.
                    </p>
                    <button 
                        type="button"
                        onClick={() => handleOpenPlanModal(null)} 
                        className="inline-flex shrink-0 items-center justify-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 text-base font-semibold shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-safe:transition-colors"
                    >
                        <PlusIcon className="h-5 w-5" aria-hidden />
                        Create plan
                    </button>
                </div>

                {/* What to do next — dynamic guidance */}
                {(() => {
                    const plans = data?.plannedTrades ?? [];
                    const triggered = plans.filter(isTriggered);
                    const conflicts = planAlignment.conflictCount;
                    const untracked = planAlignment.untrackedCount;
                    if (plans.length === 0) {
                        return (
                            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-6">
                                <p className="font-semibold text-indigo-900">Your next step</p>
                                <p className="mt-1 text-indigo-800">Create your first plan, or add one from the AI candidates below. Both options pre-fill details for you.</p>
                            </div>
                        );
                    }
                    if (conflicts > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-6">
                                <p className="font-semibold text-amber-900">Resolve conflicts</p>
                                <p className="mt-1 text-amber-800">{conflicts} plan{conflicts > 1 ? 's' : ''} differ from AI recommendations. Use &quot;Align with AI&quot; or &quot;Align All Conflicts&quot; to sync.</p>
                            </div>
                        );
                    }
                    if (triggered.length > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6">
                                <p className="font-semibold text-emerald-900">Ready to act</p>
                                <p className="mt-1 text-emerald-800">{triggered.length} plan{triggered.length > 1 ? 's' : ''} met their conditions. Use the rocket icon to record each trade in Investments.</p>
                            </div>
                        );
                    }
                    if (untracked > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-gray-50 p-6">
                                <p className="font-semibold text-slate-900">Map untracked symbols</p>
                                <p className="mt-1 text-slate-700">{untracked} plan{untracked > 1 ? 's' : ''} use symbols not in your universe. Add them for AI alignment.</p>
                            </div>
                        );
                    }
                    return (
                        <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6">
                            <p className="font-semibold text-emerald-900">All aligned</p>
                            <p className="mt-1 text-emerald-800">Your plans match AI recommendations. When conditions are met, use the rocket icon to record trades.</p>
                        </div>
                    );
                })()}

                {/* Plan journey — aligned grid, plain-language labels */}
                <section className="space-y-6" aria-labelledby="plan-pipeline-heading">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between gap-y-2">
                        <div>
                            <h2 id="plan-pipeline-heading" className="text-lg font-semibold tracking-tight text-slate-900">Your plan journey</h2>
                            <p className="text-sm text-slate-600 max-w-xl">Each plan moves through three stages. The numbers below update automatically—no spreadsheet required.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-5 items-stretch">
                        <article className="flex h-full min-h-[168px] flex-col rounded-2xl border border-blue-200/80 bg-gradient-to-b from-blue-50/90 to-white p-5 shadow-sm ring-1 ring-blue-100/80">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white" aria-hidden>1</span>
                                <ClipboardDocumentListIcon className="h-8 w-8 text-blue-500 shrink-0" aria-hidden />
                            </div>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-blue-800">Saved</p>
                            <p className="mt-1 text-3xl font-bold tabular-nums text-blue-950">{plannedCount}</p>
                            <p className="mt-auto pt-3 text-sm leading-snug text-blue-900/90">Plans you’ve written down and we’re watching.</p>
                        </article>
                        <article className="flex h-full min-h-[168px] flex-col rounded-2xl border border-amber-200/80 bg-gradient-to-b from-amber-50/90 to-white p-5 shadow-sm ring-1 ring-amber-100/80">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white" aria-hidden>2</span>
                                <ClockIcon className="h-8 w-8 text-amber-600 shrink-0" aria-hidden />
                            </div>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-amber-900">Ready</p>
                            <p className="mt-1 text-3xl font-bold tabular-nums text-amber-950">{triggeredCount}</p>
                            <p className="mt-auto pt-3 text-sm leading-snug text-amber-900/90">Your price or date was hit—time to review and record the trade.</p>
                        </article>
                        <article className="flex h-full min-h-[168px] flex-col rounded-2xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 to-white p-5 shadow-sm ring-1 ring-emerald-100/80">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white" aria-hidden>3</span>
                                <CheckCircleIcon className="h-8 w-8 text-emerald-600 shrink-0" aria-hidden />
                            </div>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-emerald-900">Done</p>
                            <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-950">{executedCount}</p>
                            <p className="mt-auto pt-3 text-sm leading-snug text-emerald-900/90">Trades you’ve already logged in your portfolio.</p>
                        </article>
                    </div>
                </section>

                {/* Enhanced Household Stress Indicator */}
                {householdStress && (
                    <div className={`rounded-3xl border-2 p-8 shadow-xl backdrop-blur-sm ${
                        householdStress.level === 'low' 
                            ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/90 to-emerald-100/70'
                            : householdStress.level === 'medium'
                            ? 'border-amber-300 bg-gradient-to-br from-amber-50/90 to-amber-100/70'
                            : 'border-rose-300 bg-gradient-to-br from-rose-50/90 to-rose-100/70'
                    }`}>
                        <div className="flex items-start gap-6">
                            <div className={`rounded-2xl p-4 shadow-lg ${
                                householdStress.level === 'low' 
                                    ? 'bg-emerald-100'
                                    : householdStress.level === 'medium'
                                    ? 'bg-amber-100'
                                    : 'bg-rose-100'
                            }`}>
                                <ExclamationTriangleIcon className={`h-8 w-8 ${
                                    householdStress.level === 'low' 
                                        ? 'text-emerald-600'
                                        : householdStress.level === 'medium'
                                        ? 'text-amber-600'
                                        : 'text-rose-600'
                                }`} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-2xl font-bold text-slate-900 mb-2">
                                    Household Cashflow Stress: <span className={`uppercase tracking-wider ${
                                        householdStress.level === 'low' 
                                            ? 'text-emerald-700'
                                            : householdStress.level === 'medium'
                                            ? 'text-amber-700'
                                            : 'text-rose-700'
                                    }`}>{householdStress.level}</span>
                                </h3>
                                <p className="text-lg text-slate-700 leading-relaxed">{householdStress.summary}</p>
                                <div className="mt-4 flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full animate-pulse ${
                                        householdStress.level === 'low' 
                                            ? 'bg-emerald-500'
                                            : householdStress.level === 'medium'
                                            ? 'bg-amber-500'
                                            : 'bg-rose-500'
                                    }`}></div>
                                    <span className="text-sm font-medium text-slate-600">Real-time analysis</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* How It Works — plain language for non-financial users */}
                <CollapsibleSection title="How it works" summary="Plan now, act when ready" className="overflow-hidden" defaultExpanded={false}>
                    <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl p-8 border border-blue-100">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                                <LightBulbIcon className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900">Plan now, act when ready</h3>
                                <p className="text-slate-600 mt-1">Set your conditions. The system tells you when it&apos;s time to buy or sell.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-red-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">High</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Act first when the condition is met. Use for ideas you don&apos;t want to miss.</p>
                            </div>
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-amber-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">Medium</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Normal pace. Execute when conditions are met and you&apos;re ready.</p>
                            </div>
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-blue-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">Low</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Can wait. Good for ideas you might skip if things get busy.</p>
                            </div>
                        </div>
                        <div className="mt-8 p-6 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-2xl border border-indigo-200">
                            <p className="text-slate-800 font-semibold mb-2">Simple workflow:</p>
                            <p className="text-slate-700 leading-relaxed">
                                Create plans (or add from AI suggestions). Check alignment—if a plan conflicts with AI, use &quot;Align with AI&quot; to sync. When a plan shows &quot;Triggered&quot;, click the rocket to record the trade in Investments.
                            </p>
                        </div>
                    </div>
                </CollapsibleSection>

                {/* Enhanced Strategy Guides */}
                <CollapsibleSection title="Strategy Guides" summary="Core, Tactical, Defensive playbooks" className="overflow-hidden" defaultExpanded={false}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {strategyGuides.map((guide) => (
                            <div key={guide.key} className="bg-gradient-to-br from-white to-slate-50 border-2 border-slate-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                                <div className="relative">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className={`rounded-2xl p-3 shadow-lg ${
                                            guide.key === 'core' ? 'bg-gradient-to-br from-blue-100 to-blue-200' :
                                            guide.key === 'tactical' ? 'bg-gradient-to-br from-purple-100 to-purple-200' :
                                            'bg-gradient-to-br from-green-100 to-green-200'
                                        }`}>
                                            {guide.key === 'core' && <TargetIcon className="h-7 w-7 text-blue-700" />}
                                            {guide.key === 'tactical' && <ChartBarIcon className="h-7 w-7 text-purple-700" />}
                                            {guide.key === 'defensive' && <SparklesIcon className="h-7 w-7 text-green-700" />}
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-900">{guide.title}</h3>
                                            <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mt-2 ${
                                                guide.key === 'core' ? 'bg-blue-100 text-blue-800' :
                                                guide.key === 'tactical' ? 'bg-purple-100 text-purple-800' :
                                                'bg-green-100 text-green-800'
                                            }`}>
                                                {guide.key === 'core' ? 'Core' : guide.key === 'tactical' ? 'Tactical' : 'Defensive'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-slate-700 mb-1">When to use:</p>
                                            <p className="text-sm text-slate-600 leading-relaxed">{guide.when}</p>
                                        </div>
                                        <div className="bg-emerald-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-emerald-700 mb-1">Benefit:</p>
                                            <p className="text-sm text-emerald-600 leading-relaxed">{guide.benefit}</p>
                                        </div>
                                        <div className="bg-rose-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-rose-700 mb-1">Risk:</p>
                                            <p className="text-sm text-rose-600 leading-relaxed">{guide.risk}</p>
                                        </div>
                                        <div className="bg-indigo-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-indigo-700 mb-1">Playbook:</p>
                                            <p className="text-sm text-indigo-600 leading-relaxed">{guide.playbook}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </CollapsibleSection>

                {/* AI: universe posture → optional trade plan (collapsed by default) */}
                <SectionCard
                    title="AI rebalance candidates"
                    className="overflow-hidden"
                    collapsible
                    collapsibleSummary="Universe symbols without a trade plan yet"
                    defaultExpanded={false}
                    infoHint="These rows come from your Portfolio Universe (Core, High-Upside, Quarantine). For each symbol you have not scheduled a trade plan yet, we suggest a buy or sell direction from that status. “Create plan” adds a price rule you can edit—nothing executes until you record a trade."
                >
                    <p className="text-sm text-slate-600 mb-4 max-w-3xl leading-relaxed">
                        <span className="font-medium text-slate-800">What this is for:</span> turn universe posture into a concrete rule (e.g. accumulate while Core, or trim while Quarantine).
                        Use <strong className="font-semibold">Create plan</strong> to pre-fill a trigger from live price; you still confirm size and timing in the editor.
                    </p>
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                        {aiPlanCandidates.map((candidate) => (
                            <div
                                key={candidate.symbol}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 hover:border-slate-300 transition-colors"
                            >
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-700">
                                        {candidate.symbol.slice(0, 2)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-900">{candidate.symbol}</div>
                                        <div className="text-sm text-slate-600 truncate">{candidate.name}</div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                                                {candidate.status}
                                            </span>
                                            <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                                Suggested: {candidate.suggestion === 'buy' ? 'Buy' : 'Sell'}
                                            </span>
                                            <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600" title="This row’s monthly_weight from Portfolio Universe (can match other names after an equal auto-split)">
                                                Universe row wt {(candidate.monthlyWeight * 100).toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleCreatePlanFromAi(candidate)}
                                    className="shrink-0 w-full sm:w-auto rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 whitespace-nowrap"
                                >
                                    Create plan
                                </button>
                            </div>
                        ))}
                        {aiPlanCandidates.length === 0 && (
                            <EmptyState
                                icon={<SparklesIcon className="w-12 h-12" />}
                                title={EMPTY_STATE_MESSAGES.noAiCandidates.title}
                                description={EMPTY_STATE_MESSAGES.noAiCandidates.description}
                            />
                        )}
                    </div>
                </SectionCard>

                {/* Enhanced Plan vs AI Alignment */}
                <SectionCard title="Do your plans match AI?" className="overflow-hidden" collapsible collapsibleSummary="Same direction or different" defaultExpanded>
                    <div className="flex flex-col gap-4 mb-5">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                                <ChartBarIcon className="h-5 w-5 text-indigo-700" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900">Quick comparison</h3>
                                <p className="text-sm text-slate-600">Each plan is checked against AI universe posture (Core / High-Upside / Quarantine) so direction stays consistent.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Aligned: {planAlignment.alignedCount}</div>
                            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">Conflicts: {planAlignment.conflictCount}</div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">Needs mapping: {planAlignment.untrackedCount}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={handleEditNextConflict}
                                disabled={planAlignment.conflictCount === 0}
                                className="px-4 py-2 text-sm font-semibold border border-slate-300 text-slate-700 rounded-lg hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Edit next conflict
                            </button>
                            <button
                                type="button"
                                onClick={handleAlignAllConflicts}
                                disabled={planAlignment.conflictCount === 0}
                                className="px-4 py-2 text-sm font-semibold border border-emerald-300 text-emerald-700 rounded-lg hover:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Align all conflicts
                            </button>
                        </div>
                        {planValidationWarnings.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                <p className="text-xs font-semibold text-amber-800 mb-1">Validation checks</p>
                                <ul className="text-xs text-amber-900 list-disc list-inside space-y-0.5">
                                    {planValidationWarnings.slice(0, 5).map((w, i) => <li key={`pv-${i}`}>{w}</li>)}
                                </ul>
                            </div>
                        )}
                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <p className="text-xs font-semibold text-indigo-900">AI alignment summary</p>
                                <button
                                    type="button"
                                    onClick={() => void handleTranslateAlignmentToArabic()}
                                    disabled={isTranslatingAlignment}
                                    className="px-2.5 py-1 text-xs font-semibold border border-indigo-300 text-indigo-800 rounded-md hover:border-indigo-500 disabled:opacity-60"
                                >
                                    {isTranslatingAlignment ? 'Translating…' : 'العربية'}
                                </button>
                            </div>
                            <p className="text-xs text-indigo-900">{alignmentSummaryAr || alignmentSummaryEn}</p>
                            {alignmentSummaryArError && <p className="text-xs text-rose-700 mt-1">{alignmentSummaryArError}</p>}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-5">
                        {(['All', 'Aligned', 'Conflict', 'Needs mapping'] as const).map((filter) => (
                            <button
                                key={filter}
                                type="button"
                                onClick={() => setAlignmentFilter(filter)}
                                className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-full border transition-colors ${
                                    alignmentFilter === filter
                                        ? 'bg-primary text-white border-primary'
                                        : 'bg-white text-slate-700 border-slate-300 hover:border-primary hover:text-primary'
                                }`}
                            >
                                {filter}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                        {planAlignment.filteredRows.map(({ plan, universeStatus, recommendation, aligned, reason, suggestedTradeType, aiNudge }) => (
                            <div
                                key={`align-${plan.id}`}
                                className={`rounded-xl border p-4 ${
                                    aligned === true
                                        ? 'border-emerald-200 bg-emerald-50/40'
                                        : aligned === false
                                        ? 'border-rose-200 bg-rose-50/40'
                                        : 'border-slate-200 bg-slate-50/40'
                                }`}
                            >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <span className="font-semibold text-slate-900">{plan.symbol ?? '—'}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${plan.tradeType === 'buy' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200'}`}>
                                                {plan.tradeType.toUpperCase()}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                                aligned === true ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                                aligned === false ? 'bg-rose-100 text-rose-800 border-rose-200' :
                                                'bg-slate-100 text-slate-700 border-slate-200'
                                            }`}>
                                                {aligned === true ? 'Aligned' : aligned === false ? 'Conflict' : 'Needs mapping'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-700">
                                            <span className="font-medium">Universe:</span> {universeStatus} · {recommendation}
                                        </p>
                                        <p className="text-sm text-slate-600 mt-1">{reason}</p>
                                        <p className="text-xs text-indigo-700 mt-2">AI nudge: {aiNudge}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                        <button
                                            type="button"
                                            onClick={() => setSymbolFocus(plan.symbol)}
                                            className="px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 rounded-lg hover:border-primary hover:text-primary"
                                        >
                                            Focus
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenPlanModal(plan)}
                                            className="px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 rounded-lg hover:border-primary hover:text-primary"
                                        >
                                            Edit
                                        </button>
                                        {aligned === false && (
                                            <button
                                                type="button"
                                                onClick={() => handleAlignWithAi(plan, suggestedTradeType)}
                                                title="Change this plan to match the AI recommendation"
                                                className="px-3 py-1.5 text-xs font-semibold border border-emerald-300 text-emerald-700 rounded-lg hover:border-emerald-500"
                                            >
                                                Align with AI
                                            </button>
                                        )}
                                        {aligned === null && (
                                            <button
                                                type="button"
                                                onClick={() => handleAddToUniverse(plan)}
                                                title="Add this symbol to your portfolio so AI can track and recommend it"
                                                className="px-3 py-1.5 text-xs font-semibold border border-indigo-300 text-indigo-700 rounded-lg hover:border-indigo-500"
                                            >
                                                Add to universe
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {planAlignment.filteredRows.length === 0 && (
                            <EmptyState
                                icon={<ChartBarIcon className="w-12 h-12" />}
                                title={(data?.plannedTrades ?? []).length === 0 ? EMPTY_STATE_MESSAGES.noPlannedTrades.title : 'No plans match this filter'}
                                description={(data?.plannedTrades ?? []).length === 0
                                    ? 'Add at least one plan (button above), then come back here to see if it lines up with AI suggestions.'
                                    : 'Try another filter or clear filters to see all plans.'}
                                action={(data?.plannedTrades ?? []).length === 0 ? { label: EMPTY_STATE_MESSAGES.noPlannedTrades.action ?? 'Create your first plan', onClick: () => handleOpenPlanModal(null) } : undefined}
                            />
                        )}
                    </div>
                </SectionCard>

                {/* Enhanced Symbol Focus Indicator */}
                {symbolFocus && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <TargetIcon className="h-5 w-5 text-blue-700" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-blue-900">Focused symbol: {symbolFocus.toUpperCase()}</p>
                                    <p className="text-xs text-blue-700">Showing plans and actions for this ticker.</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSymbolFocus('')}
                                className="px-3 py-1.5 text-xs font-semibold border border-blue-300 text-blue-700 rounded-lg hover:border-blue-500 hover:bg-blue-100"
                            >
                                Clear Focus
                            </button>
                        </div>
                    </div>
                )}

                {/* Plans Table */}
                <SectionCard title="All your plans" className="min-h-0" collapsible collapsibleSummary="Edit or record trades" defaultExpanded>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-xs font-semibold text-slate-600">
                                    <th className="px-3 sm:px-6 py-3.5">Stock</th>
                                    <th className="px-3 sm:px-6 py-3.5">Buy or sell</th>
                                    <th className="px-3 sm:px-6 py-3.5" title="Date trigger, or per-share trigger in the stock’s traded currency">Trigger</th>
                                    <th className="px-3 sm:px-6 py-3.5" title="Whether today’s price lines up with your plan">Hint</th>
                                    <th className="px-3 sm:px-6 py-3.5" title="How soon you want to act if the rule is met">Urgency</th>
                                    <th className="px-3 sm:px-6 py-3.5">Stage</th>
                                    <th className="px-3 sm:px-6 py-3.5">Next step</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {visiblePlans.map(plan => (
                                    <tr key={plan.id} className={`${isTriggered(plan) ? 'bg-yellow-50' : ''} hover:bg-gray-50 transition-colors`}>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                                            <div>
                                                <div className="font-medium text-gray-900">{plan.symbol ?? '—'}</div>
                                                <div className="text-sm text-gray-500">{plan.name}</div>
                                            </div>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                                            <span className={`font-semibold ${plan.tradeType === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                                                {plan.tradeType.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4 align-top">{renderCondition(plan)}</td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                                            <span
                                                className={`px-3 py-1 inline-flex text-xs font-semibold rounded-full ${getPriceSignalClass(plan)}`}
                                                title={plan.tradeType === 'buy'
                                                    ? 'For buy plans: Favorable means current price is at/below trigger; Above trigger means current price is still above your buy trigger.'
                                                    : 'For sell plans: Favorable means current price is at/above trigger; Below plan means current price has not reached your sell trigger yet.'}
                                            >
                                                {getPriceSignalLabel(plan)}
                                            </span>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${priorityClass(plan.priority)}`}>
                                                {plan.priority}
                                            </span>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                                            {plan.status === 'Executed' ? (
                                                <span className="flex items-center gap-1 text-green-600 font-semibold">
                                                    <CheckCircleIcon className="h-4 w-4"/>Executed
                                                </span>
                                            ) : isTriggered(plan) ? (
                                                <span className="flex items-center gap-1 text-yellow-600 font-semibold">
                                                    <ExclamationTriangleIcon className="h-4 w-4"/>Triggered
                                                </span>
                                            ) : (
                                                <span className="text-gray-600">Planned</span>
                                            )}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    type="button"
                                                    onClick={() => (triggerPageAction ? handleExecutePlan(plan) : onExecutePlan(plan))} 
                                                    disabled={plan.status === 'Executed'} 
                                                    title="Open record trade and log this in your portfolio" 
                                                    aria-label="Record trade in portfolio"
                                                    className="p-2 text-white bg-gradient-to-r from-primary to-secondary rounded-lg hover:from-primary/90 hover:to-secondary/90 disabled:from-gray-300 disabled:to-gray-400 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                                >
                                                    <RocketLaunchIcon className="h-4 w-4" aria-hidden />
                                                </button>
                                                <button 
                                                    onClick={() => handleOpenPlanModal(plan)} 
                                                    className="p-2 text-gray-500 hover:text-primary transition-colors"
                                                    title="Edit Plan"
                                                >
                                                    <PencilIcon className="h-4 w-4"/>
                                                </button>
                                                <button 
                                                    onClick={() => setPlanToDelete(plan)} 
                                                    className="p-2 text-gray-500 hover:text-danger transition-colors"
                                                    title="Delete Plan"
                                                >
                                                    <TrashIcon className="h-4 w-4"/>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {visiblePlans.length === 0 && (
                            <EmptyState
                                icon={<ClipboardDocumentListIcon className="w-12 h-12" />}
                                title={EMPTY_STATE_MESSAGES.noPlannedTrades.title}
                                description={symbolFocus ? 'No plans for this symbol. Clear focus or create one.' : EMPTY_STATE_MESSAGES.noPlannedTrades.description}
                                action={symbolFocus ? undefined : { label: EMPTY_STATE_MESSAGES.noPlannedTrades.action ?? 'Create plan', onClick: () => handleOpenPlanModal(null) }}
                            />
                        )}
                    </div>
                </SectionCard>
            </div>
    );

    const modals = (
        <>
            <PlanTradeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                planToEdit={planToEdit}
                universe={data?.portfolioUniverse ?? []}
                simulatedPrices={simulatedPrices}
                monthlyBudget={data?.investmentPlan?.monthlyBudget}
                coreAllocation={data?.investmentPlan?.coreAllocation}
                budgetCurrency={(data?.investmentPlan?.budgetCurrency as TradeCurrency) || 'SAR'}
                newPlanFieldInjection={stagedAddOnPlanned
                    ? {
                          key: stagedAddOnPlanned.key,
                          symbol: stagedAddOnPlanned.symbol,
                          name: stagedAddOnPlanned.name,
                          targetPrice: stagedAddOnPlanned.targetPrice,
                          amount: stagedAddOnPlanned.amount,
                          quantity: stagedAddOnPlanned.quantity,
                          tradeType: stagedAddOnPlanned.tradeType,
                          notes: stagedAddOnPlanned.notes,
                      }
                    : null}
                onNewPlanFieldInjectionConsumed={onStagedAddOnPlannedHandled}
            />
            <DeleteConfirmationModal 
                isOpen={!!planToDelete} 
                onClose={() => setPlanToDelete(null)} 
                onConfirm={() => { 
                    if(planToDelete) deletePlannedTrade(planToDelete.id); 
                    setPlanToDelete(null); 
                }} 
                itemName={planToDelete?.name || ''} 
            />
        </>
    );

    if (embedded) {
        return (
            <>
                {planBody}
                {modals}
            </>
        );
    }

    return (
        <PageLayout 
            title="Trade plans" 
            description="Schedule future buys or sells. We notify you when your price or date is reached, then you confirm the trade in one tap."
        >
            {planBody}
            {modals}
        </PageLayout>
    );
};

export default InvestmentPlanView;
