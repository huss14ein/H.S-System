
import React, { useState, useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { Asset, Goal, AssetType } from '../types';
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

const AssetModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (asset: Asset) => void; assetToEdit: Asset | null; }> = ({ isOpen, onClose, onSave, assetToEdit }) => {
    const [name, setName] = useState('');
// Fix: Changed state type to AssetType to match the data model and prevent type errors.
    const [type, setType] = useState<AssetType>('Property');
    const [value, setValue] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [isRental, setIsRental] = useState(false);
    const [monthlyRent, setMonthlyRent] = useState('');

    React.useEffect(() => {
        if (assetToEdit) {
            setName(assetToEdit.name);
            setType(assetToEdit.type);
            setValue(assetToEdit.value.toString());
            setPurchasePrice(assetToEdit.purchasePrice?.toString() || '');
            setIsRental(assetToEdit.isRental || false);
            setMonthlyRent(assetToEdit.monthlyRent?.toString() || '');
        } else {
            setName('');
            setType('Property');
            setValue('');
            setPurchasePrice('');
            setIsRental(false);
            setMonthlyRent('');
        }
    }, [assetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newAsset: Asset = {
            id: assetToEdit ? assetToEdit.id : `asset${Date.now()}`,
            name,
            type,
            value: parseFloat(value) || 0,
            purchasePrice: parseFloat(purchasePrice) || undefined,
            isRental: type === 'Property' ? isRental : undefined,
            monthlyRent: type === 'Property' && isRental ? parseFloat(monthlyRent) || 0 : undefined,
            goalId: assetToEdit?.goalId,
        };
        onSave(newAsset);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={assetToEdit ? 'Edit Asset' : 'Add New Asset'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Asset Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <select value={type} onChange={e => setType(e.target.value as any)} required className="w-full p-2 border border-gray-300 rounded-md">
                    <option value="Property">Property</option>
                    <option value="Vehicle">Vehicle</option>
{/* Fix: Changed the value for 'Gold' to 'Gold and precious metals' to match the AssetType definition. */}
                    <option value="Gold and precious metals">Gold</option>
                    <option value="Other">Other</option>
                </select>
                <input type="number" placeholder="Current Value" value={value} onChange={e => setValue(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <input type="number" placeholder="Purchase Price (optional)" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md"/>

                {type === 'Property' && (
                    <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center"><input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} className="h-4 w-4 text-primary rounded"/> <span className="ml-2">Is this a rental property?</span></label>
                        {isRental && <input type="number" placeholder="Monthly Rent" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md"/>}
                    </div>
                )}
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Asset</button>
            </form>
        </Modal>
    );
};

const AssetCardComponent: React.FC<{ asset: Asset, onEdit: (asset: Asset) => void, onDelete: (asset: Asset) => void, onLinkGoal: (assetId: string, goalId: string) => void, goals: Goal[] }> = ({ asset, onEdit, onDelete, onLinkGoal, goals }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    
    const getAssetIcon = (type: Asset['type']) => {
        const iconClass = "h-8 w-8";
        switch (type) {
            case 'Property': return <HomeModernIcon className={`${iconClass} text-blue-500`} />;
            case 'Vehicle': return <TruckIcon className={`${iconClass} text-green-500`} />;
{/* Fix: Changed case from 'Gold' to 'Gold and precious metals' to match AssetType and fix comparison error. */}
            case 'Gold and precious metals': return <GoldBarIcon className={`${iconClass} text-yellow-500`} />;
            default: return <QuestionMarkCircleIcon className={`${iconClass} text-gray-500`} />;
        }
    };

    const unrealizedGain = asset.purchasePrice ? asset.value - asset.purchasePrice : null;
    const linkedGoal = asset.goalId ? goals.find(g => g.id === asset.goalId) : null;

    return (
        <div className="bg-white rounded-lg shadow p-5 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-3">
                        {getAssetIcon(asset.type)}
                        <div>
                            <h3 className="font-bold text-dark text-lg">{asset.name}</h3>
                            <p className="text-sm text-gray-500">{asset.type}</p>
                        </div>
                    </div>
                    <div className="flex space-x-1">
                        <button onClick={() => onEdit(asset)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                        <button onClick={() => onDelete(asset)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                </div>
                <div className="mt-4 space-y-3">
                     <div>
                        <dt className="text-xs text-gray-500">Current Value</dt>
                        <dd className="font-semibold text-dark text-xl">{formatCurrencyString(asset.value)}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <dt className="text-gray-500">Purchase Price</dt>
                            <dd className="font-medium text-gray-700">{asset.purchasePrice ? formatCurrencyString(asset.purchasePrice) : 'N/A'}</dd>
                        </div>
                        <div>
                            <dt className="text-gray-500">Unrealized G/L</dt>
                            <dd className="font-semibold">
                                {unrealizedGain !== null ? formatCurrency(unrealizedGain, { colorize: true }) : 'N/A'}
                            </dd>
                        </div>
                    </div>
                    {asset.isRental && asset.monthlyRent && (
                         <div>
                            <dt className="text-gray-500">Monthly Rent</dt>
                            <dd className="font-semibold text-dark">{formatCurrencyString(asset.monthlyRent)}</dd>
                        </div>
                    )}
                </div>
            </div>
             <div className="border-t mt-4 pt-4 flex items-center justify-between">
                {linkedGoal ? (
                     <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <LinkIcon className="h-4 w-4 mr-1.5" />
                        Linked to: {linkedGoal.name}
                    </span>
                ) : <span className="text-xs text-gray-400">Not linked to a goal</span>}
                
                <select
                    value={asset.goalId || 'none'}
                    onChange={(e) => onLinkGoal(asset.id, e.target.value)}
                    className="text-xs border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary py-1 pl-2 pr-7"
                    aria-label={`Link ${asset.name} to a goal`}
                >
                    <option value="none">Link to Goal...</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            </div>
        </div>
    );
};


const Assets: React.FC = () => {
    const { data, addAsset, updateAsset, deleteAsset } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
    const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);

    const { totalAssetValue, totalRentalIncome } = useMemo(() => {
        const totalAssetValue = data.assets.reduce((sum, asset) => sum + asset.value, 0);
        const totalRentalIncome = data.assets.filter(a => a.isRental && a.monthlyRent).reduce((sum, a) => sum + a.monthlyRent!, 0);
        return { totalAssetValue, totalRentalIncome };
    }, [data.assets]);

    const handleOpenModal = (asset: Asset | null = null) => {
        setAssetToEdit(asset);
        setIsModalOpen(true);
    };

    const handleSaveAsset = (asset: Asset) => {
        if (data.assets.some(a => a.id === asset.id)) {
            updateAsset(asset);
        } else {
            addAsset(asset);
        }
    };
    
    const handleOpenDeleteModal = (asset: Asset) => {
        setAssetToDelete(asset);
        setIsDeleteModalOpen(true);
    };
    
    const handleConfirmDelete = () => {
        if(assetToDelete) {
            deleteAsset(assetToDelete.id);
            setIsDeleteModalOpen(false);
            setAssetToDelete(null);
        }
    };

    const handleLinkGoal = (assetId: string, goalId: string) => {
        const asset = data.assets.find(a => a.id === assetId);
        if (asset) {
            updateAsset({ ...asset, goalId: goalId === 'none' ? undefined : goalId });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Assets</h1>
                <button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add New Asset</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Card title="Total Physical Asset Value" value={formatCurrencyString(totalAssetValue)} />
                 <Card title="Total Monthly Rental Income" value={formatCurrencyString(totalRentalIncome)} tooltip="Gross rental income before expenses." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {data.assets.map(asset => (
                    <AssetCardComponent 
                        key={asset.id}
                        asset={asset}
                        onEdit={handleOpenModal}
                        onDelete={handleOpenDeleteModal}
                        onLinkGoal={handleLinkGoal}
                        goals={data.goals}
                    />
                ))}
            </div>

            <AssetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveAsset} assetToEdit={assetToEdit} />
            <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={assetToDelete?.name || ''} />
        </div>
    );
};

export default Assets;
