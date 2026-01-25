
import React, { useState, useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import Modal from '../components/Modal';
import { ZakatPayment } from '../types';


const ZakatPaymentModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (payment: Omit<ZakatPayment, 'id'>) => void }> = ({ isOpen, onClose, onSave }) => {
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
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="zakat-amount" className="block text-sm font-medium text-gray-700">Amount Paid</label>
                    <input type="number" id="zakat-amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                 <div>
                    <label htmlFor="zakat-date" className="block text-sm font-medium text-gray-700">Date</label>
                    <input type="date" id="zakat-date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                 <div>
                    <label htmlFor="zakat-notes" className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                    <input type="text" id="zakat-notes" value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Record Payment</button>
            </form>
        </Modal>
    );
};


const Zakat: React.FC = () => {
    const { data, addZakatPayment } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const [goldPrice, setGoldPrice] = useState(275);
    const [otherDebts, setOtherDebts] = useState(0);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    const nisab = useMemo(() => goldPrice * 85, [goldPrice]);

    const zakatableAssets = useMemo(() => {
        const cash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        
        const investments = data.investments.flatMap(p => p.holdings)
            .filter(h => h.zakahClass === 'Zakatable')
            .reduce((sum, h) => sum + h.currentValue, 0);

        const total = cash + investments;
        return { cash, investments, total };
    }, [data.accounts, data.investments]);

    const deductibleLiabilities = useMemo(() => {
        const shortTermDebts = data.accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
        const total = shortTermDebts + otherDebts;
        return { shortTermDebts, otherDebts, total };
    }, [otherDebts, data.accounts]);
    
    const netZakatableWealth = useMemo(() => Math.max(0, zakatableAssets.total - deductibleLiabilities.total), [zakatableAssets, deductibleLiabilities]);
    const isNisabMet = useMemo(() => netZakatableWealth >= nisab, [netZakatableWealth, nisab]);
    const zakatDue = useMemo(() => isNisabMet ? netZakatableWealth * 0.025 : 0, [isNisabMet, netZakatableWealth]);
    const totalPaid = useMemo(() => data.zakatPayments.reduce((sum, p) => sum + p.amount, 0), [data.zakatPayments]);
    const outstandingZakat = useMemo(() => zakatDue - totalPaid, [zakatDue, totalPaid]);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Zakat Calculator</h1>
                <p className="text-gray-500 mt-1">Estimate your annual Zakat based on your tracked assets and liabilities.</p>
                 <div className="mt-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 p-4 max-w-3xl mx-auto text-sm text-left rounded-r-lg">
                    <div className="flex">
                        <div className="py-1"><InformationCircleIcon className="h-5 w-5 text-yellow-400 mr-3"/></div>
                        <div>
                            <p className="font-bold">Disclaimer:</p>
                            <p>This calculator provides an estimation for educational purposes only. Please consult a qualified religious scholar for accurate guidance.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                {/* Column 1: Assets & Liabilities */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="font-semibold text-dark mb-4">Zakatable Assets</h3>
                         <div className="space-y-3">
                            <p className="text-xs text-gray-500">Includes cash in checking/savings and investments marked as 'Zakatable'. You can change an asset's Zakat classification in the Investments tab.</p>
                            <div className="flex justify-between text-sm pt-2"><span className="text-gray-600">Cash</span><span>{formatCurrencyString(zakatableAssets.cash)}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Investments</span><span>{formatCurrencyString(zakatableAssets.investments)}</span></div>
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Assets</span><span>{formatCurrencyString(zakatableAssets.total)}</span></div>
                        </div>
                    </div>
                     <div className="bg-white p-6 rounded-lg shadow">
                        <h3 className="font-semibold text-dark mb-4">Deductible Liabilities</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Credit Card Debt</span><span>{formatCurrencyString(deductibleLiabilities.shortTermDebts)}</span></div>
                            <div>
                                <label htmlFor="other-debts" className="block text-sm font-medium text-gray-700">Other Short-Term Debts</label>
                                <input type="number" id="other-debts" value={otherDebts} onChange={e => setOtherDebts(parseFloat(e.target.value) || 0)} placeholder="Enter value" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                            </div>
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Liabilities</span><span>{formatCurrencyString(deductibleLiabilities.total)}</span></div>
                        </div>
                    </div>
                </div>

                {/* Column 2: Calculation & Summary */}
                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                    <h3 className="font-semibold text-dark mb-4">Calculation</h3>
                     <div>
                        <label htmlFor="gold-price" className="block text-sm font-medium text-gray-700">Price of Gold (per gram)</label>
                        <input type="number" id="gold-price" value={goldPrice} onChange={(e) => setGoldPrice(parseFloat(e.target.value) || 0)} className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
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
                </div>
                
                 {/* Column 3: Payment Ledger */}
                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-dark">Payments Ledger</h3>
                        <button onClick={() => setIsPaymentModalOpen(true)} className="px-3 py-1 bg-primary text-white rounded-md hover:bg-secondary text-sm">Record Payment</button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {data.zakatPayments.map(p => (
                             <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md">
                                <div>
                                    <p className="font-medium">{new Date(p.date).toLocaleDateString()}</p>
                                    <p className="text-xs text-gray-500">{p.notes}</p>
                                </div>
                                <p className="font-semibold">{formatCurrencyString(p.amount)}</p>
                            </div>
                        ))}
                        {data.zakatPayments.length === 0 && <p className="text-sm text-center text-gray-500 py-4">No payments recorded yet.</p>}
                    </div>
                    <div className="border-t pt-4 space-y-2">
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Total Paid</span><span className="font-medium text-dark">{formatCurrencyString(totalPaid)}</span></div>
                        <div className="flex justify-between font-bold p-2 bg-blue-50 rounded-md"><span className="text-blue-800">Outstanding Zakat</span><span className="text-blue-900">{formatCurrencyString(outstandingZakat)}</span></div>
                    </div>
                </div>
            </div>

            <ZakatPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} onSave={addZakatPayment} />
        </div>
    );
};

export default Zakat;
