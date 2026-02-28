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
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import AddButton from '../components/AddButton';
import CardLayoutControls from '../components/CardLayoutControls';
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
    onMoveUp?: (id: string) => void;
    onMoveDown?: (id: string) => void;
    compact?: boolean;
    index?: number;
    total?: number;
    onToggleDensity?: () => void;
    linkedPortfoliosCount?: number;
}> = ({ account, onEditAccount, onDeleteAccount, onMoveUp, onMoveDown, compact = false, index = 0, total = 1, onToggleDensity, linkedPortfoliosCount }) => {
    const { formatCurrencyString } = useFormatCurrency();

    const getAccountIcon = (type: Account['type']) => {
        const iconClass = compact ? "h-6 w-6" : "h-8 w-8";
        switch (type) {
            case 'Checking': case 'Savings': return <BanknotesIcon className={`${iconClass} text-green-500`} />;
            case 'Credit': return <CreditCardIcon className={`${iconClass} text-red-500`} />;
            case 'Investment': return <ArrowTrendingUpIcon className={`${iconClass} text-indigo-500`} />;
            default: return <BuildingLibraryIcon className={`${iconClass} text-gray-500`} />;
        }
    };

    return (
        <div className={`bg-white rounded-lg shadow ${compact ? 'p-3' : 'p-5'} flex flex-col justify-between hover:shadow-xl transition-shadow duration-300`}>
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-3">
                        {getAccountIcon(account.type)}
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className={`font-bold text-dark ${compact ? 'text-base' : 'text-lg'}`}>{account.name}</h3>
                                {account.owner && <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{account.owner}</span>}
                            </div>
                            <p className="text-sm text-gray-500">{account.type}{linkedPortfoliosCount != null && linkedPortfoliosCount > 0 ? <span className="ml-1 text-xs text-indigo-600">· {linkedPortfoliosCount} portfolio{linkedPortfoliosCount !== 1 ? 's' : ''}</span> : null}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <CardLayoutControls index={index} total={total} isExpanded={!compact} onMove={(direction) => direction === 'up' ? onMoveUp?.(account.id) : onMoveDown?.(account.id)} onToggleSize={() => onToggleDensity?.()} />
                        <button type="button" onClick={() => onEditAccount(account)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit account"><PencilIcon className="h-4 w-4"/></button>
                        <button type="button" onClick={() => onDeleteAccount(account)} className="p-1 text-gray-400 hover:text-danger" aria-label="Delete account"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                </div>
                <div className="mt-4 text-right">
                    <p className="text-sm text-gray-500">Current Balance</p>
                    <p className={`text-3xl font-bold ${account.balance >= 0 ? 'text-dark' : 'text-danger'}`}>{formatCurrencyString(account.balance)}</p>
                </div>
            </div>
        </div>
    );
};

const Accounts: React.FC<AccountsProps> = ({ setActivePage }) => {
    const { data, addPlatform, updatePlatform, deletePlatform } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [accountToEdit, setAccountToEdit] = useState<Account | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Account | null>(null);
    const [draggingAccount, setDraggingAccount] = useState<{ section: 'cash' | 'credit' | 'investment'; id: string } | null>(null);
    const cardDensity = 'Compact' as const;
    const [sectionOrder, setSectionOrder] = useState<{ cash: string[]; credit: string[]; investment: string[] }>(() => {
        if (typeof window === 'undefined') return { cash: [], credit: [], investment: [] };
        try {
            const raw = window.localStorage.getItem('accounts-section-order');
            if (!raw) return { cash: [], credit: [], investment: [] };
            const parsed = JSON.parse(raw);
            return {
                cash: Array.isArray(parsed?.cash) ? parsed.cash : [],
                credit: Array.isArray(parsed?.credit) ? parsed.credit : [],
                investment: Array.isArray(parsed?.investment) ? parsed.investment : [],
            };
        } catch {
            return { cash: [], credit: [], investment: [] };
        }
    });

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

    useEffect(() => {
        const ensureOrder = (existingOrder: string[], accounts: Account[]) => {
            const ids = accounts.map(a => a.id);
            const retained = existingOrder.filter(id => ids.includes(id));
            const appended = ids.filter(id => !retained.includes(id));
            return [...retained, ...appended];
        };

        setSectionOrder(prev => ({
            cash: ensureOrder(prev.cash, cashAccounts),
            credit: ensureOrder(prev.credit, creditAccounts),
            investment: ensureOrder(prev.investment, investmentAccounts),
        }));
    }, [cashAccounts, creditAccounts, investmentAccounts]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('accounts-section-order', JSON.stringify(sectionOrder));
    }, [sectionOrder]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('accounts-card-density', cardDensity);
    }, [cardDensity]);

    const reorderIds = (ids: string[], id: string, direction: 'up' | 'down') => {
        const index = ids.indexOf(id);
        if (index < 0) return ids;
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= ids.length) return ids;
        const next = [...ids];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    };

    const moveIdToTarget = (ids: string[], sourceId: string, targetId: string) => {
        const sourceIndex = ids.indexOf(sourceId);
        const targetIndex = ids.indexOf(targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids;
        const next = [...ids];
        const [moved] = next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, moved);
        return next;
    };

    const handleAccountDrop = (section: 'cash' | 'credit' | 'investment', targetId: string) => {
        if (!draggingAccount || draggingAccount.section !== section || draggingAccount.id === targetId) return;
        setSectionOrder(prev => ({ ...prev, [section]: moveIdToTarget(prev[section], draggingAccount.id, targetId) }));
        setDraggingAccount(null);
    };

    const orderedCashAccounts = useMemo(() => sectionOrder.cash.map(id => cashAccounts.find(a => a.id === id)).filter(Boolean) as Account[], [sectionOrder.cash, cashAccounts]);
    const orderedCreditAccounts = useMemo(() => sectionOrder.credit.map(id => creditAccounts.find(a => a.id === id)).filter(Boolean) as Account[], [sectionOrder.credit, creditAccounts]);
    const orderedInvestmentAccounts = useMemo(() => sectionOrder.investment.map(id => investmentAccounts.find(a => a.id === id)).filter(Boolean) as Account[], [sectionOrder.investment, investmentAccounts]);

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

    return (
        <PageLayout
            title="Accounts"
            description="Track checking, savings, credit, and investment accounts. Drag cards to reorder within each section."
            action={<AddButton onClick={() => handleOpenAccountModal()}>Add New Account</AddButton>}
        >

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <Card title="Total Cash Balance" value={formatCurrencyString(totalCash)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} />
                 <Card title="Total Credit Balance" value={formatCurrencyString(totalCredit)} indicatorColor="red" valueColor="text-rose-700" icon={<CreditCardIcon className="h-5 w-5 text-rose-600" />} />
                 <Card title="Total Investment Value" value={formatCurrencyString(totalInvestments)} indicatorColor="yellow" valueColor="text-indigo-700" icon={<ArrowTrendingUpIcon className="h-5 w-5 text-indigo-600" />} />
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
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {orderedCashAccounts.map((acc, index) => <div key={acc.id} draggable aria-label={`Reorder cash account ${acc.name}`} onDragStart={() => setDraggingAccount({ section: 'cash', id: acc.id })} onDragOver={(e) => e.preventDefault()} onDrop={() => handleAccountDrop('cash', acc.id)} onDragEnd={() => setDraggingAccount(null)} className={draggingAccount?.id === acc.id ? 'opacity-70' : ''}><AccountCardComponent account={acc} compact={cardDensity === 'Compact'} index={index} total={orderedCashAccounts.length} onToggleDensity={undefined} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onMoveUp={(id) => setSectionOrder(prev => ({ ...prev, cash: reorderIds(prev.cash, id, 'up') }))} onMoveDown={(id) => setSectionOrder(prev => ({ ...prev, cash: reorderIds(prev.cash, id, 'down') }))} linkedPortfoliosCount={0} /></div>)}
                </div>
            </section>

            <section>
                <h2 className="section-title text-xl mb-4">Credit Cards</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {orderedCreditAccounts.map((acc, index) => <div key={acc.id} draggable aria-label={`Reorder credit account ${acc.name}`} onDragStart={() => setDraggingAccount({ section: 'credit', id: acc.id })} onDragOver={(e) => e.preventDefault()} onDrop={() => handleAccountDrop('credit', acc.id)} onDragEnd={() => setDraggingAccount(null)} className={draggingAccount?.id === acc.id ? 'opacity-70' : ''}><AccountCardComponent account={acc} compact={cardDensity === 'Compact'} index={index} total={orderedCreditAccounts.length} onToggleDensity={undefined} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onMoveUp={(id) => setSectionOrder(prev => ({ ...prev, credit: reorderIds(prev.credit, id, 'up') }))} onMoveDown={(id) => setSectionOrder(prev => ({ ...prev, credit: reorderIds(prev.credit, id, 'down') }))} linkedPortfoliosCount={0} /></div>)}
                </div>
            </section>

            <section>
                <h2 className="section-title text-xl mb-4">Investment Platforms</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {orderedInvestmentAccounts.map((acc, index) => {
                        const linkedCount = data.investments.filter((p: { accountId?: string; account_id?: string }) => (p.accountId ?? (p as any).account_id) === acc.id).length;
                        return (
                            <div key={acc.id} draggable aria-label={`Reorder investment account ${acc.name}`} onDragStart={() => setDraggingAccount({ section: 'investment', id: acc.id })} onDragOver={(e) => e.preventDefault()} onDrop={() => handleAccountDrop('investment', acc.id)} onDragEnd={() => setDraggingAccount(null)} className={draggingAccount?.id === acc.id ? 'opacity-70' : ''}>
                                <AccountCardComponent account={acc} compact={cardDensity === 'Compact'} index={index} total={orderedInvestmentAccounts.length} onToggleDensity={undefined} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} onMoveUp={(id) => setSectionOrder(prev => ({ ...prev, investment: reorderIds(prev.investment, id, 'up') }))} onMoveDown={(id) => setSectionOrder(prev => ({ ...prev, investment: reorderIds(prev.investment, id, 'down') }))} linkedPortfoliosCount={linkedCount} />
                            </div>
                        );
                    })}
                </div>
            </section>

            <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} onSave={handleSaveAccount} accountToEdit={accountToEdit} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </PageLayout>
    );
};

export default Accounts;
