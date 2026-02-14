import React, { useContext, useState, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { RiskProfile } from '../types';

const Settings: React.FC = () => {
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
        <div className="space-y-8 max-w-4xl mx-auto">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Settings</h1>
                <p className="text-gray-500 mt-1">Manage your profile, preferences, and application data.</p>
            </div>

            {/* User Profile Section */}
            <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-dark border-b pb-3 mb-4">User Profile</h2>
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
            </div>
            
            {/* Financial Settings Section */}
            <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-dark border-b pb-3 mb-4">Financial Preferences</h2>
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Investment Risk Profile</label>
                        <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 p-1">
                            {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(profile => (
                                <button key={profile} onClick={() => handleSettingChange('riskProfile', profile)}
                                    className={`px-3 py-2 text-sm font-semibold rounded-md transition-all ${localSettings.riskProfile === profile ? 'bg-white shadow text-primary' : 'text-gray-600 hover:bg-white/50'}`}>
                                    {profile}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="budget-threshold" className="block text-sm font-medium text-gray-700">Budget Alert Threshold (%)</label>
                            <input id="budget-threshold" type="number" value={localSettings.budgetThreshold}
                                onChange={(e) => handleSettingChange('budgetThreshold', Number(e.target.value))}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md"/>
                             <p className="text-xs text-gray-500 mt-1">Get notified when you spend this percentage of a budget.</p>
                        </div>
                        <div>
                            <label htmlFor="drift-threshold" className="block text-sm font-medium text-gray-700">Portfolio Drift Threshold (%)</label>
                            <input id="drift-threshold" type="number" value={localSettings.driftThreshold}
                                onChange={(e) => handleSettingChange('driftThreshold', Number(e.target.value))}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md"/>
                             <p className="text-xs text-gray-500 mt-1">Get a rebalancing alert if an asset class drifts by this percent.</p>
                        </div>
                    </div>
                </div>
            </div>

             {/* Notification Preferences Section */}
            <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-dark border-b pb-3 mb-4">Notifications</h2>
                <label htmlFor="email-toggle" className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700">
                        <span className="font-medium">Weekly Email Reports</span>
                        <p className="text-xs text-gray-500">Receive a summary of your financial health every week.</p>
                    </span>
                    <div className="relative">
                        <input id="email-toggle" type="checkbox" className="sr-only" checked={localSettings.enableEmails}
                                onChange={(e) => handleSettingChange('enableEmails', e.target.checked)} />
                        <div className={`block w-10 h-6 rounded-full transition ${localSettings.enableEmails ? 'bg-primary' : 'bg-gray-200'}`}></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition ${localSettings.enableEmails ? 'transform translate-x-full' : ''}`}></div>
                    </div>
                </label>
            </div>
            
            {/* Data Management Section */}
            <div className="bg-white p-6 rounded-lg shadow">
                 <h2 className="text-xl font-semibold text-dark border-b pb-3 mb-4">Data Management</h2>
                 <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    {hasData ? (
                        <>
                            <p className="text-sm text-gray-600">Permanently delete all of your financial data from the application.</p>
                            <button onClick={resetData} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 w-full md:w-auto flex-shrink-0">
                                Clear All Data
                            </button>
                        </>
                    ) : (
                         <>
                            <p className="text-sm text-gray-600">Your account is empty. Load a complete set of demonstration data to explore the app's features.</p>
                            <button onClick={loadDemoData} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 w-full md:w-auto flex-shrink-0">
                                Load Demo Data
                            </button>
                        </>
                    )}
                 </div>
            </div>
        </div>
    );
};

export default Settings;