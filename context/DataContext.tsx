import React, { createContext, useState, ReactNode, useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert, PlannedTrade, CommodityHolding, Settings, InvestmentPlanSettings, UniverseTicker, TickerStatus, InvestmentPlanExecutionLog, SleeveDefinition, RecurringTransaction } from '../types';
import { getMockData } from '../data/mockData';
import { getDefaultWealthUltraSystemConfig } from '../wealth-ultra/config';

// Define an empty state for when data is loading or for new users
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [], recurringTransactions: [],
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
    executionLogs: [],
    wealthUltraConfig: null
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
  addRecurringTransaction: (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>) => Promise<void>;
  updateRecurringTransaction: (recurring: RecurringTransaction) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  applyRecurringForMonth: (year: number, month: number) => Promise<{ applied: number; skipped: number }>;
  addPlatform: (platform: Omit<Account, 'id' | 'user_id' | 'balance'>) => Promise<void>;
  updatePlatform: (platform: Account) => Promise<void>;
  deletePlatform: (platformId: string) => Promise<void>;
  addPortfolio: (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>) => Promise<void>;
  updatePortfolio: (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => Promise<void>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  batchUpdateHoldingValues: (updates: { id: string; currentValue: number }[]) => void;
  recordTrade: (trade: { portfolioId?: string, name?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number }, executedPlanId?: string) => Promise<void>;
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
  /** Available cash in an investment platform = deposits - withdrawals - buys + sells + dividends (for that account). */
  getAvailableCashForAccount: (accountId: string) => number;
  /** Total deployable = Checking + Savings balances + sum of available cash in each Investment platform. */
  totalDeployableCash: number;
}

export const DataContext = createContext<DataContextType | null>(null);

function normalizeSettings(raw: any): Settings {
    if (!raw) return initialData.settings;
    return {
        riskProfile: (raw.risk_profile ?? raw.riskProfile ?? initialData.settings.riskProfile) as Settings['riskProfile'],
        budgetThreshold: Number(raw.budget_threshold ?? raw.budgetThreshold ?? initialData.settings.budgetThreshold),
        driftThreshold: Number(raw.drift_threshold ?? raw.driftThreshold ?? initialData.settings.driftThreshold),
        enableEmails: Boolean(raw.enable_emails ?? raw.enableEmails ?? initialData.settings.enableEmails),
        goldPrice: Number(raw.gold_price ?? raw.goldPrice ?? initialData.settings.goldPrice),
        nisabAmount: raw.nisab_amount != null || raw.nisabAmount != null ? Number(raw.nisab_amount ?? raw.nisabAmount) : undefined,
    };
}

function settingsToRow(settings: Partial<Settings>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (settings.riskProfile != null) row.risk_profile = settings.riskProfile;
    if (settings.budgetThreshold != null) row.budget_threshold = settings.budgetThreshold;
    if (settings.driftThreshold != null) row.drift_threshold = settings.driftThreshold;
    if (settings.enableEmails != null) row.enable_emails = settings.enableEmails;
    if (settings.goldPrice != null) row.gold_price = settings.goldPrice;
    if (settings.nisabAmount != null) row.nisab_amount = settings.nisabAmount;
    return row;
}

function normalizeSleeves(raw: any): SleeveDefinition[] | undefined {
    if (!raw || !Array.isArray(raw)) return undefined;
    const arr = raw.map((s: any) => ({
        id: String(s?.id ?? ''),
        label: String(s?.label ?? s?.id ?? ''),
        targetPct: Number(s?.targetPct ?? s?.target_pct ?? 0),
        tickers: Array.isArray(s?.tickers) ? s.tickers.map((t: any) => String(t).toUpperCase()) : [],
    })).filter((s: { id: string }) => s.id);
    return arr.length ? arr : undefined;
}

