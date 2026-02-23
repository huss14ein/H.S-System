import React, { useMemo, useState, useContext } from 'react';
import ProgressBar from '../components/ProgressBar';
import { DataContext } from '../context/DataContext';
import Modal from '../components/Modal';
import { Budget } from '../types';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { DocumentDuplicateIcon } from '../components/icons/DocumentDuplicateIcon';
import Combobox from '../components/Combobox';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from '../context/AuthContext';
import InfoHint from '../components/InfoHint';

interface BudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => void;
    budgetToEdit: Budget | null;
    currentMonth: number;
    currentYear: number;
}

const BudgetModal: React.FC<BudgetModalProps> = ({ isOpen, onClose, onSave, budgetToEdit, currentMonth, currentYear }) => {
    const { data } = useContext(DataContext)!;
    const [category, setCategory] = useState('');
    const [limit, setLimit] = useState('');
    const [limitPeriod, setLimitPeriod] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');

    const existingCategories = useMemo(() => new Set(data.budgets.filter(b => b.year === currentYear && b.month === currentMonth).map(b => b.category)), [data.budgets, currentYear, currentMonth]);
    
    const availableCategories = useMemo(() => {
        const allPossible = ['Food', 'Transportation', 'Housing', 'Utilities', 'Shopping', 'Entertainment', 'Health', 'Education', 'Savings & Investments', 'Personal Care', 'Miscellaneous'];
        if (budgetToEdit) return allPossible;
        return allPossible.filter(c => !existingCategories.has(c));
    }, [existingCategories, budgetToEdit]);


    React.useEffect(() => {
        if (budgetToEdit) {
            setCategory(budgetToEdit.category);
            setLimit(String(budgetToEdit.limit));
            setLimitPeriod('Monthly');
        } else {
            setCategory('');
            setLimit('');
            setLimitPeriod('Monthly');
        }
    }, [budgetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const rawLimit = parseFloat(limit) || 0;
        const monthlyLimit = limitPeriod === 'Monthly'
            ? rawLimit
            : limitPeriod === 'Weekly'
                ? rawLimit * 4.345
                : limitPeriod === 'Daily'
                    ? rawLimit * 30
                    : rawLimit / 12;

        onSave({
            category,
            limit: monthlyLimit,
            month: budgetToEdit ? budgetToEdit.month : currentMonth,
            year: budgetToEdit ? budgetToEdit.year : currentYear,
        }, !!budgetToEdit);
        onClose();
    };
    


    return (
        <Modal isOpen={isOpen} onClose={onClose} title={budgetToEdit ? 'Edit Budget' : 'Add Budget'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                    {budgetToEdit ? (
                        <input type="text" id="category" value={category} disabled className="mt-1 w-full p-2 border border-gray-300 rounded-md bg-gray-100" />
                    ) : (
                        <div className="mt-1">
                            <Combobox 
                                items={availableCategories}
                                selectedItem={category}
                                onSelectItem={setCategory}
                                placeholder="Select or create a category..."
                            />
                        </div>
                    )}
                </div>
                 <div>
                    <label htmlFor="limit" className="block text-sm font-medium text-gray-700 flex items-center">Budget Amount <InfoHint text="Choose a period; we normalize and store it as a monthly limit to keep reports consistent." /></label>
                    <input type="number" id="limit" value={limit} onChange={e => setLimit(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                </div>
                <div>
                    <label htmlFor="limitPeriod" className="block text-sm font-medium text-gray-700">Amount Period</label>
                    <select id="limitPeriod" value={limitPeriod} onChange={(e) => setLimitPeriod(e.target.value as any)} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        <option value="Monthly">Monthly</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Daily">Daily</option>
                        <option value="Yearly">Yearly</option>
                    </select>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Budget</button>
            </form>
        </Modal>
    );
}

const Budgets: React.FC = () => {
    const { data, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrencyString } = useFormatCurrency();
    const [isAdmin, setIsAdmin] = useState(false);
    const [permittedCategories, setPermittedCategories] = useState<string[]>([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [requestAmount, setRequestAmount] = useState('');
    const [requestAmountPeriod, setRequestAmountPeriod] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [requestNote, setRequestNote] = useState('');
    const [requestType, setRequestType] = useState<'NewCategory' | 'IncreaseLimit'>('NewCategory');
    const [requestCategoryId, setRequestCategoryId] = useState('');
    const [governanceCategories, setGovernanceCategories] = useState<{ id: string; name: string }[]>([]);
    const [budgetRequests, setBudgetRequests] = useState<any[]>([]);
    const [requestSearch, setRequestSearch] = useState('');
    const [requestSort, setRequestSort] = useState<'Newest' | 'Oldest' | 'AmountHigh' | 'AmountLow'>('Newest');
    const [requestStatusFilter, setRequestStatusFilter] = useState<'All' | 'Pending' | 'Finalized' | 'Rejected'>('All');
    const [historyItemsToShow, setHistoryItemsToShow] = useState(6);
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [budgetView, setBudgetView] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);
    const [cardOrder, setCardOrder] = useState<string[]>([]);
    const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

    type BudgetTier = 'Core' | 'Supporting' | 'Optional';

    type BudgetRow = Budget & {
        spent: number;
        percentage: number;
        colorClass: string;
        displayLimit: number;
        monthlyLimit: number;
        previousPeriodSpent: number;
        trendDelta: number;
        trendDirection: 'up' | 'down' | 'flat';
        budgetTier: BudgetTier;
        utilizationLabel: 'Healthy' | 'Watch' | 'Critical';
    };

    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const categoryNameById = useMemo(() => new Map(governanceCategories.map((c) => [c.id, c.name])), [governanceCategories]);
    const resolveRequestCategory = (request: any) => request.category_name || categoryNameById.get(request.category_id) || request.category_id || 'N/A';
    const requestStatusClasses: Record<string, string> = {
        Pending: 'bg-amber-100 text-amber-800',
        Finalized: 'bg-green-100 text-green-800',
        Rejected: 'bg-rose-100 text-rose-800',
    };

    React.useEffect(() => {
        const loadGovernance = async () => {
            if (!supabase || !auth?.user) return;
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            const admin = userRecord?.role === 'Admin';
            setIsAdmin(admin);

            const { data: categories } = await supabase
                .from('categories')
                .select('id, name')
                .order('name', { ascending: true });
            setGovernanceCategories(categories || []);

            if (!admin) {
                const { data: permissions } = await supabase
                    .from('permissions')
                    .select('categories(name)')
                    .eq('user_id', auth.user.id);
                setPermittedCategories((permissions || []).map((p: any) => p.categories?.name).filter(Boolean));

                const { data: ownRequests } = await supabase
                    .from('budget_requests')
                    .select('*')
                    .eq('user_id', auth.user.id)
                    .order('created_at', { ascending: false });
                setBudgetRequests(ownRequests || []);
            } else {
                const { data: requests } = await supabase
                    .from('budget_requests')
                    .select('*')
                    .order('created_at', { ascending: false });
                setBudgetRequests(requests || []);
            }
        };

        loadGovernance();
    }, [auth?.user?.id]);

    const budgetData = useMemo<BudgetRow[]>(() => {
        const spending = new Map<string, number>();
        const previousSpending = new Map<string, number>();

        const now = new Date();
        const rangeStart = new Date(now);
        const rangeEnd = new Date(now);
        const previousRangeStart = new Date(now);
        const previousRangeEnd = new Date(now);

        if (budgetView === 'Monthly') {
            rangeStart.setFullYear(currentYear, currentMonth - 1, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, currentMonth, 0);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setFullYear(currentYear, currentMonth - 2, 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setFullYear(currentYear, currentMonth - 1, 0);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Weekly') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            rangeStart.setDate(now.getDate() - diffToMonday);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setDate(rangeStart.getDate() + 6);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setDate(rangeStart.getDate() - 7);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setDate(rangeStart.getDate() - 1);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Daily') {
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setDate(now.getDate() - 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setDate(now.getDate() - 1);
            previousRangeEnd.setHours(23, 59, 59, 999);
        } else {
            rangeStart.setFullYear(currentYear, 0, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, 11, 31);
            rangeEnd.setHours(23, 59, 59, 999);

            previousRangeStart.setFullYear(currentYear - 1, 0, 1);
            previousRangeStart.setHours(0, 0, 0, 0);
            previousRangeEnd.setFullYear(currentYear - 1, 11, 31);
            previousRangeEnd.setHours(23, 59, 59, 999);
        }

        const limitDivisor = budgetView === 'Monthly' ? 1 : budgetView === 'Weekly' ? 4.345 : budgetView === 'Daily' ? 30 : 1;

        data.transactions
            .filter((t) => t.type === 'expense' && (t.status ?? 'Approved') === 'Approved' && !!t.budgetCategory)
            .forEach((t) => {
                const txDate = new Date(t.date);
                const amount = Math.abs(t.amount);
                if (txDate >= rangeStart && txDate <= rangeEnd) {
                    spending.set(t.budgetCategory!, (spending.get(t.budgetCategory!) || 0) + amount);
                }
                if (txDate >= previousRangeStart && txDate <= previousRangeEnd) {
                    previousSpending.set(t.budgetCategory!, (previousSpending.get(t.budgetCategory!) || 0) + amount);
                }
            });

        const scopedBudgets = data.budgets
            .filter((b) => b.year === currentYear)
            .filter((b) => budgetView === 'Yearly' || b.month === currentMonth)
            .filter((b) => isAdmin || permittedCategories.includes(b.category));

        const baseRows = budgetView === 'Yearly'
            ? Array.from(scopedBudgets.reduce((acc, b) => {
                acc.set(b.category, (acc.get(b.category) || 0) + b.limit);
                return acc;
            }, new Map<string, number>()).entries()).map(([category, yearlyLimit]) => ({
                id: `${category}-${currentYear}`,
                category,
                month: currentMonth,
                year: currentYear,
                limit: yearlyLimit,
                monthlyLimit: yearlyLimit,
                displayLimit: yearlyLimit,
            }))
            : scopedBudgets.map((budget) => ({
                ...budget,
                monthlyLimit: budget.limit,
                displayLimit: budget.limit / limitDivisor,
            }));

        const totalDisplayLimit = baseRows.reduce((sum, row) => sum + row.displayLimit, 0);

        return baseRows
            .map((row) => {
                const spent = spending.get(row.category) || 0;
                const previousPeriodSpent = previousSpending.get(row.category) || 0;
                const percentage = row.displayLimit > 0 ? (spent / row.displayLimit) * 100 : 0;
                const trendDelta = spent - previousPeriodSpent;
                const trendDirection: BudgetRow['trendDirection'] = trendDelta > 0 ? 'up' : trendDelta < 0 ? 'down' : 'flat';

                let colorClass = 'bg-primary';
                if (percentage > 100) colorClass = 'bg-danger';
                else if (percentage > 90) colorClass = 'bg-warning';

                const share = totalDisplayLimit > 0 ? row.displayLimit / totalDisplayLimit : 0;
                const budgetTier: BudgetTier = share >= 0.2 ? 'Core' : share >= 0.08 ? 'Supporting' : 'Optional';
                const utilizationLabel: BudgetRow['utilizationLabel'] = percentage > 100 ? 'Critical' : percentage > 80 ? 'Watch' : 'Healthy';

                return {
                    ...row,
                    spent,
                    previousPeriodSpent,
                    trendDelta,
                    trendDirection,
                    percentage,
                    colorClass,
                    budgetTier,
                    utilizationLabel,
                } as BudgetRow;
            })
            .sort((a, b) => b.spent - a.spent);
    }, [data.transactions, data.budgets, currentYear, currentMonth, isAdmin, permittedCategories, budgetView]);

    React.useEffect(() => {
        setCardOrder((prev) => {
            const ids = budgetData.map((b) => b.id);
            const retained = prev.filter((id) => ids.includes(id));
            const appended = ids.filter((id) => !retained.includes(id));
            return [...retained, ...appended];
        });
    }, [budgetData]);

    const orderedBudgetData = useMemo(() => {
        const map = new Map(budgetData.map((b) => [b.id, b]));
        return cardOrder.map((id) => map.get(id)).filter((b): b is BudgetRow => !!b);
    }, [budgetData, cardOrder]);

    const moveBudgetCard = (id: string, direction: 'up' | 'down') => {
        setCardOrder((prev) => {
            const index = prev.indexOf(id);
            if (index < 0) return prev;
            const target = direction === 'up' ? index - 1 : index + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const toggleBudgetCardSize = (id: string) => setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));

    const budgetInsights = useMemo(() => {
        const totalLimit = budgetData.reduce((sum, b) => sum + b.displayLimit, 0);
        const totalSpent = budgetData.reduce((sum, b) => sum + b.spent, 0);
        const healthyCount = budgetData.filter((b) => b.utilizationLabel === 'Healthy').length;
        const watchCount = budgetData.filter((b) => b.utilizationLabel === 'Watch').length;
        const criticalCount = budgetData.filter((b) => b.utilizationLabel === 'Critical').length;
        const topChange = [...budgetData].sort((a, b) => Math.abs(b.trendDelta) - Math.abs(a.trendDelta))[0];
        return { totalLimit, totalSpent, healthyCount, watchCount, criticalCount, topChange };
    }, [budgetData]);

    const handleOpenModal = (budget: Budget | null = null) => {
        if (!isAdmin) return;
        setBudgetToEdit(budget);
        setIsModalOpen(true);
    };

    const handleSaveBudget = (budget: Omit<Budget, 'id' | 'user_id'>, isEditing: boolean) => {
        if (isEditing && budgetToEdit) {
            updateBudget({ ...budgetToEdit, ...budget });
        } else {
            addBudget(budget);
        }
    };
    
    const changeMonth = (offset: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    }


    const normalizeToMonthly = (amount: number, period: 'Monthly' | 'Weekly' | 'Daily' | 'Yearly') => {
        if (period === 'Weekly') return amount * 4.345;
        if (period === 'Daily') return amount * 30;
        if (period === 'Yearly') return amount / 12;
        return amount;
    };

    const handleCopyBudgets = () => {
        if (!isAdmin) return;

        if (window.confirm("This will copy budgets from the previous month for any categories that don't already have one this month. Continue?")) {
            copyBudgetsFromPreviousMonth(currentYear, currentMonth);
        }
    };
    const submitBudgetRequest = async () => {
        if (!supabase || !auth?.user) return;

        const enteredAmount = Number(requestAmount || 0);
        if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) {
            alert('Please enter a valid proposed amount greater than 0.');
            return;
        }

        if (requestType === 'NewCategory' && !newCategoryName.trim()) {
            alert('Please provide a category name for a new category request.');
            return;
        }

        if (requestType === 'IncreaseLimit' && !requestCategoryId) {
            alert('Please select a category for an increase request.');
            return;
        }

        const duplicateMatch = budgetRequests.some((r) =>
            r.status === 'Pending' &&
            r.request_type === requestType &&
            (requestType === 'NewCategory'
                ? String(r.category_name || '').trim().toLowerCase() === newCategoryName.trim().toLowerCase()
                : r.category_id === requestCategoryId)
        );

        if (duplicateMatch) {
            alert('A similar pending request already exists. Please wait for admin review.');
            return;
        }

        const amount = normalizeToMonthly(enteredAmount, requestAmountPeriod);

        const periodTag = requestAmountPeriod === 'Monthly' ? '' : `[Requested period: ${requestAmountPeriod}]`;
        const mergedNote = [periodTag, requestNote.trim()].filter(Boolean).join(' ').trim() || null;

        const payloadBase = {
            user_id: auth.user.id,
            request_type: requestType,
            category_id: requestType === 'IncreaseLimit' ? requestCategoryId || null : null,
            category_name: requestType === 'NewCategory' ? newCategoryName.trim() : null,
            amount,
            status: 'Pending'
        };

        const payloadVariants = [
            { ...payloadBase, note: mergedNote },
            { ...payloadBase, request_note: mergedNote },
            payloadBase,
        ];

        let createdRequest: any = null;
        let error: any = null;
        for (const payload of payloadVariants) {
            const result = await supabase.from('budget_requests').insert(payload).select().single();
            createdRequest = result.data;
            error = result.error;
            if (!error) break;
            const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
            const isMissingColumn = error?.code === '42703' || error?.code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache');
            if (!isMissingColumn) break;
        }

        if (error) {
            alert(`Failed to submit request: ${error.message}`);
            return;
        }
        setNewCategoryName('');
        setRequestAmount('');
        setRequestCategoryId('');
        setRequestNote('');
        if (createdRequest) setBudgetRequests(prev => [createdRequest, ...prev]);
        alert('Request submitted for admin approval.');
    };

    const finalizeBudgetRequest = async (request: any, approvedAmount?: number) => {
        if (!supabase) return;
        const amount = Number(approvedAmount ?? request.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Request amount is invalid; please reject or correct the request.');
            return;
        }

        const categoryLabel = resolveRequestCategory(request);
        if (!window.confirm(`Finalize ${request.request_type} for ${categoryLabel} with ${formatCurrencyString(amount, { digits: 0 })}?`)) {
            return;
        }

        if (request.request_type === 'NewCategory') {
            const { error: insertError } = await supabase
                .from('categories')
                .insert({ name: request.category_name, monthly_limit: amount, total_spent: 0 });
            if (insertError) {
                alert(`Failed to create category: ${insertError.message}`);
                return;
            }
        }
        if (request.request_type === 'IncreaseLimit') {
            if (!request.category_id) {
                alert('Increase-limit request is missing a target category.');
                return;
            }
            const { error: updateError } = await supabase
                .from('categories')
                .update({ monthly_limit: amount })
                .eq('id', request.category_id);
            if (updateError) {
                alert(`Failed to update category limit: ${updateError.message}`);
                return;
            }
        }

        const { error: requestUpdateError } = await supabase
            .from('budget_requests')
            .update({ status: 'Finalized', amount })
            .eq('id', request.id);
        if (requestUpdateError) {
            alert(`Failed to finalize request: ${requestUpdateError.message}`);
            return;
        }

        setBudgetRequests(prev => prev.map((r) => r.id === request.id ? { ...r, status: 'Finalized', amount } : r));
    };

    const rejectBudgetRequest = async (requestId: string) => {
        if (!supabase) return;
        if (!window.confirm('Reject this budget request?')) return;
        const { error } = await supabase
            .from('budget_requests')
            .update({ status: 'Rejected' })
            .eq('id', requestId);
        if (error) {
            alert(`Failed to reject request: ${error.message}`);
            return;
        }
        setBudgetRequests(prev => prev.map((r) => r.id === requestId ? { ...r, status: 'Rejected' } : r));
    };


    const sortedFilteredRequests = useMemo(() => {
        const normalizedQuery = requestSearch.trim().toLowerCase();
        const filtered = budgetRequests.filter((r) => {
            const matchesStatus = requestStatusFilter === 'All' || r.status === requestStatusFilter;
            if (!matchesStatus) return false;
            if (!normalizedQuery) return true;
            const combinedText = `${r.request_type} ${resolveRequestCategory(r)} ${r.note || ''} ${r.request_note || ''}`.toLowerCase();
            return combinedText.includes(normalizedQuery);
        });

        const sorted = [...filtered].sort((a, b) => {
            if (requestSort === 'Oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            if (requestSort === 'AmountHigh') return Number(b.amount || 0) - Number(a.amount || 0);
            if (requestSort === 'AmountLow') return Number(a.amount || 0) - Number(b.amount || 0);
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });

        return sorted;
    }, [budgetRequests, requestSearch, requestSort, requestStatusFilter, governanceCategories]);

    const pendingRequests = useMemo(() => sortedFilteredRequests.filter((r) => r.status === 'Pending'), [sortedFilteredRequests]);
    const respondedRequests = useMemo(() => sortedFilteredRequests.filter((r) => r.status !== 'Pending'), [sortedFilteredRequests]);
    const allRespondedRequests = useMemo(() => budgetRequests.filter((r) => r.status !== 'Pending').sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()), [budgetRequests]);
    const visibleHistoryRequests = useMemo(() => allRespondedRequests.slice(0, historyItemsToShow), [allRespondedRequests, historyItemsToShow]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <h1 className="text-3xl font-bold text-dark">Budgets ({budgetView})</h1>
                                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">View:</span>
                    <select value={budgetView} onChange={(e) => setBudgetView(e.target.value as 'Monthly' | 'Weekly' | 'Daily' | 'Yearly')} className="px-2 py-1 border rounded text-sm">
                        <option value="Monthly">Monthly</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Daily">Daily</option>
                        <option value="Yearly">Yearly</option>
                    </select>
                </div>
<div className="flex items-center gap-2">
                    <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon className="h-5 w-5"/></button>
                    <span className="font-semibold text-lg w-36 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                    <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon className="h-5 w-5"/></button>
                </div>
                 <div className="flex items-center gap-2">
                    <button disabled={!isAdmin} onClick={handleCopyBudgets} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"><DocumentDuplicateIcon className="h-5 w-5"/>Copy Last Month</button>
                    <button disabled={!isAdmin} onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm disabled:opacity-50">Add Budget</button>
                 </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border border-slate-200">
                <div className="flex flex-wrap gap-3 items-center">
                    <input
                        value={requestSearch}
                        onChange={(e) => setRequestSearch(e.target.value)}
                        placeholder="Search requests by type, category, or note..."
                        className="flex-1 min-w-[220px] p-2 border rounded"
                    />
                    <select value={requestStatusFilter} onChange={(e) => setRequestStatusFilter(e.target.value as any)} className="p-2 border rounded">
                        <option value="All">All statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="Finalized">Finalized</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                    <select value={requestSort} onChange={(e) => setRequestSort(e.target.value as any)} className="p-2 border rounded">
                        <option value="Newest">Newest first</option>
                        <option value="Oldest">Oldest first</option>
                        <option value="AmountHigh">Highest amount</option>
                        <option value="AmountLow">Lowest amount</option>
                    </select>
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded border p-2 bg-amber-50">Pending: <span className="font-semibold">{budgetRequests.filter((r) => r.status === 'Pending').length}</span></div>
                    <div className="rounded border p-2 bg-green-50">Finalized: <span className="font-semibold">{budgetRequests.filter((r) => r.status === 'Finalized').length}</span></div>
                    <div className="rounded border p-2 bg-rose-50">Rejected: <span className="font-semibold">{budgetRequests.filter((r) => r.status === 'Rejected').length}</span></div>
                    <div className="rounded border p-2 bg-slate-50">Shown: <span className="font-semibold">{sortedFilteredRequests.length}</span></div>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 border border-slate-200">
                <h2 className="text-lg font-semibold mb-3">Budget Intelligence</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div className="rounded-lg border bg-slate-50 p-3">
                        <p className="text-gray-500">Portfolio Budget</p>
                        <p className="text-lg font-semibold">{formatCurrencyString(budgetInsights.totalLimit, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border bg-indigo-50 p-3">
                        <p className="text-gray-500">Current Spend</p>
                        <p className="text-lg font-semibold">{formatCurrencyString(budgetInsights.totalSpent, { digits: 0 })}</p>
                    </div>
                    <div className="rounded-lg border bg-amber-50 p-3">
                        <p className="text-gray-500">Needs Attention</p>
                        <p className="text-lg font-semibold">{budgetInsights.watchCount + budgetInsights.criticalCount}</p>
                    </div>
                    <div className="rounded-lg border bg-emerald-50 p-3">
                        <p className="text-gray-500">Healthy Budgets</p>
                        <p className="text-lg font-semibold">{budgetInsights.healthyCount}</p>
                    </div>
                </div>
                {budgetInsights.topChange && (
                    <p className="mt-3 text-xs text-gray-600">
                        Largest movement: <span className="font-semibold">{budgetInsights.topChange.category}</span> ({budgetInsights.topChange.trendDirection === 'up' ? '+' : ''}{formatCurrencyString(budgetInsights.topChange.trendDelta, { digits: 0 })} vs previous period).
                    </p>
                )}
            </div>

            {!isAdmin && (
                <div className="bg-gradient-to-br from-white via-primary/5 to-indigo-50 rounded-lg shadow p-5 border border-primary/20">
                    <h2 className="text-lg font-semibold mb-3 flex items-center">Request Budget Change <InfoHint text="Submit new-category or limit-increase proposals with context notes for admin approval." /></h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <select value={requestType} onChange={(e) => setRequestType(e.target.value as any)} className="p-2 border rounded">
                            <option value="NewCategory">New Category</option>
                            <option value="IncreaseLimit">Increase Limit</option>
                        </select>
                        {requestType === 'NewCategory' ? (
                            <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Category name" className="p-2 border rounded" />
                        ) : (
                            <select value={requestCategoryId} onChange={(e) => setRequestCategoryId(e.target.value)} className="p-2 border rounded">
                                <option value="">Select category</option>
                                {governanceCategories
                                    .filter((c) => permittedCategories.includes(c.name))
                                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        )}
                        <input type="number" value={requestAmount} onChange={(e) => setRequestAmount(e.target.value)} placeholder="Proposed amount" className="p-2 border rounded" />
                        <select value={requestAmountPeriod} onChange={(e) => setRequestAmountPeriod(e.target.value as 'Monthly' | 'Weekly' | 'Daily' | 'Yearly')} className="p-2 border rounded">
                            <option value="Monthly">Monthly</option>
                            <option value="Weekly">Weekly</option>
                            <option value="Daily">Daily</option>
                            <option value="Yearly">Yearly</option>
                        </select>
                        <input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="Reason / note (optional)" className="p-2 border rounded md:col-span-2" />
                        <button onClick={submitBudgetRequest} className="px-4 py-2 bg-primary text-white rounded">Submit</button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Supports Monthly, Weekly, Daily, and Yearly inputs. All requests are normalized to a monthly limit for approval consistency.</p>
                </div>
            )}

            {!isAdmin && pendingRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-blue-50 to-sky-50 rounded-lg shadow p-5 border border-blue-200">
                    <h2 className="text-lg font-semibold mb-3">My Pending Budget Requests</h2>
                    <div className="space-y-2">
                        {pendingRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
                                    <p className="text-xs text-gray-500">Proposed: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                    <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${requestStatusClasses[r.status] || 'bg-slate-100 text-slate-800'}`}>{r.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            {!isAdmin && respondedRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-slate-50 to-indigo-50 rounded-lg shadow p-5 border border-slate-200">
                    <h2 className="text-lg font-semibold mb-3">Reviewed Requests</h2>
                    <div className="space-y-2">
                        {respondedRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
                                    <p className="text-xs text-gray-500">Amount: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                    <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${requestStatusClasses[r.status] || 'bg-slate-100 text-slate-800'}`}>{r.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isAdmin && pendingRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-amber-50 to-orange-50 rounded-lg shadow p-5 border border-amber-200">
                    <h2 className="text-lg font-semibold mb-3 flex items-center">Budget Request Review <InfoHint text="Finalize directly or adjust amount before finalizing. Rejections remain in history timeline." /></h2>
                    <div className="space-y-3">
                        {pendingRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between gap-2">
                                <div>
                                    <p className="font-medium">{r.request_type} • {resolveRequestCategory(r)}</p>
                                    <p className="text-xs text-gray-500">Requested (monthly normalized): {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                    <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => finalizeBudgetRequest(r)} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Finalize</button>
                                    <button onClick={() => {
                                        const nextAmount = window.prompt('Approve with custom monthly limit amount:', String(r.amount || ''));
                                        if (nextAmount == null) return;
                                        const parsed = Number(nextAmount);
                                        if (!Number.isFinite(parsed) || parsed <= 0) {
                                            alert('Please enter a valid amount greater than 0.');
                                            return;
                                        }
                                        finalizeBudgetRequest(r, parsed);
                                    }} className="px-3 py-1 text-xs rounded bg-emerald-700 text-white">Adjust & Finalize</button>
                                    <button onClick={() => rejectBudgetRequest(r.id)} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {allRespondedRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-violet-50 to-purple-50 rounded-lg shadow p-5 border border-violet-200">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h2 className="text-lg font-semibold">Request History Timeline</h2>
                        <span className="text-xs text-violet-700 bg-violet-100 px-2 py-1 rounded">{allRespondedRequests.length} total decisions</span>
                    </div>
                    <div className="space-y-2">
                        {visibleHistoryRequests.map((r) => (
                            <div key={`history-${r.id}`} className="p-3 border rounded-lg bg-white/80">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-medium text-sm">{r.request_type} • {resolveRequestCategory(r)}</p>
                                    <span className={`text-xs px-2 py-1 rounded ${requestStatusClasses[r.status] || 'bg-slate-100 text-slate-800'}`}>{r.status}</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Amount: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                <p className="text-[11px] text-gray-400 mt-1">{r.created_at ? new Date(r.created_at).toLocaleString() : 'No timestamp'}</p>
                            </div>
                        ))}
                    </div>
                    {historyItemsToShow < allRespondedRequests.length && (
                        <button onClick={() => setHistoryItemsToShow((prev) => prev + 6)} className="mt-3 px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:bg-violet-700">Load more history</button>
                    )}
                </div>
            )}

            {budgetView === 'Yearly' && (
                <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded p-3">
                    Yearly view aggregates all monthly budgets and spending for {currentYear}.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {orderedBudgetData.map((budget, index) => (
                    <div key={budget.id} className="bg-gradient-to-br from-white via-slate-50 to-primary/5 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 flex flex-col border border-slate-100 ${expandedCards[budget.id] ? 'md:col-span-2' : ''}">
                        <div className="flex-grow">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-lg font-semibold text-dark">{budget.category}</h3>
                                <span className={`text-[11px] px-2 py-1 rounded ${budget.budgetTier === 'Core' ? 'bg-indigo-100 text-indigo-800' : budget.budgetTier === 'Supporting' ? 'bg-cyan-100 text-cyan-800' : 'bg-slate-100 text-slate-700'}`}>{budget.budgetTier}</span>
                            </div>
                            <div className="mt-4">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-medium text-secondary">{formatCurrencyString(budget.spent, { digits: 0 })}</span>
                                    <span className="text-sm text-gray-500">/ {formatCurrencyString(budget.displayLimit, { digits: 0 })}</span>
                                </div>
                                <ProgressBar value={budget.spent} max={budget.displayLimit} color={budget.colorClass} />
                                <p className={`text-right text-sm mt-1 ${budget.displayLimit - budget.spent >= 0 ? 'text-gray-600' : 'text-danger font-medium'}`}>
                                    {budget.displayLimit - budget.spent >= 0 
                                        ? `${formatCurrencyString(budget.displayLimit - budget.spent, { digits: 0 })} remaining`
                                        : `${formatCurrencyString(Math.abs(budget.displayLimit - budget.spent), { digits: 0 })} over`
                                    }
                                </p>
                                <div className="mt-2 flex items-center justify-between text-xs">
                                    <span className={`px-2 py-1 rounded ${budget.utilizationLabel === 'Critical' ? 'bg-rose-100 text-rose-800' : budget.utilizationLabel === 'Watch' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{budget.utilizationLabel}</span>
                                    <span className={budget.trendDirection === 'up' ? 'text-rose-600' : budget.trendDirection === 'down' ? 'text-emerald-600' : 'text-gray-500'}>
                                        {budget.trendDirection === 'up' ? '↑' : budget.trendDirection === 'down' ? '↓' : '→'} {formatCurrencyString(Math.abs(budget.trendDelta), { digits: 0 })} vs previous
                                    </span>
                                </div>
                            </div>
                        </div>
                         <div className="border-t mt-4 pt-2 flex justify-between items-center gap-2">
                            <div className="flex items-center gap-1">
                                <button onClick={() => moveBudgetCard(budget.id, 'up')} disabled={index === 0} className="px-2 py-1 text-xs border rounded disabled:opacity-40" title="Move card up">↑</button>
                                <button onClick={() => moveBudgetCard(budget.id, 'down')} disabled={index === orderedBudgetData.length - 1} className="px-2 py-1 text-xs border rounded disabled:opacity-40" title="Move card down">↓</button>
                                <button onClick={() => toggleBudgetCardSize(budget.id)} className="px-2 py-1 text-xs border rounded" title="Resize card">{expandedCards[budget.id] ? 'Compact' : 'Expand'}</button>
                            </div>
                            <button disabled={budgetView === 'Yearly'} onClick={() => handleOpenModal({ ...budget, limit: budget.monthlyLimit })} className="p-2 text-gray-400 hover:text-primary disabled:opacity-40"><PencilIcon className="h-4 w-4"/></button>
                            <button disabled={!isAdmin || budgetView === 'Yearly'} onClick={() => deleteBudget(budget.category, budget.month, budget.year)} className="p-2 text-gray-400 hover:text-danger disabled:opacity-40"><TrashIcon className="h-4 w-4"/></button>
                        </div>
                    </div>
                ))}
            </div>
             {budgetData.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                    <p className="text-gray-500">No budgets set for this month.</p>
                </div>
            )}
            <BudgetModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveBudget} budgetToEdit={budgetToEdit} currentMonth={currentMonth} currentYear={currentYear} />
        </div>
    );
};

export default Budgets;
