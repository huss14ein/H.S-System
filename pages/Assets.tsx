import React, { useState, useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PageLayout from '../components/PageLayout';
import Modal from '../components/Modal';
import { 
  BuildingLibraryIcon, 
  TruckIcon, 
  CurrencyDollarIcon,
  BanknotesIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ChartBarIcon
} from '../components/icons';
import { Asset as AssetType, CommodityHolding as CommodityHoldingType } from '../types';

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

const Assets: React.FC = () => {
  const { data, loading, addAsset, updateAsset, deleteAsset, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();

  const [activeTab, setActiveTab] = useState<'physical' | 'commodities'>('physical');
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [isCommodityModalOpen, setIsCommodityModalOpen] = useState(false);
  const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
  const [commodityToEdit, setCommodityToEdit] = useState<CommodityHolding | null>(null);

  // Use real data from context
  const realAssets: Asset[] = useMemo(() => {
    return (data?.assets ?? []).map(asset => ({
      id: asset.id,
      name: asset.name,
      type: (asset.type === 'Property' ? 'Property' : asset.type === 'Vehicle' ? 'Vehicle' : asset.type === 'Sukuk' ? 'Sukuk' : 'Other') as Asset['type'],
      value: asset.value ?? 0,
      currency: asset.currency ?? 'SAR',
      purchaseDate: asset.purchaseDate ?? new Date().toISOString().split('T')[0],
      purchaseValue: asset.purchaseValue ?? asset.value ?? 0,
      description: asset.description,
      goalId: asset.goalId
    }));
  }, [data?.assets]);

  const realCommodities: CommodityHolding[] = useMemo(() => {
    return (data?.commodityHoldings ?? []).map(commodity => {
      const currentValue = commodity.currentValue ?? 0;
      const purchaseValue = (commodity.purchasePrice ?? 0) * (commodity.quantity ?? 0);
      const gainLoss = currentValue - purchaseValue;
      const gainLossPercent = purchaseValue > 0 ? (gainLoss / purchaseValue) * 100 : 0;
      
      return {
        id: commodity.id,
        symbol: commodity.symbol ?? '',
        name: commodity.name ?? commodity.symbol ?? '',
        quantity: commodity.quantity ?? 0,
        currentPrice: (commodity.currentPrice ?? 0),
        currency: commodity.currency ?? 'SAR',
        purchasePrice: commodity.purchasePrice ?? 0,
        totalValue: currentValue,
        gainLoss,
        gainLossPercent
      };
    });
  }, [data?.commodityHoldings]);

    const calculations = useMemo(() => {
    const assets = realAssets || [];
    const commodities = realCommodities || [];

    const totalPhysicalAssets = assets.reduce((sum, asset) => 
      sum + (asset.value ?? 0), 0
    );

    const totalCommodities = commodities.reduce((sum, commodity) => 
      sum + (commodity.totalValue ?? 0), 0
    );

    const commodityGainLoss = commodities.reduce((sum, commodity) => 
      sum + (commodity.gainLoss ?? 0), 0
    );

    // Calculate gain/loss for physical assets
    const physicalGainLoss = assets.reduce((sum, asset) => {
      const gain = (asset.value ?? 0) - (asset.purchaseValue ?? 0);
      return sum + gain;
    }, 0);
    
    const totalPurchaseValue = assets.reduce((sum, asset) => sum + (asset.purchaseValue ?? 0), 0);
    const totalGainLossAll = physicalGainLoss + commodityGainLoss;
    const totalGainLossPercent = totalPurchaseValue > 0 
      ? ((totalPhysicalAssets - totalPurchaseValue) / totalPurchaseValue) * 100 
      : 0;

    return {
      totalPhysicalAssets,
      totalCommodities,
      totalAssetValue: totalPhysicalAssets + totalCommodities,
      totalGainLoss: totalGainLossAll,
      totalGainLossPercent,
      assetCount: assets.length,
      commodityCount: commodities.length,
      physicalGainLoss,
      commodityGainLoss
    };
  }, [realAssets, realCommodities]);

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
              <BuildingLibraryIcon className="h-8 w-8 text-green-200" />
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
                    onClick={() => { setAssetToEdit(null); setIsAssetModalOpen(true); }}
                    className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Add Asset
                  </button>
                </div>

                {realAssets.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <BuildingLibraryIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No physical assets recorded yet.</p>
                    <p className="text-sm mt-2">Click "Add Asset" to get started.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {realAssets.map(asset => (
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
                          <button 
                            onClick={() => { setAssetToEdit(asset); setIsAssetModalOpen(true); }}
                            className="text-gray-400 hover:text-gray-600"
                            aria-label="Edit asset"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Delete ${asset.name}?`)) {
                                deleteAsset(asset.id);
                              }
                            }}
                            className="text-gray-400 hover:text-red-600"
                            aria-label="Delete asset"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-gray-600">Current Value</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {formatCurrencyString(asset.value ?? 0)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Purchase</p>
                            <p className="text-sm font-medium text-gray-900">
                              {formatCurrencyString(asset.purchaseValue)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(asset.purchaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </p>
                            {(asset.value - asset.purchaseValue) !== 0 && asset.purchaseValue > 0 && (
                              <p className={`text-xs font-medium mt-1 ${
                                (asset.value - asset.purchaseValue) >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {(asset.value - asset.purchaseValue) >= 0 ? '+' : ''}
                                {formatCurrencyString(asset.value - asset.purchaseValue)}
                                ({((asset.value - asset.purchaseValue) / asset.purchaseValue * 100).toFixed(1)}%)
                              </p>
                            )}
                            {asset.purchaseValue === 0 && asset.value !== 0 && (
                              <p className="text-xs font-medium mt-1 text-slate-500">
                                {formatCurrencyString(asset.value - asset.purchaseValue)} (N/A %)
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'commodities' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Commodity Holdings</h3>
                  <button
                    onClick={() => { setCommodityToEdit(null); setIsCommodityModalOpen(true); }}
                    className="flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Add Commodity
                  </button>
                </div>

                {realCommodities.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <CurrencyDollarIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No commodity holdings recorded yet.</p>
                    <p className="text-sm mt-2">Click "Add Commodity" to get started.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {realCommodities.map(commodity => (
                    <div key={commodity.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">{commodity.name}</h4>
                          <p className="text-sm text-gray-600">{commodity.symbol}</p>
                        </div>
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => { setCommodityToEdit(commodity); setIsCommodityModalOpen(true); }}
                            className="text-gray-400 hover:text-gray-600"
                            aria-label="Edit commodity"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Delete ${commodity.name}?`)) {
                                deleteCommodityHolding(commodity.id);
                              }
                            }}
                            className="text-gray-400 hover:text-red-600"
                            aria-label="Delete commodity"
                          >
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
                            <p className="text-xs text-gray-500 mt-1">
                              Purchase: {formatCurrencyString(commodity.purchasePrice)}
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
                )}
              </div>
            )}
          </div>
        </div>

        {/* Asset Allocation Chart - Real Data */}
        {(() => {
          const typeBreakdown = useMemo(() => {
            const byType = new Map<string, number>();
            realAssets.forEach(asset => {
              const type = asset.type;
              byType.set(type, (byType.get(type) || 0) + (asset.value ?? 0));
            });
            return Array.from(byType.entries()).map(([type, value]) => ({
              type,
              value,
              percentage: calculations.totalAssetValue > 0 ? (value / calculations.totalAssetValue) * 100 : 0
            }));
          }, [realAssets, calculations.totalAssetValue]);

          // Calculate annualized return based on purchase dates
          const annualizedReturn = useMemo(() => {
            if (realAssets.length === 0) return 0;
            const now = new Date();
            const totalYears = realAssets.reduce((sum, asset) => {
              const purchaseDate = new Date(asset.purchaseDate);
              const years = (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
              return sum + Math.max(years, 0.1); // Minimum 0.1 years to avoid division by zero
            }, 0);
            const avgYears = totalYears / realAssets.length;
            return avgYears > 0 ? calculations.totalGainLossPercent / avgYears : 0;
          }, [realAssets, calculations.totalGainLossPercent]);

          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Asset Allocation & Performance</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">By Type</h3>
                  <div className="space-y-2">
                    {typeBreakdown.length > 0 ? (
                      typeBreakdown.map(({ type, value, percentage }) => (
                        <div key={type} className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">{type}</span>
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrencyString(value)} ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">No assets to display</p>
                    )}
                    {calculations.totalCommodities > 0 && (
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="text-sm text-gray-600">Commodities</span>
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrencyString(calculations.totalCommodities)} 
                          ({calculations.totalAssetValue > 0 ? ((calculations.totalCommodities / calculations.totalAssetValue) * 100).toFixed(1) : '0'}%)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Performance</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total Return</span>
                      <span className={`text-sm font-medium ${
                        calculations.totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {calculations.totalGainLoss >= 0 ? '+' : ''}{formatCurrencyString(calculations.totalGainLoss)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Physical Assets Return</span>
                      <span className={`text-sm font-medium ${
                        calculations.physicalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {calculations.physicalGainLoss >= 0 ? '+' : ''}{formatCurrencyString(calculations.physicalGainLoss)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Commodities Return</span>
                      <span className={`text-sm font-medium ${
                        calculations.commodityGainLoss >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {calculations.commodityGainLoss >= 0 ? '+' : ''}{formatCurrencyString(calculations.commodityGainLoss)}
                      </span>
                    </div>
                    {calculations.totalGainLossPercent !== 0 && (
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="text-sm text-gray-600">Return Percentage</span>
                        <span className={`text-sm font-medium ${
                          calculations.totalGainLossPercent >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {calculations.totalGainLossPercent >= 0 ? '+' : ''}{calculations.totalGainLossPercent.toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {annualizedReturn !== 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Annualized Return</span>
                        <span className={`text-sm font-medium ${
                          annualizedReturn >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {annualizedReturn >= 0 ? '+' : ''}{annualizedReturn.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Asset Modal */}
      <Modal isOpen={isAssetModalOpen} onClose={() => { setIsAssetModalOpen(false); setAssetToEdit(null); }} title={assetToEdit ? 'Edit Asset' : 'Add Asset'}>
        <AssetForm 
          asset={assetToEdit}
          onSave={async (assetData) => {
            if (assetToEdit) {
              await updateAsset({ ...assetToEdit, ...assetData } as AssetType);
            } else {
              await addAsset(assetData as AssetType);
            }
            setIsAssetModalOpen(false);
            setAssetToEdit(null);
          }}
        />
      </Modal>

      {/* Commodity Modal */}
      <Modal isOpen={isCommodityModalOpen} onClose={() => { setIsCommodityModalOpen(false); setCommodityToEdit(null); }} title={commodityToEdit ? 'Edit Commodity' : 'Add Commodity'}>
        <CommodityForm 
          commodity={commodityToEdit}
          onSave={async (commodityData) => {
            if (commodityToEdit) {
              await updateCommodityHolding({ ...commodityToEdit, ...commodityData } as CommodityHoldingType);
            } else {
              await addCommodityHolding(commodityData as Omit<CommodityHoldingType, 'id' | 'user_id'>);
            }
            setIsCommodityModalOpen(false);
            setCommodityToEdit(null);
          }}
        />
      </Modal>
    </PageLayout>
  );
};

// Asset Form Component
const AssetForm: React.FC<{ asset: Asset | null; onSave: (data: Partial<Asset>) => Promise<void> }> = ({ asset, onSave }) => {
  const [name, setName] = useState(asset?.name || '');
  const [type, setType] = useState<Asset['type']>(asset?.type || 'Property');
  const [value, setValue] = useState(String(asset?.value || ''));
  const [purchaseValue, setPurchaseValue] = useState(String(asset?.purchaseValue || ''));
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate || new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState(asset?.description || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      name,
      type,
      value: parseFloat(value) || 0,
      purchaseValue: parseFloat(purchaseValue) || 0,
      purchaseDate,
      description,
      currency: 'SAR'
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Asset Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <select value={type} onChange={e => setType(e.target.value as Asset['type'])} className="select-base">
          <option value="Property">Property</option>
          <option value="Vehicle">Vehicle</option>
          <option value="Sukuk">Sukuk</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Current Value (SAR)</label>
        <input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Value (SAR)</label>
        <input type="number" step="0.01" value={purchaseValue} onChange={e => setPurchaseValue(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
        <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-base" rows={3} />
      </div>
      <button type="submit" className="w-full btn-primary">Save Asset</button>
    </form>
  );
};

// Commodity Form Component
const CommodityForm: React.FC<{ commodity: CommodityHolding | null; onSave: (data: Partial<CommodityHolding>) => Promise<void> }> = ({ commodity, onSave }) => {
  const [symbol, setSymbol] = useState(commodity?.symbol || '');
  const [name, setName] = useState(commodity?.name || '');
  const [quantity, setQuantity] = useState(String(commodity?.quantity || ''));
  const [purchasePrice, setPurchasePrice] = useState(String(commodity?.purchasePrice || ''));
  const [currentPrice, setCurrentPrice] = useState(String(commodity?.currentPrice || ''));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity) || 0;
    const price = parseFloat(currentPrice) || parseFloat(purchasePrice) || 0;
    await onSave({
      symbol: symbol.toUpperCase(),
      name: name || symbol.toUpperCase(),
      quantity: qty,
      purchasePrice: parseFloat(purchasePrice) || 0,
      currentPrice: price,
      currency: 'SAR',
      currentValue: qty * price
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Symbol (e.g., GOLD, SILVER)</label>
        <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input-base" placeholder="Auto-filled from symbol" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
        <input type="number" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price per Unit (SAR)</label>
        <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} required className="input-base" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Current Price per Unit (SAR)</label>
        <input type="number" step="0.01" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} required className="input-base" />
      </div>
      <button type="submit" className="w-full btn-primary">Save Commodity</button>
    </form>
  );
};

export default Assets;
