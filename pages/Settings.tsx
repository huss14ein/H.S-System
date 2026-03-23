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
    openHtmlForPrint,
    type WealthSummaryReportInput,
} from '../services/reportingEngine';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { computeWealthSummaryReportModel, computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import { computeMaxAbsSleeveDriftPercent } from '../services/settingsDecisionPreview';
import type { FinancialData } from '../types';

/** Largest single holding as % of total managed holdings value (personal scope). */
function computeLargestHoldingWeightPercent(data: FinancialData | null): number {
    if (!data) return 0;
    const inv = getPersonalInvestments(data);
    let total = 0;
    const values: number[] = [];
    for (const p of inv) {
        for (const h of p.holdings ?? []) {
            const v = Math.max(0, Number(h.currentValue ?? 0));
            total += v;
            values.push(v);
        }
    }
    if (total <= 0 || values.length === 0) return 0;
    return (Math.max(...values) / total) * 100;
}

const FINANCIAL_PREFERENCE_PRESETS: Record<string, { riskProfile: RiskProfile; budgetThreshold: number; driftThreshold: number }> = {
    conservative: { riskProfile: 'Conservative', budgetThreshold: 80, driftThreshold: 3 },
    moderate: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5 },
    aggressive: { riskProfile: 'Aggressive', budgetThreshold: 95, driftThreshold: 8 },
};

