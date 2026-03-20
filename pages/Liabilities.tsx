
import React, { useState, useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { Account, Liability, Page } from '../types';
import { isPersonalWealth } from '../utils/wealthScope';
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
import OwnerBadge from '../components/OwnerBadge';
import { liquidityRatio, debtServiceRatio } from '../services/liabilityMetrics';
import { countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { debtPayoffPlan, debtStressScore } from '../services/debtEngines';

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
    const [owner, setOwner] = useState('');

    React.useEffect(() => {
        if (liabilityToEdit) {
            setName(liabilityToEdit.name);
            setType(liabilityToEdit.type);
            setAmount(String(Math.abs(liabilityToEdit.amount)));
            setStatus(liabilityToEdit.status ?? 'Active');
            setOwner(liabilityToEdit.owner ?? '');
        } else {
            setName('');
            setType('Personal Loan');
            setAmount('');
            setStatus('Active');
            setOwner('');
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
            owner: owner.trim() || undefined,
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
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Owner (optional) <InfoHint text="Leave blank for your own (counts in My net worth). Set e.g. Father for managed wealth (excluded from your net worth)." /></label>
                    <input type="text" placeholder="e.g. Father, Spouse or leave blank for yours" value={owner} onChange={e => setOwner(e.target.value)} className="input-base"/>
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
        <div className={`section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300 ${isPaid ? 'opacity-90 border-l-4 border-slate-300 bg-slate-50/50' : ''}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    {getIcon(liability.type)}
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
                            {liability.type}
                            {isPaid && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">Paid (reference)</span>}
                            <OwnerBadge owner={liability.owner} />
                        </p>
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
                <p className="text-sm text-gray-500">{isPaid ? 'Balance when paid (reference)' : 'Amount owed'}</p>
                <p className={`text-2xl font-semibold ${isPaid ? 'text-slate-600' : 'text-danger'}`}>{formatCurrencyString(Math.abs(liability.amount))}</p>
            </div>
        </div>
    );
};

const ReceivableCard: React.FC<{ liability: Liability; onEdit: (l: Liability) => void; onMarkPaid: (l: Liability) => void; canMarkPaid: boolean }> = ({ liability, onEdit, onMarkPaid, canMarkPaid }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const isPaid = (liability.status ?? 'Active') === 'Paid';
    return (
        <div className={`section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300 border-l-4 ${isPaid ? 'border-slate-300 bg-slate-50/50' : 'border-emerald-500'}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center space-x-3">
                    <BanknotesIcon className={`h-8 w-8 ${isPaid ? 'text-slate-400' : 'text-emerald-500'}`} />
                    <div>
                        <h3 className="font-bold text-dark text-lg">{liability.name}</h3>
                        <p className="text-sm text-gray-500 flex items-center gap-2">
                            Owed to you
                            {isPaid && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">Paid (reference)</span>}
                        </p>
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
                <p className="text-sm text-gray-500">{isPaid ? 'Amount when paid (reference)' : 'Amount owed to you'}</p>
                <p className={`text-2xl font-semibold ${isPaid ? 'text-slate-600' : 'text-emerald-700'}`}>{formatCurrencyString(liability.amount)}</p>
            </div>
        </div>
    );
};

interface LiabilitiesProps { setActivePage?: (page: Page) => void; }
const Liabilities: React.FC<LiabilitiesProps> = ({ setActivePage }) => {
    const { data, loading, addLiability, updateLiability } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [liabilityToEdit, setLiabilityToEdit] = useState<Liability | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

    const allLiabilities: Liability[] = useMemo(() => {
        const accounts = data?.accounts ?? [];
        const liabilities = data?.liabilities ?? [];
        const creditCardDebts = accounts
            .filter(a => a.type === 'Credit' && (a.balance ?? 0) < 0)
            .map((a: Account) => ({
                id: a.id,
                name: a.name,
                type: 'Credit Card' as const,
                amount: a.balance ?? 0,
                status: 'Active' as const,
                owner: a.owner?.trim() ? a.owner : undefined,
            }));
        return [...liabilities, ...creditCardDebts];
    }, [data?.liabilities, data?.accounts]);

    const allDebts = useMemo(() => allLiabilities.filter(l => (l.amount ?? 0) < 0), [allLiabilities]);
    const allReceivables = useMemo(() => allLiabilities.filter(l => (l.amount ?? 0) > 0), [allLiabilities]);
    const debts = useMemo(() => allDebts.filter(l => matchesStatusFilter(l, statusFilter)), [allDebts, statusFilter]);
    const receivables = useMemo(() => allReceivables.filter(l => matchesStatusFilter(l, statusFilter)), [allReceivables, statusFilter]);
    const liabilityIds = useMemo(() => new Set((data?.liabilities ?? []).map(l => l.id)), [data?.liabilities]);

    const { totalDebt, totalReceivable, debtToAssetRatio, netPosition } = useMemo(() => {
        const personalLiabilities = (data as any)?.personalLiabilities ?? data?.liabilities ?? [];
        const allAccounts = data?.accounts ?? [];
        /** Credit-card debt rows for "my" totals: only accounts with no owner (same rule as isPersonalWealth). */
        const personalCreditCards = allAccounts
            .filter((a: Account) => a.type === 'Credit' && (a.balance ?? 0) < 0 && isPersonalWealth(a))
            .map((a: Account) => ({
                id: a.id,
                name: a.name,
                type: 'Credit Card' as const,
                amount: a.balance ?? 0,
                status: 'Active' as const,
                owner: a.owner?.trim() ? a.owner : undefined,
            }));
        const personalAll = [...personalLiabilities, ...personalCreditCards];
        const personalDebts = personalAll.filter((l: { amount?: number }) => (l.amount ?? 0) < 0);
        const personalReceivables = personalAll.filter((l: { amount?: number }) => (l.amount ?? 0) > 0);
        const activeDebts = personalDebts.filter((l: { status?: string }) => (l.status ?? 'Active') === 'Active');
        const activeReceivables = personalReceivables.filter((l: { status?: string }) => (l.status ?? 'Active') === 'Active');
        const totalDebt = activeDebts.reduce((sum: number, liab: { amount?: number }) => sum + Math.abs(liab.amount ?? 0), 0);
        const totalReceivable = activeReceivables.reduce((sum: number, liab: { amount?: number }) => sum + (liab.amount ?? 0), 0);
        const assets = (data as any)?.personalAssets ?? data?.assets ?? [];
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const totalAssets = assets.reduce((sum: number, asset: { value?: number }) => sum + (asset.value ?? 0), 0) + accounts.filter((a: { balance?: number }) => (a.balance ?? 0) > 0).reduce((sum: number, acc: { balance?: number }) => sum + (acc.balance ?? 0), 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
        const netPosition = totalReceivable - totalDebt;
        return { totalDebt, totalReceivable, debtToAssetRatio, netPosition };
    }, [data]);

    const { liquidityRatioVal, debtServicePct } = useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const liquid = accounts
            .filter((a: Account) => a.type === 'Checking' || a.type === 'Savings')
            .reduce((s: number, a: Account) => s + Math.max(0, a.balance ?? 0), 0);
        const liq = liquidityRatio(liquid, Math.max(1, totalDebt));
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        const incomes = txs.filter(
            (t: { date: string; type?: string; category?: string; amount?: number }) =>
                countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= start
        );
        const byM = new Map<string, number>();
        incomes.forEach((t: { date: string; amount?: number }) => {
            const d = new Date(t.date);
            const k = `${d.getFullYear()}-${d.getMonth()}`;
            byM.set(k, (byM.get(k) ?? 0) + (Number(t.amount) || 0));
        });
        const avgMonthlyIncome =
            byM.size > 0 ? Array.from(byM.values()).reduce((a, b) => a + b, 0) / byM.size : 0;
        const annualDebtGuess = totalDebt * 0.12;
        const dsr =
            avgMonthlyIncome > 0 ? debtServiceRatio(annualDebtGuess, avgMonthlyIncome) * 100 : null;
        return { liquidityRatioVal: liq, debtServicePct: dsr };
    }, [data, totalDebt]);

    const debtPayoffOrder = useMemo(() => {
        const active = allDebts.filter((l) => (l.status ?? 'Active') === 'Active');
        if (active.length === 0) return [];
        const items = active.map((l) => ({
            id: l.id,
            balance: Math.abs(l.amount ?? 0),
            annualRatePct: 12,
            monthlyPayment: Math.abs(l.amount ?? 0) * 0.02,
        }));
        return debtPayoffPlan(items, 'avalanche');
    }, [allDebts]);

    const debtStress = useMemo(() => {
        const avgMonthlyIncome =
            (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        const txs = (avgMonthlyIncome as { date: string; type?: string; category?: string; amount?: number }[]).filter(
            (t) => countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= start
        );
        const byM = new Map<string, number>();
        txs.forEach((t: { date: string; amount?: number }) => {
            const d = new Date(t.date);
            const k = `${d.getFullYear()}-${d.getMonth()}`;
            byM.set(k, (byM.get(k) ?? 0) + (Number(t.amount) || 0));
        });
        const grossMonthly = byM.size > 0 ? Array.from(byM.values()).reduce((a, b) => a + b, 0) / byM.size : 0;
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const liquid = accounts
            .filter((a: Account) => a.type === 'Checking' || a.type === 'Savings')
            .reduce((s: number, a: Account) => s + Math.max(0, a.balance ?? 0), 0);
        const monthlyPaymentsEst = totalDebt * 0.02;
        return debtStressScore(monthlyPaymentsEst, grossMonthly, liquid);
    }, [data, totalDebt]);

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

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading liabilities" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Liabilities"
            description="Track liabilities, including debts and money owed back to you. Mark as Paid to keep a reference; totals show only unpaid."
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
                        <button type="button" onClick={() => handleOpenModal(null)} className="btn-primary inline-flex items-center gap-2">
                            <CreditCardIcon className="h-4 w-4" /> Add Liabilities
                        </button>
                    </div>
                </div>
            }
        >
            <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <Card title="Total Debt" value={formatCurrencyString(totalDebt)} indicatorColor="red" valueColor="text-red-700" icon={<CreditCardIcon className="h-5 w-5 text-red-600" />} tooltip="Sum of unpaid money you owe." />
                <Card title="Money Owed to You" value={formatCurrencyString(totalReceivable)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Sum of unpaid amounts others owe you." />
                <Card title="Net (Receivables − Debt)" value={formatCurrencyString(netPosition)} indicatorColor={netPosition >= 0 ? 'green' : 'red'} valueColor={netPosition >= 0 ? 'text-emerald-700' : 'text-red-700'} tooltip="Positive = you are owed more than you owe; negative = you owe more than you are owed." />
                <Card title="Debt-to-Asset Ratio" value={`${debtToAssetRatio.toFixed(2)}%`} tooltip="Debt as a percentage of your assets (excludes receivables)." indicatorColor={debtToAssetRatio > 50 ? 'red' : debtToAssetRatio > 25 ? 'yellow' : 'green'} valueColor={debtToAssetRatio > 50 ? 'text-red-700' : debtToAssetRatio > 25 ? 'text-amber-700' : 'text-green-700'} />
                <Card title="Liquidity ratio" value={liquidityRatioVal.toFixed(2)} tooltip="Checking+Savings vs total debt (higher = more cash to cover debt)." indicatorColor={liquidityRatioVal >= 0.5 ? 'green' : liquidityRatioVal >= 0.2 ? 'yellow' : 'red'} valueColor={liquidityRatioVal >= 0.5 ? 'text-emerald-700' : liquidityRatioVal >= 0.2 ? 'text-amber-700' : 'text-red-700'} />
                <Card title="Debt service (est.)" value={debtServicePct != null ? `${debtServicePct.toFixed(1)}%` : '—'} tooltip="Rough: ~12% of debt balance as annual payments vs your 6-mo avg income." indicatorColor={debtServicePct != null && debtServicePct > 40 ? 'red' : debtServicePct != null && debtServicePct > 25 ? 'yellow' : 'green'} valueColor={debtServicePct != null && debtServicePct > 40 ? 'text-red-700' : debtServicePct != null && debtServicePct > 25 ? 'text-amber-700' : 'text-slate-700'} />
            </div>

            {allDebts.filter((l) => (l.status ?? 'Active') === 'Active').length > 0 && (
                <SectionCard title="Debt intelligence" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <h4 className="font-semibold text-slate-800 mb-1">Payoff order (avalanche)</h4>
                            <p className="text-xs text-slate-500 mb-2">Prioritize highest effective rate first.</p>
                            <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1">
                                {debtPayoffOrder.map((id) => {
                                    const liab = allDebts.find((l) => l.id === id);
                                    return liab ? <li key={id}>{liab.name}</li> : null;
                                })}
                            </ol>
                        </div>
                        <div>
                            <h4 className="font-semibold text-slate-800 mb-1">Debt stress</h4>
                            <p className="text-xs text-slate-500 mb-2">Payment coverage and pressure.</p>
                            <p className="text-lg font-bold text-slate-900">{debtStress.score} / 100</p>
                            <p className="text-sm text-slate-600">{debtStress.label} · Payment-to-income: {(debtStress.paymentToIncomeRatio * 100).toFixed(1)}%</p>
                        </div>
                    </div>
                </SectionCard>
            )}

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

            <SectionCard title="What I'm Owed" className="mt-6">
                <p className="text-sm text-gray-500 mb-4">Money others owe you—personal loans you gave, outstanding invoices, or money friends/family will repay. Add and track receivables here.</p>
                {receivables.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No receivables in this group. Switch filter to Paid/All to review historical items, or add an entry.</p>
                ) : (
                    <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {receivables.map(liab => (
                            <ReceivableCard key={liab.id} liability={liab} onEdit={l => handleOpenModal(l)} onMarkPaid={handleMarkPaid} canMarkPaid={liabilityIds.has(liab.id)} />
                        ))}
                    </div>
                )}
            </SectionCard>

            <LiabilityModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveLiability} liabilityToEdit={liabilityToEdit} />
        </PageLayout>
    );
};

export default Liabilities;