function normalizeInvestmentPlan(raw: any): InvestmentPlanSettings {
    if (!raw) return initialData.investmentPlan;
    const bc = raw.broker_constraints || raw.brokerConstraints || initialData.investmentPlan.brokerConstraints;
    return {
        ...initialData.investmentPlan,
        user_id: raw.user_id,
        monthlyBudget: Number(raw.monthly_budget ?? raw.monthlyBudget ?? initialData.investmentPlan.monthlyBudget),
        budgetCurrency: (raw.budget_currency ?? raw.budgetCurrency ?? initialData.investmentPlan.budgetCurrency) as 'SAR',
        executionCurrency: (raw.execution_currency ?? raw.executionCurrency ?? initialData.investmentPlan.executionCurrency),
        fxRateSource: String(raw.fx_rate_source ?? raw.fxRateSource ?? initialData.investmentPlan.fxRateSource),
        coreAllocation: Number(raw.core_allocation ?? raw.coreAllocation ?? initialData.investmentPlan.coreAllocation),
        upsideAllocation: Number(raw.upside_allocation ?? raw.upsideAllocation ?? initialData.investmentPlan.upsideAllocation),
        minimumUpsidePercentage: Number(raw.minimum_upside_percentage ?? raw.minimumUpsidePercentage ?? initialData.investmentPlan.minimumUpsidePercentage),
        stale_days: Number(raw.stale_days ?? initialData.investmentPlan.stale_days),
        min_coverage_threshold: Number(raw.min_coverage_threshold ?? initialData.investmentPlan.min_coverage_threshold),
        redirect_policy: (raw.redirect_policy ?? initialData.investmentPlan.redirect_policy) as 'priority' | 'pro-rata',
        target_provider: String(raw.target_provider ?? raw.targetProvider ?? initialData.investmentPlan.target_provider),
        corePortfolio: Array.isArray(raw.core_portfolio ?? raw.corePortfolio) ? (raw.core_portfolio ?? raw.corePortfolio) : initialData.investmentPlan.corePortfolio,
        upsideSleeve: Array.isArray(raw.upside_sleeve ?? raw.upsideSleeve) ? (raw.upside_sleeve ?? raw.upsideSleeve) : initialData.investmentPlan.upsideSleeve,
        sleeves: normalizeSleeves(raw.sleeves),
        brokerConstraints: bc && typeof bc === 'object' ? {
            allowFractionalShares: Boolean(bc.allow_fractional_shares ?? bc.allowFractionalShares ?? true),
            minimumOrderSize: Number(bc.minimum_order_size ?? bc.minimumOrderSize ?? 100),
            roundingRule: (bc.rounding_rule ?? bc.roundingRule ?? 'round') as 'round' | 'floor' | 'ceil',
            leftoverCashRule: (bc.leftover_cash_rule ?? bc.leftoverCashRule ?? 'reinvest_core') as 'reinvest_core' | 'hold',
        } : initialData.investmentPlan.brokerConstraints,
    };
}

function normalizeExecutionLog(raw: any): InvestmentPlanExecutionLog {
    if (!raw) return {} as InvestmentPlanExecutionLog;
    return {
        id: raw.id,
        user_id: raw.user_id,
        created_at: raw.created_at,
        date: raw.date ?? '',
        totalInvestment: Number(raw.total_investment ?? raw.totalInvestment ?? 0),
        coreInvestment: Number(raw.core_investment ?? raw.coreInvestment ?? 0),
        upsideInvestment: Number(raw.upside_investment ?? raw.upsideInvestment ?? 0),
        speculativeInvestment: Number(raw.speculative_investment ?? raw.speculativeInvestment ?? 0),
        redirectedInvestment: Number(raw.redirected_investment ?? raw.redirectedInvestment ?? 0),
        unusedUpsideFunds: Number(raw.unused_upside_funds ?? raw.unusedUpsideFunds ?? 0),
        trades: Array.isArray(raw.trades) ? raw.trades : [],
        status: (raw.status ?? 'success') as 'success' | 'failure',
        log_details: String(raw.log_details ?? ''),
    };
}

function normalizeAccount(raw: any): Account {
    if (!raw || typeof raw !== 'object') {
        return { id: '', name: '', type: 'Checking', balance: 0 };
    }
    const id = raw.id ?? raw.account_id ?? (raw as any).uuid ?? '';
    const name = String(raw.name ?? '');
    const type = (raw.type === 'Savings' || raw.type === 'Investment' || raw.type === 'Credit' ? raw.type : 'Checking') as Account['type'];
    const balance = Number(raw.balance ?? 0);
    return {
        ...(raw as Record<string, unknown>),
        id,
        user_id: raw.user_id,
        name: name || (id ? `Account ${id.slice(0, 8)}` : 'Account'),
        type,
        balance,
        owner: raw.owner,
        platformDetails: raw.platformDetails ?? raw.platform_details,
    };
}

function normalizePriceAlert(raw: any): PriceAlert {
    if (!raw) return {} as PriceAlert;
    const currency = raw.currency ?? raw.target_currency;
    const targetPriceRaw = raw.target_price ?? raw.targetPrice ?? 0;
    const targetPrice = typeof targetPriceRaw === 'string' ? parseFloat(targetPriceRaw) : Number(targetPriceRaw);
    return {
        id: String(raw.id ?? ''),
        user_id: raw.user_id,
        symbol: String(raw.symbol ?? ''),
        targetPrice: Number.isFinite(targetPrice) ? targetPrice : 0,
        currency: currency === 'SAR' || currency === 'USD' ? currency : undefined,
        status: (raw.status === 'triggered' ? 'triggered' : 'active') as 'active' | 'triggered',
        createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    };
}

