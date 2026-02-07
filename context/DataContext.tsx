import React, { createContext, useState, ReactNode } from 'react';
import { mockFinancialData } from '../data/mockData';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert } from '../types';

interface DataContextType {
  data: FinancialData;
  loading: boolean;
  addAsset: (asset: Omit<Asset, 'id' | 'user_id'>) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  addGoal: (goal: Omit<Goal, 'id'|'user_id'>) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (goalId: string) => Promise<void>;
  updateGoalAllocations: (allocations: { id: string, savingsAllocationPercent: number }[]) => Promise<void>;
  addLiability: (liability: Omit<Liability, 'id' | 'user_id'>) => Promise<void>;
  updateLiability: (liability: Liability) => Promise<void>;
  deleteLiability: (liabilityId: string) => Promise<void>;
  addBudget: (budget: Budget) => Promise<void>;
  updateBudget: (budget: Budget) => Promise<void>;
  deleteBudget: (category: string) => Promise<void>;
  addTransaction: (transaction: Omit<Transaction, 'id' | 'user_id'>) => Promise<void>;
  updateTransaction: (transaction: Transaction) => Promise<void>;
  deleteTransaction: (transactionId: string) => Promise<void>;
  addPlatform: (platform: Omit<Account, 'id' | 'user_id' | 'balance'>) => Promise<void>;
  updatePlatform: (platform: Account) => Promise<void>;
  deletePlatform: (platformId: string) => Promise<void>;
  addPortfolio: (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>) => Promise<void>;
  updatePortfolio: (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => Promise<void>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  batchUpdateHoldingValues: (updates: { id: string; currentValue: number }[]) => void;
  recordTrade: (trade: Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>) => Promise<void>;
  addWatchlistItem: (item: WatchlistItem) => Promise<void>;
  deleteWatchlistItem: (symbol: string) => Promise<void>;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => Promise<void>;
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'user_id' | 'status' | 'createdAt'>) => Promise<void>;
  updatePriceAlert: (alert: PriceAlert) => Promise<void>;
  deletePriceAlert: (alertId: string) => Promise<void>;
  resetData: () => Promise<void>;
}

