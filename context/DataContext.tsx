import React, { createContext, useState, ReactNode, useEffect } from 'react';
import { mockFinancialData } from '../data/mockData';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment } from '../types';

interface DataContextType {
  data: FinancialData;
  updateAsset: (asset: Asset) => void;
  addAsset: (asset: Asset) => void;
  deleteAsset: (assetId: string) => void;
  updateGoal: (goal: Goal) => void;
  addGoal: (goal: Goal) => void;
  deleteGoal: (goalId: string) => void;
  updateGoalAllocations: (allocations: { id: string; savingsAllocationPercent: number }[]) => void;
  updateLiability: (liability: Liability) => void;
  addLiability: (liability: Liability) => void;
  deleteLiability: (liabilityId: string) => void;
  updateBudget: (budget: Budget) => void;
  addBudget: (budget: Budget) => void;
  deleteBudget: (category: string) => void;
  addTransaction: (transaction: Omit<Transaction, 'id'>) => void;
  updateTransaction: (transaction: Transaction) => void;
  deleteTransaction: (transactionId: string) => void;
  addHolding: (portfolioId: string, holding: Holding) => void;
  updateHolding: (portfolioId: string, updatedHolding: Holding) => void;
  recordTrade: (trade: Omit<InvestmentTransaction, 'id' | 'total'>) => void;
  addWatchlistItem: (item: WatchlistItem) => void;
  deleteWatchlistItem: (symbol: string) => void;
  addPlatform: (platform: Account) => void;
  updatePlatform: (platform: Account) => void;
  deletePlatform: (platformId: string) => void;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id'>) => void;
  resetData: () => void;
}

export const DataContext = createContext<DataContextType | null>(null);

interface DataProviderProps {
  children: ReactNode;
}

const LOCAL_STORAGE_KEY = 'HS_FINANCIAL_DATA';

