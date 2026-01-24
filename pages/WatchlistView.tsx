
import React, { useState, useContext, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { WatchlistItem } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { TrashIcon } from '../components/icons/TrashIcon';
import { getAIResearchNews } from '../services/geminiService';
import { MegaphoneIcon } from '../components/icons/MegaphoneIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';

// Mock price simulation for display purposes
const useSimulatedPrices = (watchlist: WatchlistItem[]) => {
    const [prices, setPrices] = useState<Record<string, { price: number; change: number; changePercent: number }>>({});

    React.useEffect(() => {
        const getInitialPrice = (symbol: string) => {
            // Simple hash function for pseudo-random but consistent starting prices
            let hash = 0;
            for (let i = 0; i < symbol.length; i++) {
                hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
            }
            return (hash % 450) + 50; // Price between 50 and 500
        };

        const initialPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
        watchlist.forEach(item => {
            initialPrices[item.symbol] = {
                price: getInitialPrice(item.symbol),
                change: 0,
                changePercent: 0,
            };
        });
        setPrices(initialPrices);

        const interval = setInterval(() => {
            setPrices(prevPrices => {
                const newPrices = { ...prevPrices };
                watchlist.forEach(item => {
                    const symbol = item.symbol;
                    const oldPrice = newPrices[symbol]?.price || getInitialPrice(symbol);
                    const change = (Math.random() - 0.5) * (oldPrice / 50);
                    const newPrice = oldPrice + change;
                    newPrices[symbol] = {
                        price: newPrice,
                        change: change,
                        changePercent: (change / oldPrice) * 100,
                    };
                });
                return newPrices;
            });
        }, 3000);

        return () => clearInterval(interval);
    }, [watchlist]);

    return prices;
};


const AddWatchlistItemModal: React.FC<{ isOpen: boolean, onClose: () => void, onAdd: (item: WatchlistItem) => void }> = ({ isOpen, onClose, onAdd }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (symbol && name) {
            onAdd({ symbol: symbol.toUpperCase().trim(), name });
            setSymbol('');
            setName('');
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add to Watchlist">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="stock-symbol" className="block text-sm font-medium text-gray-700">Stock Symbol (e.g., GOOGL)</label>
                    <input type="text" id="stock-symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary"/>
                </div>
                <div>
                    <label htmlFor="stock-name" className="block text-sm font-medium text-gray-700">Company Name</label>
                    <input type="text" id="stock-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary"/>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Add Item</button>
            </form>
        </Modal>
    );
};


const WatchlistView: React.FC = () => {
    const { data, addWatchlistItem, deleteWatchlistItem } = useContext(DataContext)!;
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<WatchlistItem | null>(null);
    const [aiResearch, setAiResearch] = useState('');
    const [isNewsLoading, setIsNewsLoading] = useState(false);

    const prices = useSimulatedPrices(data.watchlist);

    const handleOpenDeleteModal = (item: WatchlistItem) => {
        setItemToDelete(item);
        setIsDeleteModalOpen(true);
    };

    const handleConfirmDelete = () => {
        if (itemToDelete) {
            deleteWatchlistItem(itemToDelete.symbol);
            setIsDeleteModalOpen(false);
            setItemToDelete(null);
        }
    };

    const handleGetNews = useCallback(async () => {
        if (data.watchlist.length === 0) {
            setAiResearch("Your watchlist is empty. Add some stocks to get AI-powered news and research.");
            return;
        }
        setIsNewsLoading(true);
        const news = await getAIResearchNews(data.watchlist);
        setAiResearch(news);
        setIsNewsLoading(false);
    }, [data.watchlist]);

    const formatCurrency = (value: number, digits = 2) => `SAR ${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

    return (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Watchlist Table */}
            <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-dark">My Watchlist</h2>
                    <button onClick={() => setIsAddModalOpen(true)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors text-sm">
                        Add Stock
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Day's Change</th>
                                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {data.watchlist.map((item) => {
                                const priceInfo = prices[item.symbol] || { price: 0, change: 0, changePercent: 0 };
                                const changeColor = priceInfo.change >= 0 ? 'text-green-600' : 'text-red-600';
                                return (
                                    <tr key={item.symbol} className="hover:bg-gray-50">
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="font-medium text-gray-900">{item.symbol}</div>
                                            <div className="text-xs text-gray-500">{item.name}</div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-right font-semibold text-dark">{formatCurrency(priceInfo.price)}</td>
                                        <td className={`px-4 py-4 whitespace-nowrap text-right font-medium text-sm ${changeColor}`}>
                                            {priceInfo.change >= 0 ? '+' : ''}{formatCurrency(priceInfo.change)} ({priceInfo.changePercent.toFixed(2)}%)
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-center">
                                            <button onClick={() => handleOpenDeleteModal(item)} className="text-gray-400 hover:text-red-500 p-1">
                                                <TrashIcon className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {data.watchlist.length === 0 && (
                        <div className="text-center py-10 text-gray-500">
                            Your watchlist is empty. Click "Add Stock" to start tracking.
                        </div>
                    )}
                </div>
            </div>

            {/* AI Research Panel */}
            <div className="lg:col-span-1 bg-green-50 p-4 rounded-lg border border-green-200 h-full">
                <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-green-800 flex items-center"><MegaphoneIcon className="h-5 w-5 mr-2"/>AI Research</h4>
                    <button onClick={handleGetNews} disabled={isNewsLoading} className="flex items-center px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors">
                        <SparklesIcon className="h-4 w-4 mr-1"/>
                        {isNewsLoading ? 'Fetching...' : 'Get News'}
                    </button>
                </div>
                {isNewsLoading && <div className="text-center p-4 text-sm text-gray-500">Fetching latest market info...</div>}
                {aiResearch && !isNewsLoading && (
                    <div className="mt-2 prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: aiResearch.replace(/### (.*)/g, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }} />
                )}
                {!aiResearch && !isNewsLoading && (
                    <div className="mt-4 text-center text-sm text-green-700">
                        Click "Get News" for fictional AI-generated news and dividend updates on your watchlist items.
                    </div>
                )}
            </div>

            <AddWatchlistItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addWatchlistItem} />
            <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
        </div>
    );
};

export default WatchlistView;
