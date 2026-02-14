import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { CommodityHolding } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { BitcoinIcon } from '../components/icons/BitcoinIcon';
import { CubeIcon } from '../components/icons/CubeIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { getAICommodityPrices } from '../services/geminiService';

const CommodityHoldingModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => void;
    holdingToEdit: CommodityHolding | null;
}> = ({ isOpen, onClose, onSave, holdingToEdit }) => {
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [purchaseValue, setPurchaseValue] = useState('');
    const [currentValue, setCurrentValue] = useState('');
    const [zakahClass, setZakahClass] = useState<CommodityHolding['zakahClass']>('Zakatable');
    const [owner, setOwner] = useState('');
    
    useEffect(() => {
        if (holdingToEdit) {
            setName(holdingToEdit.name);
            setQuantity(String(holdingToEdit.quantity));
            setUnit(holdingToEdit.unit);
            setPurchaseValue(String(holdingToEdit.purchaseValue));
            setCurrentValue(String(holdingToEdit.currentValue));
            setZakahClass(holdingToEdit.zakahClass);
            setOwner(holdingToEdit.owner || '');
        } else {
            setName('Gold'); setQuantity(''); setUnit('gram'); setPurchaseValue(''); setCurrentValue(''); setZakahClass('Zakatable'); setOwner('');
        }
    }, [holdingToEdit, isOpen]);

    useEffect(() => {
        if (name === 'Gold' || name === 'Silver') setUnit('gram');
        else if (name === 'Bitcoin') setUnit('BTC');
        else setUnit('unit');
    }, [name]);

    const getSymbol = (name: CommodityHolding['name'], unit: CommodityHolding['unit']) => {
        if (name === 'Gold') return unit === 'gram' ? 'XAU_GRAM' : 'XAU_OUNCE';
        if (name === 'Silver') return unit === 'gram' ? 'XAG_GRAM' : 'XAG_OUNCE';
        if (name === 'Bitcoin') return 'BTC_USD';
        return 'OTHER';
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const holdingData = {
            name, quantity: parseFloat(quantity) || 0, unit,
            purchaseValue: parseFloat(purchaseValue) || 0,
            currentValue: parseFloat(currentValue) || 0,
            symbol: getSymbol(name, unit), zakahClass,
            owner: owner || undefined,
        };
        if (holdingToEdit) onSave({ ...holdingToEdit, ...holdingData });
        else onSave(holdingData);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={holdingToEdit ? 'Edit Commodity' : 'Add Commodity'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <select value={name} onChange={e => setName(e.target.value as any)} className="w-full p-2 border rounded-md"><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bitcoin">Bitcoin</option><option value="Other">Other</option></select>
                <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /><select value={unit} onChange={e => setUnit(e.target.value as any)} className="w-full p-2 border rounded-md">{name === 'Gold' || name === 'Silver' ? <> <option value="gram">grams</option> <option value="ounce">ounces</option> </> : name === 'Bitcoin' ? <option value="BTC">BTC</option> : <option value="unit">units</option>}</select></div>
                <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Purchase Value" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /><input type="number" placeholder="Current Value" value={currentValue} onChange={e => setCurrentValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /></div>
                 <div><label className="block text-sm font-medium text-gray-700">Owner</label><input type="text" placeholder="e.g., Spouse, Son" value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full p-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Zakat Classification</label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="mt-1 w-full p-2 border border-gray-300 rounded-md"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save</button>
            </form>
        </Modal>
    );
};

const CommodityHoldingCard: React.FC<{ holding: CommodityHolding; onEdit: (h: CommodityHolding) => void; onDelete: (h: CommodityHolding) => void; }> = ({ holding, onEdit, onDelete }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const unrealizedGain = holding.currentValue - holding.purchaseValue;
    const getIcon = (type: CommodityHolding['name']) => {
        const iconClass = "h-10 w-10";
        switch (type) {
            case 'Gold': return <GoldBarIcon className={`${iconClass} text-yellow-500`} />;
            case 'Silver': return <GoldBarIcon className={`${iconClass} text-gray-400`} />;
            case 'Bitcoin': return <BitcoinIcon className={`${iconClass} text-orange-500`} />;
            default: return <CubeIcon className={`${iconClass} text-gray-500`} />;
        }
    };
    return (
        <div className="bg-white rounded-lg shadow p-5 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-4">
                        {getIcon(holding.name)}
                        <div><h3 className="font-bold text-dark text-xl">{holding.name}</h3><p className="text-sm text-gray-500">{holding.quantity} {holding.unit}</p></div>
                    </div>
                    <div className="flex space-x-1"><button onClick={() => onEdit(holding)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button><button onClick={() => onDelete(holding)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button></div>
                </div>
                {holding.owner && <span className="mt-2 inline-block text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{holding.owner}</span>}
                <div className="mt-4 space-y-3">
                    <div><dt className="text-sm text-gray-500">Current Value</dt><dd className="font-semibold text-dark text-2xl">{formatCurrencyString(holding.currentValue)}</dd></div>
                    <div className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-gray-500">Purchase Value</dt><dd className="font-medium text-gray-700">{formatCurrencyString(holding.purchaseValue)}</dd></div><div><dt className="text-gray-500">Unrealized G/L</dt><dd className="font-semibold">{formatCurrency(unrealizedGain, { colorize: true })}</dd></div></div>
                </div>
            </div>
            <div className="border-t mt-4 pt-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${holding.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{holding.zakahClass}</span></div>
        </div>
    );
};


const Commodities: React.FC = () => {
    const { data, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
    const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);
    const [commodityToDelete, setCommodityToDelete] = useState<CommodityHolding | null>(null);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);

    const totalCommodityValue = useMemo(() => {
        return data.commodityHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    }, [data.commodityHoldings]);

    const handleOpenCommodityModal = (holding: CommodityHolding | null = null) => { setCommodityToEdit(holding); setIsCommodityModalOpen(true); };
    const handleSaveCommodity = (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => {
        if ('id' in holding) {
            updateCommodityHolding(holding);
        } else {
            addCommodityHolding(holding);
        }
    };
    const handleOpenCommodityDeleteModal = (holding: CommodityHolding) => { setCommodityToDelete(holding); };
    const handleConfirmCommodityDelete = () => { if(commodityToDelete) { deleteCommodityHolding(commodityToDelete.id); setCommodityToDelete(null); } };

    const handleUpdatePrices = async () => {
        if (data.commodityHoldings.length === 0) return;
        setIsUpdatingPrices(true);
        try {
            const { prices } = await getAICommodityPrices(data.commodityHoldings.map(c => ({ symbol: c.symbol, name: c.name })));
            if (prices.length > 0) {
                const updates = data.commodityHoldings
                    .map(h => {
                        const newPriceInfo = prices.find(p => p.symbol === h.symbol);
                        return newPriceInfo ? { id: h.id, currentValue: newPriceInfo.price * h.quantity } : null;
                    })
                    .filter((u): u is { id: string; currentValue: number; } => u !== null);
                
                if (updates.length > 0) {
                    await batchUpdateCommodityHoldingValues(updates);
                }
            }
        } catch (error) {
            console.error("Failed to update commodity prices:", error);
        } finally {
            setIsUpdatingPrices(false);
        }
    };
    
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Metals & Crypto</h1>
                <button onClick={() => handleOpenCommodityModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add Commodity</button>
            </div>

            <Card title="Total Commodity Value" value={formatCurrencyString(totalCommodityValue)} />

            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                    <h3 className="text-xl font-semibold text-dark">Holdings</h3>
                    <button onClick={handleUpdatePrices} disabled={isUpdatingPrices} className="flex items-center px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isUpdatingPrices ? 'Updating Prices...' : 'Update Prices via AI'}
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {data.commodityHoldings.map(h => <CommodityHoldingCard key={h.id} holding={h} onEdit={handleOpenCommodityModal} onDelete={handleOpenCommodityDeleteModal} />)}
                    {data.commodityHoldings.length === 0 && <p className="text-sm text-gray-500 md:col-span-2 xl:col-span-3 text-center py-8">No commodities added yet.</p>}
                </div>
            </div>
            
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} />
            <DeleteConfirmationModal isOpen={!!commodityToDelete} onClose={() => setCommodityToDelete(null)} onConfirm={handleConfirmCommodityDelete} itemName={commodityToDelete?.name || ''} />
        </div>
    );
};

export default Commodities;