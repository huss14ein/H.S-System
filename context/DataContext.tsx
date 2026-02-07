import React, { createContext, useState, ReactNode, useEffect, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert, PlannedTrade } from '../types';
import { getMockData } from '../data/mockData';

// Define an empty state for when data is loading or for new users
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [],
    investments: [], investmentTransactions: [], budgets: [], commodityHoldings: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true },
    zakatPayments: [], priceAlerts: [], plannedTrades: []
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
  recordTrade: (trade: { portfolioId: string, name?: string } & Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>, executedPlanId?: string) => Promise<void>;
  addWatchlistItem: (item: WatchlistItem) => Promise<void>;
  deleteWatchlistItem: (symbol: string) => Promise<void>;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => Promise<void>;
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'user_id' | 'status' | 'createdAt'>) => Promise<void>;
  updatePriceAlert: (alert: PriceAlert) => Promise<void>;
  deletePriceAlert: (alertId: string) => Promise<void>;
  addPlannedTrade: (plan: Omit<PlannedTrade, 'id' | 'user_id'>) => Promise<void>;
  updatePlannedTrade: (plan: PlannedTrade) => Promise<void>;
  deletePlannedTrade: (planId: string) => Promise<void>;
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
        const db = supabase;
        setLoading(true);
        try {
            const [
                accounts, assets, liabilities, goals, transactions, investments,
                investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades
            ] = await Promise.all([
                db.from('accounts').select('*'),
                db.from('assets').select('*'),
                db.from('liabilities').select('*'),
                db.from('goals').select('*'),
                db.from('transactions').select('*'),
                db.from('investment_portfolios').select('*, holdings(*)'),
                db.from('investment_transactions').select('*'),
                db.from('budgets').select('*'),
                db.from('watchlist').select('*'),
                db.from('settings').select('*').single(),
                db.from('zakat_payments').select('*'),
                db.from('price_alerts').select('*'),
                db.from('commodity_holdings').select('*'),
                db.from('planned_trades').select('*')
            ]);

            const allFetches = { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades };
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
                commodityHoldings: commodityHoldings.data || [],
                watchlist: watchlist.data || [],
                settings: settings.data || initialData.settings,
                zakatPayments: zakatPayments.data || [],
                priceAlerts: priceAlerts.data || [],
                plannedTrades: plannedTrades.data || []
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
        const db = supabase;
        setLoading(true);
        const tables = ['accounts', 'assets', 'liabilities', 'goals', 'transactions', 'holdings', 'investment_portfolios', 'investment_transactions', 'budgets', 'watchlist', 'zakat_payments', 'price_alerts', 'settings', 'commodity_holdings', 'planned_trades'];
        await Promise.all(tables.map(table => db.from(table).delete().eq('user_id', auth.user!.id)));
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
        const db = supabase;
        setLoading(true);

        const mock = getMockData();
        const userId = auth.user.id;
        
        try {
            // Non-relational data
            await Promise.all([
                db.from('assets').insert(mock.assets.map(({ id, ...a }) => ({ ...a, user_id: userId }))),
                db.from('liabilities').insert(mock.liabilities.map(({ id, ...l }) => ({ ...l, user_id: userId }))),
                db.from('budgets').insert(mock.budgets.map(b => ({ ...b, user_id: userId }))),
                db.from('watchlist').insert(mock.watchlist.map(w => ({ ...w, user_id: userId }))),
                db.from('goals').insert(mock.goals.map(({ id, ...g }) => ({ ...g, user_id: userId }))),
                db.from('commodity_holdings').insert(mock.commodityHoldings.map(({ id, ...c }) => ({ ...c, user_id: userId }))),
                db.from('planned_trades').insert(mock.plannedTrades.map(({ id, ...pt }) => ({ ...pt, user_id: userId }))),
            ]);

            // Accounts
            const { data: newAccounts, error: accError } = await db.from('accounts').insert(mock.accounts.map(({ id, ...a }) => ({...a, user_id: userId}))).select();
            if (accError || !newAccounts) throw accError || new Error("Failed to create accounts");
            
            const accountIdMap = new Map(mock.accounts.map((mockAcc, i) => [mockAcc.id, newAccounts[i].id]));
            
            // Transactions
            await db.from('transactions').insert(mock.transactions.map(({ id, accountId, ...t }) => ({ ...t, user_id: userId, accountId: accountIdMap.get(accountId)! })));

            // Portfolios
            const { data: newPortfolios, error: portError } = await db.from('investment_portfolios').insert(mock.investments.map(p => ({ name: p.name, accountId: accountIdMap.get(p.accountId)!, user_id: userId }))).select();
            if (portError || !newPortfolios) throw portError || new Error("Failed to create portfolios");

            const portfolioIdMap = new Map(mock.investments.map((mockPort, i) => [mockPort.id, newPortfolios[i].id]));
            
            // Holdings and Investment Transactions
            const holdingsToInsert = mock.investments.flatMap(p => p.holdings.map(({ id, ...h }) => ({...h, portfolio_id: portfolioIdMap.get(p.id)!, user_id: userId })));
            await db.from('holdings').insert(holdingsToInsert);
            await db.from('investment_transactions').insert(mock.investmentTransactions.map(({ id, accountId, ...t }) => ({ ...t, user_id: userId, accountId: accountIdMap.get(accountId)! })));

            alert("Demo data loaded successfully!");
        } catch(error) {
            console.error("Error loading demo data:", error);
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (error && typeof error === 'object' && 'message' in error) {
                // Handle Supabase PostgrestError which is not an instance of Error
                errorMessage = String((error as any).message);
            }
            alert(`Failed to load demo data: ${errorMessage}. Cleaning up...`);
            await _internalResetData();
        } finally {
            await fetchData(); // Refetch all data to update UI
        }
    };


    // --- Assets ---
    const addAsset = async (asset: Omit<Asset, 'id'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newAsset, error } = await db.from('assets').insert(withUser(asset)).select().single();
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: [...prev.assets, newAsset] }));
    };
    const updateAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('assets').update(asset).match({ id: asset.id, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === asset.id ? asset : a) }));
    };
    const deleteAsset = async (assetId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('assets').delete().match({ id: assetId, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));
    };

    // --- Goals ---
    const addGoal = async (goal: Omit<Goal, 'id'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newGoal, error } = await db.from('goals').insert(withUser(goal)).select().single();
        if (error) console.error(error);
        else setData(prev => ({ ...prev, goals: [...prev.goals, newGoal] }));
    };
    const updateGoal = async (goal: Goal) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('goals').update(goal).match({ id: goal.id, user_id: auth.user.id });
      if (error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => g.id === goal.id ? goal : g) }));
    };
    const deleteGoal = async (goalId: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('goals').delete().match({ id: goalId, user_id: auth.user.id });
      if (error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    };
    const updateGoalAllocations = async (allocations: { id: string, savingsAllocationPercent: number }[]) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const upsertData = allocations.map(a => ({ ...a, user_id: auth.user!.id }));
      const { error } = await db.from('goals').upsert(upsertData);
      if(error) console.error(error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => { const newAlloc = allocations.find(a => a.id === g.id); return newAlloc ? { ...g, ...newAlloc } : g; }) }));
    };

    // --- Liabilities ---
    const addLiability = async (liability: Omit<Liability, 'id'>) => {
      if(!supabase) return;
      const db = supabase;
      const { data: newLiability, error } = await db.from('liabilities').insert(withUser(liability)).select().single();
      if (error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: [...prev.liabilities, newLiability] }));
    };
    const updateLiability = async (liability: Liability) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('liabilities').update(liability).match({ id: liability.id, user_id: auth.user.id });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === liability.id ? liability : l) }));
    };
    const deleteLiability = async (liabilityId: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('liabilities').delete().match({ id: liabilityId, user_id: auth.user.id });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));
    };

    // --- Budgets ---
    const addBudget = async (budget: Budget) => {
      if(!supabase) return;
      const db = supabase;
      const { data: newBudget, error } = await db.from('budgets').insert(withUser(budget)).select().single();
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: [...prev.budgets, newBudget] }));
    };
    const updateBudget = async (budget: Budget) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('budgets').update(budget).match({ user_id: auth.user.id, category: budget.category });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.map(b => b.category === budget.category ? budget : b) }));
    };
    const deleteBudget = async (category: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('budgets').delete().match({ user_id: auth.user.id, category });
      if(error) console.error(error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => b.category !== category) }));
    };
    
    // --- Transactions ---
    const addTransaction = async (transaction: Omit<Transaction, 'id'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newTx, error } = await db.from('transactions').insert(withUser(transaction)).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: [newTx, ...prev.transactions] }));
    };
    const updateTransaction = async (transaction: Transaction) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('transactions').update(transaction).match({ id: transaction.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.map(t => t.id === transaction.id ? transaction : t) }));
    };
    const deleteTransaction = async (transactionId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('transactions').delete().match({ id: transactionId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));
    };

    // --- Accounts / Platforms ---
    const addPlatform = async (platform: Omit<Account, 'id' | 'balance'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newPlatform, error } = await db.from('accounts').insert(withUser({ ...platform, balance: 0 })).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: [...prev.accounts, newPlatform] }));
    };
    const updatePlatform = async (platform: Account) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('accounts').update(platform).match({ id: platform.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === platform.id ? platform : a) }));
    };
    const deletePlatform = async (platformId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('accounts').delete().match({ id: platformId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== platformId) }));
    };
    
    // --- Investments ---
    const addPortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'holdings'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newPortfolio, error } = await db.from('investment_portfolios').insert(withUser(portfolio)).select().single();
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: [...prev.investments, { ...newPortfolio, holdings: [] }] }));
    };
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('investment_portfolios').update(portfolio).match({ id: portfolio.id, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: prev.investments.map(p => p.id === portfolio.id ? { ...p, ...portfolio } : p) }));
    };
    const deletePortfolio = async (portfolioId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('investment_portfolios').delete().match({ id: portfolioId, user_id: auth.user.id });
        if(error) console.error(error);
        else setData(prev => ({ ...prev, investments: prev.investments.filter(p => p.id !== portfolioId) }));
    };
    const addHolding = async (holding: Omit<Holding, 'id' | 'user_id'>) => {
        if (!supabase) return;
        const { data: newHolding, error } = await supabase.from('holdings').insert(withUser(holding)).select().single();
        if (error) { console.error("Error adding holding:", error); throw error; }
        setData(prev => ({
            ...prev,
            investments: prev.investments.map(p =>
                p.id === newHolding.portfolio_id
                    ? { ...p, holdings: [...p.holdings, newHolding] }
                    : p
            )
        }));
    };
    const updateHolding = async (holding: Holding) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('holdings').update(holding).match({ id: holding.id, user_id: auth.user.id });
        if(error) { console.error(error); throw error; }
        else setData(prev => ({ ...prev, investments: prev.investments.map(p => ({ ...p, holdings: p.holdings.map(h => h.id === holding.id ? holding : h) })) }));
    };
    const deleteHolding = async (holdingId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('holdings').delete().match({ id: holdingId, user_id: auth.user.id });
        if (error) { console.error("Error deleting holding:", error); throw error; }
        setData(prev => ({
            ...prev,
            investments: prev.investments.map(p => ({
                ...p,
                holdings: p.holdings.filter(h => h.id !== holdingId)
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
    const recordTrade = async (trade: { portfolioId: string, name?: string } & Omit<InvestmentTransaction, 'id' | 'total' | 'user_id'>, executedPlanId?: string) => {
        if (!supabase || !auth?.user) return;

        const { portfolioId, name, ...tradeData } = trade;

        // 1. Log the transaction to the database
        const tradeTotal = tradeData.quantity * tradeData.price;
        const { data: newTransaction, error: txError } = await supabase.from('investment_transactions').insert(withUser({ ...tradeData, total: tradeTotal })).select().single();
        if (txError) { console.error("Error recording transaction:", txError); throw txError; }
        setData(prev => ({ ...prev, investmentTransactions: [newTransaction, ...prev.investmentTransactions] }));

        // 2. Find portfolio and holding from state
        const portfolio = data.investments.find(p => p.id === portfolioId);
        if (!portfolio) throw new Error("Portfolio not found");
        const existingHolding = portfolio.holdings.find(h => h.symbol === tradeData.symbol);

        // 3. Process trade logic
        try {
            if (tradeData.type === 'buy') {
                if (existingHolding) {
                    const newTotalValue = (existingHolding.avgCost * existingHolding.quantity) + (tradeData.price * tradeData.quantity);
                    const newQuantity = existingHolding.quantity + tradeData.quantity;
                    const newAvgCost = newTotalValue / newQuantity;
                    await updateHolding({ ...existingHolding, quantity: newQuantity, avgCost: newAvgCost });
                } else {
                    const newHoldingData = {
                        portfolio_id: portfolioId,
                        symbol: tradeData.symbol,
                        name: name || tradeData.symbol,
                        quantity: tradeData.quantity,
                        avgCost: tradeData.price,
                        currentValue: tradeData.price * tradeData.quantity,
                        zakahClass: 'Zakatable' as const,
                        realizedPnL: 0,
                    };
                    await addHolding(newHoldingData);
                }
            } else { // 'sell'
                if (!existingHolding) throw new Error("Cannot sell a holding you don't own.");
                if (existingHolding.quantity < tradeData.quantity) throw new Error("Not enough shares to sell.");

                const newQuantity = existingHolding.quantity - tradeData.quantity;
                const realizedGain = (tradeData.price - existingHolding.avgCost) * tradeData.quantity;
                const newRealizedPnL = existingHolding.realizedPnL + realizedGain;

                if (newQuantity > 0.00001) { // Use a small epsilon for floating point comparison
                    await updateHolding({ ...existingHolding, quantity: newQuantity, realizedPnL: newRealizedPnL });
                } else {
                    await deleteHolding(existingHolding.id);
                }
            }
        } catch (error) {
            console.error("Error updating holdings after trade:", error);
            await fetchData();
            throw error; // Re-throw to inform caller of failure
        }
        
        // 4. If trade came from a plan, update the plan's status
        if (executedPlanId) {
            const plan = data.plannedTrades.find(p => p.id === executedPlanId);
            if (plan) {
                await updatePlannedTrade({ ...plan, status: 'Executed' });
            }
        }
    };

    // --- Planned Trades ---
    const addPlannedTrade = async (plan: Omit<PlannedTrade, 'id' | 'user_id'>) => {
        if(!supabase) return;
        const { data: newPlan, error } = await supabase.from('planned_trades').insert(withUser(plan)).select().single();
        if (error) { console.error(error); }
        else { setData(prev => ({ ...prev, plannedTrades: [...prev.plannedTrades, newPlan] })); }
    };
    const updatePlannedTrade = async (plan: PlannedTrade) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('planned_trades').update(plan).match({ id: plan.id, user_id: auth.user.id });
        if (error) { console.error(error); }
        else { setData(prev => ({ ...prev, plannedTrades: prev.plannedTrades.map(p => p.id === plan.id ? plan : p) })); }
    };
    const deletePlannedTrade = async (planId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('planned_trades').delete().match({ id: planId, user_id: auth.user.id });
        if (error) { console.error(error); }
        else { setData(prev => ({ ...prev, plannedTrades: prev.plannedTrades.filter(p => p.id !== planId) })); }
    };


    // --- Watchlist, Alerts, Zakat ---
    const addWatchlistItem = async (item: WatchlistItem) => {
        if(!supabase) return;
        const db = supabase;
        await db.from('watchlist').insert(withUser(item));
        setData(prev => ({ ...prev, watchlist: [...prev.watchlist, item] }));
    };
    const deleteWatchlistItem = async (symbol: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        await db.from('watchlist').delete().match({ user_id: auth.user.id, symbol });
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    };
    const addPriceAlert = async (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>) => {
        if(!supabase) return;
        const db = supabase;
        const newAlert = { ...alert, status: 'active' as const, createdAt: new Date().toISOString() };
        const { data: created } = await db.from('price_alerts').insert(withUser(newAlert)).select().single();
        if(created) setData(prev => ({ ...prev, priceAlerts: [...prev.priceAlerts, created] }));
    };
    const updatePriceAlert = async (alert: PriceAlert) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        await db.from('price_alerts').update(alert).match({ id: alert.id, user_id: auth.user.id });
        setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.map(a => a.id === alert.id ? alert : a) }));
    };
    const deletePriceAlert = async (alertId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        await db.from('price_alerts').delete().match({ id: alertId, user_id: auth.user.id });
        setData(prev => ({ ...prev, priceAlerts: prev.priceAlerts.filter(a => a.id !== alertId) }));
    };
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newPayment } = await db.from('zakat_payments').insert(withUser(payment)).select().single();
        if(newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, addTransaction, updateTransaction, deleteTransaction, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, resetData, loadDemoData };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
