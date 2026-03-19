import React, { useContext, useState, useEffect, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { RiskProfile, Page } from '../types';
import { supabase } from '../services/supabaseClient';
import { inferIsAdmin } from '../utils/role';
import InfoHint from '../components/InfoHint';
import SectionCard from '../components/SectionCard';
import { getDefaultWealthUltraConfig } from '../wealth-ultra';
import { getAuditLog, clearAuditLog } from '../services/auditLog';
import { rankCapitalUses, buyScore } from '../services/decisionEngine';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { loadTradingPolicy, saveTradingPolicy, type TradingPolicy, DEFAULT_TRADING_POLICY } from '../services/tradingPolicy';
import { usePrivacyMask } from '../context/PrivacyContext';
import { generateMonthlyReport, exportGoalStatus, exportPortfolioReview } from '../services/reportingEngine';
import { netCashFlowForMonth } from '../services/financeMetrics';

const Settings: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading, updateSettings } = useContext(DataContext)!;
    const auth = useContext(AuthContext)!;
    const [localSettings, setLocalSettings] = useState(data?.settings ?? {});
    const [auditEntries, setAuditEntries] = useState<ReturnType<typeof getAuditLog>>([]);
    const [capitalPreviewAmount, setCapitalPreviewAmount] = useState(50000);
    const ef = useEmergencyFund(data ?? null);
    const capitalRanks = useMemo(() => rankCapitalUses(Math.max(0, capitalPreviewAmount)), [capitalPreviewAmount]);
    const sampleBuyScore = useMemo(
        () =>
            buyScore({
                emergencyFundMonths: ef.monthsCovered,
                runwayMonths: ef.monthsCovered,
                maxPositionPct: 20,
                currentPositionPct: 12,
                driftFromTargetPct: 4,
            }),
        [ef.monthsCovered]
    );

    const [tradingPolicyLocal, setTradingPolicyLocal] = useState<TradingPolicy>(() => loadTradingPolicy());
    const { maskSensitive, setMaskSensitive, playNotificationSound, setPlayNotificationSound } = usePrivacyMask();

    useEffect(() => {
        setLocalSettings(data?.settings ?? {});
    }, [data?.settings]);

    useEffect(() => {
        setTradingPolicyLocal(loadTradingPolicy());
    }, []);

    useEffect(() => {
        setAuditEntries(getAuditLog(80));
    }, [data?.transactions?.length]);

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
        <div className="page-container space-y-6 sm:space-y-8">
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
                <div className="mt-6 bg-slate-50 rounded-xl p-6 border border-slate-200">
                    <p className="text-slate-700 leading-relaxed">
                        Customize your financial experience with personalized settings, risk preferences, and automation controls.
                        Manage your profile, configure notifications, and control data management options.
                    </p>
                </div>
            </div>

            <div className="space-y-6 sm:space-y-8">
            <SectionCard title="Settings Snapshot">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <SnapCard label="Risk profile" value={localSettings?.riskProfile ?? '—'} />
                    <SnapCard label="Budget alert" value={`${localSettings?.budgetThreshold ?? 0}%`} />
                    <SnapCard label="Drift threshold" value={`${localSettings?.driftThreshold ?? 0}%`} />
                    <SnapCard label="Email summary" value={localSettings?.enableEmails ? 'Enabled' : 'Disabled'} />
                </div>
            </SectionCard>

            <SectionCard title="User Profile">
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
                <SectionCard title="User Approvals" className="border border-slate-200">
                    <p className="text-sm text-slate-600 mb-4">Approve or reject new signups. Pending users cannot access the platform until approved.</p>
                    {pendingUsers.length === 0 ? (
                        <p className="text-slate-500 text-sm">No pending signups.</p>
                    ) : (
                        <ul className="space-y-3">
                            {pendingUsers.map((u) => (
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

            <SectionCard title="Financial Preferences" className="border border-slate-200">
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center">Investment Risk Profile <InfoHint text="Guides AI and plan suggestions: Conservative (stability), Moderate (balanced), Aggressive (growth)." /></label>
                        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1">
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
                            <label htmlFor="budget-threshold" className="block text-sm font-medium text-slate-700 flex items-center">Budget Alert Threshold (%) <InfoHint text="You get notified when a budget category reaches this percentage of its limit (e.g. 90%)." /></label>
                            <input id="budget-threshold" type="number" value={localSettings?.budgetThreshold ?? 0}
                                onChange={(e) => handleSettingChange('budgetThreshold', Number(e.target.value))}
                                className="input-base mt-2"/>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="drift-threshold" className="block text-sm font-medium text-slate-700 flex items-center">Portfolio Drift Threshold (%) <InfoHint text="Rebalancing alerts when an asset’s weight drifts from target by more than this percent." /></label>
                            <input id="drift-threshold" type="number" value={localSettings?.driftThreshold ?? 0}
                                onChange={(e) => handleSettingChange('driftThreshold', Number(e.target.value))}
                                className="input-base mt-2"/>
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

            <SectionCard title="Enhanced Default Parameters">
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
                {setActivePage && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setActivePage?.('Investment Plan')} className="px-3 py-1.5 text-sm rounded-lg border border-primary/30 text-primary hover:bg-primary/5">Investment Plan</button>
                        <button type="button" onClick={() => setActivePage?.('Wealth Ultra')} className="btn-outline text-violet-700 border-violet-300 hover:bg-violet-50">Open Wealth Ultra</button>
                    </div>
                )}
            </SectionCard>

            <SectionCard title="Decision preview (rules)">
                <p className="text-sm text-slate-600 mb-3">
                    Illustrative splits from <code className="text-xs bg-slate-100 px-1 rounded">rankCapitalUses</code> and a sample{' '}
                    <code className="text-xs bg-slate-100 px-1 rounded">buyScore</code> using your emergency-fund runway—not personalized advice.
                </p>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <label htmlFor="cap-prev" className="text-sm font-medium text-slate-700">Windfall / lump sum (SAR)</label>
                    <input
                        id="cap-prev"
                        type="number"
                        min={0}
                        step={1000}
                        value={capitalPreviewAmount}
                        onChange={(e) => setCapitalPreviewAmount(Number(e.target.value) || 0)}
                        className="input-base w-36"
                    />
                </div>
                <ul className="space-y-2 text-sm mb-4">
                    {capitalRanks.map((row) => (
                        <li key={row.use} className="flex justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <span className="font-medium text-slate-800 capitalize">{row.use.replace(/_/g, ' ')}</span>
                            <span className="text-slate-600">{Math.round(row.amount).toLocaleString()} SAR</span>
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-slate-600">
                    Sample buy-score (0–100) given your ~{ef.monthsCovered.toFixed(1)} mo emergency coverage:{' '}
                    <strong className="text-primary">{sampleBuyScore}</strong>
                </p>
            </SectionCard>

            <SectionCard title="Trading policy (this device)">
                <p className="text-xs text-slate-600 mb-4">
                    Used when recording <strong>buys</strong> in Investments: runway, cashflow, and position caps. Large sells may require confirmation.
                </p>
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
                            alert('Trading policy saved on this device.');
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
                        <button type="button" className="btn-outline text-sm" onClick={() => setActivePage('Risk & Trading Hub')}>
                            Risk &amp; Trading hub
                        </button>
                    )}
                </div>
            </SectionCard>

            <SectionCard title="Notifications">
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

            <SectionCard title="Activity log (this device)">
                <p className="text-sm text-slate-600 mb-3">Recent creates/updates/deletes logged in this browser (transactions). Clear if you share the device.</p>
                <div className="flex gap-2 mb-3">
                    <button type="button" className="btn-outline text-sm" onClick={() => setAuditEntries(getAuditLog(80))}>Refresh</button>
                    <button type="button" className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50" onClick={() => { clearAuditLog(); setAuditEntries([]); }}>Clear log</button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 text-xs font-mono divide-y divide-slate-100">
                    {auditEntries.length === 0 ? (
                        <p className="p-3 text-slate-500">No entries yet. Add or edit transactions to populate.</p>
                    ) : (
                        auditEntries.map((e) => (
                            <div key={e.id} className="p-2 flex flex-wrap gap-x-3 gap-y-1">
                                <span className="text-slate-400 shrink-0">{new Date(e.at).toLocaleString()}</span>
                                <span className="font-semibold text-primary">{e.action}</span>
                                <span>{e.entity}</span>
                                <span className="text-slate-700 truncate max-w-full">{e.summary}</span>
                            </div>
                        ))
                    )}
                </div>
            </SectionCard>

            <SectionCard title="Reports & export">
                <p className="text-sm text-slate-600 mb-3">Generate structured reports and CSV exports from your current data.</p>
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
            </SectionCard>

            <SectionCard title="Data Management">
                 <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    {hasData ? (
                        <>
                            <p className="text-sm text-slate-600">
                                Export a JSON backup of all your data (accounts, transactions, goals, budgets, investments, etc.) for safekeeping.
                                <span className="block mt-1 text-amber-700 text-xs">Tip: export monthly or before major changes—local journal &amp; trading policy are not in cloud backup unless you copy them separately.</span>
                                <span className="block mt-1 text-slate-600 text-xs">Split expenses need DB column <code className="bg-slate-100 px-1 rounded">note</code> on <code className="bg-slate-100 px-1 rounded">transactions</code>—run <code className="bg-slate-100 px-1 rounded text-[10px]">supabase/migrations/add_transactions_note.sql</code> in Supabase if saves warn about splits.</span>
                            </p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" onClick={() => {
                                    const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `finova-backup-${new Date().toISOString().slice(0, 10)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }} className="btn-outline flex-shrink-0">
                                    Export my data
                                </button>
                            </div>
                        </>
                    ) : (
                         <>
                            <p className="text-sm text-slate-600">Your account is empty. Start by adding your accounts, assets, liabilities, goals, budgets, transactions, investments, portfolios, watchlist, price alerts, commodity holdings, and planned trades.</p>
                        </>
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
