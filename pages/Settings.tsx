import React, { useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { RiskProfile, Page } from '../types';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import { getDefaultWealthUltraConfig } from '../wealth-ultra';
import { getAuditLog, clearAuditLog, exportAuditLogAsCsv, type AuditLogEntry, type AuditEntity } from '../services/auditLog';
import { rankCapitalUses, buyScore } from '../services/decisionEngine';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { loadTradingPolicy, saveTradingPolicy, type TradingPolicy, DEFAULT_TRADING_POLICY, TRADING_POLICY_PRESETS } from '../services/tradingPolicy';
import { usePrivacyMask } from '../context/PrivacyContext';
import {
    generateMonthlyReport,
    exportGoalStatus,
    exportPortfolioReview,
    generateWealthSummaryReportJson,
    generateWealthSummaryReportCsv,
    generateWealthSummaryReportHtml,
    type WealthSummaryReportInput,
} from '../services/reportingEngine';
import { netCashFlowForMonth } from '../services/financeMetrics';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR, toSAR } from '../utils/currencyMath';
import { computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';

const FINANCIAL_PREFERENCE_PRESETS: Record<string, { riskProfile: RiskProfile; budgetThreshold: number; driftThreshold: number }> = {
    conservative: { riskProfile: 'Conservative', budgetThreshold: 80, driftThreshold: 3 },
    moderate: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5 },
    aggressive: { riskProfile: 'Aggressive', budgetThreshold: 95, driftThreshold: 8 },
};

