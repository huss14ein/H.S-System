
import React, { useState, useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { Liability } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { HomeIcon } from '../components/icons/HomeIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const LiabilityModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (liability: Liability) => void; liabilityToEdit: Liability | null; }> = ({ isOpen, onClose, onSave, liabilityToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Liability['type']>('Loan');
    const [amount, setAmount] = useState('');

    React.useEffect(() => {
        if (liabilityToEdit) {
            setName(liabilityToEdit.name);
            setType(liabilityToEdit.type);
            setAmount(String(Math.abs(liabilityToEdit.amount)));
        } else {
            setName('');
            setType('Loan');
            setAmount('');
        }
    }, [liabilityToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newLiability: Liability = {
            id: liabilityToEdit ? liabilityToEdit.id : `liab${Date.now()}`,
            name,
            type,
            amount: -Math.abs(parseFloat(amount) || 0),
        };
        onSave(newLiability);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={liabilityToEdit ? 'Edit Liability' : 'Add New Liability'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Liability Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <select value={type} onChange={e => setType(e.target.value as any)} required className="w-full p-2 border border-gray-300 rounded-md">
                    <option value="Credit Card">Credit Card</option>
                    <option value="Loan">Loan (e.g., Car, Institutional)</option>
                    <option value="Personal Loan">Personal Loan (from individual)</option>
                    <option value="Mortgage">Mortgage</option>
                </select>
                <input type="number" placeholder="Total Amount Owed" value={amount} onChange={e => setAmount(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Liability</button>
            </form>
        </Modal>
    );
};

const LiabilityCardComponent: React.FC<{ liability: Liability, onEdit: (l: Liability) => void, onDelete: (l: Liability) => void }> = ({ liability, onEdit, onDelete }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const getIcon = (type: Liability['type']) => {
        const iconClass = "h-8 w-8";
        switch (type) {
            case 'Mortgage': return <HomeIcon className={`${iconClass} text-blue-500`} />;
            case 'Loan': return <ShieldCheckIcon className={`${iconClass} text-purple-500`} />;
            case 'Personal Loan': return <ShieldCheckIcon className={`${iconClass} text-indigo-500`} />;
            case 'Credit Card': return <CreditCardIcon className={`${iconClass} text-red-500`} />;
        }
    };

    return (
        <div className="bg-white rounded-lg shadow p-5 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300">
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    {getIcon(liability.type)}
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500">{liability.type}</p>
                    </div>
                </div>
                 <div className="flex space-x-1">
                    <button onClick={() => onEdit(liability)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                    <button onClick={() => onDelete(liability)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            <div className="mt-4 text-right">
                <p className="text-sm text-gray-500">Amount Owed</p>
                <p className="text-2xl font-semibold text-danger">{formatCurrencyString(Math.abs(liability.amount))}</p>
            </div>
        </div>
    );
};

const Liabilities: React.FC = () => {
    const { data, addLiability, updateLiability, deleteLiability } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [liabilityToEdit, setLiabilityToEdit] = useState<Liability | null>(null);
    const [liabilityToDelete, setLiabilityToDelete] = useState<Liability | null>(null);

    const allLiabilities = useMemo(() => {
        const creditCardDebts = data.accounts
            .filter(a => a.type === 'Credit' && a.balance < 0)
            .map(a => ({ id: a.id, name: a.name, type: 'Credit Card' as const, amount: a.balance }));
        return [...data.liabilities, ...creditCardDebts];
    }, [data.liabilities, data.accounts]);
    
    const { totalDebt, debtToAssetRatio } = useMemo(() => {
        const totalDebt = allLiabilities.reduce((sum, liab) => sum + Math.abs(liab.amount), 0);
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
        return { totalDebt, debtToAssetRatio };
    }, [allLiabilities, data.assets, data.accounts]);
    
    const handleOpenModal = (liability: Liability | null = null) => {
        setLiabilityToEdit(liability);
        setIsModalOpen(true);
    };

    const handleSaveLiability = (liability: Liability) => {
        if (allLiabilities.some(l => l.id === liability.id)) {
            updateLiability(liability);
        } else {
            addLiability(liability);
        }
    };

    const handleOpenDeleteModal = (liability: Liability) => {
        setLiabilityToDelete(liability);
    };

    const handleConfirmDelete = () => {
        if (liabilityToDelete) {
            deleteLiability(liabilityToDelete.id);
            setLiabilityToDelete(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Liabilities</h1>
                <button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">
                    Add New Liability
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Card title="Total Debt" value={formatCurrencyString(totalDebt)} />
                 <Card title="Debt-to-Asset Ratio" value={`${debtToAssetRatio.toFixed(2)}%`} tooltip="The percentage of your assets that are financed through debt." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {allLiabilities.map(liab => (
                    <LiabilityCardComponent key={liab.id} liability={liab} onEdit={handleOpenModal} onDelete={handleOpenDeleteModal} />
                ))}
            </div>
            
            <LiabilityModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveLiability} liabilityToEdit={liabilityToEdit} />
            <DeleteConfirmationModal 
                isOpen={!!liabilityToDelete}
                onClose={() => setLiabilityToDelete(null)}
                onConfirm={handleConfirmDelete}
                itemName={liabilityToDelete?.name || ''}
            />
        </div>
    );
};

export default Liabilities;