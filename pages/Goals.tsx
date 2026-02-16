import React, { useState, useCallback, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { getGoalAIPlan } from '../services/geminiService';
import { Goal } from '../types';
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

    useEffect(() => {
        if (goalToEdit) {
            setName(goalToEdit.name);
            setTargetAmount(String(goalToEdit.targetAmount));
            setDeadline(new Date(goalToEdit.deadline).toISOString().split('T')[0]);
        } else {
            setName('');
            setTargetAmount('');
            setDeadline('');
        }
    }, [goalToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const goalData = {
            name,
            targetAmount: parseFloat(targetAmount) || 0,
            deadline,
        };

        if (goalToEdit) {
            onSave({ ...goalToEdit, ...goalData });
        } else {
            onSave({
                id: `goal${Date.now()}`,
                ...goalData,
                currentAmount: 0, // New goals start with 0, progress is from linked assets.
                savingsAllocationPercent: 0,
            });
        }
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={goalToEdit ? 'Edit Goal' : 'Add New Goal'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Goal Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <input type="number" placeholder="Target Amount" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Goal</button>
            </form>
        </Modal>
    );
};


const GoalStatus: React.FC<{ status: 'On Track' | 'Needs Attention' | 'At Risk' }> = ({ status }) => {
    const statusInfo = { 'On Track': { icon: <CheckCircleIcon className="h-5 w-5 text-green-700" />, bg: 'bg-green-100', text: 'text-green-800' }, 'Needs Attention': { icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-700" />, bg: 'bg-yellow-100', text: 'text-yellow-800' }, 'At Risk': { icon: <XCircleIcon className="h-5 w-5 text-red-700" />, bg: 'bg-red-100', text: 'text-red-800' } };
    const { icon, bg, text } = statusInfo[status];
    return (<div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${bg} ${text}`}>{icon}<span>{status}</span></div>);
}

const GoalCard: React.FC<{ goal: Goal; onEdit: () => void; onDelete: () => void; monthlySavings: number; }> = ({ goal, onEdit, onDelete, monthlySavings }) => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [aiPlan, setAiPlan] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const handleGetAIPlan = useCallback(async () => {
        setIsLoading(true);
        const plan = await getGoalAIPlan(goal, monthlySavings);
        setAiPlan(plan);
        setIsLoading(false);
    }, [goal, monthlySavings]);
    
    const { linkedAssets, calculatedCurrentAmount } = useMemo(() => {
        const linkedItems: { name: string, value: number }[] = [];
        
        data.assets.filter(a => a.goalId === goal.id).forEach(a => {
            linkedItems.push({ name: a.name, value: a.value });
        });

        data.investments.forEach(p => {
            p.holdings.filter(h => h.goalId === goal.id).forEach(h => {
                linkedItems.push({ name: `${p.name}: ${h.symbol}`, value: h.currentValue });
            });
        });

        const totalValue = linkedItems.reduce((sum, item) => sum + item.value, 0);

        return { linkedAssets: linkedItems, calculatedCurrentAmount: totalValue };
    }, [data.assets, data.investments, goal.id]);

    const { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor } = useMemo(() => {
        const currentAmount = calculatedCurrentAmount;
        const deadline = new Date(goal.deadline);
        const now = new Date();
        const monthsLeft = Math.max(0, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth());
        const progressPercent = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
        const remainingAmount = Math.max(0, goal.targetAmount - currentAmount);
        const requiredMonthlyContribution = monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;
        const projectedMonthlyContribution = monthlySavings * ((goal.savingsAllocationPercent || 0) / 100);

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
        <div className={`bg-white p-6 rounded-lg shadow space-y-4 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300 border-t-4 ${borderColor}`}>
            {/* Header */}
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-semibold text-dark">{goal.name}</h3>
                        <p className="text-sm text-gray-500">
                            Target: <span className="font-medium text-dark">{formatCurrencyString(goal.targetAmount)}</span> by {new Date(goal.deadline).toLocaleDateString()}
                        </p>
                    </div>
                     <div className="flex-shrink-0 flex items-center -mt-2 -mr-2">
                        <button onClick={onEdit} className="p-2 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                        <button onClick={onDelete} className="p-2 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
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
                <div className="text-center md:text-left">
                    <p className="text-sm text-gray-600 mb-2">Status ({monthsLeft} months left)</p>
                    <GoalStatus status={status} />
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
                                <span className="text-gray-600 truncate" title={asset.name}>{asset.name}</span>
                                <span className="font-medium text-dark flex-shrink-0 ml-2">{formatCurrencyString(asset.value, { digits: 0 })}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-gray-500 text-center italic mt-2">No assets linked. Link them from the Assets or Investments pages.</p>
                )}
            </div>
            
            <div className="bg-indigo-50 p-4 rounded-lg">
                <div className="flex items-center justify-between"><h4 className="font-semibold text-indigo-800">AI Savings Plan</h4><button onClick={handleGetAIPlan} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"><RocketLaunchIcon className="h-4 w-4 mr-2"/>{isLoading ? 'Generating...' : 'Get AI Plan'}</button></div>
                {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating your plan...</div>}
                {aiPlan && !isLoading && <div className="mt-2"><SafeMarkdownRenderer content={aiPlan} /></div>}
            </div>
        </div>
    );
};

const Goals: React.FC = () => {
    const { data, addGoal, updateGoal, deleteGoal, updateGoalAllocations } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
    const [allocations, setAllocations] = useState<Record<string, number>>({});
    
    useEffect(() => {
        const initialAllocations: Record<string, number> = {};
        data.goals.forEach(g => { initialAllocations[g.id] = g.savingsAllocationPercent || 0; });
        setAllocations(initialAllocations);
    }, [data.goals]);

    const averageMonthlySavings = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        data.transactions.filter(t => new Date(t.date) > sixMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            const currentNet = monthlyNet.get(monthKey) || 0;
            monthlyNet.set(monthKey, currentNet + t.amount); // amount is positive for income, negative for expense
        });
        
        if (monthlyNet.size === 0) return 7500; // Default if no recent transactions
        
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, net) => sum + net, 0);
        return Math.max(0, totalNet / monthlyNet.size);
    }, [data.transactions]);

    const { totalTargetAmount, totalCurrentAmount } = useMemo(() => {
        let totalTarget = 0;
        let totalCurrent = 0;
        
        const goalAssetValues = new Map<string, number>();

        data.assets.forEach(a => {
            if (a.goalId) {
                goalAssetValues.set(a.goalId, (goalAssetValues.get(a.goalId) || 0) + a.value);
            }
        });

        data.investments.forEach(p => {
            p.holdings.forEach(h => {
                if (h.goalId) {
                    goalAssetValues.set(h.goalId, (goalAssetValues.get(h.goalId) || 0) + h.currentValue);
                }
            });
        });

        data.goals.forEach(goal => {
            totalTarget += goal.targetAmount;
            totalCurrent += goalAssetValues.get(goal.id) || 0;
        });

        return { totalTargetAmount: totalTarget, totalCurrentAmount: totalCurrent };
    }, [data.goals, data.assets, data.investments]);
    
    const overallProgress = totalTargetAmount > 0 ? (totalCurrentAmount / totalTargetAmount) * 100 : 0;
    
    const handleOpenModal = (goal: Goal | null = null) => { setGoalToEdit(goal); setIsModalOpen(true); };
    const handleOpenDeleteModal = (goal: Goal) => { setGoalToDelete(goal); setIsDeleteModalOpen(true); };
    
    const handleSaveGoal = (goal: Goal) => {
        if (data.goals.some(g => g.id === goal.id)) updateGoal(goal);
        else addGoal(goal);
    };

    const handleConfirmDelete = () => {
        if (goalToDelete) {
            deleteGoal(goalToDelete.id);
            setIsDeleteModalOpen(false);
            setGoalToDelete(null);
        }
    };
    
    const handleAllocationChange = (goalId: string, value: string) => {
        const percent = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
        setAllocations(prev => ({ ...prev, [goalId]: percent }));
    };

    const totalAllocation = useMemo(() => Object.values(allocations).reduce((sum: number, p: number) => sum + p, 0), [allocations]);
    
    const handleSaveAllocations = () => {
        const allocationArray = Object.entries(allocations).map(([id, savingsAllocationPercent]) => ({ id, savingsAllocationPercent }));
        updateGoalAllocations(allocationArray);
        alert("Savings allocation strategy saved!");
    };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-3xl font-bold text-dark">Goal Command Center</h1><button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"><PlusCircleIcon className="h-5 w-5"/>Add New Goal</button></div>
      
       <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold text-dark mb-4">Overall Goal Progress</h3>
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
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold text-dark mb-2">Savings Allocation Strategy</h3>
        <p className="text-sm text-gray-500 mb-4">Allocate your average monthly savings of <span className="font-bold text-dark">{formatCurrencyString(averageMonthlySavings)}</span> across your goals.</p>
        <div className="space-y-3">
            {data.goals.map(goal => (
                 <div key={goal.id} className="grid grid-cols-5 items-center gap-4">
                     <label htmlFor={`alloc-${goal.id}`} className="col-span-2 font-medium text-sm">{goal.name}</label>
                     <div className="col-span-2"><ProgressBar value={allocations[goal.id] || 0} max={100} /></div>
                     <div className="flex items-center"><input type="number" id={`alloc-${goal.id}`} value={allocations[goal.id] || ''} onChange={(e) => handleAllocationChange(goal.id, e.target.value)} className="w-16 p-1 border rounded-md text-sm"/><span className="ml-1 text-sm">%</span></div>
                 </div>
            ))}
        </div>
        <div className="border-t mt-4 pt-4 flex justify-between items-center">
             <div><span className="font-semibold">Total Allocated: </span><span className={`font-bold ${totalAllocation > 100 ? 'text-danger' : 'text-success'}`}>{totalAllocation}%</span>{totalAllocation > 100 && <p className="text-xs text-danger">Total cannot exceed 100%.</p>}</div>
             <button onClick={handleSaveAllocations} disabled={totalAllocation > 100} className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 transition-colors text-sm">Save Strategy</button>
        </div>
      </div>

      <AIAdvisor pageContext="goals" contextData={{ goals: data.goals, monthlySavings: averageMonthlySavings }}/>
      
       <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {data.goals.map(goal => (
            <GoalCard 
                key={goal.id} 
                goal={goal} 
                onEdit={() => handleOpenModal(goal)}
                onDelete={() => handleOpenDeleteModal(goal)}
                monthlySavings={averageMonthlySavings}
            />
        ))}
      </div>
      
      <GoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={goalToDelete?.name || ''} />
    </div>
  );
};

export default Goals;