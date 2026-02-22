import React, { useState, useContext, useEffect, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { PlannedTrade } from '../types';
import Modal from '../components/Modal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { PlusIcon } from '../components/icons/PlusIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { RocketLaunchIcon } from '../components/icons/RocketLaunchIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useMarketData } from '../context/MarketDataContext';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';


const PlanTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (plan: Omit<PlannedTrade, 'id'|'user_id'> | PlannedTrade) => void;
    planToEdit: PlannedTrade | null;
}> = ({ isOpen, onClose, onSave, planToEdit }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
    const [conditionType, setConditionType] = useState<'price' | 'date'>('price');
    const [targetValue, setTargetValue] = useState('');
    const [quantity, setQuantity] = useState('');
    const [amount, setAmount] = useState('');
    const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (planToEdit) {
            setSymbol(planToEdit.symbol);
            setName(planToEdit.name);
            setTradeType(planToEdit.tradeType);
            setConditionType(planToEdit.conditionType);
            if (planToEdit.conditionType === 'date') {
                setTargetValue(new Date(planToEdit.targetValue).toISOString().split('T')[0]);
            } else {
                setTargetValue(String(planToEdit.targetValue));
            }
            setQuantity(String(planToEdit.quantity || ''));
            setAmount(String(planToEdit.amount || ''));
            setPriority(planToEdit.priority);
            setNotes(planToEdit.notes || '');
        } else {
            // Reset form
            setSymbol(''); setName(''); setTradeType('buy'); setConditionType('price');
            setTargetValue(''); setQuantity(''); setAmount(''); setPriority('Medium'); setNotes('');
        }
    }, [planToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!quantity && !amount) {
            alert("Please specify either a quantity of shares or a total amount in SAR for the trade.");
            return;
        }
        
        const planData = {
            symbol: symbol.toUpperCase().trim(),
            name,
            tradeType,
            conditionType,
            targetValue: conditionType === 'date' ? new Date(targetValue).getTime() : parseFloat(targetValue),
            quantity: quantity ? parseFloat(quantity) : undefined,
            amount: amount ? parseFloat(amount) : undefined,
            priority,
            notes,
            status: 'Planned' as const
        };
        
        if (planToEdit) {
            onSave({ ...planToEdit, ...planData });
        } else {
            onSave(planData);
        }
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={planToEdit ? 'Edit Investment Plan' : 'Create Investment Plan'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700">Symbol</label><input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border rounded-md" /></div>
                    <div><label className="block text-sm font-medium text-gray-700">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border rounded-md" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-gray-700">Trade Type</label><select value={tradeType} onChange={e => setTradeType(e.target.value as any)} className="mt-1 w-full p-2 border rounded-md"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
                    <div><label className="block text-sm font-medium text-gray-700">Priority</label><select value={priority} onChange={e => setPriority(e.target.value as any)} className="mt-1 w-full p-2 border rounded-md"><option>High</option><option>Medium</option><option>Low</option></select></div>
                </div>
                <fieldset className="border p-4 rounded-md">
                    <legend className="text-sm font-medium text-gray-700 px-1">Condition</legend>
                    <div className="flex items-center space-x-4 mb-2">
                        <label className="flex items-center"><input type="radio" value="price" checked={conditionType === 'price'} onChange={() => setConditionType('price')} className="form-radio" /> <span className="ml-2">Price Target</span></label>
                        <label className="flex items-center"><input type="radio" value="date" checked={conditionType === 'date'} onChange={() => setConditionType('date')} className="form-radio" /> <span className="ml-2">Date Target</span></label>
                    </div>
                    <input type={conditionType === 'date' ? 'date' : 'number'} value={targetValue} onChange={e => setTargetValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" />
                </fieldset>
                <div className="grid grid-cols-2 gap-4">
                     <div><label className="block text-sm font-medium text-gray-700">Quantity</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="0" step="any" className="mt-1 w-full p-2 border rounded-md" placeholder="e.g., 100" /></div>
                    <div><label className="block text-sm font-medium text-gray-700">Amount (SAR)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any" className="mt-1 w-full p-2 border rounded-md" placeholder="e.g., 5000" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700">Notes (Optional)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full p-2 border rounded-md" rows={2}></textarea></div>

                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Plan</button>
            </form>
        </Modal>
    );
};


