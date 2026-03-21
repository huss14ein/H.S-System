import React, { useState, useContext, useEffect, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { PlannedTrade, type Page } from '../types';
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
import { computeHouseholdStressFromData } from '../services/householdBudgetStress';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { getPersonalTransactions } from '../utils/wealthScope';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import PageIntro from '../components/PageIntro';
import EmptyState from '../components/EmptyState';
import InfoHint from '../components/InfoHint';
import { toast } from '../context/ToastContext';
import { PAGE_INTROS, EMPTY_STATE_MESSAGES, EXECUTE_PLAN_STORAGE_KEY } from '../content/plainLanguage';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { ChartBarIcon } from '../components/icons/ChartBarIcon';
import { ClockIcon, TargetIcon } from '../components/icons';
import { useSelfLearning } from '../context/SelfLearningContext';


const PlanTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (plan: Omit<PlannedTrade, 'id'|'user_id'> | PlannedTrade) => void;
    planToEdit: PlannedTrade | null;
    universe?: { ticker?: string; name?: string }[];
    simulatedPrices?: Record<string, { price?: number }>;
    monthlyBudget?: number;
}> = ({ isOpen, onClose, onSave, planToEdit, universe = [], simulatedPrices = {}, monthlyBudget }) => {
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
            setAmount(String(planToEdit?.amount ?? ''));
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
        
        // Validations
        if (!symbol || symbol.trim() === '') {
            toast('Symbol is required.', 'error');
            return;
        }
        
        if (!quantity && !amount) {
            toast('Specify either number of shares or total amount for the trade.', 'error');
            return;
        }
        
        if (quantity && (parseFloat(quantity) <= 0 || !Number.isFinite(parseFloat(quantity)))) {
            toast('Quantity must be a positive number.', 'error');
            return;
        }
        
        if (amount && (parseFloat(amount) <= 0 || !Number.isFinite(parseFloat(amount)))) {
            toast('Amount must be a positive number.', 'error');
            return;
        }
        
        if (conditionType === 'price') {
            const price = parseFloat(targetValue);
            if (!Number.isFinite(price) || price <= 0) {
                toast('Target price must be a positive number.', 'error');
                return;
            }
            if (price > 1000000) {
                if (!confirm('Target price seems unusually high. Continue anyway?')) {
                    return;
                }
            }
        } else {
            const targetDate = new Date(targetValue);
            if (isNaN(targetDate.getTime())) {
                toast('Invalid target date.', 'error');
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const selectedDate = new Date(targetDate);
            selectedDate.setHours(0, 0, 0, 0);
            if (selectedDate < today) {
                if (!confirm('Target date is in the past. Continue anyway?')) {
                    return;
                }
            }
        }
        
        // Validate quantity/amount consistency if both are provided
        if (quantity && amount) {
            const qty = parseFloat(quantity);
            const amt = parseFloat(amount);
            if (qty > 0 && amt > 0) {
                const impliedPrice = amt / qty;
                if (conditionType === 'price') {
                    const targetPrice = parseFloat(targetValue);
                    if (targetPrice > 0) {
                        const diff = Math.abs(impliedPrice - targetPrice) / targetPrice;
                        if (diff > 0.1) {
                            if (!confirm(`Quantity and amount imply a price of ${impliedPrice.toFixed(2)}, which differs from target price ${targetPrice.toFixed(2)}. Continue anyway?`)) {
                                return;
                            }
                        }
                    }
                }
            }
        }
        
        const planData = {
            symbol: symbol.toUpperCase().trim(),
            name: name.trim() || symbol.toUpperCase().trim(),
            tradeType,
            conditionType,
            targetValue: conditionType === 'date' ? new Date(targetValue).getTime() : parseFloat(targetValue),
            quantity: quantity ? parseFloat(quantity) : undefined,
            amount: amount ? parseFloat(amount) : undefined,
            priority,
            notes: notes.trim(),
            status: 'Planned' as const
        };
        
        if (planToEdit) {
            onSave({ ...planToEdit, ...planData });
        } else {
            onSave(planData);
        }
        toast(planToEdit ? 'Plan updated.' : 'Plan created.', 'success');
        onClose();
    };

    // Auto-fill name from universe when symbol changes (only if name is empty).
    // Omit name from deps so clearing the field does not re-trigger fill.
    useEffect(() => {
        if (!symbol.trim() || planToEdit || name) return;
        const sym = symbol.trim().toUpperCase();
        const match = universe.find((t: any) => String(t.ticker || '').toUpperCase() === sym);
        if (match?.name) setName(match.name);
    }, [symbol, planToEdit, universe]);

    // Suggest target price from current price when creating new plan.
    // Omit targetValue from deps so clearing the field does not re-trigger fill.
    useEffect(() => {
        if (!isOpen || planToEdit || conditionType !== 'price' || targetValue) return;
        const sym = symbol.trim().toUpperCase();
        const price = simulatedPrices[sym]?.price;
        if (price && Number.isFinite(price)) setTargetValue(String(price));
    }, [isOpen, planToEdit, symbol, conditionType, simulatedPrices]);

    // Suggest amount from monthly budget when creating a buy plan (10% of budget).
    // Omit amount/quantity from deps so clearing the field does not re-trigger fill.
    useEffect(() => {
        if (!isOpen || planToEdit || tradeType !== 'buy' || amount || quantity) return;
        if (monthlyBudget && monthlyBudget > 0) {
            const suggested = Math.round(monthlyBudget * 0.1);
            if (suggested >= 100) setAmount(String(suggested));
        }
    }, [isOpen, planToEdit, tradeType, monthlyBudget]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={planToEdit ? 'Edit plan' : 'Create plan'}>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="symbol" className="block text-sm font-semibold text-gray-700 mb-2">Symbol</label>
                        <input 
                            type="text" 
                            id="symbol"
                            value={symbol} 
                            onChange={e => setSymbol(e.target.value)} 
                            required 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., AAPL" 
                        />
                    </div>
                    <div>
                        <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">Company Name</label>
                        <input 
                            type="text" 
                            id="name"
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            required 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., Apple Inc." 
                        />
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="trade-type" className="block text-sm font-semibold text-gray-700 mb-2">Trade Type</label>
                        <select 
                            id="trade-type"
                            value={tradeType} 
                            onChange={e => setTradeType(e.target.value as any)} 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="buy">Buy</option>
                            <option value="sell">Sell</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="priority" className="block text-sm font-semibold text-gray-700 mb-2">
                            Priority <InfoHint text="High = act first when triggered. Medium = normal. Low = optional, can wait." hintId="plan-trade-priority" hintPage="Investment Plan" />
                        </label>
                        <select 
                            id="priority"
                            value={priority} 
                            onChange={e => setPriority(e.target.value as any)} 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                        </select>
                    </div>
                </div>
                
                <fieldset className="border border-gray-200 rounded-lg p-4">
                    <legend className="text-sm font-semibold text-gray-700 px-2 inline-flex items-center gap-1">
                        Trigger condition
                        <InfoHint text="When should this plan run? Price target = when the stock hits a price. Date target = on a specific date." hintId="plan-condition-type" hintPage="Investment Plan" />
                    </legend>
                    <div className="flex items-center space-x-6 mb-4">
                        <label className="flex items-center cursor-pointer">
                            <input 
                                type="radio" 
                                value="price" 
                                checked={conditionType === 'price'} 
                                onChange={() => setConditionType('price')} 
                                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary" 
                            /> 
                            <span className="ml-2 text-sm font-medium">Price Target</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                            <input 
                                type="radio" 
                                value="date" 
                                checked={conditionType === 'date'} 
                                onChange={() => setConditionType('date')} 
                                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary" 
                            /> 
                            <span className="ml-2 text-sm font-medium">Date Target</span>
                        </label>
                    </div>
                    <div>
                        <label htmlFor="target-value" className="block text-sm font-semibold text-gray-700 mb-2">
                            {conditionType === 'date' ? 'Target Date' : (
                                <>Target Price <InfoHint text="Enter in the stock's traded currency (USD for US shares, SAR for Tadawul)." hintId="plan-target-price" hintPage="Investment Plan" /></>
                            )}
                        </label>
                        <input 
                            id="target-value"
                            type={conditionType === 'date' ? 'date' : 'number'} 
                            value={targetValue} 
                            onChange={e => setTargetValue(e.target.value)} 
                            required 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder={conditionType === 'date' ? 'Select date' : 'Enter target price'}
                        />
                    </div>
                </fieldset>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="quantity" className="block text-sm font-semibold text-gray-700 mb-2">
                            Quantity (shares) <InfoHint text="Number of shares to buy or sell. Or use Amount below for a total (in plan currency, usually SAR)." hintId="plan-quantity" hintPage="Investment Plan" />
                        </label>
                        <input 
                            id="quantity"
                            type="number" 
                            value={quantity} 
                            onChange={e => setQuantity(e.target.value)} 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., 100" 
                        />
                    </div>
                    <div>
                        <label htmlFor="amount" className="block text-sm font-semibold text-gray-700 mb-2">
                            Amount <InfoHint text="Total money for this trade (in plan currency, usually SAR). If you have a monthly budget set, we suggest 10% as a starting point." hintId="plan-amount" hintPage="Investment Plan" />
                        </label>
                        <input 
                            id="amount"
                            type="number" 
                            value={amount} 
                            onChange={e => setAmount(e.target.value)} 
                            min="0" 
                            step="any" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" 
                            placeholder="e.g., 5000" 
                        />
                    </div>
                </div>
                
                <div>
                    <label htmlFor="notes" className="block text-sm font-semibold text-gray-700 mb-2">Notes (Optional)</label>
                    <textarea 
                        id="notes"
                        value={notes} 
                        onChange={e => setNotes(e.target.value)} 
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none" 
                        rows={3}
                        placeholder="Add any notes or context for this trade..."
                    />
                </div>

                <div className="flex gap-3 pt-4">
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:from-primary/90 hover:to-secondary/90 transition-all font-medium shadow-sm"
                    >
                        {planToEdit ? 'Update Plan' : 'Create Plan'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

/** Control tower: cross-engine constraints, alerts, and prioritized actions for Investment Plan. */
const InvestmentPlanControlTower: React.FC = () => {
  const { data } = useContext(DataContext)!;
  const { analysis, actionQueue, cash, risk, household, ready } = useFinancialEnginesIntegration();
  const emergencyFund = useEmergencyFund(data ?? null);
  const nextBestActions = useMemo(() => {
    const txs = getPersonalTransactions(data);
    const salaryCov = salaryToExpenseCoverage(txs as import('../types').Transaction[], 6);
    const goalAlerts = (data?.goals ?? []).map((g: { id: string; name: string; savingsAllocationPercent?: number }) => ({
      goalId: g.id,
      name: g.name,
      allocPct: Number(g.savingsAllocationPercent) || 0,
    }));
    return generateNextBestActions({
      emergencyFundMonths: emergencyFund.monthsCovered,
      runwayMonths: emergencyFund.monthsCovered,
      goalAlerts,
      salaryCoverageRatio: salaryCov?.ratio ?? undefined,
      nwSnapshotCount: listNetWorthSnapshots().length,
    });
  }, [data, emergencyFund.monthsCovered]);

  const hasAlerts = (analysis?.alerts?.length ?? 0) > 0;
  const hasActions = actionQueue.length > 0;
  const hasNextBest = nextBestActions.length > 0;
  const hasStress = (household?.cashflowStressSignals?.length ?? 0) > 0;
  if (!ready && !hasNextBest) return null;
  if (!hasAlerts && !hasActions && !cash && !hasStress && !hasNextBest) return null;

  return (
    <SectionCard title="Your financial health check" collapsible collapsibleSummary="Cash, stress, runway" defaultExpanded>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cash && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Cash</p>
            <p className="text-sm text-slate-800">Buffer: {cash.cashflowBuffer.toFixed(1)} mo · Discretionary: {cash.discretionaryBudget >= 0 ? Math.round(cash.discretionaryBudget).toLocaleString() : '—'}</p>
          </div>
        )}
        {risk && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Risk</p>
            <p className="text-sm text-slate-800">Portfolio risk: {risk.currentPortfolioRisk}/100 · Budget left: {risk.riskBudgetRemaining.toFixed(0)}</p>
          </div>
        )}
        {household?.cashflowStressSignals && household.cashflowStressSignals.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Household</p>
            <p className="text-sm text-amber-900">{household.cashflowStressSignals[0].message}</p>
          </div>
        )}
      </div>
      {hasAlerts && analysis && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">Alerts</p>
          <ul className="space-y-1 text-sm text-amber-900">
            {analysis.alerts.slice(0, 3).map((a, i) => (
              <li key={i}>{a.message}</li>
            ))}
          </ul>
        </div>
      )}
      {hasActions && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-600 mb-2">Prioritized actions</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {actionQueue.slice(0, 4).map((item, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{item.action}</span>
                <span className="text-slate-500 text-xs">P{Math.round(item.priority)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasNextBest && (
        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="text-xs font-semibold text-indigo-800 mb-2">Suggested actions</p>
          <ul className="space-y-1 text-sm text-indigo-900">
            {nextBestActions.slice(0, 3).map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Your plans are checked against cash and risk limits. For full allocation, use Wealth Ultra.</p>
    </SectionCard>
  );
};

const InvestmentPlanView: React.FC<{
    onExecutePlan: (plan?: PlannedTrade) => void;
    setActivePage?: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
}> = ({ onExecutePlan, setActivePage: _setActivePage, triggerPageAction }) => {
    const { data, loading, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addUniverseTicker } = useContext(DataContext)!;
    const { trackAction, trackSuggestionFeedback } = useSelfLearning();
    const { simulatedPrices } = useMarketData();
    const { formatCurrencyString } = useFormatCurrency();
    
    // Loading state
    if (loading || !data) {
        return (
            <PageLayout 
                title="Investment Plan" 
                description="Proactively plan your trades based on price or date targets with AI-powered alignment."
            >
                <div className="flex items-center justify-center py-12" aria-busy="true">
                    <div className="text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading investment plan" />
                        <p className="text-sm text-slate-600">Loading investment plan data...</p>
                    </div>
                </div>
            </PageLayout>
        );
    }

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [planToEdit, setPlanToEdit] = useState<PlannedTrade | null>(null);
    const [planToDelete, setPlanToDelete] = useState<PlannedTrade | null>(null);
    const [alignmentFilter, setAlignmentFilter] = useState<'All' | 'Aligned' | 'Conflict' | 'Needs mapping'>('All');
    const [symbolFocus, setSymbolFocus] = useState<string>('');

    const householdStress = React.useMemo(
        () => computeHouseholdStressFromData(data),
        [data]
    );

    const handleSave = (planData: Omit<PlannedTrade, 'id' | 'user_id'> | PlannedTrade) => {
        if ('id' in planData) {
            updatePlannedTrade(planData);
        } else {
            addPlannedTrade(planData);
        }
    };

    const handleOpenPlanModal = (plan: PlannedTrade | null) => {
        if (!plan) trackAction('add-plan', 'Investment Plan');
        setPlanToEdit(plan);
        setIsModalOpen(true);
    };

    const handleExecutePlan = (plan: PlannedTrade) => {
        if (!triggerPageAction) {
            onExecutePlan(plan);
            return;
        }
        try {
            sessionStorage.setItem(EXECUTE_PLAN_STORAGE_KEY, JSON.stringify({
                symbol: plan.symbol,
                name: plan.name,
                tradeType: plan.tradeType,
                amount: plan.amount,
                quantity: plan.quantity,
                price: plan.conditionType === 'price' ? plan.targetValue : undefined,
                executedPlanId: plan.id,
                reason: 'From Investment Plan',
            }));
            triggerPageAction('Investments', 'open-trade-modal:from-plan');
        } catch {
            toast('Could not open Record Trade. Go to Investments to record manually.', 'error');
        }
    };
    
    const priorityClass = (p: PlannedTrade['priority']) => ({ High: 'bg-red-100 text-red-800', Medium: 'bg-yellow-100 text-yellow-800', Low: 'bg-blue-100 text-blue-800' }[p]);
    const getPlannedExecutionPrice = (plan: PlannedTrade): number | null => {
        if ((plan.quantity ?? 0) > 0 && (plan.amount ?? 0) > 0) {
            const qty = plan.quantity ?? 1;
            if (qty === 0) return null; // Prevent division by zero
            return (plan.amount ?? 0) / qty;
        }
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
        const universe = data?.portfolioUniverse ?? [];
        const plannedTrades = data?.plannedTrades ?? [];
        const statusBySymbol = new Map(universe.map((t: any) => [String(t.ticker || '').toUpperCase(), t.status]));
        const rows = plannedTrades.map(plan => {
            const universeStatus = statusBySymbol.get((plan.symbol ?? '').toUpperCase()) || 'Untracked';
            const isBuy = plan.tradeType === 'buy';
            const recommendation = universeStatus === 'Core' || universeStatus === 'High-Upside'
                ? 'Accumulate'
                : universeStatus === 'Speculative'
                ? 'Small sizing only'
                : universeStatus === 'Quarantine'
                ? 'Reduce / avoid new exposure'
                : universeStatus === 'Watchlist' || universeStatus === 'Excluded'
                ? 'Review manually'
                : 'Review manually';
            const suggestedTradeType: 'buy' | 'sell' = universeStatus === 'Quarantine' ? 'sell' : 'buy';
            const aligned = universeStatus === 'Untracked'
                ? null
                : (isBuy && !['Quarantine'].includes(universeStatus)) || (!isBuy && universeStatus === 'Quarantine');
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
    }, [data?.plannedTrades, data?.portfolioUniverse, alignmentFilter]);




    const handleAddToUniverse = async (plan: PlannedTrade) => {
        trackAction('add-to-universe', 'Investment Plan');
        try {
            const universe = data?.portfolioUniverse ?? [];
            const exists = universe.some((t: { ticker?: string }) => (t.ticker ?? '').toUpperCase() === (plan.symbol ?? '').toUpperCase());
            if (exists) {
                setAlignmentFilter('All');
                setSymbolFocus(plan.symbol);
                toast(`${plan.symbol} is already in your universe.`, 'info');
                return;
            }

            await addUniverseTicker({
                ticker: (plan.symbol ?? '').toUpperCase(),
                name: plan.name ?? (plan.symbol ?? '').toUpperCase(),
                status: 'Watchlist',
                max_position_weight: 0.1,
            });
            setAlignmentFilter('All');
            setSymbolFocus(plan.symbol);
            toast(`${plan.symbol} added to universe. AI can now track it.`, 'success');
        } catch (error) {
            toast(`Could not add to universe: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };


    const handleAlignWithAi = async (plan: PlannedTrade, suggestedTradeType: 'buy' | 'sell') => {
        trackAction('align-with-ai', 'Investment Plan');
        if (plan.tradeType === suggestedTradeType) return;
        try {
            await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
            setSymbolFocus(plan.symbol);
            toast('Plan aligned with AI recommendation.', 'success');
        } catch (error) {
            toast(`Could not update plan: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const handleAlignAllConflicts = async () => {
        trackAction('align-all-conflicts', 'Investment Plan');
        const conflicts = planAlignment.rows.filter(r => r.aligned === false);
        if (conflicts.length === 0) return;
        
        try {
            for (const { plan, suggestedTradeType } of conflicts) {
                await updatePlannedTrade({ ...plan, tradeType: suggestedTradeType });
            }
            setAlignmentFilter('Aligned');
            toast(`Aligned ${conflicts.length} plan${conflicts.length > 1 ? 's' : ''} with AI.`, 'success');
        } catch (error) {
            toast(`Could not align some plans: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const handleEditNextConflict = () => {
        const nextConflict = planAlignment.filteredRows.find(r => r.aligned === false) || planAlignment.rows.find(r => r.aligned === false);
        if (!nextConflict) return;
        setSymbolFocus(nextConflict.plan.symbol);
        handleOpenPlanModal(nextConflict.plan);
    };



    const strategyGuides = [
        {
            key: 'core',
            title: 'Build over time',
            when: 'For stocks you trust and want to hold long-term.',
            benefit: 'Buy in stages instead of all at once—reduces timing risk.',
            risk: 'Putting too much in one stock.',
            playbook: 'Create Buy plans at target prices. Use High or Medium priority.'
        },
        {
            key: 'tactical',
            title: 'Stay on track',
            when: 'When your mix has drifted from what you want.',
            benefit: 'Keeps your portfolio balanced without guesswork.',
            risk: 'Trading too often can add costs.',
            playbook: 'Check Plan vs AI alignment. Fix conflicts, then execute when ready.'
        },
        {
            key: 'defensive',
            title: 'Reduce risk',
            when: 'For stocks you want to trim or exit.',
            benefit: 'Locks in gains or limits losses before things get worse.',
            risk: 'Selling too early can miss a rebound.',
            playbook: 'Create Sell plans for stocks in quarantine. Add notes for when to reconsider.'
        },
    ] as const;

    const aiPlanCandidates = useMemo(() => {
        const plannedTrades = data?.plannedTrades ?? [];
        const universe = data?.portfolioUniverse ?? [];
        const plannedSymbols = new Set(plannedTrades.map(p => (p.symbol ?? '').toUpperCase()));
        return universe
            .filter((ticker: any) => ['Core', 'High-Upside', 'Quarantine'].includes(ticker.status))
            .filter((ticker: any) => !plannedSymbols.has(String(ticker.ticker || '').toUpperCase()))
            .slice(0, 8)
            .map((ticker: any) => ({
                symbol: String(ticker.ticker || '').toUpperCase(),
                name: ticker.name || ticker.ticker,
                status: ticker.status,
                monthlyWeight: ticker.monthly_weight ?? 0,
                suggestion: ticker.status === 'Quarantine' ? 'sell' as const : 'buy' as const,
            }));
    }, [data?.portfolioUniverse, data?.plannedTrades]);

    const handleCreatePlanFromAi = async (candidate: { symbol: string; name: string; status: string; monthlyWeight: number; suggestion: 'buy' | 'sell' }) => {
        trackAction('create-plan-from-ai', 'Investment Plan');
        trackSuggestionFeedback(`ai-candidate-${candidate.symbol}`, 'Investment Plan', true);
        try {
            const plannedTrades = data?.plannedTrades ?? [];
            const existing = plannedTrades.some(plan => (plan.symbol ?? '').toUpperCase() === candidate.symbol.toUpperCase());
            if (existing) {
                setSymbolFocus(candidate.symbol);
                return;
            }

            const priceAnchor = simulatedPrices[candidate.symbol]?.price || 1;
            if (priceAnchor <= 0) {
                toast(`No price data for ${candidate.symbol}. Add it to your universe first.`, 'error');
                return;
            }

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
            toast(`Plan created for ${candidate.symbol}.`, 'success');
        } catch (error) {
            toast(`Could not create plan: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };

    const visiblePlans = useMemo(() => {
        const plannedTrades = data?.plannedTrades ?? [];
        if (!symbolFocus) return plannedTrades;
        return plannedTrades.filter(plan => (plan.symbol ?? '').toUpperCase() === symbolFocus.toUpperCase());
    }, [data?.plannedTrades, symbolFocus]);

    const isTriggered = (plan: PlannedTrade) => {
        if (plan.status === 'Executed') return false;
        if (plan.conditionType === 'price') {
            const priceInfo = simulatedPrices[plan.symbol];
            if (!priceInfo) return false;
            return (plan.tradeType === 'buy' && priceInfo.price <= (plan.targetValue ?? 0)) || (plan.tradeType === 'sell' && priceInfo.price >= (plan.targetValue ?? 0));
        }
        if (plan.conditionType === 'date') {
            return new Date().getTime() >= (plan.targetValue ?? 0);
        }
        return false;
    }

    return (
        <PageLayout 
            title="Investment Plan" 
            description="Proactively plan your trades based on price or date targets with AI-powered alignment. Integrated with Household, Budget, and Wealth Ultra engines for shared cash and risk constraints."
        >
            <div className="max-w-7xl mx-auto space-y-8">
                <PageIntro
                    title={PAGE_INTROS['Investment Plan']?.title ?? 'Plan your trades ahead of time'}
                    description={PAGE_INTROS['Investment Plan']?.description ?? 'Set buy or sell plans that trigger when a price or date is reached. The system suggests ideas and checks them against AI recommendations.'}
                    tip="New here? Create a plan from an AI candidate below, or click Create Plan to add your own. When conditions are met, use the rocket icon to record the trade."
                />
                <InvestmentPlanControlTower />
                {/* Enhanced Header Section */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex-1">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg">
                                <ClipboardDocumentListIcon className="h-8 w-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-4xl lg:text-5xl font-bold text-slate-900">Investment Plan</h1>
                                <p className="text-xl text-slate-600 mt-2">Strategic trade planning with AI-powered alignment</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <div className="px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-full">
                                <span className="text-sm font-semibold text-blue-700">Smart Planning</span>
                            </div>
                            <div className="px-4 py-2 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-full">
                                <span className="text-sm font-semibold text-purple-700">AI Alignment</span>
                            </div>
                            <div className="px-4 py-2 bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-full">
                                <span className="text-sm font-semibold text-emerald-700">Risk Management</span>
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={() => handleOpenPlanModal(null)} 
                        className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl hover:from-primary/90 hover:to-secondary/90 transition-all duration-200 font-bold text-lg shadow-xl hover:shadow-2xl transform hover:scale-105"
                    >
                        <PlusIcon className="h-6 w-6"/>
                        <span>Create Plan</span>
                    </button>
                </div>

                {/* What to do next — dynamic guidance */}
                {(() => {
                    const plans = data?.plannedTrades ?? [];
                    const triggered = plans.filter(isTriggered);
                    const conflicts = planAlignment.conflictCount;
                    const untracked = planAlignment.untrackedCount;
                    if (plans.length === 0) {
                        return (
                            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-6">
                                <p className="font-semibold text-indigo-900">Your next step</p>
                                <p className="mt-1 text-indigo-800">Create your first plan, or add one from the AI candidates below. Both options pre-fill details for you.</p>
                            </div>
                        );
                    }
                    if (conflicts > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-6">
                                <p className="font-semibold text-amber-900">Resolve conflicts</p>
                                <p className="mt-1 text-amber-800">{conflicts} plan{conflicts > 1 ? 's' : ''} differ from AI recommendations. Use &quot;Align with AI&quot; or &quot;Align All Conflicts&quot; to sync.</p>
                            </div>
                        );
                    }
                    if (triggered.length > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6">
                                <p className="font-semibold text-emerald-900">Ready to act</p>
                                <p className="mt-1 text-emerald-800">{triggered.length} plan{triggered.length > 1 ? 's' : ''} met their conditions. Use the rocket icon to record each trade in Investments.</p>
                            </div>
                        );
                    }
                    if (untracked > 0) {
                        return (
                            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-gray-50 p-6">
                                <p className="font-semibold text-slate-900">Map untracked symbols</p>
                                <p className="mt-1 text-slate-700">{untracked} plan{untracked > 1 ? 's' : ''} use symbols not in your universe. Add them for AI alignment.</p>
                            </div>
                        );
                    }
                    return (
                        <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6">
                            <p className="font-semibold text-emerald-900">All aligned</p>
                            <p className="mt-1 text-emerald-800">Your plans match AI recommendations. When conditions are met, use the rocket icon to record trades.</p>
                        </div>
                    );
                })()}

                {/* Enhanced Household Stress Indicator */}
                {householdStress && (
                    <div className={`rounded-3xl border-2 p-8 shadow-xl backdrop-blur-sm ${
                        householdStress.level === 'low' 
                            ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/90 to-emerald-100/70'
                            : householdStress.level === 'medium'
                            ? 'border-amber-300 bg-gradient-to-br from-amber-50/90 to-amber-100/70'
                            : 'border-rose-300 bg-gradient-to-br from-rose-50/90 to-rose-100/70'
                    }`}>
                        <div className="flex items-start gap-6">
                            <div className={`rounded-2xl p-4 shadow-lg ${
                                householdStress.level === 'low' 
                                    ? 'bg-emerald-100'
                                    : householdStress.level === 'medium'
                                    ? 'bg-amber-100'
                                    : 'bg-rose-100'
                            }`}>
                                <ExclamationTriangleIcon className={`h-8 w-8 ${
                                    householdStress.level === 'low' 
                                        ? 'text-emerald-600'
                                        : householdStress.level === 'medium'
                                        ? 'text-amber-600'
                                        : 'text-rose-600'
                                }`} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-2xl font-bold text-slate-900 mb-2">
                                    Household Cashflow Stress: <span className={`uppercase tracking-wider ${
                                        householdStress.level === 'low' 
                                            ? 'text-emerald-700'
                                            : householdStress.level === 'medium'
                                            ? 'text-amber-700'
                                            : 'text-rose-700'
                                    }`}>{householdStress.level}</span>
                                </h3>
                                <p className="text-lg text-slate-700 leading-relaxed">{householdStress.summary}</p>
                                <div className="mt-4 flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full animate-pulse ${
                                        householdStress.level === 'low' 
                                            ? 'bg-emerald-500'
                                            : householdStress.level === 'medium'
                                            ? 'bg-amber-500'
                                            : 'bg-rose-500'
                                    }`}></div>
                                    <span className="text-sm font-medium text-slate-600">Real-time analysis</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* How It Works — plain language for non-financial users */}
                <CollapsibleSection title="How it works" summary="Plan now, act when ready" className="overflow-hidden">
                    <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl p-8 border border-blue-100">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                                <LightBulbIcon className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900">Plan now, act when ready</h3>
                                <p className="text-slate-600 mt-1">Set your conditions. The system tells you when it&apos;s time to buy or sell.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-red-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">High</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Act first when the condition is met. Use for ideas you don&apos;t want to miss.</p>
                            </div>
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-amber-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">Medium</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Normal pace. Execute when conditions are met and you&apos;re ready.</p>
                            </div>
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-blue-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                                    <h4 className="font-bold text-slate-900 text-lg">Low</h4>
                                </div>
                                <p className="text-slate-600 leading-relaxed">Can wait. Good for ideas you might skip if things get busy.</p>
                            </div>
                        </div>
                        <div className="mt-8 p-6 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-2xl border border-indigo-200">
                            <p className="text-slate-800 font-semibold mb-2">Simple workflow:</p>
                            <p className="text-slate-700 leading-relaxed">
                                Create plans (or add from AI suggestions). Check alignment—if a plan conflicts with AI, use &quot;Align with AI&quot; to sync. When a plan shows &quot;Triggered&quot;, click the rocket to record the trade in Investments.
                            </p>
                        </div>
                    </div>
                </CollapsibleSection>

                {/* Enhanced Strategy Guides */}
                <CollapsibleSection title="Strategy Guides" summary="Core, Tactical, Defensive playbooks" className="overflow-hidden">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {strategyGuides.map((guide) => (
                            <div key={guide.key} className="bg-gradient-to-br from-white to-slate-50 border-2 border-slate-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                                <div className="relative">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className={`rounded-2xl p-3 shadow-lg ${
                                            guide.key === 'core' ? 'bg-gradient-to-br from-blue-100 to-blue-200' :
                                            guide.key === 'tactical' ? 'bg-gradient-to-br from-purple-100 to-purple-200' :
                                            'bg-gradient-to-br from-green-100 to-green-200'
                                        }`}>
                                            {guide.key === 'core' && <TargetIcon className="h-7 w-7 text-blue-700" />}
                                            {guide.key === 'tactical' && <ChartBarIcon className="h-7 w-7 text-purple-700" />}
                                            {guide.key === 'defensive' && <SparklesIcon className="h-7 w-7 text-green-700" />}
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-900">{guide.title}</h3>
                                            <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mt-2 ${
                                                guide.key === 'core' ? 'bg-blue-100 text-blue-800' :
                                                guide.key === 'tactical' ? 'bg-purple-100 text-purple-800' :
                                                'bg-green-100 text-green-800'
                                            }`}>
                                                {guide.key === 'core' ? 'Core' : guide.key === 'tactical' ? 'Tactical' : 'Defensive'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-slate-700 mb-1">When to use:</p>
                                            <p className="text-sm text-slate-600 leading-relaxed">{guide.when}</p>
                                        </div>
                                        <div className="bg-emerald-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-emerald-700 mb-1">Benefit:</p>
                                            <p className="text-sm text-emerald-600 leading-relaxed">{guide.benefit}</p>
                                        </div>
                                        <div className="bg-rose-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-rose-700 mb-1">Risk:</p>
                                            <p className="text-sm text-rose-600 leading-relaxed">{guide.risk}</p>
                                        </div>
                                        <div className="bg-indigo-50 rounded-xl p-4">
                                            <p className="text-sm font-bold text-indigo-700 mb-1">Playbook:</p>
                                            <p className="text-sm text-indigo-600 leading-relaxed">{guide.playbook}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </CollapsibleSection>

                {/* Enhanced AI Candidates Section */}
                <SectionCard title="AI Rebalance Candidates" className="min-h-[500px] overflow-hidden" collapsible collapsibleSummary="Symbols from AI" defaultExpanded>
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                                <SparklesIcon className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900">Quick Add from AI Analysis</h3>
                                <p className="text-slate-600 mt-1">Actionable symbols without existing planned trades</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                            <span className="text-sm font-medium text-purple-600">AI-powered</span>
                        </div>
                    </div>
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-purple-200 scrollbar-track-purple-50">
                        {aiPlanCandidates.map((candidate) => (
                            <div key={candidate.symbol} className="bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border-2 border-purple-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 hover:shadow-lg transition-all duration-300 group">
                                <div className="flex-1">
                                    <div className="flex items-center gap-4 mb-3">
                                        <div className="w-12 h-12 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-xl flex items-center justify-center">
                                            <span className="font-bold text-purple-700 text-lg">{candidate.symbol.slice(0, 2)}</span>
                                        </div>
                                        <div>
                                            <span className="font-bold text-slate-900 text-lg">{candidate.symbol}</span>
                                            <span className="text-slate-400 mx-2">•</span>
                                            <span className="text-slate-700">{candidate.name}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className={`px-3 py-1.5 rounded-full font-bold text-sm ${
                                            candidate.status === 'Core' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                            candidate.status === 'High-Upside' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                                            candidate.status === 'Quarantine' ? 'bg-red-100 text-red-800 border border-red-200' :
                                            'bg-gray-100 text-gray-800 border border-gray-200'
                                        }`}>
                                            {candidate.status}
                                        </span>
                                        <span className="px-3 py-1.5 rounded-full bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 font-bold text-sm border border-green-200">
                                            {candidate.suggestion.toUpperCase()}
                                        </span>
                                        <span className="px-3 py-1.5 rounded-full bg-gradient-to-r from-slate-100 to-gray-100 text-slate-800 font-bold text-sm border border-slate-200">
                                            {(candidate.monthlyWeight * 100).toFixed(1)}% weight
                                        </span>
                                    </div>
                                </div>
                                <button 
                                    type="button" 
                                    onClick={() => handleCreatePlanFromAi(candidate)} 
                                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 font-bold text-sm shadow-lg hover:shadow-xl transform hover:scale-105 whitespace-nowrap"
                                >
                                    Create Plan
                                </button>
                            </div>
                        ))}
                        {aiPlanCandidates.length === 0 && (
                            <EmptyState
                                icon={<SparklesIcon className="w-12 h-12" />}
                                title={EMPTY_STATE_MESSAGES.noAiCandidates.title}
                                description={EMPTY_STATE_MESSAGES.noAiCandidates.description}
                            />
                        )}
                    </div>
                </SectionCard>

                {/* Enhanced Plan vs AI Alignment */}
                <SectionCard title="Plan vs AI Alignment" className="min-h-[600px] overflow-hidden" collapsible collapsibleSummary="Aligned vs conflicts" defaultExpanded>
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                                <ChartBarIcon className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900">Alignment Analysis</h3>
                                <p className="text-slate-600 mt-1">Compare your plans with AI universe recommendations</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-6 bg-white/70 backdrop-blur-sm rounded-2xl px-6 py-3 border border-slate-200 shadow-lg">
                                <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse"></div>
                                    <span className="font-bold text-emerald-700">Aligned: {planAlignment.alignedCount}</span>
                                </span>
                                <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-rose-500 rounded-full animate-pulse"></div>
                                    <span className="font-bold text-rose-700">Conflicts: {planAlignment.conflictCount}</span>
                                </span>
                                <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-slate-500 rounded-full animate-pulse"></div>
                                    <span className="font-bold text-slate-700">Untracked: {planAlignment.untrackedCount}</span>
                                </span>
                            </div>
                            <div className="flex gap-3">
                                <button 
                                    type="button" 
                                    onClick={handleEditNextConflict} 
                                    disabled={planAlignment.conflictCount === 0} 
                                    className="px-6 py-3 text-sm font-bold border-2 border-slate-300 text-slate-700 rounded-xl hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                                >
                                    Edit Next Conflict
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleAlignAllConflicts} 
                                    disabled={planAlignment.conflictCount === 0} 
                                    className="px-6 py-3 text-sm font-bold border-2 border-emerald-300 text-emerald-700 rounded-xl hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                                >
                                    Align All Conflicts
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-3 mb-8">
                        {(['All', 'Aligned', 'Conflict', 'Needs mapping'] as const).map((filter) => (
                            <button 
                                key={filter} 
                                type="button" 
                                onClick={() => setAlignmentFilter(filter)} 
                                className={`px-6 py-3 text-sm font-bold rounded-full border-2 transition-all duration-200 shadow-sm hover:shadow-md ${
                                    alignmentFilter === filter 
                                        ? 'bg-gradient-to-r from-primary to-secondary text-white border-primary shadow-lg transform scale-105' 
                                        : 'bg-white text-slate-700 border-slate-300 hover:border-primary hover:text-primary'
                                }`}
                            >
                                {filter}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4 max-h-96 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-blue-200 scrollbar-track-blue-50">
                        {planAlignment.filteredRows.map(({ plan, universeStatus, recommendation, aligned, reason, suggestedTradeType }) => (
                            <div key={`align-${plan.id}`} className={`border-2 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 hover:shadow-lg transition-all duration-300 ${
                                aligned === true ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/50 to-green-50/30' :
                                aligned === false ? 'border-rose-200 bg-gradient-to-r from-rose-50/50 to-red-50/30' :
                                'border-slate-200 bg-gradient-to-r from-slate-50/50 to-gray-50/30'
                            }`}>
                                <div className="flex-1">
                                    <div className="flex items-center gap-4 mb-3">
                                        <div className="w-12 h-12 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                                            <span className="font-bold text-slate-700 text-lg">{(plan.symbol ?? '').slice(0, 2)}</span>
                                        </div>
                                        <div className="flex-1">
                                            <span className="font-bold text-slate-900 text-lg">{plan.symbol ?? '—'}</span>
                                            <span className="mx-2 text-slate-400">•</span>
                                            <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
                                                plan.tradeType === 'buy' 
                                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                                                    : 'bg-rose-100 text-rose-800 border-rose-200'
                                            }`}>
                                                {plan.tradeType.toUpperCase()}
                                            </span>
                                            <span className={`ml-3 px-3 py-1.5 rounded-full text-xs font-bold border ${
                                                aligned === true ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                                aligned === false ? 'bg-rose-100 text-rose-800 border-rose-200' :
                                                'bg-slate-100 text-slate-800 border-slate-200'
                                            }`}>
                                                {aligned === true ? 'Aligned' : aligned === false ? 'Conflict' : 'Needs mapping'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="bg-white/50 backdrop-blur-sm rounded-xl p-4">
                                            <p className="text-slate-700 font-semibold">
                                                <span className="text-blue-600">Universe:</span> {universeStatus} • {recommendation}
                                            </p>
                                        </div>
                                        <div className="bg-white/50 backdrop-blur-sm rounded-xl p-4">
                                            <p className="text-slate-600 text-sm leading-relaxed">{reason}</p>
                                        </div>
                                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-200">
                                            <p className="text-indigo-800 text-sm font-semibold">
                                                AI suggests: {suggestedTradeType === 'buy' ? 'Accumulation direction preferred' : 'De-risking direction preferred'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-3 self-start sm:self-auto">
                                    <button 
                                        type="button" 
                                        onClick={() => setSymbolFocus(plan.symbol)} 
                                        className="px-4 py-2 text-xs font-bold border-2 border-slate-300 text-slate-700 rounded-lg hover:border-primary hover:text-primary transition-all duration-200 shadow-sm hover:shadow-md"
                                    >
                                        Focus
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => handleOpenPlanModal(plan)} 
                                        className="px-4 py-2 text-xs font-bold border-2 border-slate-300 text-slate-700 rounded-lg hover:border-primary hover:text-primary transition-all duration-200 shadow-sm hover:shadow-md"
                                    >
                                        Edit
                                    </button>
                                    {aligned === false && (
                                        <button 
                                            type="button" 
                                            onClick={() => handleAlignWithAi(plan, suggestedTradeType)} 
                                            title="Change this plan to match the AI recommendation"
                                            className="px-4 py-2 text-xs font-bold border-2 border-emerald-300 text-emerald-700 rounded-lg hover:border-emerald-500 transition-all duration-200 shadow-sm hover:shadow-md"
                                        >
                                            Align with AI
                                        </button>
                                    )}
                                    {aligned === null && (
                                        <button 
                                            type="button" 
                                            onClick={() => handleAddToUniverse(plan)} 
                                            title="Add this symbol to your portfolio so AI can track and recommend it"
                                            className="px-4 py-2 text-xs font-bold border-2 border-indigo-300 text-indigo-700 rounded-lg hover:border-indigo-500 transition-all duration-200 shadow-sm hover:shadow-md"
                                        >
                                            Add to Universe
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {planAlignment.filteredRows.length === 0 && (
                            <EmptyState
                                icon={<ChartBarIcon className="w-12 h-12" />}
                                title={(data?.plannedTrades ?? []).length === 0 ? 'No plans yet' : 'No plans match the filter'}
                                description={(data?.plannedTrades ?? []).length === 0 ? 'Create plans above to see how they align with AI recommendations.' : 'Try a different filter or create new plans.'}
                                action={(data?.plannedTrades ?? []).length === 0 ? { label: 'Create plan', onClick: () => handleOpenPlanModal(null) } : undefined}
                            />
                        )}
                    </div>
                </SectionCard>

                {/* Statistics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 group" title="Plans you've set up">
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-2">Planned</p>
                                <p className="text-4xl font-bold text-blue-900 mb-1">{(data?.plannedTrades ?? []).length}</p>
                                <p className="text-sm text-blue-700 font-medium">Plans you&apos;ve set up</p>
                            </div>
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                <ClipboardDocumentListIcon className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-blue-100">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                <span className="text-xs text-blue-600 font-medium">Active planning</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 group" title="Conditions met—ready to record">
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-bold text-amber-800 uppercase tracking-wide mb-2">Triggered</p>
                                <p className="text-4xl font-bold text-amber-900 mb-1">{(data?.plannedTrades ?? []).filter(isTriggered).length}</p>
                                <p className="text-sm text-amber-700 font-medium">Conditions met—ready to record</p>
                            </div>
                            <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                <ClockIcon className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-amber-100">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                                <span className="text-xs text-amber-600 font-medium">Conditions met</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 group" title="Already recorded in Investments">
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-bold text-emerald-800 uppercase tracking-wide mb-2">Executed</p>
                                <p className="text-4xl font-bold text-emerald-900 mb-1">{(data?.plannedTrades ?? []).filter(p => p.status === 'Executed').length}</p>
                                <p className="text-sm text-emerald-700 font-medium">Recorded in Investments</p>
                            </div>
                            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                <CheckCircleIcon className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-emerald-100">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                <span className="text-xs text-emerald-600 font-medium">Successfully executed</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Enhanced Symbol Focus Indicator */}
                {symbolFocus && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-3xl p-8 shadow-xl">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                                    <TargetIcon className="h-7 w-7 text-white" />
                                </div>
                                <div>
                                    <span className="text-blue-800 font-bold text-lg">
                                        Focused on symbol: <span className="text-2xl font-bold text-blue-900">{symbolFocus.toUpperCase()}</span>
                                    </span>
                                    <p className="text-blue-600 text-sm mt-1">Viewing all plans for this symbol</p>
                                </div>
                            </div>
                            <button 
                                type="button" 
                                onClick={() => setSymbolFocus('')} 
                                className="px-6 py-3 text-sm font-bold border-2 border-blue-300 text-blue-700 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow-md"
                            >
                                Clear Focus
                            </button>
                        </div>
                    </div>
                )}

                {/* Plans Table */}
                <SectionCard title="Investment Plans" className="min-h-[600px]" collapsible collapsibleSummary="Planned trades" defaultExpanded>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    <th className="px-6 py-3">Asset</th>
                                    <th className="px-6 py-3">Action</th>
                                    <th className="px-6 py-3">Trigger</th>
                                    <th className="px-6 py-3" title="Price in the stock's traded currency (USD or SAR)">Planned Price</th>
                                    <th className="px-6 py-3" title="Is the current price good for your plan? Favorable = time to act">Signal</th>
                                    <th className="px-6 py-3">Priority</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {visiblePlans.map(plan => (
                                    <tr key={plan.id} className={`${isTriggered(plan) ? 'bg-yellow-50' : ''} hover:bg-gray-50 transition-colors`}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div>
                                                <div className="font-medium text-gray-900">{plan.symbol ?? '—'}</div>
                                                <div className="text-sm text-gray-500">{plan.name}</div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`font-semibold ${plan.tradeType === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                                                {plan.tradeType.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">{renderCondition(plan)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getPlannedExecutionPrice(plan) ? formatCurrencyString(getPlannedExecutionPrice(plan)!) : '--'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 inline-flex text-xs font-semibold rounded-full ${getPriceSignalClass(plan)}`}>
                                                {getPriceSignalLabel(plan)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${priorityClass(plan.priority)}`}>
                                                {plan.priority}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {plan.status === 'Executed' ? (
                                                <span className="flex items-center gap-1 text-green-600 font-semibold">
                                                    <CheckCircleIcon className="h-4 w-4"/>Executed
                                                </span>
                                            ) : isTriggered(plan) ? (
                                                <span className="flex items-center gap-1 text-yellow-600 font-semibold">
                                                    <ExclamationTriangleIcon className="h-4 w-4"/>Triggered
                                                </span>
                                            ) : (
                                                <span className="text-gray-600">Planned</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => (triggerPageAction ? handleExecutePlan(plan) : onExecutePlan(plan))} 
                                                    disabled={plan.status === 'Executed'} 
                                                    title="Record this trade in Investments" 
                                                    className="p-2 text-white bg-gradient-to-r from-primary to-secondary rounded-lg hover:from-primary/90 hover:to-secondary/90 disabled:from-gray-300 disabled:to-gray-400 transition-all"
                                                >
                                                    <RocketLaunchIcon className="h-4 w-4"/>
                                                </button>
                                                <button 
                                                    onClick={() => handleOpenPlanModal(plan)} 
                                                    className="p-2 text-gray-500 hover:text-primary transition-colors"
                                                    title="Edit Plan"
                                                >
                                                    <PencilIcon className="h-4 w-4"/>
                                                </button>
                                                <button 
                                                    onClick={() => setPlanToDelete(plan)} 
                                                    className="p-2 text-gray-500 hover:text-danger transition-colors"
                                                    title="Delete Plan"
                                                >
                                                    <TrashIcon className="h-4 w-4"/>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {visiblePlans.length === 0 && (
                            <EmptyState
                                icon={<ClipboardDocumentListIcon className="w-12 h-12" />}
                                title={EMPTY_STATE_MESSAGES.noPlannedTrades.title}
                                description={symbolFocus ? 'No plans for this symbol. Clear focus or create one.' : EMPTY_STATE_MESSAGES.noPlannedTrades.description}
                                action={symbolFocus ? undefined : { label: EMPTY_STATE_MESSAGES.noPlannedTrades.action ?? 'Create plan', onClick: () => handleOpenPlanModal(null) }}
                            />
                        )}
                    </div>
                </SectionCard>
            </div>

            <PlanTradeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                planToEdit={planToEdit}
                universe={data?.portfolioUniverse ?? []}
                simulatedPrices={simulatedPrices}
                monthlyBudget={data?.investmentPlan?.monthlyBudget}
            />
            <DeleteConfirmationModal 
                isOpen={!!planToDelete} 
                onClose={() => setPlanToDelete(null)} 
                onConfirm={() => { 
                    if(planToDelete) deletePlannedTrade(planToDelete.id); 
                    setPlanToDelete(null); 
                }} 
                itemName={planToDelete?.name || ''} 
            />
        </PageLayout>
    );
};

export default InvestmentPlanView;