const Settings: React.FC<{ setActivePage?: (page: Page) => void; triggerPageAction?: (page: Page, action: string) => void }> = ({ setActivePage, triggerPageAction }) => {
    const { data, loading, updateSettings, restoreFromBackup, getAvailableCashForAccount } = useContext(DataContext)!;
    const { showToast } = useToast();
    const auth = useContext(AuthContext)!;
    const { exchangeRate } = useCurrency();
    const [localSettings, setLocalSettings] = useState(data?.settings ?? {});
    const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
    const [auditFilter, setAuditFilter] = useState<{ entity?: AuditEntity; search: string }>({ search: '' });
    const [capitalPreviewAmount, setCapitalPreviewAmount] = useState(50000);
    const [tradingPolicyLocal, setTradingPolicyLocal] = useState<TradingPolicy>(() => loadTradingPolicy());
    const ef = useEmergencyFund(data ?? null);

    const liquidCashSar = useMemo(() => {
        const accounts = getPersonalAccounts(data);
        return accounts
            .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
            .reduce((s: number, a: { balance?: number }) => s + Math.max(0, Number(a.balance) || 0), 0);
    }, [data]);

    const sleeveDriftPct = useMemo(() => computeMaxAbsSleeveDriftPercent(data), [data]);

    /** Live inputs for buyScore — derived from portfolio, trading policy, and sleeve drift (same engine as Wealth Ultra). */
    const liveDecisionInputs = useMemo(() => {
        const largestPct = computeLargestHoldingWeightPercent(data);
        const maxPct = Math.min(50, Math.max(5, tradingPolicyLocal.maxPositionWeightPct));
        const driftThresholdSetting = Math.min(15, Math.max(0, Number(localSettings?.driftThreshold ?? 5)));
        const driftForScore = sleeveDriftPct ?? 0;
        return {
            maxPositionPct: maxPct,
            currentPositionPct: Math.min(50, Math.round(largestPct)),
            /** Passed to buyScore: actual max |sleeve drift| when computable; else 0. */
            driftFromTargetPct: driftForScore,
            driftThresholdSettingPct: driftThresholdSetting,
            sleeveDriftPct,
        };
    }, [data, tradingPolicyLocal.maxPositionWeightPct, localSettings?.driftThreshold, sleeveDriftPct]);

    const capitalPreviewTouchedRef = useRef(false);
    const lastAuthUserIdRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const uid = auth.user?.id;
        if (uid !== lastAuthUserIdRef.current) {
            lastAuthUserIdRef.current = uid;
            capitalPreviewTouchedRef.current = false;
        }
    }, [auth.user?.id]);

    useEffect(() => {
        if (!data || capitalPreviewTouchedRef.current) return;
        setCapitalPreviewAmount(Math.max(5000, Math.round(liquidCashSar * 0.15)));
    }, [data, liquidCashSar]);

    const capitalRanks = useMemo(() => rankCapitalUses(Math.max(0, capitalPreviewAmount)), [capitalPreviewAmount]);
    const sampleBuyScore = useMemo(
        () =>
            buyScore({
                emergencyFundMonths: ef.monthsCovered,
                runwayMonths: ef.monthsCovered,
                maxPositionPct: liveDecisionInputs.maxPositionPct,
                currentPositionPct: liveDecisionInputs.currentPositionPct,
                driftFromTargetPct: liveDecisionInputs.driftFromTargetPct,
            }),
        [ef.monthsCovered, liveDecisionInputs]
    );

    const wealthSummaryPayload = useMemo((): WealthSummaryReportInput | null => {
        if (!data) return null;
        const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
        return computeWealthSummaryReportModel(data, sarPerUsd, getAvailableCashForAccount).wealthSummaryReportPayload;
    }, [data, exchangeRate, getAvailableCashForAccount]);

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

    useEffect(() => { refreshAuditRef.current(); }, [data?.transactions?.length, auditFilter.entity]);

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
                const { data: users, error: pendingErr } = await supabase
                    .from('users')
                    .select('id, name, email, created_at')
                    .eq('approved', false)
                    .order('created_at', { ascending: false });
                const missingApprovalColumn =
                    pendingErr &&
                    (pendingErr.code === '42703' ||
                        (typeof pendingErr.message === 'string' && pendingErr.message.includes('approved')));
                if (missingApprovalColumn) {
                    setPendingUsers([]);
                } else if (pendingErr) {
                    console.warn('Could not load pending signups:', pendingErr.message);
                    setPendingUsers([]);
                } else {
                    setPendingUsers(users ?? []);
                }
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
        <div className="page-container relative">
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
                <div className="mt-6 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 p-5 sm:p-6">
                    <p className="text-slate-700 leading-relaxed text-sm sm:text-base">
                        Personalize how the app works for you: risk level, alerts, notifications, and data. Look for the{' '}
                        <span
                            className="inline-flex h-5 w-5 align-middle items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-600 mx-0.5"
                            aria-hidden
                        >
                            !
                        </span>{' '}
                        icon — hover (or tap on mobile) to read a short explanation. No finance degree needed.
                    </p>
                </div>
            </div>

            <div className="space-y-6 sm:space-y-8">
            <SectionCard id="settings-snapshot" title="Settings Snapshot" collapsible collapsibleSummary="Risk, budget, drift" defaultExpanded>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <SnapshotMetricCard
                        variant="risk"
                        label="Risk profile"
                        value={String(localSettings?.riskProfile ?? '—')}
                        hint="Drives guidance across investing and planning. Conservative = lower volatility; Aggressive = higher growth tolerance."
                    />
                    <SnapshotMetricCard
                        variant="budget"
                        label="Budget alert"
                        value={`${localSettings?.budgetThreshold ?? 90}%`}
                        percent={Number(localSettings?.budgetThreshold ?? 90)}
                        hint="You get a heads-up when spending reaches this share of your monthly budget."
                    />
                    <SnapshotMetricCard
                        variant="drift"
                        label="Drift threshold"
                        value={`${localSettings?.driftThreshold ?? 5}%`}
                        percent={Math.min(100, (Number(localSettings?.driftThreshold ?? 5) / 20) * 100)}
                        hint="Alerts when portfolio allocation drifts this far from your targets (percentage points)."
                    />
                    <SnapshotMetricCard
                        variant="email"
                        label="Email summary"
                        value={localSettings?.enableEmails ? 'Enabled' : 'Disabled'}
                        on={Boolean(localSettings?.enableEmails)}
                        hint="Periodic summary emails with highlights from your data (if enabled)."
                    />
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
                            <button type="button" onClick={() => (triggerPageAction ? triggerPageAction('Investments', 'investment-tab:Investment Plan') : setActivePage?.('Investment Plan'))} className="px-3 py-1.5 text-sm rounded-lg border border-primary/30 text-primary hover:bg-primary/5">Investment Plan</button>
                            <button type="button" onClick={() => setActivePage?.('Wealth Ultra')} className="btn-outline text-violet-700 border-violet-300 hover:bg-violet-50">Open Wealth Ultra</button>
                        </>
                    )}
                </div>
            </SectionCard>

            <SectionCard id="decision-preview" title="Decision preview (rules)" collapsible collapsibleSummary="Buy score, allocation">
                <p className="text-sm text-slate-600 mb-4">
                    <strong className="text-slate-800">Fully automated from your data:</strong> largest holding weight, live sleeve drift (Wealth Ultra targets), policy caps, and runway refresh when investments or settings change. Lump-sum tracks liquid until you edit it.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Policy max position</p>
                        <p className="text-lg font-bold tabular-nums text-indigo-950">{liveDecisionInputs.maxPositionPct}%</p>
                    </div>
                    <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Largest holding</p>
                        <p className="text-lg font-bold tabular-nums text-sky-950">{liveDecisionInputs.currentPositionPct}%</p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Sleeve drift (max)</p>
                        <p className="text-lg font-bold tabular-nums text-amber-950">
                            {liveDecisionInputs.sleeveDriftPct == null ? '—' : `${liveDecisionInputs.sleeveDriftPct}%`}
                        </p>
                        <p className="text-[10px] text-amber-800/90 mt-0.5">Alert at {liveDecisionInputs.driftThresholdSettingPct}% (Financial preferences)</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Runway</p>
                        <p className="text-lg font-bold tabular-nums text-emerald-950">{ef.monthsCovered.toFixed(1)} mo</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1 flex flex-wrap items-center gap-2">
                                Windfall / lump sum (SAR)
                                <span className="text-xs font-normal text-slate-500">Default ≈ 15% of liquid cash — edit to simulate</span>
                            </label>
                            <input
                                id="cap-prev"
                                type="number"
                                min={0}
                                step={1000}
                                value={capitalPreviewAmount}
                                onChange={(e) => {
                                    capitalPreviewTouchedRef.current = true;
                                    setCapitalPreviewAmount(Number(e.target.value) || 0);
                                }}
                                className="input-base w-full max-w-[200px]"
                            />
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
                    <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/25 p-5">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Buy score (0–100)</p>
                        <p className="text-4xl font-bold text-primary tabular-nums">{sampleBuyScore}</p>
                        <p className="text-xs text-slate-600 mt-2">
                            From decisionEngine: runway, trading policy max position, largest holding weight, and live sleeve drift (Wealth Ultra allocation vs targets). Drift alert % in Financial preferences is shown on the card above—not a substitute for measured drift.
                        </p>
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
                        <button type="button" className="btn-outline text-sm" onClick={() => triggerPageAction ? triggerPageAction('Engines & Tools', 'openRiskTradingHub') : setActivePage?.('Engines & Tools')}>
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

            <SectionCard id="reports-export" title="Reports & export" collapsible collapsibleSummary="Wealth summary, backup">
                <p className="text-sm text-slate-600 mb-4">Generate structured reports and exports. Wealth summary includes net worth, cashflow, holdings, and risk metrics.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Wealth summary</p>
                        <div className="flex flex-wrap gap-2">
                            {wealthSummaryPayload && (
                                <>
                                    <button type="button" className="btn-outline text-sm" onClick={() => { const j = generateWealthSummaryReportJson(wealthSummaryPayload); const blob = new Blob([j], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); showToast('Wealth summary exported.', 'success'); }}>JSON</button>
                                    <button type="button" className="btn-outline text-sm" onClick={() => { const c = generateWealthSummaryReportCsv(wealthSummaryPayload); const blob = new Blob([c], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finova-wealth-summary-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); showToast('Wealth summary exported.', 'success'); }}>CSV</button>
                                    <button
                                        type="button"
                                        className="btn-outline text-sm"
                                        onClick={() => {
                                            const h = generateWealthSummaryReportHtml(wealthSummaryPayload);
                                            if (!openHtmlForPrint(h)) showToast('Allow pop-ups to print.', 'error');
                                        }}
                                    >
                                        Print HTML
                                    </button>
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
                            if (!data || !wealthSummaryPayload) {
                                showToast('Add accounts and data to generate a monthly report.', 'error');
                                return;
                            }
                            const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
                            const { budgetVariance, roi } = computeMonthlyReportFinancialKpis(data, sarPerUsd, getAvailableCashForAccount);
                            const report = generateMonthlyReport({
                                periodLabel: new Date().toISOString().slice(0, 7),
                                netWorth: wealthSummaryPayload.netWorth,
                                liquidNetWorth: wealthSummaryPayload.liquidNetWorth,
                                monthlyIncome: wealthSummaryPayload.monthlyIncome,
                                monthlyExpenses: wealthSummaryPayload.monthlyExpenses,
                                monthlyPnL: wealthSummaryPayload.monthlyPnL,
                                budgetVariance,
                                roi,
                            });
                            const blob = new Blob([report], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-monthly-report-${new Date().toISOString().slice(0, 7)}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                            showToast('Monthly report exported.', 'success');
                        }}
                        className="btn-outline text-sm"
                    >
                        Monthly report (JSON)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!data?.goals?.length) {
                                showToast('No goals to export.', 'info');
                                return;
                            }
                            const csv = exportGoalStatus({
                                goals: data.goals.map((g) => ({
                                    id: g.id,
                                    name: g.name,
                                    targetAmount: g.targetAmount ?? 0,
                                    currentAmount: g.currentAmount ?? 0,
                                    deadline: String(g.deadline ?? ''),
                                })),
                            });
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-goals-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                            showToast('Goal status exported.', 'success');
                        }}
                        className="btn-outline text-sm"
                    >
                        Goal status (CSV)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!data) return;
                            const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
                            const positions = inv.flatMap((p: { holdings?: { symbol?: string; currentValue?: number; avgCost?: number; quantity?: number }[] }) =>
                                (p.holdings ?? []).map((h) => {
                                    const qty = Number(h.quantity ?? 0);
                                    const avg = Number(h.avgCost ?? 0);
                                    const val = Number(h.currentValue ?? 0);
                                    const costBasis = qty * avg;
                                    const plPct = costBasis > 0 ? ((val - costBasis) / costBasis) * 100 : 0;
                                    return {
                                        symbol: String(h.symbol ?? ''),
                                        marketValue: val,
                                        avgCost: avg,
                                        plPct,
                                        sleeve: '',
                                    };
                                })
                            );
                            if (positions.length === 0) {
                                showToast('No investment holdings to export.', 'info');
                                return;
                            }
                            const csv = exportPortfolioReview({ positions });
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `finova-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                            showToast('Portfolio review exported.', 'success');
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

function SnapshotMetricCard({
    variant,
    label,
    value,
    hint,
    percent,
    on,
}: {
    variant: 'risk' | 'budget' | 'drift' | 'email';
    label: string;
    value: string;
    hint: string;
    /** 0–100 for bar fill */
    percent?: number;
    on?: boolean;
}) {
    const border =
        variant === 'risk'
            ? 'border-l-indigo-500'
            : variant === 'budget'
              ? 'border-l-amber-500'
              : variant === 'drift'
                ? 'border-l-teal-500'
                : 'border-l-emerald-500';

    const riskVisual =
        value === 'Conservative'
            ? { pill: 'bg-slate-100 text-slate-800 ring-1 ring-slate-200', dot: 'bg-slate-500' }
            : value === 'Moderate'
              ? { pill: 'bg-amber-50 text-amber-950 ring-1 ring-amber-200', dot: 'bg-amber-500' }
              : value === 'Aggressive'
                ? { pill: 'bg-rose-50 text-rose-950 ring-1 ring-rose-200', dot: 'bg-rose-500' }
                : { pill: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200', dot: 'bg-slate-400' };

    const barPct = percent != null && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;

    return (
        <div
            className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow ${border} border-l-4`}
        >
            <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-1">
                <div className="flex items-center gap-1 min-w-0">
                    <div
                        className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${
                            variant === 'risk'
                                ? riskVisual.dot
                                : variant === 'budget'
                                  ? 'bg-amber-500'
                                  : variant === 'drift'
                                    ? 'bg-teal-500'
                                    : on
                                      ? 'bg-emerald-500'
                                      : 'bg-slate-300'
                        }`}
                        aria-hidden
                    />
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</p>
                </div>
                <InfoHint text={hint} />
            </div>
            <div className="px-3 pb-3">
                {variant === 'risk' ? (
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold ${riskVisual.pill}`}>{value}</span>
                ) : variant === 'email' ? (
                    <span
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-bold ${on ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}
                    >
                        <span className={`h-2 w-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden />
                        {value}
                    </span>
                ) : (
                    <>
                        <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
                        <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${variant === 'budget' ? 'bg-gradient-to-r from-amber-400 to-amber-600' : 'bg-gradient-to-r from-teal-400 to-teal-600'}`}
                                style={{ width: `${barPct}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{variant === 'budget' ? 'Alert threshold' : 'Relative scale'}</p>
                    </>
                )}
            </div>
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
