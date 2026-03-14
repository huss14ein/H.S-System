import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import Modal from '../components/Modal';
import { ZakatPayment } from '../types';
import ProgressBar from '../components/ProgressBar';
import InfoHint from '../components/InfoHint';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';
import { DemoDataButton } from '../components/DemoDataButton';
import { buildZakatTradeAdvice } from '../services/zakatTradeAdvisor';

const ZakatPaymentModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => void }> = ({ isOpen, onClose, onSave }) => {
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ amount: parseFloat(amount) || 0, date, notes });
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setNotes('');
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record Zakat Payment">
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="zakat-amount" className="block text-sm font-semibold text-gray-800 mb-2">Amount Paid</label>
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500 text-sm">$</span>
                        </div>
                        <input 
                            type="number" 
                            id="zakat-amount" 
                            value={amount} 
                            onChange={e => setAmount(e.target.value)} 
                            required 
                            min="0.01" 
                            step="0.01" 
                            placeholder="0.00" 
                            className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-lg"
                        />
                    </div>
                </div>
                 <div>
                    <label htmlFor="zakat-date" className="block text-sm font-semibold text-gray-800 mb-2">Payment Date</label>
                    <input 
                        type="date" 
                        id="zakat-date" 
                        value={date} 
                        onChange={e => setDate(e.target.value)} 
                        required 
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                </div>
                 <div>
                    <label htmlFor="zakat-notes" className="block text-sm font-semibold text-gray-800 mb-2">Notes (Optional)</label>
                    <textarea 
                        id="zakat-notes" 
                        value={notes} 
                        onChange={e => setNotes(e.target.value)} 
                        rows={3}
                        placeholder="Add any notes about this payment..."
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
                    />
                </div>
                <div className="flex gap-3 pt-4">
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        className="flex-1 px-4 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl hover:from-primary/90 hover:to-secondary/90 transition-all font-medium shadow-lg"
                    >
                        Record Payment
                    </button>
                </div>
            </form>
        </Modal>
    );
};


