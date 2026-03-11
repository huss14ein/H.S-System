import React, { useContext, useState, useEffect, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { RiskProfile, Page } from '../types';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { getDefaultWealthUltraConfig } from '../wealth-ultra';

const Settings: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, updateSettings, loadDemoData, resetData } = useContext(DataContext)!;
    const auth = useContext(AuthContext)!;
    const [localSettings, setLocalSettings] = useState(data.settings);

    useEffect(() => {
        setLocalSettings(data.settings);
    }, [data.settings]);

    const handleSettingChange = <K extends keyof typeof localSettings>(key: K, value: (typeof localSettings)[K]) => {
        const newSettings = { ...localSettings, [key]: value };
        setLocalSettings(newSettings);
        updateSettings({ [key]: value });
    };

    const hasData = data && data.accounts.length > 0;
    const defaultWealthUltra = useMemo(() => ({ ...getDefaultWealthUltraConfig(), ...(data.wealthUltraConfig || {}) }), [data.wealthUltraConfig]);

    return (
        <PageLayout
            title="Settings"
            description="Control your profile, automation defaults, notifications, and data management."
        >
            <SectionCard title="Settings Snapshot" className="border-2 border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <SnapCard label="Risk profile" value={localSettings.riskProfile} />
                    <SnapCard label="Budget alert" value={`${localSettings.budgetThreshold}%`} />
                    <SnapCard label="Drift threshold" value={`${localSettings.driftThreshold}%`} />
                    <SnapCard label="Email summary" value={localSettings.enableEmails ? 'Enabled' : 'Disabled'} />
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

            <SectionCard title="Financial Preferences" className="border border-slate-200">
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">Investment Risk Profile <InfoHint text="Guides AI and plan suggestions: Conservative (stability), Moderate (balanced), Aggressive (growth)." /></label>
                        <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 p-1">
                            {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                                <button key={profile} onClick={() => handleSettingChange('riskProfile', profile)}
                                    className={`px-3 py-2 text-sm font-semibold rounded-md transition-all ${localSettings.riskProfile === profile ? 'bg-white shadow text-primary' : 'text-gray-600 hover:bg-white/50'}`}>
                                    {profile}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="budget-threshold" className="block text-sm font-medium text-gray-700 flex items-center">Budget Alert Threshold (%) <InfoHint text="You get notified when a budget category reaches this percentage of its limit (e.g. 90%)." /></label>
                            <input id="budget-threshold" type="number" value={localSettings.budgetThreshold}
                                onChange={(e) => handleSettingChange('budgetThreshold', Number(e.target.value))}
                                className="input-base mt-2"/>
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label htmlFor="drift-threshold" className="block text-sm font-medium text-gray-700 flex items-center">Portfolio Drift Threshold (%) <InfoHint text="Rebalancing alerts when an asset’s weight drifts from target by more than this percent." /></label>
                            <input id="drift-threshold" type="number" value={localSettings.driftThreshold}
                                onChange={(e) => handleSettingChange('driftThreshold', Number(e.target.value))}
                                className="input-base mt-2"/>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="Enhanced Default Parameters">
                <p className="text-sm text-gray-600 mb-3 flex items-center">
                    <InfoHint text="These are the baseline defaults used by Wealth Ultra and related planning workflows. The engine can auto-adapt from your live portfolio signals." />
                    Source: system defaults + your current overrides
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                    <ParamCard label="FX rate (USD→SAR)" value={defaultWealthUltra.fxRate.toFixed(4)} hint="Conversion baseline" />
                    <ParamCard label="Monthly deposit" value={`$${Math.round(defaultWealthUltra.monthlyDeposit).toLocaleString()}`} hint="Deployment budget" />
                    <ParamCard label="Cash reserve" value={`${defaultWealthUltra.cashReservePct}%`} hint="Liquidity guardrail" />
                    <ParamCard label="Max per ticker" value={`${defaultWealthUltra.maxPerTickerPct}%`} hint="Concentration cap" />
                    <ParamCard label="Core target" value={`${defaultWealthUltra.targetCorePct}%`} hint="Stability sleeve" />
                    <ParamCard label="Upside target" value={`${defaultWealthUltra.targetUpsidePct}%`} hint="Growth sleeve" />
                    <ParamCard label="Spec target" value={`${defaultWealthUltra.targetSpecPct}%`} hint="High-risk sleeve" />
                    <ParamCard label="Target 1" value={`${defaultWealthUltra.defaultTarget1Pct}%`} hint="First profit trigger" />
                    <ParamCard label="Target 2" value={`${defaultWealthUltra.defaultTarget2Pct}%`} hint="Second profit trigger" />
                    <ParamCard label="Trailing stop" value={`${defaultWealthUltra.defaultTrailingPct}%`} hint="Downside lock" />
                    <ParamCard label="Risk weight (Low/Med)" value={`${defaultWealthUltra.riskWeightLow} / ${defaultWealthUltra.riskWeightMed}`} hint="Sizing multiplier" />
                    <ParamCard label="Risk weight (High/Spec)" value={`${defaultWealthUltra.riskWeightHigh} / ${defaultWealthUltra.riskWeightSpec}`} hint="Sizing multiplier" />
                </div>
                {setActivePage && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setActivePage('Investments')} className="px-3 py-1.5 text-sm rounded-lg border border-primary/30 text-primary hover:bg-primary/5">Investment Plan</button>
                        <button type="button" onClick={() => setActivePage('Wealth Ultra')} className="btn-outline text-violet-700 border-violet-300 hover:bg-violet-50">Open Wealth Ultra Autopilot</button>
                    </div>
                )}
            </SectionCard>

            <SectionCard title="Notifications">
                <label htmlFor="email-toggle" className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700">
                        <span className="font-medium flex items-center">Weekly Email Reports <InfoHint text="When enabled, you receive a weekly summary of budgets, net worth, and alerts (if the feature is configured)." /></span>
                        <p className="text-xs text-gray-500 mt-0.5">Receive a summary of your financial health every week.</p>
                    </span>
                    <div className="relative">
                        <input id="email-toggle" type="checkbox" className="sr-only" checked={localSettings.enableEmails}
                                onChange={(e) => handleSettingChange('enableEmails', e.target.checked)} />
                        <div className={`block w-10 h-6 rounded-full transition ${localSettings.enableEmails ? 'bg-primary' : 'bg-gray-200'}`}></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition ${localSettings.enableEmails ? 'transform translate-x-full' : ''}`}></div>
                    </div>
                </label>
            </SectionCard>

            <SectionCard title="Data Management">
                 <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    {hasData ? (
                        <>
                            <p className="text-sm text-gray-600">Export a JSON backup of all your data (accounts, transactions, goals, budgets, investments, etc.) for safekeeping.</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" onClick={() => {
                                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `finova-backup-${new Date().toISOString().slice(0, 10)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }} className="btn-outline flex-shrink-0">
                                    Export my data
                                </button>
                                <span className="text-xs text-slate-500 self-center">Then permanently delete:</span>
                                <button type="button" onClick={resetData} className="btn-danger w-full md:w-auto flex-shrink-0">
                                    Clear All Data
                                </button>
                            </div>
                        </>
                    ) : (
                         <>
                            <p className="text-sm text-gray-600">Your account is empty. Load a complete set of demonstration data to explore the app: accounts, assets, liabilities, goals, budgets, transactions, investments, portfolios, watchlist, price alerts, commodity holdings, and planned trades.</p>
                            <button type="button" onClick={loadDemoData} className="btn-primary w-full md:w-auto flex-shrink-0">
                                Load Demo Data
                            </button>
                        </>
                    )}
                 </div>
            </SectionCard>
        </PageLayout>
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
