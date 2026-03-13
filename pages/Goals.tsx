import React, { useState, useCallback, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { getGoalAIPlan } from '../services/geminiService';
import { Goal, Page } from '../types';
import { RocketLaunchIcon } from '../components/icons/RocketLaunchIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { PlusCircleIcon } from '../components/icons/PlusCircleIcon';
import AIAdvisor from '../components/AIAdvisor';
import { LinkIcon } from '../components/icons/LinkIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import ProgressBar from '../components/ProgressBar';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';
import { computeGoalFundingPlan } from '../services/goalFundingRouter';
import { ArrowDownTrayIcon } from '../components/icons/ArrowDownTrayIcon';

// A more visual progress bar specific for goals
const GoalProgressBar: React.FC<{ progress: number; colorClass: string }> = ({ progress, colorClass }) => {
    const [width, setWidth] = useState(0);

    useEffect(() => {
        // Animate the bar on load
        const timer = setTimeout(() => setWidth(progress), 100);
        return () => clearTimeout(timer);
    }, [progress]);

    return (
        <div className="relative h-5 bg-gray-200 rounded-full overflow-hidden">
            <div 
                className={`absolute top-0 left-0 h-full rounded-full ${colorClass} transition-all duration-1000 ease-out`}
                style={{ width: `${Math.min(width, 100)}%` }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>
                    {progress.toFixed(1)}% Complete
                </span>
            </div>
        </div>
    );
};


interface GoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (goal: Goal) => void;
    goalToEdit: Goal | null;
}

const GoalModal: React.FC<GoalModalProps> = ({ isOpen, onClose, onSave, goalToEdit }) => {
    const [name, setName] = useState('');
    const [targetAmount, setTargetAmount] = useState('');
    const [deadline, setDeadline] = useState('');
    const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');

    useEffect(() => {
        if (goalToEdit) {
            setName(goalToEdit.name);
            setTargetAmount(String(goalToEdit.targetAmount));
            setDeadline(new Date(goalToEdit.deadline).toISOString().split('T')[0]);
            setPriority(goalToEdit.priority || 'Medium');
        } else {
            setName('');
            setTargetAmount('');
            setDeadline('');
            setPriority('Medium');
        }
    }, [goalToEdit, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const rawTargetAmount = Number(targetAmount) || 0;
        if (!Number.isFinite(rawTargetAmount) || rawTargetAmount < 0) {
            alert('Please enter a valid target amount greater than or equal to 0.');
            return;
        }
        const goalData = {
            name,
            targetAmount: rawTargetAmount,
            deadline,
            priority,
        };

        try {
            if (goalToEdit) {
                await onSave({ ...goalToEdit, ...goalData });
            } else {
                await onSave({
                    id: `goal${Date.now()}`,
                    ...goalData,
                    currentAmount: 0, // New goals start with 0, progress is from linked assets.
                    savingsAllocationPercent: 0,
                });
            }
            onClose();
        } catch (error) {
            // Error handled in DataContext
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={goalToEdit ? 'Edit Goal' : 'Add New Goal'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Goal Name <InfoHint text="A clear name (e.g. Emergency Fund, World Trip) helps track progress and link assets." /></label>
                    <input type="text" placeholder="Goal Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Target Amount <InfoHint text="The total amount you want to reach. Progress is calculated from linked assets and savings." /></label>
                    <input type="number" placeholder="Target Amount" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Deadline <InfoHint text="Target date to reach this goal. Used to compute required monthly savings and status (On Track / At Risk)." /></label>
                    <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Priority <InfoHint text="High/Medium/Low affects how the system suggests allocating savings across multiple goals." /></label>
                    <select value={priority} onChange={e => setPriority(e.target.value as 'High' | 'Medium' | 'Low')} className="select-base">
                        <option value="High">High Priority</option>
                        <option value="Medium">Medium Priority</option>
                        <option value="Low">Low Priority</option>
                    </select>
                </div>
                <button type="submit" className="w-full btn-primary">Save Goal</button>
            </form>
        </Modal>
    );
};


const GoalStatus: React.FC<{ status: 'On Track' | 'Needs Attention' | 'At Risk' }> = ({ status }) => {
    const statusInfo = { 'On Track': { icon: <CheckCircleIcon className="h-5 w-5 text-green-700" />, bg: 'bg-green-100', text: 'text-green-800' }, 'Needs Attention': { icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-700" />, bg: 'bg-yellow-100', text: 'text-yellow-800' }, 'At Risk': { icon: <XCircleIcon className="h-5 w-5 text-red-700" />, bg: 'bg-red-100', text: 'text-red-800' } };
    const { icon, bg, text } = statusInfo[status];
    return (<div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${bg} ${text}`}>{icon}<span>{status}</span></div>);
}

const GoalCard: React.FC<{ goal: Goal; onEdit: () => void; onDelete: () => void; monthlySavings: number; onSeeInPlan?: () => void }> = ({ goal, onEdit, onDelete, monthlySavings, onSeeInPlan }) => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [aiPlan, setAiPlan] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const { linkedAssets, calculatedCurrentAmount } = useMemo(() => {
        const linkedItems: { name: string, value: number }[] = [];
        const assets = data?.assets ?? [];
        const investments = data?.investments ?? [];

        assets.filter(a => a.goalId === goal.id).forEach(a => {
            const value = Math.max(0, Number(a.value) || 0);
            if (Number.isFinite(value)) {
                linkedItems.push({ name: a.name, value });
            }
        });

        investments.forEach(p => {
            const holdings = p.holdings ?? [];
            if (p.goalId === goal.id) {
                const portfolioValue = holdings.reduce((sum, h) => {
                    const value = toSAR(h.currentValue, p.currency, exchangeRate);
                    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
                }, 0);
                if (Number.isFinite(portfolioValue)) {
                    linkedItems.push({ name: `Portfolio: ${p.name}`, value: portfolioValue });
                }
            } else {
                holdings.filter(h => h.goalId === goal.id).forEach(h => {
                    const value = toSAR(h.currentValue, p.currency, exchangeRate);
                    if (Number.isFinite(value)) {
                        linkedItems.push({ name: `${p.name}: ${h.symbol}`, value: Math.max(0, value) });
                    }
                });
            }
        });

        const totalValue = linkedItems.reduce((sum, item) => {
            const value = Number(item.value) || 0;
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

        return { linkedAssets: linkedItems, calculatedCurrentAmount: totalValue };
    }, [data?.assets, data?.investments, goal.id, exchangeRate]);

    const handleGetAIPlan = useCallback(async () => {
        setIsLoading(true);
        const plan = await getGoalAIPlan(goal, monthlySavings, calculatedCurrentAmount);
        setAiPlan(plan);
        setIsLoading(false);
    }, [goal, monthlySavings, calculatedCurrentAmount]);
    

    const { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor } = useMemo(() => {
        const currentAmount = Math.max(0, Number.isFinite(calculatedCurrentAmount) ? calculatedCurrentAmount : 0);
        let monthsLeft = 0;
        try {
            const deadline = new Date(goal.deadline);
            const now = new Date();
            if (Number.isFinite(deadline.getTime()) && Number.isFinite(now.getTime())) {
                monthsLeft = Math.max(0, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth());
            }
        } catch (error) {
            console.warn('Error calculating months left for goal:', error, goal);
        }
        const targetAmount = Math.max(0, Number(goal.targetAmount) || 0);
        const progressPercent = targetAmount > 0 && Number.isFinite(currentAmount) ? Math.min(1000, (currentAmount / targetAmount) * 100) : 0;
        const remainingAmount = Math.max(0, targetAmount - currentAmount);
        const requiredMonthlyContribution = monthsLeft > 0 && Number.isFinite(remainingAmount) ? remainingAmount / monthsLeft : (Number.isFinite(remainingAmount) ? remainingAmount : 0);
        const allocationPercent = Math.max(0, Math.min(100, Number(goal.savingsAllocationPercent) || 0));
        const safeMonthlySavings = Math.max(0, Number.isFinite(monthlySavings) ? monthlySavings : 0);
        const projectedMonthlyContribution = safeMonthlySavings * (allocationPercent / 100);

        let status: 'On Track' | 'Needs Attention' | 'At Risk' = 'On Track';
        if (progressPercent >= 100) {
            status = 'On Track';
        } else if (monthsLeft <= 0) {
            status = 'At Risk';
        } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.8) {
            status = 'Needs Attention';
        } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.5) {
            status = 'At Risk';
        }
        
        const color = progressPercent < 33 ? 'bg-danger' : progressPercent < 66 ? 'bg-warning' : 'bg-success';
        const borderColor = status === 'At Risk' ? 'border-danger' : status === 'Needs Attention' ? 'border-warning' : 'border-success';

        return { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor };
    }, [goal, monthlySavings, calculatedCurrentAmount]);

    return (
        <div className={`bg-gradient-to-br from-white via-slate-50 to-primary/5 p-6 rounded-lg shadow space-y-4 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300 border-t-4 ${borderColor}`}>
            {/* Header */}
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2"><h3 className="text-xl font-semibold text-dark">{goal.name}</h3><span className={`text-xs px-2 py-0.5 rounded-full ${goal.priority === 'High' ? 'bg-red-100 text-red-700' : goal.priority === 'Low' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-700'}`}>{goal.priority || 'Medium'}</span></div>
                        <p className="text-sm text-gray-500">
                            Target: <span className="font-medium text-dark">{formatCurrencyString(goal.targetAmount)}</span> by {new Date(goal.deadline).toLocaleDateString()}
                        </p>
                    </div>
                     <div className="flex-shrink-0 flex items-center -mt-2 -mr-2">
                        <button type="button" onClick={onEdit} className="p-2 text-gray-400 hover:text-primary" aria-label="Edit goal"><PencilIcon className="h-4 w-4"/></button>
                        <button type="button" onClick={onDelete} className="p-2 text-gray-400 hover:text-danger" aria-label="Delete goal"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                </div>
            </div>

            {/* Progress Section */}
            <div className="space-y-2">
                <GoalProgressBar progress={progressPercent} colorClass={color} />
                 <div className="flex justify-between items-baseline text-sm">
                    <div>
                        <span className="text-gray-500">Saved: </span>
                        <span className="font-semibold text-dark">{formatCurrencyString(calculatedCurrentAmount)}</span>
                    </div>
                    <div>
                        <span className="text-gray-500">Remaining: </span>
                        <span className="font-semibold text-dark">{formatCurrencyString(Math.max(0, goal.targetAmount - calculatedCurrentAmount))}</span>
                    </div>
                </div>
            </div>

            {/* Status and Contributions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center bg-gray-50 p-4 rounded-lg">
                <div className="text-center md:text-left space-y-1">
                    <p className="text-sm text-gray-600 mb-2">Status ({monthsLeft} months left)</p>
                    <GoalStatus status={status} />
                    {projectedMonthlyContribution > 0 && (goal.targetAmount - calculatedCurrentAmount) > 0 && (
                        <p className="text-xs text-slate-600 mt-2">
                            At current rate: <span className="font-semibold text-dark">~{Math.ceil((goal.targetAmount - calculatedCurrentAmount) / projectedMonthlyContribution)} months</span> to goal
                        </p>
                    )}
                </div>
                <div className="space-y-2">
                    <div>
                        <div className="flex justify-between items-center text-xs mb-0.5">
                            <span className="font-medium text-gray-600">Projected Monthly</span>
                            <span className="font-bold">{formatCurrencyString(projectedMonthlyContribution, { digits: 0 })}</span>
                        </div>
                        <div className="h-2 w-full bg-gray-200 rounded-full">
                            <div className="bg-blue-400 h-2 rounded-full" style={{ width: `${Math.min((projectedMonthlyContribution / Math.max(requiredMonthlyContribution, 1)) * 100, 100)}%` }}></div>
                        </div>
                    </div>
                     <div>
                        <div className="flex justify-between items-center text-xs mb-0.5">
                            <span className="font-medium text-gray-600">Required Monthly</span>
                            <span className="font-bold">{formatCurrencyString(requiredMonthlyContribution, { digits: 0 })}</span>
                        </div>
                         <div className="h-2 w-full bg-gray-200 rounded-full">
                            <div className="bg-primary h-2 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Linked Contributions */}
            <div className="border-t pt-4">
                <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center">
                    <LinkIcon className="h-4 w-4 mr-2 text-gray-400" />
                    Linked Contributions
                </h4>
                {linkedAssets.length > 0 ? (
                    <ul className="space-y-1 max-h-24 overflow-y-auto text-sm pr-2">
                        {linkedAssets.map((asset, index) => (
                            <li key={`${asset.name}-${index}`} className="flex justify-between items-center">
                                <span className="text-gray-600 break-words" title={asset.name}>{asset.name}</span>
                                <span className="font-medium text-dark flex-shrink-0 ml-2">{formatCurrencyString(asset.value, { digits: 0 })}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-gray-500 text-center italic mt-2">No assets linked. Link them from the Assets or Investments pages.</p>
                )}
            </div>
            
            {onSeeInPlan && (
                <div className="pt-2 border-t border-gray-200">
                    <button type="button" onClick={onSeeInPlan} className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors">
                        <LinkIcon className="h-4 w-4" /> See impact in Plan
                    </button>
                </div>
            )}
            <div className="bg-indigo-50 p-4 rounded-lg">
                <div className="flex items-center justify-between"><div><h4 className="font-semibold text-indigo-800">Savings Plan</h4><p className="text-xs text-indigo-700/80">From your expert advisor</p></div><button onClick={handleGetAIPlan} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"><RocketLaunchIcon className="h-4 w-4 mr-2"/>{isLoading ? 'Generating...' : 'Get AI Plan'}</button></div>
                {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating your plan...</div>}
                {aiPlan && !isLoading && <div className="mt-2"><SafeMarkdownRenderer content={aiPlan} /></div>}
            </div>
        </div>
    );
};

const Goals: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading, addGoal, updateGoal, deleteGoal, updateGoalAllocations } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
    const [allocations, setAllocations] = useState<Record<string, number>>({});
    
    useEffect(() => {
        const initialAllocations: Record<string, number> = {};
        (data?.goals ?? []).forEach(g => { initialAllocations[g.id] = g.savingsAllocationPercent || 0; });
        setAllocations(initialAllocations);
    }, [data?.goals]);

    const averageMonthlySavings = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        (data?.transactions ?? []).forEach(t => {
            try {
                const txDate = new Date(t.date);
                if (!Number.isFinite(txDate.getTime()) || txDate <= sixMonthsAgo) return;
                const amount = Number(t.amount) || 0;
                if (!Number.isFinite(amount)) return;
                const monthKey = t.date.slice(0, 7); // YYYY-MM
                const currentNet = monthlyNet.get(monthKey) || 0;
                monthlyNet.set(monthKey, currentNet + amount); // amount is positive for income, negative for expense
            } catch (error) {
                console.warn('Error processing transaction for monthly savings:', error, t);
            }
        });
        
        if (monthlyNet.size === 0) return 7500; // Default if no recent transactions
        
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, net) => {
            const value = Number(net) || 0;
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        return Math.max(0, Number.isFinite(totalNet) ? totalNet / monthlyNet.size : 0);
    }, [data?.transactions]);

    const { totalTargetAmount, totalCurrentAmount } = useMemo(() => {
        let totalTarget = 0;
        let totalCurrent = 0;
        const assets = data?.assets ?? [];
        const investments = data?.investments ?? [];
        const goals = data?.goals ?? [];
        const goalAssetValues = new Map<string, number>();

        assets.forEach(a => {
            if (a.goalId) {
                const value = Math.max(0, Number(a.value) || 0);
                if (Number.isFinite(value)) {
                    goalAssetValues.set(a.goalId, (goalAssetValues.get(a.goalId) || 0) + value);
                }
            }
        });

        investments.forEach(p => {
            const holdings = p.holdings ?? [];
            if (p.goalId) {
                const portfolioValue = holdings.reduce((sum, h) => {
                    const value = toSAR(h.currentValue, p.currency, exchangeRate);
                    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
                }, 0);
                if (Number.isFinite(portfolioValue)) {
                    goalAssetValues.set(p.goalId, (goalAssetValues.get(p.goalId) || 0) + portfolioValue);
                }
            } else {
                holdings.forEach(h => {
                    if (h.goalId) {
                        const value = toSAR(h.currentValue, p.currency, exchangeRate);
                        if (Number.isFinite(value)) {
                            goalAssetValues.set(h.goalId, (goalAssetValues.get(h.goalId) || 0) + Math.max(0, value));
                        }
                    }
                });
            }
        });

        goals.forEach(goal => {
            const target = Math.max(0, Number(goal.targetAmount) || 0);
            const current = Math.max(0, goalAssetValues.get(goal.id) || 0);
            if (Number.isFinite(target)) totalTarget += target;
            if (Number.isFinite(current)) totalCurrent += current;
        });

        return { totalTargetAmount: totalTarget, totalCurrentAmount: totalCurrent };
    }, [data?.goals, data?.assets, data?.investments, exchangeRate]);
    
    const overallProgress = totalTargetAmount > 0 ? (totalCurrentAmount / totalTargetAmount) * 100 : 0;

    const projectedAnnualSurplus = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const year = new Date().getFullYear();
        (data?.transactions ?? []).forEach(t => {
            try {
                const d = new Date(t.date);
                if (!Number.isFinite(d.getTime()) || d.getFullYear() !== year) return;
                const amount = Number(t.amount) || 0;
                if (!Number.isFinite(amount)) return;
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthlyNet.set(key, (monthlyNet.get(key) ?? 0) + amount);
            } catch (error) {
                console.warn('Error processing transaction for annual surplus:', error, t);
            }
        });
        if (monthlyNet.size === 0) {
            const projected = averageMonthlySavings * 12;
            return Number.isFinite(projected) ? Math.max(0, projected) : 0;
        }
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, v) => {
            const value = Number(v) || 0;
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        return Number.isFinite(totalNet) ? Math.max(0, totalNet) : 0;
    }, [data?.transactions, averageMonthlySavings]);

    const fundingPlan = useMemo(
        () => computeGoalFundingPlan(data, projectedAnnualSurplus),
        [data, projectedAnnualSurplus]
    );

    const goalsByPriority = useMemo(() => {
        const rank = { High: 0, Medium: 1, Low: 2 } as const;
        return [...(data?.goals ?? [])].sort((a, b) => (rank[a.priority || 'Medium'] - rank[b.priority || 'Medium']) || a.name.localeCompare(b.name));
    }, [data?.goals]);
    
    const handleOpenModal = (goal: Goal | null = null) => { setGoalToEdit(goal); setIsModalOpen(true); };
    const handleOpenDeleteModal = (goal: Goal) => { setGoalToDelete(goal); setIsDeleteModalOpen(true); };
    
    const handleSaveGoal = async (goal: Goal) => {
        try {
            if ((data?.goals ?? []).some(g => g.id === goal.id)) await updateGoal(goal);
            else await addGoal(goal);
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const handleConfirmDelete = () => {
        if (goalToDelete) {
            deleteGoal(goalToDelete.id);
            setIsDeleteModalOpen(false);
            setGoalToDelete(null);
        }
    };
    
    const handleAllocationChange = (goalId: string, value: string) => {
        const parsed = Number(value) || 0;
        const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
        setAllocations(prev => ({ ...prev, [goalId]: percent }));
    };

    const totalAllocation = useMemo(() => Object.values(allocations).reduce((sum: number, p: number) => {
        const value = Math.max(0, Math.min(100, Number(p) || 0));
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0), [allocations]);
    
    const handleSaveAllocations = () => {
        const allocationArray = Object.entries(allocations).map(([id, savingsAllocationPercent]) => ({ id, savingsAllocationPercent }));
        updateGoalAllocations(allocationArray);
        alert("Savings allocation strategy saved!");
    };

    const handleExportGoals = useCallback(() => {
        try {
            const exportData = {
                summary: {
                    totalTargetAmount,
                    totalCurrentAmount,
                    overallProgress: totalTargetAmount > 0 ? (totalCurrentAmount / totalTargetAmount) * 100 : 0,
                    averageMonthlySavings,
                    projectedAnnualSurplus,
                    totalAllocation,
                },
                goals: (data?.goals ?? []).map(goal => {
                    const goalAssets = (data?.assets ?? []).filter(a => a.goalId === goal.id);
                    const goalInvestments = (data?.investments ?? []).filter(p => p.goalId === goal.id || (p.holdings ?? []).some(h => h.goalId === goal.id));
                    return {
                        id: goal.id,
                        name: goal.name,
                        targetAmount: goal.targetAmount,
                        deadline: goal.deadline,
                        priority: goal.priority,
                        savingsAllocationPercent: goal.savingsAllocationPercent || 0,
                        linkedAssetsCount: goalAssets.length,
                        linkedInvestmentsCount: goalInvestments.length,
                    };
                }),
                fundingPlan: {
                    totalMonthlySurplus: fundingPlan.totalMonthlySurplus,
                    suggestions: fundingPlan.suggestions.map(s => ({
                        goalId: s.goalId,
                        name: s.name,
                        requiredPerMonth: s.requiredPerMonth,
                        suggestedPerMonth: s.suggestedPerMonth,
                        status: s.status,
                    })),
                },
                exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `goals-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting goals:', error);
            alert('Failed to export goals. Please try again.');
        }
    }, [data?.goals, data?.assets, data?.investments, totalTargetAmount, totalCurrentAmount, averageMonthlySavings, projectedAnnualSurplus, totalAllocation, fundingPlan]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

  return (
    <PageLayout
      title="Goal Command Center"
      description="Set targets, track progress, and allocate savings. Link assets and portfolios to goals for automatic progress."
      action={
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleExportGoals} className="btn-ghost flex items-center gap-2" title="Export goals data">
            <ArrowDownTrayIcon className="h-5 w-5" />
            Export
          </button>
          {setActivePage && (
            <button type="button" onClick={() => setActivePage('Plan')} className="btn-outline flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4" /> See impact in Plan
            </button>
          )}
          <button type="button" onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2"><PlusCircleIcon className="h-5 w-5"/>Add New Goal</button>
        </div>
      }
    >
      <SectionCard title="Overall Goal Progress" className="bg-gradient-to-br from-white via-slate-50 to-primary/5 border-slate-100">
        <GoalProgressBar progress={overallProgress} colorClass="bg-primary" />
        <div className="flex justify-between items-baseline text-sm mt-2">
            <div>
                <span className="text-gray-500">Total Saved: </span>
                <span className="font-semibold text-dark">{formatCurrencyString(totalCurrentAmount)}</span>
            </div>
            <div>
                <span className="text-gray-500">Total Target: </span>
                <span className="font-semibold text-dark">{formatCurrencyString(totalTargetAmount)}</span>
            </div>
        </div>
      </SectionCard>

      <SectionCard title="Savings Allocation Strategy" className="bg-gradient-to-br from-white via-slate-50 to-primary/5 border-slate-100">
        <p className="text-sm text-gray-500 mb-4">Allocate your average monthly savings of <span className="font-bold text-dark">{formatCurrencyString(averageMonthlySavings)}</span> across your goals.</p>
        <div className="space-y-3">
            {goalsByPriority.map(goal => (
                 <div key={goal.id} className="grid grid-cols-5 items-center gap-4">
                     <label htmlFor={`alloc-${goal.id}`} className="col-span-2 font-medium text-sm">{goal.name}</label>
                     <div className="col-span-2"><ProgressBar value={allocations[goal.id] || 0} max={100} /></div>
                     <div className="flex items-center"><input type="number" id={`alloc-${goal.id}`} value={allocations[goal.id] || ''} onChange={(e) => handleAllocationChange(goal.id, e.target.value)} className="w-16 p-1 border rounded-md text-sm"/><span className="ml-1 text-sm">%</span></div>
                 </div>
            ))}
        </div>
        <div className="border-t mt-4 pt-4 flex justify-between items-center">
             <div><span className="font-semibold">Total Allocated: </span><span className={`font-bold ${totalAllocation > 100 ? 'text-danger' : 'text-success'}`}>{totalAllocation}%</span>{totalAllocation > 100 && <p className="text-xs text-danger">Total cannot exceed 100%.</p>}</div>
             <button type="button" onClick={handleSaveAllocations} disabled={totalAllocation > 100} className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">Save Strategy</button>
        </div>
      </SectionCard>

      <SectionCard title="System Funding Suggestions" className="bg-white border border-slate-200">
        <p className="text-xs text-slate-600 mb-3">
            Based on your projected annual surplus of <span className="font-semibold">{formatCurrencyString(fundingPlan.totalMonthlySurplus, { digits: 0 })}</span> per month.
        </p>
        {(fundingPlan.suggestions.length === 0) && (
            <p className="text-sm text-slate-500">Add goals with future deadlines to see suggested monthly funding per goal.</p>
        )}
        <div className="space-y-2">
            {fundingPlan.suggestions.map(s => (
                <div key={s.goalId} className="flex justify-between items-center text-xs border rounded-md px-3 py-2 bg-slate-50">
                    <div>
                        <p className="font-semibold text-slate-900">{(data?.goals ?? []).find(g => g.id === s.goalId)?.name ?? s.name}</p>
                        <p className="text-slate-500 mt-0.5">
                            Required: {formatCurrencyString(s.requiredPerMonth, { digits: 0 })} / mo · Suggested: {formatCurrencyString(s.suggestedPerMonth, { digits: 0 })} / mo
                        </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        s.status === 'on_track' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {s.status === 'on_track' ? 'On track' : 'Need more'}
                    </span>
                </div>
            ))}
        </div>
      </SectionCard>

      <AIAdvisor pageContext="goals" contextData={{ goals: data?.goals ?? [], monthlySavings: averageMonthlySavings }}/>
      
       <div className="cards-grid grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {goalsByPriority.map(goal => (
            <GoalCard 
                key={goal.id} 
                goal={goal} 
                onEdit={() => handleOpenModal(goal)}
                onDelete={() => handleOpenDeleteModal(goal)}
                monthlySavings={averageMonthlySavings}
                onSeeInPlan={setActivePage ? () => setActivePage('Plan') : undefined}
            />
        ))}
      </div>
      
      <GoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={goalToDelete?.name || ''} />
    </PageLayout>
  );
};

export default Goals;
