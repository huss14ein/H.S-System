import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { Account, Page } from '../types';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';

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
import { useCurrency } from '../context/CurrencyContext';
import { getPortfolioHoldingsValueInSAR } from '../utils/currencyMath';
import { DemoDataButton } from '../components/DemoDataButton';

type SharedAccountRow = Account & { ownerEmail?: string; owner_user_id?: string; account_id?: string; show_balance?: boolean };

const AccountModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id' | 'balance'> | Account) => void;
    accountToEdit: Account | null;
    allAccounts?: Account[];
}> = ({ isOpen, onClose, onSave, accountToEdit, allAccounts = [] }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Account['type']>('Checking');
    const [owner, setOwner] = useState('');
    const [linkedAccountIds, setLinkedAccountIds] = useState<string[]>([]);

    useEffect(() => {
        if (accountToEdit) {
            setName(accountToEdit.name);
            setType(accountToEdit.type);
            setOwner(accountToEdit.owner || '');
            setLinkedAccountIds(accountToEdit.linkedAccountIds || []);
        } else {
            setName('');
            setType('Checking');
            setOwner('');
            setLinkedAccountIds([]);
        }
    }, [accountToEdit, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const accountData: any = { 
            name, 
            type, 
            owner: owner || undefined,
            ...(type === 'Investment' && linkedAccountIds.length > 0 ? { linkedAccountIds } : {})
        };

        try {
            if (accountToEdit) {
                await onSave({ ...accountToEdit, ...accountData });
            } else {
                await onSave(accountData);
            }
            onClose();
        } catch {
            // Error handled in DataContext
        }
    };
    
    const availableCashAccounts = useMemo(() => 
        allAccounts.filter(acc => (acc.type === 'Checking' || acc.type === 'Savings') && acc.id !== accountToEdit?.id),
        [allAccounts, accountToEdit]
    );

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
                {type === 'Investment' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Linked Cash Accounts (Optional) 
                            <InfoHint text="Select cash accounts (Checking/Savings) that can fund this investment platform. Only these accounts will appear when making deposits to this platform." />
                        </label>
                        {availableCashAccounts.length === 0 ? (
                            <p className="text-xs text-slate-500 p-2 bg-slate-50 rounded border border-slate-200">
                                No cash accounts available. Create Checking or Savings accounts first to link them to this platform.
                            </p>
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3">
                                {availableCashAccounts.map(acc => (
                                    <label key={acc.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={linkedAccountIds.includes(acc.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setLinkedAccountIds([...linkedAccountIds, acc.id]);
                                                } else {
                                                    setLinkedAccountIds(linkedAccountIds.filter(id => id !== acc.id));
                                                }
                                            }}
                                            className="h-4 w-4 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm text-slate-700 flex-1">
                                            {acc.name} ({acc.type})
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                        {linkedAccountIds.length > 0 && (
                            <p className="text-xs text-emerald-600 mt-1">
                                {linkedAccountIds.length} account{linkedAccountIds.length > 1 ? 's' : ''} linked. Only these accounts can be used for deposits/withdrawals to this platform.
                            </p>
                        )}
                    </div>
                )}
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
    readOnly?: boolean;
}> = ({ account, onEditAccount, onDeleteAccount, linkedPortfoliosCount, readOnly = false }) => {
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
                            {readOnly && <span className="ml-1 text-amber-700">· Shared view</span>}
                        </p>
                    </div>
                </div>
                {!readOnly && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button" onClick={() => onEditAccount(account)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit account"><PencilIcon className="h-4 w-4"/></button>
                        <button type="button" onClick={() => onDeleteAccount(account)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete account"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                )}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 min-w-0 overflow-hidden">
                <p className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">Current Balance</p>
                {(() => {
                    const sharedAccount = account as SharedAccountRow;
                    const canShowBalance = !readOnly || sharedAccount.show_balance !== false;
                    return canShowBalance ? (
                        <p className={`metric-value text-xl font-bold tabular-nums mt-0.5 ${(account.balance ?? 0) >= 0 ? 'text-dark' : 'text-danger'}`}>{formatCurrencyString(account.balance ?? 0)}</p>
                    ) : (
                        <p className="metric-value text-sm text-slate-400 mt-0.5">Balance hidden</p>
                    );
                })()}
                {account.type === 'Investment' && account.linkedAccountIds && account.linkedAccountIds.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                        Linked to {account.linkedAccountIds.length} cash account{account.linkedAccountIds.length > 1 ? 's' : ''}
                    </p>
                )}
                {readOnly && <p className="text-xs text-slate-500 mt-1">Owner: {(account as SharedAccountRow).ownerEmail || 'Shared account'}</p>}
            </div>
        </div>
    );
};

const Accounts: React.FC<AccountsProps> = ({ setActivePage }) => {
    const { data, addPlatform, updatePlatform, deletePlatform, addTransaction } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);

    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [accountToEdit, setAccountToEdit] = useState<Account | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Account | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [shareableUsers, setShareableUsers] = useState<Array<{ id: string; email: string }>>([]);
    const [shareTargetEmail, setShareTargetEmail] = useState('');
    const [shareAccountId, setShareAccountId] = useState('');
    const [shareShowBalance, setShareShowBalance] = useState(true);
    const [shareError, setShareError] = useState<string | null>(null);
    const [shareSuccess, setShareSuccess] = useState<string | null>(null);
    const [sharedAccounts, setSharedAccounts] = useState<SharedAccountRow[]>([]);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferFromAccount, setTransferFromAccount] = useState('');
    const [transferToAccount, setTransferToAccount] = useState('');
    const [transferAmount, setTransferAmount] = useState('');
    const [transferDescription, setTransferDescription] = useState('');

    useEffect(() => {
        const loadSharingState = async () => {
            if (!supabase || !auth?.user?.id) return;
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            const admin = inferIsAdmin(auth.user, userRecord?.role ?? null);
            setIsAdmin(admin);

            const { data: sharedRows } = await supabase
                .rpc('get_shared_accounts_for_me')
                .then((r) => r, () => ({ data: [] as any[] } as any));
            const rows = (sharedRows || []) as any[];
            setSharedAccounts(rows.map((r) => ({
                id: String(r.account_id ?? r.id ?? ''),
                name: String(r.name ?? 'Shared Account'),
                type: (r.type === 'Savings' || r.type === 'Investment' || r.type === 'Credit' ? r.type : 'Checking') as Account['type'],
                balance: Number(r.balance ?? 0),
                owner: r.owner ?? undefined,
                ownerEmail: r.owner_email ?? r.ownerEmail ?? r.owner_user_id,
                user_id: r.user_id,
                show_balance: r.show_balance !== undefined ? r.show_balance : true,
            })).filter((r) => !!r.id));

            if (admin) {
                const { data: users, error } = await supabase.rpc('list_shareable_users');
                if (!error) {
                    const options = (Array.isArray(users) ? users : [])
                        .filter((u: any) => u?.id && u?.email && u.id !== auth.user?.id)
                        .map((u: any) => ({ id: String(u.id), email: String(u.email).toLowerCase() }));
                    setShareableUsers(options);
                }
            }
        };
        loadSharingState();
    }, [auth?.user?.id, data?.accounts?.length]);

    const { cashAccounts, creditAccounts, investmentAccounts, totalCash, totalCredit, totalInvestments } = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const cash = accounts.filter(a => ['Checking', 'Savings'].includes(a.type));
        const credit = accounts.filter(a => a.type === 'Credit');
        const investments = accounts.filter(a => a.type === 'Investment');

        const totalCash = cash.reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
        const totalCredit = credit.reduce((sum, acc) => sum + (acc.balance ?? 0), 0);

        const investmentsList = data?.investments ?? [];
        const investmentsWithUpdatedBalance = investments.map(acc => {
            const portfolioValue = investmentsList
                .filter(p => p.accountId === acc.id)
                .reduce((pSum, p) => pSum + getPortfolioHoldingsValueInSAR(p, exchangeRate), 0);
            return { ...acc, balance: portfolioValue };
        });

        const totalInvestments = investmentsWithUpdatedBalance.reduce((sum, acc) => sum + (acc.balance ?? 0), 0);

        return { cashAccounts: cash, creditAccounts: credit, investmentAccounts: investmentsWithUpdatedBalance, totalCash, totalCredit, totalInvestments };
    }, [data?.accounts, data?.investments, exchangeRate]);

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
        } catch {
            // Error already alerted in DataContext
        }
    };

    const handleOpenDeleteModal = (item: Account) => setItemToDelete(item);
    const handleConfirmDelete = () => {
        if (!itemToDelete) return;
        deletePlatform(itemToDelete.id);
        setItemToDelete(null);
    };

    const handleShareAccount = async () => {
        if (!supabase || !auth?.user?.id || !shareAccountId || !shareTargetEmail) return;
        const target = shareableUsers.find((u) => u.email === shareTargetEmail.toLowerCase());
        if (!target) {
            setShareError('Select a valid user to share with.');
            setShareSuccess(null);
            return;
        }
        const { error } = await supabase
            .from('account_shares')
            .upsert({ owner_user_id: auth.user.id, shared_with_user_id: target.id, account_id: shareAccountId, show_balance: shareShowBalance }, { onConflict: 'owner_user_id,shared_with_user_id,account_id' });
        if (error) {
            const msg = (error.message || '').trim();
            setShareError(/account_shares|relation .* does not exist/i.test(msg)
                ? 'Account sharing is not enabled in DB yet. Add account_shares/get_shared_accounts_for_me migration first.'
                : msg);
            setShareSuccess(null);
            return;
        }
        setShareError(null);
        setShareSuccess('Account shared successfully.');
        setShareTargetEmail('');
        setShareShowBalance(true);
    };

    const handleTransfer = async () => {
        if (!transferFromAccount || !transferToAccount || !transferAmount) {
            alert('Please select both accounts and enter an amount.');
            return;
        }
        const amount = parseFloat(transferAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Please enter a valid positive amount.');
            return;
        }
        const accounts = data?.accounts ?? [];
        const fromAccount = accounts.find(a => a.id === transferFromAccount);
        const toAccount = accounts.find(a => a.id === transferToAccount);
        if (!fromAccount || !toAccount) {
            alert('Selected accounts not found.');
            return;
        }
        if ((fromAccount.balance ?? 0) < amount) {
            alert(`Insufficient balance. Available: ${formatCurrencyString(fromAccount.balance ?? 0)}`);
            return;
        }
        if (!window.confirm(`Transfer ${formatCurrencyString(amount)} from ${fromAccount.name} to ${toAccount.name}?`)) {
            return;
        }
        try {
            const description = transferDescription.trim() || `Transfer from ${fromAccount.name} to ${toAccount.name}`;
            const today = new Date().toISOString().split('T')[0];
            
            // Create withdrawal transaction
            await addTransaction({
                date: today,
                description: `${description} (from ${fromAccount.name})`,
                amount: -amount,
                category: 'Transfers',
                type: 'expense',
                accountId: transferFromAccount,
            });
            
            // Create deposit transaction
            await addTransaction({
                date: today,
                description: `${description} (to ${toAccount.name})`,
                amount: amount,
                category: 'Transfers',
                type: 'income',
                accountId: transferToAccount,
            });
            
            alert('Transfer completed successfully.');
            setIsTransferModalOpen(false);
            setTransferFromAccount('');
            setTransferToAccount('');
            setTransferAmount('');
            setTransferDescription('');
        } catch (error) {
            alert(`Failed to complete transfer: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    return (
        <PageLayout
            title="Accounts"
            description="Track checking, savings, credit, and investment accounts."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <DemoDataButton page="Accounts" options={{ includeAccounts: true }} />
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

            {isAdmin && (
                <section className="section-card mt-4">
                    <h3 className="section-title text-base">Share account with another user</h3>
                    <p className="text-sm text-slate-600 mb-3">Share read-only account visibility with a specific user, similar to budget sharing.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Account</label>
                            <select value={shareAccountId} onChange={(e) => setShareAccountId(e.target.value)} className="select-base">
                                <option value="">Select account</option>
                                {(data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">User email</label>
                            <select value={shareTargetEmail} onChange={(e) => setShareTargetEmail(e.target.value)} className="select-base">
                                <option value="">Select user</option>
                                {shareableUsers.map((u) => <option key={u.id} value={u.email}>{u.email}</option>)}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="share-show-balance"
                                checked={shareShowBalance}
                                onChange={(e) => setShareShowBalance(e.target.checked)}
                                className="h-4 w-4"
                            />
                            <label htmlFor="share-show-balance" className="text-xs text-slate-600">Show balance</label>
                        </div>
                        <button type="button" onClick={handleShareAccount} className="btn-primary">Share Account</button>
                    </div>
                    {shareError && <p className="text-sm text-rose-600 mt-2">{shareError}</p>}
                    {shareSuccess && <p className="text-sm text-emerald-600 mt-2">{shareSuccess}</p>}
                </section>
            )}

            <section className="section-card mt-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="section-title text-base">Transfer Between Accounts</h3>
                    <button type="button" onClick={() => setIsTransferModalOpen(true)} className="btn-primary text-sm">
                        Transfer Funds
                    </button>
                </div>
                <p className="text-xs text-slate-600">Move money between your accounts (e.g., Checking → Savings, Savings → Investment). Creates matching withdrawal and deposit transactions.</p>
            </section>

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
                        const linkedCount = (data?.investments ?? []).filter((p: { accountId?: string; account_id?: string }) => (p.accountId ?? (p as any).account_id) === acc.id).length;
                        return (
                            <AccountCardComponent key={acc.id} account={acc} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} linkedPortfoliosCount={linkedCount} />
                        );
                    })}
                </div>
            </section>

            {sharedAccounts.length > 0 && (
                <section>
                    <h2 className="section-title text-xl mb-4">Shared With Me</h2>
                    <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {sharedAccounts.map((acc) => (
                            <AccountCardComponent key={`shared-${acc.id}-${acc.ownerEmail || ''}`} account={acc} onEditAccount={() => {}} onDeleteAccount={() => {}} readOnly />
                        ))}
                    </div>
                </section>
            )}

            <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} onSave={handleSaveAccount} accountToEdit={accountToEdit} allAccounts={data?.accounts ?? []} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
            
            <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Transfer Between Accounts">
                <form onSubmit={(e) => { e.preventDefault(); handleTransfer(); }} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            From Account <InfoHint text="Account to withdraw funds from" />
                        </label>
                        <select
                            value={transferFromAccount}
                            onChange={(e) => setTransferFromAccount(e.target.value)}
                            required
                            className="select-base"
                        >
                            <option value="">Select source account</option>
                            {(data?.accounts ?? []).filter(a => a.type !== 'Credit').map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.name} ({formatCurrencyString(acc.balance ?? 0)})
                                </option>
                            ))}
                        </select>
                        {transferFromAccount && (() => {
                            const acc = (data?.accounts ?? []).find(a => a.id === transferFromAccount);
                            return acc && (
                                <p className="text-xs text-slate-500 mt-1">
                                    Available balance: {formatCurrencyString(acc.balance ?? 0)}
                                </p>
                            );
                        })()}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            To Account <InfoHint text="Account to deposit funds into" />
                        </label>
                        <select
                            value={transferToAccount}
                            onChange={(e) => setTransferToAccount(e.target.value)}
                            required
                            className="select-base"
                        >
                            <option value="">Select destination account</option>
                            {(data?.accounts ?? []).filter(a => a.id !== transferFromAccount && a.type !== 'Credit').map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.name} ({formatCurrencyString(acc.balance ?? 0)})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Amount <InfoHint text="Amount to transfer" />
                        </label>
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            required
                            className="input-base"
                            placeholder="0.00"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Description (Optional) <InfoHint text="Optional note for the transfer" />
                        </label>
                        <input
                            type="text"
                            value={transferDescription}
                            onChange={(e) => setTransferDescription(e.target.value)}
                            className="input-base"
                            placeholder="e.g., Monthly savings transfer"
                        />
                    </div>
                    <button type="submit" className="w-full btn-primary">
                        Complete Transfer
                    </button>
                </form>
            </Modal>
        </PageLayout>
    );
};

export default Accounts;
