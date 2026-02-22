import React, { useState, useContext, useCallback, useEffect, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert, WatchlistItem } from '../types';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { TrashIcon } from '../components/icons/TrashIcon';
import { getAIResearchNews } from '../services/geminiService';
import { MegaphoneIcon } from '../components/icons/MegaphoneIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import Modal from '../components/Modal';
import PriceAlertModal from '../components/PriceAlertModal';
import { BellAlertIcon } from '../components/icons/BellAlertIcon';
import { BellIcon } from '../components/icons/BellIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { useMarketData } from '../context/MarketDataContext';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

const AddWatchlistItemModal: React.FC<{ isOpen: boolean, onClose: () => void, onAdd: (item: WatchlistItem) => void }> = ({ isOpen, onClose, onAdd }) => {
    const [symbol, setSymbol] = useState('');
    const [name, setName] = useState('');
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (symbol && name) { onAdd({ symbol: symbol.toUpperCase().trim(), name }); setSymbol(''); setName(''); onClose(); } };
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add to Watchlist">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div><label htmlFor="stock-symbol" className="block text-sm font-medium text-gray-700">Stock Symbol</label><input type="text" id="stock-symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div>
                <div><label htmlFor="stock-name" className="block text-sm font-medium text-gray-700">Company Name</label><input type="text" id="stock-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Add Item</button>
            </form>
        </Modal>
    );
};

const WatchlistItemRow: React.FC<{
    item: WatchlistItem,
    priceInfo: { price: number; change: number; changePercent: number },
    activeAlert: PriceAlert | null,
    onOpenAlertModal: (item: WatchlistItem) => void,
    onOpenDeleteModal: (item: WatchlistItem) => void
}> = ({ item, priceInfo, activeAlert, onOpenAlertModal, onOpenDeleteModal }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [flashClass, setFlashClass] = useState('');
    const prevPriceRef = useRef<number | undefined>(undefined);

    const targetPrice = activeAlert?.targetPrice ?? null;
    const targetDistancePercent = targetPrice && targetPrice > 0 ? ((priceInfo.price - targetPrice) / targetPrice) * 100 : null;
    const targetStatusClass = !targetPrice
        ? 'bg-gray-100 text-gray-600'
        : Math.abs(targetDistancePercent || 0) <= 1
            ? 'bg-yellow-100 text-yellow-800'
            : (targetDistancePercent || 0) >= 0
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700';
    const targetStatusLabel = !targetPrice
        ? 'No alert'
        : Math.abs(targetDistancePercent || 0) <= 1
            ? 'Near target'
            : (targetDistancePercent || 0) >= 0
                ? 'Above target'
                : 'Below target';

    useEffect(() => {
        if (priceInfo) {
            if (prevPriceRef.current !== undefined && priceInfo.price !== prevPriceRef.current) {
                setFlashClass(priceInfo.price > prevPriceRef.current ? 'flash-green-bg' : 'flash-red-bg');
                const timer = setTimeout(() => setFlashClass(''), 1000);
                
                prevPriceRef.current = priceInfo.price;
                return () => clearTimeout(timer);
            } else {
                 prevPriceRef.current = priceInfo.price;
            }
        }
    }, [priceInfo]);

    return (
        <tr className={`transition-colors duration-1000 ${flashClass}`}>
            <td className="px-4 py-2 whitespace-nowrap">
                <div className="font-medium text-gray-900">{item.symbol}</div>
                <div className="text-xs text-gray-500 truncate max-w-[150px]">{item.name}</div>
            </td>
            <td className="px-4 py-2 w-32">
                <MiniPriceChart />
            </td>
            <td className="px-4 py-2 text-right font-semibold text-dark whitespace-nowrap tabular-nums">{formatCurrencyString(priceInfo.price)}</td>
            <td className={`px-4 py-2 text-right font-medium text-sm whitespace-nowrap tabular-nums ${priceInfo.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {priceInfo.change >= 0 ? '+' : ''}{formatCurrencyString(priceInfo.change)} ({priceInfo.changePercent.toFixed(2)}%)
            </td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
                <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-gray-500">{targetPrice ? formatCurrencyString(targetPrice) : '--'}</span>
                    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${targetStatusClass}`}>
                        {targetStatusLabel}
                        {targetDistancePercent !== null && ` (${targetDistancePercent >= 0 ? '+' : ''}${targetDistancePercent.toFixed(1)}%)`}
                    </span>
                </div>
            </td>
            <td className="px-4 py-2 text-center">
                <div className="flex justify-center items-center space-x-1">
                    <button onClick={() => onOpenAlertModal(item)} className="text-gray-400 hover:text-yellow-500 p-1" title="Set Price Alert">
                        {activeAlert ? <BellAlertIcon className="h-5 w-5 text-yellow-500"/> : <BellIcon className="h-5 w-5" />}
                    </button>
                    <button onClick={() => onOpenDeleteModal(item)} className="text-gray-400 hover:text-red-500 p-1" title="Delete">
                        <TrashIcon className="h-5 w-5" />
                    </button>
                </div>
            </td>
        </tr>
    );
};


