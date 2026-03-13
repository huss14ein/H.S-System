import React, { useState, useMemo, useContext, useEffect, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import Modal from '../components/Modal';
import { ZakatPayment, Page } from '../types';
import ProgressBar from '../components/ProgressBar';
import InfoHint from '../components/InfoHint';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';
import { buildZakatTradeAdvice } from '../services/zakatTradeAdvisor';
import { ArrowDownTrayIcon } from '../components/icons/ArrowDownTrayIcon';

const ZakatPaymentModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => void }> = ({ isOpen, onClose, onSave }) => {
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const rawAmount = Number(amount) || 0;
        if (!Number.isFinite(rawAmount) || rawAmount < 0) {
            alert('Please enter a valid payment amount greater than or equal to 0.');
            return;
        }
        onSave({ amount: rawAmount, date, notes });
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setNotes('');
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record Zakat Payment">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="zakat-amount" className="block text-sm font-medium text-gray-700">Amount Paid</label>
                    <input type="number" id="zakat-amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="input-base mt-1" />
                </div>
                 <div>
                    <label htmlFor="zakat-date" className="block text-sm font-medium text-gray-700">Date</label>
                    <input type="date" id="zakat-date" value={date} onChange={e => setDate(e.target.value)} required className="input-base mt-1" />
                </div>
                 <div>
                    <label htmlFor="zakat-notes" className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                    <input type="text" id="zakat-notes" value={notes} onChange={e => setNotes(e.target.value)} className="input-base mt-1" />
                </div>
                <button type="submit" className="w-full btn-primary">Record Payment</button>
            </form>
        </Modal>
    );
};