function resolveAccountId(candidate: string | undefined, accounts: Account[]): string | undefined {
    const c = (candidate ?? '').trim();
    if (!c) return undefined;
    const direct = accounts.find(a => a.id === c);
    if (direct) return direct.id;
    const external = accounts.find(a => ((a as any).account_id ?? (a as any).accountId) === c);
    return external?.id;
}

/** Map portfolio to DB row (snake_case). Supabase schema uses account_id, not accountId. */
function investmentPortfolioToRow(portfolio: Partial<InvestmentPortfolio> & { name: string; accountId: string }): Record<string, unknown> {
    const row: Record<string, unknown> = {
        name: portfolio.name,
        account_id: portfolio.accountId,
    };
    if (portfolio.goalId != null) row.goal_id = portfolio.goalId;
    if (portfolio.owner != null) row.owner = portfolio.owner;
    return row;
}

/** Map holding to DB row (snake_case). Schema uses avg_cost, current_value, realized_pnl, zakah_class, portfolio_id. */
function holdingToRow(holding: Partial<Holding> & { symbol: string; quantity: number }): Record<string, unknown> {
    const row: Record<string, unknown> = {
        portfolio_id: holding.portfolio_id ?? (holding as any).portfolioId,
        symbol: holding.symbol,
        name: holding.name ?? '',
        quantity: Number(holding.quantity ?? 0),
        avg_cost: Number(holding.avgCost ?? (holding as any).avg_cost ?? 0),
        current_value: Number(holding.currentValue ?? (holding as any).current_value ?? 0),
        realized_pnl: Number(holding.realizedPnL ?? (holding as any).realized_pnl ?? 0),
        zakah_class: holding.zakahClass ?? (holding as any).zakah_class ?? 'Zakatable',
    };
    return row;
}

/** Normalize DB holding row to app Holding shape (camelCase). */
function normalizeHoldingFromRow(row: any): Holding {
    return {
        ...row,
        portfolio_id: row.portfolio_id ?? row.portfolioId,
        avgCost: row.avg_cost ?? row.avgCost ?? 0,
        currentValue: row.current_value ?? row.currentValue ?? 0,
        realizedPnL: row.realized_pnl ?? row.realizedPnL ?? 0,
        zakahClass: row.zakah_class ?? row.zakahClass ?? 'Zakatable',
    };
}

/** Map commodity holding to DB row (snake_case). Schema uses purchase_value, current_value, zakah_class. name must be non-null. */
function commodityHoldingToRow(holding: Partial<CommodityHolding> & { symbol: string; quantity: number }): Record<string, unknown> {
    const raw = holding.name ?? (holding as any).name ?? String(holding.symbol ?? 'Other').trim();
    const name = (raw && String(raw).trim()) ? String(raw).trim() : 'Other';
    return {
        name,
        quantity: Number(holding.quantity ?? 0),
        unit: holding.unit ?? 'unit',
        symbol: holding.symbol,
        owner: holding.owner ?? null,
        purchase_value: Number(holding.purchaseValue ?? (holding as any).purchase_value ?? 0),
        current_value: Number(holding.currentValue ?? (holding as any).current_value ?? 0),
        zakah_class: holding.zakahClass ?? (holding as any).zakah_class ?? 'Zakatable',
    };
}

