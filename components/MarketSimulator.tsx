
import React, { useEffect, useContext, useRef } from 'react';
import { DataContext } from '../context/DataContext';
import { PriceAlert } from '../types';

const MarketSimulator: React.FC = () => {
    const context = useContext(DataContext);
    const contextRef = useRef(context);
    contextRef.current = context;

    const previousPricesRef = useRef<Record<string, number>>({});

    useEffect(() => {
        const interval = setInterval(() => {
            const { data, batchUpdateHoldingValues, updatePriceAlert, setSimulatedPrices } = contextRef.current!;
            if (!data) return;

            const allHoldings = data.investments.flatMap(p => p.holdings);
            const allWatchlistItems = data.watchlist;
            
            const uniqueSymbols = Array.from(new Set([
                ...allHoldings.map(h => h.symbol),
                ...allWatchlistItems.map(w => w.symbol)
            ]));

            if (uniqueSymbols.length === 0) return;

            const newPrices: Record<string, { price: number; change: number; changePercent: number }> = {};
            const holdingUpdates: { id: string, currentValue: number }[] = [];
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
                const oldPrice = data.simulatedPrices[symbol]?.price || getInitialPrice(symbol);
                const changePercentRaw = (Math.random() - 0.495) * 0.03; // More volatility
                const newPrice = Math.max(oldPrice * (1 + changePercentRaw), 0.01);
                const change = newPrice - oldPrice;
                const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
                
                newPrices[symbol] = { price: newPrice, change, changePercent };
                previousPrices[symbol] = newPrice;

                // Check for price alerts
                const relevantAlert = data.priceAlerts.find(a => a.symbol === symbol && a.status === 'active');
                if (relevantAlert && ((newPrice >= relevantAlert.targetPrice && oldPrice < relevantAlert.targetPrice) || (newPrice <= relevantAlert.targetPrice && oldPrice > relevantAlert.targetPrice))) {
                     triggeredAlerts.push({ ...relevantAlert, status: 'triggered' });
                }
            });
            
            setSimulatedPrices(newPrices);

            allHoldings.forEach(holding => {
                if (newPrices[holding.symbol]) {
                    holdingUpdates.push({
                        id: holding.id!,
                        currentValue: newPrices[holding.symbol].price * holding.quantity
                    });
                }
            });
            
            if (holdingUpdates.length > 0) {
                batchUpdateHoldingValues(holdingUpdates);
            }
            
            if (triggeredAlerts.length > 0) {
                triggeredAlerts.forEach(alert => updatePriceAlert(alert));
            }

        }, 3000);

        return () => clearInterval(interval);
    }, []);

    return null;
};

export default MarketSimulator;
