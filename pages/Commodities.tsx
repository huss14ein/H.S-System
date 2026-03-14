import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { CommodityHolding } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import PageLayout from '../components/PageLayout';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { BitcoinIcon } from '../components/icons/BitcoinIcon';
import { CubeIcon } from '../components/icons/CubeIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import InfoHint from '../components/InfoHint';
import { getAICommodityPrices, formatAiError } from '../services/geminiService';

const CommodityHoldingModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => void;
    holdingToEdit: CommodityHolding | null;
}> = ({ isOpen, onClose, onSave, holdingToEdit }) => {
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [goldKarat, setGoldKarat] = useState<NonNullable<CommodityHolding['goldKarat']>>(24);
    const [purchaseValue, setPurchaseValue] = useState('');
    const [currentValue, setCurrentValue] = useState('');
    const [zakahClass, setZakahClass] = useState<CommodityHolding['zakahClass']>('Zakatable');
    const [owner, setOwner] = useState('');
    
    useEffect(() => {
        if (holdingToEdit) {
            setName(holdingToEdit.name);
            setQuantity(String(holdingToEdit.quantity));
            setUnit(holdingToEdit.unit);
            setGoldKarat((holdingToEdit.goldKarat as NonNullable<CommodityHolding['goldKarat']>) || 24);
            setPurchaseValue(String(holdingToEdit.purchaseValue));
            setCurrentValue(String(holdingToEdit.currentValue ?? ''));
            setZakahClass(holdingToEdit.zakahClass);
            setOwner(holdingToEdit.owner || '');
        } else {
            setName('Gold'); setQuantity(''); setUnit('gram'); setGoldKarat(24); setPurchaseValue(''); setCurrentValue(''); setZakahClass('Zakatable'); setOwner('');
        }
    }, [holdingToEdit, isOpen]);

    useEffect(() => {
        if (name === 'Gold' || name === 'Silver') setUnit('gram');
        else if (name === 'Bitcoin') setUnit('BTC');
        else setUnit('unit');
    }, [name]);

    const getSymbol = (name: CommodityHolding['name'], unit: CommodityHolding['unit'], karat?: CommodityHolding['goldKarat']) => {
        if (name === 'Gold') {
            const k = (karat || 24);
            return `${unit === 'gram' ? 'XAU_GRAM' : 'XAU_OUNCE'}_${k}K`;
        }
        if (name === 'Silver') return unit === 'gram' ? 'XAG_GRAM' : 'XAG_OUNCE';
        if (name === 'Bitcoin') return 'BTC_USD';
        return 'OTHER';
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedPurchaseValue = parseFloat(purchaseValue);
        if (isNaN(parsedPurchaseValue) || parsedPurchaseValue <= 0) {
            alert("Purchase Value must be a positive number.");
            return;
        }

        const holdingData = {
            name, quantity: parseFloat(quantity) || 0, unit,
            purchaseValue: parsedPurchaseValue,
            currentValue: parseFloat(currentValue) || 0,
            symbol: getSymbol(name, unit, goldKarat), zakahClass,
            goldKarat: name === 'Gold' ? goldKarat : undefined,
            owner: owner || undefined,
        };
        if (holdingToEdit) onSave({ ...holdingToEdit, ...holdingData });
        else onSave(holdingData);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={holdingToEdit ? 'Edit Commodity' : 'Add Commodity'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Commodity <InfoHint text="Gold, Silver, Bitcoin, or Other; affects unit options and Zakat treatment." /></label>
                    <select value={name} onChange={e => setName(e.target.value as any)} className="select-base w-full"><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bitcoin">Bitcoin</option><option value="Other">Other</option></select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Quantity & Unit <InfoHint text="Amount you hold; unit (grams/ounces/BTC) for correct valuation and Zakat." /></label>
                    <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="input-base w-full" /><select value={unit} onChange={e => setUnit(e.target.value as any)} className="select-base w-full">{name === 'Gold' || name === 'Silver' ? <> <option value="gram">grams</option> <option value="ounce">ounces</option> </> : name === 'Bitcoin' ? <option value="BTC">BTC</option> : <option value="unit">units</option>}</select></div>
                    {name === 'Gold' && (
                        <div className="mt-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Gold Purity (Karat) <InfoHint text="Gold valuation depends on purity. 24K is pure gold; 22K/21K/18K are priced proportionally." /></label>
                            <select value={goldKarat} onChange={e => setGoldKarat(Number(e.target.value) as NonNullable<CommodityHolding['goldKarat']>)} className="select-base w-full">
                                <option value={24}>24K</option>
                                <option value={22}>22K</option>
                                <option value={21}>21K</option>
                                <option value={18}>18K</option>
                            </select>
                        </div>
                    )}
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Purchase & Current Value <InfoHint text="Cost basis and current market value; use Update Prices to refresh current value from APIs." /></label>
                    <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Purchase Value" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required min="0" step="any" className="input-base w-full" /><input type="number" placeholder="Current Value" value={currentValue} onChange={e => setCurrentValue(e.target.value)} required min="0" step="any" className="input-base w-full" /></div>
                </div>
                 <div><label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Owner (optional) <InfoHint text="For shared/family tracking (e.g. Spouse, Son)." /></label><input type="text" placeholder="e.g., Spouse, Son" value={owner} onChange={e => setOwner(e.target.value)} className="input-base mt-1 w-full" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Zakat Classification <InfoHint text="Zakatable: included in Zakat calculation. Non-Zakatable: excluded (e.g. personal use)." /></label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="select-base mt-1 w-full"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <button type="submit" className="w-full btn-primary">Save</button>
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
        <div className="section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-4">
                        {getIcon(holding.name)}
                        <div><h3 className="font-bold text-dark text-xl">{holding.name}</h3><p className="text-sm text-gray-500">{holding.quantity} {holding.unit}{holding.name === 'Gold' && holding.goldKarat ? ` • ${holding.goldKarat}K` : ''}</p></div>
                    </div>
                    <div className="flex space-x-1"><button type="button" onClick={() => onEdit(holding)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit commodity"><PencilIcon className="h-4 w-4"/></button><button type="button" onClick={() => onDelete(holding)} className="p-1 text-gray-400 hover:text-danger" aria-label="Delete commodity"><TrashIcon className="h-4 w-4"/></button></div>
                </div>
                {holding.owner && <span className="mt-2 inline-block text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{holding.owner}</span>}
                <div className="mt-4 space-y-3 min-w-0 overflow-hidden">
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-sm text-gray-500">Current Value</dt><dd className="metric-value font-semibold text-dark text-2xl">{formatCurrencyString(holding.currentValue ?? 0)}</dd></div>
                    <div className="grid grid-cols-2 gap-4 text-sm min-w-0"><div className="min-w-0 overflow-hidden"><dt className="metric-label text-gray-500">Purchase Value</dt><dd className="metric-value font-medium text-gray-700">{formatCurrencyString(holding.purchaseValue)}</dd></div><div className="min-w-0 overflow-hidden"><dt className="metric-label text-gray-500">Unrealized G/L</dt><dd className="metric-value font-semibold">{formatCurrency(unrealizedGain, { colorize: true })}</dd></div></div>
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
        return (data?.commodityHoldings ?? []).reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
    }, [data?.commodityHoldings]);

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
        if (!(data?.commodityHoldings ?? []).length) return;
        setIsUpdatingPrices(true);
        try {
            const { prices } = await getAICommodityPrices((data?.commodityHoldings ?? []).map(c => ({ symbol: c.symbol ?? '', name: c.name ?? '', goldKarat: c.goldKarat })));
            const match = (p: { symbol: string }, h: CommodityHolding) => (p.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase();
            if (prices.length > 0) {
                const updates = (data?.commodityHoldings ?? [])
                    .map(h => {
                        const newPriceInfo = prices.find(p => match(p, h));
                        return newPriceInfo ? { id: h.id, currentValue: newPriceInfo.price * h.quantity } : null;
                    })
                    .filter((u): u is { id: string; currentValue: number; } => u !== null);
                
                if (updates.length > 0) {
                    await batchUpdateCommodityHoldingValues(updates);
                    if (updates.length < (data?.commodityHoldings ?? []).length) {
                        console.warn(`Updated ${updates.length} of ${(data?.commodityHoldings ?? []).length} commodity prices.`);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to update commodity prices:", error);
            alert(`Failed to update prices.\n\n${formatAiError(error)}`);
        } finally {
            setIsUpdatingPrices(false);
        }
    };
    
    return (
        <PageLayout title="Metals & Crypto" description="Gold, silver, Bitcoin, and other commodities. Use Update Prices to refresh values; Zakat classification affects Zakat page." action={<button type="button" onClick={() => handleOpenCommodityModal()} className="btn-primary">Add Commodity</button>}>
        <div className="space-y-6">
            <Card title="Total Commodity Value" value={formatCurrencyString(totalCommodityValue)} />

            <div className="section-card">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                    <h3 className="section-title mb-0">Holdings</h3>
                    <button type="button" onClick={handleUpdatePrices} disabled={isUpdatingPrices} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isUpdatingPrices ? 'Updating Prices...' : 'Update Prices via AI'}
                    </button>
                </div>
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {(data?.commodityHoldings ?? []).map(h => <CommodityHoldingCard key={h.id} holding={h} onEdit={handleOpenCommodityModal} onDelete={handleOpenCommodityDeleteModal} />)}
                    {(data?.commodityHoldings ?? []).length === 0 && <p className="text-sm text-gray-500 md:col-span-2 xl:col-span-3 text-center py-8">No commodities added yet.</p>}
                </div>
            </div>
            
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} />
            <DeleteConfirmationModal isOpen={!!commodityToDelete} onClose={() => setCommodityToDelete(null)} onConfirm={handleConfirmCommodityDelete} itemName={commodityToDelete?.name || ''} />
        </div>
        </PageLayout>
    );
};

export default Commodities;