import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';
import { getLivePrices, getAICommodityPrices } from '../services/geminiService';

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);

    const contextRef = useRef({ dataContext, marketContext });
    contextRef.current = { dataContext, marketContext };

    const previousPricesRef = useRef<Record<string, number>>({});

    const investmentSymbolsSignature = (dataContext?.data?.investments || [])
        .flatMap(p => p.holdings.map(h => h.symbol))
        .sort()
        .join('|');
    const watchlistSymbolsSignature = (dataContext?.data?.watchlist || [])
        .map(w => w.symbol)
        .sort()
        .join('|');
    const plannedTradeSymbolsSignature = (dataContext?.data?.plannedTrades || [])
        .map(t => t.symbol)
        .sort()
        .join('|');
    const commoditySymbolsSignature = (dataContext?.data?.commodityHoldings || [])
        .map(c => c.symbol)
        .sort()
        .join('|');

    useEffect(() => {
        if (!marketContext) return;
        
        const runSimulationTick = async (isRealFetch: boolean = false) => {
            const { dataContext, marketContext } = contextRef.current;
            if (!dataContext || !marketContext || !dataContext.data) return;

            const { data, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices, setIsLive } = marketContext;
            
            const allHoldings = data.investments.flatMap(p => p.holdings);
            const allWatchlistItems = data.watchlist;
            const allPlannedTrades = data.plannedTrades;
            const allCommodities = data.commodityHoldings;
            
            const uniqueSymbols = Array.from(new Set([
                ...allHoldings.map(h => h.symbol),
                ...allWatchlistItems.map(w => w.symbol),
                ...allPlannedTrades.map(t => t.symbol)
            ]));

            const commoditySymbols = allCommodities.map(c => c.symbol);

            let newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            let liveStatus = false;
            
            if (isRealFetch) {
                try {
                    console.log("Fetching real-time prices for:", uniqueSymbols);
                    const [investmentPrices, commodityData] = await Promise.all([
                        uniqueSymbols.length > 0 ? getLivePrices(uniqueSymbols) : Promise.resolve({}),
                        allCommodities.length > 0 ? getAICommodityPrices(allCommodities) : Promise.resolve({ prices: [], groundingChunks: [] })
                    ]);

                    newPrices = { ...investmentPrices };
                    
                    // Map commodity prices to the same format
                    commodityData.prices.forEach(cp => {
                        const oldPrice = currentSimulatedPrices[cp.symbol]?.price || cp.price;
                        const change = cp.price - oldPrice;
                        const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                        newPrices[cp.symbol] = { price: cp.price, change, changePercent };
                    });

                    liveStatus = Object.keys(newPrices).length > 0;
                } catch (error) {
                    console.error("Failed to fetch real prices, falling back to simulation:", error);
                    isRealFetch = false; // Fallback
                }
            }

            // If not real fetch or real fetch failed/returned empty
            if (!isRealFetch || Object.keys(newPrices).length === 0) {
                liveStatus = false;
                const getInitialPrice = (symbol: string) => {
                    if (previousPricesRef.current[symbol]) return previousPricesRef.current[symbol];
                    let hash = 0;
                    for (let i = 0; i < symbol.length; i++) {
                        hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
                    }
                    const price = (hash % 450) + 50; 
                    previousPricesRef.current[symbol] = price;
                    return price;
                };

                const allSymbols = Array.from(new Set([...uniqueSymbols, ...commoditySymbols]));

                allSymbols.forEach(symbol => {
                    const oldPrice = currentSimulatedPrices[symbol]?.price || getInitialPrice(symbol);
                    const changePercentRaw = (Math.random() - 0.495) * 0.03; 
                    const newPrice = Math.max(oldPrice * (1 + changePercentRaw), 0.01);
                    const change = newPrice - oldPrice;
                    const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                    
                    newPrices[symbol] = { price: newPrice, change, changePercent };
                });
            }

            const holdingUpdates: { id: string, currentValue: number }[] = [];
            const commodityUpdates: { id: string, currentValue: number }[] = [];
            const activeAlertsBySymbol = new Map<string, PriceAlert[]>();
            data.priceAlerts.filter(a => a.status === 'active').forEach(alert => {
                if (!activeAlertsBySymbol.has(alert.symbol)) {
                    activeAlertsBySymbol.set(alert.symbol, []);
                }
                activeAlertsBySymbol.get(alert.symbol)!.push(alert);
            });
            const triggeredAlerts: PriceAlert[] = [];

            const allProcessedSymbols = Object.keys(newPrices);
            allProcessedSymbols.forEach(symbol => {
                const { price: newPrice } = newPrices[symbol];
                const oldPrice = currentSimulatedPrices[symbol]?.price || newPrice;
                
                previousPricesRef.current[symbol] = newPrice;

                const relevantAlerts = activeAlertsBySymbol.get(symbol);
                if (relevantAlerts) {
                    relevantAlerts.forEach(relevantAlert => {
                        const hasTriggered = (newPrice >= relevantAlert.targetPrice && oldPrice < relevantAlert.targetPrice) || (newPrice <= relevantAlert.targetPrice && oldPrice > relevantAlert.targetPrice);
                        if (hasTriggered) {
                            triggeredAlerts.push({ ...relevantAlert, status: 'triggered' });
                        }
                    });
                }
            });
            
            setSimulatedPrices(newPrices);
            setIsLive(liveStatus);

            allHoldings.forEach(holding => {
                if (holding.id && newPrices[holding.symbol]) {
                    holdingUpdates.push({
                        id: holding.id,
                        currentValue: newPrices[holding.symbol].price * holding.quantity
                    });
                }
            });

            allCommodities.forEach(commodity => {
                if (commodity.id && newPrices[commodity.symbol]) {
                    commodityUpdates.push({
                        id: commodity.id,
                        currentValue: newPrices[commodity.symbol].price * commodity.quantity
                    });
                }
            });
            
            if (holdingUpdates.length > 0) {
                batchUpdateHoldingValues(holdingUpdates);
            }

            if (commodityUpdates.length > 0) {
                batchUpdateCommodityHoldingValues(commodityUpdates);
            }
            
            if (triggeredAlerts.length > 0) {
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }
        };

        runSimulationTick(true);

    }, [marketContext?.refreshTrigger, investmentSymbolsSignature, watchlistSymbolsSignature, plannedTradeSymbolsSignature, commoditySymbolsSignature]);

    return null;
};

export default MarketSimulator;
