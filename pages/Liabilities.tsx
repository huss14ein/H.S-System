import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { Page } from '../types';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { HomeIcon } from '../components/icons/HomeIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import { DemoDataButton } from '../components/DemoDataButton';

type StatusFilter = 'active' | 'paid' | 'all';

function matchesStatusFilter(liability: Liability, filter: StatusFilter): boolean {
    const status = liability.status ?? 'Active';
    if (filter === 'all') return true;
    if (filter === 'active') return status === 'Active';
    return status === 'Paid';
}

const LiabilityModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (liability: Liability) => void; liabilityToEdit: Liability | null }> = ({ isOpen, onClose, onSave, liabilityToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Liability['type']>('Personal Loan');
    const [amount, setAmount] = useState('');
    const [status, setStatus] = useState<Liability['status']>('Active');

    React.useEffect(() => {
        if (liabilityToEdit) {
            setName(liabilityToEdit.name);
            setType(liabilityToEdit.type);
            setAmount(String(Math.abs(liabilityToEdit.amount)));
            setStatus(liabilityToEdit.status ?? 'Active');
        } else {
            setName('');
            setType('Personal Loan');
            setAmount('');
            setStatus('Active');
        }
    }, [liabilityToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = Math.abs(parseFloat(amount) || 0);
        const newLiability: Liability = {
            id: liabilityToEdit ? liabilityToEdit.id : `liab${Date.now()}`,
            name,
            type,
            amount: type === 'Receivable' ? value : -value,
            status,
            goalId: liabilityToEdit?.goalId,
        };
        onSave(newLiability);
        onClose();
    };

    const isReceivable = type === 'Receivable';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={liabilityToEdit ? 'Edit Entry' : 'Add Liability'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                        {isReceivable ? 'Description (who owes you)' : 'Liability Name'}
                        <InfoHint text={isReceivable ? "e.g. Friend's name, client name, or 'Personal loan to Ahmad'" : "A clear name (e.g. Car Loan, Mortgage) for tracking and net worth."} />
                    </label>
                    <input type="text" placeholder={isReceivable ? "e.g. Ahmad - Personal loan" : "Liability Name"} value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Choose debt or money owed back to you; all are managed under liabilities." /></label>
                    <select value={type} onChange={e => setType(e.target.value as Liability['type'])} required className="select-base">
                        <option value="Credit Card">Credit Card</option>
                        <option value="Loan">Loan (e.g., Car, Institutional)</option>
                        <option value="Personal Loan">Personal Loan (from individual)</option>
                        <option value="Mortgage">Mortgage</option>
                        <option value="Receivable">Money Owed to Me (Receivable)</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                        {isReceivable ? 'Amount owed to you' : 'Total amount owed'}
                        <InfoHint text={isReceivable ? "Amount they owe you (outstanding)." : "Outstanding balance; affects net worth and Zakat deductible liabilities."} />
                    </label>
                    <input type="number" step="any" min="0" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} required className="input-base"/>
                </div>
                {liabilityToEdit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select value={status} onChange={e => setStatus(e.target.value as Liability['status'])} className="select-base">
                            <option value="Active">Active (unpaid)</option>
                            <option value="Paid">Paid / Completed</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Mark as Paid to keep a reference without affecting totals.</p>
                    </div>
                )}
                <button type="submit" className="w-full btn-primary">Save</button>
            </form>
        </Modal>
    );
};