function investmentPlanToRow(plan: InvestmentPlanSettings): Record<string, unknown> {
    const row: Record<string, unknown> = {
        user_id: plan.user_id,
        monthly_budget: plan.monthlyBudget,
        budget_currency: plan.budgetCurrency,
        execution_currency: plan.executionCurrency,
        fx_rate_source: plan.fxRateSource,
        core_allocation: plan.coreAllocation,
        upside_allocation: plan.upsideAllocation,
        minimum_upside_percentage: plan.minimumUpsidePercentage,
        stale_days: plan.stale_days,
        min_coverage_threshold: plan.min_coverage_threshold,
        redirect_policy: plan.redirect_policy,
        target_provider: plan.target_provider,
        core_portfolio: plan.corePortfolio,
        upside_sleeve: plan.upsideSleeve,
        broker_constraints: plan.brokerConstraints,
    };
    if (plan.sleeves != null && Array.isArray(plan.sleeves)) {
        row.sleeves = plan.sleeves;
    }
    return row;
}

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

    const normalizeCommodityHolding = (holding: any): CommodityHolding => {
        const name = holding.name ?? holding.Name;
        const trimmed = String(name ?? '').trim();
        if (!trimmed) {
            return {
                ...holding,
                name: 'Other' as CommodityHolding['name'],
                purchaseValue: holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0,
                currentValue: holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0,
                zakahClass: holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable',
                goalId: holding.goalId ?? holding.goal_id,
            };
        }
        const allowedNames = ['Gold', 'Silver', 'Bitcoin'] as const;
        const validName = allowedNames.find(a => a.toLowerCase() === trimmed.toLowerCase()) ?? 'Other';
        return {
            ...holding,
            name: validName as CommodityHolding['name'],
            purchaseValue: holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0,
            currentValue: holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0,
            zakahClass: holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable',
            goalId: holding.goalId ?? holding.goal_id,
        };
    };

    const normalizeLiability = (raw: any): Liability => {
        const type = (raw.type === 'Receivable' ? 'Receivable' : raw.type) as Liability['type'];
        const rawAmount = Number(raw.amount ?? 0);
        const amount = type === 'Receivable' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
        return { ...raw, type, amount, goalId: raw.goalId ?? raw.goal_id };
    };

    const normalizeTransaction = (transaction: any): Transaction => ({
        ...transaction,
        accountId: transaction.accountId ?? transaction.account_id ?? '',
        budgetCategory: transaction.budgetCategory ?? transaction.budget_category,
        categoryId: transaction.categoryId ?? transaction.category_id,
        rejectionReason: transaction.rejectionReason ?? transaction.rejection_reason,
        recurringId: transaction.recurringId ?? transaction.recurring_id,
    });

    const normalizeRecurringTransaction = (raw: any, resolvedAccountId?: string): RecurringTransaction => ({
        id: raw.id,
        user_id: raw.user_id,
        description: raw.description ?? '',
        amount: Number(raw.amount ?? 0),
        type: (raw.type === 'income' || raw.type === 'expense') ? raw.type : 'expense',
        accountId: resolvedAccountId ?? raw.accountId ?? raw.account_id ?? '',
        budgetCategory: raw.budgetCategory ?? raw.budget_category,
        category: raw.category ?? '',
        dayOfMonth: Math.min(28, Math.max(1, Number(raw.dayOfMonth ?? raw.day_of_month ?? 1))),
        enabled: raw.enabled !== false,
    });

    const isMissingColumnError = (error: any) => {
        const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
        return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('column') || message.includes('schema cache');
    };

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
                investmentPlan, portfolioUniverse, statusChangeLog, executionLogs,
                recurringTransactions
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
                db.from('investment_plan').select('*').eq('user_id', auth.user.id).maybeSingle(),
                db.from('portfolio_universe').select('*').eq('user_id', auth.user.id),
                db.from('status_change_log').select('*').eq('user_id', auth.user.id),
                db.from('execution_logs').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }),
                db.from('recurring_transactions').select('*').eq('user_id', auth.user.id)
            ]);

            const allFetches = { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades, investmentPlan, portfolioUniverse, statusChangeLog, executionLogs, recurringTransactions };
            Object.entries(allFetches).forEach(([key, value]) => {
              if(value.error && value.error.code !== 'PGRST116') console.error(`Error fetching ${key}:`, value.error); // Ignore "0 rows" error for settings
            });

            const normalizedAccounts = ((accounts.data as any[]) || []).map(normalizeAccount);

            setData({
                accounts: normalizedAccounts,
                assets: assets.data || [],
                liabilities: ((liabilities.data as any[]) || []).map(normalizeLiability),
                goals: goals.data || [],
                transactions: (transactions.data || []).map(normalizeTransaction),
                investments: ((investments.data as any) || []).map((portfolio: any) => {
                    const rawAccountId = portfolio.accountId || portfolio.account_id;
                    const resolved = resolveAccountId(rawAccountId, normalizedAccounts) ?? rawAccountId;
                    return {
                        ...portfolio,
                        accountId: resolved,
                        holdings: (portfolio.holdings || []).map(normalizeHolding),
                    };
                }),
                investmentTransactions: (investmentTransactions.data || []).map((t: any) => {
                    const norm = normalizeInvestmentTransaction(t);
                    const resolved = resolveAccountId(norm.accountId, normalizedAccounts);
                    return resolved ? { ...norm, accountId: resolved } : norm;
                }),
                budgets: (budgets.data || []).map((b: any) => ({ ...b, period: b.period ?? 'monthly', tier: b.tier ?? b.budget_tier ?? 'Optional' })),
                commodityHoldings: (commodityHoldings.data || []).map(normalizeCommodityHolding),
                watchlist: watchlist.data || [],
                settings: normalizeSettings(settings.data || initialData.settings),
                zakatPayments: zakatPayments.data || [],
                priceAlerts: (priceAlerts.data || []).map(normalizePriceAlert),
                plannedTrades: plannedTrades.data || [],
                notifications: [],
                investmentPlan: normalizeInvestmentPlan((investmentPlan as any).data),
                wealthUltraConfig: getDefaultWealthUltraSystemConfig(),
                portfolioUniverse: (portfolioUniverse as any).data || [],
                statusChangeLog: (statusChangeLog as any).data || [],
                executionLogs: ((executionLogs as any).data || []).map(normalizeExecutionLog),
                recurringTransactions: (recurringTransactions as any).error ? [] : ((recurringTransactions as any).data || []).map((r: any) =>
                    normalizeRecurringTransaction(r, resolveAccountId(r.account_id ?? r.accountId, normalizedAccounts) ?? undefined)
                )
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
        const tables = [
            'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'holdings',
            'investment_portfolios', 'investment_transactions', 'budgets', 'watchlist',
            'zakat_payments', 'price_alerts', 'settings', 'commodity_holdings', 'planned_trades',
            'investment_plan', 'portfolio_universe', 'status_change_log', 'execution_logs',
            'recurring_transactions',
        ];
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
                db.from('commodity_holdings').insert(mock.commodityHoldings.map(({ id, ...c }) => ({ ...commodityHoldingToRow(c), user_id: userId }))),
                db.from('planned_trades').insert(mock.plannedTrades.map(({ id, ...pt }) => ({ ...pt, user_id: userId }))),
                db.from('settings').insert([{ ...mock.settings, user_id: userId }]),
            ]);
            await db.from('price_alerts').insert([
                { user_id: userId, symbol: 'AAPL', target_price: 200, status: 'active', created_at: new Date().toISOString() },
                { user_id: userId, symbol: '7010.SR', target_price: 45, status: 'active', created_at: new Date().toISOString() },
            ]).then(() => {}, () => {});

            // Accounts
            const { data: newAccounts, error: accError } = await db.from('accounts').insert(mock.accounts.map(({ id, ...a }) => ({...a, user_id: userId}))).select();
            if (accError || !newAccounts) throw accError || new Error("Failed to create accounts");
            
            const accountIdMap = new Map(mock.accounts.map((mockAcc, i) => [mockAcc.id, newAccounts[i].id]));
            
            // Transactions
            await db.from('transactions').insert(mock.transactions.map(({ id, accountId, ...t }) => ({ ...t, user_id: userId, accountId: accountIdMap.get(accountId)! })));

            // Recurring transactions (demo data for Transactions page)
            if (mock.recurringTransactions?.length) {
                await db.from('recurring_transactions').insert(mock.recurringTransactions.map(({ id, accountId, ...r }) => ({
                    user_id: userId,
                    description: r.description,
                    amount: r.amount,
                    type: r.type,
                    account_id: accountIdMap.get(accountId)!,
                    budget_category: r.budgetCategory ?? null,
                    category: r.category,
                    day_of_month: r.dayOfMonth,
                    enabled: r.enabled,
                }))).then(() => {}, () => {});
            }

            // Portfolios
            const { data: newPortfolios, error: portError } = await db.from('investment_portfolios').insert(mock.investments.map(p => ({ name: p.name, account_id: accountIdMap.get(p.accountId)!, user_id: userId }))).select();
            if (portError || !newPortfolios) throw portError || new Error("Failed to create portfolios");

            const portfolioIdMap = new Map(mock.investments.map((mockPort, i) => [mockPort.id, newPortfolios[i].id]));
            
            // Holdings and Investment Transactions (snake_case for DB)
            const holdingsToInsert = mock.investments.flatMap(p =>
                p.holdings.map(({ id, ...h }) => ({ ...holdingToRow({ ...h, portfolio_id: portfolioIdMap.get(p.id)! }), user_id: userId }))
            );
            await db.from('holdings').insert(holdingsToInsert);
            await db.from('investment_transactions').insert(mock.investmentTransactions.map(({ id, accountId, ...t }) => ({ ...t, user_id: userId, account_id: accountIdMap.get(accountId)! })));

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
      const payload = withUser(budget);
      let { data: newBudget, error } = await db.from('budgets').insert(payload).select().single();
      if (error && (payload as any).period) {
        const fallback: any = { ...payload, limit: (payload as any).period === 'yearly' ? (payload.limit / 12) : payload.limit };
        delete fallback.period;
        const retry = await db.from('budgets').insert(fallback).select().single();
        newBudget = retry.data;
        error = retry.error;
      }
      if (error) {
        console.error("Error adding budget:", error);
        throw error;
      }
      if (newBudget) {
        const withPeriod = { ...newBudget, period: (budget as Budget).period, tier: (budget as Budget).tier };
        if ((budget as Budget).period === 'yearly') withPeriod.limit = budget.limit;
        setData(prev => ({ ...prev, budgets: [...prev.budgets, withPeriod] }));
      }
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
            .filter((b: any) => !existingTargetCategories.has(b.category))
            .map((b: any) => {
                const { id, user_id, ...rest } = b;
                return { ...rest, month: targetMonth, year: targetYear, period: b.period ?? 'monthly' };
            });

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
        const row: Record<string, unknown> = { ...transaction };
        const recId = (transaction as { recurringId?: string }).recurringId;
        if (recId != null) {
            row.recurring_id = recId;
            delete row.recurringId;
        }
        const { data: newTx, error } = await db.from('transactions').insert(withUser(row)).select().single();
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

    // --- Recurring transactions ---
    const addRecurringTransaction = async (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>) => {
        if (!supabase || !auth?.user) return;
        const db = supabase;
        const row = {
            description: recurring.description,
            amount: recurring.amount,
            type: recurring.type,
            account_id: recurring.accountId,
            budget_category: recurring.budgetCategory ?? null,
            category: recurring.category,
            day_of_month: recurring.dayOfMonth,
            enabled: recurring.enabled,
        };
        const { data: inserted, error } = await db.from('recurring_transactions').insert(withUser(row)).select().single();
        if (error) {
            console.error("Error adding recurring transaction:", error);
            alert(`Failed to add recurring: ${error.message}`);
            throw error;
        }
        if (inserted) {
            const normalized = normalizeRecurringTransaction(inserted, resolveAccountId((inserted as any).account_id, data.accounts) ?? (inserted as any).account_id);
            setData(prev => ({ ...prev, recurringTransactions: [...prev.recurringTransactions, normalized] }));
        }
    };

    const updateRecurringTransaction = async (recurring: RecurringTransaction) => {
        if (!supabase || !auth?.user) return;
        const db = supabase;
        const row = {
            description: recurring.description,
            amount: recurring.amount,
            type: recurring.type,
            account_id: recurring.accountId,
            budget_category: recurring.budgetCategory ?? null,
            category: recurring.category,
            day_of_month: recurring.dayOfMonth,
            enabled: recurring.enabled,
        };
        const { error } = await db.from('recurring_transactions').update(row).match({ id: recurring.id, user_id: auth.user.id });
        if (error) console.error("Error updating recurring:", error);
        else setData(prev => ({
            ...prev,
            recurringTransactions: prev.recurringTransactions.map(r =>
                r.id === recurring.id ? { ...recurring } : r
            ),
        }));
    };

    const deleteRecurringTransaction = async (id: string) => {
        if (!supabase || !auth?.user) return;
        const db = supabase;
        const { error } = await db.from('recurring_transactions').delete().match({ id, user_id: auth.user.id });
        if (error) console.error("Error deleting recurring:", error);
        else setData(prev => ({ ...prev, recurringTransactions: prev.recurringTransactions.filter(r => r.id !== id) }));
    };

    const applyRecurringForMonth = async (year: number, month: number): Promise<{ applied: number; skipped: number }> => {
        if (!supabase || !auth?.user) return { applied: 0, skipped: 0 };
        const enabled = data.recurringTransactions.filter(r => r.enabled);
        const monthStr = String(month).padStart(2, '0');
        const dayStr = (d: number) => String(d).padStart(2, '0');
        let applied = 0;
        let skipped = 0;
        for (const rule of enabled) {
            const date = `${year}-${monthStr}-${dayStr(rule.dayOfMonth)}`;
            const already = data.transactions.some(
                t => (t.recurringId ?? (t as any).recurring_id) === rule.id &&
                    t.date.startsWith(`${year}-${monthStr}`)
            );
            if (already) {
                skipped++;
                continue;
            }
            const amount = rule.type === 'income' ? rule.amount : -rule.amount;
            try {
                await addTransaction({
                    date,
                    description: rule.description,
                    amount,
                    category: rule.category,
                    accountId: rule.accountId,
                    budgetCategory: rule.type === 'expense' ? rule.budgetCategory : undefined,
                    type: rule.type,
                    recurringId: rule.id,
                });
                applied++;
            } catch (_) {
                // already alerted in addTransaction
            }
        }
        return { applied, skipped };
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
        const row = investmentPortfolioToRow(portfolio);
        const { data: newPortfolio, error } = await db.from('investment_portfolios').insert(withUser(row)).select().single();
        if(error) {
            console.error("Error adding portfolio:", error);
            alert(`Failed to add portfolio: ${error.message}`);
            throw error;
        }
        if (newPortfolio) setData(prev => ({ ...prev, investments: [...prev.investments, { ...newPortfolio, accountId: (newPortfolio as any).account_id ?? (newPortfolio as any).accountId, holdings: [] }] }));
    };
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const row = investmentPortfolioToRow(portfolio);
        const { error } = await db.from('investment_portfolios').update(row).match({ id: portfolio.id, user_id: auth.user.id });
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
        const row = holdingToRow(holding);
        const { data: newHolding, error } = await supabase.from('holdings').insert(withUser(row)).select().single();
        if (error) { console.error("Error adding holding:", error); throw error; }
        if (newHolding) {
            const normalized = normalizeHoldingFromRow(newHolding);
            setData(prev => ({
                ...prev,
                investments: prev.investments.map(p =>
                    p.id === (newHolding.portfolio_id ?? (newHolding as any).portfolioId)
                        ? { ...p, holdings: [...p.holdings, normalized] }
                        : p
                )
            }));
        }
    };
    const updateHolding = async (holding: Holding) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const row = holdingToRow(holding);
        const { error } = await db.from('holdings').update(row).match({ id: holding.id, user_id: auth.user.id });
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
    const recordTrade = async (trade: { portfolioId?: string, name?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number }, executedPlanId?: string) => {
        if (!supabase || !auth?.user) return;
        if (tradeSubmissionInFlightRef.current) {
            throw new Error('A trade submission is already in progress. Please wait.');
        }

        const isCashFlow = trade.type === 'deposit' || trade.type === 'withdrawal';

        tradeSubmissionInFlightRef.current = true;
        try {
            const { portfolioId, name, ...tradeData } = trade;

        let accountIdForInsert: string;
        let portfolio: InvestmentPortfolio | undefined;
        let existingHolding: Holding | undefined;
        let normalizedSymbol: string;

        if (isCashFlow) {
            accountIdForInsert = resolveAccountId(trade.accountId, data.accounts) ?? trade.accountId;
            if (!accountIdForInsert) throw new Error("Please select the platform (account).");
            const accountExists = data.accounts.some((a: Account) => a.id === accountIdForInsert);
            if (!accountExists) throw new Error("Selected account is not in the system.");
            normalizedSymbol = 'CASH';
        } else {
            portfolio = data.investments.find(p => p.id === portfolioId);
            if (!portfolio) throw new Error("Portfolio not found");
            normalizedSymbol = (tradeData.symbol || '').trim().toUpperCase();
            existingHolding = portfolio.holdings.find((h: Holding) => (h.symbol || '').trim().toUpperCase() === normalizedSymbol);
            if (tradeData.type === 'sell') {
                if (!existingHolding) throw new Error("Cannot sell a holding you don't own.");
                if (existingHolding.quantity < tradeData.quantity) throw new Error("Not enough shares to sell.");
            }
            accountIdForInsert = resolveAccountId(portfolio.accountId || (portfolio as any).account_id, data.accounts) ?? resolveAccountId(trade.accountId, data.accounts) ?? trade.accountId;
            if (!accountIdForInsert) throw new Error("Account not found for this portfolio. Please refresh the page and try again.");
            const accountExists = data.accounts.some((a: Account) => a.id === accountIdForInsert);
            if (!accountExists) throw new Error("Selected account is not in the system (or portfolio points to a deleted account).");
        }

        // 2. Log the transaction to the database
        const tradeTotal = isCashFlow ? (trade.total ?? 0) : (tradeData.quantity * tradeData.price);
        let newTransaction: any = null;
        let txError: any = null;
        const tradePayload = { ...tradeData, accountId: accountIdForInsert, symbol: normalizedSymbol, quantity: isCashFlow ? 0 : tradeData.quantity, price: isCashFlow ? 0 : tradeData.price, total: tradeTotal };
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

        // 3. Process trade logic (skip for deposit/withdrawal)
        if (isCashFlow) {
            tradeSubmissionInFlightRef.current = false;
            return;
        }

        try {
            if (!portfolio) throw new Error('Portfolio not found');
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

    // --- Commodities --- (snake_case: purchase_value, current_value, zakah_class; name required)
    const addCommodityHolding = async (holding: Omit<CommodityHolding, 'id' | 'user_id'>) => {
        if (!supabase) return;
        if (holding.purchaseValue <= 0) {
            throw new Error("Purchase Value must be a positive number.");
        }
        const row = commodityHoldingToRow(holding);
        const { data: newHolding, error } = await supabase.from('commodity_holdings').insert(withUser(row)).select().single();
        if (error) {
            console.error("Error adding commodity:", error);
            throw error;
        }
        if (newHolding) setData(prev => ({ ...prev, commodityHoldings: [...prev.commodityHoldings, normalizeCommodityHolding(newHolding)] }));
    };
    const updateCommodityHolding = async (holding: CommodityHolding) => {
        if (!supabase || !auth?.user) return;
        if (holding.purchaseValue <= 0) {
            throw new Error("Purchase Value must be a positive number.");
        }
        const row = commodityHoldingToRow(holding);
        const { error } = await supabase.from('commodity_holdings').update(row).match({ id: holding.id, user_id: auth.user.id });
        if (error) {
            console.error(error);
            throw error;
        }
        setData(prev => ({ ...prev, commodityHoldings: prev.commodityHoldings.map(h => h.id === holding.id ? holding : h) }));
    };
    const deleteCommodityHolding = async (holdingId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('commodity_holdings').delete().match({ id: holdingId, user_id: auth.user.id });
        if (error) console.error(error);
        else setData(prev => ({ ...prev, commodityHoldings: prev.commodityHoldings.filter(h => h.id !== holdingId) }));
    };
    const batchUpdateCommodityHoldingValues = async (updates: { id: string; currentValue: number }[]) => {
        if (!supabase || !auth?.user) return;
        // Only update current_value; do not include name to avoid overwriting DB names with 'Other' when holding isn't in client cache
        const payload = updates.map(u => ({
            id: u.id,
            current_value: u.currentValue,
            user_id: auth.user!.id,
        }));
        const { error } = await supabase.from('commodity_holdings').upsert(payload, { onConflict: 'id' });
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
        const createdAt = new Date().toISOString();
        const targetPrice = typeof alert.targetPrice === 'number' && Number.isFinite(alert.targetPrice) ? alert.targetPrice : parseFloat(String(alert.targetPrice)) || 0;
        const row: Record<string, unknown> = { ...withUser({}), symbol: alert.symbol, target_price: targetPrice, status: 'active', created_at: createdAt };
        if (alert.currency) row.currency = alert.currency;
        const { data: created, error } = await db.from('price_alerts').insert(row).select().single();
        if(error) console.error(error);
        else if(created) setData(prev => ({ ...prev, priceAlerts: [...prev.priceAlerts, normalizePriceAlert(created)] }));
    };
    const updatePriceAlert = async (alert: PriceAlert) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const row: Record<string, unknown> = { status: alert.status };
        if (alert.targetPrice != null) row.target_price = alert.targetPrice;
        if (alert.currency != null) row.currency = alert.currency;
        await db.from('price_alerts').update(row).match({ id: alert.id, user_id: auth.user.id });
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
        const merged = { ...data.settings, ...settingsUpdate };
        const row = { ...settingsToRow(merged), user_id: auth.user.id };
        const { error } = await supabase.from('settings').upsert([row], { onConflict: 'user_id' });
        if (error) {
            console.error("Error updating settings:", error);
        } else {
            setData(prev => ({ ...prev, settings: merged }));
        }
    };

    const saveInvestmentPlan = async (plan: InvestmentPlanSettings) => {
        if (!supabase || !auth?.user) return;
        const planWithUser = { ...investmentPlanToRow(plan), user_id: auth.user.id };
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
        const row: Record<string, unknown> = {
            user_id: auth.user.id,
            date: log.date,
            total_investment: log.totalInvestment,
            core_investment: log.coreInvestment,
            upside_investment: log.upsideInvestment,
            speculative_investment: log.speculativeInvestment,
            redirected_investment: log.redirectedInvestment,
            unused_upside_funds: log.unusedUpsideFunds,
            trades: log.trades,
            status: log.status,
            log_details: log.log_details,
        };
        const { data: inserted, error } = await supabase.from('execution_logs').insert(row).select().single();
        if (error) {
            console.error("Error saving execution log:", error);
        } else {
            const normalized = inserted ? normalizeExecutionLog(inserted) : log;
            setData(prev => ({ ...prev, executionLogs: [normalized, ...prev.executionLogs] }));
        }
    };

    const availableCashByAccountId = useMemo(() => {
        const map: Record<string, number> = {};
        (data.investmentTransactions || []).forEach((t: InvestmentTransaction) => {
            const accId = t.accountId ?? (t as any).account_id;
            if (!accId) return;
            if (!(accId in map)) map[accId] = 0;
            const amt = t.total ?? 0;
            if (t.type === 'deposit' || t.type === 'sell' || t.type === 'dividend') map[accId] += amt;
            else if (t.type === 'withdrawal' || t.type === 'buy') map[accId] -= amt;
        });
        return map;
    }, [data.investmentTransactions]);

    const getAvailableCashForAccount = useCallback((accountId: string) => Math.max(0, availableCashByAccountId[accountId] ?? 0), [availableCashByAccountId]);

    const totalDeployableCash = useMemo(() => {
        const bank = (data.accounts ?? []).filter((a: Account) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: Account) => s + Math.max(0, a.balance ?? 0), 0);
        const platformCash = (data.accounts ?? []).filter((a: Account) => a.type === 'Investment').reduce((s: number, a: Account) => s + getAvailableCashForAccount(a.id), 0);
        return bank + platformCash;
    }, [data.accounts, getAvailableCashForAccount]);

    const value = { data, loading, addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth, addTransaction, updateTransaction, deleteTransaction, addRecurringTransaction, updateRecurringTransaction, deleteRecurringTransaction, applyRecurringForMonth, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues, updateSettings, resetData, loadDemoData, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog, getAvailableCashForAccount, totalDeployableCash };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
