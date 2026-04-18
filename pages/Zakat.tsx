import React, { useState, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import Modal from '../components/Modal';
import { ZakatPayment, Page } from '../types';
import ProgressBar from '../components/ProgressBar';
import InfoHint from '../components/InfoHint';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { fetchLiveGoldPriceSarPerGram } from '../utils/commodityLiveValue';
import { summarizeZakatableCommoditiesForZakat, summarizeZakatableInvestmentsForZakat } from '../services/zakatInvestmentValuation';
import { computeDeductibleLiabilities } from '../services/zakatLiabilityMath';
import { getPersonalAccounts, getPersonalCommodityHoldings, getPersonalInvestments, getPersonalLiabilities } from '../utils/wealthScope';
import AIAdvisor from '../components/AIAdvisor';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { ResolvedSymbolLabel } from '../components/SymbolWithCompanyName';

const ZakatPaymentModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => void }> = ({ isOpen, onClose, onSave }) => {
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!Number.isFinite(amt) || amt <= 0) {
            alert('Payment amount must be a positive number.');
            return;
        }
        if (!date || Number.isNaN(new Date(date).getTime())) {
            alert('Please provide a valid payment date.');
            return;
        }
        onSave({ amount: amt, date, notes: notes.trim() });
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setNotes('');
        onClose();
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record Zakat Payment">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="zakat-amount" className="block text-sm font-medium text-gray-700">Amount Paid</label>
                    <input type="number" id="zakat-amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="input-base mt-1" />
                </div>
                 <div>
                    <label htmlFor="zakat-date" className="block text-sm font-medium text-gray-700">Date</label>
                    <input type="date" id="zakat-date" value={date} onChange={e => setDate(e.target.value)} required className="input-base mt-1" />
                </div>
                 <div>
                    <label htmlFor="zakat-notes" className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                    <input type="text" id="zakat-notes" value={notes} onChange={e => setNotes(e.target.value)} className="input-base mt-1" />
                </div>
                <button type="submit" className="w-full btn-primary">Record Payment</button>
            </form>
        </Modal>
    );
};


interface ZakatProps {
    setActivePage?: (page: Page) => void;
}