const Settings: React.FC<{ setActivePage?: (page: Page) => void; triggerPageAction?: (page: Page, action: string) => void }> = ({ setActivePage, triggerPageAction }) => {
    const { data, loading, updateSettings, restoreFromBackup } = useContext(DataContext)!;
    const { showToast } = useToast();
    const auth = useContext(AuthContext)!;
    const { exchangeRate } = useCurrency();
    const [localSettings, setLocalSettings] = useState(data?.settings ?? {});
    const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
    const [auditFilter, setAuditFilter] = useState<{ entity?: AuditEntity; search: string }>({ search: '' });
    const [capitalPreviewAmount, setCapitalPreviewAmount] = useState(50000);
    const [decisionPreview, setDecisionPreview] = useState({ maxPositionPct: 20, currentPositionPct: 12, driftFromTargetPct: 4 });
    const ef = useEmergencyFund(data ?? null);

    const capitalRanks = useMemo(() => rankCapitalUses(Math.max(0, capitalPreviewAmount)), [capitalPreviewAmount]);
    const sampleBuyScore = useMemo(
        () =>
            buyScore({
                emergencyFundMonths: ef.monthsCovered,
                runwayMonths: ef.monthsCovered,
                maxPositionPct: decisionPreview.maxPositionPct,
                currentPositionPct: decisionPreview.currentPositionPct,
                driftFromTargetPct: decisionPreview.driftFromTargetPct,
            }),
        [ef.monthsCovered, decisionPreview]
    );

    const wealthSummaryPayload = useMemo((): WealthSummaryReportInput | null => {
        if (!data || !exchangeRate) return null;
        const { netWorth } = computePersonalNetWorthBreakdownSAR(data, exchangeRate);
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const { income, expenses, net } = netCashFlowForMonth(txs);
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const liquid = accounts.filter((a: { type?: string }) => ['Checking', 'Savings'].includes(a.type ?? '')).reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
        const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const holdings = inv.flatMap((p: { holdings?: { symbol?: string; currentValue?: number; avgCost?: number; quantity?: number }[]; currency?: string }) =>
            (p.holdings ?? []).map((h) => {
                const portfolioCurrency = (p.currency ?? 'USD') as 'USD' | 'SAR';
                const qty = Number(h.quantity ?? 0);
                const cost = Number(h.avgCost ?? 0);
                const val = Number(h.currentValue ?? 0);
                const costBasis = cost * qty;
                const gl = costBasis > 0 ? val - costBasis : 0;
                const glPct = costBasis > 0 ? (gl / costBasis) * 100 : 0;
                return {
                    symbol: (h.symbol ?? '').toUpperCase(),
                    name: String(h.symbol ?? ''),
                    quantity: qty,
                    avgCost: cost,
                    currentValue: val,
                    gainLoss: gl,
                    gainLossPct: glPct,
                    currency: portfolioCurrency,
                    currentValueSar: toSAR(val, portfolioCurrency, exchangeRate),
                };
            })
        );
        const managedTotal = getAllInvestmentsValueInSAR(inv, exchangeRate);
        return {
            generatedAtIso: new Date().toISOString(),
            currency: 'SAR',
            netWorth: Number(netWorth) || 0,
            netWorthTrendPct: 0,
            monthlyIncome: income,
            monthlyExpenses: expenses,
            monthlyPnL: net,
            savingsRatePct: income > 0 ? ((income - expenses) / income) * 100 : 0,
            debtToAssetRatioPct: 0,
            emergencyFundMonths: ef.monthsCovered,
            emergencyFundTargetAmount: ef.targetAmount,
            emergencyFundShortfall: ef.shortfall,
            liquidNetWorth: liquid,
            managedWealthTotal: managedTotal,
            riskLane: 'Balanced',
            liquidityRunwayMonths: ef.monthsCovered,
            disciplineScore: 50,
            investmentStyle: String(localSettings?.riskProfile ?? 'Moderate'),
            householdStressLabel: 'Not available',
            householdStressPressureMonths: 0,
            shockDrillSeverity: 'Not available',
            shockDrillEstimatedGap: 0,
            holdings,
        };
    }, [data, exchangeRate, ef, localSettings?.riskProfile]);

    const [tradingPolicyLocal, setTradingPolicyLocal] = useState<TradingPolicy>(() => loadTradingPolicy());
    const { maskSensitive, setMaskSensitive, playNotificationSound, setPlayNotificationSound } = usePrivacyMask();
    const [isAdmin, setIsAdmin] = useState(false);
    const [pendingUsers, setPendingUsers] = useState<{ id: string; name: string | null; email: string | null; created_at: string }[]>([]);
    const [approvalLoading, setApprovalLoading] = useState<string | null>(null);

    useEffect(() => {
        setLocalSettings(data?.settings ?? {});
    }, [data?.settings]);

    const tradingPolicySaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setTradingPolicyLocal(loadTradingPolicy());
    }, []);

    useEffect(() => {
        if (tradingPolicySaveRef.current) clearTimeout(tradingPolicySaveRef.current);
        tradingPolicySaveRef.current = setTimeout(() => {
            saveTradingPolicy(tradingPolicyLocal);
            tradingPolicySaveRef.current = null;
        }, 1500);
        return () => { if (tradingPolicySaveRef.current) clearTimeout(tradingPolicySaveRef.current); };
    }, [tradingPolicyLocal]);

    const refreshAudit = useCallback(() => {
        setAuditEntries(getAuditLog(100, { entity: auditFilter.entity, search: auditFilter.search || undefined }));
    }, [auditFilter.entity, auditFilter.search]);

    const refreshAuditRef = useRef(refreshAudit);
    refreshAuditRef.current = refreshAudit;

    useEffect(() => { refreshAudit(); }, [data?.transactions?.length, auditFilter.entity, refreshAudit]);

    useEffect(() => {
        const t = setTimeout(() => refreshAuditRef.current(), 400);
        return () => clearTimeout(t);
    }, [auditFilter.search]);

    useEffect(() => {
        const loadAdminAndPending = async () => {
            if (!supabase || !auth?.user) return;
            const { data: userRecord } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
            const admin = inferIsAdmin(auth.user, userRecord?.role ?? null);
            setIsAdmin(admin);
            if (admin) {
                const { data: users } = await supabase
                    .from('users')
                    .select('id, name, email, created_at')
                    .eq('approved', false)
                    .order('created_at', { ascending: false });
                setPendingUsers(users ?? []);
            }
        };
        loadAdminAndPending();
    }, [auth?.user]);

    const handleApproveUser = async (userId: string) => {
        if (!supabase) return;
        setApprovalLoading(userId);
        try {
            await supabase.rpc('approve_signup_user', { p_user_id: userId });
            setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
        } catch (e) {
            console.error('Approve failed:', e);
        } finally {
            setApprovalLoading(null);
        }
    };

    const handleRejectUser = async (userId: string) => {
        if (!supabase) return;
        setApprovalLoading(userId);
        try {
            await supabase.rpc('reject_signup_user', { p_user_id: userId });
            setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
        } catch (e) {
            console.error('Reject failed:', e);
        } finally {
            setApprovalLoading(null);
        }
    };

    const handleSettingChange = <K extends keyof typeof localSettings>(key: K, value: (typeof localSettings)[K]) => {
        const newSettings = { ...localSettings, [key]: value };
        setLocalSettings(newSettings);
        updateSettings({ [key]: value });
    };

    const accountsForEmptyCheck = (data as any)?.personalAccounts ?? data?.accounts ?? [];
