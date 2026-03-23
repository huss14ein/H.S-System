import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';
import { getLivePrices, getAICommodityPrices } from '../services/geminiService';
import { canonicalQuoteLookupKey } from '../services/finnhubService';

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);

    const contextRef = useRef({ dataContext, marketContext });
    contextRef.current = { dataContext, marketContext };

    const previousPricesRef = useRef<Record<string, number>>({});
    const didInitialPricePassRef = useRef(false);

    /** When portfolio data first loads, run one price pass (live if API key present). */
    useEffect(() => {
        const { data } = dataContext ?? {};
        if (!data || !marketContext?.bumpPriceRefresh) return;
        const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const holdings = inv.flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
        const watch = data?.watchlist ?? [];
        const planned = data?.plannedTrades ?? [];
        const comm = (data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? [];
        const hasSymbols =
            holdings.length > 0 || watch.length > 0 || planned.length > 0 || comm.length > 0;
        if (!hasSymbols || didInitialPricePassRef.current) return;
        didInitialPricePassRef.current = true;
        marketContext.bumpPriceRefresh();
    }, [dataContext?.data, marketContext?.bumpPriceRefresh]);

    useEffect(() => {
        if (!marketContext) return;
        if (marketContext.refreshTrigger === 0) return;
        
        const runSimulationTick = async (isRealFetch: boolean = false) => {
            const { dataContext, marketContext } = contextRef.current;
            if (!dataContext || !marketContext || !dataContext.data) {
                marketContext?.setIsRefreshing(false);
                return;
            }

            const { data, batchUpdateHoldingValues, batchUpdateCommodityHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices, setIsLive, setLastUpdated, touchQuoteTimestamps } = marketContext;
            
            const allHoldings = ((data as any)?.personalInvestments ?? data?.investments ?? []).flatMap((p: { holdings?: unknown[] }) => p.holdings ?? []);
            const allWatchlistItems = data?.watchlist ?? [];
            const allPlannedTrades = data?.plannedTrades ?? [];
            const allCommodities = (data as any)?.personalCommodityHoldings ?? data?.commodityHoldings ?? [];
            
            const uniqueSymbols = Array.from(new Set([
                ...(allHoldings as { symbol?: string }[]).map((h: { symbol?: string }) => h.symbol).filter((s: string | undefined): s is string => s != null && s !== ''),
                ...allWatchlistItems.map((w: { symbol?: string }) => w.symbol).filter((s: string | undefined): s is string => s != null && s !== ''),
                ...allPlannedTrades.map((t: { symbol?: string }) => t.symbol).filter((s: string | undefined): s is string => s != null && s !== '')
            ]));

            const commoditySymbols = (allCommodities as { symbol?: string }[]).map((c: { symbol?: string }) => c.symbol).filter((s: string | undefined): s is string => s != null && s !== '');

            let newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            let liveStatus = false;
            
            if (isRealFetch) {
                try {
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
                    if (liveStatus && setLastUpdated) setLastUpdated(new Date());
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
            (data?.priceAlerts ?? []).filter(a => a.status === 'active').forEach(alert => {
                const sym = alert.symbol;
                if (sym == null) return;
                if (!activeAlertsBySymbol.has(sym)) {
                    activeAlertsBySymbol.set(sym, []);
                }
                activeAlertsBySymbol.get(sym)!.push(alert);
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
            touchQuoteTimestamps(Object.keys(newPrices));

            (allHoldings as { id?: string; symbol?: string; quantity?: number }[]).forEach((holding: { id?: string; symbol?: string; quantity?: number }) => {
                const sym = holding.symbol;
                if (sym == null || !holding.id) return;
                const row = newPrices[sym] ?? newPrices[canonicalQuoteLookupKey(sym)];
                if (row) {
                    holdingUpdates.push({
                        id: holding.id,
                        currentValue: row.price * (holding.quantity ?? 0)
                    });
                }
            });

            (allCommodities as { id?: string; symbol?: string; quantity?: number }[]).forEach((commodity: { id?: string; symbol?: string; quantity?: number }) => {
                const sym = commodity.symbol;
                if (commodity.id && sym != null && newPrices[sym]) {
                    commodityUpdates.push({
                        id: commodity.id,
                        currentValue: newPrices[sym].price * (commodity.quantity ?? 0)
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

        void (async () => {
            try {
                await runSimulationTick(true);
            } catch (e) {
                console.error('MarketSimulator tick failed:', e);
            } finally {
                contextRef.current.marketContext?.setIsRefreshing(false);
            }
        })();

    }, [marketContext?.refreshTrigger]);

    return null;
};

export default MarketSimulator;
