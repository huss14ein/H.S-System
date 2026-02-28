import React, { useState } from 'react';
import Modal from './Modal';
import { PriceAlert } from '../types';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { TrashIcon } from './icons/TrashIcon';

interface PriceAlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (symbol: string, targetPrice: number) => void;
    onDeleteAlert: (alertId: string) => void;
    stock: { symbol: string; name: string; price: number } | null;
    existingAlerts: PriceAlert[];
}

const PriceAlertModal: React.FC<PriceAlertModalProps> = ({ isOpen, onClose, onSave, onDeleteAlert, stock, existingAlerts }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [targetPrice, setTargetPrice] = useState('');

    if (!stock) return null;

    const activeAlerts = existingAlerts.filter(a => a.status === 'active');

    const handleAddAlert = (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(targetPrice.replace(/,/g, ''));
        if (Number.isFinite(price) && price > 0) {
            onSave(stock.symbol, price);
            setTargetPrice('');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Price alerts: ${stock.name} (${stock.symbol})`}>
            <div className="space-y-4">
                <p className="text-sm">Current price: <span className="font-semibold">{formatCurrencyString(stock.price, { forceUSD: true })}</span></p>

                {activeAlerts.length > 0 && (
                    <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Active alerts ({activeAlerts.length})</p>
                        <ul className="space-y-2">
                            {activeAlerts.map((alert) => (
                                <li key={alert.id} className="flex items-center justify-between gap-2 py-2 px-3 bg-amber-50 border border-amber-100 rounded-lg">
                                    <span className="font-medium tabular-nums">{formatCurrencyString(alert.targetPrice ?? (alert as any).target_price, { forceUSD: true })}</span>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteAlert(alert.id)}
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
                    <div className="flex gap-2">
                        <input
                            type="number"
                            id="target-price"
                            value={targetPrice}
                            onChange={e => setTargetPrice(e.target.value)}
                            min="0.01"
                            step="0.01"
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                            placeholder="e.g. 350.50"
                        />
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
