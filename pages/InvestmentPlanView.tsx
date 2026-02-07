import React, { useState, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { PlannedTrade } from '../types';
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


const PlanTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (plan: Omit<PlannedTrade, 'id'|'user_id'> | PlannedTrade) => void;
    planToEdit: PlannedTrade | null;
}> = ({ isOpen, onClose, onSave, planToEdit }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
    const [conditionType, setConditionType] = useState<'price' | 'date'>('price');
    const [targetValue, setTargetValue] = useState('');
    const [quantity, setQuantity] = useState('');
    const [amount, setAmount] = useState('');
    const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [notes, setNotes] = useState('');

    useEffect(() => {
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
            setAmount(String(planToEdit.amount || ''));
            setPriority(planToEdit.priority);
            setNotes(planToEdit.notes || '');
        } else {
            // Reset form
            setSymbol(''); setName(''); setTradeType('buy'); setConditionType('price');
            setTargetValue(''); setQuantity(''); setAmount(''); setPriority('Medium'); setNotes('');
        }
    }, [planToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!quantity && !amount) {
            alert("Please specify either a quantity of shares or a total amount in SAR for the trade.");
            return;
        }
        
        const planData = {
            symbol: symbol.toUpperCase().trim(),
            name,
            tradeType,
            conditionType,
            targetValue: conditionType === 'date' ? new Date(targetValue).getTime() : parseFloat(targetValue),
            quantity: quantity ? parseFloat(quantity) : undefined,
            amount: amount ? parseFloat(amount) : undefined,
            priority,
            notes,
            status: 'Planned' as const
        };
        
        if (planToEdit) {
            onSave({ ...planToEdit, ...planData });
        } else {
            onSave(planData);
        }
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={planToEdit ? 'Edit Investment Plan' : 'Create Investment Plan'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700">Symbol</label><input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border rounded-md" /></div>
                    <div><label className="block text-sm font-medium text-gray-700">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border rounded-md" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700">Trade Type</label><select value={tradeType} onChange={e => setTradeType(e.target.value as any)} className="mt-1 w-full p-2 border rounded-md"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700">Priority</label><select value={priority} onChange={e => setPriority(e.target.value as any)} className="mt-1 w-full p-2 border rounded-md"><option>High</option><option>Medium</option><option>Low</option></select></div>
                </div>
                <fieldset className="border p-4 rounded-md">
                    <legend className="text-sm font-medium text-gray-700 px-1">Condition</legend>
                    <div className="flex items-center space-x-4 mb-2">
                        <label className="flex items-center"><input type="radio" value="price" checked={conditionType === 'price'} onChange={() => setConditionType('price')} className="form-radio" /> <span className="ml-2">Price Target</span></label>
                        <label className="flex items-center"><input type="radio" value="date" checked={conditionType === 'date'} onChange={() => setConditionType('date')} className="form-radio" /> <span className="ml-2">Date Target</span></label>
                    </div>
                    <input type={conditionType === 'date' ? 'date' : 'number'} value={targetValue} onChange={e => setTargetValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" />
                </fieldset>
                <div className="grid grid-cols-2 gap-4">
                     <div><label className="block text-sm font-medium text-gray-700">Quantity</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="0" step="any" className="mt-1 w-full p-2 border rounded-md" placeholder="e.g., 100" /></div>
                    <div><label className="block text-sm font-medium text-gray-700">Amount (SAR)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any" className="mt-1 w-full p-2 border rounded-md" placeholder="e.g., 5000" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700">Notes (Optional)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full p-2 border rounded-md" rows={2}></textarea></div>

                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Plan</button>
            </form>
        </Modal>
    );
};


const InvestmentPlanView: React.FC<{ onExecutePlan: (plan: PlannedTrade) => void }> = ({ onExecutePlan }) => {
    const { data, addPlannedTrade, updatePlannedTrade, deletePlannedTrade } = useContext(DataContext)!;
    const { simulatedPrices } = useMarketData();
    const { formatCurrencyString } = useFormatCurrency();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [planToEdit, setPlanToEdit] = useState<PlannedTrade | null>(null);
    const [planToDelete, setPlanToDelete] = useState<PlannedTrade | null>(null);

    const handleSave = (planData: Omit<PlannedTrade, 'id' | 'user_id'> | PlannedTrade) => {
        if ('id' in planData) {
            updatePlannedTrade(planData);
        } else {
            addPlannedTrade(planData);
        }
    };
    
    const priorityClass = (p: PlannedTrade['priority']) => ({ High: 'bg-red-100 text-red-800', Medium: 'bg-yellow-100 text-yellow-800', Low: 'bg-blue-100 text-blue-800' }[p]);
    
    const renderCondition = (plan: PlannedTrade) => {
        if (plan.conditionType === 'date') {
            return `On ${new Date(plan.targetValue).toLocaleDateString()}`;
        }
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        const operator = plan.tradeType === 'buy' ? '≤' : '≥';
        const priceText = `${operator} ${formatCurrencyString(plan.targetValue)}`;
        return <>{priceText} <span className="text-xs text-gray-500">(Now: {currentPrice ? formatCurrencyString(currentPrice) : '...'})</span></>;
    }
    
    const isTriggered = (plan: PlannedTrade) => {
        if (plan.status === 'Executed') return false;
        if (plan.conditionType === 'price') {
            const priceInfo = simulatedPrices[plan.symbol];
            if (!priceInfo) return false;
            return (plan.tradeType === 'buy' && priceInfo.price <= plan.targetValue) || (plan.tradeType === 'sell' && priceInfo.price >= plan.targetValue);
        }
        if (plan.conditionType === 'date') {
            return new Date().getTime() >= plan.targetValue;
        }
        return false;
    }

    return (
        <div className="mt-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-dark">Investment Plan</h2>
                    <p className="text-gray-500 mt-1">Proactively plan your trades based on price or date targets.</p>
                </div>
                <button onClick={() => { setPlanToEdit(null); setIsModalOpen(true); }} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"><PlusIcon className="h-5 w-5"/>Add Plan</button>
            </div>
            
            <div className="bg-white shadow rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-3">Asset</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Trigger Condition</th>
                        <th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
                    </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.plannedTrades.map(plan => (
                             <tr key={plan.id} className={isTriggered(plan) ? 'bg-yellow-50' : ''}>
                                <td className="px-4 py-3 whitespace-nowrap"><div className="font-medium text-dark">{plan.symbol}</div><div className="text-xs text-gray-500">{plan.name}</div></td>
                                <td className="px-4 py-3"><span className={`font-semibold ${plan.tradeType === 'buy' ? 'text-green-600' : 'text-red-600'}`}>{plan.tradeType.toUpperCase()}</span></td>
                                <td className="px-4 py-3">{renderCondition(plan)}</td>
                                <td className="px-4 py-3"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${priorityClass(plan.priority)}`}>{plan.priority}</span></td>
                                <td className="px-4 py-3">
                                    {plan.status === 'Executed' ? <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircleIcon className="h-4 w-4"/>Executed</span> :
                                     isTriggered(plan) ? <span className="flex items-center gap-1 text-yellow-600 font-semibold"><ExclamationTriangleIcon className="h-4 w-4"/>Triggered</span> :
                                     <span className="text-gray-600">Planned</span>
                                    }
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => onExecutePlan(plan)} disabled={plan.status === 'Executed'} title="Execute Trade" className="p-2 text-white bg-secondary rounded-md hover:bg-violet-700 disabled:bg-gray-300"><RocketLaunchIcon className="h-4 w-4"/></button>
                                        <button onClick={() => { setPlanToEdit(plan); setIsModalOpen(true); }} className="p-2 text-gray-500 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                                        <button onClick={() => setPlanToDelete(plan)} className="p-2 text-gray-500 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                 {data.plannedTrades.length === 0 && <div className="text-center py-10 text-gray-500">No investment plans created yet.</div>}
            </div>

            <PlanTradeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} planToEdit={planToEdit} />
            <DeleteConfirmationModal isOpen={!!planToDelete} onClose={() => setPlanToDelete(null)} onConfirm={() => { if(planToDelete) deletePlannedTrade(planToDelete.id); setPlanToDelete(null); }} itemName={planToDelete?.name || ''} />
        </div>
    );
};

export default InvestmentPlanView;