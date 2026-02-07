import React from 'react';

type ServiceStatus = 'Operational' | 'Degraded Performance' | 'Partial Outage';

interface Service {
  name: string;
  status: ServiceStatus;
  uptime: string;
}

const services: Service[] = [
  { name: 'Authentication Service', status: 'Operational', uptime: '99.99%' },
  { name: 'Market Data API', status: 'Operational', uptime: '99.98%' },
  { name: 'Bank Connection APIs', status: 'Operational', uptime: '99.95%' },
  { name: 'AI Services API (Gemini)', status: 'Operational', uptime: '99.99%' },
  { name: 'Database Service', status: 'Operational', uptime: '100.00%' },
  { name: 'Notification Service', status: 'Operational', uptime: '99.99%' },
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
  return (
    <div className="space-y-6">
        <div className="text-center">
             <h1 className="text-3xl font-bold text-dark">System & APIs Health</h1>
             <p className="text-gray-500 mt-1">Live status of the H.S platform and its connected services.</p>
        </div>
      
        <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="p-4 bg-gray-50 border-b">
                <h2 className="text-lg font-semibold text-dark">Overall Status: <span className="text-green-600">All Systems Operational</span></h2>
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