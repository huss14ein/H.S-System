import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Asset, Goal, AssetType, CommodityHolding } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { HomeModernIcon } from '../components/icons/HomeModernIcon';
import { TruckIcon } from '../components/icons/TruckIcon';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { QuestionMarkCircleIcon } from '../components/icons/QuestionMarkCircleIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { LinkIcon } from '../components/icons/LinkIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { BitcoinIcon } from '../components/icons/BitcoinIcon';
import { CubeIcon } from '../components/icons/CubeIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import { getAICommodityPrices, formatAiError } from '../services/geminiService';
import InfoHint from '../components/InfoHint';
import AddMenu from '../components/AddMenu';
import { useAI } from '../context/AiContext';
import SectionCard from '../components/SectionCard';
import PageLayout from '../components/PageLayout';
import DraggableResizableGrid from '../components/DraggableResizableGrid';

// --- Physical Asset Components ---
const AssetModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (asset: Asset) => void; assetToEdit: Asset | null; }> = ({ isOpen, onClose, onSave, assetToEdit }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<AssetType>('Property');
    const [value, setValue] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [isRental, setIsRental] = useState(false);
    const [monthlyRent, setMonthlyRent] = useState('');
    const [owner, setOwner] = useState('');

    React.useEffect(() => {
        if (assetToEdit) {
            setName(assetToEdit.name);
            setType(assetToEdit.type);
            setValue(assetToEdit.value.toString());
            setPurchasePrice(assetToEdit.purchasePrice?.toString() || '');
            setIsRental(assetToEdit.isRental || false);
            setMonthlyRent(assetToEdit.monthlyRent?.toString() || '');
            setOwner(assetToEdit.owner || '');
        } else {
            setName(''); setType('Property'); setValue(''); setPurchasePrice('');
            setIsRental(false); setMonthlyRent(''); setOwner('');
        }
    }, [assetToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newAsset: Asset = {
            id: assetToEdit ? assetToEdit.id : `asset${Date.now()}`,
            name, type, value: parseFloat(value) || 0,
            purchasePrice: parseFloat(purchasePrice) || undefined,
            isRental: type === 'Property' ? isRental : undefined,
            monthlyRent: type === 'Property' && isRental ? parseFloat(monthlyRent) || 0 : undefined,
            goalId: assetToEdit?.goalId, owner: owner || undefined,
        };
        onSave(newAsset); onClose();
    };



    return (
        <Modal isOpen={isOpen} onClose={onClose} title={assetToEdit ? 'Edit Physical Asset' : 'Add Physical Asset'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-sm font-medium text-gray-700 flex items-center">Asset Name <InfoHint text="Name this asset clearly so reports and goal links stay readable." /></label><input type="text" placeholder="Asset Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Asset Type <InfoHint text="Choose the closest type to improve categorization and analytics." /></label><select value={type} onChange={e => setType(e.target.value as AssetType)} required className="select-base">
                    <option value="Property">Property</option>
                    <option value="Vehicle">Vehicle</option>
                    <option value="Other">Other</option>
                </select>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Current Value <InfoHint text="Use your best current market estimate; this affects net worth and allocation insights." /></label><input type="number" placeholder="Current Value" value={value} onChange={e => setValue(e.target.value)} required className="input-base"/>
                <input type="number" placeholder="Purchase Price (optional)" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="input-base"/>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Owner (optional) <InfoHint text="Useful for family-level, multi-user governance and Zakat attribution." /></label><input type="text" placeholder="Owner (e.g., Spouse, Son)" value={owner} onChange={e => setOwner(e.target.value)} className="input-base" />
                {type === 'Property' && (
                    <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center"><input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} className="h-4 w-4 text-primary rounded"/> <span className="ml-2">Is this a rental property?</span></label>
                        {isRental && <input type="number" placeholder="Monthly Rent" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} className="input-base"/>}
                    </div>
                )}
                <button type="submit" className="w-full btn-primary">Save Asset</button>
            </form>
        </Modal>
    );
};
const AssetCardComponent: React.FC<{ asset: Asset; onEdit: (asset: Asset) => void; onDelete: (asset: Asset | CommodityHolding) => void; onLinkGoal: (assetId: string, goalId: string) => void; goals: Goal[] }> = ({ asset, onEdit, onDelete, onLinkGoal, goals }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const getAssetIcon = (type: Asset['type']) => {
        switch (type) {
            case 'Property': return <HomeModernIcon className="h-8 w-8 text-indigo-500" />;
            case 'Vehicle': return <TruckIcon className="h-8 w-8 text-emerald-500" />;
            default: return <QuestionMarkCircleIcon className="h-8 w-8 text-slate-500" />;
        }
    };
    const unrealizedGain = asset.purchasePrice != null ? asset.value - asset.purchasePrice : null;
    const unrealizedGainPct = asset.purchasePrice != null && asset.purchasePrice > 0 && unrealizedGain !== null
        ? (unrealizedGain / asset.purchasePrice) * 100
        : null;
    const borderTone = unrealizedGain === null ? 'border-t-slate-200' : unrealizedGain >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500';
    const linkedGoal = asset.goalId ? goals.find(g => g.id === asset.goalId) : null;
    return (
        <div className={`section-card flex flex-col h-full border-t-4 ${borderTone} hover:shadow-lg transition-shadow`}>
            <div className="flex items-start justify-between gap-2 min-h-[32px]">
                <div className="flex items-center gap-3 min-w-0">
                    {getAssetIcon(asset.type)}
                    <div className="min-w-0">
                        <h3 className="font-semibold text-dark truncate">{asset.name}</h3>
                        <p className="text-xs text-slate-500">{asset.type}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => onEdit(asset)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit asset"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDelete(asset)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete asset"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            {asset.owner && <span className="mt-2 inline-block text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{asset.owner}</span>}
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 min-w-0 overflow-hidden">
                <div><dt className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">Current Value</dt><dd className="metric-value font-bold text-dark text-xl tabular-nums mt-0.5">{formatCurrencyString(asset.value)}</dd></div>
                <div className="grid grid-cols-2 gap-3 text-sm min-w-0">
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Purchase Price</dt><dd className="metric-value font-medium text-slate-700">{asset.purchasePrice ? formatCurrencyString(asset.purchasePrice) : '—'}</dd></div>
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Unrealized G/L</dt><dd className="metric-value font-semibold">{unrealizedGain !== null ? <span>{formatCurrency(unrealizedGain, { colorize: true })}{unrealizedGainPct != null && <span className={unrealizedGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}> ({unrealizedGainPct >= 0 ? '+' : ''}{unrealizedGainPct.toFixed(1)}%)</span>}</span> : '—'}</dd></div>
                </div>
                {asset.isRental && asset.monthlyRent != null && <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Monthly Rent</dt><dd className="metric-value font-semibold text-dark">{formatCurrencyString(asset.monthlyRent)}</dd></div>}
            </div>
            <div className="border-t mt-4 pt-4 flex items-center justify-between gap-2 flex-wrap">
                {linkedGoal ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><LinkIcon className="h-4 w-4 mr-1.5" />{linkedGoal.name}</span> : <span className="text-xs text-slate-400">Not linked</span>}
                <select value={asset.goalId || 'none'} onChange={(e) => onLinkGoal(asset.id, e.target.value)} className="text-xs border border-slate-300 rounded-lg shadow-sm focus:ring-primary focus:border-primary py-1.5 pl-2 pr-7" aria-label={`Link ${asset.name} to a goal`}>
                    <option value="none">Link to goal...</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            </div>
        </div>
    );
};
// --- End Physical Asset Components ---

// --- Commodity Components ---
const CommodityHoldingModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => Promise<void>; holdingToEdit: CommodityHolding | null; goals: Goal[]; }> = ({ isOpen, onClose, onSave, holdingToEdit, goals }) => {
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [purchaseValue, setPurchaseValue] = useState('');
    const [currentValue, setCurrentValue] = useState('');
    const [zakahClass, setZakahClass] = useState<CommodityHolding['zakahClass']>('Zakatable');
    const [owner, setOwner] = useState('');
    const [goalId, setGoalId] = useState<string | undefined>(undefined);
    const [formError, setFormError] = useState<string | null>(null);
    const [diagnosticReport, setDiagnosticReport] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    useEffect(() => {
        if (holdingToEdit) {
            setName(holdingToEdit.name); setQuantity(String(holdingToEdit.quantity)); setUnit(holdingToEdit.unit);
            setPurchaseValue(String(holdingToEdit.purchaseValue)); setCurrentValue(String(holdingToEdit.currentValue));
            setZakahClass(holdingToEdit.zakahClass); setOwner(holdingToEdit.owner || ''); setGoalId(holdingToEdit.goalId);
        } else {
            setName('Gold'); setQuantity(''); setUnit('gram'); setPurchaseValue(''); setCurrentValue(''); setZakahClass('Zakatable'); setOwner(''); setGoalId(undefined);
        }
        setFormError(null);
        setDiagnosticReport(null);
        setCopied(false);
    }, [holdingToEdit, isOpen]);

    useEffect(() => {
        if (name === 'Gold' || name === 'Silver') setUnit('gram');
        else if (name === 'Bitcoin') setUnit('BTC');
        else setUnit('unit');
    }, [name]);

    const getSymbol = (name: CommodityHolding['name'], unit: CommodityHolding['unit']) => {
        if (name === 'Gold') return unit === 'gram' ? 'XAU_GRAM' : 'XAU_OUNCE';
        if (name === 'Silver') return unit === 'gram' ? 'XAG_GRAM' : 'XAG_OUNCE';
        if (name === 'Bitcoin') return 'BTC_USD';
        return 'OTHER';
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        setDiagnosticReport(null);
        setCopied(false);

        const parsedQuantity = parseFloat(quantity);
        const parsedPurchaseValue = parseFloat(purchaseValue);
        const parsedCurrentValue = parseFloat(currentValue);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            setFormError('Quantity must be a positive number.');
            return;
        }
        if (!Number.isFinite(parsedPurchaseValue) || parsedPurchaseValue <= 0) {
            setFormError('Purchase value must be greater than 0.');
            return;
        }
        if (!Number.isFinite(parsedCurrentValue) || parsedCurrentValue < 0) {
            setFormError('Current value cannot be negative.');
            return;
        }

        const holdingData = {
            name,
            quantity: parsedQuantity,
            unit,
            purchaseValue: parsedPurchaseValue,
            currentValue: parsedCurrentValue,
            symbol: getSymbol(name, unit),
            zakahClass,
            owner: owner || undefined,
            goalId,
        };

        try {
            setIsSubmitting(true);
            if (holdingToEdit) await onSave({ ...holdingToEdit, ...holdingData });
            else await onSave(holdingData);
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setFormError(message);
            const missing = message.match(/Missing column detected:\s*([a-zA-Z0-9_]+)/i)?.[1];
            const variantCount = message.match(/Tried\s*(\d+)\s*payload variants?/i)?.[1];
            const reportLines = [
                `Commodity save failed at ${new Date().toISOString()}`,
                `Operation: ${holdingToEdit ? 'Update' : 'Insert'}`,
                `Commodity: ${name}`,
                `Symbol: ${getSymbol(name, unit)}`,
                `Message: ${message}`,
            ];
            if (missing) reportLines.push(`Likely missing DB column: ${missing}`);
            if (variantCount) reportLines.push(`Attempted payload variants: ${variantCount}`);
            setDiagnosticReport(reportLines.join('\n'));
        } finally {
            setIsSubmitting(false);
        }
    };



    const recoveryHints = useMemo(() => {
        if (!formError) return [] as string[];
        const message = formError.toLowerCase();
        const hints: string[] = [];
        if (message.includes('missing column')) {
            hints.push('Apply the latest unified DB migration file and refresh Supabase schema cache.');
        }
        if (message.includes('owner')) {
            hints.push('Your commodity table may not include the owner column. Keep Owner blank or add the column in DB.');
        }
        if (message.includes('purchase_value') || message.includes('current_value') || message.includes('zakah_class')) {
            hints.push('Schema naming mismatch detected. Ensure snake_case and/or camelCase variants exist per your deployment strategy.');
        }
        if (message.includes('payload variants')) {
            hints.push('Multiple fallback payloads were attempted. Use the copied diagnostic report to identify unsupported column names.');
        }
        if (hints.length === 0) {
            hints.push('Retry after refreshing data. If it fails again, share the diagnostic report with support.');
        }
        return hints;
    }, [formError]);


    const canAutoFixOwnerIssue = useMemo(() => {
        if (!formError) return false;
        return formError.toLowerCase().includes('owner');
    }, [formError]);

    const handleClearOwnerForRetry = () => {
        setOwner('');
        setFormError(null);
        setDiagnosticReport(null);
        setCopied(false);
    };

    const handleCopyDiagnosticReport = async () => {
        if (!diagnosticReport) return;
        try {
            await navigator.clipboard.writeText(diagnosticReport);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={holdingToEdit ? 'Edit Commodity' : 'Add Commodity'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <select value={name} onChange={e => setName(e.target.value as any)} className="w-full p-2 border rounded-md"><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bitcoin">Bitcoin</option><option value="Other">Other</option></select>
                <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /><select value={unit} onChange={e => setUnit(e.target.value as any)} className="w-full p-2 border rounded-md">{name === 'Gold' || name === 'Silver' ? <> <option value="gram">grams</option> <option value="ounce">ounces</option> </> : name === 'Bitcoin' ? <option value="BTC">BTC</option> : <option value="unit">units</option>}</select></div>
                <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Purchase Value" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /><input type="number" placeholder="Current Value" value={currentValue} onChange={e => setCurrentValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Owner <InfoHint text="Optional ownership label for shared/family tracking." /></label><input type="text" placeholder="e.g., Spouse, Son" value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full p-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Zakat Classification <InfoHint text="Mark whether this holding should be included in zakat calculation." /></label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="mt-1 w-full p-2 border border-gray-300 rounded-md"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <div><label className="block text-sm font-medium text-gray-700">Link to Goal <InfoHint text="Connect this commodity to a goal so goal progress includes it." /></label><select value={goalId || 'none'} onChange={(e) => setGoalId(e.target.value === 'none' ? undefined : e.target.value)} className="mt-1 w-full p-2 border rounded-md"><option value="none">Not linked</option>{goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                {formError && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded p-2">{formError}</p>}
                {diagnosticReport && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="font-semibold">Diagnostic Report</p>
                            <button type="button" onClick={handleCopyDiagnosticReport} className="px-2 py-1 border rounded text-amber-800 border-amber-300 hover:border-amber-500">{copied ? 'Copied' : 'Copy report'}</button>
                        </div>
                        <pre className="whitespace-pre-wrap font-mono">{diagnosticReport}</pre>
                    </div>
                )}
                {recoveryHints.length > 0 && (
                    <div className="text-xs bg-blue-50 border border-blue-200 rounded p-3 text-blue-900">
                        <ul className="list-disc pl-5 space-y-1">
                            {recoveryHints.map((hint, i) => <li key={i}>{hint}</li>)}
                        </ul>
                        {canAutoFixOwnerIssue && (
                            <button
                                type="button"
                                onClick={handleClearOwnerForRetry}
                                className="mt-2 px-2 py-1 border rounded text-blue-800 border-blue-300 hover:border-blue-500"
                            >
                                Apply owner-safe retry
                            </button>
                        )}
                    </div>
                )}
                <button type="submit" disabled={isSubmitting} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">{isSubmitting ? 'Saving...' : 'Save'}</button>
            </form>
        </Modal>
    );
};
const CommodityHoldingCard: React.FC<{ holding: CommodityHolding; onEdit: (h: CommodityHolding) => void; onDelete: (h: Asset | CommodityHolding) => void; goals: Goal[]; onLinkGoal: (holdingId: string, goalId: string) => void }> = ({ holding, onEdit, onDelete, goals, onLinkGoal }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const unrealizedGain = holding.currentValue - holding.purchaseValue;
    const unrealizedGainPct = holding.purchaseValue > 0 ? (unrealizedGain / holding.purchaseValue) * 100 : null;
    const borderTone = unrealizedGain >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500';
    const getIcon = (type: CommodityHolding['name']) => {
        switch (type) {
            case 'Gold': return <GoldBarIcon className="h-8 w-8 text-amber-500 flex-shrink-0" />;
            case 'Silver': return <GoldBarIcon className="h-8 w-8 text-slate-400 flex-shrink-0" />;
            case 'Bitcoin': return <BitcoinIcon className="h-8 w-8 text-orange-500 flex-shrink-0" />;
            default: return <CubeIcon className="h-8 w-8 text-slate-500 flex-shrink-0" />;
        }
    };
    return (
        <div className={`section-card flex flex-col min-w-0 border-t-4 ${borderTone} hover:shadow-lg transition-shadow rounded-xl overflow-visible`}>
            <div className="flex items-start justify-between gap-2 min-h-[40px]">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {getIcon(holding.name)}
                    <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-dark break-words">{holding.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{holding.quantity} {holding.unit}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => onEdit(holding)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit commodity"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDelete(holding)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete commodity"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            {holding.owner && <span className="mt-2 inline-block text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full w-fit">{holding.owner}</span>}
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3 min-w-0 overflow-hidden">
                <div>
                    <dt className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">Current Value</dt>
                    <dd className="metric-value font-bold text-dark text-xl tabular-nums mt-0.5">{formatCurrencyString(holding.currentValue)}</dd>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm min-w-0">
                    <div className="min-w-0 overflow-hidden">
                        <dt className="metric-label text-slate-500 text-xs">Purchase Value</dt>
                        <dd className="metric-value font-medium text-slate-700">{formatCurrencyString(holding.purchaseValue)}</dd>
                    </div>
                    <div className="min-w-0 overflow-hidden">
                        <dt className="metric-label text-slate-500 text-xs">Unrealized G/L</dt>
                        <dd className="metric-value font-semibold whitespace-nowrap"><span>{formatCurrency(unrealizedGain, { colorize: true })}</span>{unrealizedGainPct != null && <span className={unrealizedGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}> ({unrealizedGain >= 0 ? '+' : ''}{unrealizedGainPct.toFixed(1)}%)</span>}</dd>
                    </div>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                <dt className="metric-label text-slate-500 text-xs">Link to goal</dt>
                <dd>
                    <select value={holding.goalId || 'none'} onChange={(e) => onLinkGoal(holding.id, e.target.value)} className="w-full text-sm border border-slate-300 rounded-lg shadow-sm focus:ring-primary focus:border-primary py-2 pl-2 pr-8 min-w-0" aria-label={`Link ${holding.name} to goal`}>
                        <option value="none">Not linked</option>
                        {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                </dd>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
                <span className={`inline-block px-2.5 py-1 text-xs font-semibold rounded-full ${holding.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>{holding.zakahClass}</span>
            </div>
        </div>
    );
};
// --- End Commodity Components ---

interface AssetsProps { pageAction?: string | null; clearPageAction?: () => void; }

const Assets: React.FC<AssetsProps> = ({ pageAction, clearPageAction }) => {
    const { data, addAsset, updateAsset, deleteAsset, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const { formatCurrencyString } = useFormatCurrency();
    
    // State for both types of modals
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
    const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
    const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Asset | CommodityHolding | null>(null);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);

    useEffect(() => {
        if (pageAction === 'open-asset-modal') {
            handleOpenAssetModal();
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    const { totalAssetValue, totalPhysicalAssetValue, totalCommodityValue, totalRentalIncome } = useMemo(() => {
        const physicalValue = data.assets.reduce((sum, asset) => sum + asset.value, 0);
        const commodityValue = data.commodityHoldings.reduce((sum, h) => sum + h.currentValue, 0);
        const rentalIncome = data.assets.filter(a => a.isRental && a.monthlyRent).reduce((sum, a) => sum + a.monthlyRent!, 0);
        return { totalAssetValue: physicalValue + commodityValue, totalPhysicalAssetValue: physicalValue, totalCommodityValue: commodityValue, totalRentalIncome: rentalIncome };
    }, [data.assets, data.commodityHoldings]);

    // Physical Asset Handlers
    const handleOpenAssetModal = (asset: Asset | null = null) => { setAssetToEdit(asset); setIsAssetModalOpen(true); };
    const handleSaveAsset = (asset: Asset) => { if (data.assets.some(a => a.id === asset.id)) updateAsset(asset); else addAsset(asset); };
    const handleLinkGoal = (assetId: string, goalId: string) => { const asset = data.assets.find(a => a.id === assetId); if (asset) updateAsset({ ...asset, goalId: goalId === 'none' ? undefined : goalId }); };
    const handleLinkCommodityGoal = (holdingId: string, goalId: string) => {
        const holding = data.commodityHoldings.find((h) => h.id === holdingId);
        if (holding) updateCommodityHolding({ ...holding, goalId: goalId === 'none' ? undefined : goalId });
    };
    
    // Commodity Handlers
    const handleOpenCommodityModal = (holding: CommodityHolding | null = null) => { setCommodityToEdit(holding); setIsCommodityModalOpen(true); };
    const handleSaveCommodity = async (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => {
        if ('id' in holding) await updateCommodityHolding(holding);
        else await addCommodityHolding(holding);
    };

    // Generic Delete Handlers
    const handleOpenDeleteModal = (item: Asset | CommodityHolding) => { setItemToDelete(item); };
    const handleConfirmDelete = () => { if(itemToDelete) { ('unit' in itemToDelete ? deleteCommodityHolding(itemToDelete.id) : deleteAsset(itemToDelete.id)); setItemToDelete(null); } };
    
    const handleUpdatePrices = async () => {
        if (data.commodityHoldings.length === 0) return;
        setIsUpdatingPrices(true);
        setGroundingChunks([]);
        try {
            const { prices, groundingChunks: chunks } = await getAICommodityPrices(data.commodityHoldings.map(c => ({ symbol: c.symbol, name: c.name })));
            if (chunks) {
                setGroundingChunks(chunks);
            }
            if (prices.length > 0) {
                const match = (p: { symbol: string }, h: CommodityHolding) => (p.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase();
                const updates = data.commodityHoldings.map(h => { const p = prices.find(pr => match(pr, h)); return p ? { id: h.id, currentValue: p.price * h.quantity } : null; }).filter((u): u is { id: string; currentValue: number; } => u !== null);
                if (updates.length > 0) await batchUpdateCommodityHoldingValues(updates);
            }
        } catch (error) {
            console.error("Failed to update prices:", error);
            alert(`Failed to update commodity prices. Crypto/metals use Finnhub when AI is unavailable.\n\n${formatAiError(error)}`);
        } 
        finally { setIsUpdatingPrices(false); }
    };


    const orderedAssets = useMemo(() => [...data.assets].sort((a, b) => a.name.localeCompare(b.name)), [data.assets]);
    const orderedCommodities = useMemo(() => [...data.commodityHoldings].sort((a, b) => (a.name || '').localeCompare(b.name || '')), [data.commodityHoldings]);

    const addActions = [
        { label: 'Physical Asset', icon: HomeModernIcon, onClick: () => handleOpenAssetModal() },
        { label: 'Commodity', icon: CubeIcon, onClick: () => handleOpenCommodityModal() }
    ];

    return (
        <PageLayout title="Assets" description="Physical assets, metals, and crypto. Link to goals and use Update Prices for current commodity values." action={<AddMenu actions={addActions} />}>

            <DraggableResizableGrid
                layoutKey="assets-summary"
                itemOverflowY="visible"
                items={[
                    { id: 'total', content: <Card title="Total Asset Value" value={formatCurrencyString(totalAssetValue)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Sum of physical assets and metals/crypto." />, defaultW: 3, defaultH: 1, minW: 2, minH: 1 },
                    { id: 'physical', content: <Card title="Physical Asset Value" value={formatCurrencyString(totalPhysicalAssetValue)} indicatorColor="green" valueColor="text-indigo-700" icon={<HomeModernIcon className="h-5 w-5 text-indigo-600" />} tooltip="Total value of physical assets (property, vehicles, etc.)." />, defaultW: 3, defaultH: 1, minW: 2, minH: 1 },
                    { id: 'metals-crypto', content: <Card title="Metals & Crypto Value" value={formatCurrencyString(totalCommodityValue)} indicatorColor="yellow" valueColor="text-amber-700" icon={<CubeIcon className="h-5 w-5 text-amber-600" />} tooltip="Current value of metals and crypto holdings." />, defaultW: 3, defaultH: 1, minW: 2, minH: 1 },
                    { id: 'rental', content: <Card title="Monthly Rental Income" value={formatCurrencyString(totalRentalIncome)} indicatorColor="green" valueColor="text-teal-700" icon={<BanknotesIcon className="h-5 w-5 text-teal-600" />} tooltip="Estimated monthly rental income from physical assets." />, defaultW: 3, defaultH: 1, minW: 2, minH: 1 },
                ]}
                cols={12}
                rowHeight={100}
            />

            <SectionCard title="Physical Assets" className="overflow-visible">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
                    {orderedAssets.map((asset) => (
                        <AssetCardComponent key={asset.id} asset={asset} onEdit={handleOpenAssetModal} onDelete={handleOpenDeleteModal} onLinkGoal={handleLinkGoal} goals={data.goals} />
                    ))}
                    {data.assets.length === 0 && <p className="empty-state md:col-span-2 xl:col-span-3">No physical assets added yet.</p>}
                </div>
            </SectionCard>

            <SectionCard
                title="Metals & Crypto"
                className="overflow-visible"
                headerAction={
                    <button
                        type="button"
                        onClick={handleUpdatePrices}
                        disabled={isUpdatingPrices || !isAiAvailable || data.commodityHoldings.length === 0}
                        title={!isAiAvailable ? "AI features are disabled" : (data.commodityHoldings.length === 0 ? "Add a commodity to update prices" : "Update prices")}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <SparklesIcon className="h-4 w-4" />
                        {isUpdatingPrices ? 'Updating...' : 'Update Prices'}
                    </button>
                }
            >
                <div className="mb-4 rounded-lg bg-slate-50/80 border border-slate-200 p-3 sm:p-4 min-w-0 overflow-x-hidden">
                    <p className="text-sm text-slate-700 leading-relaxed">
                        Track gold, silver, bitcoin and other commodities. Use <strong>Update Prices</strong> to fetch current values from AI or fallback APIs (Finnhub/Stooq).
                        <InfoHint text="Pricing uses AI when available; otherwise Finnhub or Stooq. If one provider fails, the system retries with alternatives." />
                    </p>
                </div>
                {!isAiAvailable && data.commodityHoldings.length > 0 && (
                    <div className="alert-warning mb-4 rounded-lg">
                        <p>AI is disabled. Prices will be updated from Finnhub (crypto & metals) when available.</p>
                    </div>
                )}
                {groundingChunks.length > 0 && (
                    <div className="text-xs text-gray-500 mb-4 p-3 bg-gray-50 rounded-lg border border-slate-200">
                        <p className="font-semibold text-gray-700 mb-1">Sources</p>
                        <ul className="list-disc pl-5 space-y-0.5">
                            {groundingChunks.map((chunk, index) => (
                                chunk.web && <li key={index}><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{chunk.web.title || chunk.web.uri}</a></li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
                    {orderedCommodities.map((h) => (
                        <CommodityHoldingCard key={h.id} holding={h} goals={data.goals} onLinkGoal={handleLinkCommodityGoal} onEdit={handleOpenCommodityModal} onDelete={handleOpenDeleteModal} />
                    ))}
                    {data.commodityHoldings.length === 0 && <p className="empty-state col-span-full py-8 text-center text-slate-500">No metals or crypto added yet. Use the menu above to add a commodity.</p>}
                </div>
            </SectionCard>
            
            <AssetModal isOpen={isAssetModalOpen} onClose={() => setIsAssetModalOpen(false)} onSave={handleSaveAsset} assetToEdit={assetToEdit} />
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} goals={data.goals} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </PageLayout>
    );
};

export default Assets;