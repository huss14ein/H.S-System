import React, { useState, useEffect } from 'react';
import PageLayout from '../components/PageLayout';
import { format } from 'date-fns';
import { 
  BellIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ArrowTrendingUpIcon,
  BuildingLibraryIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  CalendarDaysIcon
} from '../components/icons';

interface MarketEvent {
  id: string;
  title: string;
  date: Date;
  type: 'Macro' | 'Earnings' | 'Dividend' | 'Portfolio';
  impact: 'High' | 'Medium' | 'Low';
  description: string;
  symbol?: string;
  estimated?: boolean;
  portfolioRelevant?: boolean;
}

const MarketEvents: React.FC = () => {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<MarketEvent[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedImpact, setSelectedImpact] = useState<string>('all');
  const [showPortfolioOnly, setShowPortfolioOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const mockEvents: MarketEvent[] = [
    {
      id: '1',
      title: 'Fed Interest Rate Decision',
      date: new Date('2024-03-20'),
      type: 'Macro',
      impact: 'High',
      description: 'Federal Reserve announces latest interest rate decision and economic outlook',
      portfolioRelevant: true
    },
    {
      id: '2',
      title: 'Apple Inc. Q1 Earnings',
      date: new Date('2024-03-15'),
      type: 'Earnings',
      impact: 'High',
      description: 'Apple reports first quarter earnings results',
      symbol: 'AAPL',
      portfolioRelevant: true
    },
    {
      id: '3',
      title: 'Saudi Aramco Dividend',
      date: new Date('2024-03-18'),
      type: 'Dividend',
      impact: 'Medium',
      description: 'Quarterly dividend payment to shareholders',
      symbol: '2222.SR',
      portfolioRelevant: true
    },
    {
      id: '4',
      title: 'US CPI Data Release',
      date: new Date('2024-03-12'),
      type: 'Macro',
      impact: 'High',
      description: 'Consumer Price Index data for February',
      portfolioRelevant: false
    },
    {
      id: '5',
      title: 'Microsoft Corp. Earnings',
      date: new Date('2024-03-22'),
      type: 'Earnings',
      impact: 'High',
      description: 'Microsoft reports Q3 earnings results',
      symbol: 'MSFT',
      portfolioRelevant: false
    },
    {
      id: '6',
      title: 'Oil Price Report',
      date: new Date('2024-03-25'),
      type: 'Macro',
      impact: 'Medium',
      description: 'Weekly oil market analysis and price outlook',
      portfolioRelevant: false
    }
  ];

  useEffect(() => {
    // Simulate loading market events
    setTimeout(() => {
      setEvents(mockEvents);
      setFilteredEvents(mockEvents);
      setLoading(false);
    }, 1000);
  }, []);

  useEffect(() => {
    let filtered = events;

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(event =>
        event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (event.symbol && event.symbol.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Filter by type
    if (selectedType !== 'all') {
      filtered = filtered.filter(event => event.type === selectedType);
    }

    // Filter by impact
    if (selectedImpact !== 'all') {
      filtered = filtered.filter(event => event.impact === selectedImpact);
    }

    // Filter by portfolio relevance
    if (showPortfolioOnly) {
      filtered = filtered.filter(event => event.portfolioRelevant);
    }

    setFilteredEvents(filtered);
  }, [events, searchTerm, selectedType, selectedImpact, showPortfolioOnly]);

  const getTypeIcon = (type: MarketEvent['type']) => {
    switch (type) {
      case 'Macro':
        return <ChartBarIcon className="h-5 w-5 text-blue-500" />;
      case 'Earnings':
        return <CurrencyDollarIcon className="h-5 w-5 text-green-500" />;
      case 'Dividend':
        return <ArrowTrendingUpIcon className="h-5 w-5 text-purple-500" />;
      case 'Portfolio':
        return <BuildingLibraryIcon className="h-5 w-5 text-orange-500" />;
      default:
        return <CalendarDaysIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getImpactColor = (impact: MarketEvent['impact']) => {
    switch (impact) {
      case 'High':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeColor = (type: MarketEvent['type']) => {
    switch (type) {
      case 'Macro':
        return 'bg-blue-100 text-blue-800';
      case 'Earnings':
        return 'bg-green-100 text-green-800';
      case 'Dividend':
        return 'bg-purple-100 text-purple-800';
      case 'Portfolio':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStats = () => {
    const total = events.length;
    const highImpact = events.filter(e => e.impact === 'High').length;
    const earnings = events.filter(e => e.type === 'Earnings').length;
    const portfolioRelevant = events.filter(e => e.portfolioRelevant).length;
    
    return { total, highImpact, earnings, portfolioRelevant };
  };

  const stats = getStats();

  if (loading) {
    return (
      <PageLayout title="Market Events" description="Loading market events...">
        <div className="flex items-center justify-center min-h-[24rem]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout 
      title="Market Events" 
      description="Track important market events, earnings releases, and economic indicators."
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Events</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <CalendarDaysIcon className="h-8 w-8 text-blue-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm">High Impact</p>
                <p className="text-2xl font-bold">{stats.highImpact}</p>
              </div>
              <ExclamationTriangleIcon className="h-8 w-8 text-red-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Earnings</p>
                <p className="text-2xl font-bold">{stats.earnings}</p>
              </div>
              <CurrencyDollarIcon className="h-8 w-8 text-green-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">Portfolio Relevant</p>
                <p className="text-2xl font-bold">{stats.portfolioRelevant}</p>
              </div>
              <BuildingLibraryIcon className="h-8 w-8 text-purple-200" />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Smart Filters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <div className="relative">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search events..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent w-full"
              >
                <option value="all">All Types</option>
                <option value="Macro">Macro</option>
                <option value="Earnings">Earnings</option>
                <option value="Dividend">Dividend</option>
                <option value="Portfolio">Portfolio</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Impact</label>
              <select
                value={selectedImpact}
                onChange={(e) => setSelectedImpact(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent w-full"
              >
                <option value="all">All Impact Levels</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Portfolio Focus</label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPortfolioOnly}
                  onChange={(e) => setShowPortfolioOnly(e.target.checked)}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm text-gray-700">Portfolio relevant only</span>
              </label>
            </div>
          </div>
        </div>

        {/* Events List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Market Events</h2>
            <p className="text-sm text-gray-600">
              Showing {filteredEvents.length} of {events.length} events
            </p>
          </div>

          <div className="space-y-4">
            {filteredEvents.map(event => (
              <div key={event.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 mt-1">
                      {getTypeIcon(event.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{event.title}</h3>
                        {event.symbol && (
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                            {event.symbol}
                          </span>
                        )}
                        {event.portfolioRelevant && (
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                            Portfolio
                          </span>
                        )}
                        {event.estimated && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                            Estimated
                          </span>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-3">{event.description}</p>
                      
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            {format(event.date, 'MMM dd, yyyy')}
                          </span>
                        </div>
                        
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTypeColor(event.type)}`}>
                          {event.type}
                        </span>
                        
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getImpactColor(event.impact)}`}>
                          {event.impact} Impact
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {event.impact === 'High' && (
                      <BellIcon className="h-5 w-5 text-red-500" />
                    )}
                    {event.portfolioRelevant && (
                      <CheckCircleIcon className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {filteredEvents.length === 0 && (
              <div className="text-center py-8">
                <InformationCircleIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No events found matching your criteria</p>
              </div>
            )}
          </div>
        </div>

        {/* Calendar View */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Event Calendar</h2>
          
          <div className="grid grid-cols-7 gap-2 mb-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-sm font-medium text-gray-700 py-2">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }, (_, i) => {
              const date = new Date(2024, 2, i - 6); // March 2024
              const hasEvent = events.some(event => 
                event.date.getDate() === date.getDate() &&
                event.date.getMonth() === date.getMonth()
              );
              
              return (
                <div
                  key={i}
                  className={`aspect-square border rounded-lg p-2 text-sm ${
                    hasEvent ? 'bg-primary/10 border-primary' : 'border-gray-200'
                  }`}
                >
                  <div className="text-center">
                    {date.getDate() > 0 && date.getDate() <= 31 ? date.getDate() : ''}
                    {hasEvent && (
                      <div className="w-2 h-2 bg-primary rounded-full mx-auto mt-1"></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default MarketEvents;
