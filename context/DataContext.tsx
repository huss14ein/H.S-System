import React, { createContext, useState, ReactNode, useEffect, useContext, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert, PlannedTrade, CommodityHolding, Settings, InvestmentPlanSettings, UniverseTicker, TickerStatus, InvestmentPlanExecutionLog } from '../types';
import { getMockData } from '../data/mockData';

// Define an empty state for when data is loading or for new users
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [],
    investments: [], investmentTransactions: [], budgets: [], commodityHoldings: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
    zakatPayments: [], priceAlerts: [], plannedTrades: [], notifications: [],
    investmentPlan: {
        monthlyBudget: 6000,
        budgetCurrency: 'SAR',
        executionCurrency: 'USD',
        fxRateSource: 'GoogleFinance:CURRENCY:SARUSD',
        coreAllocation: 0.7,
        upsideAllocation: 0.3,
        minimumUpsidePercentage: 25,
        stale_days: 30,
        min_coverage_threshold: 3,
        redirect_policy: 'pro-rata',
        target_provider: 'Default',
        corePortfolio: [],
        upsideSleeve: [],
        brokerConstraints: {
            allowFractionalShares: true,
            minimumOrderSize: 100,
            roundingRule: 'round',
            leftoverCashRule: 'reinvest_core'
        }
    },
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: []
};

interface DataContextType {
  data: FinancialData;
  loading: boolean;
  addAsset: (asset: Asset) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (goalId: string) => Promise<void>;
  updateGoalAllocations: (allocations: { id: string, savingsAllocationPercent: number }[]) => Promise<void>;
  addLiability: (liability: Liability) => Promise<void>;
  updateLiability: (liability: Liability) => Promise<void>;
  deleteLiability: (liabilityId: string) => Promise<void>;
  addBudget: (budget: Omit<Budget, 'id' | 'user_id'>) => Promise<void>;
  updateBudget: (budget: Budget) => Promise<void>;
  deleteBudget: (category: string, month: number, year: number) => Promise<void>;
  copyBudgetsFromPreviousMonth: (targetYear: number, targetMonth: number) => Promise<void>;
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
  saveInvestmentPlan: (plan: InvestmentPlanSettings) => Promise<void>;
  addUniverseTicker: (ticker: Omit<UniverseTicker, 'id' | 'user_id'>) => Promise<void>;
  updateUniverseTickerStatus: (tickerId: string, status: TickerStatus, updates?: Partial<UniverseTicker>) => Promise<void>;
  deleteUniverseTicker: (tickerId: string) => Promise<void>;
  addCommodityHolding: (holding: Omit<CommodityHolding, 'id' | 'user_id'>) => Promise<void>;
  updateCommodityHolding: (holding: CommodityHolding) => Promise<void>;
  deleteCommodityHolding: (holdingId: string) => Promise<void>;
  batchUpdateCommodityHoldingValues: (updates: { id: string; currentValue: number }[]) => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
  resetData: () => Promise<void>;
  loadDemoData: () => Promise<void>;
  saveExecutionLog: (log: InvestmentPlanExecutionLog) => Promise<void>;
}

