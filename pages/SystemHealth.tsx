// FIX: Import 'useMemo' from React to resolve 'Cannot find name 'useMemo'' error.
import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';
import { invokeAI } from '../services/geminiService';
import { MarketDataContext } from '../context/MarketDataContext';
import { ArrowPathIcon } from '../components/icons/ArrowPathIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { CloudIcon } from '../components/icons/CloudIcon';


type ServiceStatus = 'Operational' | 'Degraded Performance' | 'Outage' | 'Checking...' | 'Simulated';

interface Service {
  name: string;
  status: ServiceStatus;
  responseTime?: number;
}

const initialServices: Service[] = [
  { name: 'Authentication Service (Supabase)', status: 'Checking...' },
  { name: 'Database Service (Supabase)', status: 'Checking...' },
  { name: 'AI Services API (Gemini)', status: 'Checking...' },
  { name: 'Market Data Simulator', status: 'Checking...' },
  { name: 'Bank Connection APIs', status: 'Simulated' },
  { name: 'Notification Service', status: 'Simulated' },
];

const getStatusInfo = (status: ServiceStatus) => {
    switch (status) {
        case 'Operational': return { color: 'bg-green-500', icon: <CheckCircleIcon className="h-5 w-5 text-green-600"/>, text: 'text-green-700' };
        case 'Degraded Performance': return { color: 'bg-yellow-500', icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600"/>, text: 'text-yellow-700' };
        case 'Outage': return { color: 'bg-red-500', icon: <XCircleIcon className="h-5 w-5 text-red-600"/>, text: 'text-red-700' };
        case 'Simulated': return { color: 'bg-blue-500', icon: <CloudIcon className="h-5 w-5 text-blue-600"/>, text: 'text-blue-700' };
        default: return { color: 'bg-gray-400 animate-pulse', icon: <div className="h-5 w-5"><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-500"></div></div>, text: 'text-gray-500'};
    }
};

const SystemHealth: React.FC = () => {
    const [services, setServices] = useState<Service[]>(initialServices);
    const [isLoading, setIsLoading] = useState(false);
    const marketContext = useContext(MarketDataContext);

    const runHealthChecks = useCallback(async () => {
        setIsLoading(true);
        // Reset to checking state, but keep simulated ones as is
        setServices(currentServices => currentServices.map(s => 
            s.status !== 'Simulated' ? { ...s, status: 'Checking...', responseTime: undefined } : s
        ));

        const checkSupabaseAuth = async (): Promise<Partial<Service>> => {
            try {
                const start = performance.now();
                const { error } = await supabase!.auth.getUser();
                if (error) throw error;
                const duration = Math.round(performance.now() - start);
                return { status: duration > 1500 ? 'Degraded Performance' : 'Operational', responseTime: duration };
            } catch (e) { return { status: 'Outage' }; }
        };

        const checkSupabaseDB = async (): Promise<Partial<Service>> => {
            try {
                const start = performance.now();
                const { error } = await supabase!.from('accounts').select('id', { count: 'exact', head: true });
                if (error) throw error;
                const duration = Math.round(performance.now() - start);
                return { status: duration > 1500 ? 'Degraded Performance' : 'Operational', responseTime: duration };
            } catch (e) { return { status: 'Outage' }; }
        };

        const checkAIService = async (): Promise<Partial<Service>> => {
            try {
                const start = performance.now();
                await invokeAI({ model: 'gemini-3-flash-preview', contents: 'hello' });
                const duration = Math.round(performance.now() - start);
                return { status: duration > 3000 ? 'Degraded Performance' : 'Operational', responseTime: duration };
            } catch (e) { return { status: 'Outage' }; }
        };
        
        const checkMarketData = (): Partial<Service> => {
            const isRunning = marketContext && Object.keys(marketContext.simulatedPrices).length > 0;
            return { status: isRunning ? 'Operational' : 'Degraded Performance' };
        };

        const [auth, db, ai] = await Promise.all([
            checkSupabaseAuth(),
            checkSupabaseDB(),
            checkAIService(),
        ]);
        const market = checkMarketData();

        setServices(currentServices => currentServices.map(s => {
            if (s.name.includes('Authentication')) return { ...s, ...auth };
            if (s.name.includes('Database')) return { ...s, ...db };
            if (s.name.includes('AI Services')) return { ...s, ...ai };
            if (s.name.includes('Market Data')) return { ...s, ...market };
            return s;
        }));

        setIsLoading(false);
    }, [marketContext]);

    useEffect(() => {
        runHealthChecks();
    }, [runHealthChecks]);

    const overallStatus = useMemo((): ServiceStatus => {
        if (services.some(s => s.status === 'Outage')) return 'Outage';
        if (services.some(s => s.status === 'Degraded Performance')) return 'Degraded Performance';
        if (services.some(s => s.status === 'Checking...')) return 'Checking...';
        return 'Operational';
    }, [services]);

    const OverallStatusCard: React.FC<{status: ServiceStatus}> = ({ status }) => {
        const { text, icon } = getStatusInfo(status);
        const message = {
            'Operational': 'All systems are running smoothly.',
            'Degraded Performance': 'Some services are slow or unavailable.',
            'Outage': 'One or more critical services are down.',
            'Checking...': 'Running health checks...',
            'Simulated': 'All systems are running smoothly.'
        }[status];

        return (
            <div className={`p-4 rounded-lg border-l-4 ${
                status === 'Operational' ? 'bg-green-50 border-green-500' :
                status === 'Degraded Performance' ? 'bg-yellow-50 border-yellow-500' :
                status === 'Outage' ? 'bg-red-50 border-red-500' :
                'bg-gray-50 border-gray-500'
            }`}>
                <div className="flex items-center">
                    <div className="flex-shrink-0">{icon}</div>
                    <div className="ml-3">
                        <p className={`text-sm font-bold ${text}`}>{status}</p>
                        <p className="text-sm text-gray-600">{message}</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                 <h1 className="text-3xl font-bold text-dark">System & APIs Health</h1>
                 <button onClick={runHealthChecks} disabled={isLoading} className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                    <ArrowPathIcon className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Checking...' : 'Re-run Checks'}
                 </button>
            </div>
          
            <OverallStatusCard status={overallStatus} />
        
            <div className="bg-white shadow rounded-lg overflow-hidden">
                <ul className="divide-y divide-gray-200">
                    {services.map(service => {
                        const { icon, text } = getStatusInfo(service.status);
                        return (
                            <li key={service.name} className="p-4 flex justify-between items-center">
                                <div>
                                    <p className="font-medium text-dark">{service.name}</p>
                                    <div className="flex items-center space-x-2 mt-1">
                                        {icon}
                                        <span className={`text-sm font-semibold ${text}`}>{service.status}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-semibold text-dark">{service.responseTime ? `${service.responseTime} ms` : service.status === 'Checking...' ? '...' : '--'}</p>
                                    <p className="text-xs text-gray-500">Response Time</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

export default SystemHealth;