
import React, { useState, useCallback, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import ProgressBar from '../components/ProgressBar';
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

interface GoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (goal: Goal) => void;
    goalToEdit: Goal | null;
}

const GoalModal: React.FC<GoalModalProps> = ({ isOpen, onClose, onSave, goalToEdit }) => {
    const [name, setName] = useState('');
    const [targetAmount, setTargetAmount] = useState('');
    const [currentAmount, setCurrentAmount] = useState('');
    const [deadline, setDeadline] = useState('');

    useEffect(() => {
        if (goalToEdit) {
            setName(goalToEdit.name);
            setTargetAmount(String(goalToEdit.targetAmount));
            setCurrentAmount(String(goalToEdit.currentAmount));
            setDeadline(new Date(goalToEdit.deadline).toISOString().split('T')[0]);
        } else {
            setName('');
            setTargetAmount('');
            setCurrentAmount('');
            setDeadline('');
        }
    }, [goalToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newGoal: Goal = {
            id: goalToEdit ? goalToEdit.id : `goal${Date.now()}`,
            name,
            targetAmount: parseFloat(targetAmount) || 0,
            currentAmount: parseFloat(currentAmount) || 0,
            deadline,
            savingsAllocationPercent: goalToEdit?.savingsAllocationPercent || 0,
        };
        onSave(newGoal);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={goalToEdit ? 'Edit Goal' : 'Add New Goal'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Goal Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <input type="number" placeholder="Target Amount" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
                <input type="number" placeholder="Current Amount" value={currentAmount} onChange={e => setCurrentAmount(e.target.value)} required className="w-full p-2 border border-gray-300 rounded-md"/>
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
    const { formatCurrencyString } = useFormatCurrency();
    const [aiPlan, setAiPlan] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const handleGetAIPlan = useCallback(async () => {
        setIsLoading(true);
        const plan = await getGoalAIPlan(goal);
        setAiPlan(plan);
        setIsLoading(false);
    }, [goal]);
    
    const { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution } = useMemo(() => {
        const deadline = new Date(goal.deadline);
        const now = new Date();
        const goalStartDate = new Date(deadline.getFullYear() - 3, deadline.getMonth(), deadline.getDate());
        const totalDuration = deadline.getTime() - goalStartDate.getTime();
        const elapsedDuration = now.getTime() - goalStartDate.getTime();
        const monthsLeft = Math.max(0, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth());
        const progressPercent = (goal.currentAmount / goal.targetAmount) * 100;
        const timeElapsedPercent = totalDuration > 0 ? Math.min(100, (elapsedDuration / totalDuration) * 100) : 100;
        const remainingAmount = goal.targetAmount - goal.currentAmount;
        const requiredMonthlyContribution = monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;
        const projectedMonthlyContribution = monthlySavings * ((goal.savingsAllocationPercent || 0) / 100);

        let status: 'On Track' | 'Needs Attention' | 'At Risk' = 'On Track';
        if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.8) status = 'Needs Attention';
        if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.5) status = 'At Risk';
        if (monthsLeft <= 0 && progressPercent < 100) status = 'At Risk';
        
        const color = status === 'At Risk' ? 'bg-danger' : status === 'Needs Attention' ? 'bg-warning' : 'bg-primary';

        return { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution };
    }, [goal, monthlySavings]);

    return (
        <div className="bg-white p-6 rounded-lg shadow space-y-4 flex flex-col justify-between hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-in-out">
            <div>
                <div className="flex justify-between items-start">
                    <h3 className="text-xl font-semibold text-dark">{goal.name}</h3>
                    <GoalStatus status={status} />
                </div>
                
                <div className="mt-4">
                    <div className="flex justify-between items-baseline mb-1"><span className="font-medium text-secondary">{formatCurrencyString(goal.currentAmount, { digits: 0 })}</span><span className="text-sm text-gray-500">of {formatCurrencyString(goal.targetAmount, { digits: 0 })}</span></div>
                    <ProgressBar value={goal.currentAmount} max={goal.targetAmount} color={color} />
                     <div className="flex justify-between items-baseline mt-1 text-sm text-gray-600"><span>{progressPercent.toFixed(1)}% Complete</span><span>{monthsLeft > 0 ? `${monthsLeft} months left` : 'Deadline passed'}</span></div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-center bg-gray-50 border-t border-b p-3">
                    <div><p className="text-sm text-gray-500">Required Monthly</p><p className="font-bold text-lg text-primary">{formatCurrencyString(requiredMonthlyContribution, { digits: 0 })}</p></div>
                    <div><p className="text-sm text-gray-500">Projected Monthly</p><p className="font-bold text-lg text-dark">{formatCurrencyString(projectedMonthlyContribution, { digits: 0 })}</p></div>
                </div>
            </div>
            <div className="bg-indigo-50 p-4 rounded-lg">
                <div className="flex items-center justify-between"><h4 className="font-semibold text-indigo-800">AI Savings Plan</h4><button onClick={handleGetAIPlan} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"><RocketLaunchIcon className="h-4 w-4 mr-2"/>{isLoading ? 'Generating...' : 'Get AI Plan'}</button></div>
                {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating your plan...</div>}
                {aiPlan && !isLoading && <div className="mt-2 prose prose-sm max-w-none text-gray-600">{aiPlan.split('\n').map((p, i) => <p key={i}>{p}</p>)}</div>}
            </div>
             <div className="border-t mt-2 pt-2 flex justify-end space-x-2"><button onClick={onEdit} className="p-2 text-gray-400 hover:text-primary"><PencilIcon className="h-4 w-4"/></button><button onClick={onDelete} className="p-2 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4"/></button></div>
        </div>
    );
};

const Goals: React.FC = () => {
    const { data, addGoal, updateGoal, deleteGoal, updateGoalAllocations } = useContext(DataContext)!;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
    
    const [allocations, setAllocations] = useState<Record<string, number>>({});
    
    useEffect(() => {
        const initialAllocations: Record<string, number> = {};
        data.goals.forEach(g => {
            initialAllocations[g.id] = g.savingsAllocationPercent || 0;
        });
        setAllocations(initialAllocations);
    }, [data.goals]);
    
    const monthlySavings = 7500; // Mocked for now

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

    const totalAllocation = useMemo(() => Object.values(allocations).reduce((sum, p) => sum + p, 0), [allocations]);
    
    const handleSaveAllocations = () => {
        const allocationArray = Object.entries(allocations).map(([id, savingsAllocationPercent]) => ({ id, savingsAllocationPercent }));
        updateGoalAllocations(allocationArray);
        alert("Savings allocation strategy saved!");
    };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-3xl font-bold text-dark">Goal Command Center</h1><button onClick={() => handleOpenModal()} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"><PlusCircleIcon className="h-5 w-5"/>Add New Goal</button></div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold text-dark mb-2">Savings Allocation Strategy</h3>
        <p className="text-sm text-gray-500 mb-4">Allocate your monthly savings of <span className="font-bold text-dark">{useFormatCurrency().formatCurrencyString(monthlySavings)}</span> across your goals.</p>
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

      <AIAdvisor pageContext="goals" contextData={{ goals: data.goals, monthlySavings }}/>
      
       <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {data.goals.map(goal => (<GoalCard key={goal.id} goal={goal} monthlySavings={monthlySavings} onEdit={() => handleOpenModal(goal)} onDelete={() => handleOpenDeleteModal(goal)} />))}
        </div>
        <GoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
        <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={goalToDelete?.name || ''} />
    </div>
  );
};

export default Goals;
