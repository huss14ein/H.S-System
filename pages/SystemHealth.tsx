import React, { useState, useEffect, useContext } from 'react';
import PageLayout from '../components/PageLayout';
import { AuthContext } from '../context/AuthContext';
import { 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ClockIcon,
  ArrowPathIcon,
  ServerStackIcon,
  CircleStackIcon,
  CpuChipIcon,
  GlobeAltIcon,
  UsersIcon
} from '../components/icons';

interface ServiceStatus {
  name: string;
  status: 'Operational' | 'Degraded Performance' | 'Outage' | 'Checking' | 'Simulated';
  responseTime: number;
  lastCheck: Date;
  description: string;
  icon: React.ComponentType<any>;
}

interface Incident {
  id: string;
  service: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  timestamp: Date;
  resolved: boolean;
}

const SystemHealth: React.FC<{ setActivePage: (page: string) => void }> = ({ }) => {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [countdown, setCountdown] = useState<number>(90);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const mockServices: ServiceStatus[] = [
    {
      name: 'Authentication Service',
      status: 'Operational',
      responseTime: 45,
      lastCheck: new Date(),
      description: 'Supabase Authentication',
      icon: UsersIcon
    },
    {
      name: 'Database Service',
      status: 'Operational',
      responseTime: 23,
      lastCheck: new Date(),
      description: 'Supabase PostgreSQL',
      icon: CircleStackIcon
    },
    {
      name: 'AI Services API',
      status: 'Operational',
      responseTime: 156,
      lastCheck: new Date(),
      description: 'Gemini AI Integration',
      icon: CpuChipIcon
    },
    {
      name: 'Market Data API',
      status: 'Degraded Performance',
      responseTime: 892,
      lastCheck: new Date(),
      description: 'Finnhub Market Data',
      icon: GlobeAltIcon
    },
    {
      name: 'Multi-user Access',
      status: 'Operational',
      responseTime: 12,
      lastCheck: new Date(),
      description: 'Real-time Collaboration',
      icon: ServerIcon
    }
  ];

  const mockIncidents: Incident[] = [
    {
      id: '1',
      service: 'Market Data API',
      severity: 'medium',
      message: 'Elevated response times detected, investigating latency issues',
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
      resolved: false
    },
    {
      id: '2',
      service: 'AI Services API',
      severity: 'low',
      message: 'Brief timeout resolved, service operating normally',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      resolved: true
    }
  ];

  useEffect(() => {
    setServices(mockServices);
    setIncidents(mockIncidents);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          checkAllServices();
          return 90;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const checkAllServices = async () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    
    // Simulate service checks
    setTimeout(() => {
      setServices(prev => prev.map(service => ({
        ...service,
        lastCheck: new Date(),
        responseTime: Math.max(10, service.responseTime + (Math.random() - 0.5) * 20)
      })));
      setIsRefreshing(false);
    }, 2000);
  };

  const getStatusColor = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'Operational':
        return 'text-green-600 bg-green-100';
      case 'Degraded Performance':
        return 'text-yellow-600 bg-yellow-100';
      case 'Outage':
        return 'text-red-600 bg-red-100';
      case 'Checking':
        return 'text-blue-600 bg-blue-100';
      case 'Simulated':
        return 'text-gray-600 bg-gray-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'Operational':
        return <CheckCircleIcon className="h-5 w-5 text-green-600" />;
      case 'Degraded Performance':
        return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />;
      case 'Outage':
        return <XCircleIcon className="h-5 w-5 text-red-600" />;
      case 'Checking':
        return <ClockIcon className="h-5 w-5 text-blue-600 animate-spin" />;
      case 'Simulated':
        return <ClockIcon className="h-5 w-5 text-gray-600" />;
      default:
        return <ClockIcon className="h-5 w-5 text-gray-600" />;
    }
  };

  const getResponseTimeColor = (responseTime: number) => {
    if (responseTime < 100) return 'text-green-600';
    if (responseTime < 500) return 'text-yellow-600';
    if (responseTime < 1000) return 'text-orange-600';
    return 'text-red-600';
  };

  const getHealthScore = () => {
    const operationalCount = services.filter(s => s.status === 'Operational').length;
    const totalCount = services.length;
    return Math.round((operationalCount / totalCount) * 100);
  };

  const getAverageLatency = () => {
    const total = services.reduce((sum, s) => sum + s.responseTime, 0);
    return Math.round(total / services.length);
  };

  const getDegradedCount = () => {
    return services.filter(s => s.status === 'Degraded Performance').length;
  };

  const getOutageCount = () => {
    return services.filter(s => s.status === 'Outage').length;
  };

  return (
    <PageLayout 
      title="System Health" 
      description="Real-time monitoring of system services and API performance."
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Health Score</p>
                <p className="text-2xl font-bold">{getHealthScore()}%</p>
              </div>
              <CheckCircleIcon className="h-8 w-8 text-green-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-sm">Degraded Services</p>
                <p className="text-2xl font-bold">{getDegradedCount()}</p>
              </div>
              <ExclamationTriangleIcon className="h-8 w-8 text-yellow-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm">Outages</p>
                <p className="text-2xl font-bold">{getOutageCount()}</p>
              </div>
              <XCircleIcon className="h-8 w-8 text-red-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Avg Latency</p>
                <p className="text-2xl font-bold">{getAverageLatency()}ms</p>
              </div>
              <ClockIcon className="h-8 w-8 text-blue-200" />
            </div>
          </div>
        </div>

        {/* Health Controls */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Health Controls</h2>
              <p className="text-sm text-gray-600 mt-1">
                Last refresh: {lastRefresh.toLocaleTimeString()} • Auto-refresh in {countdown}s
              </p>
            </div>
            <button
              onClick={checkAllServices}
              disabled={isRefreshing}
              className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Checking...' : 'Refresh Now'}
            </button>
          </div>
        </div>

        {/* Service Status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Service Status</h2>
          
          <div className="space-y-4">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      <Icon className="h-6 w-6 text-gray-400" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{service.name}</h3>
                      <p className="text-sm text-gray-600">{service.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">Response Time</p>
                      <p className={`text-sm font-semibold ${getResponseTimeColor(service.responseTime)}`}>
                        {service.responseTime}ms
                      </p>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(service.status)}
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(service.status)}`}>
                        {service.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Incidents */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Recent Incidents</h2>
          
          <div className="space-y-4">
            {incidents.map(incident => (
              <div key={incident.id} className="flex items-start justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-start space-x-3">
                  <div className={`mt-1 ${
                    incident.resolved ? 'text-green-600' : 
                    incident.severity === 'high' ? 'text-red-600' :
                    incident.severity === 'medium' ? 'text-yellow-600' : 'text-blue-600'
                  }`}>
                    {incident.resolved ? <CheckCircleIcon className="h-5 w-5" /> : <ExclamationTriangleIcon className="h-5 w-5" />}
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{incident.service}</h3>
                    <p className="text-sm text-gray-600 mt-1">{incident.message}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      {incident.timestamp.toLocaleString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    incident.resolved ? 'bg-green-100 text-green-800' :
                    incident.severity === 'high' ? 'bg-red-100 text-red-800' :
                    incident.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {incident.resolved ? 'Resolved' : incident.severity}
                  </span>
                </div>
              </div>
            ))}
            
            {incidents.length === 0 && (
              <div className="text-center py-8">
                <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-gray-600">No incidents reported</p>
              </div>
            )}
          </div>
        </div>

        {/* System Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">System Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Environment</h3>
              <p className="text-sm text-gray-600">Production</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Version</h3>
              <p className="text-sm text-gray-600">v2.1.0</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Uptime</h3>
              <p className="text-sm text-gray-600">99.9%</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Last Deployment</h3>
              <p className="text-sm text-gray-600">2 days ago</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Region</h3>
              <p className="text-sm text-gray-600">US East (N. Virginia)</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Time Zone</h3>
              <p className="text-sm text-gray-600">UTC+03:00</p>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default SystemHealth;