export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(() => {
        try {
            const savedData = window.localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedData) {
                const parsed = JSON.parse(savedData);
                // Basic check to ensure data structure is somewhat valid
                if (parsed.accounts && parsed.transactions) {
                    return parsed;
                }
            }
        } catch (error) {
            console.error("Error reading from localStorage", error);
        }
        return mockFinancialData;
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.error("Error writing to localStorage", error);
        }
    }, [data]);


    // Simulate live stock price updates
    useEffect(() => {
        const interval = setInterval(() => {
            setData(prevData => {
                // 1. Calculate new investment values
                const newInvestments = prevData.investments.map(portfolio => ({
                    ...portfolio,
                    holdings: portfolio.holdings.map(holding => {
                        const changePercent = (Math.random() - 0.5) * 0.01; // +/- 0.5%
                        const newValue = holding.currentValue * (1 + changePercent);
                        return { ...holding, currentValue: newValue };
                    })
                }));

                // 2. Calculate new investment account balances based on the new holding values
                const newAccounts = prevData.accounts.map(account => {
                    if (account.type === 'Investment') {
                        // Sum up the value of all portfolios linked to this account
                        const accountTotalValue = newInvestments
                            .filter(p => p.accountId === account.id)
                            .reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
                        return { ...account, balance: accountTotalValue };
                    }
                    return account;
                });

                // 3. Return the updated state for both investments and accounts
                return { ...prevData, investments: newInvestments, accounts: newAccounts };
            });
        }, 3000); // Update every 3 seconds

        return () => clearInterval(interval);
    }, []);

    const resetData = () => {
        if (window.confirm("Are you sure you want to reset all data? This will restore the original demo data and cannot be undone.")) {
            try {
                window.localStorage.removeItem(LOCAL_STORAGE_KEY);
                setData(mockFinancialData);
            } catch (error) {
                console.error("Error clearing localStorage", error);
            }
        }
    };

    const updateAsset = (updatedAsset: Asset) => setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === updatedAsset.id ? updatedAsset : a) }));
    const addAsset = (newAsset: Asset) => setData(prev => ({ ...prev, assets: [...prev.assets, newAsset] }));
    const deleteAsset = (assetId: string) => setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));

    const updateGoal = (updatedGoal: Goal) => setData(prev => ({ ...prev, goals: prev.goals.map(g => g.id === updatedGoal.id ? updatedGoal : g) }));
    const addGoal = (newGoal: Goal) => setData(prev => ({ ...prev, goals: [...prev.goals, newGoal] }));
    const deleteGoal = (goalId: string) => setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    
    const updateGoalAllocations = (allocations: { id: string; savingsAllocationPercent: number }[]) => {
        setData(prev => {
            const newGoals = prev.goals.map(goal => {
                const newAllocation = allocations.find(a => a.id === goal.id);
                if (newAllocation) {
                    return { ...goal, savingsAllocationPercent: newAllocation.savingsAllocationPercent };
                }
                return goal;
            });
            return { ...prev, goals: newGoals };
        });
    };

    const updateLiability = (updatedLiability: Liability) => setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === updatedLiability.id ? updatedLiability : l) }));
    const addLiability = (newLiability: Liability) => setData(prev => ({ ...prev, liabilities: [...prev.liabilities, newLiability] }));
    const deleteLiability = (liabilityId: string) => setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));

    const updateBudget = (updatedBudget: Budget) => setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === updatedBudget.category ? updatedBudget : b) }));
    const addBudget = (newBudget: Budget) => {
        setData(prev => {
            const existingBudget = prev.budgets.find(b => b.category === newBudget.category);
            if (existingBudget) {
                // If it exists, update it instead of adding a new one
                return {
                    ...prev,
                    budgets: prev.budgets.map(b => b.category === newBudget.category ? newBudget : b),
                };
            }
            return { ...prev, budgets: [...prev.budgets, newBudget] };
        });
    };
    const deleteBudget = (category: string) => setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) }));

    const addTransaction = (newTransactionData: Omit<Transaction, 'id'>) => {
        setData(prev => {
            const newTransaction: Transaction = {
                id: `txn${Date.now()}`,
                ...newTransactionData,
            };

            const newAccounts = prev.accounts.map(acc => {
                if (acc.id === newTransaction.accountId) {
                    return { ...acc, balance: acc.balance + newTransaction.amount };
                }
                return acc;
            });
            
            const newTransactions = [newTransaction, ...prev.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            return {
                ...prev,
                accounts: newAccounts,
                transactions: newTransactions,
            };
        });
    };

    const updateTransaction = (updatedTransaction: Transaction) => {
        setData(prev => {
            const oldTx = prev.transactions.find(t => t.id === updatedTransaction.id);
            if (!oldTx) return prev; // Should not happen

            const newAccounts = prev.accounts.map(acc => {
                let newBalance = acc.balance;
                // Revert old transaction if this is the account
                if (acc.id === oldTx.accountId) {
                    newBalance -= oldTx.amount;
                }
                // Apply new transaction if this is the account
                if (acc.id === updatedTransaction.accountId) {
                    newBalance += updatedTransaction.amount;
                }
                return { ...acc, balance: newBalance };
            });

            return {
                ...prev,
                accounts: newAccounts,
                transactions: prev.transactions.map(t => t.id === updatedTransaction.id ? updatedTransaction : t),
            };
        });
    };

    const deleteTransaction = (transactionId: string) => {
        setData(prev => {
            const txToDelete = prev.transactions.find(t => t.id === transactionId);
            if (!txToDelete) return prev;

            const newAccounts = prev.accounts.map(acc => {
                if (acc.id === txToDelete.accountId) {
                    // Revert the transaction amount
                    return { ...acc, balance: acc.balance - txToDelete.amount };
                }
                return acc;
            });

            return {
                ...prev,
                accounts: newAccounts,
                transactions: prev.transactions.filter(t => t.id !== transactionId),
            };
        });
    };

    const addHolding = (portfolioId: string, newHolding: Holding) => {
        setData(prev => ({
            ...prev,
            investments: prev.investments.map(p =>
                p.id === portfolioId ? { ...p, holdings: [...p.holdings, newHolding] } : p
            )
        }));
    };

    const updateHolding = (portfolioId: string, updatedHolding: Holding) => {
        setData(prev => ({
            ...prev,
            investments: prev.investments.map(p => 
                p.id === portfolioId 
                ? { ...p, holdings: p.holdings.map(h => h.symbol === updatedHolding.symbol ? updatedHolding : h) } 
                : p
            )
        }));
    };
    
    const recordTrade = (trade: Omit<InvestmentTransaction, 'id' | 'total'>) => {
        setData(prev => {
            const total = trade.price * trade.quantity;
            const newTx: InvestmentTransaction = { ...trade, id: `itxn${Date.now()}`, total };

            // This logic correctly updates holdings based on a trade.
            // It no longer manually adjusts account balances, as the useEffect handles that.
            const newInvestments = prev.investments.map(p => {
                // Find the portfolio associated with the trade's account
                if (p.accountId !== trade.accountId) {
                    return p;
                }
                
                let holdingExists = false;
                const newHoldings = p.holdings.map(h => {
                    if (h.symbol === trade.symbol) {
                        holdingExists = true;
                        if (trade.type === 'buy') {
                            const totalQuantity = h.quantity + trade.quantity;
                            const totalCost = (h.avgCost * h.quantity) + total;
                            const newAvgCost = totalCost / totalQuantity;
                            // The periodic useEffect will update currentValue based on market fluctuations.
                            // For immediate feedback, we can adjust it based on the new quantity and old price per share.
                            const pricePerShare = h.currentValue > 0 ? h.currentValue / h.quantity : trade.price;
                            const newCurrentValue = totalQuantity * pricePerShare;
                            return { ...h, quantity: totalQuantity, avgCost: newAvgCost, currentValue: newCurrentValue };
                        } else { // Sell
                            const newQuantity = h.quantity - trade.quantity;
                            if (newQuantity < 0) {
                                console.error("Attempting to sell more shares than owned.");
                                alert("Error: You cannot sell more shares than you own.");
                                return h; // Abort this holding's update
                            }
                            const pricePerShare = h.currentValue / h.quantity;
                            const newCurrentValue = newQuantity * pricePerShare;
                            // FIX: Calculate and update realized Profit and Loss on sale.
                            const pnlFromTrade = (trade.price - h.avgCost) * trade.quantity;
                            const newRealizedPnL = h.realizedPnL + pnlFromTrade;
                            return { ...h, quantity: newQuantity, currentValue: newCurrentValue, realizedPnL: newRealizedPnL };
                        }
                    }
                    return h;
                });

                if (!holdingExists && trade.type === 'buy') {
                    const existingNames = prev.investments.flatMap(ip => ip.holdings).find(h => h.symbol === trade.symbol);
                    // FIX: Added missing 'zakahClass' and 'realizedPnL' properties for new holdings.
                    // New holdings start with 0 realized P&L. 'zakahClass' defaults to 'Zakatable' for new individual stocks.
                    newHoldings.push({
                        symbol: trade.symbol,
                        name: existingNames?.name || trade.symbol,
                        quantity: trade.quantity,
                        avgCost: trade.price,
                        currentValue: total,
// Fix: Changed default assetClass from 'Growth' to 'Other' to match the HoldingAssetClass type.
                        assetClass: existingNames?.assetClass || 'Other',
                        zakahClass: existingNames?.zakahClass || 'Zakatable',
                        realizedPnL: 0,
                    });
                }

                // Filter out holdings that have been completely sold
                return { ...p, holdings: newHoldings.filter(h => h.quantity > 0.00001) };
            });

            const newTransactions = [newTx, ...prev.investmentTransactions]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            return {
                ...prev,
                investments: newInvestments,
                investmentTransactions: newTransactions
            };
        });
    };

    const addWatchlistItem = (newItem: WatchlistItem) => {
        setData(prev => {
            if (prev.watchlist.some(item => item.symbol === newItem.symbol)) {
                return prev; // Avoid duplicates
            }
            return { ...prev, watchlist: [...prev.watchlist, newItem] };
        });
    };

    const deleteWatchlistItem = (symbol: string) => {
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(item => item.symbol !== symbol) }));
    };

    const addPlatform = (newPlatform: Account) => {
        setData(prev => ({
            ...prev,
            accounts: [...prev.accounts, newPlatform]
        }));
    };
    
    const updatePlatform = (updatedPlatform: Account) => {
        setData(prev => ({
            ...prev,
            accounts: prev.accounts.map(acc => acc.id === updatedPlatform.id ? updatedPlatform : acc)
        }));
    };

    const deletePlatform = (platformId: string) => {
        setData(prev => {
            const newAccounts = prev.accounts.filter(acc => acc.id !== platformId);
            const newInvestments = prev.investments.filter(p => p.accountId !== platformId);
            const newInvestmentTransactions = prev.investmentTransactions.filter(t => t.accountId !== platformId);
            return {
                ...prev,
                accounts: newAccounts,
                investments: newInvestments,
                investmentTransactions: newInvestmentTransactions,
            };
        });
    };

    const addZakatPayment = (payment: Omit<ZakatPayment, 'id'>) => {
        setData(prev => {
            const newPayment: ZakatPayment = { ...payment, id: `zakat${Date.now()}` };
            const updatedPayments = [...prev.zakatPayments, newPayment].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { ...prev, zakatPayments: updatedPayments };
        });
    };


    return (
        <DataContext.Provider value={{ data, updateAsset, addAsset, deleteAsset, updateGoal, addGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, addTransaction, updateTransaction, deleteTransaction, addHolding, updateHolding, recordTrade, addWatchlistItem, deleteWatchlistItem, addPlatform, updatePlatform, deletePlatform, addZakatPayment, resetData }}>
        {children}
        </DataContext.Provider>
    );
};