const Zakat: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading, addZakatPayment, updateSettings } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    
    const defaultGold = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
    const defaultNisab = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
    const [localGoldPrice, setLocalGoldPrice] = useState(String(defaultGold));
    const [useNisabAmount, setUseNisabAmount] = useState(!!defaultNisab);
    const [localNisabAmount, setLocalNisabAmount] = useState(String(defaultNisab ?? (275 * 85)));
    const [otherDebts, setOtherDebts] = useState(0);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    
    useEffect(() => {
        const g = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
        setLocalGoldPrice(String(g));
        const nisabVal = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
        if (nisabVal != null) {
            setUseNisabAmount(true);
            setLocalNisabAmount(String(nisabVal));
        }
    }, [data?.settings]);

    const goldPrice = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
    const nisabAmountSetting = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
    // Use local form values for immediate feedback; fallback to saved settings so nisab actually affects calculation
    const nisab = useMemo(() => {
        if (useNisabAmount) {
            const local = Number(localNisabAmount) || 0;
            if (Number.isFinite(local) && local > 0) return local;
            if (nisabAmountSetting != null) {
                const setting = Number(nisabAmountSetting);
                if (Number.isFinite(setting) && setting > 0) return setting;
            }
        }
        const localGold = Number(localGoldPrice) || 0;
        const effectiveGold = Number.isFinite(localGold) && localGold > 0 ? localGold : (Number.isFinite(goldPrice) && goldPrice > 0 ? goldPrice : 275);
        const calculated = effectiveGold * 85;
        return Number.isFinite(calculated) ? Math.max(0, calculated) : 0;
    }, [useNisabAmount, localNisabAmount, nisabAmountSetting, localGoldPrice, goldPrice]);

    const zakatableAssets = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const investments = data?.investments ?? [];
        const commodityHoldings = data?.commodityHoldings ?? [];
        const cash = accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => {
            const balance = Math.max(0, Number(acc.balance) || 0);
            return sum + (Number.isFinite(balance) ? balance : 0);
        }, 0);
        const invValue = investments
            .flatMap(p => (p.holdings || []).map(h => ({ ...h, portfolioCurrency: p.currency })))
            .filter(h => h.zakahClass === 'Zakatable')
            .reduce((sum, h) => {
                const value = toSAR(h.currentValue, h.portfolioCurrency, exchangeRate);
                return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
            }, 0);
        const commodities = commodityHoldings.filter(c => c.zakahClass === 'Zakatable').reduce((sum, c) => {
            const value = Math.max(0, Number(c.currentValue) || 0);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        const total = cash + invValue + commodities;
        return { cash, investments: invValue, commodities, total };
    }, [data?.accounts, data?.investments, data?.commodityHoldings, exchangeRate]);

    const deductibleLiabilities = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const liabilities = data?.liabilities ?? [];
        const shortTermDebts = accounts.filter(a => a.type === 'Credit').reduce((sum, acc) => {
            const balance = Number(acc.balance) || 0;
            if (balance < 0 && Number.isFinite(balance)) {
                return sum + Math.abs(balance);
            }
            return sum;
        }, 0);
        // Only debts (amount < 0) are deductible; receivables (amount > 0) are assets and must not reduce zakatable wealth
        const trackedLiabilities = liabilities.filter(l => l.status === 'Active').reduce((sum, liability) => {
            const amount = Number(liability.amount) || 0;
            if (amount < 0 && Number.isFinite(amount)) {
                return sum + Math.abs(amount);
            }
            return sum;
        }, 0);
        const safeOtherDebts = Math.max(0, Number.isFinite(otherDebts) ? otherDebts : 0);
        const total = shortTermDebts + trackedLiabilities + safeOtherDebts;
        return { shortTermDebts, trackedLiabilities, otherDebts: safeOtherDebts, total };
    }, [otherDebts, data?.accounts, data?.liabilities]);
    
    const netZakatableWealth = useMemo(() => Math.max(0, zakatableAssets.total - deductibleLiabilities.total), [zakatableAssets, deductibleLiabilities]);
    const isNisabMet = useMemo(() => netZakatableWealth >= nisab, [netZakatableWealth, nisab]);
    const zakatDue = useMemo(() => isNisabMet ? netZakatableWealth * 0.025 : 0, [isNisabMet, netZakatableWealth]);
    const totalPaid = useMemo(() => (data?.zakatPayments ?? []).reduce((sum, p) => {
        const amount = Math.max(0, Number(p.amount) || 0);
        return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0), [data?.zakatPayments]);
    const outstandingZakat = useMemo(() => zakatDue - totalPaid, [zakatDue, totalPaid]);

    const zakatAdvice = useMemo(
        () => buildZakatTradeAdvice(data),
        [data]
    );

    const handleExportZakat = useCallback(() => {
        try {
            const exportData = {
                summary: {
                    zakatableAssets: {
                        cash: zakatableAssets.cash,
                        investments: zakatableAssets.investments,
                        commodities: zakatableAssets.commodities,
                        total: zakatableAssets.total,
                    },
                    deductibleLiabilities: {
                        shortTermDebts: deductibleLiabilities.shortTermDebts,
                        trackedLiabilities: deductibleLiabilities.trackedLiabilities,
                        otherDebts: deductibleLiabilities.otherDebts,
                        total: deductibleLiabilities.total,
                    },
                    netZakatableWealth,
                    nisab,
                    isNisabMet,
                    zakatDue,
                    totalPaid,
                    outstandingZakat,
                },
                settings: {
                    goldPrice: Number.isFinite(goldPrice) ? goldPrice : 275,
                    useNisabAmount,
                    nisabAmount: useNisabAmount ? (Number.isFinite(Number(localNisabAmount)) ? Number(localNisabAmount) : null) : null,
                },
                payments: (data?.zakatPayments ?? []).map(p => ({
                    id: p.id,
                    amount: p.amount,
                    date: p.date,
                    notes: p.notes,
                })),
                suggestions: zakatAdvice.suggestions.map(s => ({
                    symbol: s.symbol,
                    impactDescription: s.impactDescription,
                })),
                exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zakat-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting zakat data:', error);
            alert('Failed to export zakat data. Please try again.');
        }
    }, [zakatableAssets, deductibleLiabilities, netZakatableWealth, nisab, isNisabMet, zakatDue, totalPaid, outstandingZakat, goldPrice, useNisabAmount, localNisabAmount, data?.zakatPayments, zakatAdvice]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Zakat Calculator"
            description="Estimate your annual Zakat based on your tracked assets and liabilities."
            action={
                <button type="button" onClick={handleExportZakat} className="btn-ghost flex items-center gap-2" title="Export zakat data">
                    <ArrowDownTrayIcon className="h-5 w-5" />
                    Export
                </button>
            }
        >
            <div className="alert-warning max-w-3xl mb-6">
                <div className="flex">
                    <div className="py-1"><InformationCircleIcon className="h-5 w-5 text-amber-500 mr-3 flex-shrink-0"/></div>
                    <div>
                        <p className="font-bold">Disclaimer:</p>
                        <p>This calculator provides an estimation for educational purposes only. Please consult a qualified religious scholar for accurate guidance.</p>
                    </div>
                </div>
            </div>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3 items-start">
                <div className="space-y-6">
                    <SectionCard title="Zakatable Assets">
                         <div className="space-y-3">
                            <div className="flex justify-between text-sm pt-2">
                               <span className="text-gray-600 flex items-center"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Cash</span>
                               <span>{formatCurrencyString(zakatableAssets.cash)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600 flex items-center"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Investments</span>
                                <span>{formatCurrencyString(zakatableAssets.investments)}</span>
                            </div>
                             <div className="flex justify-between text-sm">
                                <span className="text-gray-600 flex items-center"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Commodities</span>
                                <span>{formatCurrencyString(zakatableAssets.commodities)}</span>
                            </div>
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Assets</span><span>{formatCurrencyString(zakatableAssets.total)}</span></div>
                             <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded-md mt-2">
                                <p>Includes cash, 'Zakatable' investments, and 'Zakatable' commodities. You can change an asset's Zakat classification on the 'Investments' and 'Commodities' pages.</p>
                            </div>
                        </div>
                    </SectionCard>
                    <SectionCard title="Deductible Liabilities">
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Credit Card Debt</span><span>{formatCurrencyString(deductibleLiabilities.shortTermDebts)}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Tracked Liabilities (Active)</span><span>{formatCurrencyString(deductibleLiabilities.trackedLiabilities)}</span></div>
                            <div>
                                <label htmlFor="other-debts" className="block text-sm font-medium text-gray-700">Other Short-Term Debts</label>
                                <input type="number" id="other-debts" value={otherDebts} onChange={e => {
                                    const value = Number(e.target.value) || 0;
                                    setOtherDebts(Number.isFinite(value) ? Math.max(0, value) : 0);
                                }} placeholder="Enter value" className="input-base mt-1" min="0" step="0.01" />
                            </div>
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Liabilities</span><span>{formatCurrencyString(deductibleLiabilities.total)}</span></div>
                        </div>
                    </SectionCard>
                </div>

                <SectionCard title="Calculation" className="space-y-4">
                     <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="use-nisab-amount" checked={useNisabAmount} onChange={(e) => { const checked = e.target.checked; setUseNisabAmount(checked); if (!checked) updateSettings({ nisabAmount: undefined }); }} className="h-4 w-4 text-primary rounded border-gray-300" />
                            <label htmlFor="use-nisab-amount" className="text-sm font-medium text-gray-700">Set Nisab amount directly (instead of gold price)</label>
                        </div>
                        {useNisabAmount ? (
                            <div>
                                <label htmlFor="nisab-amount" className="block text-sm font-medium text-gray-700 flex items-center">Nisab amount <InfoHint text="Minimum wealth threshold in your currency. If your net zakatable wealth is below this, you do not owe Zakat. Can be set directly (e.g. from local authority) instead of using gold price × 85 grams." /></label>
                                <input type="number" id="nisab-amount" value={localNisabAmount} onChange={(e) => setLocalNisabAmount(e.target.value)} onBlur={() => { 
                                    const v = Number(localNisabAmount) || 0;
                                    if (Number.isFinite(v) && v > 0) updateSettings({ nisabAmount: v }); 
                                }} className="input-base mt-1" min="0" step="1" />
                            </div>
                        ) : (
                            <div>
                                <label htmlFor="gold-price" className="block text-sm font-medium text-gray-700 flex items-center">Price of Gold (per gram) <InfoHint text="Used to compute the Nisab threshold: Nisab = price × 85 grams. If your net zakatable wealth is below that value, you do not owe Zakat." /></label>
                                <input type="number" id="gold-price" value={localGoldPrice} onChange={(e) => setLocalGoldPrice(e.target.value)} onBlur={() => { 
                                    const v = Number(localGoldPrice) || 275;
                                    if (Number.isFinite(v) && v > 0) updateSettings({ goldPrice: v }); 
                                }} className="input-base mt-1" min="0" step="0.01" />
                            </div>
                        )}
                    </div>
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Nisab Threshold</span><span className="font-medium text-dark">{formatCurrencyString(nisab)}</span></div>
                    <hr/>
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Total Zakatable Assets</span><span className="font-medium text-dark">{formatCurrencyString(zakatableAssets.total)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Deductible Liabilities</span><span className="font-medium text-dark">-{formatCurrencyString(deductibleLiabilities.total)}</span></div>
                    <div className="flex justify-between text-base font-semibold p-2 bg-gray-100 rounded-md"><span className="text-gray-800">Net Zakatable Wealth</span><span className="text-dark">{formatCurrencyString(netZakatableWealth)}</span></div>
                     <div className="flex items-center justify-center space-x-2 pt-2">
                        {isNisabMet ? ( <><CheckCircleIcon className="h-6 w-6 text-green-500" /><span className="font-semibold text-green-600">Nisab Threshold Met</span></> ) : ( <><XCircleIcon className="h-6 w-6 text-red-500" /><span className="font-semibold text-red-500">Nisab Threshold Not Met</span></> )}
                    </div>
                    <Card title="Total Zakat Due (2.5%)" value={formatCurrencyString(zakatDue)} />
                </SectionCard>
                
                {/* Column 3: Payment Ledger + Suggestions */}
                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                     <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-dark">Payment Progress & Ledger</h3>
                        <button onClick={() => setIsPaymentModalOpen(true)} className="px-3 py-1 bg-primary text-white rounded-md hover:bg-secondary text-sm">Record Payment</button>
                    </div>

                    <div className="space-y-3 border-b pb-4">
                        <div>
                            <div className="flex justify-between items-baseline text-sm mb-1">
                                <span className="font-medium">Paid</span>
                                <span>{formatCurrencyString(totalPaid, {digits: 0})} / {formatCurrencyString(zakatDue, {digits: 0})}</span>
                            </div>
                            <ProgressBar value={totalPaid} max={zakatDue > 0 ? zakatDue : 1} />
                        </div>
                        <Card 
                            title="Outstanding Zakat" 
                            value={formatCurrencyString(outstandingZakat)}
                            valueColor={outstandingZakat > 0 ? "text-danger" : "text-success"}
                        />
                    </div>
                    
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {(data?.zakatPayments ?? []).map(p => (
                             <div key={p.id} className="flex justify-between items-center text-sm p-3 bg-gray-50 rounded-lg border">
                                <div className="flex items-center gap-3">
                                    <BanknotesIcon className="h-6 w-6 text-green-500 flex-shrink-0" />
                                    <div>
                                        <p className="font-semibold text-dark">{formatCurrencyString(p.amount)}</p>
                                        <p className="text-xs text-gray-500">{new Date(p.date).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                {p.notes && <p className="text-xs text-gray-600 italic text-right clamp-2-lines break-words max-w-[220px]" title={p.notes}>{p.notes}</p>}
                            </div>
                        ))}
                        {(data?.zakatPayments ?? []).length === 0 && <p className="empty-state py-4">No payments recorded yet.</p>}
                    </div>

                    <div className="mt-4 border-t pt-4">
                        <h4 className="font-semibold text-dark mb-2 text-sm flex items-center gap-1">
                            Trade & Allocation Suggestions
                        </h4>
                        {zakatAdvice.suggestions.length === 0 ? (
                            <p className="text-xs text-slate-500">No specific Zakat-related trade suggestions based on current holdings.</p>
                        ) : (
                            <ul className="space-y-2 text-xs text-slate-600">
                                {zakatAdvice.suggestions.slice(0, 4).map(s => (
                                    <li key={s.symbol} className="border rounded-md px-3 py-2 bg-slate-50">
                                        <span className="font-semibold text-slate-900">{s.symbol}:</span> {s.impactDescription}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            <ZakatPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} onSave={addZakatPayment} />
        </PageLayout>
    );
};

export default Zakat;