export const DataContext = createContext<DataContextType | null>(null);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(mockFinancialData);
    const [loading] = useState(false);

    const resetData = async () => setData(mockFinancialData);

    // --- Assets ---
    const addAsset = async (asset: Omit<Asset, 'id'>) => setData(prev => ({ ...prev, assets: [...prev.assets, { ...asset, id: `asset_${Date.now()}` }] }));
    const updateAsset = async (asset: Asset) => setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === asset.id ? asset : a) }));
    const deleteAsset = async (assetId: string) => setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));

    // --- Goals ---
    const addGoal = async (goal: Omit<Goal, 'id'>) => setData(prev => ({ ...prev, goals: [...prev.goals, { ...goal, id: `goal_${Date.now()}` }] }));
    const updateGoal = async (goal: Goal) => setData(prev => ({ ...prev, goals: prev.goals.map(g => g.id === goal.id ? goal : g) }));
    const deleteGoal = async (goalId: string) => setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    const updateGoalAllocations = async (allocations: { id: string, savingsAllocationPercent: number }[]) => {
        setData(prev => ({ ...prev, goals: prev.goals.map(g => { const newAlloc = allocations.find(a => a.id === g.id); return newAlloc ? { ...g, ...newAlloc } : g; }) }));
    };

    // --- Liabilities ---
    const addLiability = async (liability: Omit<Liability, 'id'>) => setData(prev => ({ ...prev, liabilities: [...prev.liabilities, { ...liability, id: `liab_${Date.now()}` }] }));
    const updateLiability = async (liability: Liability) => setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === liability.id ? liability : l) }));
    const deleteLiability = async (liabilityId: string) => setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));

    // --- Budgets ---
    const addBudget = async (budget: Budget) => setData(prev => ({ ...prev, budgets: [...prev.budgets, budget] }));
    const updateBudget = async (budget: Budget) => setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === budget.category ? budget : b) }));
    const deleteBudget = async (category: string) => setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) }));

    // --- Transactions ---
    const addTransaction = async (transaction: Omit<Transaction, 'id'>) => setData(prev => ({ ...prev, transactions: [{ ...transaction, id: `txn_${Date.now()}` }, ...prev.transactions] }));
    const updateTransaction = async (transaction: Transaction) => setData(prev => ({ ...prev, transactions: prev.transactions.map(t => t.id === transaction.id ? transaction : t) }));
    const deleteTransaction = async (transactionId: string) => setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));

    // --- Accounts / Platforms ---
    const addPlatform = async (platform: Omit<Account, 'id' | 'balance'>) => setData(prev => ({ ...prev, accounts: [...prev.accounts, { ...platform, id: `acc_${Date.now()}`, balance: 0 }] }));
    const updatePlatform = async (platform: Account) => setData(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === platform.id ? platform : a) }));
    const deletePlatform = async (platformId: string) => setData(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== platformId) }));

    // --- Investments ---
    const addPortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'holdings'>) => setData(prev => ({ ...prev, investments: [...prev.investments, { ...portfolio, id: `port_${Date.now()}`, holdings: [] }] }));
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => setData(prev => ({ ...prev, investments: prev.investments.map(p => p.id === portfolio.id ? { ...p, ...portfolio } : p) }));
    const deletePortfolio = async (portfolioId: string) => setData(prev => ({ ...prev, investments: prev.investments.filter(p => p.id !== portfolioId) }));
    const updateHolding = async (holding: Holding) => {
        setData(prev => ({
            ...prev,
            investments: prev.investments.map(p => ({
                ...p,
                holdings: p.holdings.map(h => h.id === holding.id ? holding : h)
            }))
        }));
    };
    const batchUpdateHoldingValues = (updates: { id: string; currentValue: number }[]) => {
        setData(prevData => {
            const updatesMap = new Map(updates.map(u => [u.id, u.currentValue]));
            return {
                ...prevData,
                investments: prevData.investments.map(p => ({
                    ...p,
                    holdings: p.holdings.map(h => h.id && updatesMap.has(h.id) ? { ...h, currentValue: updatesMap.get(h.id)! } : h)
                }))
            };
        });
    };
    const recordTrade = async (trade: Omit<InvestmentTransaction, 'id' | 'total'>) => {
        setData(prev => {
            const newState = JSON.parse(JSON.stringify(prev)); // Deep copy
            newState.investmentTransactions.unshift({ ...trade, id: `itxn_${Date.now()}`, total: trade.quantity * trade.price });
            
            const portfolio = newState.investments.find((p: InvestmentPortfolio) => p.accountId === trade.accountId);
            if (!portfolio) return prev;

            const holdingIndex = portfolio.holdings.findIndex((h: Holding) => h.symbol === trade.symbol);
            if (trade.type === 'buy') {
                if (holdingIndex > -1) {
                    const h = portfolio.holdings[holdingIndex];
                    h.avgCost = ((h.avgCost * h.quantity) + (trade.price * trade.quantity)) / (h.quantity + trade.quantity);
                    h.quantity += trade.quantity;
                } else {
                    portfolio.holdings.push({ id: `h_${Date.now()}`, symbol: trade.symbol, name: trade.symbol, quantity: trade.quantity, avgCost: trade.price, currentValue: trade.price * trade.quantity, zakahClass: 'Zakatable', realizedPnL: 0 });
                }
            } else { // sell
                if (holdingIndex > -1) {
                    const h = portfolio.holdings[holdingIndex];
                    h.realizedPnL += (trade.price - h.avgCost) * trade.quantity;
                    h.quantity -= trade.quantity;
                    if (h.quantity <= 0.00001) portfolio.holdings.splice(holdingIndex, 1);
                }
            }
            return newState;
        });
    };

    // --- Watchlist & Alerts ---
    const addWatchlistItem = async (item: WatchlistItem) => setData(prev => ({ ...prev, watchlist: [...prev.watchlist, item] }));
    const deleteWatchlistItem = async (symbol: string) => setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    const addPriceAlert = async (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>) => setData(prev => ({ ...prev, priceAlerts: [...prev.priceAlerts, { ...alert, id: `alert_${Date.now()}`, status: 'active', createdAt: new Date().toISOString() }] }));
    const updatePriceAlert = async (alert: PriceAlert) => setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.map(a => a.id === alert.id ? alert : a) }));
    const deletePriceAlert = async (alertId: string) => setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.filter(a => a.id !== alertId) }));

    // --- Zakat ---
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id'>) => setData(prev => ({ ...prev, zakatPayments: [{ ...payment, id: `zakat_${Date.now()}` }, ...prev.zakatPayments] }));

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, addTransaction, updateTransaction, deleteTransaction, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, resetData };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
