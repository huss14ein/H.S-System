import React, { useState, useMemo, useContext, useEffect, useCallback } from 'react';
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
import { CalendarDaysIcon } from '../components/icons/CalendarDaysIcon';
import { ClockIcon } from '../components/icons/ClockIcon';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';
import { XMarkIcon } from '../components/icons/XMarkIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import AddButton from '../components/AddButton';
import InfoHint from '../components/InfoHint';
import OwnerBadge from '../components/OwnerBadge';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useCurrency } from '../context/CurrencyContext';
import { tradableCashBucketToSAR, resolveSarPerUsd, toSAR, fromSAR } from '../utils/currencyMath';
import { reconcileCashAccountBalance, type CashAccountReconciliation } from '../services/dataQuality';
import { usePrivacyMask } from '../context/PrivacyContext';
import { accountBookCurrency } from '../utils/cashAccountDisplay';
import { isInternalTransferTransaction } from '../services/transactionFilters';
import { useSelfLearning } from '../context/SelfLearningContext';
import AIAdvisor from '../components/AIAdvisor';

type SharedAccountRow = Account & { ownerEmail?: string; owner_user_id?: string; account_id?: string; show_balance?: boolean };

/** A past transfer from transactions (expense + income legs paired). */
interface TransferHistoryItem {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    date: string;
    description?: string;
}

/** A scheduled (recurring) transfer represented as a pair of expense + income recurring entries. */
interface ScheduledTransferPair {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    dayOfMonth: number;
    expenseId: string;
    incomeId: string;
    enabled: boolean;
}

const AccountModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id'> | Account) => void;
    accountToEdit: Account | null;
    allAccounts?: Account[];
}> = ({ isOpen, onClose, onSave, accountToEdit, allAccounts = [] }) => {
    const { data } = useContext(DataContext)!;
    const { getLearnedDefault, trackFormDefault } = useSelfLearning();
    const [name, setName] = useState('');
    const [type, setType] = useState<Account['type']>('Checking');
    const [owner, setOwner] = useState('');
    const [linkedAccountIds, setLinkedAccountIds] = useState<string[]>([]);
    const [balanceStr, setBalanceStr] = useState('');
    const [cashCurrency, setCashCurrency] = useState<'SAR' | 'USD'>('SAR');

    const planDefaultCash: 'SAR' | 'USD' =
        String((data?.investmentPlan as { budgetCurrency?: string } | undefined)?.budgetCurrency ?? '').toUpperCase() === 'USD'
            ? 'USD'
            : 'SAR';

    useEffect(() => {
        if (accountToEdit) {
            setName(accountToEdit.name);
            setType(accountToEdit.type);
            setOwner(accountToEdit.owner || '');
            setLinkedAccountIds(accountToEdit.linkedAccountIds || []);
            setCashCurrency(accountToEdit.currency ?? planDefaultCash);
            setBalanceStr(
                accountToEdit.type === 'Investment'
                    ? ''
                    : String(accountToEdit.balance ?? '')
            );
        } else {
            const learnedType = getLearnedDefault('account-add', 'type') as Account['type'] | undefined;
            const validTypes: Account['type'][] = ['Checking', 'Savings', 'Credit', 'Investment'];
            setName('');
            setType(learnedType && validTypes.includes(learnedType) ? learnedType : 'Checking');
            setOwner('');
            setLinkedAccountIds([]);
            setCashCurrency(planDefaultCash);
            setBalanceStr('');
        }
    }, [accountToEdit, isOpen, getLearnedDefault, planDefaultCash]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const parsedBalance =
            type === 'Investment' ? Number(accountToEdit?.balance) || 0 : Number(balanceStr.replace(/,/g, '')) || 0;
        const accountData: any = {
            name,
            type,
            owner: owner || undefined,
            // Always send linkedAccountIds for Investment so backend can persist (including clearing when empty)
            ...(type === 'Investment' ? { linkedAccountIds: linkedAccountIds || [] } : {}),
            ...(type !== 'Investment' ? { balance: parsedBalance } : {}),
            ...(type === 'Checking' || type === 'Savings' || type === 'Credit' ? { currency: cashCurrency } : {}),
        };

        try {
            if (accountToEdit) {
                await onSave({ ...accountToEdit, ...accountData, balance: type === 'Investment' ? accountToEdit.balance : parsedBalance });
            } else {
                await onSave(
                    type === 'Investment'
                        ? { ...accountData, balance: 0 }
                        : accountData
                );
                trackFormDefault('account-add', 'type', type);
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
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Account Name <InfoHint text="Give it a name you'll recognize, e.g. Main Bank, Emergency Savings." hintId="account-name" hintPage="Accounts" /></label>
                    <input type="text" placeholder="e.g. Main Bank, Emergency Savings" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Checking = everyday spending. Savings = money set aside. Credit = card you pay later. Investment = stocks/funds platform." hintId="account-type" hintPage="Accounts" /></label>
                    <select value={type} onChange={e => setType(e.target.value as Account['type'])} required className="select-base" disabled={!!accountToEdit}>
                        <option value="Checking">Checking</option>
                        <option value="Savings">Savings</option>
                        <option value="Credit">Credit Card</option>
                        <option value="Investment">Investment</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Owner (optional) <InfoHint text="Leave blank for your own (counts in My net worth). Set e.g. Father, Spouse for managed wealth (excluded from your net worth)." /></label>
                    <input type="text" placeholder="Owner (e.g., Father, Spouse) or leave blank for yours" value={owner} onChange={e => setOwner(e.target.value)} className="input-base" />
                </div>
                {(type === 'Checking' || type === 'Savings' || type === 'Credit') && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Account currency <InfoHint text="Your bank balance and transfers from this account are in this currency. Investment deposits from a SAR bank should use SAR so the platform ledger matches your transfer." />
                        </label>
                        <select
                            value={cashCurrency}
                            onChange={(e) => setCashCurrency(e.target.value as 'SAR' | 'USD')}
                            className="select-base w-full max-w-xs"
                        >
                            <option value="SAR">SAR</option>
                            <option value="USD">USD</option>
                        </select>
                    </div>
                )}
                {(type === 'Checking' || type === 'Savings' || type === 'Credit') && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            {accountToEdit ? 'Current balance' : 'Starting balance'} ({cashCurrency})
                            <InfoHint
                                text={
                                    accountToEdit
                                        ? 'Manual adjustment or opening position. For Checking/Savings, new income and expenses linked to this account now update this balance automatically—set this once to match your bank if you already had history before auto-sync.'
                                        : 'Optional. For cash accounts, you can start at 0 and let transactions move the balance, or enter today’s bank balance if you’re about to import past activity.'
                                }
                            />
                        </label>
                        <input
                            type="number"
                            step="any"
                            value={balanceStr}
                            onChange={(e) => setBalanceStr(e.target.value)}
                            placeholder="0"
                            className="input-base"
                        />
                    </div>
                )}
                {type === 'Investment' && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Link cash accounts to this platform
                            <InfoHint text="Select which Checking/Savings accounts can fund this investment platform. When you make a deposit, only linked accounts appear as the source. Save the account to apply changes." />
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
    cashReconciliation?: CashAccountReconciliation | null;
    balanceMetricLabel?: string;
}> = ({ account, onEditAccount, onDeleteAccount, linkedPortfoliosCount, readOnly = false, cashReconciliation, balanceMetricLabel = 'Current Balance' }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const { maskBalance } = usePrivacyMask();

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
                <p className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">{balanceMetricLabel}</p>
                {(() => {
                    const sharedAccount = account as SharedAccountRow;
                    const canShowBalance = !readOnly || sharedAccount.show_balance !== false;
                    const accountCurrency = account.currency === 'USD' ? 'USD' : 'SAR';
                    return canShowBalance ? (
                        <p className={`metric-value text-xl font-bold tabular-nums mt-0.5 ${account.balance >= 0 ? 'text-dark' : 'text-danger'}`}>{maskBalance(formatCurrencyString(account.balance, { inCurrency: accountCurrency }))}</p>
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
                {!readOnly && account.owner && <OwnerBadge owner={account.owner} className="mt-2" />}
                {!readOnly && cashReconciliation?.showWarning && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900">
                        <p className="font-semibold">Balance check</p>
                        <p className="mt-0.5">
                            Recorded transactions net to <strong>{formatCurrencyString(cashReconciliation.transactionNet, { inCurrency: accountBookCurrency(account) })}</strong>
                            {' '}vs balance <strong>{formatCurrencyString(cashReconciliation.storedBalance, { inCurrency: accountBookCurrency(account) })}</strong>
                            {cashReconciliation.txCount > 0 && (
                                <> (drift {formatCurrencyString(cashReconciliation.drift, { inCurrency: accountBookCurrency(account) })}). May mean opening balance or missing entries.</>
                            )}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

const Accounts: React.FC<AccountsProps> = ({ setActivePage }) => {
    const { data, loading, addPlatform, updatePlatform, deletePlatform, addTransfer, addRecurringTransaction, updateRecurringTransaction, deleteRecurringTransaction, getAvailableCashForAccount } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const emergencyFund = useEmergencyFund(data);
    const { maskBalance } = usePrivacyMask();

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
    const [isRecurringTransferModalOpen, setIsRecurringTransferModalOpen] = useState(false);
    const [recurringFromId, setRecurringFromId] = useState('');
    const [recurringToId, setRecurringToId] = useState('');
    const [recurringAmount, setRecurringAmount] = useState('');
    const [recurringDayOfMonth, setRecurringDayOfMonth] = useState('1');
    const [transferFilterFrom, setTransferFilterFrom] = useState<string>('all');
    const [transferFilterTo, setTransferFilterTo] = useState<string>('all');
    const [transferFilterStatus, setTransferFilterStatus] = useState<'all' | 'active' | 'paused'>('all');
    const [scheduledTransfersFiltersOpen, setScheduledTransfersFiltersOpen] = useState(true);
    const [transferSubview, setTransferSubview] = useState<'scheduled' | 'history'>('scheduled');
    const [transferHistoryFilterFrom, setTransferHistoryFilterFrom] = useState<string>('all');
    const [transferHistoryFilterTo, setTransferHistoryFilterTo] = useState<string>('all');
    const [reschedulePair, setReschedulePair] = useState<ScheduledTransferPair | null>(null);
    const [rescheduleDay, setRescheduleDay] = useState('1');
    const [rescheduleAmount, setRescheduleAmount] = useState('');

    useEffect(() => {
        const loadSharingState = async () => {
            if (!supabase || !auth?.user?.id) return;
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            const admin = inferIsAdmin(auth.user, userRecord?.role ?? null);
            setIsAdmin(admin);

            const { data: sharedRows, error: sharedRpcError } = await supabase.rpc('get_shared_accounts_for_me');
            if (sharedRpcError) {
                if (process.env.NODE_ENV === 'development') {
                    // eslint-disable-next-line no-console
                    console.warn('get_shared_accounts_for_me failed:', sharedRpcError.message);
                }
            }
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

    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

    const { cashAccounts, creditAccounts, investmentAccounts, totalCash, totalCredit, totalInvestmentTradableCash } = useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const cash = accounts.filter((a: { type?: string }) => ['Checking', 'Savings'].includes(a.type ?? ''));
        const credit = accounts.filter((a: { type?: string }) => a.type === 'Credit');
        const investmentAccountsList = accounts.filter((a: { type?: string }) => a.type === 'Investment');

        const totalCash = cash.reduce((sum: number, acc: { balance?: number; currency?: 'SAR' | 'USD' }) => {
            const cur = acc.currency === 'USD' ? 'USD' : 'SAR';
            return sum + toSAR(Number(acc.balance) || 0, cur, sarPerUsd);
        }, 0);
        const totalCredit = credit.reduce((sum: number, acc: { balance?: number; currency?: 'SAR' | 'USD' }) => {
            const cur = acc.currency === 'USD' ? 'USD' : 'SAR';
            return sum + toSAR(Number(acc.balance) || 0, cur, sarPerUsd);
        }, 0);

        /** Tradable cash per investment platform (investment transaction ledger), not holdings market value. */
        const investmentsWithTradableBalance = investmentAccountsList.map((acc: { id: string; [k: string]: unknown }) => {
            const bucket = getAvailableCashForAccount(acc.id);
            const tradableSar = tradableCashBucketToSAR(bucket, sarPerUsd);
            return { ...acc, balance: tradableSar };
        });

        const totalInvestmentTradableCash = investmentsWithTradableBalance.reduce((sum: number, acc: { balance?: number }) => sum + (acc.balance ?? 0), 0);

        return { cashAccounts: cash, creditAccounts: credit, investmentAccounts: investmentsWithTradableBalance, totalCash, totalCredit, totalInvestmentTradableCash };
    }, [data?.accounts, (data as any)?.personalAccounts, sarPerUsd, getAvailableCashForAccount]);

    const spendableBalanceSar = useCallback(
        (acc: Account | undefined): number => {
            if (!acc) return 0;
            if (acc.type === 'Investment') {
                return tradableCashBucketToSAR(getAvailableCashForAccount(acc.id), sarPerUsd);
            }
            const cur = acc.currency === 'USD' ? 'USD' : 'SAR';
            return Math.max(0, toSAR(acc.balance ?? 0, cur, sarPerUsd));
        },
        [sarPerUsd, getAvailableCashForAccount],
    );

    const orderedCashAccounts = useMemo(() => [...cashAccounts].sort((a, b) => a.name.localeCompare(b.name)), [cashAccounts]);

    const cashReconciliationById = useMemo(() => {
        const tx = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const m = new Map<string, CashAccountReconciliation>();
        orderedCashAccounts.forEach((acc) => {
            const r = reconcileCashAccountBalance(acc, tx);
            if (r) m.set(acc.id, r);
        });
        return m;
    }, [orderedCashAccounts, data?.transactions, (data as any)?.personalTransactions]);
    const orderedCreditAccounts = useMemo(() => [...creditAccounts].sort((a, b) => a.name.localeCompare(b.name)), [creditAccounts]);
    const orderedInvestmentAccounts = useMemo(() => [...investmentAccounts].sort((a, b) => a.name.localeCompare(b.name)), [investmentAccounts]);
    const accountValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        if (cashAccounts.length === 0) warnings.push('No cash accounts found. Emergency fund and transfers require Checking/Savings accounts.');
        const negativeCash = cashAccounts.filter((a: Account) => Number(a.balance) < 0);
        if (negativeCash.length > 0) warnings.push(`${negativeCash.length} cash account(s) have negative balances.`);
        const orphanPlatforms = orderedInvestmentAccounts.filter((a) => (a.linkedAccountIds ?? []).length === 0);
        if (orphanPlatforms.length > 0) warnings.push(`${orphanPlatforms.length} investment platform(s) have no linked cash accounts.`);
        if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) warnings.push('Invalid SAR/USD rate detected; fallback rate may be in use.');
        return warnings;
    }, [cashAccounts, orderedInvestmentAccounts, sarPerUsd]);

    const scheduledTransferPairs = useMemo((): ScheduledTransferPair[] => {
        const recurring = data?.recurringTransactions ?? [];
        const accounts = data?.accounts ?? [];
        const transferRecurrings = recurring.filter((r) => r.category === 'Transfers' && r.description.includes('Auto transfer to '));
        const expenses = transferRecurrings.filter((r) => r.type === 'expense');
        let incomes = transferRecurrings.filter((r) => r.type === 'income');
        const pairs: ScheduledTransferPair[] = [];
        for (const exp of expenses) {
            const match = exp.description.match(/Auto transfer to (.+?) \(from/);
            const toName = match ? match[1].trim() : '';
            const toAcc = accounts.find((a) => a.name === toName);
            if (!toAcc) continue;
            const incIndex = incomes.findIndex((i) => i.accountId === toAcc.id && i.amount === exp.amount && i.dayOfMonth === exp.dayOfMonth);
            if (incIndex === -1) continue;
            const inc = incomes[incIndex];
            incomes = incomes.slice(0, incIndex).concat(incomes.slice(incIndex + 1));
            pairs.push({
                fromAccountId: exp.accountId,
                toAccountId: inc.accountId,
                amount: exp.amount,
                dayOfMonth: exp.dayOfMonth,
                expenseId: exp.id,
                incomeId: inc.id,
                enabled: exp.enabled && inc.enabled,
            });
        }
        return pairs;
    }, [data?.recurringTransactions, data?.accounts]);

    const filteredScheduledTransfers = useMemo(() => {
        return scheduledTransferPairs.filter((p) => {
            if (transferFilterFrom !== 'all' && p.fromAccountId !== transferFilterFrom) return false;
            if (transferFilterTo !== 'all' && p.toAccountId !== transferFilterTo) return false;
            if (transferFilterStatus === 'active' && !p.enabled) return false;
            if (transferFilterStatus === 'paused' && p.enabled) return false;
            return true;
        });
    }, [scheduledTransferPairs, transferFilterFrom, transferFilterTo, transferFilterStatus]);

    const transferHistory = useMemo((): TransferHistoryItem[] => {
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const transfers = txs.filter((t: { category?: string }) => isInternalTransferTransaction(t));
        const expenses = transfers.filter((t: { type?: string }) => t.type === 'expense');
        let incomesLeft = transfers.filter((t: { type?: string }) => t.type === 'income');
        const pairs: TransferHistoryItem[] = [];
        for (const exp of expenses) {
            const absAmt = Math.abs(Number(exp.amount ?? 0));
            if (absAmt <= 0 || !Number.isFinite(absAmt)) continue;
            const expDate = (exp as { date?: string }).date ?? '';
            const fromId = exp.accountId ?? (exp as any).account_id ?? '';
            const incIdx = incomesLeft.findIndex(
                (i: { date?: string; amount?: number; accountId?: string }) =>
                    (i.date ?? '') === expDate &&
                    Math.abs(Number(i.amount ?? 0)) === absAmt &&
                    (i.accountId ?? (i as any).account_id ?? '') !== fromId
            );
            if (incIdx === -1) continue;
            const inc = incomesLeft[incIdx];
            incomesLeft = incomesLeft.slice(0, incIdx).concat(incomesLeft.slice(incIdx + 1));
            const toId = inc.accountId ?? (inc as any).account_id ?? '';
            if (!fromId || !toId) continue;
            pairs.push({
                fromAccountId: fromId,
                toAccountId: toId,
                amount: absAmt,
                date: expDate,
                description: (exp.description ?? '').replace(/^Transfer to .+?:\s*/i, '').trim() || undefined,
            });
        }
        const investmentLinkedTransfers = ((data as any)?.personalInvestmentTransactions ?? data?.investmentTransactions ?? [])
            .filter((t: any) => (t.type === 'deposit' || t.type === 'withdrawal') && !!(t.linkedCashAccountId ?? t.linked_cash_account_id))
            .map((t: any) => {
                const linkedCashAccountId = t.linkedCashAccountId ?? t.linked_cash_account_id;
                const platformAccountId = t.accountId ?? t.account_id ?? '';
                const absAmt = Math.abs(Number(t.total ?? 0));
                if (!linkedCashAccountId || !platformAccountId || !Number.isFinite(absAmt) || absAmt <= 0) return null;
                return {
                    fromAccountId: t.type === 'deposit' ? linkedCashAccountId : platformAccountId,
                    toAccountId: t.type === 'deposit' ? platformAccountId : linkedCashAccountId,
                    amount: absAmt,
                    date: String(t.date ?? ''),
                    description: t.type === 'deposit' ? 'Transfer to investment platform' : 'Transfer from investment platform',
                } as TransferHistoryItem;
            })
            .filter((v: TransferHistoryItem | null): v is TransferHistoryItem => v !== null);
        const merged = [...pairs, ...investmentLinkedTransfers];
        return merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [data?.transactions, (data as any)?.personalTransactions, data?.investmentTransactions, (data as any)?.personalInvestmentTransactions]);

    const filteredTransferHistory = useMemo(() => {
        return transferHistory.filter((p) => {
            if (transferHistoryFilterFrom !== 'all' && p.fromAccountId !== transferHistoryFilterFrom) return false;
            if (transferHistoryFilterTo !== 'all' && p.toAccountId !== transferHistoryFilterTo) return false;
            return true;
        });
    }, [transferHistory, transferHistoryFilterFrom, transferHistoryFilterTo]);

    const handleOpenAccountModal = (account: Account | null = null) => { setAccountToEdit(account); setIsAccountModalOpen(true); };

    const handleSaveAccount = async (account: Omit<Account, 'id'> | Account) => {
        try {
            if ('id' in account && account.id) {
                await updatePlatform(account as Account);
            } else {
                await addPlatform(account as Omit<Account, 'id' | 'user_id' | 'balance'> & { balance?: number });
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
        const fromCurrency = fromAccount.type === 'Investment'
            ? ((toAccount.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD')
            : ((fromAccount.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD');
        const toCurrency = toAccount.type === 'Investment'
            ? ((fromAccount.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD')
            : ((toAccount.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD');
        const availableFromInInputCurrency = fromAccount.type === 'Investment'
            ? fromSAR(spendableBalanceSar(fromAccount), fromCurrency, sarPerUsd)
            : Math.max(0, Number(fromAccount.balance) || 0);
        if (availableFromInInputCurrency < amount) {
            alert(`Insufficient balance. Available: ${formatCurrencyString(availableFromInInputCurrency, { inCurrency: fromCurrency })}`);
            return;
        }
        const convertedForDestination = fromCurrency === toCurrency
            ? amount
            : fromSAR(toSAR(amount, fromCurrency, sarPerUsd), toCurrency, sarPerUsd);
        const conversionNote = fromCurrency === toCurrency
            ? ''
            : `\nConverted amount to destination: ${formatCurrencyString(convertedForDestination, { inCurrency: toCurrency })}`;
        if (!window.confirm(`Transfer ${formatCurrencyString(amount, { inCurrency: fromCurrency })} from ${fromAccount.name} to ${toAccount.name}?${conversionNote}`)) {
            return;
        }
        try {
            const note = transferDescription.trim() || undefined;
            const today = new Date().toISOString().split('T')[0];
            await addTransfer(transferFromAccount, transferToAccount, amount, today, note);

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

    const handleAddRecurringTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!recurringFromId || !recurringToId || !recurringAmount) {
            alert('Please select both accounts and enter an amount.');
            return;
        }
        const amount = parseFloat(recurringAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Please enter a valid positive amount.');
            return;
        }
        const day = Math.min(28, Math.max(1, parseInt(recurringDayOfMonth, 10) || 1));
        const accounts = data?.accounts ?? [];
        const fromAcc = accounts.find(a => a.id === recurringFromId);
        const toAcc = accounts.find(a => a.id === recurringToId);
        if (!fromAcc || !toAcc) {
            alert('Selected accounts not found.');
            return;
        }
        const description = `Auto transfer to ${toAcc.name}`;
        try {
            await addRecurringTransaction({
                description: `${description} (from ${fromAcc.name})`,
                amount,
                type: 'expense',
                accountId: recurringFromId,
                category: 'Transfers',
                budgetCategory: 'Transfers',
                dayOfMonth: day,
                enabled: true,
            });
            await addRecurringTransaction({
                description: `${description} (to ${toAcc.name})`,
                amount,
                type: 'income',
                accountId: recurringToId,
                category: 'Transfers',
                budgetCategory: 'Transfers',
                dayOfMonth: day,
                enabled: true,
            });
            alert(`Recurring transfer set: ${formatCurrencyString(amount, { inCurrency: accountBookCurrency(fromAcc), showSecondary: true })} from ${fromAcc.name} to ${toAcc.name} on day ${day} of each month. You can edit or disable it under Transactions → Recurring.`);
            setIsRecurringTransferModalOpen(false);
            setRecurringFromId('');
            setRecurringToId('');
            setRecurringAmount('');
            setRecurringDayOfMonth('1');
        } catch (err) {
            alert(`Failed to create recurring transfer: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const recurringList = data?.recurringTransactions ?? [];
    const getRecurringById = (id: string) => recurringList.find((r) => r.id === id);

    const handlePauseTransfer = async (pair: ScheduledTransferPair) => {
        const exp = getRecurringById(pair.expenseId);
        const inc = getRecurringById(pair.incomeId);
        if (exp && inc) {
            try {
                await updateRecurringTransaction({ ...exp, enabled: false });
                await updateRecurringTransaction({ ...inc, enabled: false });
            } catch (e) {
                alert(`Failed to pause transfer: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        }
    };

    const handleResumeTransfer = async (pair: ScheduledTransferPair) => {
        const exp = getRecurringById(pair.expenseId);
        const inc = getRecurringById(pair.incomeId);
        if (exp && inc) {
            try {
                await updateRecurringTransaction({ ...exp, enabled: true });
                await updateRecurringTransaction({ ...inc, enabled: true });
            } catch (e) {
                alert(`Failed to resume transfer: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        }
    };

    const handleRemoveTransfer = async (pair: ScheduledTransferPair) => {
        if (!confirm('Remove this scheduled transfer? The recurring rules will be deleted and can only be recreated by scheduling a new transfer.')) return;
        try {
            await deleteRecurringTransaction(pair.expenseId);
            await deleteRecurringTransaction(pair.incomeId);
        } catch (e) {
            alert(`Failed to remove transfer: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
    };

    const handleOpenReschedule = (pair: ScheduledTransferPair) => {
        setReschedulePair(pair);
        setRescheduleDay(String(pair.dayOfMonth));
        setRescheduleAmount(String(pair.amount));
    };

    const handleSaveReschedule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!reschedulePair) return;
        const day = Math.min(28, Math.max(1, parseInt(rescheduleDay, 10) || 1));
        const amount = parseFloat(rescheduleAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Please enter a valid positive amount.');
            return;
        }
        const exp = getRecurringById(reschedulePair.expenseId);
        const inc = getRecurringById(reschedulePair.incomeId);
        if (!exp || !inc) {
            setReschedulePair(null);
            return;
        }
        try {
            await updateRecurringTransaction({ ...exp, amount, dayOfMonth: day });
            await updateRecurringTransaction({ ...inc, amount, dayOfMonth: day });
            setReschedulePair(null);
        } catch (err) {
            alert(`Failed to reschedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading accounts" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Accounts"
            description="Add your bank accounts, savings, and investment platforms. Investment platforms show cash available for trading (from your investment activity), not total portfolio market value."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <AddButton onClick={() => handleOpenAccountModal()}>Add New Account</AddButton>
                </div>
            }
        >
            <div className="cards-grid grid grid-cols-1 md:grid-cols-3">
                 <Card title="Total Cash Balance (SAR eq.)" value={maskBalance(formatCurrencyString(totalCash))} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Sum of Checking and Savings converted to SAR equivalent using current FX rate." />
                 <Card title="Total Credit Balance (SAR eq.)" value={maskBalance(formatCurrencyString(totalCredit))} indicatorColor="red" valueColor="text-rose-700" icon={<CreditCardIcon className="h-5 w-5 text-rose-600" />} tooltip="Total amount owed across all credit accounts, converted to SAR equivalent." />
                 <Card title="Tradable cash (platforms, SAR eq.)" value={maskBalance(formatCurrencyString(totalInvestmentTradableCash))} indicatorColor="yellow" valueColor="text-indigo-700" icon={<ArrowTrendingUpIcon className="h-5 w-5 text-indigo-600" />} tooltip="Cash available for trading on investment platforms (from deposits, sells, dividends minus buys & withdrawals), converted to SAR equivalent." />
            </div>
            {accountValidationWarnings.length > 0 && (
                <SectionCard title="Accounts validation checks" collapsible collapsibleSummary="Data quality and wiring checks" defaultExpanded className="mt-4">
                    <ul className="space-y-1 text-sm text-amber-800">
                        {accountValidationWarnings.map((w, idx) => (
                            <li key={`aw-${idx}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <div className="section-card border-l-4 border-emerald-500/50 mt-4">
                <h3 className="section-title text-base">Emergency fund (liquid cash)</h3>
                <p className="text-lg font-semibold text-dark tabular-nums">{maskBalance(formatCurrencyString(emergencyFund.emergencyCash))} = <strong>{emergencyFund.monthsCovered.toFixed(1)} months</strong> of essential expenses</p>
                <p className="text-sm text-slate-600 mt-1">Target: {EMERGENCY_FUND_TARGET_MONTHS} months. {emergencyFund.hasEssentialExpenseEstimate ? (emergencyFund.shortfall > 0 ? <>Shortfall: <strong>{maskBalance(formatCurrencyString(emergencyFund.shortfall))}</strong>. Build savings in Checking/Savings to reach the target.</> : 'Target met. Your liquid cash is adequate for emergencies.') : 'Add essential expense categories or budgets to measure months covered.'}</p>
                {setActivePage && <button type="button" onClick={() => setActivePage('Summary')} className="mt-2 text-sm text-primary font-medium hover:underline">View full breakdown on Summary →</button>}
            </div>

            {isAdmin && (
                <section className="section-card mt-4">
                    <h3 className="section-title text-base">Share account with another user</h3>
                    <p className="text-sm text-slate-600 mb-4">Share read-only account visibility with a specific user, similar to budget sharing.</p>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Account</label>
                                <select value={shareAccountId} onChange={(e) => setShareAccountId(e.target.value)} className="select-base w-full">
                                    <option value="">Select account</option>
                                    {(data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">User email</label>
                                <select value={shareTargetEmail} onChange={(e) => setShareTargetEmail(e.target.value)} className="select-base w-full">
                                    <option value="">Select user</option>
                                    {shareableUsers.map((u) => <option key={u.id} value={u.email}>{u.email}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                            <input
                                type="checkbox"
                                id="share-show-balance"
                                checked={shareShowBalance}
                                onChange={(e) => setShareShowBalance(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            <label htmlFor="share-show-balance" className="text-sm text-slate-700 cursor-pointer">Allow recipient to view balance</label>
                        </div>
                        <div className="pt-2">
                            <button type="button" onClick={handleShareAccount} className="btn-primary px-5 py-2.5">Share Account</button>
                        </div>
                    </div>
                    {shareError && <p className="text-sm text-rose-600 mt-3">{shareError}</p>}
                    {shareSuccess && <p className="text-sm text-emerald-600 mt-3">{shareSuccess}</p>}
                </section>
            )}

            <section className="section-card mt-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <ArrowsRightLeftIcon className="h-5 w-5 text-slate-500 shrink-0" />
                        <h3 className="section-title text-base mb-0">Transfer Between Accounts</h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => setIsRecurringTransferModalOpen(true)} className="btn-outline text-sm">
                            Schedule auto transfer
                        </button>
                        <button type="button" onClick={() => setIsTransferModalOpen(true)} className="btn-primary text-sm">
                            Transfer now
                        </button>
                    </div>
                </div>
                <p className="text-sm text-slate-600 mt-1 mb-2">One-time transfers or recurring auto transfers between Checking, Savings, and Investment accounts. Use &quot;Transfer now&quot; for a single move; &quot;Schedule auto transfer&quot; to repeat monthly on a set day.</p>

                {/* Tabs: Scheduled | History */}
                <div className="flex gap-1 mb-4 border-b border-slate-200">
                    <button
                        type="button"
                        onClick={() => setTransferSubview('scheduled')}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${transferSubview === 'scheduled' ? 'bg-slate-100 text-slate-800 border-b-2 border-primary -mb-px' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'}`}
                    >
                        <span className="flex items-center gap-2">
                            <CalendarDaysIcon className="h-4 w-4" />
                            Scheduled ({scheduledTransferPairs.length})
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setTransferSubview('history')}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${transferSubview === 'history' ? 'bg-slate-100 text-slate-800 border-b-2 border-primary -mb-px' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'}`}
                    >
                        <span className="flex items-center gap-2">
                            <ClockIcon className="h-4 w-4" />
                            History ({transferHistory.length})
                        </span>
                    </button>
                </div>

                {transferSubview === 'scheduled' && (
                <>
                {/* Summary and filter toggle */}
                {scheduledTransferPairs.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <p className="text-sm text-slate-600">
                            {filteredScheduledTransfers.length === scheduledTransferPairs.length ? (
                                <span><strong>{scheduledTransferPairs.length}</strong> scheduled transfer{scheduledTransferPairs.length !== 1 ? 's' : ''} ({scheduledTransferPairs.filter(p => p.enabled).length} active{scheduledTransferPairs.some(p => !p.enabled) ? `, ${scheduledTransferPairs.filter(p => !p.enabled).length} paused` : ''})</span>
                            ) : (
                                <span>Showing <strong>{filteredScheduledTransfers.length}</strong> of {scheduledTransferPairs.length} transfer{scheduledTransferPairs.length !== 1 ? 's' : ''}</span>
                            )}
                        </p>
                        <button
                            type="button"
                            onClick={() => setScheduledTransfersFiltersOpen((v) => !v)}
                            className="text-xs font-medium text-slate-600 hover:text-slate-800 flex items-center gap-1"
                            aria-expanded={scheduledTransfersFiltersOpen}
                        >
                            Filters {(transferFilterFrom !== 'all' || transferFilterTo !== 'all' || transferFilterStatus !== 'all') && <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded">on</span>}
                            <ChevronDownIcon className={`h-4 w-4 transition-transform ${scheduledTransfersFiltersOpen ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                )}

                {/* Filters: collapsible, clear labels, clear-all when active */}
                {scheduledTransferPairs.length > 0 && scheduledTransfersFiltersOpen && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 mb-4">
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">From account</label>
                                <select value={transferFilterFrom} onChange={(e) => setTransferFilterFrom(e.target.value)} className="select-base text-sm py-1.5 min-w-[140px]">
                                    <option value="all">All accounts</option>
                                    {(data?.accounts ?? []).filter(a => a.type !== 'Credit').map((acc) => (
                                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">To account</label>
                                <select value={transferFilterTo} onChange={(e) => setTransferFilterTo(e.target.value)} className="select-base text-sm py-1.5 min-w-[140px]">
                                    <option value="all">All accounts</option>
                                    {(data?.accounts ?? []).filter(a => a.type !== 'Credit').map((acc) => (
                                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">Status</label>
                                <select value={transferFilterStatus} onChange={(e) => setTransferFilterStatus(e.target.value as 'all' | 'active' | 'paused')} className="select-base text-sm py-1.5 min-w-[100px]">
                                    <option value="all">All</option>
                                    <option value="active">Active</option>
                                    <option value="paused">Paused</option>
                                </select>
                            </div>
                            {(transferFilterFrom !== 'all' || transferFilterTo !== 'all' || transferFilterStatus !== 'all') && (
                                <button type="button" onClick={() => { setTransferFilterFrom('all'); setTransferFilterTo('all'); setTransferFilterStatus('all'); }} className="text-xs font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1 ml-auto">
                                    <XMarkIcon className="h-4 w-4" /> Clear filters
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {filteredScheduledTransfers.length === 0 ? (
                    <div className="text-center py-10 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                        <ArrowsRightLeftIcon className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-600 font-medium">
                            {scheduledTransferPairs.length === 0 ? 'No scheduled transfers yet' : 'No transfers match the current filters'}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                            {scheduledTransferPairs.length === 0 ? 'Set up a monthly auto transfer between two accounts.' : 'Try changing or clearing the filters above.'}
                        </p>
                        {scheduledTransferPairs.length === 0 && (
                            <button type="button" onClick={() => setIsRecurringTransferModalOpen(true)} className="mt-4 btn-primary text-sm">
                                Schedule auto transfer
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredScheduledTransfers.map((pair) => {
                            const fromAcc = (data?.accounts ?? []).find((a) => a.id === pair.fromAccountId);
                            const toAcc = (data?.accounts ?? []).find((a) => a.id === pair.toAccountId);
                            return (
                                <div key={`${pair.expenseId}-${pair.incomeId}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition-all">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-slate-800 truncate">{fromAcc?.name ?? pair.fromAccountId}</span>
                                                <span className="text-slate-400 shrink-0"><ArrowsRightLeftIcon className="h-4 w-4" /></span>
                                                <span className="font-medium text-slate-800 truncate">{toAcc?.name ?? pair.toAccountId}</span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-2 text-sm text-slate-600">
                                                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(pair.amount, { inCurrency: accountBookCurrency(fromAcc), showSecondary: true })}</span>
                                                <span className="text-slate-400">/ month</span>
                                                <span className="flex items-center gap-1 text-slate-500">
                                                    <CalendarDaysIcon className="h-4 w-4" /> Day {pair.dayOfMonth}
                                                </span>
                                            </div>
                                        </div>
                                        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${pair.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {pair.enabled ? 'Active' : 'Paused'}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-1 mt-3 pt-3 border-t border-slate-100">
                                        {pair.enabled ? (
                                            <button type="button" onClick={() => handlePauseTransfer(pair)} className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100" title="Pause">Pause</button>
                                        ) : (
                                            <button type="button" onClick={() => handleResumeTransfer(pair)} className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100" title="Resume">Resume</button>
                                        )}
                                        <button type="button" onClick={() => handleOpenReschedule(pair)} className="p-1.5 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg" title="Reschedule"><PencilIcon className="h-4 w-4" /></button>
                                        <button type="button" onClick={() => handleRemoveTransfer(pair)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Remove"><TrashIcon className="h-4 w-4" /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                </>
                )}

                {transferSubview === 'history' && (
                <>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-slate-600 whitespace-nowrap">From</label>
                        <select value={transferHistoryFilterFrom} onChange={(e) => setTransferHistoryFilterFrom(e.target.value)} className="select-base text-sm py-1.5 min-w-[140px]">
                            <option value="all">All accounts</option>
                            {(data?.accounts ?? []).filter((a: { type?: string }) => a.type !== 'Credit').map((acc: { id: string; name: string }) => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-slate-600 whitespace-nowrap">To</label>
                        <select value={transferHistoryFilterTo} onChange={(e) => setTransferHistoryFilterTo(e.target.value)} className="select-base text-sm py-1.5 min-w-[140px]">
                            <option value="all">All accounts</option>
                            {(data?.accounts ?? []).filter((a: { type?: string }) => a.type !== 'Credit').map((acc: { id: string; name: string }) => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>
                    {(transferHistoryFilterFrom !== 'all' || transferHistoryFilterTo !== 'all') && (
                        <button type="button" onClick={() => { setTransferHistoryFilterFrom('all'); setTransferHistoryFilterTo('all'); }} className="text-xs font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1">
                            <XMarkIcon className="h-4 w-4" /> Clear filters
                        </button>
                    )}
                </div>
                {filteredTransferHistory.length === 0 ? (
                    <div className="text-center py-10 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                        <ClockIcon className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-600 font-medium">
                            {transferHistory.length === 0 ? 'No transfer history yet' : 'No transfers match the filters'}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                            {transferHistory.length === 0 ? 'Transfers you make with &quot;Transfer now&quot; will appear here.' : 'Try changing or clearing the filters above.'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                        {filteredTransferHistory.map((item, idx) => {
                            const fromAcc = (data?.accounts ?? []).find((a: { id: string }) => a.id === item.fromAccountId);
                            const toAcc = (data?.accounts ?? []).find((a: { id: string }) => a.id === item.toAccountId);
                            return (
                                <div key={`${item.date}-${item.fromAccountId}-${item.toAccountId}-${item.amount}-${idx}`} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white hover:bg-slate-50 border-b border-slate-100 last:border-0">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="font-medium text-slate-800 truncate">{fromAcc?.name ?? item.fromAccountId}</span>
                                        <ArrowsRightLeftIcon className="h-4 w-4 text-slate-400 shrink-0" />
                                        <span className="font-medium text-slate-800 truncate">{toAcc?.name ?? item.toAccountId}</span>
                                    </div>
                                    <span className="font-semibold text-slate-900 tabular-nums shrink-0">{formatCurrencyString(item.amount, { inCurrency: accountBookCurrency(fromAcc), showSecondary: true })}</span>
                                    <span className="text-sm text-slate-500 shrink-0">{new Date(item.date).toLocaleDateString()}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
                </>
                )}
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
                        <AccountCardComponent
                            key={acc.id}
                            account={acc}
                            onEditAccount={handleOpenAccountModal}
                            onDeleteAccount={handleOpenDeleteModal}
                            linkedPortfoliosCount={0}
                            cashReconciliation={cashReconciliationById.get(acc.id) ?? null}
                        />
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
                            <AccountCardComponent key={acc.id} account={acc} onEditAccount={handleOpenAccountModal} onDeleteAccount={handleOpenDeleteModal} linkedPortfoliosCount={linkedCount} balanceMetricLabel="Cash for trading" />
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

            <Modal isOpen={isRecurringTransferModalOpen} onClose={() => setIsRecurringTransferModalOpen(false)} title="Schedule recurring transfer">
                <form onSubmit={handleAddRecurringTransfer} className="space-y-4">
                    <p className="text-sm text-slate-600">Create a monthly auto transfer. Two recurring entries (out from source, in to destination) will be added; you can edit or disable them in Transactions → Recurring.</p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">From account</label>
                        <select value={recurringFromId} onChange={(e) => setRecurringFromId(e.target.value)} required className="select-base w-full">
                            <option value="">Select source</option>
                            {(data?.accounts ?? []).filter(a => a.type !== 'Credit').map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">To account</label>
                        <select value={recurringToId} onChange={(e) => setRecurringToId(e.target.value)} required className="select-base w-full">
                            <option value="">Select destination</option>
                            {(data?.accounts ?? []).filter(a => a.id !== recurringFromId && a.type !== 'Credit').map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount (each month)</label>
                        <input type="number" min="0.01" step="0.01" value={recurringAmount} onChange={(e) => setRecurringAmount(e.target.value)} required className="input-base w-full" placeholder="0.00" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Day of month (1–28)</label>
                        <input type="number" min="1" max="28" value={recurringDayOfMonth} onChange={(e) => setRecurringDayOfMonth(e.target.value)} className="input-base w-full" />
                    </div>
                    <button type="submit" className="w-full btn-primary">Create recurring transfer</button>
                </form>
            </Modal>

            <Modal isOpen={!!reschedulePair} onClose={() => setReschedulePair(null)} title="Reschedule transfer">
                {reschedulePair && (
                    <form onSubmit={handleSaveReschedule} className="space-y-4">
                        <p className="text-sm text-slate-600">Change the amount and/or day of month for this scheduled transfer.</p>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (each month)</label>
                            <input type="number" min="0.01" step="0.01" value={rescheduleAmount} onChange={(e) => setRescheduleAmount(e.target.value)} required className="input-base w-full" placeholder="0.00" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Day of month (1–28)</label>
                            <input type="number" min={1} max={28} value={rescheduleDay} onChange={(e) => setRescheduleDay(e.target.value)} className="input-base w-full" />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setReschedulePair(null)} className="btn-outline">Cancel</button>
                            <button type="submit" className="btn-primary">Save changes</button>
                        </div>
                    </form>
                )}
            </Modal>

            <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Transfer Between Accounts">
                <form onSubmit={(e) => { e.preventDefault(); handleTransfer(); }} className="space-y-4">
                    {transferFromAccount && transferToAccount && (() => {
                        const fromAcc = (data?.accounts ?? []).find(a => a.id === transferFromAccount);
                        const toAcc = (data?.accounts ?? []).find(a => a.id === transferToAccount);
                        if (!fromAcc || !toAcc) return null;
                        const fromCur = fromAcc.type === 'Investment'
                            ? (toAcc.currency === 'USD' ? 'USD' : 'SAR')
                            : (fromAcc.currency === 'USD' ? 'USD' : 'SAR');
                        const toCur = toAcc.type === 'Investment'
                            ? (fromAcc.currency === 'USD' ? 'USD' : 'SAR')
                            : (toAcc.currency === 'USD' ? 'USD' : 'SAR');
                        if (fromCur === toCur) return null;
                        const amt = Number(transferAmount) || 0;
                        const converted = amt > 0 ? fromSAR(toSAR(amt, fromCur, sarPerUsd), toCur, sarPerUsd) : 0;
                        return (
                            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                                Cross-currency transfer: amount is entered in source currency ({fromCur}). Destination receives approximately {formatCurrencyString(converted, { inCurrency: toCur })}.
                            </div>
                        );
                    })()}
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
                                    {acc.name} ({formatCurrencyString(
                                        acc.type === 'Investment'
                                            ? fromSAR(spendableBalanceSar(acc), ((data?.accounts ?? []).find(a => a.id === transferToAccount)?.currency === 'USD' ? 'USD' : 'SAR'), sarPerUsd)
                                            : Math.max(0, Number(acc.balance) || 0),
                                        { inCurrency: acc.type === 'Investment' ? (((data?.accounts ?? []).find(a => a.id === transferToAccount)?.currency === 'USD') ? 'USD' : 'SAR') : (acc.currency === 'USD' ? 'USD' : 'SAR') },
                                    )})
                                </option>
                            ))}
                        </select>
                        {transferFromAccount && (() => {
                            const acc = (data?.accounts ?? []).find(a => a.id === transferFromAccount);
                            const cur = acc?.type === 'Investment'
                                ? (((data?.accounts ?? []).find(a => a.id === transferToAccount)?.currency === 'USD') ? 'USD' : 'SAR')
                                : (acc?.currency === 'USD' ? 'USD' : 'SAR');
                            return acc && (
                                <p className="text-xs text-slate-500 mt-1">
                                    Available{acc.type === 'Investment' ? ' for trading' : ' balance'}: {formatCurrencyString(
                                        acc.type === 'Investment' ? fromSAR(spendableBalanceSar(acc), cur, sarPerUsd) : Math.max(0, Number(acc.balance) || 0),
                                        { inCurrency: cur },
                                    )}
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
                                    {acc.name} ({maskBalance(formatCurrencyString(
                                        acc.type === 'Investment'
                                            ? fromSAR(spendableBalanceSar(acc), ((data?.accounts ?? []).find(a => a.id === transferFromAccount))?.currency === 'USD' ? 'USD' : 'SAR', sarPerUsd)
                                            : Math.max(0, Number(acc.balance) || 0),
                                        { inCurrency: acc.type === 'Investment' ? (((data?.accounts ?? []).find(a => a.id === transferFromAccount)?.currency === 'USD') ? 'USD' : 'SAR') : (acc.currency === 'USD' ? 'USD' : 'SAR') },
                                    ))})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            Amount <InfoHint text="Amount in source account currency. If source/destination currencies differ, conversion is applied automatically." />
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
            <AIAdvisor
                pageContext="cashflow"
                contextData={{ transactions: (data as any)?.personalTransactions ?? data?.transactions ?? [], budgets: data?.budgets ?? [] }}
                title="Accounts AI Advisor"
                subtitle="Cash positioning, transfer patterns, and account health insights."
                buttonLabel="Get AI Insights"
            />
        </PageLayout>
    );
};

export default Accounts;