const WatchlistView: React.FC = () => {
    const { data, addWatchlistItem, deleteWatchlistItem, addPriceAlert, updatePriceAlert, deletePriceAlert } = useContext(DataContext)!;
    const { simulatedPrices } = useMarketData();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<WatchlistItem | null>(null);
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
    const [stockForAlert, setStockForAlert] = useState<{ symbol: string, name: string, price: number } | null>(null);
    const [aiResearch, setAiResearch] = useState('');
    const [isNewsLoading, setIsNewsLoading] = useState(false);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);

    const handleOpenDeleteModal = (item: WatchlistItem) => { setItemToDelete(item); setIsDeleteModalOpen(true); };
    const handleConfirmDelete = () => { if (itemToDelete) { deleteWatchlistItem(itemToDelete.symbol); setIsDeleteModalOpen(false); setItemToDelete(null); } };
    const handleGetNews = useCallback(async () => { 
        if (data.watchlist.length === 0) { 
            setAiResearch("Your watchlist is empty. Add a stock to get news."); 
            return; 
        } 
        setIsNewsLoading(true);
        setGroundingChunks([]);
        const { content, groundingChunks } = await getAIResearchNews(data.watchlist); 
        setAiResearch(content); 
        setGroundingChunks(groundingChunks);
        setIsNewsLoading(false); 
    }, [data.watchlist]);
    const handleOpenAlertModal = (item: WatchlistItem) => { setStockForAlert({ ...item, price: simulatedPrices[item.symbol]?.price || 0 }); setIsAlertModalOpen(true); };
    const handleSaveAlert = (symbol: string, targetPrice: number) => { const existing = data.priceAlerts.find(a => a.symbol === symbol); if (existing) { updatePriceAlert({ ...existing, targetPrice, status: 'active' }); } else { addPriceAlert({ symbol, targetPrice }); } };
    const handleDeleteAlert = (symbol: string) => { const existing = data.priceAlerts.find(a => a.symbol === symbol); if (existing) deletePriceAlert(existing.id); };

    return (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-semibold text-dark">My Watchlist</h2><button onClick={() => setIsAddModalOpen(true)} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary text-sm">Add Stock</button></div>
                <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th><th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">30-Day Trend</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Day's Change</th><th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Target</th><th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.watchlist.map((item) => {
                            const priceInfo = simulatedPrices[item.symbol] || { price: 0, change: 0, changePercent: 0 };
                            const activeAlert = data.priceAlerts.find(a => a.symbol === item.symbol && a.status === 'active') || null;
                            return (
                               <WatchlistItemRow
                                  key={item.symbol}
                                  item={item}
                                  priceInfo={priceInfo}
                                  activeAlert={activeAlert}
                                  onOpenAlertModal={handleOpenAlertModal}
                                  onOpenDeleteModal={handleOpenDeleteModal}
                               />
                            );
                        })}
                    </tbody>
                </table>
                {data.watchlist.length === 0 && (<div className="text-center py-10 text-gray-500">Your watchlist is empty.</div>)}</div>
            </div>

            <div className="lg:col-span-1 bg-green-50 p-4 rounded-lg border border-green-200 h-full">
                <div className="flex items-center justify-between"><h4 className="font-semibold text-green-800 flex items-center"><MegaphoneIcon className="h-5 w-5 mr-2"/>AI Research</h4><button onClick={handleGetNews} disabled={isNewsLoading} className="flex items-center px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"><SparklesIcon className="h-4 w-4 mr-1"/>{isNewsLoading ? 'Fetching...' : 'Get News'}</button></div>
                {isNewsLoading && <div className="text-center p-4 text-sm text-gray-500">Fetching latest market info...</div>}
                {aiResearch && !isNewsLoading && (<div className="mt-2"><SafeMarkdownRenderer content={aiResearch} /></div>)}
                {!aiResearch && !isNewsLoading && (<div className="mt-4 text-center text-sm text-green-700">Click "Get News" for AI-generated news on your watchlist items.</div>)}
                 {groundingChunks.length > 0 && (
                    <div className="text-xs text-gray-500 mt-4 pt-2 border-t">
                        <p className="font-semibold text-gray-700">Sources:</p>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            {groundingChunks.map((chunk, index) => (
                                chunk.web && <li key={index}><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{chunk.web.title || chunk.web.uri}</a></li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <AddWatchlistItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addWatchlistItem} />
            <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
            <PriceAlertModal isOpen={isAlertModalOpen} onClose={() => setIsAlertModalOpen(false)} onSave={handleSaveAlert} onDelete={handleDeleteAlert} stock={stockForAlert} existingAlert={data.priceAlerts.find(a => a.symbol === stockForAlert?.symbol) || null} />
        </div>
    );
};

export default WatchlistView;