const Zakat: React.FC<ZakatProps> = ({ setActivePage }) => {
    const { data, loading, addZakatPayment, updateSettings } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
    
    const defaultGold = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
    const defaultNisab = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
    const [localGoldPrice, setLocalGoldPrice] = useState(String(defaultGold));
    const [useNisabAmount, setUseNisabAmount] = useState(!!defaultNisab);
    const [localNisabAmount, setLocalNisabAmount] = useState(String(defaultNisab ?? (275 * 85)));
    const [otherDebts, setOtherDebts] = useState(0);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isFetchingGold, setIsFetchingGold] = useState(false);
    const [goldLiveNotice, setGoldLiveNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    
    useEffect(() => {
        const g = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
        setLocalGoldPrice(String(g));
        const nisabVal = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
        if (nisabVal != null) {
            setUseNisabAmount(true);
            setLocalNisabAmount(String(nisabVal));
        }
    }, [data?.settings]);

    const goldPrice = Number((data?.settings as any)?.gold_price ?? data?.settings?.goldPrice ?? 275);
    const nisabAmountSetting = (data?.settings as any)?.nisabAmount ?? (data?.settings as any)?.nisab_amount;
    // Use local form values for immediate feedback; fallback to saved settings so nisab actually affects calculation
    const nisab = useMemo(() => {
        if (useNisabAmount) {
            const local = parseFloat(localNisabAmount);
            if (Number.isFinite(local) && local > 0) return local;
            if (nisabAmountSetting != null && Number.isFinite(Number(nisabAmountSetting))) return Number(nisabAmountSetting);
        }
        const localGold = parseFloat(localGoldPrice);
        const effectiveGold = Number.isFinite(localGold) && localGold > 0 ? localGold : goldPrice;
        return effectiveGold * 85;
    }, [useNisabAmount, localNisabAmount, nisabAmountSetting, localGoldPrice, goldPrice]);

    const zakatableAssets = useMemo(() => {
        const asOf = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00.000Z');
        const accounts = getPersonalAccounts(data);
        const investments = getPersonalInvestments(data);
        const commodityHoldings = getPersonalCommodityHoldings(data);
        const cash = accounts
            .filter((a) => ['Checking', 'Savings'].includes(a.type ?? ''))
            .reduce((sum, acc) => sum + toSAR(Math.max(0, acc.balance ?? 0), acc.currency, sarPerUsd), 0);
        const invTx = data?.investmentTransactions ?? [];
        const { totalSar: invValue, lines: investmentLines } = summarizeZakatableInvestmentsForZakat(
            investments,
            sarPerUsd,
            invTx,
            asOf,
        );
        const { totalSar: commodities, lines: commodityLines } = summarizeZakatableCommoditiesForZakat(commodityHoldings, asOf);
        const total = cash + invValue + commodities;
        return { cash, investments: invValue, commodities, total, investmentLines, commodityLines };
    }, [data, sarPerUsd]);

    const zakatInvSymbols = useMemo(
        () =>
            Array.from(
                new Set(
                    zakatableAssets.investmentLines
                        .map((r: { symbol?: string }) => (r.symbol || '').trim())
                        .filter((s: string) => s.length >= 2),
                ),
            ),
        [zakatableAssets.investmentLines],
    );
    const { names: zakatCompanyNames } = useCompanyNames(zakatInvSymbols);

    const deductibleLiabilities = useMemo(() => {
        const accounts = getPersonalAccounts(data);
        const liabilities = getPersonalLiabilities(data);
        return computeDeductibleLiabilities({
            accounts,
            liabilities,
            otherDebts,
            sarPerUsd,
        });
    }, [otherDebts, data, sarPerUsd]);
    
    const netZakatableWealth = useMemo(() => Math.max(0, zakatableAssets.total - deductibleLiabilities.total), [zakatableAssets, deductibleLiabilities]);
    const isNisabMet = useMemo(() => netZakatableWealth >= nisab, [netZakatableWealth, nisab]);
    const zakatDue = useMemo(() => isNisabMet ? netZakatableWealth * 0.025 : 0, [isNisabMet, netZakatableWealth]);
    const totalPaid = useMemo(() => (data?.zakatPayments ?? []).reduce((sum, p) => sum + p.amount, 0), [data?.zakatPayments]);
    const outstandingZakat = useMemo(() => Math.max(0, zakatDue - totalPaid), [zakatDue, totalPaid]);
    const overpaidZakat = useMemo(() => Math.max(0, totalPaid - zakatDue), [totalPaid, zakatDue]);
    const zakatValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) warnings.push('FX rate is invalid. Default conversion may be applied.');
        if (Number(otherDebts) < 0) warnings.push('Other short-term debts should not be negative.');
        if (!Number.isFinite(nisab) || nisab <= 0) warnings.push('Nisab threshold is invalid.');
        if ((data?.zakatPayments ?? []).some((p) => !Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0)) {
            warnings.push('Some recorded payments have invalid amounts.');
        }
        if (overpaidZakat > 0) warnings.push(`Payments exceed current due by ${formatCurrencyString(overpaidZakat, { inCurrency: 'SAR', digits: 0 })}.`);
        return warnings;
    }, [sarPerUsd, otherDebts, nisab, data?.zakatPayments, overpaidZakat, formatCurrencyString]);

    const handleFetchLiveGold = async () => {
        setGoldLiveNotice(null);
        setIsFetchingGold(true);
        try {
            const live = await fetchLiveGoldPriceSarPerGram(sarPerUsd);
            if (!live.ok) {
                setGoldLiveNotice({ type: 'error', text: live.message });
                return;
            }
            setLocalGoldPrice(String(live.price));
            await updateSettings({ goldPrice: live.price });
            setGoldLiveNotice({
                type: 'success',
                text: `Updated to live spot (24K, SAR/gram) using your USD→SAR rate (${sarPerUsd.toFixed(4)}). You can still edit manually.`,
            });
        } catch (e) {
            setGoldLiveNotice({ type: 'error', text: e instanceof Error ? e.message : 'Failed to fetch gold price.' });
        } finally {
            setIsFetchingGold(false);
        }
    };

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading Zakat" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Zakat Calculator"
            description="Estimate your annual Zakat based on your tracked assets and liabilities."
        >
            <div className="alert-warning max-w-3xl mb-6">
                <div className="flex">
                    <div className="py-1"><InformationCircleIcon className="h-5 w-5 text-amber-500 mr-3 flex-shrink-0"/></div>
                    <div>
                        <p className="font-bold">Disclaimer:</p>
                        <p>This calculator provides an estimation for educational purposes only. Please consult a qualified religious scholar for accurate guidance.</p>
                    </div>
                </div>
            </div>

            <SectionCard title="Hawl (holding period) & cash treatment" collapsible collapsibleSummary="≈354-day lunar rule for investments & commodities" defaultExpanded className="max-w-3xl mb-6">
                <div className="space-y-3 text-sm text-slate-700">
                    <p>
                        For <strong>investments</strong> and <strong>commodities</strong>, the app applies an approximate lunar <em>hawl</em> of <strong>354 days</strong> from a start date: your optional <strong>acquisition date</strong> on the holding, else the <strong>earliest recorded buy</strong> (investments) or <strong>created date</strong> (commodities). Amounts that have not yet completed a full hawl are shown but <strong>not</strong> added to the zakatable total. If no start date can be inferred, the position is still counted (legacy behavior) — set dates or record trades for stricter tracking.
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                        <li>
                            <strong>Investments:</strong> set acquisition on the holding edit dialog, or rely on buy history. Use <strong>Non‑Zakatable</strong> to exclude positions by fiqh choice.
                        </li>
                        <li>
                            <strong>Cash:</strong> uses current checking/savings balances (no automatic hawl); adjust manually if your situation differs.
                        </li>
                        <li>
                            <strong>Commodities:</strong> optional acquisition date on the Commodities form; otherwise the server <strong>created</strong> timestamp starts the hawl when present.
                        </li>
                    </ul>
                    <p className="text-xs text-slate-500">
                        Nisab and rate (e.g. 2.5%) apply after classification; consult a scholar for your school’s rules.
                    </p>
                </div>
            </SectionCard>

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-3 items-start">
                <div className="space-y-6">
                    <SectionCard title="Zakatable Assets" collapsible collapsibleSummary="Cash, investments, receivables" defaultExpanded>
                         <div className="space-y-3">
                            <p className="text-xs text-slate-500 -mt-1 mb-2">Totals use <strong>SAR</strong>. Investment and commodity lines show gross value and what counts after hawl; cash is unchanged.</p>
                            <div className="flex justify-between text-sm pt-2">
                               <span className="text-gray-600 flex items-center"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Cash</span>
                               <span>{formatCurrencyString(zakatableAssets.cash, { inCurrency: 'SAR', digits: 0 })}</span>
                            </div>
                            <div className="flex justify-between text-sm items-start gap-2">
                                <span className="text-gray-600 flex items-center shrink-0"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Investments</span>
                                <span className="text-right font-medium tabular-nums">{formatCurrencyString(zakatableAssets.investments, { inCurrency: 'SAR', digits: 0 })}</span>
                            </div>
                            {zakatableAssets.investmentLines.length > 0 && (
                                <CollapsibleSection
                                    title="Investment details"
                                    summary={`${zakatableAssets.investmentLines.length} symbol(s)`}
                                    defaultExpanded={false}
                                    card={false}
                                    className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                                >
                                    <div className="rounded-lg border border-slate-200 bg-white">
                                        <table className="w-full text-xs text-left">
                                            <thead className="sticky top-0 bg-slate-100 text-slate-600 uppercase tracking-wide">
                                                <tr>
                                                    <th className="py-1.5 px-2 font-semibold">Symbol</th>
                                                    <th className="py-1.5 px-2 font-semibold">Portfolio</th>
                                                    <th className="py-1.5 px-2 font-semibold text-right">Gross SAR</th>
                                                    <th className="py-1.5 px-2 font-semibold text-right">Zakat SAR</th>
                                                    <th className="py-1.5 px-2 font-semibold">Hawl</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white leading-relaxed">
                                                {zakatableAssets.investmentLines.map((row, idx: number) => (
                                                    <tr key={`${row.portfolioId}-${row.symbol}-${idx}`} className="text-slate-800">
                                                        <td className="py-2 px-2 font-medium min-w-0 max-w-[140px] align-top">
                                                            <ResolvedSymbolLabel
                                                                symbol={row.symbol}
                                                                storedName={row.name}
                                                                names={zakatCompanyNames}
                                                                layout="stacked"
                                                                symbolClassName="font-medium text-slate-800"
                                                                companyClassName="text-[10px] text-slate-500"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-2 text-slate-600 truncate max-w-[120px] align-top" title={row.portfolioName}>{row.portfolioName}</td>
                                                        <td className="py-2 px-2 text-right tabular-nums align-top">{formatCurrencyString(row.grossValueSar, { inCurrency: 'SAR', digits: 0 })}</td>
                                                        <td className="py-2 px-2 text-right tabular-nums align-top font-medium">{formatCurrencyString(row.zakatableValueSar, { inCurrency: 'SAR', digits: 0 })}</td>
                                                        <td className="py-2 px-2 text-[10px] text-slate-600 align-top max-w-[200px]">{row.hawlLabel}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[11px] leading-5 text-slate-500 px-2 py-2 border-t border-slate-200 bg-slate-50/80">
                                        Gross = market value (or cost basis). Zakat SAR = gross after ≈354‑day hawl when a start date exists. Non‑Zakatable positions excluded.
                                    </p>
                                </CollapsibleSection>
                            )}
                             <div className="flex justify-between text-sm">
                                <span className="text-gray-600 flex items-center"><CheckCircleIcon className="h-4 w-4 mr-2 text-green-500"/>Commodities</span>
                                <span>{formatCurrencyString(zakatableAssets.commodities, { inCurrency: 'SAR', digits: 0 })}</span>
                            </div>
                            {zakatableAssets.commodityLines.length > 0 && (
                                <CollapsibleSection
                                    title="Commodity details"
                                    summary={`${zakatableAssets.commodityLines.length} lot(s)`}
                                    defaultExpanded={false}
                                    card={false}
                                    className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                                >
                                    <div className="rounded-lg border border-slate-200 bg-white">
                                        <table className="w-full text-xs text-left">
                                            <thead className="sticky top-0 bg-slate-100 text-slate-600 uppercase tracking-wide">
                                                <tr>
                                                    <th className="py-1.5 px-2 font-semibold">Commodity</th>
                                                    <th className="py-1.5 px-2 font-semibold text-right">Gross SAR</th>
                                                    <th className="py-1.5 px-2 font-semibold text-right">Zakat SAR</th>
                                                    <th className="py-1.5 px-2 font-semibold">Hawl</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white leading-relaxed">
                                                {zakatableAssets.commodityLines.map((row) => (
                                                    <tr key={row.id} className="text-slate-800">
                                                        <td className="py-2 px-2 font-medium align-top">{row.name}</td>
                                                        <td className="py-2 px-2 text-right tabular-nums align-top">{formatCurrencyString(row.grossValueSar, { inCurrency: 'SAR', digits: 0 })}</td>
                                                        <td className="py-2 px-2 text-right tabular-nums align-top font-medium">{formatCurrencyString(row.zakatableValueSar, { inCurrency: 'SAR', digits: 0 })}</td>
                                                        <td className="py-2 px-2 text-[10px] text-slate-600 align-top max-w-[200px]">{row.hawlLabel}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CollapsibleSection>
                            )}
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Assets</span><span>{formatCurrencyString(zakatableAssets.total, { inCurrency: 'SAR', digits: 0 })}</span></div>
                             <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded-md mt-2">
                                <p>Includes cash, zakatable investments (default zakatable if unset), and commodities not marked Non‑Zakatable. You can change an asset&apos;s Zakat classification on the {setActivePage ? (
                                    <> <button type="button" onClick={() => setActivePage('Investments')} className="text-primary font-medium hover:underline">Investments</button> and <button type="button" onClick={() => setActivePage('Assets')} className="text-primary font-medium hover:underline">Assets</button> pages.</>
                                ) : (
                                    <>Investments and Assets pages.</>
                                )}</p>
                            </div>
                        </div>
                    </SectionCard>
                    <SectionCard title="Deductible Liabilities" collapsible collapsibleSummary="Debts to deduct">
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Credit Card Debt</span><span>{formatCurrencyString(deductibleLiabilities.shortTermDebts, { inCurrency: 'SAR', digits: 0 })}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-gray-600">Tracked Liabilities (Active)</span><span>{formatCurrencyString(deductibleLiabilities.trackedLiabilities, { inCurrency: 'SAR', digits: 0 })}</span></div>
                            <div>
                                <label htmlFor="other-debts" className="block text-sm font-medium text-gray-700">Other Short-Term Debts</label>
                                <input type="number" id="other-debts" min="0" step="0.01" value={otherDebts} onChange={e => setOtherDebts(Math.max(0, parseFloat(e.target.value) || 0))} placeholder="Enter value" className="input-base mt-1" />
                            </div>
                            <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total Liabilities</span><span>{formatCurrencyString(deductibleLiabilities.total, { inCurrency: 'SAR', digits: 0 })}</span></div>
                        </div>
                    </SectionCard>
                </div>

                <SectionCard title="Calculation" className="space-y-4" collapsible collapsibleSummary="Zakat due" defaultExpanded>
                     <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="use-nisab-amount" checked={useNisabAmount} onChange={(e) => { const checked = e.target.checked; setUseNisabAmount(checked); if (!checked) updateSettings({ nisabAmount: undefined }); }} className="h-4 w-4 text-primary rounded border-gray-300" />
                            <label htmlFor="use-nisab-amount" className="text-sm font-medium text-gray-700">Set Nisab amount directly (instead of gold price)</label>
                        </div>
                        {useNisabAmount ? (
                            <div>
                                <label htmlFor="nisab-amount" className="block text-sm font-medium text-gray-700 flex items-center">Nisab amount <InfoHint text="Minimum wealth threshold in your currency. If your net zakatable wealth is below this, you do not owe Zakat. Can be set directly (e.g. from local authority) instead of using gold price × 85 grams." /></label>
                                <input type="number" id="nisab-amount" value={localNisabAmount} onChange={(e) => setLocalNisabAmount(e.target.value)} onBlur={() => { const v = parseFloat(localNisabAmount); if (Number.isFinite(v) && v > 0) updateSettings({ nisabAmount: v }); }} className="input-base mt-1" min="0" step="1" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <label htmlFor="gold-price" className="block text-sm font-medium text-gray-700 flex items-center">Price of Gold (per gram) <InfoHint text="Used to compute the Nisab threshold: Nisab = price × 85 grams. If your net zakatable wealth is below that value, you do not owe Zakat." /></label>
                                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                    <input type="number" id="gold-price" value={localGoldPrice} onChange={(e) => setLocalGoldPrice(e.target.value)} onBlur={() => { const v = parseFloat(localGoldPrice) || 275; updateSettings({ goldPrice: v }); }} className="input-base mt-0 sm:flex-1" min={0} step={0.01} />
                                    <button
                                        type="button"
                                        onClick={handleFetchLiveGold}
                                        disabled={isFetchingGold}
                                        className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isFetchingGold ? 'Fetching…' : 'Use live gold (24K / g)'}
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500">Live value uses Finnhub spot XAU/USD, converted with your app rate (USD→SAR from settings/header), then per gram (troy oz = 31.1035 g). For jewelry karats, adjust manually or use Assets commodities.</p>
                                {goldLiveNotice && (
                                    <div
                                        role="status"
                                        className={`text-sm rounded-lg px-3 py-2 border ${goldLiveNotice.type === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}
                                    >
                                        {goldLiveNotice.text}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="space-y-1 border-t border-slate-200 pt-3">
                        <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm leading-6">
                            <span className="text-gray-600">Nisab Threshold</span>
                            <span className="min-w-[130px] text-right font-medium tabular-nums text-dark">{formatCurrencyString(nisab, { inCurrency: 'SAR', digits: 0 })}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm leading-6">
                            <span className="text-gray-600">Total Zakatable Assets</span>
                            <span className="min-w-[130px] text-right font-medium tabular-nums text-dark">{formatCurrencyString(zakatableAssets.total, { inCurrency: 'SAR', digits: 0 })}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm leading-6">
                            <span className="text-gray-600">Deductible Liabilities</span>
                            <span className="min-w-[130px] text-right font-medium tabular-nums text-dark">-{formatCurrencyString(deductibleLiabilities.total, { inCurrency: 'SAR', digits: 0 })}</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-base font-semibold p-2.5 bg-gray-100 rounded-md">
                        <span className="text-gray-800">Net Zakatable Wealth</span>
                        <span className="min-w-[150px] text-right tabular-nums text-dark">{formatCurrencyString(netZakatableWealth, { inCurrency: 'SAR', digits: 0 })}</span>
                    </div>
                     <div className="flex items-center justify-center space-x-2 pt-2">
                        {isNisabMet ? ( <><CheckCircleIcon className="h-6 w-6 text-green-500" /><span className="font-semibold text-green-600">Nisab Threshold Met</span></> ) : ( <><XCircleIcon className="h-6 w-6 text-red-500" /><span className="font-semibold text-red-500">Nisab Threshold Not Met</span></> )}
                    </div>
                    <Card title="Total Zakat Due (2.5%)" value={formatCurrencyString(zakatDue, { inCurrency: 'SAR', digits: 0 })} />
                </SectionCard>

                {zakatValidationWarnings.length > 0 && (
                    <SectionCard title="Zakat validation checks" collapsible collapsibleSummary="Data quality checks" defaultExpanded>
                        <ul className="space-y-1 text-sm text-amber-800">
                            {zakatValidationWarnings.slice(0, 6).map((w, i) => (
                                <li key={`zw-${i}`}>- {w}</li>
                            ))}
                        </ul>
                    </SectionCard>
                )}
                
                 {/* Column 3: Payment Ledger */}
                <div className="section-card flex flex-col space-y-4">
                     <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-dark">Payment Progress & Ledger</h3>
                        <button onClick={() => setIsPaymentModalOpen(true)} className="px-3 py-1 bg-primary text-white rounded-md hover:bg-secondary text-sm">Record Payment</button>
                    </div>

                    <div className="space-y-3 border-b pb-4">
                        <div>
                            <div className="flex justify-between items-baseline text-sm mb-1">
                                <span className="font-medium">Paid</span>
                                <span>{formatCurrencyString(totalPaid, { inCurrency: 'SAR', digits: 0 })} / {formatCurrencyString(zakatDue, { inCurrency: 'SAR', digits: 0 })}</span>
                            </div>
                            <ProgressBar value={totalPaid} max={zakatDue > 0 ? zakatDue : 1} />
                        </div>
                        <Card 
                            title="Outstanding Zakat" 
                            value={formatCurrencyString(outstandingZakat, { inCurrency: 'SAR', digits: 0 })}
                            valueColor={outstandingZakat > 0 ? "text-danger" : "text-success"}
                        />
                        {overpaidZakat > 0 && (
                            <p className="text-xs text-emerald-700">
                                Overpaid this cycle: {formatCurrencyString(overpaidZakat, { inCurrency: 'SAR', digits: 0 })}
                            </p>
                        )}
                    </div>
                    
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {(data?.zakatPayments ?? []).map(p => (
                             <div key={p.id} className="flex justify-between items-center text-sm p-3 bg-gray-50 rounded-lg border">
                                <div className="flex items-center gap-3">
                                    <BanknotesIcon className="h-6 w-6 text-green-500 flex-shrink-0" />
                                    <div>
                                        <p className="font-semibold text-dark">{formatCurrencyString(p.amount, { inCurrency: 'SAR', digits: 0 })}</p>
                                        <p className="text-xs text-gray-500">{new Date(p.date).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                {p.notes && <p className="text-xs text-gray-600 italic text-right clamp-2-lines break-words max-w-[220px]" title={p.notes}>{p.notes}</p>}
                            </div>
                        ))}
                        {(data?.zakatPayments ?? []).length === 0 && <p className="empty-state py-4">No payments recorded yet.</p>}
                    </div>
                </div>
            </div>

            <AIAdvisor
                pageContext="analysis"
                contextData={{
                    spendingData: [
                        { category: 'Zakatable Assets', value: zakatableAssets.total },
                        { category: 'Deductible Liabilities', value: deductibleLiabilities.total },
                        { category: 'Net Zakatable Wealth', value: netZakatableWealth },
                        { category: 'Outstanding Zakat', value: outstandingZakat },
                    ],
                    trendData: (data?.zakatPayments ?? [])
                        .slice()
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map((p) => ({ month: String(p.date).slice(0, 7), value: Number(p.amount) || 0 })),
                    compositionData: [
                        { name: 'Cash', value: zakatableAssets.cash },
                        { name: 'Investments', value: zakatableAssets.investments },
                        { name: 'Commodities', value: zakatableAssets.commodities },
                    ],
                }}
                title="Zakat AI Advisor"
                subtitle="Nisab readiness, payment planning, and Zakat composition insights."
                buttonLabel="Get AI Zakat Insights"
            />

            <ZakatPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} onSave={addZakatPayment} />
        </PageLayout>
    );
};

export default Zakat;
