
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
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';

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
            status: liabilityToEdit ? liabilityToEdit.status : 'Active',
            goalId: liabilityToEdit?.goalId,
        };
        onSave(newLiability);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={liabilityToEdit ? 'Edit Liability' : 'Add New Liability'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Liability Name <InfoHint text="A clear name (e.g. Car Loan, Mortgage) for tracking and net worth." /></label>
                    <input type="text" placeholder="Liability Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Category of debt; used for reporting and goal linking." /></label>
                    <select value={type} onChange={e => setType(e.target.value as any)} required className="select-base">
                        <option value="Credit Card">Credit Card</option>
                        <option value="Loan">Loan (e.g., Car, Institutional)</option>
                        <option value="Personal Loan">Personal Loan (from individual)</option>
                        <option value="Mortgage">Mortgage</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Total Amount Owed <InfoHint text="Outstanding balance; affects net worth and Zakat deductible liabilities." /></label>
                    <input type="number" placeholder="Total Amount Owed" value={amount} onChange={e => setAmount(e.target.value)} required className="input-base"/>
                </div>
                <button type="submit" className="w-full btn-primary">Save Liability</button>
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
        <div className="section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300">
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    {getIcon(liability.type)}
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500">{liability.type}</p>
                    </div>
                </div>
                 <div className="flex space-x-1">
                    <button type="button" onClick={() => onEdit(liability)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit liability"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDelete(liability)} className="p-1 text-gray-400 hover:text-danger" aria-label="Delete liability"><TrashIcon className="h-4 w-4"/></button>
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

    const allLiabilities: Liability[] = useMemo(() => {
        const creditCardDebts = data.accounts
            .filter(a => a.type === 'Credit' && a.balance < 0)
            .map(a => ({ id: a.id, name: a.name, type: 'Credit Card' as const, amount: a.balance, status: 'Active' as const }));
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
        <PageLayout
            title="Liabilities"
            description="Track loans, mortgages, and credit card debt. Balances are included in net worth and Zakat calculations."
            action={<button type="button" onClick={() => handleOpenModal()} className="btn-primary">Add New Liability</button>}
        >

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <Card title="Total Debt" value={formatCurrencyString(totalDebt)} indicatorColor="red" valueColor="text-red-700" icon={<CreditCardIcon className="h-5 w-5 text-red-600" />} />
                 <Card title="Debt-to-Asset Ratio" value={`${debtToAssetRatio.toFixed(2)}%`} tooltip="The percentage of your assets that are financed through debt." indicatorColor={debtToAssetRatio > 50 ? 'red' : debtToAssetRatio > 25 ? 'yellow' : 'green'} valueColor={debtToAssetRatio > 50 ? 'text-red-700' : debtToAssetRatio > 25 ? 'text-amber-700' : 'text-green-700'} />
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
        </PageLayout>
    );
};

export default Liabilities;