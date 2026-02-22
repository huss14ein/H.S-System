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
        } else {
            setCategory('');
            setLimit('');
        }
    }, [budgetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            category,
            limit: parseFloat(limit) || 0,
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
                    <label htmlFor="limit" className="block text-sm font-medium text-gray-700">Monthly Limit</label>
                    <input type="number" id="limit" value={limit} onChange={e => setLimit(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
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
    const [requestNote, setRequestNote] = useState('');
    const [requestType, setRequestType] = useState<'NewCategory' | 'IncreaseLimit'>('NewCategory');
    const [requestCategoryId, setRequestCategoryId] = useState('');
    const [governanceCategories, setGovernanceCategories] = useState<{ id: string; name: string }[]>([]);
    const [budgetRequests, setBudgetRequests] = useState<any[]>([]);
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [budgetView, setBudgetView] = useState<'Monthly' | 'Weekly' | 'Daily' | 'Yearly'>('Monthly');
    const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);

    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;


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

    const budgetData = useMemo(() => {
        const spending = new Map<string, number>();

        const now = new Date();
        const rangeStart = new Date(now);
        const rangeEnd = new Date(now);

        if (budgetView === 'Monthly') {
            rangeStart.setFullYear(currentYear, currentMonth - 1, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, currentMonth, 0);
            rangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Weekly') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            rangeStart.setDate(now.getDate() - diffToMonday);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setDate(rangeStart.getDate() + 6);
            rangeEnd.setHours(23, 59, 59, 999);
        } else if (budgetView === 'Daily') {
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setHours(23, 59, 59, 999);
        } else {
            rangeStart.setFullYear(currentYear, 0, 1);
            rangeStart.setHours(0, 0, 0, 0);
            rangeEnd.setFullYear(currentYear, 11, 31);
            rangeEnd.setHours(23, 59, 59, 999);
        }

        const limitDivisor = budgetView === 'Monthly' ? 1 : budgetView === 'Weekly' ? 4.345 : budgetView === 'Daily' ? 30 : 1;

        data.transactions
            .filter(t => {
                if (t.type !== 'expense' || (t.status ?? 'Approved') !== 'Approved' || !t.budgetCategory) return false;
                const txDate = new Date(t.date);
                return txDate >= rangeStart && txDate <= rangeEnd;
            })
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });

        const scopedBudgets = data.budgets
            .filter(b => b.year === currentYear)
            .filter(b => budgetView === 'Yearly' || b.month === currentMonth)
            .filter(b => isAdmin || permittedCategories.includes(b.category));

        if (budgetView === 'Yearly') {
            const yearlyLimitByCategory = new Map<string, number>();
            scopedBudgets.forEach((b) => yearlyLimitByCategory.set(b.category, (yearlyLimitByCategory.get(b.category) || 0) + b.limit));

            return Array.from(yearlyLimitByCategory.entries())
                .map(([category, yearlyLimit]) => {
                    const spent = spending.get(category) || 0;
                    const percentage = yearlyLimit > 0 ? (spent / yearlyLimit) * 100 : 0;
                    let colorClass = 'bg-primary';
                    if (percentage > 100) colorClass = 'bg-danger';
                    else if (percentage > 90) colorClass = 'bg-warning';
                    return {
                        id: `${category}-${currentYear}`,
                        category,
                        month: currentMonth,
                        year: currentYear,
                        spent,
                        limit: yearlyLimit,
                        percentage,
                        colorClass,
                    };
                })
                .sort((a, b) => b.spent - a.spent);
        }

        return scopedBudgets
            .map(budget => {
                const spent = spending.get(budget.category) || 0;
                const adjustedLimit = budget.limit / limitDivisor;
                const percentage = adjustedLimit > 0 ? (spent / adjustedLimit) * 100 : 0;
                let colorClass = 'bg-primary';
                if (percentage > 100) colorClass = 'bg-danger';
                else if (percentage > 90) colorClass = 'bg-warning';

                return { ...budget, spent, limit: adjustedLimit, percentage, colorClass };
            }).sort((a,b) => b.spent - a.spent);
    }, [data.transactions, data.budgets, currentYear, currentMonth, isAdmin, permittedCategories, budgetView]);

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

    const handleCopyBudgets = () => {
        if (!isAdmin) return;

        if (window.confirm("This will copy budgets from the previous month for any categories that don't already have one this month. Continue?")) {
            copyBudgetsFromPreviousMonth(currentYear, currentMonth);
        }
    };
    const submitBudgetRequest = async () => {
        if (!supabase || !auth?.user) return;

        const amount = Number(requestAmount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
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

        const payloadBase = {
            user_id: auth.user.id,
            request_type: requestType,
            category_id: requestType === 'IncreaseLimit' ? requestCategoryId || null : null,
            category_name: requestType === 'NewCategory' ? newCategoryName.trim() : null,
            amount,
            status: 'Pending'
        };

        const payloadVariants = [
            { ...payloadBase, note: requestNote.trim() || null },
            { ...payloadBase, request_note: requestNote.trim() || null },
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

    const finalizeBudgetRequest = async (request: any) => {
        if (!supabase) return;
        const amount = Number(request.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Request amount is invalid; please reject or correct the request.');
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
            .update({ status: 'Finalized' })
            .eq('id', request.id);
        if (requestUpdateError) {
            alert(`Failed to finalize request: ${requestUpdateError.message}`);
            return;
        }

        setBudgetRequests(prev => prev.map((r) => r.id === request.id ? { ...r, status: 'Finalized' } : r));
    };

    const rejectBudgetRequest = async (requestId: string) => {
        if (!supabase) return;
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


    const pendingRequests = useMemo(() => budgetRequests.filter((r) => r.status === 'Pending'), [budgetRequests]);
    const respondedRequests = useMemo(() => budgetRequests.filter((r) => r.status !== 'Pending'), [budgetRequests]);

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
            {!isAdmin && (
                <div className="bg-gradient-to-br from-white via-primary/5 to-indigo-50 rounded-lg shadow p-5 border border-primary/20">
                    <h2 className="text-lg font-semibold mb-3">Request Budget Change</h2>
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
                        <input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="Reason / note (optional)" className="p-2 border rounded md:col-span-2" />
                        <button onClick={submitBudgetRequest} className="px-4 py-2 bg-primary text-white rounded">Submit</button>
                    </div>
                </div>
            )}

            {!isAdmin && budgetRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-blue-50 to-sky-50 rounded-lg shadow p-5 border border-blue-200">
                    <h2 className="text-lg font-semibold mb-3">My Budget Requests</h2>
                    <div className="space-y-2">
                        {budgetRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{r.request_type} • {r.category_name || r.category_id || 'N/A'}</p>
                                    <p className="text-xs text-gray-500">Proposed: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${r.status === 'Pending' ? 'bg-amber-100 text-amber-800' : r.status === 'Finalized' ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}`}>{r.status}</span>
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
                                    <p className="font-medium">{r.request_type} • {r.category_name || r.category_id || 'N/A'}</p>
                                    <p className="text-xs text-gray-500">Amount: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${r.status === 'Finalized' ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}`}>{r.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isAdmin && pendingRequests.length > 0 && (
                <div className="bg-gradient-to-br from-white via-amber-50 to-orange-50 rounded-lg shadow p-5 border border-amber-200">
                    <h2 className="text-lg font-semibold mb-3">Budget Request Review</h2>
                    <div className="space-y-3">
                        {budgetRequests.map((r) => (
                            <div key={r.id} className="p-3 border rounded flex items-center justify-between gap-2">
                                <div>
                                    <p className="font-medium">{r.request_type} • {r.category_name || r.category_id || 'N/A'}</p>
                                    <p className="text-xs text-gray-500">Requested: {formatCurrencyString(Number(r.amount || 0), { digits: 0 })}</p>
                                    {(r.note || r.request_note) && <p className="text-xs text-gray-600 mt-1">Note: {r.note || r.request_note}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => finalizeBudgetRequest(r)} className="px-3 py-1 text-xs rounded bg-green-600 text-white">Finalize</button>
                                    <button onClick={() => rejectBudgetRequest(r.id)} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {budgetView === 'Yearly' && (
                <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded p-3">
                    Yearly view aggregates all monthly budgets and spending for {currentYear}.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {budgetData.map(budget => (
                    <div key={budget.category} className="bg-gradient-to-br from-white via-slate-50 to-primary/5 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 flex flex-col border border-slate-100">
                        <div className="flex-grow">
                            <h3 className="text-lg font-semibold text-dark">{budget.category}</h3>
                            <div className="mt-4">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-medium text-secondary">{formatCurrencyString(budget.spent, { digits: 0 })}</span>
                                    <span className="text-sm text-gray-500">/ {formatCurrencyString(budget.limit, { digits: 0 })}</span>
                                </div>
                                <ProgressBar value={budget.spent} max={budget.limit} color={budget.colorClass} />
                                <p className={`text-right text-sm mt-1 ${budget.limit - budget.spent >= 0 ? 'text-gray-600' : 'text-danger font-medium'}`}>
                                    {budget.limit - budget.spent >= 0 
                                        ? `${formatCurrencyString(budget.limit - budget.spent, { digits: 0 })} remaining`
                                        : `${formatCurrencyString(Math.abs(budget.limit - budget.spent), { digits: 0 })} over`
                                    }
                                </p>
                            </div>
                        </div>
                         <div className="border-t mt-4 pt-2 flex justify-end space-x-2">
                            <button disabled={budgetView === 'Yearly'} onClick={() => handleOpenModal(budget)} className="p-2 text-gray-400 hover:text-primary disabled:opacity-40"><PencilIcon className="h-4 w-4"/></button>
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
