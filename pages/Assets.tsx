import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { Asset, Goal, AssetType, CommodityHolding, Page } from '../types';
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
import OwnerBadge from '../components/OwnerBadge';
import PageActionsDropdown from '../components/PageActionsDropdown';
import { useAI } from '../context/AiContext';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import PageLayout from '../components/PageLayout';
import { useSelfLearning } from '../context/SelfLearningContext';
import { parseMoneyInput, roundMoney, roundQuantity } from '../utils/money';
import { fetchLiveCommodityValueSar } from '../utils/commodityLiveValue';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import AIAdvisor from '../components/AIAdvisor';

// --- Physical Asset Components ---
const AssetModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (asset: Asset) => void; assetToEdit: Asset | null; preferredType?: AssetType; }> = ({ isOpen, onClose, onSave, assetToEdit, preferredType = 'Property' }) => {
    const { getLearnedDefault, trackFormDefault } = useSelfLearning();
    const [name, setName] = useState('');
    const [type, setType] = useState<AssetType>('Property');
    const [value, setValue] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [isRental, setIsRental] = useState(false);
    const [monthlyRent, setMonthlyRent] = useState('');
    const [owner, setOwner] = useState('');
    const [issueDate, setIssueDate] = useState('');
    const [maturityDate, setMaturityDate] = useState('');
    const [notes, setNotes] = useState('');
    const [formError, setFormError] = useState<string | null>(null);

    React.useEffect(() => {
        if (assetToEdit) {
            setName(assetToEdit.name);
            setType(assetToEdit.type);
            setValue(assetToEdit.value.toString());
            setPurchasePrice(assetToEdit.purchasePrice?.toString() || '');
            setIsRental(assetToEdit.isRental || false);
            setMonthlyRent(assetToEdit.monthlyRent?.toString() || '');
            setOwner(assetToEdit.owner || '');
            setIssueDate(assetToEdit.issueDate ?? '');
            setMaturityDate(assetToEdit.maturityDate ?? '');
            setNotes(assetToEdit.notes ?? '');
        } else {
            const learnedType = getLearnedDefault('asset-add', 'type') as AssetType | undefined;
            const validTypes: AssetType[] = ['Sukuk', 'Property', 'Vehicle', 'Other'];
            setName('');
            setType(learnedType && validTypes.includes(learnedType) ? learnedType : preferredType);
            setValue('');
            setPurchasePrice('');
            setIsRental(false);
            setMonthlyRent('');
            setOwner('');
            setIssueDate('');
            setMaturityDate('');
            setNotes('');
        }
        setFormError(null);
    }, [assetToEdit, isOpen, preferredType, getLearnedDefault]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        const parsedValue = parseMoneyInput(value);
        const parsedPurchasePrice = purchasePrice.trim() !== '' ? parseMoneyInput(purchasePrice) : undefined;
        const parsedMonthlyRent = type === 'Property' && isRental ? parseMoneyInput(monthlyRent) : undefined;
        if (!name.trim()) {
            setFormError('Asset name is required.');
            return;
        }
        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
            setFormError('Current value must be a non-negative number.');
            return;
        }
        if (parsedPurchasePrice != null && (!Number.isFinite(parsedPurchasePrice) || parsedPurchasePrice < 0)) {
            setFormError('Purchase price must be a non-negative number.');
            return;
        }
        if (type === 'Property' && isRental && (parsedMonthlyRent == null || !Number.isFinite(parsedMonthlyRent) || parsedMonthlyRent < 0)) {
            setFormError('Monthly rent must be a non-negative number.');
            return;
        }
        if (type === 'Sukuk') {
            const issueMs = issueDate ? new Date(issueDate).getTime() : Number.NaN;
            const maturityMs = maturityDate ? new Date(maturityDate).getTime() : Number.NaN;
            if (!issueDate || Number.isNaN(issueMs)) {
                setFormError('Issue / subscription date is required and must be valid.');
                return;
            }
            if (!maturityDate || Number.isNaN(maturityMs)) {
                setFormError('Maturity date is required and must be valid.');
                return;
            }
            if (maturityMs < issueMs) {
                setFormError('Maturity date cannot be before issue date.');
                return;
            }
        }
        const newAsset: Asset = {
            id: assetToEdit ? assetToEdit.id : `asset${Date.now()}`,
            name: name.trim(), type, value: parsedValue,
            purchasePrice: parsedPurchasePrice,
            isRental: type === 'Property' ? isRental : undefined,
            monthlyRent: parsedMonthlyRent,
            goalId: assetToEdit?.goalId, owner: owner.trim() || undefined,
            issueDate: type === 'Sukuk' && issueDate.trim() !== '' ? issueDate.trim().slice(0, 10) : undefined,
            maturityDate: type === 'Sukuk' && maturityDate.trim() !== '' ? maturityDate.trim().slice(0, 10) : undefined,
            notes: notes.trim() !== '' ? notes.trim() : undefined,
        };
        onSave(newAsset);
        if (!assetToEdit) trackFormDefault('asset-add', 'type', type);
        onClose();
    };



    return (
        <Modal isOpen={isOpen} onClose={onClose} title={assetToEdit ? 'Edit Physical Asset' : 'Add Physical Asset'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-sm font-medium text-gray-700 flex items-center">Asset Name <InfoHint text="Name this asset clearly so reports and goal links stay readable." hintId="asset-name" hintPage="Assets" /></label><input type="text" placeholder="Asset Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Asset Type <InfoHint text="Choose the closest type to improve categorization and analytics." hintId="asset-type" hintPage="Assets" /></label><select value={type} onChange={e => setType(e.target.value as AssetType)} required className="select-base">
                    <option value="Sukuk">Sukuk (Islamic fixed income)</option>
                    <option value="Property">Property</option>
                    <option value="Vehicle">Vehicle</option>
                    <option value="Other">Other</option>
                </select>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Current Value <InfoHint text="Use your best current market estimate; this affects net worth and allocation insights." /></label><input type="number" min="0" step="any" placeholder="Current Value" value={value} onChange={e => setValue(e.target.value)} required className="input-base"/>
                <input type="number" min="0" step="any" placeholder="Purchase Price (optional)" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="input-base"/>
                <label className="block text-sm font-medium text-gray-700 flex items-center">Owner (optional) <InfoHint text="Leave blank for your own (counts in My net worth). Set e.g. Father for managed wealth (excluded from your net worth)." /></label><input type="text" placeholder="Owner (e.g., Father, Spouse) or leave blank for yours" value={owner} onChange={e => setOwner(e.target.value)} className="input-base" />
                {type === 'Sukuk' && (
                    <div className="space-y-3 border-t border-sky-100 pt-4 rounded-lg bg-sky-50/40 px-3 py-3">
                        <p className="text-xs font-semibold text-sky-900">Sukuk dates (required)</p>
                        <label className="block text-sm font-medium text-gray-700">Issue / subscription date</label>
                        <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className="input-base" aria-required />
                        <label className="block text-sm font-medium text-gray-700">Maturity date</label>
                        <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} required className="input-base" aria-required />
                    </div>
                )}
                {type === 'Property' && (
                    <div className="space-y-2 border-t pt-4">
                        <label className="flex items-center"><input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} className="h-4 w-4 text-primary rounded"/> <span className="ml-2">Is this a rental property?</span></label>
                        {isRental && <input type="number" min="0" step="any" placeholder="Monthly Rent" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} className="input-base"/>}
                    </div>
                )}
                <div className="border-t border-slate-200 pt-4">
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1" htmlFor="asset-notes">
                        Notes <span className="text-slate-400 font-normal">(optional)</span>
                        <InfoHint text="Deed or account reference, location, insurance policy, condition, co-owners, or any context you want on record." hintId="asset-notes" hintPage="Assets" />
                    </label>
                    <textarea
                        id="asset-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add details…"
                        rows={4}
                        maxLength={5000}
                        className="input-base mt-1 min-h-[96px] resize-y"
                    />
                    <p className="text-xs text-slate-500 mt-1">{notes.length} / 5000</p>
                </div>
                {formError && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded p-2">{formError}</p>}
                <button type="submit" className="w-full btn-primary">Save Asset</button>
            </form>
        </Modal>
    );
};
const AssetCardComponent: React.FC<{ asset: Asset; onEdit: (asset: Asset) => void; onDelete: (asset: Asset | CommodityHolding) => void; onLinkGoal: (assetId: string, goalId: string) => void; goals: Goal[] }> = ({ asset, onEdit, onDelete, onLinkGoal, goals }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const getAssetIcon = (type: Asset['type']) => {
        switch (type) {
            case 'Sukuk': return <BanknotesIcon className="h-8 w-8 text-sky-600" />;
            case 'Property': return <HomeModernIcon className="h-8 w-8 text-indigo-500" />;
            case 'Vehicle': return <TruckIcon className="h-8 w-8 text-emerald-500" />;
            default: return <QuestionMarkCircleIcon className="h-8 w-8 text-slate-500" />;
        }
    };
    const v = roundMoney(asset.value);
    const pp = asset.purchasePrice != null ? roundMoney(asset.purchasePrice) : null;
    const unrealizedGain = pp != null ? roundMoney(v - pp) : null;
    const unrealizedGainPct = pp != null && pp > 0 && unrealizedGain !== null ? (unrealizedGain / pp) * 100 : null;
    const borderTone = unrealizedGain === null ? 'border-t-slate-200' : unrealizedGain >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500';
    const linkedGoal = asset.goalId ? goals.find(g => g.id === asset.goalId) : null;
    return (
        <div className={`section-card flex flex-col h-full border-t-4 ${borderTone} hover:shadow-lg transition-shadow min-h-[290px]`}>
            <div className="flex items-start justify-between gap-2 min-h-[32px]">
                <div className="flex items-center gap-3 min-w-0">
                    {getAssetIcon(asset.type)}
                    <div className="min-w-0">
                        <h3 className="font-semibold text-dark break-words">{asset.name}</h3>
                        <p className="text-xs text-slate-500">{asset.type === 'Sukuk' ? 'Sukuk (Islamic fixed income)' : asset.type}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => onEdit(asset)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit asset"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDelete(asset)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete asset"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            <OwnerBadge owner={asset.owner} className="mt-2" />
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 min-w-0 overflow-hidden">
                <div><dt className="metric-label text-xs font-medium text-slate-500 uppercase tracking-wide">Current Value</dt><dd className="metric-value font-bold text-dark text-xl tabular-nums mt-0.5">{formatCurrencyString(asset.value)}</dd></div>
                <div className="grid grid-cols-2 gap-3 text-sm min-w-0">
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Purchase Price</dt><dd className="metric-value font-medium text-slate-700">{asset.purchasePrice ? formatCurrencyString(asset.purchasePrice) : '—'}</dd></div>
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Unrealized G/L</dt><dd className="metric-value font-semibold whitespace-nowrap">{unrealizedGain !== null ? <span>{formatCurrency(unrealizedGain, { colorize: true })}{unrealizedGainPct != null && <span className={unrealizedGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}> ({unrealizedGainPct >= 0 ? '+' : ''}{unrealizedGainPct.toFixed(1)}%)</span>}</span> : '—'}</dd></div>
                </div>
                {asset.type === 'Sukuk' && <div className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-2 py-1">Tracked as Shariah-compliant fixed income in your asset allocation.</div>}
                {asset.isRental && asset.monthlyRent != null && <div className="min-w-0 overflow-hidden"><dt className="metric-label text-slate-500">Monthly Rent</dt><dd className="metric-value font-semibold text-dark">{formatCurrencyString(asset.monthlyRent)}</dd></div>}
                {asset.notes && asset.notes.trim() !== '' && (
                    <div className="mt-3 pt-3 border-t border-slate-100 min-w-0">
                        <dt className="metric-label text-slate-500 text-xs mb-1">Notes</dt>
                        <dd className="text-sm text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{asset.notes}</dd>
                    </div>
                )}
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
const CommodityHoldingModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => Promise<void>; holdingToEdit: CommodityHolding | null; goals: Goal[]; sarPerUsd: number; }> = ({ isOpen, onClose, onSave, holdingToEdit, goals, sarPerUsd }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [goldKarat, setGoldKarat] = useState<NonNullable<CommodityHolding['goldKarat']>>(24);
    const [purchaseValue, setPurchaseValue] = useState('');
    /** Manual current value only when commodity is "Other" (no market symbol). */
    const [otherCurrentValue, setOtherCurrentValue] = useState('');
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
            setGoldKarat((holdingToEdit.goldKarat as NonNullable<CommodityHolding['goldKarat']>) || 24);
            setPurchaseValue(String(holdingToEdit.purchaseValue));
            setOtherCurrentValue(holdingToEdit.name === 'Other' ? String(holdingToEdit.currentValue ?? '') : '');
            setZakahClass(holdingToEdit.zakahClass); setOwner(holdingToEdit.owner || ''); setGoalId(holdingToEdit.goalId);
        } else {
            setName('Gold'); setQuantity(''); setUnit('gram'); setGoldKarat(24); setPurchaseValue(''); setOtherCurrentValue(''); setZakahClass('Zakatable'); setOwner(''); setGoalId(undefined);
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

    const getSymbol = (name: CommodityHolding['name'], unit: CommodityHolding['unit'], karat?: CommodityHolding['goldKarat']) => {
        if (name === 'Gold') {
            const k = (karat || 24);
            return `${unit === 'gram' ? 'XAU_GRAM' : 'XAU_OUNCE'}_${k}K`;
        }
        if (name === 'Silver') return unit === 'gram' ? 'XAG_GRAM' : 'XAG_OUNCE';
        if (name === 'Bitcoin') return 'BTC_USD';
        return 'OTHER';
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        setDiagnosticReport(null);
        setCopied(false);

        const parsedQuantity = roundQuantity(parseFloat(quantity) || 0);
        const parsedPurchaseValue = parseMoneyInput(purchaseValue);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            setFormError('Quantity must be a positive number.');
            return;
        }
        if (!Number.isFinite(parsedPurchaseValue) || parsedPurchaseValue <= 0) {
            setFormError('Purchase value must be greater than 0.');
            return;
        }

        const sym = getSymbol(name, unit, goldKarat);

        let parsedCurrentValue = 0;
        if (name === 'Other') {
            parsedCurrentValue = parseMoneyInput(otherCurrentValue);
            if (!Number.isFinite(parsedCurrentValue) || parsedCurrentValue < 0) {
                setFormError('Current value cannot be negative.');
                return;
            }
        }

        const holdingDataBase = {
            name,
            quantity: parsedQuantity,
            unit,
            purchaseValue: parsedPurchaseValue,
            symbol: sym,
            goldKarat: name === 'Gold' ? goldKarat : undefined,
            zakahClass,
            owner: owner || undefined,
            goalId,
        };

        try {
            setIsSubmitting(true);
            if (name !== 'Other') {
                try {
                    const live = await fetchLiveCommodityValueSar({
                        symbol: sym,
                        name,
                        quantity: parsedQuantity,
                        goldKarat: name === 'Gold' ? goldKarat : undefined,
                        sarPerUsd,
                    });
                    if (!live.ok) {
                        setFormError(live.message);
                        return;
                    }
                    parsedCurrentValue = live.currentValue;
                } catch (fetchErr) {
                    setFormError(formatAiError(fetchErr));
                    return;
                }
            }

            const holdingData = { ...holdingDataBase, currentValue: parsedCurrentValue };
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
                `Symbol: ${getSymbol(name, unit, goldKarat)}`,
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
                {name === 'Gold' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Gold Purity (Karat) <InfoHint text="Gold valuation depends on purity. 24K is pure gold; 22K/21K/18K are priced proportionally." /></label>
                        <select value={goldKarat} onChange={e => setGoldKarat(Number(e.target.value) as NonNullable<CommodityHolding['goldKarat']>)} className="mt-1 w-full p-2 border rounded-md">
                            <option value={24}>24K</option>
                            <option value={22}>22K</option>
                            <option value={21}>21K</option>
                            <option value={18}>18K</option>
                        </select>
                    </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Value</label>
                        <input type="number" placeholder="Purchase Value" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" />
                    </div>
                    {name === 'Other' ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Current Value <InfoHint text='No market quote for "Other"; enter an estimate or use a named commodity for live pricing.' /></label>
                            <input type="number" placeholder="Current Value" value={otherCurrentValue} onChange={e => setOtherCurrentValue(e.target.value)} required min="0" step="any" className="w-full p-2 border rounded-md" />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Current Value <InfoHint text="Computed when you save: live unit price (Finnhub for gold/silver, Binance for Bitcoin) × quantity, with gold karat applied." /></label>
                            <div className="w-full p-2 border border-dashed border-slate-300 rounded-md bg-slate-50 text-sm text-slate-700">
                                Live from market on save — priced in SAR using your app USD→SAR rate (header/settings).
                                {holdingToEdit && (
                                    <span className="block mt-1 text-xs text-slate-500">Last saved: {formatCurrencyString(holdingToEdit.currentValue)}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                <div><label className="block text-sm font-medium text-gray-700">Owner <InfoHint text="Leave blank for your own (counts in My net worth). Set e.g. Father for managed wealth (excluded)." /></label><input type="text" placeholder="e.g. Father, Spouse or leave blank for yours" value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full p-2 border rounded-md" /></div>
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
        <div className={`section-card flex flex-col min-w-0 border-t-4 ${borderTone} hover:shadow-lg transition-shadow rounded-xl overflow-hidden min-h-[290px]`}>
            <div className="flex items-start justify-between gap-2 min-h-[40px]">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {getIcon(holding.name)}
                    <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-dark break-words">{holding.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{holding.quantity} {holding.unit}{holding.name === 'Gold' && holding.goldKarat ? ` • ${holding.goldKarat}K` : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => onEdit(holding)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100" aria-label="Edit commodity"><PencilIcon className="h-4 w-4"/></button>
                    <button type="button" onClick={() => onDelete(holding)} className="p-2 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50" aria-label="Delete commodity"><TrashIcon className="h-4 w-4"/></button>
                </div>
            </div>
            <OwnerBadge owner={holding.owner} className="mt-2" />
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

interface AssetsProps { pageAction?: string | null; clearPageAction?: () => void; setActivePage?: (page: Page) => void; }

const Assets: React.FC<AssetsProps> = ({ pageAction, clearPageAction }) => {
    const { data, loading, addAsset, updateAsset, deleteAsset, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const { formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

    // State for both types of modals
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
    const [preferredAssetType, setPreferredAssetType] = useState<AssetType>('Property');
    const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
    const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Asset | CommodityHolding | null>(null);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);
    const [physicalAssetFilter, setPhysicalAssetFilter] = useState<'All' | 'Property' | 'Sukuk' | 'Vehicle' | 'Other'>('All');
    const [lastCommodityRefreshAt, setLastCommodityRefreshAt] = useState<string | null>(null);

    useEffect(() => {
        if (pageAction === 'open-asset-modal') {
            handleOpenAssetModal();
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    /** Personal wealth only — matches Summary/Dashboard net worth (excludes items with Owner set). */
    const assetsList = (data as any)?.personalAssets ?? data?.assets ?? [];
    const commodityList = (data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? [];

    const { totalAssetValue, totalPhysicalAssetValue, totalCommodityValue, totalRentalIncome } = useMemo(() => {
        const physicalValue = assetsList.reduce((sum: number, asset: { value?: number }) => sum + (asset.value ?? 0), 0);
        const commodityValue = commodityList.reduce((sum: number, h: { currentValue?: number }) => sum + (h.currentValue ?? 0), 0);
        const rentalIncome = assetsList.filter((a: { isRental?: boolean; monthlyRent?: number }) => a.isRental && a.monthlyRent).reduce((sum: number, a: { monthlyRent?: number }) => sum + (a.monthlyRent ?? 0), 0);
        return { totalAssetValue: physicalValue + commodityValue, totalPhysicalAssetValue: physicalValue, totalCommodityValue: commodityValue, totalRentalIncome: rentalIncome };
    }, [assetsList, commodityList]);

    // Physical Asset Handlers
    const handleOpenAssetModal = (asset: Asset | null = null, preferredType: AssetType = 'Property') => { setAssetToEdit(asset); setPreferredAssetType(preferredType); setIsAssetModalOpen(true); };
    const handleSaveAsset = (asset: Asset) => { if (assetsList.some((a: Asset) => a.id === asset.id)) updateAsset(asset); else addAsset(asset); };
    const handleLinkGoal = (assetId: string, goalId: string) => { const asset = assetsList.find((a: Asset) => a.id === assetId); if (asset) updateAsset({ ...asset, goalId: goalId === 'none' ? undefined : goalId }); };
    const handleLinkCommodityGoal = (holdingId: string, goalId: string) => {
        const holding = commodityList.find((h: CommodityHolding) => h.id === holdingId);
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
    const handleConfirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            if ('unit' in itemToDelete) await deleteCommodityHolding(itemToDelete.id);
            else await deleteAsset(itemToDelete.id);
        } finally {
            setItemToDelete(null);
        }
    };
    
    const handleUpdatePrices = async () => {
        const commodityHoldings = commodityList;
        if (commodityHoldings.length === 0) return;
        setIsUpdatingPrices(true);
        setGroundingChunks([]);
        try {
            const { prices, groundingChunks: chunks } = await getAICommodityPrices(
                commodityHoldings.map((c: CommodityHolding) => ({ symbol: c.symbol ?? '', name: c.name ?? '', goldKarat: c.goldKarat })),
                { sarPerUsd },
            );
            if (chunks) {
                setGroundingChunks(chunks);
            }
            if (prices.length > 0) {
                const match = (p: { symbol: string }, h: CommodityHolding) => (p.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase();
                const updates = commodityHoldings.map((h: CommodityHolding) => { const p = prices.find(pr => match(pr, h)); return p ? { id: h.id, currentValue: p.price * h.quantity } : null; }).filter((u: { id: string; currentValue: number } | null): u is { id: string; currentValue: number } => u !== null);
                if (updates.length > 0) {
                    await batchUpdateCommodityHoldingValues(updates);
                    setLastCommodityRefreshAt(new Date().toISOString());
                }
            }
        } catch (error) {
            alert(`Failed to update commodity prices (Finnhub for metals, Binance for Bitcoin).\n\n${formatAiError(error)}`);
        } 
        finally { setIsUpdatingPrices(false); }
    };


    const orderedAssets = useMemo(() => [...assetsList].sort((a, b) => a.name.localeCompare(b.name)), [assetsList]);
    const filteredPhysicalAssets = useMemo(() => {
        if (physicalAssetFilter === 'All') return orderedAssets;
        return orderedAssets.filter((a: Asset) => a.type === physicalAssetFilter);
    }, [orderedAssets, physicalAssetFilter]);
    const orderedCommodities = useMemo(() => [...commodityList].sort((a, b) => (a.name || '').localeCompare(b.name || '')), [commodityList]);
    const assetsValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) warnings.push('FX rate is invalid. Commodity USD-to-SAR conversion may be inaccurate.');
        const goalIds = new Set((data?.goals ?? []).map((g) => g.id));
        const badAssetValues = assetsList.filter((a: Asset) => !Number.isFinite(Number(a.value)) || Number(a.value) < 0).length;
        if (badAssetValues > 0) warnings.push(`${badAssetValues} physical asset(s) have invalid current value.`);
        const badAssetPurchase = assetsList.filter((a: Asset) => a.purchasePrice != null && (!Number.isFinite(Number(a.purchasePrice)) || Number(a.purchasePrice) < 0)).length;
        if (badAssetPurchase > 0) warnings.push(`${badAssetPurchase} physical asset(s) have invalid purchase price.`);
        const badRental = assetsList.filter((a: Asset) => a.isRental && (!Number.isFinite(Number(a.monthlyRent)) || Number(a.monthlyRent) < 0)).length;
        if (badRental > 0) warnings.push(`${badRental} rental asset(s) have invalid monthly rent.`);
        const badSukukDates = assetsList.filter((a: Asset) => {
            if (a.type !== 'Sukuk') return false;
            const issue = a.issueDate ? new Date(a.issueDate).getTime() : Number.NaN;
            const maturity = a.maturityDate ? new Date(a.maturityDate).getTime() : Number.NaN;
            return Number.isNaN(issue) || Number.isNaN(maturity) || maturity < issue;
        }).length;
        if (badSukukDates > 0) warnings.push(`${badSukukDates} sukuk asset(s) have missing/invalid issue or maturity dates.`);
        const brokenAssetLinks = assetsList.filter((a: Asset) => a.goalId && !goalIds.has(a.goalId)).length;
        if (brokenAssetLinks > 0) warnings.push(`${brokenAssetLinks} physical asset goal link(s) are stale (goal was deleted).`);
        const badCommodities = commodityList.filter((h: CommodityHolding) => !Number.isFinite(Number(h.quantity)) || Number(h.quantity) <= 0 || !Number.isFinite(Number(h.currentValue)) || Number(h.currentValue) < 0 || !Number.isFinite(Number(h.purchaseValue)) || Number(h.purchaseValue) < 0).length;
        if (badCommodities > 0) warnings.push(`${badCommodities} commodity holding(s) contain invalid quantity/value.`);
        const brokenCommodityLinks = commodityList.filter((h: CommodityHolding) => h.goalId && !goalIds.has(h.goalId)).length;
        if (brokenCommodityLinks > 0) warnings.push(`${brokenCommodityLinks} commodity goal link(s) are stale (goal was deleted).`);
        const recomputedPhysical = assetsList.reduce((sum: number, a: Asset) => sum + (Number(a.value) || 0), 0);
        const recomputedCommodities = commodityList.reduce((sum: number, h: CommodityHolding) => sum + (Number(h.currentValue) || 0), 0);
        const recomputedTotal = recomputedPhysical + recomputedCommodities;
        if (Math.abs(recomputedTotal - totalAssetValue) > 0.01) warnings.push('Asset total card is out of sync with row totals.');
        return warnings;
    }, [sarPerUsd, data?.goals, assetsList, commodityList, totalAssetValue]);
    const assetsAiContext = useMemo(() => {
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const byType = new Map<string, number>();
        for (const a of assetsList as Asset[]) {
            const key = a.type || 'Other';
            byType.set(key, (byType.get(key) ?? 0) + (Number(a.value) || 0));
        }
        for (const c of commodityList as CommodityHolding[]) {
            const key = c.name || 'Other';
            byType.set(key, (byType.get(key) ?? 0) + (Number(c.currentValue) || 0));
        }
        const compositionData = Array.from(byType.entries()).map(([name, value]) => ({ name, value }));
        return {
            spendingData: [
                { category: 'Physical Assets', value: totalPhysicalAssetValue },
                { category: 'Metals & Crypto', value: totalCommodityValue },
                { category: 'Monthly Rental Income', value: totalRentalIncome },
                { category: 'Total Assets', value: totalAssetValue },
            ],
            trendData: [{ month, value: totalAssetValue }],
            compositionData: compositionData.length > 0 ? compositionData : [{ name: 'No Assets', value: 0 }],
        };
    }, [assetsList, commodityList, totalPhysicalAssetValue, totalCommodityValue, totalRentalIncome, totalAssetValue]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading assets" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Assets"
            description="Physical assets and commodities (metals & crypto) for your personal net worth. Totals and lists exclude items with Owner set (managed wealth). Link to goals and use Update Prices for current commodity values."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <PageActionsDropdown
                        ariaLabel="Assets actions"
                        actions={[
                            { value: 'physical', label: 'Add Physical Asset', onClick: () => handleOpenAssetModal(null, 'Property') },
                            { value: 'sukuk', label: 'Add Sukuk', onClick: () => handleOpenAssetModal(null, 'Sukuk') },
                            { value: 'commodity', label: 'Add Commodity', onClick: () => handleOpenCommodityModal() },
                        ]}
                    />
                </div>
            }
        >

            <CollapsibleSection title="Sukuk in Finova" summary="How Sukuk is handled and how to add it" className="overflow-hidden border-sky-100">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
                        <p className="font-semibold text-sky-800">How it is handled</p>
                        <p className="text-slate-700 mt-1">Sukuk is treated as a first-class asset type and included in total assets, gain/loss, and goal-linking.</p>
                    </div>
                    <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
                        <p className="font-semibold text-sky-800">Investment integration</p>
                        <p className="text-slate-700 mt-1">For portfolio holdings, open holding edit and set <strong>Asset Class = Sukuk</strong> so reports and execution views classify it correctly.</p>
                    </div>
                    <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
                        <p className="font-semibold text-sky-800">How to add Sukuk</p>
                        <p className="text-slate-700 mt-1">Use <strong>Add → Sukuk</strong>, enter value/purchase price, <strong>issue date</strong> and <strong>maturity date</strong> (full calendar dates), then optionally link to a goal.</p>
                    </div>
                </div>
            </CollapsibleSection>

            <div className="cards-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                <Card title="Total Asset Value" value={formatCurrencyString(totalAssetValue)} indicatorColor="green" valueColor="text-emerald-700" icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />} tooltip="Personal wealth only: physical + metals/crypto (same rows below). Excludes assets with Owner set." />
                <Card title="Physical Asset Value" value={formatCurrencyString(totalPhysicalAssetValue)} indicatorColor="green" valueColor="text-indigo-700" icon={<HomeModernIcon className="h-5 w-5 text-indigo-600" />} tooltip="Personal physical assets (property, vehicles, Sukuk, etc.)." />
                <Card title="Metals & Crypto Value" value={formatCurrencyString(totalCommodityValue)} indicatorColor="yellow" valueColor="text-amber-700" icon={<CubeIcon className="h-5 w-5 text-amber-600" />} tooltip="Personal commodity holdings only." />
                <Card title="Monthly Rental Income" value={formatCurrencyString(totalRentalIncome)} indicatorColor="green" valueColor="text-teal-700" icon={<BanknotesIcon className="h-5 w-5 text-teal-600" />} tooltip="Rental income from your personal rental-flagged properties." />
            </div>
            {assetsValidationWarnings.length > 0 && (
                <SectionCard title="Assets validation checks" collapsible collapsibleSummary="Data quality and wiring checks" defaultExpanded>
                    <ul className="space-y-1 text-sm text-amber-800">
                        {assetsValidationWarnings.slice(0, 8).map((w, i) => (
                            <li key={`aw-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <SectionCard
                title="Physical Assets"
                className="overflow-visible"
                collapsible
                collapsibleSummary="Property, Sukuk, vehicles"
                defaultExpanded
                headerAction={
                    <label className="flex items-center gap-2 text-sm text-slate-600 shrink-0">
                        <span className="hidden sm:inline whitespace-nowrap">Show</span>
                        <select
                            value={physicalAssetFilter}
                            onChange={(e) => setPhysicalAssetFilter(e.target.value as typeof physicalAssetFilter)}
                            className="select-base text-sm py-1.5 min-w-[9rem]"
                            aria-label="Filter physical assets by type"
                        >
                            <option value="All">All types</option>
                            <option value="Property">Property only</option>
                            <option value="Sukuk">Sukuk only</option>
                            <option value="Vehicle">Vehicles only</option>
                            <option value="Other">Other only</option>
                        </select>
                    </label>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
                    {filteredPhysicalAssets.map((asset) => (
                        <AssetCardComponent key={asset.id} asset={asset} onEdit={handleOpenAssetModal} onDelete={handleOpenDeleteModal} onLinkGoal={handleLinkGoal} goals={data?.goals ?? []} />
                    ))}
                    {assetsList.length === 0 && <p className="empty-state md:col-span-2 xl:col-span-3">No physical assets added yet.</p>}
                    {assetsList.length > 0 && filteredPhysicalAssets.length === 0 && (
                        <p className="empty-state md:col-span-2 xl:col-span-3">No assets match this filter. Choose &quot;All types&quot; or add a {physicalAssetFilter === 'Other' ? 'Other' : physicalAssetFilter} asset.</p>
                    )}
                </div>
            </SectionCard>

            <SectionCard
                title="Commodities (Metals & Crypto)"
                className="overflow-visible"
                collapsible
                collapsibleSummary="Gold, silver, crypto"
                defaultExpanded
                headerAction={
                    <div className="flex flex-col items-end gap-1">
                        <button
                            type="button"
                            onClick={handleUpdatePrices}
                            disabled={isUpdatingPrices || commodityList.length === 0}
                            title={commodityList.length === 0 ? "Add a commodity to update prices" : "Update prices"}
                            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <SparklesIcon className="h-4 w-4" />
                            {isUpdatingPrices ? 'Updating...' : 'Update Prices'}
                        </button>
                        {lastCommodityRefreshAt && (
                            <p className="text-[11px] text-slate-500">
                                Last successful check: {new Date(lastCommodityRefreshAt).toLocaleString()}
                            </p>
                        )}
                    </div>
                }
            >
                <div className="mb-4 rounded-lg bg-slate-50/80 border border-slate-200 p-3 sm:p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-slate-700 leading-relaxed">
                            Track gold, silver, bitcoin and other commodities. <strong>Save</strong> on a commodity fetches live unit prices (Finnhub for metals, Binance for Bitcoin). Use <strong>Update Prices</strong> to refresh all holdings without re-entering each one.
                        </p>
                        <span className="mt-0.5 shrink-0"><InfoHint text="Pricing uses AI when available; otherwise Finnhub or Stooq. If one provider fails, the system retries with alternatives." /></span>
                    </div>
                </div>
                {!isAiAvailable && commodityList.length > 0 && (
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
                        <CommodityHoldingCard key={h.id} holding={h} goals={data?.goals ?? []} onLinkGoal={handleLinkCommodityGoal} onEdit={handleOpenCommodityModal} onDelete={handleOpenDeleteModal} />
                    ))}
                    {commodityList.length === 0 && <p className="empty-state col-span-full py-8 text-center text-slate-500">No metals or crypto added yet. Use the menu above to add a commodity.</p>}
                </div>
            </SectionCard>

            <AIAdvisor
                pageContext="analysis"
                contextData={assetsAiContext}
                title="Assets AI Advisor"
                subtitle="Allocation clarity, valuation signals, and asset-quality insights."
                buttonLabel="Get AI Assets Insights"
            />
            
            <AssetModal isOpen={isAssetModalOpen} onClose={() => setIsAssetModalOpen(false)} onSave={handleSaveAsset} assetToEdit={assetToEdit} preferredType={preferredAssetType} />
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} goals={data?.goals ?? []} sarPerUsd={sarPerUsd} />
            <DeleteConfirmationModal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </PageLayout>
    );
};

export default Assets;