const InvestmentPlanView: React.FC<{ onExecutePlan: (plan: PlannedTrade) => void }> = ({ onExecutePlan }) => {
    const { data, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addUniverseTicker } = useContext(DataContext)!;
    const { simulatedPrices } = useMarketData();
    const { formatCurrencyString } = useFormatCurrency();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [planToEdit, setPlanToEdit] = useState<PlannedTrade | null>(null);
    const [planToDelete, setPlanToDelete] = useState<PlannedTrade | null>(null);
    const [alignmentFilter, setAlignmentFilter] = useState<'All' | 'Aligned' | 'Conflict' | 'Needs mapping'>('All');
    const [symbolFocus, setSymbolFocus] = useState<string>('');

    const handleSave = (planData: Omit<PlannedTrade, 'id' | 'user_id'> | PlannedTrade) => {
        if ('id' in planData) {
            updatePlannedTrade(planData);
        } else {
            addPlannedTrade(planData);
        }
    };
    
    const priorityClass = (p: PlannedTrade['priority']) => ({ High: 'bg-red-100 text-red-800', Medium: 'bg-yellow-100 text-yellow-800', Low: 'bg-blue-100 text-blue-800' }[p]);
    const getPlannedExecutionPrice = (plan: PlannedTrade): number | null => {
        if (plan.quantity && plan.amount && plan.quantity > 0) return plan.amount / plan.quantity;
        return plan.conditionType === 'price' ? plan.targetValue : null;
    };

    const getPriceSignalClass = (plan: PlannedTrade): string => {
        const plannedPrice = getPlannedExecutionPrice(plan);
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        if (!plannedPrice || !currentPrice) return 'bg-gray-100 text-gray-600';

        const ratio = (currentPrice - plannedPrice) / plannedPrice;
        if (Math.abs(ratio) <= 0.01) return 'bg-yellow-100 text-yellow-800';
        if (plan.tradeType === 'buy') {
            return currentPrice <= plannedPrice ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
        }
        return currentPrice >= plannedPrice ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
    };

    const getPriceSignalLabel = (plan: PlannedTrade): string => {
        const plannedPrice = getPlannedExecutionPrice(plan);
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        if (!plannedPrice || !currentPrice) return 'Waiting price';

        const ratio = Math.abs((currentPrice - plannedPrice) / plannedPrice);
        if (ratio <= 0.01) return 'Near plan';
        if (plan.tradeType === 'buy') return currentPrice <= plannedPrice ? 'Favorable' : 'Expensive';
        return currentPrice >= plannedPrice ? 'Favorable' : 'Below plan';
    };

    
    const renderCondition = (plan: PlannedTrade) => {
        if (plan.conditionType === 'date') {
            return `On ${new Date(plan.targetValue).toLocaleDateString()}`;
        }
        const currentPrice = simulatedPrices[plan.symbol]?.price;
        const operator = plan.tradeType === 'buy' ? '≤' : '≥';
        const priceText = `${operator} ${formatCurrencyString(plan.targetValue)}`;
        return <>{priceText} <span className="text-xs text-gray-500">(Now: {currentPrice ? formatCurrencyString(currentPrice) : '...'})</span></>;
    }
    


    const planAlignment = useMemo(() => {
        const statusBySymbol = new Map((data.portfolioUniverse || []).map((t: any) => [String(t.ticker || '').toUpperCase(), t.status]));
        const rows = data.plannedTrades.map(plan => {
            const universeStatus = statusBySymbol.get(plan.symbol.toUpperCase()) || 'Untracked';
            const isBuy = plan.tradeType === 'buy';
            const recommendation = universeStatus === 'Core' || universeStatus === 'High-Upside'
                ? 'Accumulate'
                : universeStatus === 'Speculative'
                ? 'Small sizing only'
                : universeStatus === 'Quarantine'
                ? 'Reduce / avoid new exposure'
                : 'Review manually';
            const suggestedTradeType: 'buy' | 'sell' = universeStatus === 'Quarantine' ? 'sell' : 'buy';
            const aligned = universeStatus === 'Untracked'
                ? null
                : (isBuy && universeStatus !== 'Quarantine') || (!isBuy && universeStatus === 'Quarantine');
            const reason = aligned === false
                ? (isBuy && universeStatus === 'Quarantine'
                    ? 'Buy conflicts with quarantine status.'
                    : !isBuy && universeStatus !== 'Quarantine'
                    ? 'Sell may reduce non-quarantine exposure.'
                    : 'Direction differs from AI universe posture.')
                : aligned === true
                ? 'Direction supports current universe posture.'
                : 'Symbol is not mapped in portfolio universe yet.';
            return { plan, universeStatus, recommendation, aligned, reason, suggestedTradeType };
        });

        const filteredRows = rows.filter(r => alignmentFilter === 'All'
            ? true
            : alignmentFilter === 'Aligned'
            ? r.aligned === true
            : alignmentFilter === 'Conflict'
            ? r.aligned === false
            : r.aligned === null
        );

        return {
            rows,
            filteredRows,
            alignedCount: rows.filter(r => r.aligned === true).length,
            conflictCount: rows.filter(r => r.aligned === false).length,
            untrackedCount: rows.filter(r => r.aligned === null).length,
        };
    }, [data.plannedTrades, data.portfolioUniverse, alignmentFilter]);




    const handleAddToUniverse = async (plan: PlannedTrade) => {
        const exists = (data.portfolioUniverse || []).some(t => t.ticker.toUpperCase() == plan.symbol.toUpperCase());
        if (exists) {
            setAlignmentFilter('All');
            setSymbolFocus(plan.symbol);
            return;
        }

        await addUniverseTicker({
            ticker: plan.symbol.toUpperCase(),
            name: plan.name || plan.symbol.toUpperCase(),
            status: 'Watchlist',
            max_position_weight: 0.1,
        });
        setAlignmentFilter('All');
        setSymbolFocus(plan.symbol);
    };


    const handleAlignWithAi = async (plan: PlannedTrade, suggestedTradeType: 'buy' | 'sell') => {
        if (plan.tradeType === suggestedTradeType) return;
        await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
        setSymbolFocus(plan.symbol);
    };

    const handleAlignAllConflicts = async () => {
        const conflicts = planAlignment.rows.filter(r => r.aligned === false);
        for (const { plan, suggestedTradeType } of conflicts) {
            await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
        }
        if (conflicts.length > 0) {
            setAlignmentFilter('Aligned');
        }
    };

    const handleEditNextConflict = () => {
        const nextConflict = planAlignment.filteredRows.find(r => r.aligned === false) || planAlignment.rows.find(r => r.aligned === false);
        if (!nextConflict) return;
        setSymbolFocus(nextConflict.plan.symbol);
        setPlanToEdit(nextConflict.plan);
        setIsModalOpen(true);
    };



    const strategyGuides = [
        {
            key: 'core',
            title: 'Core Accumulation',
            when: 'Best for diversified, high-conviction symbols with stable fundamentals.',
            benefit: 'Builds long-term compounding with disciplined entries.',
            risk: 'Over-concentration if you skip weight limits.',
            playbook: 'Use Buy plans, medium/high priority, and monthly weights near your target allocation.'
        },
        {
            key: 'tactical',
            title: 'Tactical Rebalance',
            when: 'Use when AI signals drift from target allocation or conviction changes.',
            benefit: 'Reduces portfolio drift and improves risk consistency.',
            risk: 'Frequent changes can increase churn and trading costs.',
            playbook: 'Review Plan vs AI alignment, resolve conflicts first, then execute triggered plans.'
        },
        {
            key: 'defensive',
            title: 'Defensive De-risk',
            when: 'Apply to quarantine or high-volatility names and macro stress phases.',
            benefit: 'Protects downside and frees capacity for stronger names.',
            risk: 'Can cap upside if you exit too early.',
            playbook: 'Prefer Sell plans on quarantine names and keep explicit notes for re-entry conditions.'
        },
    ] as const;

    const aiPlanCandidates = useMemo(() => {
        const plannedSymbols = new Set(data.plannedTrades.map(p => p.symbol.toUpperCase()));
        return (data.portfolioUniverse || [])
            .filter((ticker: any) => ['Core', 'High-Upside', 'Quarantine'].includes(ticker.status))
            .filter((ticker: any) => !plannedSymbols.has(String(ticker.ticker || '').toUpperCase()))
            .slice(0, 8)
            .map((ticker: any) => ({
                symbol: String(ticker.ticker || '').toUpperCase(),
                name: ticker.name || ticker.ticker,
                status: ticker.status,
                monthlyWeight: ticker.monthly_weight || 0,
                suggestion: ticker.status === 'Quarantine' ? 'sell' as const : 'buy' as const,
            }));
    }, [data.portfolioUniverse, data.plannedTrades]);

    const handleCreatePlanFromAi = async (candidate: { symbol: string; name: string; status: string; monthlyWeight: number; suggestion: 'buy' | 'sell' }) => {
        const existing = data.plannedTrades.some(plan => plan.symbol.toUpperCase() === candidate.symbol.toUpperCase());
        if (existing) {
            setSymbolFocus(candidate.symbol);
            return;
        }

        const priceAnchor = simulatedPrices[candidate.symbol]?.price || 1;
        await addPlannedTrade({
            symbol: candidate.symbol,
            name: candidate.name || candidate.symbol,
            tradeType: candidate.suggestion,
            conditionType: 'price',
            targetValue: priceAnchor,
            quantity: undefined,
            amount: undefined,
            priority: candidate.status === 'Quarantine' ? 'High' : 'Medium',
            notes: `Created from AI rebalance posture (${candidate.status}).`,
            status: 'Planned',
        });
        setSymbolFocus(candidate.symbol);
    };

    const visiblePlans = useMemo(() => {
        if (!symbolFocus) return data.plannedTrades;
        return data.plannedTrades.filter(plan => plan.symbol.toUpperCase() === symbolFocus.toUpperCase());
    }, [data.plannedTrades, symbolFocus]);

    const isTriggered = (plan: PlannedTrade) => {
        if (plan.status === 'Executed') return false;
        if (plan.conditionType === 'price') {
            const priceInfo = simulatedPrices[plan.symbol];
            if (!priceInfo) return false;
            return (plan.tradeType === 'buy' && priceInfo.price <= plan.targetValue) || (plan.tradeType === 'sell' && priceInfo.price >= plan.targetValue);
        }
        if (plan.conditionType === 'date') {
            return new Date().getTime() >= plan.targetValue;
        }
        return false;
    }

    return (
        <div className="mt-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-dark">Investment Plan</h2>
                    <p className="text-gray-500 mt-1">Proactively plan your trades based on price or date targets.</p>
                </div>
                <button onClick={() => { setPlanToEdit(null); setIsModalOpen(true); }} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm flex items-center gap-2"><PlusIcon className="h-5 w-5"/>Add Plan</button>
            </div>
            

            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                <h3 className="text-base font-semibold text-indigo-900 mb-2">How this plan works (and how to use it with AI rebalance)</h3>
                <ul className="text-sm text-indigo-800 space-y-1 list-disc pl-5">
                    <li><span className="font-medium">High priority:</span> core actions you want executed first when conditions are met.</li>
                    <li><span className="font-medium">Medium priority:</span> normal opportunities that can wait for better confirmation.</li>
                    <li><span className="font-medium">Low priority:</span> optional ideas you can defer during volatile periods.</li>
                </ul>
                <p className="text-xs text-indigo-700 mt-3">Workflow suggestion: build your target ideas here first, then run AI rebalance and compare its suggestions against your planned trades before executing. Use "Align with AI" for quick direction sync while preserving your condition, priority, and notes.</p>
            </div>





            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {strategyGuides.map((guide) => (
                    <div key={guide.key} className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-lg p-4 shadow-sm">
                        <h3 className="text-sm font-semibold text-slate-900">{guide.title}</h3>
                        <p className="text-xs text-slate-600 mt-2"><span className="font-semibold text-slate-700">When:</span> {guide.when}</p>
                        <p className="text-xs text-emerald-700 mt-2"><span className="font-semibold">Benefit:</span> {guide.benefit}</p>
                        <p className="text-xs text-rose-700 mt-2"><span className="font-semibold">Risk:</span> {guide.risk}</p>
                        <p className="text-xs text-indigo-700 mt-2"><span className="font-semibold">Playbook:</span> {guide.playbook}</p>
                    </div>
                ))}
            </div>

            <div className="bg-white border border-indigo-100 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-dark">AI Rebalance Candidates (quick add to plan)</h3>
                    <span className="text-xs text-gray-500">Only actionable symbols without an existing planned trade</span>
                </div>
                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                    {aiPlanCandidates.map((candidate) => (
                        <div key={candidate.symbol} className="p-2 rounded border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium text-dark">{candidate.symbol} • {candidate.name}</p>
                                <p className="text-xs text-gray-500">Status: {candidate.status} • Suggested: {candidate.suggestion.toUpperCase()} • Weight: {(candidate.monthlyWeight * 100).toFixed(1)}%</p>
                            </div>
                            <button type="button" onClick={() => handleCreatePlanFromAi(candidate)} className="text-xs px-2.5 py-1.5 rounded border border-indigo-300 text-indigo-700 hover:border-indigo-500">Create planned trade</button>
                        </div>
                    ))}
                    {aiPlanCandidates.length === 0 && <p className="text-sm text-gray-500">No additional AI candidates to map right now. Existing plans already cover actionable symbols.</p>}
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-dark">Plan vs AI Rebalance Alignment</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-xs text-gray-600 flex gap-3">
                            <span className="text-green-700 font-medium">Aligned: {planAlignment.alignedCount}</span>
                            <span className="text-rose-700 font-medium">Conflicts: {planAlignment.conflictCount}</span>
                            <span className="text-slate-600 font-medium">Untracked: {planAlignment.untrackedCount}</span>
                        </div>
                        <button type="button" onClick={handleEditNextConflict} disabled={planAlignment.conflictCount === 0} className="text-xs px-2 py-1 rounded border text-gray-600 hover:text-primary hover:border-primary disabled:opacity-40">Edit next conflict</button>
                        <button type="button" onClick={handleAlignAllConflicts} disabled={planAlignment.conflictCount === 0} className="text-xs px-2 py-1 rounded border text-emerald-700 border-emerald-300 hover:border-emerald-500 disabled:opacity-40">Align all conflicts</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                    {(['All', 'Aligned', 'Conflict', 'Needs mapping'] as const).map((filter) => (
                        <button key={filter} type="button" onClick={() => setAlignmentFilter(filter)} className={`px-2.5 py-1 text-xs rounded-full border ${alignmentFilter === filter ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-300'}`}>
                            {filter}
                        </button>
                    ))}
                </div>

                <div className="space-y-2 max-h-56 overflow-auto pr-1">
                    {planAlignment.filteredRows.slice(0, 8).map(({ plan, universeStatus, recommendation, aligned, reason, suggestedTradeType }) => (
                        <div key={`align-${plan.id}`} className="p-2 rounded border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <div>
                                <p className="text-sm font-medium text-dark">{plan.symbol} • {plan.tradeType.toUpperCase()}</p>
                                <p className="text-xs text-gray-500">Universe: {universeStatus} • {recommendation}</p>
                                <p className="text-xs text-gray-400">{reason}</p>
                                <p className="text-[11px] text-gray-500 mt-0.5">Advisor note: {suggestedTradeType === 'buy' ? 'Accumulation direction is preferred for this symbol posture.' : 'De-risking direction is preferred for this symbol posture.'}</p>
                            </div>
                            <div className="flex items-center gap-2 self-start sm:self-auto">
                                <button type="button" onClick={() => setSymbolFocus(plan.symbol)} className="text-xs px-2 py-1 rounded border text-gray-600 hover:text-primary hover:border-primary">Focus symbol</button>
                                <button type="button" onClick={() => { setPlanToEdit(plan); setIsModalOpen(true); }} className="text-xs px-2 py-1 rounded border text-gray-600 hover:text-primary hover:border-primary">Edit</button>
                                {aligned === false && (
                                    <button type="button" onClick={() => handleAlignWithAi(plan, suggestedTradeType)} className="text-xs px-2 py-1 rounded border text-emerald-700 border-emerald-200 hover:border-emerald-400">Align with AI</button>
                                )}
                                {aligned === null && (
                                    <button type="button" onClick={() => handleAddToUniverse(plan)} className="text-xs px-2 py-1 rounded border text-indigo-700 border-indigo-200 hover:border-indigo-400">Add to Universe</button>
                                )}
                                <span className={`text-xs px-2 py-1 rounded ${aligned === true ? 'bg-green-100 text-green-700' : aligned === false ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                                    {aligned === true ? 'Aligned' : aligned === false ? 'Conflict' : 'Needs mapping'}
                                </span>
                            </div>
                        </div>
                    ))}
                    {planAlignment.filteredRows.length === 0 && <p className="text-sm text-gray-500">No trades match the selected filter.</p>}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <p className="text-xs uppercase text-gray-500">Planned Trades</p>
                    <p className="text-2xl font-bold text-dark mt-1">{data.plannedTrades.length}</p>
                </div>
                <div className="bg-white border border-yellow-200 rounded-lg p-4">
                    <p className="text-xs uppercase text-yellow-700">Triggered</p>
                    <p className="text-2xl font-bold text-yellow-700 mt-1">{data.plannedTrades.filter(isTriggered).length}</p>
                </div>
                <div className="bg-white border border-green-200 rounded-lg p-4">
                    <p className="text-xs uppercase text-green-700">Executed</p>
                    <p className="text-2xl font-bold text-green-700 mt-1">{data.plannedTrades.filter(p => p.status === 'Executed').length}</p>
                </div>
            </div>

            {symbolFocus && (
                <div className="bg-blue-50 border border-blue-100 text-blue-800 text-sm rounded-lg px-3 py-2 flex items-center justify-between">
                    <span>Focused on symbol: <span className="font-semibold">{symbolFocus.toUpperCase()}</span></span>
                    <button type="button" onClick={() => setSymbolFocus('')} className="text-xs px-2 py-1 border rounded hover:border-primary hover:text-primary">Clear focus</button>
                </div>
            )}

            <div className="bg-white shadow rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-3">Asset</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Trigger Condition</th>
                        <th className="px-4 py-3">Planned Price</th><th className="px-4 py-3">Signal</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
                    </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {visiblePlans.map(plan => (
                             <tr key={plan.id} className={isTriggered(plan) ? 'bg-yellow-50' : ''}>
                                <td className="px-4 py-3 whitespace-nowrap"><div className="font-medium text-dark">{plan.symbol}</div><div className="text-xs text-gray-500">{plan.name}</div></td>
                                <td className="px-4 py-3"><span className={`font-semibold ${plan.tradeType === 'buy' ? 'text-green-600' : 'text-red-600'}`}>{plan.tradeType.toUpperCase()}</span></td>
                                <td className="px-4 py-3">{renderCondition(plan)}</td>
                                <td className="px-4 py-3 whitespace-nowrap">{getPlannedExecutionPrice(plan) ? formatCurrencyString(getPlannedExecutionPrice(plan)!) : '--'}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 inline-flex text-xs font-semibold rounded-full ${getPriceSignalClass(plan)}`}>
                                        {getPriceSignalLabel(plan)}
                                    </span>
                                </td>
                                <td className="px-4 py-3"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${priorityClass(plan.priority)}`}>{plan.priority}</span></td>
                                <td className="px-4 py-3">
                                    {plan.status === 'Executed' ? <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircleIcon className="h-4 w-4"/>Executed</span> :
                                     isTriggered(plan) ? <span className="flex items-center gap-1 text-yellow-600 font-semibold"><ExclamationTriangleIcon className="h-4 w-4"/>Triggered</span> :
                                     <span className="text-gray-600">Planned</span>
                                    }
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => onExecutePlan(plan)} disabled={plan.status === 'Executed'} title="Execute Trade" className="p-2 text-white bg-secondary rounded-md hover:bg-violet-700 disabled:bg-gray-300"><RocketLaunchIcon className="h-4 w-4"/></button>
                                        <button onClick={() => { setPlanToEdit(plan); setIsModalOpen(true); }} className="p-2 text-gray-500 hover:text-primary"><PencilIcon className="h-4 w-4"/></button>
                                        <button onClick={() => setPlanToDelete(plan)} className="p-2 text-gray-500 hover:text-danger"><TrashIcon className="h-4 w-4"/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                 {visiblePlans.length === 0 && <div className="text-center py-10 text-gray-500">No investment plans match current focus/filter.</div>}
            </div>

            <PlanTradeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} planToEdit={planToEdit} />
            <DeleteConfirmationModal isOpen={!!planToDelete} onClose={() => setPlanToDelete(null)} onConfirm={() => { if(planToDelete) deletePlannedTrade(planToDelete.id); setPlanToDelete(null); }} itemName={planToDelete?.name || ''} />
        </div>
    );
};

export default InvestmentPlanView;