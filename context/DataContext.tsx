
import React, { createContext, useState, ReactNode, useEffect, useContext, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert } from '../types';

const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [],
    investments: [], investmentTransactions: [], budgets: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: false },
    zakatPayments: [], priceAlerts: [], simulatedPrices: {}
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
  setSimulatedPrices: (prices: Record<string, { price: number; change: number; changePercent: number }>) => void;
  resetData: () => Promise<void>;
}

export const DataContext = createContext<DataContextType | null>(null);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const auth = useContext(AuthContext);

    const fetchAllData = useCallback(async (userId: string) => {
        setLoading(true);
        try {
            const results = await Promise.all([
                supabase.from('accounts').select('*'),
                supabase.from('assets').select('*'),
                supabase.from('liabilities').select('*'),
                supabase.from('goals').select('*'),
                supabase.from('transactions').select('*').order('date', { ascending: false }),
                supabase.from('investment_portfolios').select('*, holdings(*)'),
                supabase.from('investment_transactions').select('*').order('date', { ascending: false }),
                supabase.from('budgets').select('*'),
                supabase.from('watchlist').select('*'),
                supabase.from('settings').select('*').single(),
                supabase.from('zakat_payments').select('*').order('date', { ascending: false }),
                supabase.from('price_alerts').select('*'),
            ]);
            const [ accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts ] = results;

            const checkError = (res: any, name: string) => { if (res.error && res.error.code !== 'PGRST116') throw new Error(`Failed to fetch ${name}: ${res.error.message}`); return res.data; };
            
            setData(prevData => ({
                ...prevData,
                accounts: checkError(accounts, 'accounts') || [],
                assets: checkError(assets, 'assets') || [],
                liabilities: checkError(liabilities, 'liabilities') || [],
                goals: checkError(goals, 'goals') || [],
                transactions: checkError(transactions, 'transactions') || [],
                investments: (checkError(investments, 'investments') || []).map((p: InvestmentPortfolio) => ({...p, holdings: p.holdings || []})),
                investmentTransactions: checkError(investmentTransactions, 'investmentTransactions') || [],
                budgets: checkError(budgets, 'budgets') || [],
                watchlist: checkError(watchlist, 'watchlist') || [],
                settings: checkError(settings, 'settings') || initialData.settings,
                zakatPayments: checkError(zakatPayments, 'zakatPayments') || [],
                priceAlerts: checkError(priceAlerts, 'priceAlerts') || [],
            }));
        } catch (error) { console.error("Error fetching data:", error); } 
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        if (auth?.user) {
            fetchAllData(auth.user.id);
        }
        else { setData(initialData); setLoading(false); }
    }, [auth?.user, fetchAllData]);
    
    const resetData = async () => { if (!auth?.user) return; setLoading(true); try { const { error } = await supabase.rpc('reset_demo_data'); if (error) { console.error("Error resetting demo data:", error); } await fetchAllData(auth.user.id); } catch (error) { console.error("Error during data reset process:", error); } finally { setLoading(false); } };

    // --- Generic CRUD ---
    const addItem = async (table: string, item: any, stateKey: keyof FinancialData, prepend = true) => { if (!auth?.user) return; const { data: newItem, error } = await supabase.from(table).insert({ ...item, user_id: auth.user.id }).select().single(); if (error) throw error; if (newItem) { setData(prev => ({ ...prev, [stateKey]: prepend ? [newItem, ...(prev[stateKey] as any[])] : [...(prev[stateKey] as any[]), newItem] })); } };
    const updateItem = async (table: string, item: any, stateKey: keyof FinancialData) => { const { id, ...rest } = item; const { data: updated, error } = await supabase.from(table).update(rest).eq('id', id).select().single(); if (error) throw error; if (updated) setData(prev => ({ ...prev, [stateKey]: (prev[stateKey] as any[]).map(i => i.id === updated.id ? updated : i) })); };
    const deleteItem = async (table: string, id: string, stateKey: keyof FinancialData) => { const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw error; setData(prev => ({ ...prev, [stateKey]: (prev[stateKey] as any[]).filter(i => i.id !== id) })); };
    
    // --- Specific Implementations ---
    const addAsset = (asset: any) => addItem('assets', asset, 'assets', false);
    const updateAsset = (asset: any) => updateItem('assets', asset, 'assets');
    const deleteAsset = (id: string) => deleteItem('assets', id, 'assets');

    const addGoal = (goal: any) => addItem('goals', goal, 'goals', false);
    const updateGoal = (goal: any) => updateItem('goals', goal, 'goals');
    const deleteGoal = (id: string) => deleteItem('goals', id, 'goals');
    
    const updateGoalAllocations = async (allocations: any[]) => { if (!auth?.user) return; const upserts = allocations.map(a => ({ ...a, user_id: auth.user.id })); const { error } = await supabase.from('goals').upsert(upserts); if (error) throw error; setData(prev => ({ ...prev, goals: prev.goals.map(g => { const newAlloc = allocations.find(a => a.id === g.id); return newAlloc ? { ...g, ...newAlloc } : g; }) })); };

    const addLiability = (liability: any) => addItem('liabilities', liability, 'liabilities', false);
    const updateLiability = (liability: any) => updateItem('liabilities', liability, 'liabilities');
    const deleteLiability = (id: string) => deleteItem('liabilities', id, 'liabilities');

    const addBudget = async (budget: any) => { if (!auth?.user) return; const { data: newItem, error } = await supabase.from('budgets').insert({ ...budget, user_id: auth.user.id }).select().single(); if(error) throw error; if(newItem) setData(prev => ({ ...prev, budgets: [...prev.budgets, newItem]})); };
    const updateBudget = async (budget: any) => { if (!auth?.user) return; const { data: updated, error } = await supabase.from('budgets').update({ limit: budget.limit }).match({ category: budget.category, user_id: auth.user.id }).select().single(); if(error) throw error; if(updated) setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === updated.category ? updated : b)})); };
    const deleteBudget = async (category: string) => { if (!auth?.user) return; const { error } = await supabase.from('budgets').delete().match({ category, user_id: auth.user.id }); if (error) throw error; setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) })); };

    const addTransaction = (transaction: any) => addItem('transactions', transaction, 'transactions');
    const updateTransaction = (transaction: any) => updateItem('transactions', transaction, 'transactions');
    const deleteTransaction = (id: string) => deleteItem('transactions', id, 'transactions');

    const addPlatform = (platform: any) => addItem('accounts', {...platform, balance: 0}, 'accounts', false);
    const updatePlatform = (platform: any) => updateItem('accounts', platform, 'accounts');
    const deletePlatform = (id: string) => deleteItem('accounts', id, 'accounts');

    const addPortfolio = async (portfolio: any) => { await addItem('investment_portfolios', portfolio, 'investments', false); await fetchAllData(auth!.user!.id); };
    const updatePortfolio = async (portfolio: any) => { await updateItem('investment_portfolios', portfolio, 'investments'); await fetchAllData(auth!.user!.id); };
    const deletePortfolio = async (id: string) => { await deleteItem('investment_portfolios', id, 'investments'); await fetchAllData(auth!.user!.id); };
    
    const updateHolding = async (holding: Holding) => {
        const { id, ...rest } = holding;
        const { data: updatedHolding, error } = await supabase.from('holdings').update(rest).eq('id', id).select().single();
        if (error) throw error;
        if (updatedHolding) {
            setData(prev => {
                const newInvestments = prev.investments.map(p => {
                    const holdingIndex = p.holdings.findIndex(h => h.id === updatedHolding.id);
                    if (holdingIndex !== -1) {
                        const newHoldings = [...p.holdings];
                        newHoldings[holdingIndex] = updatedHolding;
                        return { ...p, holdings: newHoldings };
                    }
                    return p;
                });
                return { ...prev, investments: newInvestments };
            });
        }
    };
    
    const batchUpdateHoldingValues = (updates: { id: string; currentValue: number }[]) => {
        setData(prevData => {
            const updatesMap = new Map(updates.map(u => [u.id, u.currentValue]));
            const newInvestments = prevData.investments.map(portfolio => ({
                ...portfolio,
                holdings: portfolio.holdings.map(holding => 
                    updatesMap.has(holding.id!) 
                    ? { ...holding, currentValue: updatesMap.get(holding.id!)! } 
                    : holding
                )
            }));
            return { ...prevData, investments: newInvestments };
        });
    };

    const setSimulatedPrices = (prices: Record<string, { price: number; change: number; changePercent: number }>) => {
        setData(prev => ({ ...prev, simulatedPrices: prices }));
    };
    
    const recordTrade = async (trade: Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>) => {
        if (!auth?.user) return;
        try {
            const portfolio = data.investments.find(p => p.accountId === trade.accountId);
            if (!portfolio) throw new Error("Portfolio not found for this account.");

            const existingHolding = portfolio.holdings.find(h => h.symbol === trade.symbol);

            if (trade.type === 'buy') {
                const newHoldingData = existingHolding
                    ? {
                        ...existingHolding,
                        quantity: existingHolding.quantity + trade.quantity,
                        avgCost: ((existingHolding.avgCost * existingHolding.quantity) + (trade.price * trade.quantity)) / (existingHolding.quantity + trade.quantity),
                      }
                    : {
                        symbol: trade.symbol,
                        quantity: trade.quantity,
                        avgCost: trade.price,
                        currentValue: trade.quantity * trade.price, // Placeholder, will be updated by a market data feed
                        realizedPnL: 0,
                        portfolio_id: portfolio.id,
                        user_id: auth.user.id,
                        zakahClass: 'Zakatable' as const, // Default
                      };
                await supabase.from('holdings').upsert(newHoldingData);

            } else { // Sell
                if (!existingHolding || existingHolding.quantity < trade.quantity) throw new Error("Not enough shares to sell.");
                
                const realizedPnL = (trade.price - existingHolding.avgCost) * trade.quantity;
                const newQuantity = existingHolding.quantity - trade.quantity;

                if (newQuantity < 0.0001) { // Floating point comparison
                    await supabase.from('holdings').delete().eq('id', existingHolding.id!);
                } else {
                    await supabase.from('holdings').upsert({
                        ...existingHolding,
                        quantity: newQuantity,
                        realizedPnL: (existingHolding.realizedPnL || 0) + realizedPnL,
                    });
                }
            }
            // Finally, record the transaction itself
            await addItem('investment_transactions', { ...trade, total: trade.quantity * trade.price }, 'investmentTransactions');
            await fetchAllData(auth.user.id); // Refetch all data to ensure consistency
        } catch (error) { console.error("Failed to record trade:", error); throw error; }
    };

    const addWatchlistItem = async (item: any) => { if (!auth?.user) return; const { data: newItem, error } = await supabase.from('watchlist').insert({ ...item, user_id: auth.user.id }).select().single(); if(error) throw error; if(newItem) setData(prev => ({ ...prev, watchlist: [...prev.watchlist, newItem]})); };
    const deleteWatchlistItem = async (symbol: string) => { if (!auth?.user) return; const { error } = await supabase.from('watchlist').delete().match({ symbol, user_id: auth.user.id }); if (error) throw error; setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) })); };
    
    const addZakatPayment = (payment: any) => addItem('zakat_payments', payment, 'zakatPayments');

    const addPriceAlert = (alert: any) => addItem('price_alerts', { ...alert, status: 'active', createdAt: new Date().toISOString() }, 'priceAlerts');
    const updatePriceAlert = (alert: any) => updateItem('price_alerts', alert, 'priceAlerts');
    const deletePriceAlert = (id: string) => deleteItem('price_alerts', id, 'priceAlerts');

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, addTransaction, updateTransaction, deleteTransaction, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, setSimulatedPrices, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, resetData };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