export const DataContext = createContext<DataContextType | null>(null);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const auth = useContext(AuthContext);
    const tradeSubmissionInFlightRef = useRef(false);

    const normalizeHolding = (holding: any): Holding => ({
        ...holding,
        portfolio_id: holding.portfolio_id || holding.portfolioId,
        avgCost: holding.avgCost ?? holding.avg_cost ?? 0,
        currentValue: holding.currentValue ?? holding.current_value ?? 0,
        goalId: holding.goalId ?? holding.goal_id,
        assetClass: holding.assetClass ?? holding.asset_class,
        realizedPnL: holding.realizedPnL ?? holding.realized_pnl ?? 0,
        dividendDistribution: holding.dividendDistribution ?? holding.dividend_distribution,
        dividendYield: holding.dividendYield ?? holding.dividend_yield,
        zakahClass: holding.zakahClass ?? holding.zakah_class ?? 'Zakatable',
    });

    const normalizeInvestmentTransaction = (transaction: any): InvestmentTransaction => ({
        ...transaction,
        accountId: transaction.accountId || transaction.account_id,
    });

    const normalizeCommodityHolding = (holding: any): CommodityHolding => ({
        ...holding,
        purchaseValue: holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0,
        currentValue: holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0,
        zakahClass: holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable',
    });

    const normalizeTransaction = (transaction: any): Transaction => ({
        ...transaction,
        accountId: transaction.accountId ?? transaction.account_id ?? '',
        budgetCategory: transaction.budgetCategory ?? transaction.budget_category,
        categoryId: transaction.categoryId ?? transaction.category_id,
        rejectionReason: transaction.rejectionReason ?? transaction.rejection_reason,
    });

    const isMissingColumnError = (error: any) => {
        const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
        return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('column') || message.includes('schema cache');
    };

    const extractMissingColumnName = (error: any): string | null => {
        const source = `${error?.message || ''} ${error?.details || ''}`;
        const quoted = source.match(/column\s+"?([a-zA-Z0-9_]+)"?/i);
        if (quoted?.[1]) return quoted[1];
        const pgrst = source.match(/Could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i);
        return pgrst?.[1] || null;
    };

    const payloadSignature = (payload: Record<string, unknown>) => Object.keys(payload).sort().join(', ');

    const goalPayloadVariants = (goal: Goal) => {
        const base = {
            name: goal.name,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            deadline: goal.deadline,
            savingsAllocationPercent: goal.savingsAllocationPercent,
        };
        return [
            { ...base, priority: goal.priority ?? 'Medium' },
            base,
        ];
    };

    const tradePayloadVariants = (trade: Omit<InvestmentTransaction, 'id' | 'user_id'>) => ([
        {
            account_id: trade.accountId,
            date: trade.date,
            type: trade.type,
            symbol: trade.symbol,
            quantity: trade.quantity,
            price: trade.price,
            total: trade.total,
        },
        {
            accountId: trade.accountId,
            date: trade.date,
            type: trade.type,
            symbol: trade.symbol,
            quantity: trade.quantity,
            price: trade.price,
            total: trade.total,
        }
    ]);

    const commodityPayloadVariants = (holding: Omit<CommodityHolding, 'id' | 'user_id'> | CommodityHolding) => {
        const payloadBase = {
            name: holding.name,
            quantity: holding.quantity,
            unit: holding.unit,
            symbol: holding.symbol,
            owner: holding.owner,
        };

        const baseVariants = [
            {
                ...payloadBase,
                purchase_value: holding.purchaseValue,
                current_value: holding.currentValue,
                zakah_class: holding.zakahClass,
            },
            {
                ...payloadBase,
                purchaseValue: holding.purchaseValue,
                currentValue: holding.currentValue,
                zakahClass: holding.zakahClass,
            },
            {
                ...payloadBase,
                purchasevalue: holding.purchaseValue,
                currentvalue: holding.currentValue,
                zakahclass: holding.zakahClass,
            },
            {
                ...payloadBase,
                purchase_value: holding.purchaseValue,
                currentValue: holding.currentValue,
                zakahClass: holding.zakahClass,
            },
            {
                ...payloadBase,
                purchaseValue: holding.purchaseValue,
                current_value: holding.currentValue,
                zakah_class: holding.zakahClass,
            },
        ];

        const allVariants = [
            ...baseVariants,
            ...baseVariants.map(({ owner, ...payload }) => payload),
        ];

        const dedupedVariants: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (const payload of allVariants) {
            const signature = payloadSignature(payload as Record<string, unknown>);
            if (seen.has(signature)) continue;
            seen.add(signature);
            dedupedVariants.push(payload as Record<string, unknown>);
        }

        return dedupedVariants;
    };

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
                investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades,
                investmentPlan, portfolioUniverse, statusChangeLog, executionLogs
            ] = await Promise.all([
                db.from('accounts').select('*').eq('user_id', auth.user.id),
                db.from('assets').select('*').eq('user_id', auth.user.id),
                db.from('liabilities').select('*').eq('user_id', auth.user.id),
                db.from('goals').select('*').eq('user_id', auth.user.id),
                db.from('transactions').select('*').eq('user_id', auth.user.id),
                db.from('investment_portfolios').select('*, holdings(*)').eq('user_id', auth.user.id),
                db.from('investment_transactions').select('*').eq('user_id', auth.user.id),
                db.from('budgets').select('*').eq('user_id', auth.user.id),
                db.from('watchlist').select('*').eq('user_id', auth.user.id),
                db.from('settings').select('*').eq('user_id', auth.user.id).single(),
                db.from('zakat_payments').select('*').eq('user_id', auth.user.id),
                db.from('price_alerts').select('*').eq('user_id', auth.user.id),
                db.from('commodity_holdings').select('*').eq('user_id', auth.user.id),
                db.from('planned_trades').select('*').eq('user_id', auth.user.id),
                db.from('investment_plan').select('*').eq('user_id', auth.user.id).single(),
                db.from('portfolio_universe').select('*').eq('user_id', auth.user.id),
                db.from('status_change_log').select('*').eq('user_id', auth.user.id),
                db.from('execution_logs').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false })
            ]);

            const allFetches = { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades, investmentPlan, portfolioUniverse, statusChangeLog, executionLogs };
            Object.entries(allFetches).forEach(([key, value]) => {
              if(value.error && value.error.code !== 'PGRST116') console.error(`Error fetching ${key}:`, value.error); // Ignore "0 rows" error for settings
            });

            setData({
                accounts: accounts.data || [],
                assets: assets.data || [],
                liabilities: liabilities.data || [],
                goals: goals.data || [],
                transactions: (transactions.data || []).map(normalizeTransaction),
                investments: ((investments.data as any) || []).map((portfolio: any) => ({
                    ...portfolio,
                    accountId: portfolio.accountId || portfolio.account_id,
                    holdings: (portfolio.holdings || []).map(normalizeHolding)
                })),
                investmentTransactions: (investmentTransactions.data || []).map(normalizeInvestmentTransaction),
                budgets: budgets.data || [],
                commodityHoldings: (commodityHoldings.data || []).map(normalizeCommodityHolding),
                watchlist: watchlist.data || [],
                settings: settings.data || initialData.settings,
                zakatPayments: zakatPayments.data || [],
                priceAlerts: priceAlerts.data || [],
                plannedTrades: plannedTrades.data || [],
                notifications: [],
                investmentPlan: (investmentPlan as any).data 
                    ? { 
                        ...initialData.investmentPlan, 
                        ...(investmentPlan as any).data,
                        brokerConstraints: (investmentPlan as any).data.brokerConstraints || initialData.investmentPlan.brokerConstraints 
                      }
                    : initialData.investmentPlan,
                portfolioUniverse: (portfolioUniverse as any).data || [],
                statusChangeLog: (statusChangeLog as any).data || [],
                executionLogs: (executionLogs as any).data || []
            });
        } catch (error) {
            console.error("Error fetching financial data:", error);
        } finally {
            setLoading(false);
        }
    };


    useEffect(() => {
        fetchData();
        
        // Safety timeout to ensure loading state is cleared even if Supabase hangs
        const timeoutId = setTimeout(() => {
            setLoading(false);
        }, 8000);
        
        return () => clearTimeout(timeoutId);
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
                // FIX: Removed hardcoded `id` from budget insertion to prevent UUID type error.
                db.from('budgets').insert(mock.budgets.map(({ id, ...b }) => ({ ...b, user_id: userId }))),
                db.from('watchlist').insert(mock.watchlist.map(w => ({ ...w, user_id: userId }))),
                db.from('goals').insert(mock.goals.map(({ id, ...g }) => ({ ...g, user_id: userId }))),
                db.from('commodity_holdings').insert(mock.commodityHoldings.map(({ id, ...c }) => ({ ...c, user_id: userId }))),
                db.from('planned_trades').insert(mock.plannedTrades.map(({ id, ...pt }) => ({ ...pt, user_id: userId }))),
                db.from('settings').insert([{ ...mock.settings, user_id: userId }]),
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
    const addAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) {
            alert("You must be logged in to add an asset.");
            return;
        }
        const db = supabase;
        const { id, user_id, ...insertData } = asset;
        const { data: newAsset, error } = await db.from('assets').insert(withUser(insertData)).select().single();
        if (error) { 
            console.error("Error adding asset:", error); 
            alert(`Failed to add asset: ${error.message}`);
            throw error; 
        }
        if (newAsset) setData(prev => ({ ...prev, assets: [...prev.assets, newAsset] }));
    };
    const updateAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('assets').update(asset).match({ id: asset.id, user_id: auth.user.id });
        if (error) console.error("Error updating asset:", error);
        else setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === asset.id ? asset : a) }));
    };
    const deleteAsset = async (assetId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('assets').delete().match({ id: assetId, user_id: auth.user.id });
        if (error) console.error("Error deleting asset:", error);
        else setData(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== assetId) }));
    };

    // --- Goals ---
    const addGoal = async (goal: Goal) => {
        if(!supabase || !auth?.user) {
            alert("You must be logged in to add a goal.");
            return;
        }
        const db = supabase;
        let newGoal: any = null;
        let error: any = null;
        for (const payload of goalPayloadVariants(goal)) {
            const result = await db.from('goals').insert(withUser(payload)).select().single();
            newGoal = result.data;
            error = result.error;
            if (!error) break;
            if (!isMissingColumnError(error)) break;
        }
        if (error) {
            console.error("Error adding goal:", error);
            alert(`Failed to add goal: ${error.message}`);
            throw error;
        }
        if (newGoal) setData(prev => ({ ...prev, goals: [...prev.goals, { ...newGoal, priority: newGoal.priority ?? goal.priority ?? 'Medium' }] }));
    };
    const updateGoal = async (goal: Goal) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      let error: any = null;
      for (const payload of goalPayloadVariants(goal)) {
        const result = await db.from('goals').update(payload).match({ id: goal.id, user_id: auth.user.id });
        error = result.error;
        if (!error) break;
        if (!isMissingColumnError(error)) break;
      }
      if (error) console.error("Error updating goal:", error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => g.id === goal.id ? goal : g) }));
    };
    const deleteGoal = async (goalId: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('goals').delete().match({ id: goalId, user_id: auth.user.id });
      if (error) console.error("Error deleting goal:", error);
      else setData(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== goalId) }));
    };
    const updateGoalAllocations = async (allocations: { id: string, savingsAllocationPercent: number }[]) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const upsertData = allocations.map(a => ({ ...a, user_id: auth.user!.id }));
      const { error } = await db.from('goals').upsert(upsertData);
      if(error) console.error("Error updating goal allocations:", error);
      else setData(prev => ({ ...prev, goals: prev.goals.map(g => { const newAlloc = allocations.find(a => a.id === g.id); return newAlloc ? { ...g, ...newAlloc } : g; }) }));
    };

    // --- Liabilities ---
    const addLiability = async (liability: Liability) => {
      if(!supabase) return;
      const db = supabase;
      const { id, user_id, ...insertData } = liability;
      const { data: newLiability, error } = await db.from('liabilities').insert(withUser(insertData)).select().single();
      if (error) { console.error("Error adding liability:", error); throw error; }
      if (newLiability) setData(prev => ({ ...prev, liabilities: [...prev.liabilities, newLiability] }));
    };
    const updateLiability = async (liability: Liability) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('liabilities').update(liability).match({ id: liability.id, user_id: auth.user.id });
      if(error) console.error("Error updating liability:", error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === liability.id ? liability : l) }));
    };
    const deleteLiability = async (liabilityId: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('liabilities').delete().match({ id: liabilityId, user_id: auth.user.id });
      if(error) console.error("Error deleting liability:", error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));
    };

    // --- Budgets ---
    const addBudget = async (budget: Omit<Budget, 'id' | 'user_id'>) => {
      if(!supabase) return;
      const db = supabase;
      const { data: newBudget, error } = await db.from('budgets').insert(withUser(budget)).select().single();
      if(error) console.error("Error adding budget:", error);
      if (newBudget) setData(prev => ({ ...prev, budgets: [...prev.budgets, newBudget] }));
    };
    const updateBudget = async (budget: Budget) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('budgets').update(budget).match({ user_id: auth.user.id, category: budget.category, month: budget.month, year: budget.year });
      if(error) console.error("Error updating budget:", error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.map(b => (b.category === budget.category && b.month === budget.month && b.year === budget.year) ? budget : b) }));
    };
    const deleteBudget = async (category: string, month: number, year: number) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('budgets').delete().match({ user_id: auth.user.id, category, month, year });
      if(error) console.error("Error deleting budget:", error);
      else setData(prev => ({ ...prev, budgets: prev.budgets.filter(b => !(b.category === category && b.month === month && b.year === year)) }));
    };
    const copyBudgetsFromPreviousMonth = async (targetYear: number, targetMonth: number) => {
        if (!supabase || !auth?.user) return;
        const sourceDate = new Date(targetYear, targetMonth - 2, 1);
        const sourceYear = sourceDate.getFullYear();
        const sourceMonth = sourceDate.getMonth() + 1;

        const { data: sourceBudgets, error } = await supabase.from('budgets').select('*').match({ user_id: auth.user.id, year: sourceYear, month: sourceMonth });
        if (error) { console.error("Error fetching source budgets:", error); alert("Could not fetch last month's budgets."); return; }
        if (!sourceBudgets || sourceBudgets.length === 0) { alert("No budgets found for the previous month to copy."); return; }

        const existingTargetCategories = new Set(data.budgets.filter(b => b.year === targetYear && b.month === targetMonth).map(b => b.category));
        
        const budgetsToInsert = sourceBudgets
            .filter(b => !existingTargetCategories.has(b.category))
            .map(({ id, user_id, ...rest }) => ({ ...rest, month: targetMonth, year: targetYear }));

        if (budgetsToInsert.length === 0) { alert("All budgets from last month already exist for the selected month."); return; }

        const { data: insertedData, error: insertError } = await supabase.from('budgets').insert(budgetsToInsert.map(b => withUser(b))).select();
        if (insertError) { console.error("Error copying budgets:", insertError); alert("Failed to copy budgets."); }
        else {
            setData(prev => ({ ...prev, budgets: [...prev.budgets, ...insertedData] }));
            alert(`${insertedData.length} budget(s) copied successfully.`);
        }
    };
    
    // --- Transactions ---
    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'user_id'>) => {
        if(!supabase || !auth?.user) {
            alert("You must be logged in to add a transaction.");
            return;
        }
        const db = supabase;
        const { data: newTx, error } = await db.from('transactions').insert(withUser(transaction)).select().single();
        if(error) {
            console.error("Error adding transaction:", error);
            alert(`Failed to add transaction: ${error.message}`);
            throw error;
        }
        if (newTx) setData(prev => ({ ...prev, transactions: [normalizeTransaction(newTx), ...prev.transactions] }));
    };
    const updateTransaction = async (transaction: Transaction) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('transactions').update(transaction).match({ id: transaction.id, user_id: auth.user.id });
        if(error) console.error("Error updating transaction:", error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.map(t => t.id === transaction.id ? normalizeTransaction({ ...t, ...transaction }) : t) }));
    };
    const deleteTransaction = async (transactionId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('transactions').delete().match({ id: transactionId, user_id: auth.user.id });
        if(error) console.error("Error deleting transaction:", error);
        else setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));
    };

    // --- Accounts / Platforms ---
    const addPlatform = async (platform: Omit<Account, 'id' | 'user_id' | 'balance'>) => {
        if(!supabase || !auth?.user) {
            alert("You must be logged in to add a platform.");
            return;
        }
        const db = supabase;
        const { data: newPlatform, error } = await db.from('accounts').insert(withUser({ ...platform, balance: 0 })).select().single();
        if(error) {
            console.error("Error adding platform:", error);
            alert(`Failed to add platform: ${error.message}`);
            throw error;
        }
        if (newPlatform) setData(prev => ({ ...prev, accounts: [...prev.accounts, newPlatform] }));
    };
    const updatePlatform = async (platform: Account) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('accounts').update(platform).match({ id: platform.id, user_id: auth.user.id });
        if(error) console.error("Error updating platform:", error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === platform.id ? platform : a) }));
    };
    const deletePlatform = async (platformId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('accounts').delete().match({ id: platformId, user_id: auth.user.id });
        if(error) console.error("Error deleting platform:", error);
        else setData(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== platformId) }));
    };
    
    // --- Investments ---
    const addPortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>) => {
        if(!supabase || !auth?.user) {
            alert("You must be logged in to add a portfolio.");
            return;
        }
        const db = supabase;
        const { data: newPortfolio, error } = await db.from('investment_portfolios').insert(withUser(portfolio)).select().single();
        if(error) {
            console.error("Error adding portfolio:", error);
            alert(`Failed to add portfolio: ${error.message}`);
            throw error;
        }
        if (newPortfolio) setData(prev => ({ ...prev, investments: [...prev.investments, { ...newPortfolio, holdings: [] }] }));
    };
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('investment_portfolios').update(portfolio).match({ id: portfolio.id, user_id: auth.user.id });
        if(error) console.error("Error updating portfolio:", error);
        else setData(prev => ({ ...prev, investments: prev.investments.map(p => p.id === portfolio.id ? { ...p, ...portfolio } : p) }));
    };
    const deletePortfolio = async (portfolioId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('investment_portfolios').delete().match({ id: portfolioId, user_id: auth.user.id });
        if(error) console.error("Error deleting portfolio:", error);
        else setData(prev => ({ ...prev, investments: prev.investments.filter(p => p.id !== portfolioId) }));
    };
    const addHolding = async (holding: Omit<Holding, 'id' | 'user_id'>) => {
        if (!supabase) return;
        const { data: newHolding, error } = await supabase.from('holdings').insert(withUser(holding)).select().single();
        if (error) { console.error("Error adding holding:", error); throw error; }
        if (newHolding) {
            setData(prev => ({
                ...prev,
                investments: prev.investments.map(p =>
                    p.id === newHolding.portfolio_id
                        ? { ...p, holdings: [...p.holdings, newHolding] }
                        : p
                )
            }));
        }
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
        if (tradeSubmissionInFlightRef.current) {
            throw new Error('A trade submission is already in progress. Please wait.');
        }

        tradeSubmissionInFlightRef.current = true;
        try {
            const { portfolioId, name, ...tradeData } = trade;

        // 1. Validate portfolio/holding state before persisting transaction
        const portfolio = data.investments.find(p => p.id === portfolioId);
        if (!portfolio) throw new Error("Portfolio not found");
        const normalizedSymbol = tradeData.symbol.trim().toUpperCase();
        const existingHolding = portfolio.holdings.find(h => h.symbol.trim().toUpperCase() === normalizedSymbol);
        if (tradeData.type === 'sell') {
            if (!existingHolding) throw new Error("Cannot sell a holding you don't own.");
            if (existingHolding.quantity < tradeData.quantity) throw new Error("Not enough shares to sell.");
        }

        // 2. Log the transaction to the database
        const tradeTotal = tradeData.quantity * tradeData.price;
        let newTransaction: any = null;
        let txError: any = null;
        const tradePayload = { ...tradeData, symbol: normalizedSymbol, total: tradeTotal };
        for (const payload of tradePayloadVariants(tradePayload)) {
            const result = await supabase.from('investment_transactions').insert(withUser(payload)).select().single();
            newTransaction = result.data;
            txError = result.error;
            if (!txError) break;
            if (!isMissingColumnError(txError)) break;
        }
        if (txError) { console.error("Error recording transaction:", txError); throw txError; }
        if (newTransaction) {
            setData(prev => ({ ...prev, investmentTransactions: [normalizeInvestmentTransaction(newTransaction), ...prev.investmentTransactions] }));
        }

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
                        symbol: normalizedSymbol,
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
                const holdingForSell = existingHolding;
                const newQuantity = holdingForSell.quantity - tradeData.quantity;
                const realizedGain = (tradeData.price - holdingForSell.avgCost) * tradeData.quantity;
                const newRealizedPnL = holdingForSell.realizedPnL + realizedGain;

                if (newQuantity > 0.00001) { // Use a small epsilon for floating point comparison
                    await updateHolding({ ...holdingForSell, quantity: newQuantity, realizedPnL: newRealizedPnL });
                } else {
                    await deleteHolding(holdingForSell.id);
                }
            }
        } catch (error) {
            console.error("Error updating holdings after trade:", error);
            let rollbackSucceeded = false;
            if (newTransaction?.id) {
                const rollback = await supabase
                    .from('investment_transactions')
                    .delete()
                    .match({ id: newTransaction.id, user_id: auth.user.id });
                if (rollback.error) {
                    console.error("Failed to rollback recorded transaction after holding update failure:", rollback.error);
                } else {
                    rollbackSucceeded = true;
                    setData(prev => ({ ...prev, investmentTransactions: prev.investmentTransactions.filter(t => t.id !== newTransaction.id) }));
                }
            }
            await fetchData();
            const rollbackNote = rollbackSucceeded ? 'and was rolled back' : 'and rollback failed';
            throw new Error(`Trade recorded but holding update failed ${rollbackNote}: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // 4. If trade came from a plan, update the plan's status
        if (executedPlanId) {
            const plan = data.plannedTrades.find(p => p.id === executedPlanId);
            if (plan) {
                await updatePlannedTrade({ ...plan, status: 'Executed' });
            }
        }
        } finally {
            tradeSubmissionInFlightRef.current = false;
        }
    };

    // --- Planned Trades ---
    const addPlannedTrade = async (plan: Omit<PlannedTrade, 'id' | 'user_id'>) => {
        if(!supabase) return;
        const { data: newPlan, error } = await supabase.from('planned_trades').insert(withUser(plan)).select().single();
        if (error) { console.error(error); }
        else if (newPlan) { setData(prev => ({ ...prev, plannedTrades: [...prev.plannedTrades, newPlan] })); }
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

    // --- Commodities ---
    const addCommodityHolding = async (holding: Omit<CommodityHolding, 'id' | 'user_id'>) => {
        if (!supabase) return;
        if (holding.purchaseValue <= 0) {
            throw new Error("Purchase Value must be a positive number.");
        }
        let newHolding: any = null;
        let error: any = null;
        const attemptedPayloadSignatures: string[] = [];
        for (const payload of commodityPayloadVariants(holding)) {
            attemptedPayloadSignatures.push(payloadSignature(payload as Record<string, unknown>));
            const result = await supabase.from('commodity_holdings').insert(withUser(payload)).select().single();
            newHolding = result.data;
            error = result.error;
            if (!error) break;
            if (!isMissingColumnError(error)) break;
        }
        if (error) {
            const missingColumn = extractMissingColumnName(error);
            console.error("Error adding commodity:", error, { attemptedPayloadSignatures });
            const diagnostics = missingColumn
                ? ` Missing column detected: ${missingColumn}.`
                : '';
            throw new Error(`Failed to add commodity holding.${diagnostics} Tried ${attemptedPayloadSignatures.length} payload variants. Last error: ${error.message || error.details || "Unknown error"}`);
        }
        else if (newHolding) setData(prev => ({ ...prev, commodityHoldings: [...prev.commodityHoldings, normalizeCommodityHolding(newHolding)] }));
    };
    const updateCommodityHolding = async (holding: CommodityHolding) => {
        if (!supabase || !auth?.user) return;
        if (holding.purchaseValue <= 0) {
            throw new Error("Purchase Value must be a positive number.");
        }
        let error: any = null;
        for (const payload of commodityPayloadVariants(holding)) {
            const result = await supabase.from('commodity_holdings').update(payload).match({ id: holding.id, user_id: auth.user.id });
            error = result.error;
            if (!error) break;
            if (!isMissingColumnError(error)) break;
        }
        if (error) {
            console.error(error);
            throw error;
        }
        else setData(prev => ({ ...prev, commodityHoldings: prev.commodityHoldings.map(h => h.id === holding.id ? holding : h) }));
    };
    const deleteCommodityHolding = async (holdingId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('commodity_holdings').delete().match({ id: holdingId, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, commodityHoldings: prev.commodityHoldings.filter(h => h.id !== holdingId) }));
    };
    const batchUpdateCommodityHoldingValues = async (updates: { id: string; currentValue: number }[]) => {
        if (!supabase || !auth?.user) return;
        const valuePayloadVariants = [
            updates.map(u => ({
                id: u.id,
                currentValue: u.currentValue,
                user_id: auth.user!.id,
            })),
            updates.map(u => ({
                id: u.id,
                current_value: u.currentValue,
                user_id: auth.user!.id,
            })),
            updates.map(u => ({
                id: u.id,
                currentvalue: u.currentValue,
                user_id: auth.user!.id,
            })),
        ];

        let error: any = null;
        for (const payload of valuePayloadVariants) {
            const result = await supabase.from('commodity_holdings').upsert(payload, { onConflict: 'id' });
            error = result.error;
            if (!error) break;
            if (!isMissingColumnError(error)) break;
        }

        if (error) {
            console.error("Error batch updating commodity values:", error);
            return;
        }

        setData(prevData => {
            const updatesMap = new Map(updates.map(u => [u.id, u.currentValue]));
            return {
                ...prevData,
                commodityHoldings: prevData.commodityHoldings.map(h => 
                    updatesMap.has(h.id) ? { ...h, currentValue: updatesMap.get(h.id)! } : h
                )
            };
        });
    };


    // --- Watchlist, Alerts, Zakat, Settings ---
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
        const { data: created, error } = await db.from('price_alerts').insert(withUser(newAlert)).select().single();
        if(error) console.error(error);
        else if(created) setData(prev => ({ ...prev, priceAlerts: [...prev.priceAlerts, created] }));
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
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => {
        if(!supabase) return;
        const db = supabase;
        const { data: newPayment, error } = await db.from('zakat_payments').insert(withUser(payment)).select().single();
        if(error) console.error(error);
        else if(newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };
    const updateSettings = async (settingsUpdate: Partial<Settings>) => {
        if (!supabase || !auth?.user) return;
        const updatedSettings = { ...data.settings, ...settingsUpdate, user_id: auth.user.id };
        const { error } = await supabase.from('settings').upsert([updatedSettings], { onConflict: 'user_id' });
        if (error) {
            console.error("Error updating settings:", error);
        } else {
            setData(prev => ({ ...prev, settings: updatedSettings }));
        }
    };

    const saveInvestmentPlan = async (plan: InvestmentPlanSettings) => {
        if (!supabase || !auth?.user) return;
        const planWithUser = { ...plan, user_id: auth.user.id };
        const { error } = await supabase.from('investment_plan').upsert(planWithUser, { onConflict: 'user_id' });
        if (error) {
            console.error("Error saving investment plan:", error);
        } else {
            setData(prev => ({ ...prev, investmentPlan: plan }));
        }
    };

    const addUniverseTicker = async (ticker: Omit<UniverseTicker, 'id' | 'user_id'>) => {
        if (!supabase) return;
        const { data: newTicker, error } = await supabase.from('portfolio_universe').insert(withUser(ticker)).select().single();
        if (error) {
            console.error("Error adding ticker:", error);
        } else if (newTicker) {
            setData(prev => ({ ...prev, portfolioUniverse: [...prev.portfolioUniverse, newTicker] }));
        }
    };

    const updateUniverseTickerStatus = async (tickerId: string, status: TickerStatus, updates: Partial<UniverseTicker> = {}) => {
        if (!supabase || !auth?.user) return;
        const ticker = data.portfolioUniverse.find(t => t.id === tickerId);
        if (!ticker) return;

        const logEntry = {
            ticker: ticker.ticker,
            from_status: ticker.status,
            to_status: status,
            timestamp: new Date().toISOString(),
        };

        if (ticker.status !== status) {
            const { error: logError } = await supabase.from('status_change_log').insert(withUser(logEntry));
            if (logError) {
                console.error("Error logging status change:", logError);
                // Continue anyway, status change is more important
            }
        }

        const { error: updateError } = await supabase.from('portfolio_universe').update({ status, ...updates }).match({ id: tickerId, user_id: auth.user.id });
        if (updateError) {
            console.error("Error updating ticker status:", updateError);
        } else {
            setData(prev => ({
                ...prev,
                portfolioUniverse: prev.portfolioUniverse.map(t => t.id === tickerId ? { ...t, status, ...updates } : t),
                statusChangeLog: ticker.status !== status ? [...prev.statusChangeLog, { ...logEntry, id: `log-${Date.now()}` }] : prev.statusChangeLog,
            }));
        }
    };

    const deleteUniverseTicker = async (tickerId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('portfolio_universe').delete().match({ id: tickerId, user_id: auth.user.id });
        if (error) {
            console.error("Error deleting ticker:", error);
        } else {
            setData(prev => ({ ...prev, portfolioUniverse: prev.portfolioUniverse.filter(t => t.id !== tickerId) }));
        }
    };

    const saveExecutionLog = async (log: InvestmentPlanExecutionLog) => {
        if (!supabase || !auth?.user) return;
        const logWithUser = { ...log, user_id: auth.user.id };
        const { error } = await supabase.from('execution_logs').insert(logWithUser);
        if (error) {
            console.error("Error saving execution log:", error);
        } else {
            setData(prev => ({ ...prev, executionLogs: [log, ...prev.executionLogs] }));
        }
    };

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth, addTransaction, updateTransaction, deleteTransaction, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues, updateSettings, resetData, loadDemoData, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
