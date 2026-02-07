import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Account, InvestmentPortfolio } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { PortfolioModal } from './Investments'; // Re-using the modal for consistency
import { PlusIcon } from '../components/icons/PlusIcon';

const AccountModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id' | 'balance'> | Account) => void;
    accountToEdit: Account | null;
}> = ({ isOpen, onClose, onSave, accountToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Account['type']>('Checking');

    useEffect(() => {
        if (accountToEdit) {
            setName(accountToEdit.name);
            setType(accountToEdit.type);
        } else {
            setName('');
            setType('Checking');
        }
    }, [accountToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const accountData = { name, type };

        if (accountToEdit) {
            onSave({ ...accountToEdit, ...accountData });
        } else {
            onSave(accountData);
        }
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={accountToEdit ? 'Edit Account' : 'Add New Account'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Account Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <select value={type} onChange={e => setType(e.target.value as Account['type'])} required className="w-full p-2 border border-gray-300 rounded-md" disabled={!!accountToEdit}>
                    <option value="Checking">Checking</option>
                    <option value="Savings">Savings</option>
                    <option value="Credit">Credit Card</option>
                    <option value="Investment">Investment Platform</option>
                </select>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Account</button>
            </form>
        </Modal>
    );
};

const AccountCardComponent: React.FC<{
    account: Account;
    portfolios: InvestmentPortfolio[];
    onEditAccount: (acc: Account) => void;
    onDeleteAccount: (acc: Account) => void;
    onAddPortfolio: (accountId: string) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
}> = (props) => {
    const { account, portfolios, onEditAccount, onDeleteAccount, onAddPortfolio, onEditPortfolio, onDeletePortfolio } = props;
    const { formatCurrencyString } = useFormatCurrency();
    
    const getAccountIcon = (type: Account['type']) => {
        const iconClass = "h-8 w-8";
        switch (type) {
            case 'Checking': case 'Savings': return <BanknotesIcon className={`${iconClass} text-green-500`} />;
            case 'Credit': return <CreditCardIcon className={`${iconClass} text-red-500`} />;
            case 'Investment': return <ArrowTrendingUpIcon className={`${iconClass} text-blue-500`} />;
            default: return <BuildingLibraryIcon className={`${iconClass} text-gray-500`} />;
        }
    };
    
    return (
        <div className="bg-white rounded-lg shadow p-5 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-3">
                        {getAccountIcon(account.type)}
                        <div>
                            <h3 className="font-bold text-dark text-lg">{account.name}</h3>
                            <p className="text-sm text-gray-500">{account.type}</p>
                        </div>
                    </div>
                    <div className="flex space-x-1">
                        <button onClick={() => onEditAccount(account)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                        <button onClick={() => onDeleteAccount(account)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                </div>
                <div className="mt-4 text-right">
                    <p className="text-sm text-gray-500">Current Balance</p>
                    <p className={`text-2xl font-semibold ${account.balance >= 0 ? 'text-dark' : 'text-danger'}`}>{formatCurrencyString(account.balance)}</p>
                </div>
            </div>
            {account.type === 'Investment' && (
                <div className="border-t mt-4 pt-4 space-y-2">
                    <h4 className="font-semibold text-sm text-gray-600 mb-2">Portfolios</h4>
                    {portfolios.map(p => (
                        <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md">
                            <span className="font-medium text-gray-800">{p.name}</span>
                            <div>
                                <button onClick={() => onEditPortfolio(p)} className="p-1 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                                <button onClick={() => onDeletePortfolio(p)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                            </div>
                        </div>
                    ))}
                    <button onClick={() => onAddPortfolio(account.id)} className="w-full mt-2 text-sm flex items-center justify-center gap-2 text-primary hover:bg-primary-50 p-2 rounded-lg border-2 border-dashed">
                        <PlusIcon className="h-5 w-5"/> Add Portfolio
                    </button>
                </div>
            )}
        </div>
    );
};

const Platforms: React.FC = () => {
    const { data, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    // State for Account Modals
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [accountToEdit, setAccountToEdit] = useState<Account | null>(null);

    // State for Portfolio Modals
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [portfolioToEdit, setPortfolioToEdit] = useState<InvestmentPortfolio | null>(null);
    const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
    
    // State for Delete Confirmation Modal (handles both)
    const [itemToDelete, setItemToDelete] = useState<Account | InvestmentPortfolio | null>(null);
    
    const { cashAccounts, creditAccounts, investmentPlatforms, totalCash, totalCredit } = useMemo(() => {
        const cash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type));
        const credit = data.accounts.filter(a => a.type === 'Credit');
        const investments = data.accounts.filter(a => a.type === 'Investment').map(acc => ({
            ...acc,
            portfolios: data.investments.filter(p => p.accountId === acc.id)
        }));

        const totalCash = cash.reduce((sum, acc) => sum + acc.balance, 0);
        const totalCredit = credit.reduce((sum, acc) => sum + acc.balance, 0);

        return { cashAccounts: cash, creditAccounts: credit, investmentPlatforms: investments, totalCash, totalCredit };
    }, [data.accounts, data.investments]);
    
    // --- Account Handlers ---
    const handleOpenAccountModal = (account: Account | null = null) => { setAccountToEdit(account); setIsAccountModalOpen(true); };
    const handleSaveAccount = (account: Omit<Account, 'id' | 'balance'> | Account) => { if ('id' in account) updatePlatform(account); else addPlatform(account); };
    
    // --- Portfolio Handlers ---
    const handleOpenPortfolioModal = (portfolio: InvestmentPortfolio | null, accountId: string | null) => { setPortfolioToEdit(portfolio); setCurrentAccountId(accountId); setIsPortfolioModalOpen(true); };
    const handleSavePortfolio = (portfolio: any) => { if (portfolio.id) updatePortfolio(portfolio); else addPortfolio(portfolio); };

    // --- Delete Handler (for both) ---
    const handleOpenDeleteModal = (item: Account | InvestmentPortfolio) => setItemToDelete(item);
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        if ('accountId' in itemToDelete) { // It's a portfolio
            deletePortfolio(itemToDelete.id);
        } else { // It's an account
            deletePlatform(itemToDelete.id);
        }
        setItemToDelete(null);
    };
    
    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Platforms & Accounts</h1>
                <button onClick={() => handleOpenAccountModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">Add New Account</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Card title="Total Cash Balance" value={formatCurrencyString(totalCash)} />
                 <Card title="Total Credit Balance" value={formatCurrencyString(totalCredit)} />
            </div>
            
            <section>
                <h2 className="text-2xl font-semibold text-dark mb-4">Cash Accounts</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {cashAccounts.map(acc => <AccountCardComponent key={acc.id} account={acc} portfolios={[]} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onAddPortfolio={()=>{}} onEditPortfolio={()=>{}} onDeletePortfolio={()=>{}} />)}
                </div>
            </section>

             <section>
                <h2 className="text-2xl font-semibold text-dark mb-4">Credit Cards</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {creditAccounts.map(acc => <AccountCardComponent key={acc.id} account={acc} portfolios={[]} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onAddPortfolio={()=>{}} onEditPortfolio={()=>{}} onDeletePortfolio={()=>{}} />)}
                </div>
            </section>

             <section>
                <h2 className="text-2xl font-semibold text-dark mb-4">Investment Platforms</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {investmentPlatforms.map(acc => <AccountCardComponent key={acc.id} account={acc} portfolios={acc.portfolios} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onAddPortfolio={(accountId) => handleOpenPortfolioModal(null, accountId)} onEditPortfolio={(p) => handleOpenPortfolioModal(p, p.accountId)} onDeletePortfolio={handleOpenDeleteModal} />)}
                </div>
            </section>

            <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} onSave={handleSaveAccount} accountToEdit={accountToEdit} />
            <PortfolioModal isOpen={isPortfolioModalOpen} onClose={() => setIsPortfolioModalOpen(false)} onSave={handleSavePortfolio} portfolioToEdit={portfolioToEdit} accountId={currentAccountId} investmentAccounts={data.accounts.filter(a => a.type === 'Investment')} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </div>
    );
};

export default Platforms;