
import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { PriceAlert } from '../types';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

interface PriceAlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (symbol: string, targetPrice: number) => void;
    onDelete: (symbol: string) => void;
    stock: { symbol: string, name: string, price: number } | null;
    existingAlert: PriceAlert | null;
}

const PriceAlertModal: React.FC<PriceAlertModalProps> = ({ isOpen, onClose, onSave, onDelete, stock, existingAlert }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [targetPrice, setTargetPrice] = useState('');

    useEffect(() => {
        if (existingAlert) {
            setTargetPrice(String(existingAlert.targetPrice));
        } else {
            setTargetPrice('');
        }
    }, [existingAlert, isOpen]);

    if (!stock) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(targetPrice);
        if (price > 0) {
            onSave(stock.symbol, price);
            onClose();
        }
    };

    const handleDelete = () => {
        onDelete(stock.symbol);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Set Alert for ${stock.name} (${stock.symbol})`}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm">Current Price: <span className="font-semibold">{formatCurrencyString(stock.price)}</span></p>
                <div>
                    <label htmlFor="target-price" className="block text-sm font-medium text-gray-700">Alert me when price reaches:</label>
                    <input
                        type="number"
                        id="target-price"
                        value={targetPrice}
                        onChange={e => setTargetPrice(e.target.value)}
                        required
                        min="0.01"
                        step="0.01"
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                        placeholder="e.g., 350.50"
                    />
                </div>
                <div className="flex justify-between items-center space-x-2">
                    {existingAlert && (
                        <button type="button" onClick={handleDelete} className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                            Delete Alert
                        </button>
                    )}
                    <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">
                        {existingAlert ? 'Update Alert' : 'Set Alert'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default PriceAlertModal;
