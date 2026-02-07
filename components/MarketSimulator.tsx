import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';
import { MarketDataContext } from '../context/MarketDataContext';

const MarketSimulator: React.FC = () => {
    const dataContext = useContext(DataContext);
    const marketContext = useContext(MarketDataContext);

    const contextRef = useRef({ dataContext, marketContext });
    contextRef.current = { dataContext, marketContext };

    const previousPricesRef = useRef<Record<string, number>>({});

    useEffect(() => {
        let intervalId: number | null = null;

        const runSimulationTick = () => {
            const { dataContext, marketContext } = contextRef.current;
            if (!dataContext || !marketContext || !dataContext.data) return;

            const { data, batchUpdateHoldingValues, updatePriceAlert } = dataContext;
            const { setSimulatedPrices, simulatedPrices: currentSimulatedPrices } = marketContext;
            
            const allHoldings = data.investments.flatMap(p => p.holdings);
            const allWatchlistItems = data.watchlist;
            
            const uniqueSymbols = Array.from(new Set([
                ...allHoldings.map(h => h.symbol),
                ...allWatchlistItems.map(w => w.symbol)
            ]));

            if (uniqueSymbols.length === 0) return;

            const newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            const holdingUpdates: { id: string, currentValue: number }[] = [];
            
            const activeAlertsBySymbol = new Map<string, PriceAlert[]>();
            data.priceAlerts.filter(a => a.status === 'active').forEach(alert => {
                if (!activeAlertsBySymbol.has(alert.symbol)) {
                    activeAlertsBySymbol.set(alert.symbol, []);
                }
                activeAlertsBySymbol.get(alert.symbol)!.push(alert);
            });
            const triggeredAlerts: PriceAlert[] = [];
            const previousPrices = previousPricesRef.current;

            const getInitialPrice = (symbol: string) => {
                if (previousPrices[symbol]) return previousPrices[symbol];
                let hash = 0;
                for (let i = 0; i < symbol.length; i++) {
                    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
                }
                const price = (hash % 450) + 50; // Simple hash-based starting price
                previousPrices[symbol] = price;
                return price;
            };

            uniqueSymbols.forEach(symbol => {
                const oldPrice = currentSimulatedPrices[symbol]?.price || getInitialPrice(symbol);
                const changePercentRaw = (Math.random() - 0.495) * 0.03; // More volatility
                const newPrice = Math.max(oldPrice * (1 + changePercentRaw), 0.01);
                const change = newPrice - oldPrice;
                const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                
                newPrices[symbol] = { price: newPrice, change, changePercent };
                previousPrices[symbol] = newPrice;

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

            allHoldings.forEach(holding => {
                if (holding.id && newPrices[holding.symbol]) {
                    holdingUpdates.push({
                        id: holding.id,
                        currentValue: newPrices[holding.symbol].price * holding.quantity
                    });
                }
            });
            
            if (holdingUpdates.length > 0) {
                batchUpdateHoldingValues(holdingUpdates);
            }
            
            if (triggeredAlerts.length > 0) {
                // Ensure we only trigger each alert once per simulation run
                const uniqueTriggered = Array.from(new Map(triggeredAlerts.map(a => [a.id, a])).values());
                uniqueTriggered.forEach(alert => updatePriceAlert(alert));
            }
        };

        const startSimulator = () => {
            if (intervalId === null) {
                runSimulationTick(); // Run once immediately
                intervalId = window.setInterval(runSimulationTick, 3000);
            }
        };

        const stopSimulator = () => {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopSimulator();
            } else {
                startSimulator();
            }
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
        startSimulator();

        return () => {
            stopSimulator();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return null;
};

export default MarketSimulator;