const DebtCard: React.FC<{ liability: Liability; onEdit: (l: Liability) => void; onMarkPaid: (l: Liability) => void; canMarkPaid: boolean; canEdit: boolean; onGoToAccounts?: () => void }> = ({ liability, onEdit, onMarkPaid, canMarkPaid, canEdit, onGoToAccounts }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const isPaid = (liability.status ?? 'Active') === 'Paid';
    const getIcon = (type: Liability['type']) => {
        const iconClass = "h-8 w-8";
        switch (type) {
            case 'Mortgage': return <HomeIcon className={`${iconClass} text-blue-500`} />;
            case 'Loan': return <ShieldCheckIcon className={`${iconClass} text-purple-500`} />;
            case 'Personal Loan': return <ShieldCheckIcon className={`${iconClass} text-indigo-500`} />;
            case 'Credit Card': return <CreditCardIcon className={`${iconClass} text-red-500`} />;
            default: return <CreditCardIcon className={`${iconClass} text-red-500`} />;
        }
    };
    return (
        <div className={`section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300 ${isPaid ? 'opacity-75 border-l-4 border-slate-300' : ''}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    {getIcon(liability.type)}
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500">{liability.type}{isPaid ? ' · Paid' : ''}</p>
                    </div>
                </div>
                <div className="flex space-x-1 items-center">
                    {canEdit && (
                        <button type="button" onClick={() => onEdit(liability)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit"><PencilIcon className="h-4 w-4"/></button>
                    )}
                    {canMarkPaid && !isPaid && (
                        <button type="button" onClick={() => onMarkPaid(liability)} className="p-1.5 text-gray-400 hover:text-emerald-600 flex items-center gap-1 text-xs font-medium" aria-label="Mark as paid" title="Mark as paid (keeps reference)"><CheckCircleIcon className="h-4 w-4"/><span className="hidden sm:inline">Paid</span></button>
                    )}
                    {!canEdit && onGoToAccounts && (
                        <button type="button" onClick={onGoToAccounts} className="text-xs text-primary hover:underline py-1">Manage in Accounts</button>
                    )}
                </div>
            </div>
            <div className="mt-4 text-right">
                <p className="text-sm text-gray-500">Amount owed</p>
                <p className="text-2xl font-semibold text-danger">{formatCurrencyString(Math.abs(liability.amount))}</p>
            </div>
        </div>
    );
};

const ReceivableCard: React.FC<{ liability: Liability; onEdit: (l: Liability) => void; onMarkPaid: (l: Liability) => void; canMarkPaid: boolean }> = ({ liability, onEdit, onMarkPaid, canMarkPaid }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const isPaid = (liability.status ?? 'Active') === 'Paid';
    return (
        <div className={`section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300 border-l-4 ${isPaid ? 'border-slate-300' : 'border-emerald-500'}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    <BanknotesIcon className={`h-8 w-8 ${isPaid ? 'text-slate-400' : 'text-emerald-500'}`} />
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500">{isPaid ? 'Owed to you · Paid' : 'Owed to you'}</p>
                    </div>
                </div>
                <div className="flex space-x-1 items-center">
                    <button type="button" onClick={() => onEdit(liability)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit"><PencilIcon className="h-4 w-4"/></button>
                    {canMarkPaid && !isPaid && (
                        <button type="button" onClick={() => onMarkPaid(liability)} className="p-1.5 text-gray-400 hover:text-emerald-600 flex items-center gap-1 text-xs font-medium" aria-label="Mark as paid" title="Mark as paid (keeps reference)"><CheckCircleIcon className="h-4 w-4"/><span className="hidden sm:inline">Paid</span></button>
                    )}
                </div>
            </div>
            <div className="mt-4 text-right">
                <p className="text-sm text-gray-500">Amount owed to you</p>
                <p className={`text-2xl font-semibold ${isPaid ? 'text-gray-600' : 'text-emerald-700'}`}>{formatCurrencyString(liability.amount)}</p>
            </div>
        </div>
    );
};

interface LiabilitiesProps { setActivePage?: (page: Page) => void; }
const Liabilities: React.FC<LiabilitiesProps> = ({ setActivePage }) => {
    const { data, addLiability, updateLiability } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [liabilityToEdit, setLiabilityToEdit] = useState<Liability | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

    const allLiabilities: Liability[] = useMemo(() => {
        const creditCardDebts = data.accounts
            .filter(a => a.type === 'Credit' && a.balance < 0)
            .map(a => ({ id: a.id, name: a.name, type: 'Credit Card' as const, amount: a.balance, status: 'Active' as const }));
        return [...data.liabilities, ...creditCardDebts];
    }, [data.liabilities, data.accounts]);

    const allDebts = useMemo(() => allLiabilities.filter(l => (l.amount ?? 0) < 0), [allLiabilities]);
    const allReceivables = useMemo(() => allLiabilities.filter(l => (l.amount ?? 0) > 0), [allLiabilities]);
    const debts = useMemo(() => allDebts.filter(l => matchesStatusFilter(l, statusFilter)), [allDebts, statusFilter]);
    const receivables = useMemo(() => allReceivables.filter(l => matchesStatusFilter(l, statusFilter)), [allReceivables, statusFilter]);
    const liabilityIds = useMemo(() => new Set(data.liabilities.map(l => l.id)), [data.liabilities]);

    const { totalDebt, totalReceivable, debtToAssetRatio, netPosition } = useMemo(() => {
        const activeDebts = allDebts.filter(l => (l.status ?? 'Active') === 'Active');
        const activeReceivables = allReceivables.filter(l => (l.status ?? 'Active') === 'Active');
        const totalDebt = activeDebts.reduce((sum, liab) => sum + Math.abs(liab.amount ?? 0), 0);
        const totalReceivable = activeReceivables.reduce((sum, liab) => sum + (liab.amount ?? 0), 0);
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => (a.balance ?? 0) > 0).reduce((sum, acc) => sum + (acc.balance ?? 0), 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
        const netPosition = totalReceivable - totalDebt;
        return { totalDebt, totalReceivable, debtToAssetRatio, netPosition };
    }, [allDebts, allReceivables, data.assets, data.accounts]);

    const handleOpenModal = (liability: Liability | null = null) => {
        setLiabilityToEdit(liability);
        setIsModalOpen(true);
    };

    const handleSaveLiability = (liability: Liability) => {
        if (liabilityIds.has(liability.id)) {
            updateLiability(liability);
        } else if (liabilityToEdit && !liabilityIds.has(liability.id)) {
            setIsModalOpen(false);
            setLiabilityToEdit(null);
            return;
        } else {
            addLiability(liability);
        }
    };

    const handleMarkPaid = (liability: Liability) => {
        if (liabilityIds.has(liability.id)) {
            updateLiability({ ...liability, status: 'Paid' });
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-rose-50">
            {/* Enhanced Hero Section */}
            <div className="rounded-3xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-rose-50 p-8 shadow-xl mb-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">💳</span>
                        </div>
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900">Liabilities</h2>
                            <p className="text-lg text-slate-600 mt-2">Track liabilities, including debts and money owed back to you. Mark as Paid to keep a reference; totals show only unpaid.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-bold text-rose-700 uppercase tracking-wider">Debt Management</span>
                    </div>
                </div>
                <div className="mt-6 bg-gradient-to-r from-rose-50 to-red-50 rounded-2xl p-6 border border-rose-100">
                    <p className="text-slate-700 leading-relaxed">
                        Monitor your financial obligations and receivables in one place. Track loans, mortgages, credit cards, and money owed to you 
                        for comprehensive debt management and financial planning.
                    </p>
                </div>
            </div>

            {/* Enhanced Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 mb-8">
                <div className="bg-gradient-to-br from-rose-50 to-red-50 border-2 border-rose-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">💰</span>
                        </div>
                        <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-rose-800 uppercase tracking-wider mb-2">Total Debt</p>
                    <p className="text-4xl font-black text-rose-900 tabular-nums">{formatCurrencyString(totalDebt)}</p>
                    <p className="text-sm text-rose-600 mt-2">Unpaid obligations</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">💵</span>
                        </div>
                        <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-2">Money Owed to You</p>
                    <p className="text-4xl font-black text-emerald-900 tabular-nums">{formatCurrencyString(totalReceivable)}</p>
                    <p className="text-sm text-emerald-600 mt-2">Receivables</p>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">📊</span>
                        </div>
                        <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-blue-800 uppercase tracking-wider mb-2">Net Position</p>
                    <p className="text-4xl font-black text-blue-900 tabular-nums">{formatCurrencyString(netPosition)}</p>
                    <p className="text-sm text-blue-600 mt-2">Receivables − Debt</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">📈</span>
                        </div>
                        <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-2">Debt-to-Asset Ratio</p>
                    <p className="text-4xl font-black text-amber-900 tabular-nums">{debtToAssetRatio.toFixed(2)}%</p>
                    <p className="text-sm text-amber-600 mt-2">Risk indicator</p>
                </div>
            </div>

            {/* Enhanced Filter Controls */}
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-8 shadow-lg mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center shadow-lg">
                        <span className="text-white font-bold text-lg">🔍</span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Filter & Actions</h3>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label htmlFor="status-filter" className="text-sm font-medium text-slate-700">Show:</label>
                        <select
                            id="status-filter"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                            className="h-12 px-4 text-sm border-2 border-slate-200 rounded-xl focus:border-rose-500 focus:outline-none bg-white shadow-sm hover:shadow-md transition-all duration-200"
                        >
                            <option value="active">Active (unpaid)</option>
                            <option value="paid">Paid / Completed</option>
                            <option value="all">All</option>
                        </select>
                    </div>
                    <button type="button" onClick={() => handleOpenModal(null)} className="h-12 px-6 text-sm border-2 border-rose-300 text-rose-700 rounded-xl hover:bg-rose-50 transition-all duration-200 font-medium flex items-center gap-2">
                        <CreditCardIcon className="h-4 w-4" /> Add Liabilities
                    </button>
                    <DemoDataButton page="Liabilities" options={{ includeLiabilities: true }} />
                </div>
            </div>

            {/* Enhanced Main Content */}
            <div className="space-y-8">
                <SectionCard title="What I Owe" className="mt-6">
                    <p className="text-sm text-gray-500 mb-4">Loans, mortgages, credit card balances, and other debts. Credit card rows are synced from your linked accounts.</p>
                    {debts.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">No debts recorded. Add a liability or link a credit account with a negative balance.</p>
                    ) : (
                        <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                            {debts.map(liab => (
                                <DebtCard
                                    key={liab.id}
                                    liability={liab}
                                    onEdit={l => handleOpenModal(l)}
                                    onMarkPaid={handleMarkPaid}
                                    canMarkPaid={liabilityIds.has(liab.id)}
                                    canEdit={liabilityIds.has(liab.id)}
                                    onGoToAccounts={setActivePage ? () => setActivePage('Accounts') : undefined}
                                />
                            ))}
                        </div>
                    )}
                </SectionCard>

                <SectionCard title="Liabilities" className="mt-6">
                    <p className="text-sm text-gray-500 mb-4">Money others owe you—personal loans you gave, outstanding invoices, or money friends/family will repay. Managed under liabilities so all entries stay in one flow.</p>
                    {receivables.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">No liability entries in this group for this filter. Switch filter to Paid/All to review historical items.</p>
                    ) : (
                        <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                            {receivables.map(liab => (
                                <ReceivableCard key={liab.id} liability={liab} onEdit={l => handleOpenModal(l)} onMarkPaid={handleMarkPaid} canMarkPaid={liabilityIds.has(liab.id)} />
                            ))}
                        </div>
                    )}
                </SectionCard>
            </div>

            <LiabilityModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveLiability} liabilityToEdit={liabilityToEdit} />
        </div>
    );
};

export default Liabilities;
