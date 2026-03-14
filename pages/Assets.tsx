import React, { useState, useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PageLayout from '../components/PageLayout';
import { CurrencyContext } from '../context/CurrencyContext';
import { format } from 'date-fns';
import { 
  BuildingLibraryIcon, 
  TruckIcon, 
  CurrencyDollarIcon,
  BanknotesIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ChartBarIcon,
  ServerStackIcon
} from '../components/icons';

interface Asset {
  id: string;
  name: string;
  type: 'Property' | 'Vehicle' | 'Sukuk' | 'Other';
  value: number;
  currency: string;
  purchaseDate: string;
  purchaseValue: number;
  description?: string;
  goalId?: string;
}

interface CommodityHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  currentPrice: number;
  currency: string;
  purchasePrice: number;
  totalValue: number;
  gainLoss: number;
  gainLossPercent: number;
}

const Assets: React.FC<{ setActivePage: (page: string) => void }> = ({ setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { convertCurrency } = useContext(CurrencyContext);
  const auth = useContext(AuthContext);

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showCommodityModal, setShowCommodityModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [activeTab, setActiveTab] = useState<'physical' | 'commodities'>('physical');

  // Mock data for demonstration
  const mockAssets: Asset[] = [
    {
      id: '1',
      name: 'Primary Residence',
      type: 'Property',
      value: 800000,
      currency: 'SAR',
      purchaseDate: '2020-01-15',
      purchaseValue: 650000,
      description: 'Family home in Riyadh'
    },
    {
      id: '2',
      name: 'Toyota Camry',
      type: 'Vehicle',
      value: 85000,
      currency: 'SAR',
      purchaseDate: '2022-06-10',
      purchaseValue: 95000,
      description: 'Personal vehicle'
    }
  ];

  const mockCommodities: CommodityHolding[] = [
    {
      id: '1',
      symbol: 'GOLD',
      name: 'Gold',
      quantity: 10,
      currentPrice: 250,
      currency: 'SAR',
      purchasePrice: 220,
      totalValue: 2500,
      gainLoss: 300,
      gainLossPercent: 13.6
    },
    {
      id: '2',
      symbol: 'SILVER',
      name: 'Silver',
      quantity: 100,
      currentPrice: 3.5,
      currency: 'SAR',
      purchasePrice: 3.2,
      totalValue: 350,
      gainLoss: 30,
      gainLossPercent: 9.4
    }
  ];

  const calculations = useMemo(() => {
    const assets = mockAssets || [];
    const commodities = mockCommodities || [];

    const totalPhysicalAssets = assets.reduce((sum, asset) => 
      sum + convertCurrency(asset.value, asset.currency, 'SAR'), 0
    );

    const totalCommodities = commodities.reduce((sum, commodity) => 
      sum + convertCurrency(commodity.totalValue, commodity.currency, 'SAR'), 0
    );

    const totalGainLoss = commodities.reduce((sum, commodity) => 
      sum + convertCurrency(commodity.gainLoss, commodity.currency, 'SAR'), 0
    );

    const totalPurchaseValue = assets.reduce((sum, asset) => 
      sum + convertCurrency(asset.purchaseValue, asset.currency, 'SAR'), 0
    );

    const totalGainLossPercent = totalPurchaseValue > 0 
      ? ((totalPhysicalAssets - totalPurchaseValue) / totalPurchaseValue) * 100 
      : 0;

    return {
      totalPhysicalAssets,
      totalCommodities,
      totalAssetValue: totalPhysicalAssets + totalCommodities,
      totalGainLoss,
      totalGainLossPercent,
      assetCount: assets.length,
      commodityCount: commodities.length
    };
  }, [mockAssets, mockCommodities, convertCurrency]);

  if (loading || !data) {
    return (
      <PageLayout title="Assets" description="Loading assets...">
        <div className="flex items-center justify-center min-h-[24rem]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </PageLayout>
    );
  }

  const getAssetIcon = (type: Asset['type']) => {
    switch (type) {
      case 'Property':
        return <BuildingLibraryIcon className="h-6 w-6 text-blue-500" />;
      case 'Vehicle':
        return <TruckIcon className="h-6 w-6 text-green-500" />;
      case 'Sukuk':
        return <CurrencyDollarIcon className="h-6 w-6 text-purple-500" />;
      default:
        return <BanknotesIcon className="h-6 w-6 text-gray-500" />;
    }
  };

  return (
    <PageLayout 
      title="Assets" 
      description="Manage your physical assets and commodity holdings."
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Asset Value</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.totalAssetValue)}</p>
              </div>
              <BanknotesIcon className="h-8 w-8 text-blue-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Physical Assets</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.totalPhysicalAssets)}</p>
              </div>
              <BuildingOfficeIcon className="h-8 w-8 text-green-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">Metals & Crypto</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.totalCommodities)}</p>
              </div>
              <CurrencyDollarIcon className="h-8 w-8 text-purple-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm">Total Gain/Loss</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.totalGainLoss)}</p>
              </div>
              <ChartBarIcon className="h-8 w-8 text-orange-200" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('physical')}
                className={`py-4 px-6 border-b-2 font-medium text-sm ${
                  activeTab === 'physical'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Physical Assets ({calculations.assetCount})
              </button>
              <button
                onClick={() => setActiveTab('commodities')}
                className={`py-4 px-6 border-b-2 font-medium text-sm ${
                  activeTab === 'commodities'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Commodities ({calculations.commodityCount})
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'physical' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Physical Assets</h3>
                  <button
                    onClick={() => setShowAssetModal(true)}
                    className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Add Asset
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mockAssets.map(asset => (
                    <div key={asset.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          {getAssetIcon(asset.type)}
                          <div>
                            <h4 className="font-medium text-gray-900">{asset.name}</h4>
                            <p className="text-sm text-gray-600">{asset.type}</p>
                            {asset.description && (
                              <p className="text-xs text-gray-500 mt-1">{asset.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <button className="text-gray-400 hover:text-gray-600">
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button className="text-gray-400 hover:text-red-600">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-gray-600">Current Value</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {formatCurrencyString(convertCurrency(asset.value, asset.currency, 'SAR'))}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Purchase</p>
                            <p className="text-sm font-medium text-gray-900">
                              {formatCurrencyString(convertCurrency(asset.purchaseValue, asset.currency, 'SAR'))}
                            </p>
                            <p className="text-xs text-gray-500">
                              {format(new Date(asset.purchaseDate), 'MMM yyyy')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'commodities' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Commodity Holdings</h3>
                  <button
                    onClick={() => setShowCommodityModal(true)}
                    className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Add Commodity
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mockCommodities.map(commodity => (
                    <div key={commodity.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">{commodity.name}</h4>
                          <p className="text-sm text-gray-600">{commodity.symbol}</p>
                        </div>
                        <div className="flex space-x-2">
                          <button className="text-gray-400 hover:text-gray-600">
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button className="text-gray-400 hover:text-red-600">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-gray-600">Quantity</p>
                            <p className="text-lg font-semibold text-gray-900">{commodity.quantity}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Current Price</p>
                            <p className="text-sm font-medium text-gray-900">
                              {formatCurrencyString(commodity.currentPrice)}
                            </p>
                          </div>
                        </div>
                        
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-gray-600">Total Value</p>
                              <p className="text-lg font-semibold text-gray-900">
                                {formatCurrencyString(commodity.totalValue)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-gray-600">Gain/Loss</p>
                              <p className={`text-sm font-medium ${
                                commodity.gainLoss >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {commodity.gainLoss >= 0 ? '+' : ''}{formatCurrencyString(commodity.gainLoss)}
                                ({commodity.gainLossPercent >= 0 ? '+' : ''}{commodity.gainLossPercent.toFixed(1)}%)
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Asset Allocation Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Asset Allocation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">By Type</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Property</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrencyString(800000)} (66.7%)
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Vehicles</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrencyString(85000)} (7.1%)
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Commodities</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrencyString(2850)} (0.2%)
                  </span>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Performance</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Return</span>
                  <span className="text-sm font-medium text-green-600">
                    +{formatCurrencyString(calculations.totalGainLoss)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Return Percentage</span>
                  <span className="text-sm font-medium text-green-600">
                    +{calculations.totalGainLossPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Annualized Return</span>
                  <span className="text-sm font-medium text-gray-900">
                    +{(calculations.totalGainLossPercent / 3).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default Assets;
