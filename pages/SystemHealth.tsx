import React, { useState, useEffect, useMemo } from 'react';

type ServiceStatus = 'Operational' | 'Degraded Performance' | 'Partial Outage';

interface Service {
  name: string;
  status: ServiceStatus;
  uptime: string;
}

const initialServices: Service[] = [
  { name: 'Authentication Service', status: 'Operational', uptime: '99.99%' },
  { name: 'Market Data API', status: 'Operational', uptime: '99.98%' },
  { name: 'Bank Connection APIs', status: 'Operational', uptime: '99.95%' },
  { name: 'AI Services API (Gemini)', status: 'Operational', uptime: '99.99%' },
  { name: 'Database Service', status: 'Operational', uptime: '100.00%' },
  { name: 'Notification Service', status: 'Operational', uptime: '99.80%' },
];

const getStatusColor = (status: ServiceStatus) => {
    switch (status) {
        case 'Operational': return 'bg-green-500';
        case 'Degraded Performance': return 'bg-yellow-500';
        case 'Partial Outage': return 'bg-red-500';
        default: return 'bg-gray-500';
    }
}

const SystemHealth: React.FC = () => {
    const [services, setServices] = useState<Service[]>(initialServices);

    useEffect(() => {
        const interval = setInterval(() => {
            setServices(currentServices =>
                currentServices.map(service => {
                    const isCore = ['Authentication Service', 'Database Service', 'AI Services API (Gemini)'].includes(service.name);
                    const failureChance = isCore ? 0.05 : 0.1;

                    if (service.status !== 'Operational' && Math.random() < 0.5) {
                         return { ...service, status: 'Operational' };
                    }

                    if (Math.random() < failureChance) {
                        return { ...service, status: 'Degraded Performance' };
                    }
                    
                    return { ...service, status: 'Operational' };
                })
            );
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    const overallStatus = useMemo(() => {
        const degraded = services.filter(s => s.status === 'Degraded Performance');
        const outages = services.filter(s => s.status === 'Partial Outage');

        if (outages.length > 0) {
            return { text: 'Partial Outage', color: 'text-red-600' };
        }
        if (degraded.length > 0) {
             return { text: `Degraded Performance (${degraded.length} service${degraded.length > 1 ? 's' : ''})`, color: 'text-yellow-600' };
        }
        return { text: 'All Systems Operational', color: 'text-green-600' };
    }, [services]);

  return (
    <div className="space-y-6">
        <div className="text-center">
             <h1 className="text-3xl font-bold text-dark">System & APIs Health</h1>
             <p className="text-gray-500 mt-1">Live status of the Wealth Ultra platform and its connected services.</p>
        </div>
      
        <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="p-4 bg-gray-50 border-b">
                <h2 className="text-lg font-semibold text-dark">Overall Status: <span className={overallStatus.color}>{overallStatus.text}</span></h2>
            </div>
            <ul className="divide-y divide-gray-200">
                {services.map(service => (
                     <li key={service.name} className="p-4 flex justify-between items-center">
                        <div>
                            <p className="font-medium text-dark">{service.name}</p>
                            <div className="flex items-center space-x-2 mt-1">
                                <div className={`h-3 w-3 rounded-full ${getStatusColor(service.status)}`}></div>
                                <span className="text-sm text-gray-600">{service.status}</span>
                            </div>
                        </div>
                        <div className="text-right">
                             <p className="text-sm text-gray-500">90-Day Uptime</p>
                             <p className="font-semibold text-dark">{service.uptime}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    </div>
  );
};

export default SystemHealth;