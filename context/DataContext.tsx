
import React, { createContext, useState, ReactNode, useEffect, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment } from '../types';

// Initial empty state for the data
const initialData: FinancialData = {
  accounts: [],
  assets: [],
  liabilities: [],
  goals: [],
  transactions: [],
  investments: [],
  investmentTransactions: [],
  budgets: [],
  watchlist: [],
  settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true },
  zakatPayments: [],
  priceAlerts: [],
};

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
  addPlatform: (platform: Account) => Promise<void>;
  updatePlatform: (platform: Account) => Promise<void>;
  deletePlatform: (platformId: string) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  recordTrade: (trade: Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>) => Promise<void>;
  addWatchlistItem: (item: WatchlistItem) => Promise<void>;
  deleteWatchlistItem: (symbol: string) => Promise<void>;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => Promise<void>;
  resetData: () => void; // This will now seed the DB for the user
}

export const DataContext = createContext<DataContextType | null>(null);

interface DataProviderProps {
  children: ReactNode;
}

export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const auth = useContext(AuthContext);

    const fetchData = async () => {
        if (!auth?.user) return;
        setLoading(true);

        const [
            accounts, assets, liabilities, goals, transactions,
            investments, investmentTransactions, budgets, watchlist, zakatPayments
        ] = await Promise.all([
            supabase.from('accounts').select('*'),
            supabase.from('assets').select('*'),
            supabase.from('liabilities').select('*'),
            supabase.from('goals').select('*'),
            supabase.from('transactions').select('*').order('date', { ascending: false }),
            supabase.from('investment_portfolios').select('*, holdings(*)'),
            supabase.from('investment_transactions').select('*').order('date', { ascending: false }),
            supabase.from('budgets').select('*'),
            supabase.from('watchlist').select('*'),
            supabase.from('zakat_payments').select('*').order('date', { ascending: false }),
        ]);

        const financialData: FinancialData = {
            accounts: accounts.data || [],
            assets: assets.data || [],
            liabilities: liabilities.data || [],
            goals: goals.data || [],
            transactions: transactions.data || [],
            investments: investments.data || [],
            investmentTransactions: investmentTransactions.data || [],
            budgets: budgets.data || [],
            watchlist: watchlist.data || [],
            zakatPayments: zakatPayments.data || [],
            // These will be implemented later
            settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true },
            priceAlerts: [],
        };
        
        setData(financialData);
        setLoading(false);
    };

    useEffect(() => {
        if (auth?.isAuthenticated) {
            fetchData();
        } else {
            setData(initialData); // Clear data on logout
            setLoading(false);
        }
    }, [auth?.isAuthenticated, auth?.user]);

    // REAL-TIME SUBSCRIPTION EXAMPLE
    useEffect(() => {
        const holdingsSubscription = supabase
            .channel('public:holdings')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, 
                (payload) => {
                    console.log('Holdings change received!', payload);
                    fetchData(); // Refetch all data on change for simplicity
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(holdingsSubscription);
        };
    }, []);

    // ASSET FUNCTIONS
    const addAsset = async (asset: Omit<Asset, 'id' | 'user_id'>) => {
        const { data: newAsset, error } = await supabase.from('assets').insert(asset).select().single();
        if (error) throw error;
        if (newAsset) setData(prev => ({...prev, assets: [...prev.assets, newAsset]}));
    };
    const updateAsset = async (asset: Asset) => {
        const { data: updatedAsset, error } = await supabase.from('assets').update(asset).eq('id', asset.id).select().single();
        if (error) throw error;
        if(updatedAsset) setData(prev => ({...prev, assets: prev.assets.map(a => a.id === updatedAsset.id ? updatedAsset : a)}));
    };
    const deleteAsset = async (assetId: string) => {
        const { error } = await supabase.from('assets').delete().eq('id', assetId);
        if (error) throw error;
        setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));
    };

    // GOAL FUNCTIONS
    const addGoal = async (goal: Omit<Goal, 'id' | 'user_id'>) => {
        const { data: newGoal, error } = await supabase.from('goals').insert(goal).select().single();
        if (error) throw error;
        if (newGoal) setData(prev => ({...prev, goals: [...prev.goals, newGoal]}));
    };
    const updateGoal = async (goal: Goal) => {
        const { data: updatedGoal, error } = await supabase.from('goals').update(goal).eq('id', goal.id).select().single();
        if (error) throw error;
        if(updatedGoal) setData(prev => ({...prev, goals: prev.goals.map(g => g.id === updatedGoal.id ? updatedGoal : g)}));
    };
    const deleteGoal = async (goalId: string) => {
        const { error } = await supabase.from('goals').delete().eq('id', goalId);
        if (error) throw error;
        setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    };
    
    const updateGoalAllocations = async (allocations: { id: string, savingsAllocationPercent: number }[]) => {
        const { data: updatedGoals, error } = await supabase.from('goals').upsert(allocations).select();
        if (error) throw error;
        if (updatedGoals) {
            setData(prev => ({
                ...prev,
                goals: prev.goals.map(g => {
                    const updated = updatedGoals.find(ug => ug.id === g.id);
                    return updated ? { ...g, ...updated } : g;
                })
            }));
        }
    };

    const addLiability = async (liability: Omit<Liability, 'id' | 'user_id'>) => {
        const { data: newLiability, error } = await supabase.from('liabilities').insert(liability).select().single();
        if (error) throw error;
        if (newLiability) setData(prev => ({ ...prev, liabilities: [...prev.liabilities, newLiability] }));
    };
    const updateLiability = async (liability: Liability) => {
        const { data: updatedLiability, error } = await supabase.from('liabilities').update(liability).eq('id', liability.id).select().single();
        if (error) throw error;
        if (updatedLiability) setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === updatedLiability.id ? updatedLiability : l) }));
    };
    const deleteLiability = async (liabilityId: string) => {
        const { error } = await supabase.from('liabilities').delete().eq('id', liabilityId);
        if (error) throw error;
        setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));
    };

    const addBudget = async (budget: Budget) => {
        const { data: newBudget, error } = await supabase.from('budgets').insert(budget).select().single();
        if (error) throw error;
        if (newBudget) setData(prev => ({ ...prev, budgets: [...prev.budgets, newBudget] }));
    };
    const updateBudget = async (budget: Budget) => {
        const { data: updatedBudget, error } = await supabase.from('budgets').update(budget).eq('category', budget.category).select().single();
        if (error) throw error;
        if (updatedBudget) setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === updatedBudget.category ? updatedBudget : b) }));
    };
    const deleteBudget = async (category: string) => {
        const { error } = await supabase.from('budgets').delete().eq('category', category);
        if (error) throw error;
        setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) }));
    };

    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'user_id'>) => {
        const { data: newTransaction, error } = await supabase.from('transactions').insert(transaction).select().single();
        if (error) throw error;
        if (newTransaction) setData(prev => ({ ...prev, transactions: [newTransaction, ...prev.transactions].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()) }));
    };
    const updateTransaction = async (transaction: Transaction) => {
        const { data: updatedTransaction, error } = await supabase.from('transactions').update(transaction).eq('id', transaction.id).select().single();
        if (error) throw error;
        if (updatedTransaction) setData(prev => ({ ...prev, transactions: prev.transactions.map(t => t.id === updatedTransaction.id ? updatedTransaction : t).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()) }));
    };
    const deleteTransaction = async (transactionId: string) => {
        const { error } = await supabase.from('transactions').delete().eq('id', transactionId);
        if (error) throw error;
        setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));
    };

    const addPlatform = async (platform: Account) => {
        const { error } = await supabase.from('accounts').insert(platform);
        if (error) throw error;
        fetchData();
    };
    const updatePlatform = async (platform: Account) => {
        const { error } = await supabase.from('accounts').update(platform).eq('id', platform.id);
        if (error) throw error;
        fetchData();
    };
    const deletePlatform = async (platformId: string) => {
        const { error } = await supabase.from('accounts').delete().eq('id', platformId);
        if (error) throw error;
        fetchData();
    };

    const updateHolding = async (holding: Holding) => {
        console.warn("updateHolding is not fully implemented due to missing holding ID in type definition.", holding);
        // This would require a holding ID to function correctly.
        // const { error } = await supabase.from('holdings').update(holding).eq('id', holding.id);
        // if (error) throw error;
        // fetchData();
    };

    const recordTrade = async (trade: Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>) => {
        const total = trade.quantity * trade.price;
        const { error } = await supabase.from('investment_transactions').insert({ ...trade, total });
        if (error) throw error;
        fetchData();
    };

    const addWatchlistItem = async (item: WatchlistItem) => {
        const { data: newItem, error } = await supabase.from('watchlist').insert(item).select().single();
        if (error) throw error;
        if (newItem) setData(prev => ({ ...prev, watchlist: [...prev.watchlist, newItem] }));
    };
    const deleteWatchlistItem = async (symbol: string) => {
        const { error } = await supabase.from('watchlist').delete().eq('symbol', symbol);
        if (error) throw error;
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    };
    
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => {
        const { data: newPayment, error } = await supabase.from('zakat_payments').insert(payment).select().single();
        if (error) throw error;
        if (newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };

    // This is a placeholder for the other functions which would follow the same async pattern.
    // A complete implementation would require rewriting every function in this file.
    const resetData = () => alert("Data now lives in Supabase. You can clear tables in the Supabase dashboard.");

    const value = { 
        data, 
        loading, 
        addAsset, updateAsset, deleteAsset, 
        addGoal, updateGoal, deleteGoal, 
        updateGoalAllocations,
        addLiability, updateLiability, deleteLiability,
        addBudget, updateBudget, deleteBudget,
        addTransaction, updateTransaction, deleteTransaction,
        addPlatform, updatePlatform, deletePlatform,
        updateHolding,
        recordTrade,
        addWatchlistItem, deleteWatchlistItem,
        addZakatPayment,
        resetData 
    };

    return (
        <DataContext.Provider value={value}>
        {children}
        </DataContext.Provider>
    );
};
