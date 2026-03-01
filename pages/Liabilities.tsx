
import React, { useState, useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { Liability, Page } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { ShieldCheckIcon } from '../components/icons/ShieldCheckIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { HomeIcon } from '../components/icons/HomeIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';

type LiabilityDirection = 'debt' | 'receivable';
type StatusFilter = 'active' | 'paid' | 'all';

function matchesStatusFilter(liability: Liability, filter: StatusFilter): boolean {
    const status = liability.status ?? 'Active';
    if (filter === 'all') return true;
    if (filter === 'active') return status === 'Active';
    return status === 'Paid';
}

const LiabilityModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (liability: Liability) => void; liabilityToEdit: Liability | null; defaultDirection?: LiabilityDirection }> = ({ isOpen, onClose, onSave, liabilityToEdit, defaultDirection = 'debt' }) => {
    const [direction, setDirection] = useState<LiabilityDirection>(defaultDirection);
    const [name, setName] = useState('');
    const [type, setType] = useState<Liability['type']>('Loan');
    const [amount, setAmount] = useState('');
    const [status, setStatus] = useState<Liability['status']>('Active');

    React.useEffect(() => {
        if (liabilityToEdit) {
            const isReceivable = liabilityToEdit.amount > 0 || liabilityToEdit.type === 'Receivable';
            setDirection(isReceivable ? 'receivable' : 'debt');
            setName(liabilityToEdit.name);
            setType(liabilityToEdit.type === 'Receivable' ? 'Receivable' : liabilityToEdit.type);
            setAmount(String(Math.abs(liabilityToEdit.amount)));
            setStatus(liabilityToEdit.status ?? 'Active');
        } else {
            setDirection(defaultDirection);
            setName('');
            setType(defaultDirection === 'receivable' ? 'Receivable' : 'Loan');
            setAmount('');
            setStatus('Active');
        }
    }, [liabilityToEdit, isOpen, defaultDirection]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = Math.abs(parseFloat(amount) || 0);
        const newLiability: Liability = {
            id: liabilityToEdit ? liabilityToEdit.id : `liab${Date.now()}`,
            name,
            type: direction === 'receivable' ? 'Receivable' : type,
            amount: direction === 'receivable' ? value : -value,
            status,
            goalId: liabilityToEdit?.goalId,
        };
        onSave(newLiability);
        onClose();
    };

    const isReceivable = direction === 'receivable';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={liabilityToEdit ? 'Edit Entry' : (isReceivable ? 'Add Money Owed to You' : 'Add Liability')}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {!liabilityToEdit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="direction" checked={direction === 'debt'} onChange={() => { setDirection('debt'); setType('Loan'); }} className="rounded border-gray-300 text-primary focus:ring-primary" />
                                <span>I owe (debt)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="direction" checked={direction === 'receivable'} onChange={() => { setDirection('receivable'); setType('Receivable'); }} className="rounded border-gray-300 text-primary focus:ring-primary" />
                                <span>Money owed to me</span>
                            </label>
                        </div>
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                        {isReceivable ? 'Description (who owes you)' : 'Liability Name'}
                        <InfoHint text={isReceivable ? "e.g. Friend's name, client name, or 'Personal loan to Ahmad'" : "A clear name (e.g. Car Loan, Mortgage) for tracking and net worth."} />
                    </label>
                    <input type="text" placeholder={isReceivable ? "e.g. Ahmad - Personal loan" : "Liability Name"} value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                {!isReceivable && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="Category of debt; used for reporting and goal linking." /></label>
                        <select value={type} onChange={e => setType(e.target.value as Liability['type'])} required className="select-base">
                            <option value="Credit Card">Credit Card</option>
                            <option value="Loan">Loan (e.g., Car, Institutional)</option>
                            <option value="Personal Loan">Personal Loan (from individual)</option>
                            <option value="Mortgage">Mortgage</option>
                        </select>
                    </div>
                )}
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
    const [modalDefaultDirection, setModalDefaultDirection] = useState<LiabilityDirection>('debt');
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

    const handleOpenModal = (liability: Liability | null = null, direction: LiabilityDirection = 'debt') => {
        setLiabilityToEdit(liability);
        setModalDefaultDirection(liability ? (liability.amount > 0 ? 'receivable' : 'debt') : direction);
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
        <PageLayout
            title="Liabilities & Receivables"
            description="Track what you owe (loans, mortgages, credit cards) and what others owe you. Mark as Paid to keep a reference; totals show only unpaid."
            action={
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <label htmlFor="status-filter" className="text-sm font-medium text-gray-700">Show:</label>
                        <select
                            id="status-filter"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                            className="rounded-lg border border-gray-300 text-sm py-1.5 px-3 bg-white text-gray-700 focus:ring-2 focus:ring-primary focus:border-primary"
                        >
                            <option value="active">Active (unpaid)</option>
                            <option value="paid">Paid / Completed</option>
                            <option value="all">All</option>
                        </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleOpenModal(null, 'debt')} className="btn-primary inline-flex items-center gap-2">
                            <CreditCardIcon className="h-4 w-4" /> Add Liability
                        </button>
                        <button type="button" onClick={() => handleOpenModal(null, 'receivable')} className="btn-secondary border border-primary text-primary hover:bg-primary hover:text-white inline-flex items-center gap-2">
                            <BanknotesIcon className="h-4 w-4" /> Add Money Owed to Me
                        </button>
                    </div>
                </div>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card title="Total Debt" value={formatCurrencyString(totalDebt)} indicatorColor="red" valueColor="text-red-700" icon={<CreditCardIcon className="h-5 w-5 text-red-600" />} tooltip="Sum of unpaid money you owe." />
                <Card title="Money Owed to You" value={formatCurrencyString(totalReceivable)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Sum of unpaid amounts others owe you." />
                <Card title="Net (Receivables − Debt)" value={formatCurrencyString(netPosition)} indicatorColor={netPosition >= 0 ? 'green' : 'red'} valueColor={netPosition >= 0 ? 'text-emerald-700' : 'text-red-700'} tooltip="Positive = you are owed more than you owe; negative = you owe more than you are owed." />
                <Card title="Debt-to-Asset Ratio" value={`${debtToAssetRatio.toFixed(2)}%`} tooltip="Debt as a percentage of your assets (excludes receivables)." indicatorColor={debtToAssetRatio > 50 ? 'red' : debtToAssetRatio > 25 ? 'yellow' : 'green'} valueColor={debtToAssetRatio > 50 ? 'text-red-700' : debtToAssetRatio > 25 ? 'text-amber-700' : 'text-green-700'} />
            </div>

            <SectionCard title="What I Owe" className="mt-6">
                <p className="text-sm text-gray-500 mb-4">Loans, mortgages, credit card balances, and other debts. Credit card rows are synced from your linked accounts.</p>
                {debts.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No debts recorded. Add a liability or link a credit account with a negative balance.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {debts.map(liab => (
                            <DebtCard
                                key={liab.id}
                                liability={liab}
                                onEdit={l => handleOpenModal(l, 'debt')}
                                onMarkPaid={handleMarkPaid}
                                canMarkPaid={liabilityIds.has(liab.id)}
                                canEdit={liabilityIds.has(liab.id)}
                                onGoToAccounts={setActivePage ? () => setActivePage('Accounts') : undefined}
                            />
                        ))}
                    </div>
                )}
            </SectionCard>

            <SectionCard title="Money Owed to Me" className="mt-6">
                <p className="text-sm text-gray-500 mb-4">Amounts others owe you—personal loans you gave, outstanding invoices, or money friends/family will repay. Mark as Paid to keep a reference.</p>
                {receivables.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No receivables for this filter. Click &quot;Add Money Owed to Me&quot; or switch filter to Paid/All.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {receivables.map(liab => (
                            <ReceivableCard key={liab.id} liability={liab} onEdit={l => handleOpenModal(l, 'receivable')} onMarkPaid={handleMarkPaid} canMarkPaid={liabilityIds.has(liab.id)} />
                        ))}
                    </div>
                )}
            </SectionCard>

            <LiabilityModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveLiability} liabilityToEdit={liabilityToEdit} defaultDirection={modalDefaultDirection} />
        </PageLayout>
    );
};

export default Liabilities;