const hasData = accountsForEmptyCheck.length > 0;
    const defaultWealthUltra = useMemo(() => ({ ...getDefaultWealthUltraConfig(), ...(data?.wealthUltraConfig || {}) }), [data?.wealthUltraConfig]);

    if (loading || !data) {
        return (
            <div className="page-container flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading settings" />
            </div>
        );
    }

    return (
        <div className="page-container space-y-6 sm:space-y-8 relative">
            {/* Hero Section */}
            <div className="section-card p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                            <span className="text-primary font-bold text-xl">⚙️</span>
                        </div>
                        <div>
                            <h2 className="page-title text-2xl sm:text-3xl">Settings</h2>
                            <p className="text-slate-600 mt-1">Control your profile, automation defaults, notifications, and data management.</p>
                        </div>
                    </div>
                </div>
                <nav className="mt-4 flex flex-wrap gap-2" aria-label="Settings sections">
                    {[
                        { id: 'settings-snapshot', label: 'Snapshot' },
                        { id: 'user-profile', label: 'Profile' },
                        { id: 'financial-preferences', label: 'Financial' },
                        { id: 'default-parameters', label: 'Parameters' },
                        { id: 'decision-preview', label: 'Decision rules' },
                        { id: 'trading-policy', label: 'Trading policy' },
                        { id: 'notifications', label: 'Notifications' },
                        { id: 'activity-log', label: 'Activity log' },
                        { id: 'reports-export', label: 'Reports' },
                        { id: 'data-management', label: 'Data' },
                    ].map(({ id, label }) => (
                        <a key={id} href={`#${id}`} className="text-sm px-2 py-1 rounded-md text-slate-600 hover:text-primary hover:bg-primary/10 transition-colors">{label}</a>
                    ))}
                </nav>
                <div className="mt-6 bg-slate-50 rounded-xl p-6 border border-slate-200">
                    <p className="text-slate-700 leading-relaxed">
                        Personalize how the app works for you. Set your risk comfort level, when to get alerts, and how to manage your data.
                        Each option has a (?) hint—no finance degree needed.
                    </p>
                </div>
            </div>

            <div className="space-y-6 sm:space-y-8">
            <SectionCard id="settings-snapshot" title="Settings Snapshot" collapsible collapsibleSummary="Risk, budget, drift" defaultExpanded>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <SnapCard label="Risk profile" value={localSettings?.riskProfile ?? '—'} />
                    <SnapCard label="Budget alert" value={`${localSettings?.budgetThreshold ?? 90}%`} />
                    <SnapCard label="Drift threshold" value={`${localSettings?.driftThreshold ?? 5}%`} />
                    <SnapCard label="Email summary" value={localSettings?.enableEmails ? 'Enabled' : 'Disabled'} />
                </div>
            </SectionCard>

            <SectionCard id="user-profile" title="User Profile" collapsible collapsibleSummary="Email, user ID">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <label className="block text-xs font-semibold uppercase text-slate-500">Email Address</label>
                        <p className="text-base text-slate-800 mt-1">{auth.user?.email}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <label className="block text-xs font-semibold uppercase text-slate-500">User ID</label>
                        <p className="text-xs text-slate-500 font-mono mt-1 break-all">{auth.user?.id}</p>
                    </div>
                </div>
            </SectionCard>

            {isAdmin && (
                <SectionCard id="user-approvals" title="User Approvals" className="border border-slate-200" collapsible collapsibleSummary="Pending signups">
                    <p className="text-sm text-slate-600 mb-4">Approve or reject new signups. Pending users cannot access the platform until approved.</p>
                    {pendingUsers.length === 0 ? (
                        <p className="text-slate-500 text-sm">No pending signups.</p>
                    ) : (
                        <ul className="space-y-3">
                            {pendingUsers.map((u: { id: string; name: string | null; email: string | null }) => (
                                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <div>
                                        <p className="font-medium text-slate-800">{u.name || '—'}</p>
                                        <p className="text-sm text-slate-500">{u.email || u.id}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleApproveUser(u.id)}
                                            disabled={approvalLoading === u.id}
                                            className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            {approvalLoading === u.id ? '…' : 'Approve'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleRejectUser(u.id)}
                                            disabled={approvalLoading === u.id}
                                            className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </SectionCard>
            )}

            <SectionCard id="financial-preferences" title="Financial Preferences" className="border border-slate-200" collapsible collapsibleSummary="Risk, budget, gold, nisab" defaultExpanded>
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Quick presets</label>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {Object.entries(FINANCIAL_PREFERENCE_PRESETS).map(([key, preset]) => (
                                <button key={key} type="button" onClick={() => {
                                    const updates = { riskProfile: preset.riskProfile, budgetThreshold: preset.budgetThreshold, driftThreshold: preset.driftThreshold };
                                    setLocalSettings(prev => ({ ...prev, ...updates }));
                                    updateSettings(updates);
                                  }} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-primary/5 transition-colors capitalize">{key}</button>
                            ))}
                        </div>
                        <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center">Investment Risk Profile <InfoHint text="How much risk you're comfortable with: Conservative = safer, steady. Moderate = balanced. Aggressive = higher growth potential, more volatility." /></label>
                        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
                            {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                                <button key={profile} onClick={() => handleSettingChange('riskProfile', profile)}
                                    className={`px-3 py-2 text-sm font-semibold rounded-md transition-all ${(localSettings?.riskProfile ?? '') === profile ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-white/50'}`}>
                                    {profile}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="budget-threshold" className="block text-sm font-medium text-slate-700 flex items-center">Budget Alert Threshold (%) <InfoHint text="We'll notify you when you've used this much of a category's limit. E.g. 90% = heads-up when you're 90% of the way to your limit." /></label>
                            <input id="budget-threshold" type="range" min={0} max={100} step={5} value={Math.min(100, Math.max(0, Number(localSettings?.budgetThreshold ?? 90)))} onChange={(e) => handleSettingChange('budgetThreshold', Number(e.target.value))} className="mt-2 w-full h-2 rounded-lg appearance-none bg-slate-200 accent-primary"/>
                            <span className="text-sm font-semibold text-primary mt-1 block">{Math.min(100, Math.max(0, Number(localSettings?.budgetThreshold ?? 90)))}%</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="drift-threshold" className="block text-sm font-medium text-slate-700 flex items-center">Portfolio Drift Threshold (%) <InfoHint text="When your investments shift from your target mix by more than this %, we suggest rebalancing. E.g. 5% means a small shift is fine." /></label>
                            <input id="drift-threshold" type="range" min={0} max={20} step={1} value={Math.min(20, Math.max(0, Number(localSettings?.driftThreshold ?? 5)))} onChange={(e) => handleSettingChange('driftThreshold', Number(e.target.value))} className="mt-2 w-full h-2 rounded-lg appearance-none bg-slate-200 accent-primary"/>
                            <span className="text-sm font-semibold text-primary mt-1 block">{Math.min(20, Math.max(0, Number(localSettings?.driftThreshold ?? 5)))}%</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="gold-price-settings" className="block text-sm font-medium text-slate-700 flex items-center">Gold price (SAR/gram) <InfoHint text="Current gold price per gram. Used to calculate the Nisab threshold (minimum wealth before Zakat is due). Usually gold price × 85 grams." /></label>
                            <input id="gold-price-settings" type="number" min={1} max={100000} step={0.01} value={Number((localSettings as any)?.goldPrice ?? (localSettings as any)?.gold_price ?? 275)} onChange={(e) => setLocalSettings(prev => ({ ...prev, goldPrice: parseFloat(e.target.value) || 275 }))} onBlur={(e) => { const v = parseFloat(e.target.value); const fallback = Number((localSettings as any)?.goldPrice ?? (localSettings as any)?.gold_price ?? 275); if (Number.isFinite(v) && v > 0 && v <= 1e6) updateSettings({ goldPrice: v }); else setLocalSettings(prev => ({ ...prev, goldPrice: fallback })); }} className="mt-2 w-full input-base" />
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="nisab-amount-settings" className="block text-sm font-medium text-slate-700 flex items-center">Nisab amount override (SAR) <InfoHint text="Optional. If your authority uses a different Nisab, enter it here. Otherwise leave empty and we'll use gold price × 85 grams." /></label>
                            <input id="nisab-amount-settings" type="number" min={0} max={10000000} step={1} placeholder="Auto (gold × 85)" value={((localSettings as any)?.nisabAmount ?? (localSettings as any)?.nisab_amount) ?? ''} onChange={(e) => setLocalSettings(prev => ({ ...prev, nisabAmount: e.target.value ? parseFloat(e.target.value) : undefined }))} onBlur={(e) => { if (e.target.value === '') { updateSettings({ nisabAmount: undefined }); } else { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) updateSettings({ nisabAmount: v }); else setLocalSettings(prev => ({ ...prev, nisabAmount: undefined })); } }} className="mt-2 w-full input-base" />
                        </div>
                    </div>
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3 cursor-pointer">
                        <span className="text-sm text-slate-700">
                            <span className="font-medium">Mask balances</span>
                            <p className="text-xs text-slate-500 mt-0.5">Hide currency amounts on Dashboard, Summary, and Accounts (shows ••••). This device only.</p>
                        </span>
                        <input
                            type="checkbox"
                            className="h-5 w-5 rounded border-slate-300 text-primary"
                            checked={maskSensitive}
                            onChange={(e) => setMaskSensitive(e.target.checked)}
                        />
                    </label>
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3 cursor-pointer">
                        <span className="text-sm text-slate-700">
                            <span className="font-medium">Notification sound</span>
                            <p className="text-xs text-slate-500 mt-0.5">Short beep when the header notification count increases or you open the bell with unread items. Uses Web Audio (no file). This device only.</p>
                        </span>
                        <input
                            type="checkbox"
                            className="h-5 w-5 rounded border-slate-300 text-primary"
                            checked={playNotificationSound}
                            onChange={(e) => setPlayNotificationSound(e.target.checked)}
                        />
                    </label>
                </div>
            </SectionCard>

            <SectionCard id="default-parameters" title="Enhanced Default Parameters" collapsible collapsibleSummary="Wealth Ultra params">
                <p className="text-sm text-slate-600 mb-3 flex items-center">
                    <InfoHint text="Baseline parameters for Wealth Ultra and related flows. If your Supabase project has wealth_ultra_config (user row or global row), those values are merged on load and reflected here." />
                    Source: app defaults + optional DB (<code className="text-xs bg-slate-100 px-1 rounded">wealth_ultra_config</code>) + sleeve targets below
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                    <ParamCard label="FX rate (USD→SAR)" value={(defaultWealthUltra?.fxRate ?? 0).toFixed(4)} hint="Conversion baseline" />
                    <ParamCard label="Monthly deposit" value={`$${Math.round(defaultWealthUltra?.monthlyDeposit ?? 0).toLocaleString()}`} hint="Deployment budget" />
                    <ParamCard label="Cash reserve" value={`${defaultWealthUltra?.cashReservePct ?? 0}%`} hint="Liquidity guardrail" />
                    <ParamCard label="Max per ticker" value={`${defaultWealthUltra?.maxPerTickerPct ?? 0}%`} hint="Concentration cap" />
                    <ParamCard label="Core target" value={`${defaultWealthUltra?.targetCorePct ?? 0}%`} hint="Stability sleeve" />
                    <ParamCard label="Upside target" value={`${defaultWealthUltra?.targetUpsidePct ?? 0}%`} hint="Growth sleeve" />
                    <ParamCard label="Spec target" value={`${defaultWealthUltra?.targetSpecPct ?? 0}%`} hint="High-risk sleeve" />
                    <ParamCard label="Target 1" value={`${defaultWealthUltra?.defaultTarget1Pct ?? 0}%`} hint="First profit trigger" />
                    <ParamCard label="Target 2" value={`${defaultWealthUltra?.defaultTarget2Pct ?? 0}%`} hint="Second profit trigger" />
                    <ParamCard label="Trailing stop" value={`${defaultWealthUltra?.defaultTrailingPct ?? 0}%`} hint="Downside lock" />
                    <ParamCard label="Risk weight (Low/Med)" value={`${defaultWealthUltra?.riskWeightLow ?? 0} / ${defaultWealthUltra?.riskWeightMed ?? 0}`} hint="Sizing multiplier" />
                    <ParamCard label="Risk weight (High/Spec)" value={`${defaultWealthUltra?.riskWeightHigh ?? 0} / ${defaultWealthUltra?.riskWeightSpec ?? 0}`} hint="Sizing multiplier" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => { navigator.clipboard.writeText(JSON.stringify(defaultWealthUltra, null, 2)); showToast('Config copied to clipboard.', 'success'); }} className="btn-outline text-sm">Copy config (JSON)</button>
                    {setActivePage && (
                        <>
                            <button type="button" onClick={() => setActivePage?.('Investment Plan')} className="px-3 py-1.5 text-sm rounded-lg border border-primary/30 text-primary hover:bg-primary/5">Investment Plan</button>
                            <button type="button" onClick={() => setActivePage?.('Wealth Ultra')} className="btn-outline text-violet-700 border-violet-300 hover:bg-violet-50">Open Wealth Ultra</button>
                        </>
                    )}
                </div>
            </SectionCard>

            <SectionCard title="Decision preview (rules)" collapsible collapsibleSummary="Buy score, allocation">
                <p className="text-sm text-slate-600 mb-4">
                    Interactive preview of capital allocation and buy-score rules. Adjust sliders to see how runway, position size, and drift affect decisions.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Windfall / lump sum (SAR)</label>
                            <input id="cap-prev" type="number" min={0} step={1000} value={capitalPreviewAmount} onChange={(e) => setCapitalPreviewAmount(Number(e.target.value) || 0)} className="input-base w-full max-w-[180px]"/>
                        </div>
                        <ul className="space-y-2 text-sm">
                            {capitalRanks.map((row) => (
                                <li key={row.use} className="flex justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                    <span className="font-medium text-slate-800 capitalize">{row.use.replace(/_/g, ' ')}</span>
                                    <span className="text-slate-600 tabular-nums">{Math.round(row.amount).toLocaleString()} SAR</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Max position %</label>
                            <input type="range" min={5} max={50} value={decisionPreview.maxPositionPct} onChange={(e) => setDecisionPreview((p) => ({ ...p, maxPositionPct: Number(e.target.value) }))} className="w-full h-2 rounded-lg appearance-none bg-slate-200 accent-primary"/>
                            <span className="text-xs text-slate-500">{decisionPreview.maxPositionPct}%</span>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Current position %</label>
                            <input type="range" min={0} max={50} value={decisionPreview.currentPositionPct} onChange={(e) => setDecisionPreview((p) => ({ ...p, currentPositionPct: Number(e.target.value) }))} className="w-full h-2 rounded-lg appearance-none bg-slate-200 accent-primary"/>
                            <span className="text-xs text-slate-500">{decisionPreview.currentPositionPct}%</span>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Drift from target %</label>
                            <input type="range" min={0} max={15} value={decisionPreview.driftFromTargetPct} onChange={(e) => setDecisionPreview((p) => ({ ...p, driftFromTargetPct: Number(e.target.value) }))} className="w-full h-2 rounded-lg appearance-none bg-slate-200 accent-primary"/>
                            <span className="text-xs text-slate-500">{decisionPreview.driftFromTargetPct}%</span>
                        </div>
                        <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
                            <p className="text-xs text-slate-600 mb-1">Buy score (0–100) with ~{ef.monthsCovered.toFixed(1)} mo runway</p>
                            <p className="text-2xl font-bold text-primary tabular-nums">{sampleBuyScore}</p>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard id="trading-policy" title="Trading policy (this device)" collapsible collapsibleSummary="Runway, position caps" defaultExpanded>
                <p className="text-sm text-slate-600 mb-3">Used when recording buys in Investments: runway, cashflow, and position caps. Large sells may require confirmation. Changes auto-save after 1.5s.</p>
                <div className="flex flex-wrap gap-2 mb-4">
                    {Object.entries(TRADING_POLICY_PRESETS).map(([key, preset]) => (
                        <button key={key} type="button" onClick={() => setTradingPolicyLocal({ ...preset })} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-primary/5 transition-colors capitalize">{key}</button>
                    ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <label className="flex flex-col gap-1">
                        <span className="font-medium text-slate-700">Min runway (months) to allow buys</span>
                        <input
                            type="number"
                            min={0}
                            step={0.5}
                            className="input-base"
                            value={tradingPolicyLocal.minRunwayMonthsToAllowBuys}
                            onChange={(e) =>
                                setTradingPolicyLocal((p) => ({
                                    ...p,
                                    minRunwayMonthsToAllowBuys: Math.max(0, Number(e.target.value) || 0),
                                }))
                            }
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-medium text-slate-700">Max position weight after buy (%)</span>
                        <input
                            type="number"
                            min={5}
                            max={100}
                            className="input-base"
                            value={tradingPolicyLocal.maxPositionWeightPct}
                            onChange={(e) =>
                                setTradingPolicyLocal((p) => ({
                                    ...p,
                                    maxPositionWeightPct: Math.min(100, Math.max(5, Number(e.target.value) || DEFAULT_TRADING_POLICY.maxPositionWeightPct)),
                                }))
                            }
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-medium text-slate-700">Ack large sell over (SAR notional)</span>
                        <input
                            type="number"
                            min={0}
                            step={1000}
                            className="input-base"
                            value={tradingPolicyLocal.requireAckLargeSellNotional}
                            onChange={(e) =>
                                setTradingPolicyLocal((p) => ({
                                    ...p,
                                    requireAckLargeSellNotional: Math.max(0, Number(e.target.value) || 0),
                                }))
                            }
                        />
                    </label>
                    <label className="flex items-center gap-2 mt-6 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={tradingPolicyLocal.blockBuysIfMonthlyNetNegative}
                            onChange={(e) =>
                                setTradingPolicyLocal((p) => ({ ...p, blockBuysIfMonthlyNetNegative: e.target.checked }))
                            }
                        />
                        <span>Block buys if last-30d net cashflow is negative</span>
                    </label>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                    <button
                        type="button"
                        className="btn-primary text-sm"
                        onClick={() => {
                            saveTradingPolicy(tradingPolicyLocal);
                            showToast('Trading policy saved.', 'success');
                        }}
                    >
                        Save policy
                    </button>
                    <button
                        type="button"
                        className="btn-outline text-sm"
                        onClick={() => setTradingPolicyLocal({ ...DEFAULT_TRADING_POLICY })}
                    >
                        Reset defaults
                    </button>
                    {setActivePage && (
                        <button type="button" className="btn-outline text-sm" onClick={() => triggerPageAction ? triggerPageAction('Investments', 'openRiskTradingHub') : setActivePage?.('Investments')}>
                            Safety &amp; rules
                        </button>
                    )}
                </div>
            </SectionCard>

            <SectionCard id="notifications" title="Notifications" collapsible collapsibleSummary="Email reports">
                <label htmlFor="email-toggle" className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-700">
                        <span className="font-medium flex items-center">Weekly Email Reports <InfoHint text="When enabled, you receive a weekly summary of budgets, net worth, and alerts (if the feature is configured)." /></span>
                        <p className="text-xs text-slate-500 mt-0.5">Receive a summary of your financial health every week.</p>
                    </span>
                    <div className="relative inline-block w-10 h-6">
                        <input id="email-toggle" type="checkbox" className="sr-only" checked={localSettings?.enableEmails ?? false}
                                onChange={(e) => handleSettingChange('enableEmails', e.target.checked)} />
                        <div className={`block w-10 h-6 rounded-full transition ${(localSettings?.enableEmails ?? false) ? 'bg-primary' : 'bg-slate-200'}`}></div>
                        <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow transition ${(localSettings?.enableEmails ?? false) ? 'translate-x-4' : ''}`}></div>
                    </div>
                </label>
            </SectionCard>

            <SectionCard id="activity-log" title="Activity log (this device)" collapsible collapsibleSummary="Recent changes">
                <p className="text-sm text-slate-600 mb-3">Recent creates/updates/deletes logged in this browser. Filter, search, or export. Clear if you share the device.</p>
                <div className="flex flex-wrap gap-2 mb-3">
                    <input type="text" placeholder="Search..." value={auditFilter.search} onChange={(e) => setAuditFilter((f) => ({ ...f, search: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && refreshAudit()} className="input-base w-40 text-sm" aria-label="Search activity log"/>
                    <select value={auditFilter.entity ?? ''} onChange={(e) => setAuditFilter((f) => ({ ...f, entity: (e.target.value || undefined) as AuditEntity | undefined }))} className="input-base w-32 text-sm">
                        <option value="">All entities</option>
                        {['transaction', 'account', 'goal', 'budget', 'liability', 'asset'].map((ent) => (
                            <option key={ent} value={ent}>{ent}</option>
                        ))}
                    </select>
                    <button type="button" className="btn-outline text-sm" onClick={refreshAudit} title="Refresh list with current filters (Enter in search)">Refresh</button>
                    {auditEntries.length > 0 && (
                        <button type="button" className="btn-outline text-sm" onClick={() => { const csv = exportAuditLogAsCsv(auditEntries); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finova-activity-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); showToast('Activity log exported.', 'success'); }}>Export CSV</button>
                    )}
                    <button type="button" className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50" onClick={() => { clearAuditLog(); setAuditEntries([]); showToast('Activity log cleared.', 'success'); }}>Clear log</button>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 text-xs divide-y divide-slate-100">
                    {auditEntries.length === 0 ? (
                        <p className="p-4 text-slate-500">No entries yet. Add or edit transactions to populate.</p>
                    ) : (
                        auditEntries.map((e) => (
                            <div key={e.id} className="p-3 flex flex-wrap gap-x-3 gap-y-1 items-center hover:bg-slate-50/50">
                                <span className="text-slate-400 shrink-0 tabular-nums">{new Date(e.at).toLocaleString()}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${e.action === 'create' ? 'bg-emerald-100 text-emerald-800' : e.action === 'update' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{e.action}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{e.entity}</span>
                                <span className="text-slate-700 truncate max-w-full flex-1 min-w-0">{e.summary}</span>
                            </div>
                        ))
                    )}
                </div>
            </SectionCard>

            <SectionCard title="Reports & export" collapsible collapsibleSummary="Wealth summary, backup">
                <p className="text-sm text-slate-600 mb-4">Generate structured reports and exports. Wealth summary includes net worth, cashflow, holdings, and risk metrics.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Wealth summary</p>
                        <div className="flex flex-wrap gap-2">
                            {wealthSummaryPayload && (
                                <>
                                    <button type="button" className="btn-outline text-sm" onClick={() => { const j = generateWealthSummaryReportJson(wealthSummaryPayload); const blob = new Blob([j], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); showToast('Wealth summary exported.', 'success'); }}>JSON</button>
                                    <button type="button" className="btn-outline text-sm" onClick={() => { const c = generateWealthSummaryReportCsv(wealthSummaryPayload); const blob = new Blob([c], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); showToast('Wealth summary exported.', 'success'); }}>CSV</button>
                                    <button type="button" className="btn-outline text-sm" onClick={() => { const h = generateWealthSummaryReportHtml(wealthSummaryPayload); const w = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760'); if (w) { w.document.write(h); w.document.close(); w.print(); } }}>Print HTML</button>
                                </>
                            )}
                            {!wealthSummaryPayload && <span className="text-xs text-slate-500">Add data to generate.</span>}
                        </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Other exports</p>
                        <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            if (!data) return;
                            const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
                            const { income, expenses, net } = netCashFlowForMonth(txs);
                            const nw = (data as any)?.personalAccounts ?? data?.accounts ?? [];
                            const liquid = nw.filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
                            const report = generateMonthlyReport({
                                periodLabel: new Date().toISOString().slice(0, 7),
                                netWorth: 0,
                                liquidNetWorth: liquid,
                                monthlyIncome: income,
                                monthlyExpenses: expenses,
                                monthlyPnL: net,
                                budgetVariance: 0,
                                roi: 0,
                            });
                            const blob = new Blob([report], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-monthly-report-${new Date().toISOString().slice(0, 7)}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        className="btn-outline text-sm"
                    >
                        Monthly report (JSON)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!data?.goals) return;
                            const csv = exportGoalStatus({
                                goals: data.goals.map((g: { id: string; name: string; targetAmount: number; currentAmount: number; deadline: string }) => ({
                                    id: g.id,
                                    name: g.name,
                                    targetAmount: g.targetAmount ?? 0,
                                    currentAmount: g.currentAmount ?? 0,
                                    deadline: (g.deadline ?? '').toString(),
                                })),
                            });
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-goals-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        className="btn-outline text-sm"
                    >
                        Goal status (CSV)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
                            const positions = inv.flatMap((p: { holdings?: { symbol?: string; currentValue?: number; avgCost?: number; percentage?: number }[] }) =>
                                (p.holdings ?? []).map((h: { symbol?: string; currentValue?: number; avgCost?: number; percentage?: number }) => ({
                                    symbol: h.symbol ?? '',
                                    marketValue: h.currentValue ?? 0,
                                    avgCost: h.avgCost ?? 0,
                                    plPct: 0,
                                    sleeve: '',
                                }))
                            );
                            const csv = exportPortfolioReview({ positions });
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        className="btn-outline text-sm"
                    >
                        Portfolio review (CSV)
                    </button>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard id="data-management" title="Data Management" collapsible collapsibleSummary="Backup, restore">
                <div className="space-y-4">
                    {hasData ? (
                        <>
                            <p className="text-sm text-slate-600">
                                Save a copy of all your data (accounts, transactions, goals, budgets, investments) to your computer. Use Import to restore from a saved backup.
                            </p>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" onClick={() => {
                                    const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `finova-backup-${new Date().toISOString().slice(0, 10)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    showToast('Backup exported.', 'success');
                                }} className="btn-primary">
                                    Export full backup (JSON)
                                </button>
                                <label className="btn-outline cursor-pointer">
                                    Import from backup
                                    <input
                                        type="file"
                                        accept=".json,application/json"
                                        className="sr-only"
                                        onChange={async (e) => {
                                            const f = e.target.files?.[0];
                                            if (!f || !restoreFromBackup) return;
                                            e.target.value = '';
                                            try {
                                                const text = await f.text();
                                                const backup = JSON.parse(text) as Record<string, unknown>;
                                                if (!backup || typeof backup !== 'object') {
                                                    showToast('Invalid backup file.', 'error');
                                                    return;
                                                }
                                                if (!window.confirm('This will replace all your current data with the backup. Continue?')) return;
                                                const { ok, error } = await restoreFromBackup(backup);
                                                if (ok) showToast('Backup restored.', 'success');
                                                else showToast(error ?? 'Restore failed.', 'error');
                                            } catch {
                                                showToast('Could not read backup file.', 'error');
                                            }
                                        }}
                                    />
                                </label>
                                {setActivePage && (
                                    <button type="button" onClick={() => setActivePage('Statement Upload')} className="btn-outline">
                                        Import from statements
                                    </button>
                                )}
                            </div>
                            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                                <strong>Tip:</strong> Export monthly or before big changes. Activity log and trading policy are stored on this device only—use Export CSV above to save them.
                            </div>
                        </>
                    ) : (
                        <div className="rounded-xl border border-slate-200 p-6 bg-slate-50/50 text-center">
                            <p className="text-sm text-slate-600 mb-3">No data yet. Add your first account or import from bank statements to get started.</p>
                            {setActivePage && (
                                <div className="flex flex-wrap justify-center gap-2">
                                    <button type="button" onClick={() => setActivePage('Accounts')} className="btn-outline text-sm">Add accounts</button>
                                    <button type="button" onClick={() => setActivePage('Statement Upload')} className="btn-primary text-sm">Import statements</button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </SectionCard>
            </div>
        </div>
    );
};

function SnapCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-white/70 bg-white/90 px-3 py-2">
            <p className="text-[11px] text-slate-500">{label}</p>
            <p className="text-sm font-semibold text-slate-800">{value}</p>
        </div>
    );
}

function ParamCard({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
            <p className="text-xs uppercase tracking-wide text-slate-500 w-full">{label}</p>
            <p className="text-base font-semibold text-slate-800 w-full mt-1">{value}</p>
            <p className="text-xs text-slate-500 mt-1">{hint}</p>
        </div>
    );
}

export default Settings;
