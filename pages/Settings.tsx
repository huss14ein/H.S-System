import React, { useContext, useState, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { RiskProfile, Page } from '../types';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';

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

    return (
        <PageLayout
            title="Settings"
            description="Manage your profile, preferences, and application data."
        >
            <SectionCard title="User Profile">
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-500">Email Address</label>
                        <p className="text-base text-dark">{auth.user?.email}</p>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-500">User ID</label>
                        <p className="text-xs text-gray-400 font-mono">{auth.user?.id}</p>
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="Financial Preferences">
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
                    <div className="cards-grid grid grid-cols-1 md:grid-cols-2">
                        <div>
                            <label htmlFor="budget-threshold" className="block text-sm font-medium text-gray-700 flex items-center">Budget Alert Threshold (%) <InfoHint text="You get notified when a budget category reaches this percentage of its limit (e.g. 90%)." /></label>
                            <input id="budget-threshold" type="number" value={localSettings.budgetThreshold}
                                onChange={(e) => handleSettingChange('budgetThreshold', Number(e.target.value))}
                                className="input-base mt-1"/>
                        </div>
                        <div>
                            <label htmlFor="drift-threshold" className="block text-sm font-medium text-gray-700 flex items-center">Portfolio Drift Threshold (%) <InfoHint text="Rebalancing alerts when an asset’s weight drifts from target by more than this percent." /></label>
                            <input id="drift-threshold" type="number" value={localSettings.driftThreshold}
                                onChange={(e) => handleSettingChange('driftThreshold', Number(e.target.value))}
                                className="input-base mt-1"/>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard title="Default Parameters">
                <p className="text-sm text-gray-600 mb-3 flex items-center">
                    <InfoHint text="These values drive Investment Plan, Wealth Ultra, and Recovery Plan. Sleeve targets and tickers are set in Investment Plan." />
                    Source: App defaults (front-end config)
                </p>
                <div className="cards-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 text-sm min-w-0">
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">FX rate (USD→SAR)</p>
                        <p className="metric-value font-semibold w-full">{(data.wealthUltraConfig?.fxRate ?? 0.27).toFixed(4)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Cash reserve %</p>
                        <p className="metric-value font-semibold w-full">{data.wealthUltraConfig?.cashReservePct ?? 10}%</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Max per ticker %</p>
                        <p className="metric-value font-semibold w-full">{data.wealthUltraConfig?.maxPerTickerPct ?? 20}%</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Target 1 (exit %)</p>
                        <p className="metric-value font-semibold w-full">{data.wealthUltraConfig?.defaultTarget1Pct ?? 15}%</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Target 2 (exit %)</p>
                        <p className="metric-value font-semibold w-full">{data.wealthUltraConfig?.defaultTarget2Pct ?? 25}%</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-gray-500 w-full">Trailing stop %</p>
                        <p className="metric-value font-semibold w-full">{data.wealthUltraConfig?.defaultTrailingPct ?? 10}%</p>
                    </div>
                </div>
                {setActivePage && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setActivePage('Investments')} className="px-3 py-1.5 text-sm rounded-lg border border-primary/30 text-primary hover:bg-primary/5">Investment Plan</button>
                        <button type="button" onClick={() => setActivePage('Wealth Ultra')} className="btn-outline text-violet-700 border-violet-300 hover:bg-violet-50">Wealth Ultra</button>
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

export default Settings;