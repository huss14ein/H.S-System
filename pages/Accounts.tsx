import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Account, Page } from '../types';

interface AccountsProps {
    setActivePage?: (page: Page) => void;
}
import Card from '../components/Card';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import AddButton from '../components/AddButton';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';

const AccountModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id' | 'balance'> | Account) => void;
    accountToEdit: Account | null;
}> = ({ isOpen, onClose, onSave, accountToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Account['type']>('Checking');
    const [owner, setOwner] = useState('');

    useEffect(() => {
        if (accountToEdit) {
            setName(accountToEdit.name);
            setType(accountToEdit.type);
            setOwner(accountToEdit.owner || '');
        } else {
            setName('');
            setType('Checking');
            setOwner('');
        }
    }, [accountToEdit, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const accountData = { name, type, owner: owner || undefined };

        try {
            if (accountToEdit) {
                await onSave({ ...accountToEdit, ...accountData });
            } else {
                await onSave(accountData);
            }
            onClose();
        } catch (error) {
            // Error handled in DataContext
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={accountToEdit ? 'Edit Account' : 'Add New Account'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Account Name <InfoHint text="A clear name (e.g. Main Checking, Savings) for tracking balances and transactions." /></label>
                    <input type="text" placeholder="Account Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Checking/Savings for cash; Credit for cards; Investment for brokerage (linked to portfolios)." /></label>
                    <select value={type} onChange={e => setType(e.target.value as Account['type'])} required className="select-base" disabled={!!accountToEdit}>
                        <option value="Checking">Checking</option>
                        <option value="Savings">Savings</option>
                        <option value="Credit">Credit Card</option>
                        <option value="Investment">Investment</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Owner (optional) <InfoHint text="Useful for shared/family tracking (e.g. self, spouse)." /></label>
                    <input type="text" placeholder="Owner (e.g., self, spouse)" value={owner} onChange={e => setOwner(e.target.value)} className="input-base" />
                </div>
                <button type="submit" className="w-full btn-primary">Save Account</button>
            </form>
        </Modal>
    );
};

const AccountCardComponent: React.FC<{
    account: Account;
    onEditAccount: (acc: Account) => void;
    onDeleteAccount: (acc: Account) => void;
    linkedPortfoliosCount?: number;
}> = ({ account, onEditAccount, onDeleteAccount, linkedPortfoliosCount }) => {
    const { formatCurrencyString } = useFormatCurrency();

    const getAccountIcon = (type: Account['type']) => {
        switch (type) {
            case 'Checking': case 'Savings': return <BanknotesIcon className="h-8 w-8 text-emerald-500" />;
            case 'Credit': return <CreditCardIcon className="h-8 w-8 text-rose-500" />;
            case 'Investment': return <ArrowTrendingUpIcon className="h-8 w-8 text-indigo-500" />;
            default: return <BuildingLibraryIcon className="h-8 w-8 text-slate-500" />;
        }
    };

    return (
        <div className="section-card flex flex-col h-full border-t-4 border-t-slate-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between gap-2 min-h-[32px]">
                <div className="flex items-center gap-3 min-w-0">
                    {getAccountIcon(account.type)}
                    <div className="min-w-0">
                        <h3 className="font-semibold text-dark break-words">{account.name}</h3>
                        <p className="text-xs text-slate-500">
                            {account.type}
                            {linkedPortfoliosCount != null && linkedPortfoliosCount > 0 && (
                                <span className="ml-1 text-indigo-600">· {linkedPortfoliosCount} portfolio{linkedPortfoliosCount !== 1 ? 's' : ''}</span>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => onEditAccount(account)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit account"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDeleteAccount(account)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete account"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 min-w-0 overflow-hidden">
                <p className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">Current Balance</p>
                <p className={`metric-value text-xl font-bold tabular-nums mt-0.5 ${account.balance >= 0 ? 'text-dark' : 'text-danger'}`}>{formatCurrencyString(account.balance)}</p>
            </div>
        </div>
    );
};

const Accounts: React.FC<AccountsProps> = ({ setActivePage }) => {
    const { data, addPlatform, updatePlatform, deletePlatform, addTransfer } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);

    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [accountToEdit, setAccountToEdit] = useState<Account | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Account | null>(null);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [transferFrom, setTransferFrom] = useState('');
    const [transferTo, setTransferTo] = useState('');
    const [transferAmount, setTransferAmount] = useState('');
    const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [transferNote, setTransferNote] = useState('');

    const { cashAccounts, creditAccounts, investmentAccounts, totalCash, totalCredit, totalInvestments } = useMemo(() => {
        const cash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type));
        const credit = data.accounts.filter(a => a.type === 'Credit');
        const investments = data.accounts.filter(a => a.type === 'Investment');

        const totalCash = cash.reduce((sum, acc) => sum + acc.balance, 0);
        const totalCredit = credit.reduce((sum, acc) => sum + acc.balance, 0);

        const investmentsWithUpdatedBalance = investments.map(acc => {
            const portfolioValue = data.investments
                .filter(p => p.accountId === acc.id)
                .reduce((pSum, p) => pSum + (p.holdings || []).reduce((hSum, h) => hSum + h.currentValue, 0), 0);
            return { ...acc, balance: portfolioValue };
        });

        const totalInvestments = investmentsWithUpdatedBalance.reduce((sum, acc) => sum + acc.balance, 0);

        return { cashAccounts: cash, creditAccounts: credit, investmentAccounts: investmentsWithUpdatedBalance, totalCash, totalCredit, totalInvestments };
    }, [data.accounts, data.investments]);

    const orderedCashAccounts = useMemo(() => [...cashAccounts].sort((a, b) => a.name.localeCompare(b.name)), [cashAccounts]);
    const orderedCreditAccounts = useMemo(() => [...creditAccounts].sort((a, b) => a.name.localeCompare(b.name)), [creditAccounts]);
    const orderedInvestmentAccounts = useMemo(() => [...investmentAccounts].sort((a, b) => a.name.localeCompare(b.name)), [investmentAccounts]);

    const handleOpenAccountModal = (account: Account | null = null) => { setAccountToEdit(account); setIsAccountModalOpen(true); };

    const handleSaveAccount = async (account: Omit<Account, 'id' | 'balance'> | Account) => {
        try {
            if ('id' in account && account.id) {
                await updatePlatform(account as Account);
            } else {
                await addPlatform(account as Omit<Account, 'id' | 'user_id' | 'balance'>);
            }
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const handleOpenDeleteModal = (item: Account) => setItemToDelete(item);
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        deletePlatform(itemToDelete.id);
        setItemToDelete(null);
    };

    const handleAddStandardSet = async () => {
        const standard = [
            { name: 'Main Checking', type: 'Checking' as const },
            { name: 'Savings', type: 'Savings' as const },
            { name: 'Credit Card', type: 'Credit' as const },
        ];
        for (const a of standard) {
            try {
                await addPlatform(a as Omit<Account, 'id' | 'user_id' | 'balance'>);
            } catch (_) {}
        }
    };

    const allAccountsForTransfer = useMemo(() => [...orderedCashAccounts, ...orderedCreditAccounts, ...orderedInvestmentAccounts], [orderedCashAccounts, orderedCreditAccounts, orderedInvestmentAccounts]);

    const handleTransferSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(transferAmount);
        if (!transferFrom || !transferTo || transferFrom === transferTo) {
            alert('Select different From and To accounts.');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Enter a valid amount.');
            return;
        }
        try {
            await addTransfer(transferFrom, transferTo, amount, transferDate || undefined, transferNote.trim() || undefined);
            setIsTransferOpen(false);
            setTransferFrom('');
            setTransferTo('');
            setTransferAmount('');
            setTransferNote('');
        } catch (_) {}
    };

    return (
        <PageLayout
            title="Accounts"
            description="Track checking, savings, credit, and investment accounts."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setIsTransferOpen(true)} className="btn-ghost">Transfer</button>
                    <button type="button" onClick={handleAddStandardSet} className="btn-ghost">Add standard set</button>
                    <AddButton onClick={() => handleOpenAccountModal()}>Add New Account</AddButton>
                </div>
            }
        >

            <div className="cards-grid grid grid-cols-1 md:grid-cols-3">
                 <Card title="Total Cash Balance" value={formatCurrencyString(totalCash)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Sum of Checking and Savings (liquid cash). This is your emergency fund base." />
                 <Card title="Total Credit Balance" value={formatCurrencyString(totalCredit)} indicatorColor="red" valueColor="text-rose-700" icon={<CreditCardIcon className="h-5 w-5 text-rose-600" />} tooltip="Total balance across all credit accounts (amount owed)." />
                 <Card title="Total Investment Value" value={formatCurrencyString(totalInvestments)} indicatorColor="yellow" valueColor="text-indigo-700" icon={<ArrowTrendingUpIcon className="h-5 w-5 text-indigo-600" />} tooltip="Total value of linked investment portfolios." />
            </div>

            <div className="section-card border-l-4 border-emerald-500/50 mt-4">
                <h3 className="section-title text-base">Emergency fund (liquid cash)</h3>
                <p className="text-lg font-semibold text-dark tabular-nums">{formatCurrencyString(emergencyFund.emergencyCash)} = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses</p>
                <p className="text-sm text-slate-600 mt-1">Target: {EMERGENCY_FUND_TARGET_MONTHS} months. {emergencyFund.shortfall > 0 ? <>Shortfall: <strong>{formatCurrencyString(emergencyFund.shortfall)}</strong>. Build savings in Checking/Savings to reach the target.</> : 'Target met. Your liquid cash is adequate for emergencies.'}</p>
                {setActivePage && <button type="button" onClick={() => setActivePage('Summary')} className="mt-2 text-sm text-primary font-medium hover:underline">View full breakdown on Summary →</button>}
            </div>

            {setActivePage && (
                <div className="flex flex-wrap gap-2 p-4 section-card">
                    <span className="text-sm text-slate-600 self-center mr-2">Quick links:</span>
                    <button type="button" onClick={() => setActivePage('Transactions')} className="btn-ghost py-1.5">Transactions</button>
                    <button type="button" onClick={() => setActivePage('Investments')} className="btn-ghost py-1.5 text-indigo-700 hover:bg-indigo-50">Investments</button>
                    <button type="button" onClick={() => setActivePage('Plan')} className="btn-ghost py-1.5 text-primary hover:bg-primary/5">Plan</button>
                    <button type="button" onClick={() => setActivePage('Budgets')} className="btn-ghost py-1.5 text-amber-700 hover:bg-amber-50">Budgets</button>
                </div>
            )}

            <section>
                <h2 className="section-title text-xl mb-4">Cash Accounts</h2>
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {orderedCashAccounts.map((acc) => (
                        <AccountCardComponent key={acc.id} account={acc} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} linkedPortfoliosCount={0} />
                    ))}
                </div>
            </section>

            <section>
                <h2 className="section-title text-xl mb-4">Credit Cards</h2>
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {orderedCreditAccounts.map((acc) => (
                        <AccountCardComponent key={acc.id} account={acc} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} linkedPortfoliosCount={0} />
                    ))}
                </div>
            </section>

            <section>
                <h2 className="section-title text-xl mb-4">Investment Platforms</h2>
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {orderedInvestmentAccounts.map((acc) => {
                        const linkedCount = data.investments.filter((p: { accountId?: string; account_id?: string }) => (p.accountId ?? (p as any).account_id) === acc.id).length;
                        return (
                            <AccountCardComponent key={acc.id} account={acc} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} linkedPortfoliosCount={linkedCount} />
                        );
                    })}
                </div>
            </section>

            <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} onSave={handleSaveAccount} accountToEdit={accountToEdit} />
            <Modal isOpen={isTransferOpen} onClose={() => setIsTransferOpen(false)} title="Transfer between accounts">
                <form onSubmit={handleTransferSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="transfer-from" className="block text-sm font-medium text-gray-700 mb-1">From account</label>
                        <select id="transfer-from" value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)} className="select-base w-full" required>
                            <option value="">Select account</option>
                            {allAccountsForTransfer.map((a) => (
                                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="transfer-to" className="block text-sm font-medium text-gray-700 mb-1">To account</label>
                        <select id="transfer-to" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="select-base w-full" required>
                            <option value="">Select account</option>
                            {allAccountsForTransfer.map((a) => (
                                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="transfer-amount" className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                        <input id="transfer-amount" type="number" step="0.01" min="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="input-base w-full" required />
                    </div>
                    <div>
                        <label htmlFor="transfer-date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input id="transfer-date" type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="input-base w-full" />
                    </div>
                    <div>
                        <label htmlFor="transfer-note" className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                        <input id="transfer-note" type="text" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} className="input-base w-full" placeholder="e.g. Monthly savings" />
                    </div>
                    <button type="submit" className="btn-primary w-full">Transfer</button>
                </form>
            </Modal>
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </PageLayout>
    );
};

export default Accounts;
