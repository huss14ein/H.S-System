import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { CommodityHolding, Page } from '../types';
import Card from '../components/Card';
import Modal from '../components/Modal';
import PageLayout from '../components/PageLayout';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { GoldBarIcon } from '../components/icons/GoldBarIcon';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { BitcoinIcon } from '../components/icons/BitcoinIcon';
import { CubeIcon } from '../components/icons/CubeIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import InfoHint from '../components/InfoHint';
import OwnerBadge from '../components/OwnerBadge';
import { getAICommodityPrices, formatAiError } from '../services/geminiService';
import { useSelfLearning } from '../context/SelfLearningContext';
import { parseMoneyInput, roundQuantity } from '../utils/money';
import { fetchLiveCommodityValueSar } from '../utils/commodityLiveValue';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import AIAdvisor from '../components/AIAdvisor';

const CommodityHoldingModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => void | Promise<void>;
    holdingToEdit: CommodityHolding | null;
    sarPerUsd: number;
}> = ({ isOpen, onClose, onSave, holdingToEdit, sarPerUsd }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [name, setName] = useState<CommodityHolding['name']>('Gold');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState<CommodityHolding['unit']>('gram');
    const [goldKarat, setGoldKarat] = useState<NonNullable<CommodityHolding['goldKarat']>>(24);
    const [purchaseValue, setPurchaseValue] = useState('');
    const [otherCurrentValue, setOtherCurrentValue] = useState('');
    const [zakahClass, setZakahClass] = useState<CommodityHolding['zakahClass']>('Zakatable');
    const [owner, setOwner] = useState('');
    const [acquisitionDate, setAcquisitionDate] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    useEffect(() => {
        if (holdingToEdit) {
            setName(holdingToEdit.name);
            setQuantity(String(holdingToEdit.quantity));
            setUnit(holdingToEdit.unit);
            setGoldKarat((holdingToEdit.goldKarat as NonNullable<CommodityHolding['goldKarat']>) || 24);
            setPurchaseValue(String(holdingToEdit.purchaseValue));
            setOtherCurrentValue(holdingToEdit.name === 'Other' ? String(holdingToEdit.currentValue ?? '') : '');
            setZakahClass(holdingToEdit.zakahClass);
            setOwner(holdingToEdit.owner || '');
            setAcquisitionDate(holdingToEdit.acquisitionDate ?? (holdingToEdit as { acquisition_date?: string }).acquisition_date ?? '');
        } else {
            setName('Gold'); setQuantity(''); setUnit('gram'); setGoldKarat(24); setPurchaseValue(''); setOtherCurrentValue(''); setZakahClass('Zakatable'); setOwner(''); setAcquisitionDate('');
        }
        setFormError(null);
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

    const formatUnknownError = (error: unknown): string => {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object') {
            const obj = error as Record<string, unknown>;
            const msg = String(obj.message ?? '').trim();
            const details = String(obj.details ?? '').trim();
            const hint = String(obj.hint ?? '').trim();
            const code = String(obj.code ?? '').trim();
            const fallbackJson = (() => {
                try { return JSON.stringify(obj); } catch { return ''; }
            })();
            return [msg, details, hint, code ? `code=${code}` : '', fallbackJson].filter(Boolean).join(' | ') || 'Unknown error';
        }
        return String(error);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
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

        const ad = acquisitionDate.trim();
        const holdingDataBase = {
            name,
            quantity: parsedQuantity,
            unit,
            purchaseValue: parsedPurchaseValue,
            symbol: sym,
            zakahClass,
            goldKarat: name === 'Gold' ? goldKarat : undefined,
            owner: owner || undefined,
            acquisitionDate: ad ? ad.slice(0, 10) : undefined,
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
            setFormError(formatUnknownError(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={holdingToEdit ? 'Edit Commodity' : 'Add Commodity'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Commodity <InfoHint text="Gold, Silver, Bitcoin, or Other; affects unit options and Zakat treatment." /></label>
                    <select value={name} onChange={e => setName(e.target.value as any)} className="select-base w-full"><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Bitcoin">Bitcoin</option><option value="Other">Other</option></select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Quantity & Unit <InfoHint text="Amount you hold; unit (grams/ounces/BTC) for correct valuation and Zakat." /></label>
                    <div className="grid grid-cols-2 gap-4"><input type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" step="any" className="input-base w-full" /><select value={unit} onChange={e => setUnit(e.target.value as any)} className="select-base w-full">{name === 'Gold' || name === 'Silver' ? <> <option value="gram">grams</option> <option value="ounce">ounces</option> </> : name === 'Bitcoin' ? <option value="BTC">BTC</option> : <option value="unit">units</option>}</select></div>
                    {name === 'Gold' && (
                        <div className="mt-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Gold Purity (Karat) <InfoHint text="Gold valuation depends on purity. 24K is pure gold; 22K/21K/18K are priced proportionally." /></label>
                            <select value={goldKarat} onChange={e => setGoldKarat(Number(e.target.value) as NonNullable<CommodityHolding['goldKarat']>)} className="select-base w-full">
                                <option value={24}>24K</option>
                                <option value={22}>22K</option>
                                <option value={21}>21K</option>
                                <option value={18}>18K</option>
                            </select>
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Purchase Value <InfoHint text="Your cost basis." /></label>
                        <input type="number" placeholder="Purchase Value" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required min="0" step="any" className="input-base w-full" />
                    </div>
                    {name === 'Other' ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Current Value <InfoHint text='No market quote for "Other"; enter an estimate or pick Gold, Silver, or Bitcoin for live pricing.' /></label>
                            <input type="number" placeholder="Current Value" value={otherCurrentValue} onChange={e => setOtherCurrentValue(e.target.value)} required min="0" step="any" className="input-base w-full" />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Current Value <InfoHint text="Computed on save from live quotes (Finnhub for metals, Binance for Bitcoin)." /></label>
                            <div className="w-full p-2 border border-dashed border-slate-300 rounded-md bg-slate-50 text-sm text-slate-700">
                                Live from market on save — priced in SAR using your app USD→SAR rate (header/settings).
                                {holdingToEdit && (
                                    <span className="block mt-1 text-xs text-slate-500">Last saved: {formatCurrencyString(holdingToEdit.currentValue)}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{formError}</p>}
                 <div><label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Owner (optional) <InfoHint text="Leave blank for your own (counts in My net worth). Set e.g. Father, Spouse for managed wealth (excluded)." /></label><input type="text" placeholder="e.g. Father, Spouse or leave blank for yours" value={owner} onChange={e => setOwner(e.target.value)} className="input-base mt-1 w-full" /></div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Acquisition date (optional) <InfoHint text="Start of lunar hawl (~354 days) for Zakat. If empty, server created time may be used when present." /></label>
                    <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} className="input-base mt-1 w-full" />
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Zakat Classification <InfoHint text="Zakatable: included in Zakat calculation. Non-Zakatable: excluded (e.g. personal use)." /></label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="select-base mt-1 w-full"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <button type="submit" disabled={isSubmitting} className="w-full btn-primary disabled:opacity-50">{isSubmitting ? 'Fetching price & saving…' : 'Save'}</button>
            </form>
        </Modal>
    );
};

const CommodityHoldingCard: React.FC<{ holding: CommodityHolding; onEdit: (h: CommodityHolding) => void; onDelete: (h: CommodityHolding) => void; }> = ({ holding, onEdit, onDelete }) => {
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const unrealizedGain = holding.currentValue - holding.purchaseValue;
    const getIcon = (type: CommodityHolding['name']) => {
        const iconClass = "h-10 w-10";
        switch (type) {
            case 'Gold': return <GoldBarIcon className={`${iconClass} text-yellow-500`} />;
            case 'Silver': return <GoldBarIcon className={`${iconClass} text-gray-400`} />;
            case 'Bitcoin': return <BitcoinIcon className={`${iconClass} text-orange-500`} />;
            default: return <CubeIcon className={`${iconClass} text-gray-500`} />;
        }
    };
    return (
        <div className="section-card flex flex-col justify-between hover:shadow-lg transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-4">
                        {getIcon(holding.name)}
                        <div><h3 className="font-bold text-dark text-xl">{holding.name}</h3><p className="text-sm text-gray-500">{holding.quantity} {holding.unit}{holding.name === 'Gold' && holding.goldKarat ? ` • ${holding.goldKarat}K` : ''}</p></div>
                    </div>
                    <div className="flex space-x-1"><button type="button" onClick={() => onEdit(holding)} className="p-1 text-gray-400 hover:text-primary" aria-label="Edit commodity"><PencilIcon className="h-4 w-4"/></button><button type="button" onClick={() => onDelete(holding)} className="p-1 text-gray-400 hover:text-danger" aria-label="Delete commodity"><TrashIcon className="h-4 w-4"/></button></div>
                </div>
                <OwnerBadge owner={holding.owner} className="mt-2" />
                <div className="mt-4 space-y-3 min-w-0 overflow-hidden">
                    <div className="min-w-0 overflow-hidden"><dt className="metric-label text-sm text-gray-500">Current Value</dt><dd className="metric-value font-semibold text-dark text-2xl">{formatCurrencyString(holding.currentValue ?? 0)}</dd></div>
                    <div className="grid grid-cols-2 gap-4 text-sm min-w-0"><div className="min-w-0 overflow-hidden"><dt className="metric-label text-gray-500">Purchase Value</dt><dd className="metric-value font-medium text-gray-700">{formatCurrencyString(holding.purchaseValue)}</dd></div><div className="min-w-0 overflow-hidden"><dt className="metric-label text-gray-500">Unrealized G/L</dt><dd className="metric-value font-semibold">{formatCurrency(unrealizedGain, { colorize: true })}</dd></div></div>
                </div>
            </div>
            <div className="border-t mt-4 pt-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${holding.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{holding.zakahClass}</span></div>
        </div>
    );
};


interface CommoditiesProps {
    setActivePage?: (page: Page) => void;
}

const Commodities: React.FC<CommoditiesProps> = ({ setActivePage }) => {
    const { data, loading, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const { formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    
    const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
    const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);
    const [commodityToDelete, setCommodityToDelete] = useState<CommodityHolding | null>(null);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);

    const commodityRows = useMemo(
        () => (data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? [],
        [data, (data as any)?.personalCommodityHoldings, data?.commodityHoldings]
    );

    const totalCommodityValue = useMemo(() => {
        return commodityRows.reduce((sum: number, h: { currentValue?: number }) => sum + (h.currentValue ?? 0), 0);
    }, [commodityRows]);

    const commoditiesAiContext = useMemo(
        () => ({
            items: (commodityRows as CommodityHolding[]).map((h) => ({
                name: h.name,
                quantity: h.quantity,
                unit: h.unit,
                zakahClass: h.zakahClass,
                currentValue: h.currentValue,
                unrealizedGain: (h.currentValue ?? 0) - (h.purchaseValue ?? 0),
                owner: h.owner,
            })),
            totalValueSar: totalCommodityValue,
            sarPerUsd,
            holdingCount: commodityRows.length,
        }),
        [commodityRows, totalCommodityValue, sarPerUsd],
    );

    const handleOpenCommodityModal = (holding: CommodityHolding | null = null) => { setCommodityToEdit(holding); setIsCommodityModalOpen(true); };
    const handleSaveCommodity = async (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => {
        if ('id' in holding) {
            await updateCommodityHolding(holding);
        } else {
            await addCommodityHolding(holding);
        }
    };
    const handleOpenCommodityDeleteModal = (holding: CommodityHolding) => { setCommodityToDelete(holding); };
    const handleConfirmCommodityDelete = () => { if(commodityToDelete) { deleteCommodityHolding(commodityToDelete.id); setCommodityToDelete(null); } };

    const handleUpdatePrices = async () => {
        trackAction('update-commodity-prices', 'Commodities');
        const holdingsForPrices = commodityRows;
        if (!holdingsForPrices.length) return;
        setIsUpdatingPrices(true);
        try {
            const { prices } = await getAICommodityPrices(
                holdingsForPrices.map((c: { symbol?: string; name?: string; goldKarat?: number }) => ({ symbol: c.symbol ?? '', name: c.name ?? '', goldKarat: c.goldKarat })),
                { sarPerUsd },
            );
            const match = (p: { symbol: string }, h: CommodityHolding) => (p.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase();
            if (prices.length > 0) {
                const updates = holdingsForPrices
                    .map((h: CommodityHolding) => {
                        const newPriceInfo = prices.find((p: { symbol: string; price: number }) => match(p, h));
                        return newPriceInfo ? { id: h.id, currentValue: newPriceInfo.price * (h.quantity ?? 0) } : null;
                    })
                    .filter((u: { id: string; currentValue: number } | null): u is { id: string; currentValue: number } => u !== null);
                
                if (updates.length > 0) {
                    await batchUpdateCommodityHoldingValues(updates);
                    if (updates.length < holdingsForPrices.length) {
                        console.warn(`Updated ${updates.length} of ${holdingsForPrices.length} commodity prices.`);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to update commodity prices:", error);
            alert(`Failed to update prices.\n\n${formatAiError(error)}`);
        } finally {
            setIsUpdatingPrices(false);
        }
    };
    
    return (
        <PageLayout
            title="Metals & Crypto"
            description="Gold, silver, Bitcoin, and other commodities. Saving a holding applies live unit prices (Finnhub/Binance). Use Update Prices to refresh all holdings at once. Zakat classification affects your Zakat calculation."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    {setActivePage && (
                        <button type="button" onClick={() => setActivePage('Zakat')} className="btn-outline text-sm">Zakat Calculator</button>
                    )}
                    <button type="button" onClick={() => handleOpenCommodityModal()} className="btn-primary">Add Commodity</button>
                </div>
            }
        >
        {(loading || !data) ? (
            <div className="flex justify-center items-center min-h-[20rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading commodities" />
            </div>
        ) : (
        <div className="space-y-6">
            <Card title="Total Commodity Value" value={formatCurrencyString(totalCommodityValue)} tooltip="Personal holdings only (excludes commodities with Owner set). Matches Assets page metals/crypto total." />

            <div className="section-card">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                    <h3 className="section-title mb-0">Holdings</h3>
                    <button type="button" onClick={handleUpdatePrices} disabled={isUpdatingPrices} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isUpdatingPrices ? 'Updating Prices...' : 'Update Prices via AI'}
                    </button>
                </div>
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {commodityRows.map((h: CommodityHolding) => <CommodityHoldingCard key={h.id} holding={h} onEdit={handleOpenCommodityModal} onDelete={handleOpenCommodityDeleteModal} />)}
                    {commodityRows.length === 0 && <p className="text-sm text-gray-500 md:col-span-2 xl:col-span-3 text-center py-8">No commodities added yet.</p>}
                </div>
            </div>

            <AIAdvisor
                pageContext="commodities"
                contextData={commoditiesAiContext}
                title="Metals & crypto coach"
                subtitle="SAR valuations, Zakat flags, and concentration — English / العربية"
                buttonLabel="Summarize my commodities"
            />
            
            <CommodityHoldingModal isOpen={isCommodityModalOpen} onClose={() => setIsCommodityModalOpen(false)} onSave={handleSaveCommodity} holdingToEdit={commodityToEdit} sarPerUsd={sarPerUsd} />
            <DeleteConfirmationModal isOpen={!!commodityToDelete} onClose={() => setCommodityToDelete(null)} onConfirm={handleConfirmCommodityDelete} itemName={commodityToDelete?.name || ''} />
        </div>
        )}
        </PageLayout>
    );
};

export default Commodities;
