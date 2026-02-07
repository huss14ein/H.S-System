import React, { createContext, useState, ReactNode, useEffect, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert } from '../types';
import { getMockData } from '../data/mockData';

// Define an empty state for when data is loading or for new users
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [],
    investments: [], investmentTransactions: [], budgets: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true },
    zakatPayments: [], priceAlerts: []
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
  resetData: () => Promise<void>;
  loadDemoData: () => Promise<void>;
}

export const DataContext = createContext<DataContextType | null>(null);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const auth = useContext(AuthContext);

    const fetchData = async () => {
        if (!auth?.user || !supabase) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [
                accounts, assets, liabilities, goals, transactions, investments,
                investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts
            ] = await Promise.all([
                supabase.from('accounts').select('*'),
                supabase.from('assets').select('*'),
                supabase.from('liabilities').select('*'),
                supabase.from('goals').select('*'),
                supabase.from('transactions').select('*'),
                supabase.from('investment_portfolios').select('*, holdings(*)'),
                supabase.from('investment_transactions').select('*'),
                supabase.from('budgets').select('*'),
                supabase.from('watchlist').select('*'),
                supabase.from('settings').select('*').single(),
                supabase.from('zakat_payments').select('*'),
                supabase.from('price_alerts').select('*')
            ]);

            const allFetches = { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts };
            Object.entries(allFetches).forEach(([key, value]) => {
              if(value.error && value.error.code !== 'PGRST116') console.error(`Error fetching ${key}:`, value.error); // Ignore "0 rows" error for settings
            });

            setData({
                accounts: accounts.data || [],
                assets: assets.data || [],
                liabilities: liabilities.data || [],
                goals: goals.data || [],
                transactions: transactions.data || [],
                investments: (investments.data as any) || [],
                investmentTransactions: investmentTransactions.data || [],
                budgets: budgets.data || [],
                watchlist: watchlist.data || [],
                settings: settings.data || initialData.settings,
                zakatPayments: zakatPayments.data || [],
                priceAlerts: priceAlerts.data || []
            });
        } catch (error) {
            console.error("Error fetching financial data:", error);
        } finally {
            setLoading(false);
        }
    };


    useEffect(() => {
        fetchData();
    }, [auth?.user]);
    
    // Helper to add user_id to any object
    const withUser = (obj: any) => ({ ...obj, user_id: auth?.user?.id });

    const _internalResetData = async () => {
        if (!supabase || !auth?.user) return;
        setLoading(true);
        const tables = ['accounts', 'assets', 'liabilities', 'goals', 'transactions', 'holdings', 'investment_portfolios', 'investment_transactions', 'budgets', 'watchlist', 'zakat_payments', 'price_alerts', 'settings'];
        await Promise.all(tables.map(table => supabase.from(table).delete().eq('user_id', auth.user!.id)));
        setData(initialData);
        setLoading(false);
    };

    const resetData = async () => {
      if (window.confirm("Are you sure you want to permanently delete all your financial data? This action cannot be undone.")) {
        await _internalResetData();
        alert("Your data has been cleared.");
      }
    };
    
    const loadDemoData = async () => {
        if (!supabase || !auth?.user) return;
        setLoading(true);

        const mock = getMockData();
        const userId = auth.user.id;
        
        try {
            // Non-relational data
            await Promise.all([
                supabase.from('assets').insert(mock.assets.map(a => ({ ...a, id: undefined, user_id: userId }))),
                supabase.from('liabilities').insert(mock.liabilities.map(l => ({ ...l, id: undefined, user_id: userId }))),
                supabase.from('budgets').insert(mock.budgets.map(b => ({ ...b, user_id: userId }))),
                supabase.from('watchlist').insert(mock.watchlist.map(w => ({ ...w, user_id: userId }))),
                supabase.from('goals').insert(mock.goals.map(g => ({ ...g, id: undefined, user_id: userId }))),
            ]);

            // Accounts
            const { data: newAccounts, error: accError } = await supabase.from('accounts').insert(mock.accounts.map(a => ({...a, id: undefined, user_id: userId}))).select();
            if (accError || !newAccounts) throw accError || new Error("Failed to create accounts");
            
            const accountIdMap = new Map(mock.accounts.map((mockAcc, i) => [mockAcc.id, newAccounts[i].id]));
            
            // Transactions
            await supabase.from('transactions').insert(mock.transactions.map(t => ({ ...t, id: undefined, user_id: userId, accountId: accountIdMap.get(t.accountId)! })));

            // Portfolios
            const { data: newPortfolios, error: portError } = await supabase.from('investment_portfolios').insert(mock.investments.map(p => ({ name: p.name, accountId: accountIdMap.get(p.accountId)!, user_id: userId }))).select();
            if (portError || !newPortfolios) throw portError || new Error("Failed to create portfolios");

            const portfolioIdMap = new Map(mock.investments.map((mockPort, i) => [mockPort.id, newPortfolios[i].id]));
            
            // Holdings and Investment Transactions
            const holdingsToInsert = mock.investments.flatMap(p => p.holdings.map(h => ({...h, id: undefined, portfolio_id: portfolioIdMap.get(p.id)!, user_id: userId })));
            await supabase.from('holdings').insert(holdingsToInsert);
            await supabase.from('investment_transactions').insert(mock.investmentTransactions.map(t => ({ ...t, id: undefined, user_id: userId, accountId: accountIdMap.get(t.accountId)! })));

            alert("Demo data loaded successfully!");
        } catch(error) {
            console.error("Error loading demo data:", error);
            alert(`Failed to load demo data: ${error instanceof Error ? error.message : "Unknown error"}. Cleaning up...`);
            await _internalResetData();
        } finally {
            await fetchData(); // Refetch all data to update UI
        }
    };


    // --- Assets ---
    const addAsset = async (asset: Omit<Asset, 'id'>) => {
        if(!supabase) return;
        const { data: newAsset, error } = await supabase.from('assets').insert(withUser(asset)).select().single();
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: [...prev.assets, newAsset] }));
    };
    const updateAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('assets').update(asset).match({ id: asset.id, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === asset.id ? asset : a) }));
    };
    const deleteAsset = async (assetId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('assets').delete().match({ id: assetId, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));
    };

    // --- Goals ---
    const addGoal = async (goal: Omit<Goal, 'id'>) => {
        if(!supabase) return;
        const { data: newGoal, error } = await supabase.from('goals').insert(withUser(goal)).select().single();
        if (error) console.error(error);
        else setData(prev => ({ ...prev, goals: [...prev.goals, newGoal] }));
    };
    const updateGoal = async (goal: Goal) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('goals').update(goal).match({ id: goal.id, user_id: auth.user.id });
      if (error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => g.id === goal.id ? goal : g) }));
    };
    const deleteGoal = async (goalId: string) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('goals').delete().match({ id: goalId, user_id: auth.user.id });
      if (error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    };
    const updateGoalAllocations = async (allocations: { id: string, savingsAllocationPercent: number }[]) => {
      if(!supabase || !auth?.user) return;
      const upsertData = allocations.map(a => ({ ...a, user_id: auth.user!.id }));
      const { error } = await supabase.from('goals').upsert(upsertData);
      if(error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => { const newAlloc = allocations.find(a => a.id === g.id); return newAlloc ? { ...g, ...newAlloc } : g; }) }));
    };

    // --- Liabilities ---
    const addLiability = async (liability: Omit<Liability, 'id'>) => {
      if(!supabase) return;
      const { data: newLiability, error } = await supabase.from('liabilities').insert(withUser(liability)).select().single();
      if (error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: [...prev.liabilities, newLiability] }));
    };
    const updateLiability = async (liability: Liability) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('liabilities').update(liability).match({ id: liability.id, user_id: auth.user.id });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === liability.id ? liability : l) }));
    };
    const deleteLiability = async (liabilityId: string) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('liabilities').delete().match({ id: liabilityId, user_id: auth.user.id });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));
    };

    // --- Budgets ---
    const addBudget = async (budget: Budget) => {
      if(!supabase) return;
      const { data: newBudget, error } = await supabase.from('budgets').insert(withUser(budget)).select().single();
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: [...prev.budgets, newBudget] }));
    };
    const updateBudget = async (budget: Budget) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('budgets').update(budget).match({ user_id: auth.user.id, category: budget.category });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === budget.category ? budget : b) }));
    };
    const deleteBudget = async (category: string) => {
      if(!supabase || !auth?.user) return;
      const { error } = await supabase.from('budgets').delete().match({ user_id: auth.user.id, category });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) }));
    };
    
    // --- Transactions ---
    const addTransaction = async (transaction: Omit<Transaction, 'id'>) => {
        if(!supabase) return;
        const { data: newTx, error } = await supabase.from('transactions').insert(withUser(transaction)).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: [newTx, ...prev.transactions] }));
    };
    const updateTransaction = async (transaction: Transaction) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('transactions').update(transaction).match({ id: transaction.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.map(t => t.id === transaction.id ? transaction : t) }));
    };
    const deleteTransaction = async (transactionId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('transactions').delete().match({ id: transactionId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));
    };

    // --- Accounts / Platforms ---
    const addPlatform = async (platform: Omit<Account, 'id' | 'balance'>) => {
        if(!supabase) return;
        const { data: newPlatform, error } = await supabase.from('accounts').insert(withUser({ ...platform, balance: 0 })).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: [...prev.accounts, newPlatform] }));
    };
    const updatePlatform = async (platform: Account) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('accounts').update(platform).match({ id: platform.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === platform.id ? platform : a) }));
    };
    const deletePlatform = async (platformId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('accounts').delete().match({ id: platformId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== platformId) }));
    };
    
    // --- Investments ---
    const addPortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'holdings'>) => {
        if(!supabase) return;
        const { data: newPortfolio, error } = await supabase.from('investment_portfolios').insert(withUser(portfolio)).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: [...prev.investments, { ...newPortfolio, holdings: [] }] }));
    };
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('investment_portfolios').update(portfolio).match({ id: portfolio.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: prev.investments.map(p => p.id === portfolio.id ? { ...p, ...portfolio } : p) }));
    };
    const deletePortfolio = async (portfolioId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('investment_portfolios').delete().match({ id: portfolioId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: prev.investments.filter(p => p.id !== portfolioId) }));
    };
    const updateHolding = async (holding: Holding) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('holdings').update(holding).match({ id: holding.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: prev.investments.map(p => ({ ...p, holdings: p.holdings.map(h => h.id === holding.id ? holding : h) })) }));
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
        if(!supabase) return;
        const tradeTotal = trade.quantity * trade.price;
        await supabase.from('investment_transactions').insert(withUser({ ...trade, total: tradeTotal }));
        await fetchData(); // Refetch to update holdings correctly after a trade
    };

    // --- Watchlist, Alerts, Zakat ---
    const addWatchlistItem = async (item: WatchlistItem) => {
        if(!supabase) return;
        await supabase.from('watchlist').insert(withUser(item));
        setData(prev => ({ ...prev, watchlist: [...prev.watchlist, item] }));
    };
    const deleteWatchlistItem = async (symbol: string) => {
        if(!supabase || !auth?.user) return;
        await supabase.from('watchlist').delete().match({ user_id: auth.user.id, symbol });
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    };
    const addPriceAlert = async (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>) => {
        if(!supabase) return;
        const newAlert = { ...alert, status: 'active' as const, createdAt: new Date().toISOString() };
        const { data: created } = await supabase.from('price_alerts').insert(withUser(newAlert)).select().single();
        if(created) setData(prev => ({ ...prev, priceAlerts: [...prev.priceAlerts, created] }));
    };
    const updatePriceAlert = async (alert: PriceAlert) => {
        if(!supabase || !auth?.user) return;
        await supabase.from('price_alerts').update(alert).match({ id: alert.id, user_id: auth.user.id });
        setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.map(a => a.id === alert.id ? alert : a) }));
    };
    const deletePriceAlert = async (alertId: string) => {
        if(!supabase || !auth?.user) return;
        await supabase.from('price_alerts').delete().match({ id: alertId, user_id: auth.user.id });
        setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.filter(a => a.id !== alertId) }));
    };
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id'>) => {
        if(!supabase) return;
        const { data: newPayment } = await supabase.from('zakat_payments').insert(withUser(payment)).select().single();
        if(newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, addTransaction, updateTransaction, deleteTransaction, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, resetData, loadDemoData };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
