import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Asset, Goal, AssetType, CommodityHolding } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { HomeModernIcon } from '../components/icons/HomeModernIcon';
import { TruckIcon } from '../components/icons/TruckIcon';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { QuestionMarkCircleIcon } from '../components/icons/QuestionMarkCircleIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { LinkIcon } from '../components/icons/LinkIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { BitcoinIcon } from '../components/icons/BitcoinIcon';
import { CubeIcon } from '../components/icons/CubeIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { getAICommodityPrices } from '../services/geminiService';
import AddMenu from '../components/AddMenu';

// --- Physical Asset Components ---
const AssetModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (asset: Asset) => void; assetToEdit: Asset | null; }> = ({ isOpen, onClose, onSave, assetToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<AssetType>('Property');
    const [value, setValue] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [isRental, setIsRental] = useState(false);
    const [monthlyRent, setMonthlyRent] = useState('');
    const [owner, setOwner] = useState('');

    React.useEffect(() => {
        if (assetToEdit) {
            setName(assetToEdit.name);
            setType(assetToEdit.type);
            setValue(assetToEdit.value.toString());
            setPurchasePrice(assetToEdit.purchasePrice?.toString() || '');
            setIsRental(assetToEdit.isRental || false);
            setMonthlyRent(assetToEdit.monthlyRent?.toString() || '');
            setOwner(assetToEdit.owner || '');
        } else {
            setName(''); setType('Property'); setValue(''); setPurchasePrice('');
            setIsRental(false); setMonthlyRent(''); setOwner('');
        }
    }, [assetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newAsset: Asset = {
            id: assetToEdit ? assetToEdit.id : `asset${Date.now()}`,
            name, type, value: parseFloat(value) || 0,
            purchasePrice: parseFloat(purchasePrice) || undefined,
            isRental: type === 'Property' ? isRental : undefined,
            monthlyRent: type === 'Property' && isRental ? parseFloat(monthlyRent) || 0 : undefined,
            goalId: assetToEdit?.goalId, owner: owner || undefined,
        };
        onSave(newAsset); onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={assetToEdit ? 'Edit Physical Asset' : 'Add Physical Asset'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Asset Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border rounded-md"/>
                <select value={type} onChange={e => setType(e.target.value as AssetType)} required className="w-full p-2 border rounded-md">
                    <option value="Property">Property</option>
                    <option value="Vehicle">Vehicle</option>
                    <option value="Other">Other</option>
                </select>
                <input type="number" placeholder="Current Value" value={value} onChange={e => setValue(e.target.value)} required className="w-full p-2 border rounded-md"/>
                <input type="number" placeholder="Purchase Price (optional)" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="w-full p-2 border rounded-md"/>
                <input type="text" placeholder="Owner (e.g., Spouse, Son)" value={owner} onChange={e => setOwner(e.target.value)} className="w-full p-2 border rounded-md" />
                {type === 'Property' && (
                    <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center"><input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} className="h-4 w-4 text-primary rounded"/> <span className="ml-2">Is this a rental property?</span></label>
                        {isRental && <input type="number" placeholder="Monthly Rent" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} className="w-full p-2 border rounded-md"/>}
                    </div>
                )}
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Asset</button>
            </form>
        </Modal>
    );
};
const AssetCardComponent: React.FC<{ asset: Asset, onEdit: (asset: Asset) => void, onDelete: (asset: Asset | CommodityHolding) => void, onLinkGoal: (assetId: string, goalId: string) => void, goals: Goal[] }> = ({ asset, onEdit, onDelete, onLinkGoal, goals }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const getAssetIcon = (type: Asset['type']) => {
        const iconClass = "h-8 w-8";
        switch (type) {
            case 'Property': return <HomeModernIcon className={`${iconClass} text-blue-500`} />;
            case 'Vehicle': return <TruckIcon className={`${iconClass} text-green-500`} />;
            default: return <QuestionMarkCircleIcon className={`${iconClass} text-gray-500`} />;
        }
    };
    const unrealizedGain = asset.purchasePrice ? asset.value - asset.purchasePrice : null;
    const linkedGoal = asset.goalId ? goals.find(g => g.id === asset.goalId) : null;
    return (
        <div className="bg-white rounded-lg shadow p-5 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-3">{getAssetIcon(asset.type)}<div><h3 className="font-bold text-dark text-lg">{asset.name}</h3><p className="text-sm text-gray-500">{asset.type}</p></div></div>
                    <div className="flex space-x-1"><button onClick={() => onEdit(asset)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button><button onClick={() => onDelete(asset)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button></div>
                </div>
                {asset.owner && <span className="mt-2 inline-block text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{asset.owner}</span>}
                <div className="mt-4 space-y-3">
                     <div><dt className="text-xs text-gray-500">Current Value</dt><dd className="font-semibold text-dark text-xl">{formatCurrencyString(asset.value)}</dd></div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><dt className="text-gray-500">Purchase Price</dt><dd className="font-medium text-gray-700">{asset.purchasePrice ? formatCurrencyString(asset.purchasePrice) : 'N/A'}</dd></div>
                        <div><dt className="text-gray-500">Unrealized G/L</dt><dd className="font-semibold">{unrealizedGain !== null ? formatCurrency(unrealizedGain, { colorize: true }) : 'N/A'}</dd></div>
                    </div>
                    {asset.isRental && asset.monthlyRent && (<div><dt className="text-gray-500">Monthly Rent</dt><dd className="font-semibold text-dark">{formatCurrencyString(asset.monthlyRent)}</dd></div>)}
                </div>
            </div>
             <div className="border-t mt-4 pt-4 flex items-center justify-between">
                {linkedGoal ? (<span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><LinkIcon className="h-4 w-4 mr-1.5" />Linked to: {linkedGoal.name}</span>) : <span className="text-xs text-gray-400">Not linked to a goal</span>}
                <select value={asset.goalId || 'none'} onChange={(e) => onLinkGoal(asset.id, e.target.value)} className="text-xs border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary py-1 pl-2 pr-7" aria-label={`Link ${asset.name} to a goal`}>
                    <option value="none">Link to Goal...</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            </div>
        </div>
    );
};
// --- End Physical Asset Components ---

// --- Commodity Components ---
const CommodityHoldingModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => void; holdingToEdit: CommodityHolding | null; }> = ({ isOpen, onClose, onSave, holdingToEdit }) => {
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [purchaseValue, setPurchaseValue] = useState('');
    const [currentValue, setCurrentValue] = useState('');
    const [zakahClass, setZakahClass] = useState<CommodityHolding['zakahClass']>('Zakatable');
    const [owner, setOwner] = useState('');
    
    useEffect(() => {
        if (holdingToEdit) {
            setName(holdingToEdit.name); setQuantity(String(holdingToEdit.quantity)); setUnit(holdingToEdit.unit);
            setPurchaseValue(String(holdingToEdit.purchaseValue)); setCurrentValue(String(holdingToEdit.currentValue));
            setZakahClass(holdingToEdit.zakahClass); setOwner(holdingToEdit.owner || '');
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
            symbol: getSymbol(name, unit), zakahClass, owner: owner || undefined,
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
                <div><label className="block text-sm font-medium text-gray-700">Zakat Classification</label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="mt-1 w-full p-2 border rounded-md"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save</button>
            </form>
        </Modal>
    );
};
const CommodityHoldingCard: React.FC<{ holding: CommodityHolding; onEdit: (h: CommodityHolding) => void; onDelete: (h: Asset | CommodityHolding) => void; }> = ({ holding, onEdit, onDelete }) => {
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
// --- End Commodity Components ---

interface AssetsProps { pageAction?: string | null; clearPageAction?: () => void; }

const Assets: React.FC<AssetsProps> = ({ pageAction, clearPageAction }) => {
    const { data, addAsset, updateAsset, deleteAsset, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    // State for both types of modals
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
    const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
    const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Asset | CommodityHolding | null>(null);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);

    useEffect(() => {
        if (pageAction === 'open-asset-modal') {
            handleOpenAssetModal();
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    const { totalAssetValue, totalPhysicalAssetValue, totalCommodityValue, totalRentalIncome } = useMemo(() => {
        const physicalValue = data.assets.reduce((sum, asset) => sum + asset.value, 0);
        const commodityValue = data.commodityHoldings.reduce((sum, h) => sum + h.currentValue, 0);
        const rentalIncome = data.assets.filter(a => a.isRental && a.monthlyRent).reduce((sum, a) => sum + a.monthlyRent!, 0);
        return { totalAssetValue: physicalValue + commodityValue, totalPhysicalAssetValue: physicalValue, totalCommodityValue: commodityValue, totalRentalIncome: rentalIncome };
    }, [data.assets, data.commodityHoldings]);

    // Physical Asset Handlers
    const handleOpenAssetModal = (asset: Asset | null = null) => { setAssetToEdit(asset); setIsAssetModalOpen(true); };
    const handleSaveAsset = (asset: Asset) => { if (data.assets.some(a => a.id === asset.id)) updateAsset(asset); else addAsset(asset); };
    const handleLinkGoal = (assetId: string, goalId: string) => { const asset = data.assets.find(a => a.id === assetId); if (asset) updateAsset({ ...asset, goalId: goalId === 'none' ? undefined : goalId }); };
    
    // Commodity Handlers
    const handleOpenCommodityModal = (holding: CommodityHolding | null = null) => { setCommodityToEdit(holding); setIsCommodityModalOpen(true); };
    const handleSaveCommodity = (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => { 'id' in holding ? updateCommodityHolding(holding) : addCommodityHolding(holding); };

    // Generic Delete Handlers
    const handleOpenDeleteModal = (item: Asset | CommodityHolding) => { setItemToDelete(item); };
    const handleConfirmDelete = () => { if(itemToDelete) { ('unit' in itemToDelete ? deleteCommodityHolding(itemToDelete.id) : deleteAsset(itemToDelete.id)); setItemToDelete(null); } };
    
    const handleUpdatePrices = async () => {
        if (data.commodityHoldings.length === 0) return;
        setIsUpdatingPrices(true);
        setGroundingChunks([]);
        try {
            const { prices, groundingChunks: chunks } = await getAICommodityPrices(data.commodityHoldings.map(c => ({ symbol: c.symbol, name: c.name })));
            if (chunks) {
                setGroundingChunks(chunks);
            }
            if (prices.length > 0) {
                const updates = data.commodityHoldings.map(h => { const p = prices.find(p => p.symbol === h.symbol); return p ? { id: h.id, currentValue: p.price * h.quantity } : null; }).filter((u): u is { id: string; currentValue: number; } => u !== null);
                if (updates.length > 0) await batchUpdateCommodityHoldingValues(updates);
            }
        } catch (error) { console.error("Failed to update prices:", error); } 
        finally { setIsUpdatingPrices(false); }
    };

    const addActions = [
        { label: 'Physical Asset', icon: HomeModernIcon, onClick: () => handleOpenAssetModal() },
        { label: 'Commodity', icon: CubeIcon, onClick: () => handleOpenCommodityModal() }
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Assets</h1>
                <AddMenu actions={addActions} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card title="Total Asset Value" value={formatCurrencyString(totalAssetValue)} />
                <Card title="Physical Asset Value" value={formatCurrencyString(totalPhysicalAssetValue)} />
                <Card title="Metals & Crypto Value" value={formatCurrencyString(totalCommodityValue)} />
                <Card title="Monthly Rental Income" value={formatCurrencyString(totalRentalIncome)} />
            </div>

            <section className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-dark mb-4">Physical Assets</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {data.assets.map(asset => (<AssetCardComponent key={asset.id} asset={asset} onEdit={handleOpenAssetModal} onDelete={handleOpenDeleteModal} onLinkGoal={handleLinkGoal} goals={data.goals} />))}
                    {data.assets.length === 0 && <p className="text-sm text-gray-500 md:col-span-2 xl:col-span-3 text-center py-8">No physical assets added yet.</p>}
                </div>
            </section>
            
            <section className="bg-white p-6 rounded-lg shadow">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                    <h2 className="text-xl font-semibold text-dark">Metals & Crypto</h2>
                    <button onClick={handleUpdatePrices} disabled={isUpdatingPrices} className="flex items-center px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400"><SparklesIcon className="h-4 w-4 mr-2" />{isUpdatingPrices ? 'Updating...' : 'Update Prices via AI'}</button>
                </div>
                {groundingChunks.length > 0 && (
                    <div className="text-xs text-gray-500 mb-4 p-3 bg-gray-50 rounded-md border">
                        <p className="font-semibold text-gray-700">Sources:</p>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            {groundingChunks.map((chunk, index) => (
                                chunk.web && <li key={index}><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{chunk.web.title || chunk.web.uri}</a></li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {data.commodityHoldings.map(h => <CommodityHoldingCard key={h.id} holding={h} onEdit={handleOpenCommodityModal} onDelete={handleOpenDeleteModal} />)}
                    {data.commodityHoldings.length === 0 && <p className="text-sm text-gray-500 md:col-span-2 xl:col-span-3 text-center py-8">No commodities added yet.</p>}
                </div>
            </section>
            
            <AssetModal isOpen={isAssetModalOpen} onClose={() => setIsAssetModalOpen(false)} onSave={handleSaveAsset} assetToEdit={assetToEdit} />
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </div>
    );
};

export default Assets;