const Zakat: React.FC = () => {
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
            const local = parseFloat(localNisabAmount);
            if (Number.isFinite(local) && local > 0) return local;
            if (nisabAmountSetting != null && Number.isFinite(Number(nisabAmountSetting))) return Number(nisabAmountSetting);
        }
        const localGold = parseFloat(localGoldPrice);
        const effectiveGold = Number.isFinite(localGold) && localGold > 0 ? localGold : goldPrice;
        return effectiveGold * 85;
    }, [useNisabAmount, localNisabAmount, nisabAmountSetting, localGoldPrice, goldPrice]);

    const zakatableAssets = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const investments = data?.investments ?? [];
        const commodityHoldings = data?.commodityHoldings ?? [];
        const cash = accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        const invValue = investments
            .flatMap(p => (p.holdings || []).map(h => ({ ...h, portfolioCurrency: p.currency })))
            .filter(h => h.zakahClass === 'Zakatable')
            .reduce((sum, h) => sum + toSAR(h.currentValue, h.portfolioCurrency, exchangeRate), 0);
        const commodities = commodityHoldings.filter(c => c.zakahClass === 'Zakatable').reduce((sum, c) => sum + c.currentValue, 0);
        const total = cash + invValue + commodities;
        return { cash, investments: invValue, commodities, total };
    }, [data?.accounts, data?.investments, data?.commodityHoldings, exchangeRate]);

    const deductibleLiabilities = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const liabilities = data?.liabilities ?? [];
        const shortTermDebts = accounts.filter(a => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum, acc) => sum + Math.abs(acc.balance ?? 0), 0);
        // Only debts (amount < 0) are deductible; receivables (amount > 0) are assets and must not reduce zakatable wealth
        const trackedLiabilities = liabilities.filter(l => l.status === 'Active' && (l.amount ?? 0) < 0).reduce((sum, liability) => sum + Math.abs(liability.amount ?? 0), 0);
        const total = shortTermDebts + trackedLiabilities + otherDebts;
        return { shortTermDebts, trackedLiabilities, otherDebts, total };
    }, [otherDebts, data?.accounts, data?.liabilities]);
    
    const netZakatableWealth = useMemo(() => Math.max(0, zakatableAssets.total - deductibleLiabilities.total), [zakatableAssets, deductibleLiabilities]);
    const isNisabMet = useMemo(() => netZakatableWealth >= nisab, [netZakatableWealth, nisab]);
    const zakatDue = useMemo(() => isNisabMet ? netZakatableWealth * 0.025 : 0, [isNisabMet, netZakatableWealth]);
    const totalPaid = useMemo(() => (data?.zakatPayments ?? []).reduce((sum, p) => sum + p.amount, 0), [data?.zakatPayments]);
    const outstandingZakat = useMemo(() => zakatDue - totalPaid, [zakatDue, totalPaid]);

    const zakatAdvice = useMemo(
        () => buildZakatTradeAdvice(data),
        [data]
    );

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
            action={<DemoDataButton page="Zakat" options={{ includeAssets: true, includeLiabilities: true }} />}
        >
            {/* Alert Banner */}
            <div className="max-w-7xl mx-auto mb-8">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                        <div className="bg-amber-100 rounded-full p-2">
                            <InformationCircleIcon className="h-6 w-6 text-amber-600"/>
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-amber-900 mb-2">Important Disclaimer</h3>
                            <p className="text-amber-800 text-sm leading-relaxed">
                                This calculator provides an estimation for educational purposes only. Please consult a qualified religious scholar for accurate guidance on your Zakat obligations.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
                
                {/* Left Column - Assets & Liabilities */}
                <div className="xl:col-span-7 space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Zakatable Assets Card */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
                                <h3 className="font-semibold text-green-900 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    Zakatable Assets
                                </h3>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                                <CheckCircleIcon className="h-4 w-4 text-green-600"/>
                                            </div>
                                            <span className="text-gray-700 font-medium">Cash</span>
                                        </div>
                                        <span className="font-semibold text-gray-900">{formatCurrencyString(zakatableAssets.cash)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                                <CheckCircleIcon className="h-4 w-4 text-green-600"/>
                                            </div>
                                            <span className="text-gray-700 font-medium">Investments</span>
                                        </div>
                                        <span className="font-semibold text-gray-900">{formatCurrencyString(zakatableAssets.investments)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                                <CheckCircleIcon className="h-4 w-4 text-green-600"/>
                                            </div>
                                            <span className="text-gray-700 font-medium">Commodities</span>
                                        </div>
                                        <span className="font-semibold text-gray-900">{formatCurrencyString(zakatableAssets.commodities)}</span>
                                    </div>
                                </div>
                                <div className="border-t border-gray-200 pt-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-lg font-bold text-gray-900">Total Assets</span>
                                        <span className="text-lg font-bold text-green-600">{formatCurrencyString(zakatableAssets.total)}</span>
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <p className="text-sm text-gray-600 leading-relaxed">
                                        Includes cash, 'Zakatable' investments, and 'Zakatable' commodities. You can change an asset's Zakat classification on the 'Investments' and 'Commodities' pages.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Deductible Liabilities Card */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-gradient-to-r from-red-50 to-pink-50 px-6 py-4 border-b border-red-100">
                                <h3 className="font-semibold text-red-900 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    Deductible Liabilities
                                </h3>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-gray-700 font-medium">Credit Card Debt</span>
                                        <span className="font-semibold text-gray-900">{formatCurrencyString(deductibleLiabilities.shortTermDebts)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-gray-700 font-medium">Tracked Liabilities (Active)</span>
                                        <span className="font-semibold text-gray-900">{formatCurrencyString(deductibleLiabilities.trackedLiabilities)}</span>
                                    </div>
                                    <div className="space-y-2">
                                        <label htmlFor="other-debts" className="block text-sm font-medium text-gray-700">Other Short-Term Debts</label>
                                        <div className="relative">
                                            <input 
                                                type="number" 
                                                id="other-debts" 
                                                value={otherDebts} 
                                                onChange={e => setOtherDebts(parseFloat(e.target.value) || 0)} 
                                                placeholder="Enter amount" 
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="border-t border-gray-200 pt-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-lg font-bold text-gray-900">Total Liabilities</span>
                                        <span className="text-lg font-bold text-red-600">{formatCurrencyString(deductibleLiabilities.total)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Calculation Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
                            <h3 className="font-semibold text-blue-900 flex items-center gap-2">
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                Zakat Calculation
                            </h3>
                        </div>
                        <div className="p-6 space-y-6">
                            {/* Configuration Section */}
                            <div className="bg-gray-50 rounded-xl p-5">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <input 
                                            type="checkbox" 
                                            id="use-nisab-amount" 
                                            checked={useNisabAmount} 
                                            onChange={(e) => { 
                                                const checked = e.target.checked; 
                                                setUseNisabAmount(checked); 
                                                if (!checked) updateSettings({ nisabAmount: undefined }); 
                                            }} 
                                            className="h-5 w-5 text-primary rounded border-gray-300 focus:ring-primary focus:ring-2"
                                        />
                                        <label htmlFor="use-nisab-amount" className="text-sm font-medium text-gray-700 cursor-pointer">
                                            Set Nisab amount directly (instead of gold price)
                                        </label>
                                    </div>
                                    {useNisabAmount ? (
                                        <div>
                                            <label htmlFor="nisab-amount" className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                                Nisab amount 
                                                <InfoHint text="Minimum wealth threshold in your currency. If your net zakatable wealth is below this, you do not owe Zakat. Can be set directly (e.g. from local authority) instead of using gold price × 85 grams." />
                                            </label>
                                            <input 
                                                type="number" 
                                                id="nisab-amount" 
                                                value={localNisabAmount} 
                                                onChange={(e) => setLocalNisabAmount(e.target.value)} 
                                                onBlur={() => { const v = parseFloat(localNisabAmount); if (Number.isFinite(v) && v > 0) updateSettings({ nisabAmount: v }); }} 
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                                min="0" 
                                                step="1" 
                                            />
                                        </div>
                                    ) : (
                                        <div>
                                            <label htmlFor="gold-price" className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                                Price of Gold (per gram) 
                                                <InfoHint text="Used to compute the Nisab threshold: Nisab = price × 85 grams. If your net zakatable wealth is below that value, you do not owe Zakat." />
                                            </label>
                                            <input 
                                                type="number" 
                                                id="gold-price" 
                                                value={localGoldPrice} 
                                                onChange={(e) => setLocalGoldPrice(e.target.value)} 
                                                onBlur={() => { const v = parseFloat(localGoldPrice) || 275; updateSettings({ goldPrice: v }); }} 
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Calculation Breakdown */}
                            <div className="space-y-3">
                                <div className="flex justify-between items-center py-2">
                                    <span className="text-gray-600 font-medium">Nisab Threshold</span>
                                    <span className="font-semibold text-gray-900 bg-blue-50 px-3 py-1 rounded-lg">{formatCurrencyString(nisab)}</span>
                                </div>
                                <div className="border-t border-gray-200"></div>
                                <div className="flex justify-between items-center py-2">
                                    <span className="text-gray-600 font-medium">Total Zakatable Assets</span>
                                    <span className="font-semibold text-gray-900">{formatCurrencyString(zakatableAssets.total)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2">
                                    <span className="text-gray-600 font-medium">Deductible Liabilities</span>
                                    <span className="font-semibold text-red-600">-{formatCurrencyString(deductibleLiabilities.total)}</span>
                                </div>
                                <div className="border-t border-gray-200"></div>
                                <div className="flex justify-between items-center py-3 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 rounded-lg">
                                    <span className="text-gray-800 font-bold text-lg">Net Zakatable Wealth</span>
                                    <span className="font-bold text-xl text-blue-600">{formatCurrencyString(netZakatableWealth)}</span>
                                </div>
                            </div>

                            {/* Nisab Status */}
                            <div className="flex items-center justify-center p-4 rounded-xl border-2 border-dashed">
                                {isNisabMet ? (
                                    <div className="flex items-center gap-3 text-green-600">
                                        <div className="bg-green-100 rounded-full p-2">
                                            <CheckCircleIcon className="h-6 w-6" />
                                        </div>
                                        <span className="font-semibold text-lg">Nisab Threshold Met</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 text-red-600">
                                        <div className="bg-red-100 rounded-full p-2">
                                            <XCircleIcon className="h-6 w-6" />
                                        </div>
                                        <span className="font-semibold text-lg">Nisab Threshold Not Met</span>
                                    </div>
                                )}
                            </div>

                            {/* Total Zakat Due */}
                            <div className="bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl p-6 text-white">
                                <div className="text-center">
                                    <div className="text-sm font-medium mb-2 opacity-90">Total Zakat Due</div>
                                    <div className="text-3xl font-bold mb-1">{formatCurrencyString(zakatDue)}</div>
                                    <div className="text-sm opacity-75">(2.5% of Net Zakatable Wealth)</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Payment Progress & Ledger */}
                <div className="xl:col-span-5 space-y-6">
                    {/* Payment Progress Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-6 py-4 border-b border-purple-100">
                            <div className="flex justify-between items-center">
                                <h3 className="font-semibold text-purple-900 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                    Payment Progress
                                </h3>
                                <button 
                                    onClick={() => setIsPaymentModalOpen(true)} 
                                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all text-sm font-medium shadow-sm"
                                >
                                    Record Payment
                                </button>
                            </div>
                        </div>
                        <div className="p-6 space-y-6">
                            {/* Progress Section */}
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <span className="text-sm font-medium text-gray-700">Payment Progress</span>
                                        <span className="text-sm text-gray-600">
                                            {formatCurrencyString(totalPaid, {digits: 0})} / {formatCurrencyString(zakatDue, {digits: 0})}
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <ProgressBar value={totalPaid} max={zakatDue > 0 ? zakatDue : 1} />
                                    </div>
                                </div>
                                
                                <div className={`rounded-xl p-4 text-center ${
                                    outstandingZakat > 0 
                                        ? 'bg-gradient-to-r from-red-50 to-pink-50 border border-red-200' 
                                        : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'
                                }`}>
                                    <div className={`text-lg font-bold ${
                                        outstandingZakat > 0 ? 'text-red-600' : 'text-green-600'
                                    }`}>
                                        {formatCurrencyString(outstandingZakat)}
                                    </div>
                                    <div className="text-sm text-gray-600 mt-1">
                                        {outstandingZakat > 0 ? 'Outstanding Zakat' : 'Zakat Fully Paid'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Payment Ledger Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gradient-to-r from-gray-50 to-slate-50 px-6 py-4 border-b border-gray-200">
                            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                Payment Ledger
                            </h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                                {(data?.zakatPayments ?? []).map(p => (
                                    <div key={p.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:shadow-sm transition-shadow">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-green-100 rounded-full p-2">
                                                    <BanknotesIcon className="h-5 w-5 text-green-600" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-900">{formatCurrencyString(p.amount)}</p>
                                                    <p className="text-xs text-gray-500">{new Date(p.date).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            {p.notes && (
                                                <p className="text-xs text-gray-600 italic text-right max-w-xs break-words" title={p.notes}>
                                                    {p.notes}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {(data?.zakatPayments ?? []).length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        <div className="bg-gray-100 rounded-full p-3 w-12 h-12 mx-auto mb-3">
                                            <BanknotesIcon className="h-6 w-6 text-gray-400" />
                                        </div>
                                        <p className="text-sm">No payments recorded yet.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Trade Suggestions Card */}
                    {zakatAdvice.suggestions.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-indigo-100">
                                <h3 className="font-semibold text-indigo-900 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                                    Trade & Allocation Suggestions
                                </h3>
                            </div>
                            <div className="p-6">
                                <ul className="space-y-3">
                                    {zakatAdvice.suggestions.slice(0, 4).map(s => (
                                        <li key={s.symbol} className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
                                            <div className="flex items-start gap-3">
                                                <div className="bg-indigo-100 rounded px-2 py-1 text-xs font-bold text-indigo-700">
                                                    {s.symbol}
                                                </div>
                                                <p className="text-sm text-gray-700 leading-relaxed flex-1">{s.impactDescription}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ZakatPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} onSave={addZakatPayment} />
        </PageLayout>
    );
};

export default Zakat;
