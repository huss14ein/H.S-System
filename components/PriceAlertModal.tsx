import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { PriceAlert, PriceAlertCurrency } from '../types';
import { TrashIcon } from './icons/TrashIcon';
import { getExchangeAndCurrencyForSymbol } from '../services/finnhubService';

const CURRENCY_OPTIONS: { value: PriceAlertCurrency; label: string }[] = [
    { value: 'USD', label: 'USD' },
    { value: 'SAR', label: 'SAR' },
];

interface PriceAlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (symbol: string, targetPrice: number, currency: PriceAlertCurrency) => void;
    onDeleteAlert: (alertId: string) => void;
    stock: { symbol: string; name: string; price: number } | null;
    existingAlerts: PriceAlert[];
}

const formatInCurrency = (value: number, currency: 'USD' | 'SAR') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const PriceAlertModal: React.FC<PriceAlertModalProps> = ({ isOpen, onClose, onSave, onDeleteAlert, stock, existingAlerts }) => {
    const [targetPrice, setTargetPrice] = useState('');
    const [currency, setCurrency] = useState<PriceAlertCurrency>('USD');
    const market = stock ? getExchangeAndCurrencyForSymbol(stock.symbol) : null;
    const priceCurrency = market?.currency ?? 'USD';

    useEffect(() => {
        if (stock && isOpen) setCurrency(priceCurrency as PriceAlertCurrency);
    }, [stock?.symbol, isOpen, priceCurrency]);

    if (!stock) return null;

    const activeAlerts = existingAlerts.filter(a => a.status === 'active');

    const formatAlertPrice = (alert: PriceAlert) => {
        const raw = alert.targetPrice ?? (alert as any).target_price;
        const price = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
        const curr = alert.currency ?? 'USD';
        const value = Number.isFinite(price) ? price : 0;
        return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}`;
    };

    const handleAddAlert = (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(targetPrice.replace(/,/g, ''));
        if (Number.isFinite(price) && price > 0) {
            onSave(stock.symbol, price, currency);
            setTargetPrice('');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Price alerts: ${stock.name} (${stock.symbol})`}>
            <div className="space-y-4">
                <p className="text-sm">Current price: <span className="font-semibold">{formatInCurrency(stock.price, priceCurrency as 'USD' | 'SAR')}</span>{market && <span className="text-slate-500 text-xs ml-1">· {market.exchange}</span>}</p>

                {activeAlerts.length > 0 && (
                    <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Active alerts ({activeAlerts.length})</p>
                        <ul className="space-y-2">
                            {activeAlerts.map((alert) => (
                                <li key={alert.id} className="flex items-center justify-between gap-2 py-2 px-3 bg-amber-50 border border-amber-100 rounded-lg">
                                    <span className="font-medium tabular-nums">{formatAlertPrice(alert)}</span>
                                    <button
                                        type="button"
                                        onClick={() => window.confirm('Remove this price alert?') && onDeleteAlert(alert.id)}
                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                        title="Remove this alert"
                                        aria-label="Remove alert"
                                    >
                                        <TrashIcon className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <form onSubmit={handleAddAlert} className="pt-2 border-t border-gray-200">
                    <label htmlFor="target-price" className="block text-sm font-medium text-gray-700 mb-1">Add new alert when price reaches</label>
                    <div className="flex flex-wrap gap-2 items-end">
                        <div className="flex-shrink-0">
                            <label htmlFor="alert-currency" className="block text-xs text-gray-500 mb-0.5">Currency</label>
                            <select
                                id="alert-currency"
                                value={currency}
                                onChange={e => setCurrency(e.target.value as PriceAlertCurrency)}
                                className="p-2 border border-gray-300 rounded-md text-sm min-w-[4rem]"
                            >
                                {CURRENCY_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1 min-w-[100px]">
                            <label htmlFor="target-price" className="block text-xs text-gray-500 mb-0.5">Target price</label>
                            <input
                                type="number"
                                id="target-price"
                                value={targetPrice}
                                onChange={e => setTargetPrice(e.target.value)}
                                min="0.01"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md"
                                placeholder={currency === 'SAR' ? 'e.g. 350.50' : 'e.g. 185.00'}
                            />
                        </div>
                        <button type="submit" className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary whitespace-nowrap">
                            Add alert
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
};

export default PriceAlertModal;
