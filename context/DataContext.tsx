import React, { createContext, useState, ReactNode, useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert, PlannedTrade, CommodityHolding, Settings, InvestmentPlanSettings, UniverseTicker, TickerStatus, InvestmentPlanExecutionLog, SleeveDefinition, RecurringTransaction, WealthUltraSystemConfig, HOLDING_ASSET_CLASS_OPTIONS, type HoldingAssetClass, type TradeCurrency } from '../types';
import { getDefaultWealthUltraSystemConfig } from '../wealth-ultra/config';
import {
  getPersonalAccounts,
  getPersonalAssets,
  getPersonalCommodityHoldings,
  getPersonalInvestments,
  getPersonalLiabilities,
  getPersonalTransactions,
} from '../utils/wealthScope';
import { tradableCashBucketToSAR, resolveSarPerUsd, toSAR, fromSAR, availableTradableCashInLedgerCurrency, DEFAULT_SAR_PER_USD } from '../utils/currencyMath';
import {
    inferInvestmentTransactionCurrency,
    ledgerCurrencyCashToInvestment,
    ledgerCurrencyInvestmentToCash,
    resolveCanonicalAccountId,
    resolveCashAccountCurrency,
} from '../utils/investmentLedgerCurrency';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { auditChangeLog } from '../services/auditLog';
import { toast } from './ToastContext';
import { validateAccount, validateGoal, validateHolding, validateTrade, validateTransactionCore, validateSettings, validateBackup, validateLiability, validateCommodityHolding, validateBudget, validateAsset, validatePlannedTrade, validateUniverseTicker, validatePortfolio, validateRecurringTransaction, validatePriceAlert, validateZakatPayment, validateWatchlistItem, validateGoalAllocation, validateTickerStatus, validateInvestmentPlan, validateExecutionLog } from '../services/dataQuality/validation';
import { parseSplitsFromNote } from '../services/transactionSplitNote';
import { applyBuyToHolding, consolidateHoldingsBySymbol } from '../services/holdingMath';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';
import { normalizeCoreUpsideAllocations } from '../utils/investmentPlanAllocations';
import { normalizePlanSlice, stripNestedPlans, toPlanSlice } from '../utils/investmentPlanPerPortfolio';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { mergeNetWorthSnapshotsFromServer } from '../services/netWorthSnapshot';

// Default parameters: wealth-ultra/config + optional `wealth_ultra_config` in Supabase (merged in fetchData).
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [], recurringTransactions: [],
    investments: [], investmentTransactions: [], budgets: [], commodityHoldings: [], watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
    zakatPayments: [], priceAlerts: [], plannedTrades: [], notifications: [],
    investmentPlan: {
        monthlyBudget: 0, budgetCurrency: 'SAR', executionCurrency: 'USD', fxRateSource: 'GoogleFinance:CURRENCY:SARUSD',
        coreAllocation: 0.7, upsideAllocation: 0.3, minimumUpsidePercentage: 25,
        stale_days: 5, min_coverage_threshold: 0.8, redirect_policy: 'priority', target_provider: 'Finnhub',
        corePortfolio: [], upsideSleeve: [], brokerConstraints: {
            allowFractionalShares: false, minimumOrderSize: 1, roundingRule: 'round', leftoverCashRule: 'hold'
        }
    },
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    allTransactions: [],
    allBudgets: [],
    wealthUltraConfig: getDefaultWealthUltraSystemConfig(),
    budgetRequests: [],
};

function mergeWealthUltraSystemConfigFromRow(
    row: Record<string, unknown> | null | undefined,
    base: WealthUltraSystemConfig,
): WealthUltraSystemConfig {
    if (!row) return base;
    const n = (v: unknown, fallback: number) => {
        const x = Number(v);
        return Number.isFinite(x) ? x : fallback;
    };
    return {
        fxRate: n(row.fx_rate ?? row.fxRate, base.fxRate),
        cashReservePct: n(row.cash_reserve_pct ?? row.cashReservePct, base.cashReservePct),
        maxPerTickerPct: n(row.max_per_ticker_pct ?? row.maxPerTickerPct, base.maxPerTickerPct),
        riskWeightLow: n(row.risk_weight_low ?? row.riskWeightLow, base.riskWeightLow),
        riskWeightMed: n(row.risk_weight_med ?? row.riskWeightMed, base.riskWeightMed),
        riskWeightHigh: n(row.risk_weight_high ?? row.riskWeightHigh, base.riskWeightHigh),
        riskWeightSpec: n(row.risk_weight_spec ?? row.riskWeightSpec, base.riskWeightSpec),
        defaultTarget1Pct: n(row.default_target_1_pct ?? row.defaultTarget1Pct, base.defaultTarget1Pct),
        defaultTarget2Pct: n(row.default_target_2_pct ?? row.defaultTarget2Pct, base.defaultTarget2Pct),
        defaultTrailingPct: n(row.default_trailing_pct ?? row.defaultTrailingPct, base.defaultTrailingPct),
    };
}

/** Stable fallback for deployable accounts so memo deps don’t churn each render when lists are missing. */
const EMPTY_ACCOUNTS_FOR_DEPLOY: Account[] = [];
const HOLDING_QUANTITY_EPSILON = 0.00001;

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
  /** Create a transfer between two accounts (two transactions: out from fromAccountId, in to toAccountId). */
  addTransfer: (fromAccountId: string, toAccountId: string, amount: number, date?: string, note?: string, feeAmount?: number) => Promise<void>;
  addRecurringTransaction: (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>) => Promise<void>;
  updateRecurringTransaction: (recurring: RecurringTransaction) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  applyRecurringForMonth: (year: number, month: number) => Promise<{ applied: number; skipped: number }>;
  applyRecurringDueToday: () => Promise<number>;
  /** `balance` optional for new accounts (defaults to 0). Investment platforms usually omit it. */
  addPlatform: (platform: Omit<Account, 'id' | 'user_id' | 'balance'> & { balance?: number }) => Promise<string | undefined>;
  updatePlatform: (platform: Account, opts?: { fromTransactionDelta?: boolean }) => Promise<void>;
  deletePlatform: (platformId: string) => Promise<void>;
  addPortfolio: (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>) => Promise<void>;
  updatePortfolio: (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => Promise<void>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  addHolding: (holding: Omit<Holding, 'id' | 'user_id'>) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  batchUpdateHoldingValues: (updates: { id: string; currentValue: number }[]) => void;
  recordTrade: (trade: { portfolioId?: string, name?: string, manualCurrentValue?: number, holdingType?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number }, executedPlanId?: string) => Promise<void>;
  addWatchlistItem: (item: WatchlistItem) => Promise<void>;
  deleteWatchlistItem: (symbol: string) => Promise<void>;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id' | 'user_id'>) => Promise<void>;
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'user_id' | 'status' | 'createdAt'>) => Promise<void>;
  updatePriceAlert: (alert: PriceAlert) => Promise<void>;
  deletePriceAlert: (alertId: string) => Promise<void>;
  addPlannedTrade: (plan: Omit<PlannedTrade, 'id' | 'user_id'>) => Promise<void>;
  updatePlannedTrade: (plan: PlannedTrade) => Promise<void>;
  deletePlannedTrade: (planId: string) => Promise<void>;
  saveInvestmentPlan: (plan: InvestmentPlanSettings, portfolioId?: string) => Promise<void>;
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
  /** Restore data from a previously exported JSON backup. Replaces all current data. */
  restoreFromBackup: (backup: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** Increments when Clear All Data is run; use in effects that fetch user-specific data (e.g. budget_requests) so they refetch after clear. */
  dataResetKey: number;
  saveExecutionLog: (log: InvestmentPlanExecutionLog) => Promise<void>;
  /** Available cash in an investment platform = deposits - withdrawals - buys + sells + dividends (for that account). Returns by currency so SAR and USD are not mixed. */
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  /** Sum of available cash across all investment accounts (SAR + USD converted to SAR). */
  totalDeployableCash: number;
  /** Admin-only: All users' transactions for approval notifications */
  allTransactions: Transaction[];
  /** Admin-only: All users' budgets for tracking */
  allBudgets: any[];
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

/** Build DB row with only overrides (values that differ from app defaults). Defaults live in initialData.settings, not in DB. */
function settingsOverridesToRow(merged: Settings, explicitClears?: Partial<Settings>): Record<string, unknown> {
    const defaultRow = settingsToRow(initialData.settings);
    const mergedRow = settingsToRow(merged);
    const row: Record<string, unknown> = {};
    for (const k of Object.keys(mergedRow) as (keyof typeof mergedRow)[]) {
        if (mergedRow[k] !== defaultRow[k]) row[k] = mergedRow[k];
    }
    if (explicitClears && 'nisabAmount' in explicitClears && explicitClears.nisabAmount === undefined) row.nisab_amount = null;
    return row;
}

function normalizeUniverseTicker(row: any): UniverseTicker {
    if (!row || typeof row !== 'object') return row as UniverseTicker;
    return {
        ...row,
        portfolioId: row.portfolio_id ?? row.portfolioId ?? null,
    };
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
    const { core, upside } = normalizeCoreUpsideAllocations(
        raw.core_allocation ?? raw.coreAllocation,
        raw.upside_allocation ?? raw.upsideAllocation,
        { core: initialData.investmentPlan.coreAllocation, upside: initialData.investmentPlan.upsideAllocation },
    );
    const base: InvestmentPlanSettings = {
        ...initialData.investmentPlan,
        user_id: raw.user_id,
        monthlyBudget: Number(raw.monthly_budget ?? raw.monthlyBudget ?? initialData.investmentPlan.monthlyBudget),
        budgetCurrency: (raw.budget_currency ?? raw.budgetCurrency ?? initialData.investmentPlan.budgetCurrency) as 'SAR',
        executionCurrency: (raw.execution_currency ?? raw.executionCurrency ?? initialData.investmentPlan.executionCurrency),
        fxRateSource: String(raw.fx_rate_source ?? raw.fxRateSource ?? initialData.investmentPlan.fxRateSource),
        coreAllocation: core,
        upsideAllocation: upside,
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
        fxRateUpdatedAt: raw.fx_rate_updated_at ?? raw.fxRateUpdatedAt ?? undefined,
    };
    let plansByPortfolioId: InvestmentPlanSettings['plansByPortfolioId'];
    const rawPlans = raw.plans_by_portfolio_id ?? raw.plansByPortfolioId;
    if (rawPlans && typeof rawPlans === 'object' && !Array.isArray(rawPlans)) {
        plansByPortfolioId = {};
        for (const [pid, v] of Object.entries(rawPlans)) {
            plansByPortfolioId[pid] = normalizePlanSlice(v as any, initialData.investmentPlan);
        }
    }
    return {
        ...base,
        ...(plansByPortfolioId ? { plansByPortfolioId } : {}),
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
    const balance = roundMoney(Number(raw.balance ?? 0));
    const linkedAccountIds = raw.linkedAccountIds ?? raw.linked_account_ids;
    const cur = raw.currency;
    const accountCurrency = cur === 'SAR' || cur === 'USD' ? cur : undefined;
    return {
        ...(raw as Record<string, unknown>),
        id,
        user_id: raw.user_id,
        name: name || (id ? `Account ${id.slice(0, 8)}` : 'Account'),
        type,
        balance,
        currency: accountCurrency,
        owner: raw.owner,
        linkedAccountIds: Array.isArray(linkedAccountIds) ? linkedAccountIds.filter((id: any): id is string => typeof id === 'string') : undefined,
        platformDetails: raw.platformDetails ?? raw.platform_details,
    };
}

/** PostgREST when `public.accounts.currency` is missing (run `supabase/migrations/add_accounts_currency.sql`). */
function isAccountsCurrencyColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
    return (
        error?.code === 'PGRST204' &&
        String(error?.message ?? '').includes("'currency'") &&
        String(error?.message ?? '').includes('accounts')
    );
}

function buildAccountInsertPayload(platform: Omit<Account, 'id' | 'user_id' | 'balance'> & { balance?: number }): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        name: platform.name,
        type: platform.type,
        balance: roundMoney(Number(platform.balance) || 0),
    };
    if (platform.owner != null && String(platform.owner).trim() !== '') payload.owner = platform.owner;
    if (platform.type === 'Investment') {
        payload.linked_account_ids = Array.isArray(platform.linkedAccountIds) ? platform.linkedAccountIds : [];
    }
    if (platform.platformDetails) payload.platform_details = platform.platformDetails;
    if (platform.currency === 'SAR' || platform.currency === 'USD') {
        payload.currency = platform.currency;
    }
    return payload;
}

function normalizeAssetRow(raw: any): Asset {
    if (!raw || typeof raw !== 'object') {
        return { id: '', name: '', type: 'Property', value: 0 };
    }
    const pp = raw.purchase_price ?? raw.purchasePrice;
    const mr = raw.monthly_rent ?? raw.monthlyRent;
    const issueRaw = raw.issue_date ?? raw.issueDate;
    const matRaw = raw.maturity_date ?? raw.maturityDate;
    const issueDate =
        issueRaw != null && String(issueRaw).trim() !== ''
            ? String(issueRaw).trim().slice(0, 10)
            : undefined;
    const maturityDate =
        matRaw != null && String(matRaw).trim() !== ''
            ? String(matRaw).trim().slice(0, 10)
            : undefined;
    const notesRaw = raw.notes;
    const notes =
        notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw) : undefined;
    return {
        ...raw,
        id: String(raw.id ?? ''),
        name: String(raw.name ?? ''),
        type: raw.type as Asset['type'],
        value: roundMoney(Number(raw.value ?? 0)),
        purchasePrice: pp != null && pp !== '' ? roundMoney(Number(pp)) : undefined,
        isRental: raw.is_rental ?? raw.isRental,
        monthlyRent: mr != null && mr !== '' ? roundMoney(Number(mr)) : undefined,
        goalId: raw.goal_id ?? raw.goalId,
        owner: raw.owner,
        issueDate,
        maturityDate,
        notes,
    };
}

/** DB columns for Sukuk dates (snake_case). Stripped from spread so we do not send duplicate camelCase keys. */
function assetDatesForDb(asset: Asset): { issue_date: string | null; maturity_date: string | null } {
    const idt = asset.issueDate != null && String(asset.issueDate).trim() !== '' ? String(asset.issueDate).trim().slice(0, 10) : null;
    const mdt =
        asset.maturityDate != null && String(asset.maturityDate).trim() !== ''
            ? String(asset.maturityDate).trim().slice(0, 10)
            : null;
    return { issue_date: idt, maturity_date: mdt };
}

/** Map DB / API priority values to Goal.priority (stable for sort + UI). */
function normalizeGoalPriority(raw: unknown): 'High' | 'Medium' | 'Low' {
    if (raw === 1 || raw === '1') return 'High';
    if (raw === 3 || raw === '3') return 'Low';
    if (raw === 2 || raw === '2') return 'Medium';
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'high' || s === 'h' || s === 'urgent' || s === 'critical') return 'High';
    if (s === 'low' || s === 'l') return 'Low';
    if (s === 'medium' || s === 'med' || s === 'm' || s === 'normal' || s === '') return 'Medium';
    return 'Medium';
}

function normalizeGoalRow(raw: any): Goal {
    if (!raw || typeof raw !== 'object') {
        return { id: '', name: '', targetAmount: 0, currentAmount: 0, deadline: '' };
    }
    return {
        ...raw,
        id: String(raw.id ?? ''),
        name: String(raw.name ?? ''),
        targetAmount: roundMoney(Number(raw.target_amount ?? raw.targetAmount ?? 0)),
        currentAmount: roundMoney(Number(raw.current_amount ?? raw.currentAmount ?? 0)),
        deadline: String(raw.deadline ?? ''),
        savingsAllocationPercent: raw.savings_allocation_percent ?? raw.savingsAllocationPercent,
        priority: normalizeGoalPriority(raw.priority ?? raw.goal_priority),
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
        targetPrice: roundMoney(Number.isFinite(targetPrice) ? targetPrice : 0),
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
        // Always send goal_id so links persist and explicit unlink sets NULL in the DB.
        goal_id: portfolio.goalId != null && String(portfolio.goalId).trim() !== '' ? portfolio.goalId : null,
    };
    if (portfolio.owner != null) row.owner = portfolio.owner;
    if (portfolio.currency != null) row.currency = portfolio.currency;
    return row;
}

function normalizeAssetClassForDb(value: string | null | undefined): string | undefined {
    if (value == null || value === '') return undefined;
    const v = String(value).trim();
    if (HOLDING_ASSET_CLASS_OPTIONS.includes(v as HoldingAssetClass)) return v;
    const lower = v.toLowerCase();
    if (lower === 'equity' || lower === 'equities') return 'Stock';
    if (lower === 'sukuk' || lower === 'sukuks' || lower.includes('islamic bond')) return 'Sukuk';
    return 'Other';
}

/** Map holding to DB row (snake_case). Schema uses avg_cost, current_value, realized_pnl, zakah_class, portfolio_id. */
function holdingToRow(holding: Partial<Holding> & { quantity: number }): Record<string, unknown> {
    const holdingType = holding.holdingType ?? (holding as any).holding_type ?? 'ticker';
    const row: Record<string, unknown> = {
        portfolio_id: holding.portfolio_id ?? (holding as any).portfolioId,
        symbol: holding.symbol ?? (holdingType === 'manual_fund' ? null : ''),
        name: holding.name ?? '',
        quantity: roundQuantity(Number(holding.quantity ?? 0)),
        avg_cost: roundAvgCostPerUnit(Number(holding.avgCost ?? (holding as any).avg_cost ?? 0)),
        current_value: roundMoney(Number(holding.currentValue ?? (holding as any).current_value ?? 0)),
        realized_pnl: roundMoney(Number(holding.realizedPnL ?? (holding as any).realized_pnl ?? 0)),
        zakah_class: holding.zakahClass ?? (holding as any).zakah_class ?? 'Zakatable',
        holding_type: holdingType,
    };
    const rawAssetClass = holding.assetClass ?? (holding as any).asset_class;
    row.asset_class = normalizeAssetClassForDb(rawAssetClass) ?? 'Other';
    // Persist goal linkage if provided
    if (holding.goalId != null) {
        row.goal_id = holding.goalId;
    } else if ((holding as any).goal_id != null) {
        row.goal_id = (holding as any).goal_id;
    }
    const acq = holding.acquisitionDate ?? (holding as any).acquisition_date;
    if (acq != null && String(acq).trim() !== '') {
        row.acquisition_date = String(acq).slice(0, 10);
    } else {
        row.acquisition_date = null;
    }
    return row;
}

/** Normalize DB holding row to app Holding shape (camelCase). */
function normalizeHoldingFromRow(row: any): Holding {
    const holdingType = row.holding_type ?? row.holdingType ?? 'ticker';
    return {
        ...row,
        portfolio_id: row.portfolio_id ?? row.portfolioId,
        symbol: row.symbol ?? (holdingType === 'manual_fund' ? '' : ''),
        holdingType,
        quantity: roundQuantity(Number(row.quantity ?? 0)),
        avgCost: roundAvgCostPerUnit(Number(row.avg_cost ?? row.avgCost ?? 0)),
        currentValue: roundMoney(Number(row.current_value ?? row.currentValue ?? 0)),
        realizedPnL: roundMoney(Number(row.realized_pnl ?? row.realizedPnL ?? 0)),
        zakahClass: row.zakah_class ?? row.zakahClass ?? 'Zakatable',
        assetClass: row.asset_class ?? row.assetClass,
        goalId: row.goal_id ?? row.goalId,
        acquisitionDate: row.acquisition_date ?? row.acquisitionDate ?? undefined,
    };
}

/** Map commodity holding to DB row (snake_case). Schema uses purchase_value, current_value, zakah_class. name must be non-null. */
function commodityHoldingToRow(holding: Partial<CommodityHolding> & { symbol: string; quantity: number }): Record<string, unknown> {
    const raw = holding.name ?? (holding as any).name ?? String(holding.symbol ?? 'Other').trim();
    const name = (raw && String(raw).trim()) ? String(raw).trim() : 'Other';
    const cacq = holding.acquisitionDate ?? (holding as any).acquisition_date;
    const row: Record<string, unknown> = {
        name,
        quantity: roundQuantity(Number(holding.quantity ?? 0)),
        unit: holding.unit ?? 'unit',
        symbol: holding.symbol,
        owner: holding.owner ?? null,
        purchase_value: roundMoney(Number(holding.purchaseValue ?? (holding as any).purchase_value ?? 0)),
        current_value: roundMoney(Number(holding.currentValue ?? (holding as any).current_value ?? 0)),
        zakah_class: holding.zakahClass ?? (holding as any).zakah_class ?? 'Zakatable',
        // Persist goal linkage so it survives refresh. "Not linked" => NULL in DB.
        goal_id:
            holding.goalId != null && String(holding.goalId).trim() !== ''
                ? holding.goalId
                : (holding as any).goal_id != null && String((holding as any).goal_id).trim() !== ''
                  ? (holding as any).goal_id
                  : null,
    };
    if (cacq != null && String(cacq).trim() !== '') {
        row.acquisition_date = String(cacq).slice(0, 10);
    } else {
        row.acquisition_date = null;
    }
    return row;
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
    if (plan.fxRateUpdatedAt != null && plan.fxRateUpdatedAt !== '') {
        row.fx_rate_updated_at = plan.fxRateUpdatedAt;
    }
    if (plan.plansByPortfolioId && Object.keys(plan.plansByPortfolioId).length > 0) {
        row.plans_by_portfolio_id = Object.fromEntries(
            Object.entries(plan.plansByPortfolioId).map(([k, v]) => [k, toPlanSlice(v as InvestmentPlanSettings)]),
        );
    }
    return row;
}

/** Build DB row with only overrides (values that differ from app defaults). Defaults live in initialData.investmentPlan, not in DB. */
function investmentPlanOverridesToRow(plan: InvestmentPlanSettings): Record<string, unknown> {
    const defaultRow = investmentPlanToRow(initialData.investmentPlan);
    const planRow = investmentPlanToRow(plan);
    const row: Record<string, unknown> = {};
    for (const k of Object.keys(planRow) as (keyof typeof planRow)[]) {
        if (k === 'user_id') continue;
        const a = planRow[k];
        const b = defaultRow[k];
        const same = a === b || (JSON.stringify(a) === JSON.stringify(b));
        if (!same) row[k] = a;
    }
    return row;
}

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const [dataResetKey, setDataResetKey] = useState(0);
    const auth = useContext(AuthContext);
    const tradeSubmissionInFlightRef = useRef(false);
    const duplicateHoldingsReconcileInFlightRef = useRef(false);
    const duplicateHoldingsLastSignatureRef = useRef<string>('');
    const transactionsRef = useRef<FinancialData['transactions']>(data?.transactions ?? []);
    transactionsRef.current = data?.transactions ?? [];
    const updatePlatformRef = useRef<((platform: Account, opts?: { fromTransactionDelta?: boolean }) => Promise<void>) | null>(null);
    /** Accumulator for cash account deltas during recurring-apply loops; avoids stale balance when multiple txs hit the same account. */
    const cashBalanceAccumulatorRef = useRef<Record<string, number>>({});

    const normalizeHolding = (holding: any): Holding => {
        const holdingType = holding.holdingType ?? holding.holding_type ?? 'ticker';
        return {
            ...holding,
            portfolio_id: holding.portfolio_id || holding.portfolioId,
            symbol: holding.symbol ?? '',
            holdingType,
            quantity: roundQuantity(Number(holding.quantity ?? 0)),
            avgCost: roundAvgCostPerUnit(Number(holding.avgCost ?? holding.avg_cost ?? 0)),
            currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? 0)),
            goalId: holding.goalId ?? holding.goal_id,
            assetClass: holding.assetClass ?? holding.asset_class,
            realizedPnL: roundMoney(Number(holding.realizedPnL ?? holding.realized_pnl ?? 0)),
            dividendDistribution: holding.dividendDistribution ?? holding.dividend_distribution,
            dividendYield: holding.dividendYield ?? holding.dividend_yield,
            zakahClass: holding.zakahClass ?? holding.zakah_class ?? 'Zakatable',
            acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
        };
    };

    const normalizeInvestmentTransaction = (transaction: any): InvestmentTransaction => {
        const curRaw = transaction.currency as string | undefined;
        const currency = curRaw === 'SAR' || curRaw === 'USD' ? curRaw : undefined;
        const typeRaw = String(transaction.type ?? '').toLowerCase();
        const normalizedType = typeRaw as InvestmentTransaction['type'];
        const portfolioId = transaction.portfolioId ?? transaction.portfolio_id;
        const linkedPortfolio: any = portfolioId ? (data?.investments ?? []).find((p: any) => p.id === portfolioId) : undefined;
        const portfolioLinkedAccountId = portfolioId
            ? resolveAccountId(
                  linkedPortfolio?.accountId ?? linkedPortfolio?.account_id,
                  data?.accounts ?? [],
              )
            : undefined;
        return {
            ...transaction,
            accountId: transaction.accountId || transaction.account_id || portfolioLinkedAccountId,
            portfolioId,
            type: normalizedType,
            currency,
            linkedCashAccountId: transaction.linkedCashAccountId ?? transaction.linked_cash_account_id,
        };
    };

    const normalizeCommodityHolding = (holding: any): CommodityHolding => {
        const name = holding.name ?? holding.Name;
        const trimmed = String(name ?? '').trim();
        if (!trimmed) {
            return {
                ...holding,
                name: 'Other' as CommodityHolding['name'],
                quantity: roundQuantity(Number(holding.quantity ?? 0)),
                purchaseValue: roundMoney(Number(holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0)),
                currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0)),
                goldKarat: (holding.goldKarat ?? holding.gold_karat ?? (String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1] ? Number(String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1]) : undefined)) as CommodityHolding['goldKarat'],
                zakahClass: holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable',
                goalId: holding.goalId ?? holding.goal_id,
                acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
                createdAt: holding.createdAt ?? holding.created_at,
            };
        }
        const allowedNames = ['Gold', 'Silver', 'Bitcoin'] as const;
        const validName = allowedNames.find(a => a.toLowerCase() === trimmed.toLowerCase()) ?? 'Other';
        return {
            ...holding,
            name: validName as CommodityHolding['name'],
            quantity: roundQuantity(Number(holding.quantity ?? 0)),
            purchaseValue: roundMoney(Number(holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0)),
            currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0)),
            goldKarat: (holding.goldKarat ?? holding.gold_karat ?? (String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1] ? Number(String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1]) : undefined)) as CommodityHolding['goldKarat'],
            zakahClass: holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable',
            goalId: holding.goalId ?? holding.goal_id,
            acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
            createdAt: holding.createdAt ?? holding.created_at,
        };
    };

    const normalizeLiability = (raw: any): Liability => {
        const type = (raw.type === 'Receivable' ? 'Receivable' : raw.type) as Liability['type'];
        const rawAmount = roundMoney(Number(raw.amount ?? 0));
        const amount = type === 'Receivable' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
        return { ...raw, type, amount: roundMoney(amount), goalId: raw.goalId ?? raw.goal_id };
    };

    const liabilityPayloadVariants = (liability: Liability) => {
        const common = {
            name: liability.name,
            type: liability.type,
            amount: liability.amount,
            status: liability.status ?? 'Active',
            owner: liability.owner ?? null,
        };
        const goal = liability.goalId != null && String(liability.goalId).trim() !== '' ? liability.goalId : null;
        const snake = { ...common, goal_id: goal };
        const camel = { ...common, goalId: goal };
        return [snake, camel, common];
    };

    const normalizeTransaction = (transaction: any): Transaction => {
        const rawNote = transaction.note != null ? String(transaction.note) : '';
        const { cleanNote, splitLines } = parseSplitsFromNote(rawNote);
        return {
            ...transaction,
            amount: roundMoney(Number(transaction.amount ?? 0)),
            accountId: transaction.accountId ?? transaction.account_id ?? '',
            budgetCategory: transaction.budgetCategory ?? transaction.budget_category,
            categoryId: transaction.categoryId ?? transaction.category_id,
            rejectionReason: transaction.rejectionReason ?? transaction.rejection_reason,
            recurringId: transaction.recurringId ?? transaction.recurring_id,
            transferGroupId: transaction.transferGroupId ?? transaction.transfer_group_id,
            transferRole: transaction.transferRole ?? transaction.transfer_role,
            note: cleanNote !== undefined ? cleanNote : transaction.note,
            ...(splitLines?.length ? { splitLines } : {}),
        };
    };

    const normalizeRecurringTransaction = (raw: any, resolvedAccountId?: string): RecurringTransaction => ({
        id: raw.id,
        user_id: raw.user_id,
        description: raw.description ?? '',
        amount: roundMoney(Number(raw.amount ?? 0)),
        type: (raw.type === 'income' || raw.type === 'expense') ? raw.type : 'expense',
        accountId: resolvedAccountId ?? raw.accountId ?? raw.account_id ?? '',
        budgetCategory: raw.budgetCategory ?? raw.budget_category,
        category: raw.category ?? '',
        dayOfMonth: Math.min(28, Math.max(1, Number(raw.dayOfMonth ?? raw.day_of_month ?? 1))),
        enabled: raw.enabled !== false,
        addManually: raw.addManually === true || raw.add_manually === true,
    });

    const isMissingColumnError = (error: any) => {
        const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
        return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('column') || message.includes('schema cache');
    };

    const goalPayloadVariants = (goal: Goal) => {
        const p = normalizeGoalPriority(goal.priority);
        const camel = {
            name: goal.name,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            deadline: goal.deadline,
            savingsAllocationPercent: goal.savingsAllocationPercent,
        };
        const snake = {
            name: goal.name,
            target_amount: goal.targetAmount,
            current_amount: goal.currentAmount,
            deadline: goal.deadline,
            savings_allocation_percent: goal.savingsAllocationPercent,
        };
        // Prefer snake_case + priority (typical Postgres), then legacy `goal_priority`, then camelCase; schemas without priority last.
        return [
            { ...snake, priority: p },
            { ...snake, goal_priority: p },
            { ...camel, priority: p },
            { ...camel, goal_priority: p },
            snake,
            camel,
        ];
    };

    const tradePayloadVariants = (trade: Omit<InvestmentTransaction, 'id' | 'user_id'>) => {
        const baseRow = { account_id: trade.accountId, date: trade.date, type: trade.type, symbol: trade.symbol, quantity: trade.quantity, price: trade.price, total: trade.total };
        const withCurrency = trade.currency ? { ...baseRow, currency: trade.currency } : baseRow;
        return [withCurrency, baseRow];
    };

    const transactionPayloadVariants = (transaction: Omit<Transaction, 'id' | 'user_id'> | Transaction) => {
        const { splitLines: _sl, ...txRest } = transaction as Transaction & { splitLines?: unknown };
        const transactionClean = txRest as typeof transaction;
        const recId = (transactionClean as { recurringId?: string; recurring_id?: string }).recurringId ?? (transactionClean as any).recurring_id;
        const budgetCat = (transactionClean as { budgetCategory?: string; budget_category?: string }).budgetCategory ?? (transactionClean as any).budget_category;
        const accountId = (transactionClean as { accountId?: string; account_id?: string }).accountId ?? (transactionClean as any).account_id;
        const transferGroupId = (transactionClean as { transferGroupId?: string; transfer_group_id?: string }).transferGroupId ?? (transactionClean as any).transfer_group_id;
        const transferRole = (transactionClean as { transferRole?: string; transfer_role?: string }).transferRole ?? (transactionClean as any).transfer_role;

        const payloadWithSnakeCase: Record<string, unknown> = { ...transactionClean };
        delete payloadWithSnakeCase.accountId;
        delete payloadWithSnakeCase.budgetCategory;
        delete payloadWithSnakeCase.recurringId;
        delete payloadWithSnakeCase.transferGroupId;
        delete payloadWithSnakeCase.transferRole;
        if (recId !== undefined) payloadWithSnakeCase.recurring_id = recId;
        if (budgetCat !== undefined) payloadWithSnakeCase.budget_category = budgetCat;
        if (accountId !== undefined) payloadWithSnakeCase.account_id = accountId;
        if (transferGroupId !== undefined) payloadWithSnakeCase.transfer_group_id = transferGroupId;
        if (transferRole !== undefined) payloadWithSnakeCase.transfer_role = transferRole;

        const payloadWithCamelCase: Record<string, unknown> = { ...transactionClean };
        delete payloadWithCamelCase.account_id;
        delete payloadWithCamelCase.budget_category;
        delete payloadWithCamelCase.recurring_id;
        delete payloadWithCamelCase.transfer_group_id;
        delete payloadWithCamelCase.transfer_role;
        if (recId !== undefined) payloadWithCamelCase.recurringId = recId;
        if (budgetCat !== undefined) payloadWithCamelCase.budgetCategory = budgetCat;
        if (accountId !== undefined) payloadWithCamelCase.accountId = accountId;
        if (transferGroupId !== undefined) payloadWithCamelCase.transferGroupId = transferGroupId;
        if (transferRole !== undefined) payloadWithCamelCase.transferRole = transferRole;

        const payloadWithSnakeCaseNoOptional: Record<string, unknown> = { ...payloadWithSnakeCase };
        delete payloadWithSnakeCaseNoOptional.recurring_id;
        delete payloadWithSnakeCaseNoOptional.budget_category;
        delete payloadWithSnakeCaseNoOptional.transfer_group_id;
        delete payloadWithSnakeCaseNoOptional.transfer_role;

        const payloadWithCamelCaseNoOptional: Record<string, unknown> = { ...payloadWithCamelCase };
        delete payloadWithCamelCaseNoOptional.recurringId;
        delete payloadWithCamelCaseNoOptional.budgetCategory;
        delete payloadWithCamelCaseNoOptional.transferGroupId;
        delete payloadWithCamelCaseNoOptional.transferRole;

        const variants: Record<string, unknown>[] = [
            payloadWithCamelCase,
            payloadWithSnakeCase,
            payloadWithSnakeCaseNoOptional,
            payloadWithCamelCaseNoOptional,
        ];
        const hasNote =
            transactionClean.note != null && String(transactionClean.note).trim() !== '';
        if (hasNote) {
            const { note: _n1, ...camelNoNote } = { ...payloadWithCamelCase };
            const { note: _n2, ...snakeNoNote } = { ...payloadWithSnakeCase };
            variants.push(camelNoNote, snakeNoNote);
        }
        return variants;
    };

    const fetchData = async () => {
        if (!auth?.user || !supabase) {
            setLoading(false);
            return;
        }
        const db = supabase;
        setLoading(true);
        try {
            // recurring_transactions may not exist if migration not run; fetch so it never rejects
            const recurringPromise = db.from('recurring_transactions').select('*').eq('user_id', auth.user.id)
                .then((r: any) => r, () => ({ data: [] as any[], error: { code: 'PGRST205', message: 'Table not found' } }));

            const fetchPromises = [
                db.from('accounts').select('*').eq('user_id', auth.user.id),
                db.from('assets').select('*').eq('user_id', auth.user.id),
                db.from('liabilities').select('*').eq('user_id', auth.user.id),
                db.from('goals').select('*').eq('user_id', auth.user.id),
                db.from('transactions').select('*').eq('user_id', auth.user.id),
                db.from('investment_portfolios').select('*, holdings(*)').eq('user_id', auth.user.id),
                db.from('investment_transactions').select('*').eq('user_id', auth.user.id),
                db.from('budgets').select('*').eq('user_id', auth.user.id),
                db.from('watchlist').select('*').eq('user_id', auth.user.id),
                db.from('settings').select('*').eq('user_id', auth.user.id).maybeSingle(),
                db.from('zakat_payments').select('*').eq('user_id', auth.user.id),
                db.from('price_alerts').select('*').eq('user_id', auth.user.id),
                db.from('commodity_holdings').select('*').eq('user_id', auth.user.id),
                db.from('planned_trades').select('*').eq('user_id', auth.user.id),
                // Monthly investment plan is private per user; admin must never load or view another user's plan.
                db.from('investment_plan').select('*').eq('user_id', auth.user.id).maybeSingle(),
                db.from('portfolio_universe').select('*').eq('user_id', auth.user.id),
                db.from('status_change_log').select('*').eq('user_id', auth.user.id),
                db.from('execution_logs').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }),
                recurringPromise,
                db.from('budget_requests').select('*').eq('user_id', auth.user.id)
            ];
            const keys = ['accounts', 'assets', 'liabilities', 'goals', 'transactions', 'investments', 'investmentTransactions', 'budgets', 'watchlist', 'settings', 'zakatPayments', 'priceAlerts', 'commodityHoldings', 'plannedTrades', 'investmentPlan', 'portfolioUniverse', 'statusChangeLog', 'executionLogs', 'recurringTransactions', 'budgetRequests'] as const;
            const settled = await Promise.allSettled(fetchPromises);
            const emptyResult = (err?: any) => ({ data: null, error: err || { code: 'FETCH_FAILED' } });
            const results = settled.map((s, i) => {
                if (s.status === 'fulfilled') return s.value as any;
                console.error(`Error fetching ${keys[i]}:`, s.reason);
                return emptyResult(s.reason);
            });
            const [accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades, investmentPlan, portfolioUniverse, statusChangeLog, executionLogs, recurringTransactions, budgetRequests] = results;
            const allFetches = { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments, priceAlerts, commodityHoldings, plannedTrades, investmentPlan, portfolioUniverse, statusChangeLog, executionLogs, recurringTransactions, budgetRequests };
            Object.entries(allFetches).forEach(([key, value]) => {
              if (value?.error && value.error.code !== 'PGRST116') console.error(`Error fetching ${key}:`, value.error);
            });

            const normalizedAccounts = ((accounts.data as any[]) || []).map(normalizeAccount);
            const ownerId = auth.user.id;
            const filterOwnedRows = <T extends { user_id?: string }>(rows: T[] | null | undefined): T[] =>
                ((rows || []) as T[]).filter((r) => r?.user_id === ownerId);

            // Check if user is admin (has special email or role)
            const isAdmin = auth.user.email?.toLowerCase().includes('admin') || 
                           auth.user.email?.toLowerCase().includes('hussein') ||
                           (auth.user.user_metadata?.role === 'admin');

            // Admin: fetch only Pending transactions (for approval UI) and own budgets. Never fetch other users' investment_plan or planned_trades.
            let allTransactionsData: any[] = [];
            let allBudgetsData: any[] = [];
            if (isAdmin && supabase) {
                try {
                    const [allTxResult, allBudgetsResult] = await Promise.allSettled([
                        supabase.from('transactions').select('*').eq('status', 'Pending'),
                        supabase.from('budgets').select('*')
                    ]);
                    allTransactionsData = (allTxResult.status === 'fulfilled' ? (allTxResult.value.data || []) : []) as any[];
                    allBudgetsData = (allBudgetsResult.status === 'fulfilled' ? (allBudgetsResult.value.data || []) : []) as any[];
                } catch (e) {
                    console.error('Error fetching admin data:', e);
                }
            }

            const wuBase = getDefaultWealthUltraSystemConfig();
            let wealthUltraConfig = wuBase;
            if (supabase && auth.user) {
                try {
                    const { data: wuUser } = await supabase
                        .from('wealth_ultra_config')
                        .select('*')
                        .eq('user_id', auth.user.id)
                        .maybeSingle();
                    if (wuUser) {
                        wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(wuUser as Record<string, unknown>, wuBase);
                    } else {
                        const { data: wuGlobal } = await supabase
                            .from('wealth_ultra_config')
                            .select('*')
                            .is('user_id', null)
                            .limit(1)
                            .maybeSingle();
                        if (wuGlobal) {
                            wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(wuGlobal as Record<string, unknown>, wuBase);
                        }
                    }
                } catch (e) {
                    console.warn('Optional wealth_ultra_config load skipped:', e);
                }
            }

            setData({
                accounts: filterOwnedRows(normalizedAccounts),
                assets: filterOwnedRows(assets.data as any[]).map(normalizeAssetRow),
                liabilities: filterOwnedRows(((liabilities.data as any[]) || []).map(normalizeLiability)),
                goals: filterOwnedRows(goals.data as any[]).map(normalizeGoalRow),
                transactions: filterOwnedRows(transactions.data as any[]).map(normalizeTransaction),
                // Portfolios: API uses goal_id / account_id; app + Portfolio modal use goalId / accountId (do not drop on refresh).
                investments: filterOwnedRows((investments.data as any) || []).map((portfolio: any) => {
                    const rawAccountId = portfolio.accountId || portfolio.account_id;
                    const resolved = resolveAccountId(rawAccountId, normalizedAccounts) ?? rawAccountId;
                    const holdings = (portfolio.holdings || []).map(normalizeHolding);
                    const currency = resolveInvestmentPortfolioCurrency({ ...portfolio, holdings });
                    return {
                        ...portfolio,
                        accountId: resolved,
                        goalId: portfolio.goal_id ?? portfolio.goalId,
                        currency,
                        holdings,
                    };
                }),
                investmentTransactions: filterOwnedRows(investmentTransactions.data as any[]).map((t: any) => {
                    const norm = normalizeInvestmentTransaction(t);
                    const resolved = resolveAccountId(norm.accountId, normalizedAccounts);
                    return resolved ? { ...norm, accountId: resolved } : norm;
                }),
                budgets: filterOwnedRows(budgets.data as any[]).map((b: any) => ({
                    ...b,
                    period: b.period ?? 'monthly',
                    tier: b.tier ?? b.budget_tier ?? 'Optional',
                    destinationAccountId: b.destination_account_id ?? undefined,
                    limit: roundMoney(Number(b.limit ?? 0)),
                })),
                commodityHoldings: filterOwnedRows(commodityHoldings.data as any[]).map(normalizeCommodityHolding),
                watchlist: filterOwnedRows(watchlist.data as any[]),
                settings: normalizeSettings((settings as any).data ?? initialData.settings),
                zakatPayments: filterOwnedRows(zakatPayments.data as any[]),
                priceAlerts: filterOwnedRows(priceAlerts.data as any[]).map(normalizePriceAlert),
                plannedTrades: filterOwnedRows(plannedTrades.data as any[]),
                notifications: [],
                investmentPlan: normalizeInvestmentPlan((investmentPlan as any).data),
                wealthUltraConfig,
                portfolioUniverse: filterOwnedRows((portfolioUniverse as any).data || []).map(normalizeUniverseTicker),
                statusChangeLog: filterOwnedRows((statusChangeLog as any).data || []),
                executionLogs: filterOwnedRows((executionLogs as any).data || []).map(normalizeExecutionLog),
                recurringTransactions: (recurringTransactions as any).error ? [] : filterOwnedRows((recurringTransactions as any).data || []).map((r: any) =>
                    normalizeRecurringTransaction(r, resolveAccountId(r.account_id ?? r.accountId, normalizedAccounts) ?? undefined)
                ),
                budgetRequests: ((budgetRequests as any).data || []).map((r: any) => ({
                    id: r.id,
                    userId: r.user_id ?? r.userId,
                    requestType: (r.request_type ?? r.requestType) === 'IncreaseLimit' ? 'IncreaseLimit' : 'NewCategory',
                    categoryId: r.category_id ?? r.categoryId,
                    categoryName: r.category_name ?? r.categoryName,
                    amount: roundMoney(Number(r.amount ?? 0)),
                    note: r.note ?? r.request_note,
                    status: r.status === 'Finalized' ? 'Finalized' : r.status === 'Rejected' ? 'Rejected' : 'Pending',
                })),
                allTransactions: allTransactionsData.map(normalizeTransaction),
                allBudgets: allBudgetsData,
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
        // Use user id only: `user` object reference changes on TOKEN_REFRESHED; refetching then caused global loading flashes.
    }, [auth?.user?.id]);

    useEffect(() => {
        if (!auth?.user?.id || !supabase) return;
        void mergeNetWorthSnapshotsFromServer(supabase, auth.user.id);
    }, [auth?.user?.id]);

    /** Keep a dense SAR/USD point per calendar day for charts/KPIs (spot + snapshot seed + forward-fill). */
    useEffect(() => {
        hydrateSarPerUsdDailySeries(data, resolveSarPerUsd(data ?? null, DEFAULT_SAR_PER_USD));
    }, [data, dataResetKey]);

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
            'budget_requests',
        ];
        // allSettled so missing tables (e.g. recurring_transactions) don't fail the whole reset
        await Promise.allSettled(tables.map(table => db.from(table).delete().eq('user_id', auth.user!.id)));
        setData(initialData);
        setDataResetKey((k) => k + 1);
        setLoading(false);
    };

    const resetData = async () => {
      if (window.confirm("Are you sure you want to permanently delete all your financial data? This action cannot be undone.")) {
        await _internalResetData();
        toast("Your data has been cleared.", 'success');
      }
    };

    const restoreFromBackup = async (backup: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
        if (!supabase || !auth?.user) return { ok: false, error: 'Not logged in' };
        const backupVal = validateBackup(backup);
        if (!backupVal.valid) {
            return { ok: false, error: backupVal.errors.join(' ') };
        }
        const uid = auth.user.id;
        const db = supabase;
        const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
        const row = (r: any) => ({ ...r, user_id: uid });
        const table = (name: string, rows: any[]) =>
            rows.length ? db.from(name).insert(rows.map(row)) : Promise.resolve({ data: null, error: null });
        try {
            setLoading(true);
            await _internalResetData();
            if (!supabase || !auth?.user) return { ok: false, error: 'Session lost' };
            setLoading(true);
            const tables: { key: string; dbTable: string }[] = [
                { key: 'accounts', dbTable: 'accounts' },
                { key: 'assets', dbTable: 'assets' },
                { key: 'liabilities', dbTable: 'liabilities' },
                { key: 'goals', dbTable: 'goals' },
                { key: 'transactions', dbTable: 'transactions' },
                { key: 'budgets', dbTable: 'budgets' },
                { key: 'watchlist', dbTable: 'watchlist' },
                { key: 'zakatPayments', dbTable: 'zakat_payments' },
                { key: 'priceAlerts', dbTable: 'price_alerts' },
                { key: 'commodityHoldings', dbTable: 'commodity_holdings' },
                { key: 'plannedTrades', dbTable: 'planned_trades' },
                { key: 'portfolioUniverse', dbTable: 'portfolio_universe' },
                { key: 'statusChangeLog', dbTable: 'status_change_log' },
                { key: 'executionLogs', dbTable: 'execution_logs' },
                { key: 'recurringTransactions', dbTable: 'recurring_transactions' },
                { key: 'budgetRequests', dbTable: 'budget_requests' },
            ];
            for (const { key, dbTable } of tables) {
                const rows = arr(backup[key] ?? backup[key.replace(/([A-Z])/g, '_$1').toLowerCase()]);
                if (rows.length) {
                    const { error } = await table(dbTable, rows);
                    if (error) console.warn(`Restore ${dbTable}:`, error);
                }
            }
            const investments = arr(backup.investments);
            if (investments.length) {
                const portfolioRows = investments.map((p: any) => {
                    const { holdings, ...rest } = p;
                    return row({ ...rest, account_id: rest.account_id ?? rest.accountId });
                });
                const { error: ep } = await db.from('investment_portfolios').insert(portfolioRows);
                if (ep) console.warn('Restore investment_portfolios:', ep);
                const allHoldings = investments.flatMap((p: any) => (p.holdings ?? []).map((h: any) => ({ ...h, portfolio_id: h.portfolio_id ?? h.portfolioId ?? p.id })));
                if (allHoldings.length) {
                    const { error: eh } = await db.from('holdings').insert(allHoldings.map(row));
                    if (eh) console.warn('Restore holdings:', eh);
                }
            }
            const invTx = arr(backup.investmentTransactions);
            if (invTx.length) {
                const { error } = await db.from('investment_transactions').insert(invTx.map(row));
                if (error) console.warn('Restore investment_transactions:', error);
            }
            const settingsData = backup.settings;
            if (settingsData && typeof settingsData === 'object' && !Array.isArray(settingsData)) {
                const { error } = await db.from('settings').upsert(row(settingsData as any), { onConflict: 'user_id' });
                if (error) console.warn('Restore settings:', error);
            }
            const planData = backup.investmentPlan;
            if (planData && typeof planData === 'object' && !Array.isArray(planData)) {
                const { error } = await db.from('investment_plan').upsert(row(planData as any), { onConflict: 'user_id' });
                if (error) console.warn('Restore investment_plan:', error);
            }
            await fetchData();
            setLoading(false);
            return { ok: true };
        } catch (e) {
            setLoading(false);
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: msg };
        }
    };

    const loadDemoData = async () => {
        console.warn('[DataContext] loadDemoData is disabled to protect real user data. No demo data was loaded.');
        return;
    };


    // --- Assets ---
    const addAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) {
            toast("You must be logged in to add an asset.", 'error');
            return;
        }
        const sanitized = normalizeAssetRow(asset);
        const v = validateAsset({
            name: sanitized.name,
            type: sanitized.type,
            value: sanitized.value,
            issueDate: sanitized.issueDate,
            maturityDate: sanitized.maturityDate,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const { id: _omitId, user_id: _omitUid, issueDate, maturityDate, notes: notesForDb, ...insertRest } = sanitized;
        const dates = assetDatesForDb(sanitized);
        const notesPayload =
            notesForDb != null && String(notesForDb).trim() !== '' ? String(notesForDb).trim() : null;
        const { data: newAsset, error } = await db
            .from('assets')
            .insert(withUser({ ...insertRest, ...dates, notes: notesPayload }))
            .select()
            .single();
        if (error) { 
            console.error("Error adding asset:", error); 
            toast(`Failed to add asset: ${error.message}`, 'error');
            throw error; 
        }
        if (newAsset) setData(prev => ({ ...prev, assets: [...prev.assets, normalizeAssetRow(newAsset)] }));
    };
    const updateAsset = async (asset: Asset) => {
        if(!supabase || !auth?.user) return;
        const sanitized = normalizeAssetRow(asset);
        const v = validateAsset({
            name: sanitized.name,
            type: sanitized.type,
            value: sanitized.value,
            issueDate: sanitized.issueDate,
            maturityDate: sanitized.maturityDate,
            notes: sanitized.notes,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const { id: _assetId, user_id: _uid, issueDate, maturityDate, notes: notesForDb, ...updateRest } = sanitized;
        const dates = assetDatesForDb(sanitized);
        const notesPayload =
            notesForDb != null && String(notesForDb).trim() !== '' ? String(notesForDb).trim() : null;
        const { error } = await db
            .from('assets')
            .update({ ...updateRest, ...dates, notes: notesPayload })
            .match({ id: sanitized.id, user_id: auth.user.id });
        if (error) console.error("Error updating asset:", error);
        else setData(prev => ({ ...prev, assets: prev.assets.map(a => a.id === sanitized.id ? sanitized : a) }));
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
            toast("You must be logged in to add a goal.", 'error');
            return;
        }
        const v = validateGoal({ name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, deadline: goal.deadline });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
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
            toast(`Failed to add goal: ${error.message}`, 'error');
            throw error;
        }
        if (newGoal) setData(prev => ({ ...prev, goals: [...prev.goals, normalizeGoalRow({ ...newGoal, priority: newGoal.priority ?? goal.priority })] }));
    };
    const updateGoal = async (goal: Goal) => {
      if(!supabase || !auth?.user) return;
      const v = validateGoal({ name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, deadline: goal.deadline });
      if (!v.valid) {
        toast(v.errors.join('\n'), 'error');
        return;
      }
      const db = supabase;
      let error: any = null;
      for (const payload of goalPayloadVariants(goal)) {
        const result = await db.from('goals').update(payload).match({ id: goal.id, user_id: auth.user.id });
        error = result.error;
        if (!error) break;
        if (!isMissingColumnError(error)) break;
      }
      if (error) console.error("Error updating goal:", error);
      else setData(prev => ({
          ...prev,
          goals: prev.goals.map(g => (g.id === goal.id ? { ...goal, priority: normalizeGoalPriority(goal.priority) } : g)),
      }));
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
      for (const a of allocations) {
        const v = validateGoalAllocation({ savingsAllocationPercent: a.savingsAllocationPercent });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      }
      const db = supabase;
      for (const a of allocations) {
        let lastErr: any = null;
        for (const payload of [
          { savings_allocation_percent: a.savingsAllocationPercent },
          { savingsAllocationPercent: a.savingsAllocationPercent },
        ]) {
          const { error } = await db.from('goals').update(payload).match({ id: a.id, user_id: auth.user!.id });
          lastErr = error;
          if (!error) break;
          if (!isMissingColumnError(error)) break;
        }
        if (lastErr) {
          console.error("Error updating goal allocations:", lastErr);
          toast(`Failed to save allocations: ${lastErr.message}`, 'error');
          return;
        }
      }
      setData(prev => ({
          ...prev,
          goals: prev.goals.map(g => {
            const newAlloc = allocations.find(al => al.id === g.id);
            return newAlloc ? { ...g, savingsAllocationPercent: newAlloc.savingsAllocationPercent } : g;
          }),
      }));
    };

    // --- Liabilities ---
    const addLiability = async (liability: Liability) => {
      if(!supabase) return;
      const v = validateLiability({ name: liability.name, type: liability.type, amount: liability.amount, status: liability.status });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const db = supabase;
      let newLiability: any = null;
      let lastErr: any = null;
      for (const payload of liabilityPayloadVariants(liability)) {
        const result = await db.from('liabilities').insert(withUser(payload)).select().single();
        newLiability = result.data;
        lastErr = result.error;
        if (!lastErr) break;
        if (!isMissingColumnError(lastErr)) break;
      }
      if (lastErr) { console.error("Error adding liability:", lastErr); throw lastErr; }
      if (newLiability) {
        const normalized = normalizeLiability(newLiability);
        setData(prev => ({ ...prev, liabilities: [...prev.liabilities, normalized] }));
      }
    };
    const updateLiability = async (liability: Liability) => {
      if(!supabase || !auth?.user) return;
      const v = validateLiability({ name: liability.name, type: liability.type, amount: liability.amount, status: liability.status });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const db = supabase;
      let lastErr: any = null;
      for (const payload of liabilityPayloadVariants(liability)) {
        const { error } = await db.from('liabilities').update(payload).match({ id: liability.id, user_id: auth.user.id });
        lastErr = error;
        if (!lastErr) break;
        if (!isMissingColumnError(lastErr)) break;
      }
      if(lastErr) console.error("Error updating liability:", lastErr);
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
      const v = validateBudget({ category: budget.category, month: budget.month, year: budget.year, limit: budget.limit, period: (budget as Budget).period });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const db = supabase;
      const payload: Record<string, unknown> = { ...withUser(budget) as Record<string, unknown> };
      if (budget.destinationAccountId != null) payload.destination_account_id = budget.destinationAccountId;
      let { data: newBudget, error } = await db.from('budgets').insert(payload).select().single();
      // Retry once with same payload. Do not convert yearly limit to monthly or reload will show wrong value (DB would store monthly amount with period=yearly).
      if (error && (payload as any).period) {
        const retry = await db.from('budgets').insert(payload).select().single();
        newBudget = retry.data;
        error = retry.error;
      }
      if (error) {
        console.error("Error adding budget:", error);
        throw error;
      }
      if (newBudget) {
        const withPeriod = { ...newBudget, period: (budget as Budget).period, tier: (budget as Budget).tier, destinationAccountId: (newBudget as any).destination_account_id ?? undefined };
        if ((budget as Budget).period === 'yearly' || (budget as Budget).period === 'weekly' || (budget as Budget).period === 'daily') withPeriod.limit = budget.limit;
        setData(prev => ({ ...prev, budgets: [...prev.budgets, withPeriod] }));
      }
    };
    const updateBudget = async (budget: Budget) => {
      if (!supabase || !auth?.user) return;
      const v = validateBudget({ category: budget.category, month: budget.month, year: budget.year, limit: budget.limit, period: budget.period });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const db = supabase;
      const { category, month, year, limit, period, tier, destinationAccountId } = budget;
      const payload: Record<string, unknown> = {
        limit,
        period,
        tier,
      };
      if (destinationAccountId !== undefined) payload.destination_account_id = destinationAccountId;
      const { error } = await db
        .from('budgets')
        .update(payload)
        .match({ user_id: auth.user.id, category, month, year });
      if (error) {
        console.error('Error updating budget:', error);
        return;
      }
      setData((prev) => ({
        ...prev,
        budgets: prev.budgets.map((b) =>
          b.category === category && b.month === month && b.year === year
            ? { ...b, limit, period, tier, destinationAccountId }
            : b
        ),
      }));
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
        if (error) { console.error("Error fetching source budgets:", error); toast("Could not fetch last month's budgets.", 'error'); return; }
        if (!sourceBudgets || sourceBudgets.length === 0) { toast("No budgets found for the previous month to copy.", 'error'); return; }

        const existingTargetCategories = new Set((data?.budgets ?? []).filter(b => b.year === targetYear && b.month === targetMonth).map(b => b.category));
        
        const budgetsToInsert = sourceBudgets
            .filter((b: any) => !existingTargetCategories.has(b.category))
            .map((b: any) => {
                const { id, user_id, ...rest } = b;
                return { ...rest, month: targetMonth, year: targetYear, period: b.period ?? 'monthly', destination_account_id: b.destination_account_id ?? undefined };
            });

        if (budgetsToInsert.length === 0) { toast("All budgets from last month already exist for the selected month.", 'info'); return; }

        const { data: insertedData, error: insertError } = await supabase.from('budgets').insert(budgetsToInsert.map(b => withUser(b))).select();
        if (insertError) { console.error("Error copying budgets:", insertError); toast("Failed to copy budgets.", 'error'); }
        else {
            const normalized = (insertedData || []).map((b: any) => ({ ...b, period: b.period ?? 'monthly', tier: b.tier ?? b.budget_tier ?? 'Optional', destinationAccountId: b.destination_account_id ?? undefined }));
            setData(prev => ({ ...prev, budgets: [...prev.budgets, ...normalized] }));
            toast(`${insertedData.length} budget(s) copied successfully.`, 'success');
        }
    };
    
    // --- Transactions ---
    const removeSharedBudgetTransactionMirror = async (sourceTransactionId: string) => {
        if (!supabase || !auth?.user || !sourceTransactionId) return;
        await supabase
            .from('budget_shared_transactions')
            .delete()
            .match({ source_transaction_id: sourceTransactionId, contributor_user_id: auth.user.id })
            .then(() => {}, () => {});
    };

    const syncSharedBudgetTransactionMirror = async (tx: {
        id: string;
        date: string;
        type: 'income' | 'expense';
        amount: number;
        status?: 'Pending' | 'Approved' | 'Rejected';
        description: string;
        budgetCategory?: string;
    }) => {
        if (!supabase || !auth?.user) return;
        const currentUser = auth.user;
        const category = (tx.budgetCategory || '').trim();
        const status = (tx.status ?? 'Approved') as 'Pending' | 'Approved' | 'Rejected';
        const isExpense = tx.type === 'expense';
        if (!category || !isExpense || status === 'Rejected') {
            await removeSharedBudgetTransactionMirror(tx.id);
            return;
        }

        const { data: shares } = await supabase
            .from('budget_shares')
            .select('owner_user_id, category')
            .eq('shared_with_user_id', auth.user.id)
            .or(`category.is.null,category.eq.${category}`)
            .then((r) => r, () => ({ data: [] as any[] } as any));

        const rows = (shares || []) as Array<{ owner_user_id?: string; category?: string | null }>;
        if (rows.length === 0) {
            await removeSharedBudgetTransactionMirror(tx.id);
            return;
        }

        await removeSharedBudgetTransactionMirror(tx.id);

        const payload = rows
            .map((r) => r.owner_user_id)
            .filter((ownerId): ownerId is string => Boolean(ownerId) && ownerId !== currentUser.id)
            .map((ownerId) => ({
                owner_user_id: ownerId,
                contributor_user_id: currentUser.id,
                contributor_email: currentUser.email ?? null,
                source_transaction_id: tx.id,
                budget_category: category,
                amount: Math.abs(Number(tx.amount) || 0),
                transaction_date: tx.date,
                description: tx.description,
                status,
            }));

        if (payload.length === 0) return;
        await supabase.from('budget_shared_transactions').upsert(payload).then(() => {}, () => {});
    };

    /** Keep Checking/Savings `balance` aligned with the cash ledger (`transaction.amount` sums).
     * Uses cashBalanceAccumulatorRef when multiple transactions hit the same account in a loop (e.g. applyRecurringForMonth). */
    const applyCashAccountDeltaForTransaction = async (accountId: string | undefined, delta: number) => {
        if (!accountId || !supabase || !auth?.user) return;
        const d = Number(delta);
        if (!Number.isFinite(d) || d === 0) return;
        const up = updatePlatformRef.current;
        if (!up) return;
        const acc = (data?.accounts ?? []).find((a) => a.id === accountId);
        if (!acc || (acc.type !== 'Checking' && acc.type !== 'Savings')) return;
        const prevBalance = cashBalanceAccumulatorRef.current[accountId] ?? Number(acc.balance ?? 0);
        const newBalance = prevBalance + d;
        cashBalanceAccumulatorRef.current[accountId] = newBalance;
        await up({ ...acc, balance: newBalance }, { fromTransactionDelta: true });
    };

    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'user_id'>) => {
        if(!supabase || !auth?.user) {
            toast("You must be logged in to add a transaction.", 'error');
            return;
        }
        const core = validateTransactionCore({
            date: transaction.date,
            amount: transaction.amount,
            accountId: transaction.accountId,
            description: transaction.description,
        });
        if (!core.valid) {
            toast(core.errors.join('\n'), 'error');
            return;
        }
        const db = supabase;
        let newTx: any = null;
        let error: any = null;
        let savedWithoutNote = false;
        const hadSplitNote =
            typeof transaction.note === 'string' && transaction.note.includes('__FINOVA_SPLITS__');
        const variants = transactionPayloadVariants(transaction);
        for (let i = 0; i < variants.length; i++) {
            const payload = variants[i];
            const result = await db.from('transactions').insert(withUser(payload)).select().single();
            newTx = result.data;
            error = result.error;
            if (!error) {
                savedWithoutNote = hadSplitNote && i >= 2;
                break;
            }
            if (!isMissingColumnError(error) && String(error?.message || '').toLowerCase().indexOf('note') < 0) break;
        }
        if (savedWithoutNote) {
            try {
                toast('Transaction saved, but split/memo was not stored: add column `note` on `transactions`. Run supabase/migrations/add_transactions_note.sql in Supabase SQL.', 'info');
            } catch {}
        }
        if(error) {
            console.error("Error adding transaction:", error);
            toast(`Failed to add transaction: ${error.message}`, 'error');
            throw error;
        }
        if (newTx) {
            const normalized = normalizeTransaction(newTx);
            setData(prev => ({ ...prev, transactions: [normalized, ...prev.transactions] }));
            await syncSharedBudgetTransactionMirror(normalized as any);
            auditChangeLog({
                action: 'create',
                entity: 'transaction',
                entityId: normalized.id,
                summary: `${normalized.type}: ${String(normalized.description ?? '').slice(0, 120)} · ${normalized.amount}`,
                userId: auth.user.id,
            });
            await applyCashAccountDeltaForTransaction(normalized.accountId, Number(normalized.amount) || 0);
        }
    };
    const addTransfer = async (fromAccountId: string, toAccountId: string, amount: number, date?: string, note?: string, feeAmount?: number) => {
        if (!supabase || !auth?.user) return;
        const absAmount = Math.abs(Number(amount));
        const fee = Math.max(0, Number(feeAmount) || 0);
        const transferGroupId = (() => {
            try {
                return crypto?.randomUUID?.();
            } catch {
                return undefined;
            }
        })();
        if (!Number.isFinite(absAmount) || absAmount <= 0) {
            toast('Transfer amount must be a valid positive number.', 'error');
            return;
        }
        if (!Number.isFinite(fee) || fee < 0) {
            toast('Transfer fee must be a valid non-negative number.', 'error');
            return;
        }
        const fromAcc = (data?.accounts ?? []).find((a) => a.id === fromAccountId);
        const toAcc = (data?.accounts ?? []).find((a) => a.id === toAccountId);
        const fromName = fromAcc?.name ?? fromAccountId;
        const toName = toAcc?.name ?? toAccountId;
        const dateStr = date ?? new Date().toISOString().split('T')[0];
        const feeTag = fee > 0 ? ` (fee ${fee.toFixed(2)})` : '';
        const descOut = note ? `Transfer to ${toName}: ${note}${feeTag}` : `Transfer to ${toName}${feeTag}`;
        const descIn = note ? `Transfer from ${fromName}: ${note}` : `Transfer from ${fromName}`;

        const isCashAccount = (a: Account | undefined) => Boolean(a && (a.type === 'Checking' || a.type === 'Savings'));

        /** Tradable cash is tracked in `investment_transactions`, not personal `transactions`. */
        if (isCashAccount(fromAcc) && toAcc?.type === 'Investment') {
            const links = toAcc.linkedAccountIds ?? [];
            if (links.length > 0 && !links.includes(fromAccountId)) {
                toast('This investment platform only accepts transfers from its linked cash accounts. Add the source account under the platform’s linked accounts, then try again.', 'error');
                return;
            }
            const linkedCashAccountId = links.length > 0 ? fromAccountId : undefined;
            if (linkedCashAccountId) {
                const rpcRes = await supabase.rpc('create_investment_cash_transfer_with_fee', {
                    p_investment_account_id: toAccountId,
                    p_cash_account_id: linkedCashAccountId,
                    p_direction: 'cash_to_investment',
                    p_amount: absAmount,
                    p_fee_amount: fee,
                    p_date: dateStr,
                    p_cash_description: descOut,
                    p_fee_description: `Transfer fee to ${toName}`,
                    p_transfer_group_id: transferGroupId,
                } as any);
                const rpcError = rpcRes.error;
                const rpcRows = (rpcRes.data as Array<{ investment_transaction_id?: string; cash_transaction_ids?: string[] }> | null) ?? null;
                if (!rpcError && rpcRows && rpcRows[0]) {
                    const invId = rpcRows[0].investment_transaction_id;
                    const cashIds = rpcRows[0].cash_transaction_ids ?? [];
                    if (invId) {
                        const invFetch = await supabase.from('investment_transactions').select('*').eq('id', invId).single();
                        if (!invFetch.error && invFetch.data) {
                            const normalizedInv = normalizeInvestmentTransaction(invFetch.data);
                            setData(prev => ({ ...prev, investmentTransactions: [normalizedInv, ...prev.investmentTransactions] }));
                        }
                    }
                    if (cashIds.length > 0) {
                        const cashFetch = await supabase.from('transactions').select('*').in('id', cashIds);
                        const txRows = (cashFetch.data ?? []).map((r: any) => normalizeTransaction(r))
                            .sort((a, b) => {
                                const rank = (v: Transaction) => (v.transferRole === 'principal_out' ? 0 : v.transferRole === 'fee' ? 1 : 2);
                                return rank(a) - rank(b);
                            });
                        if (txRows.length > 0) {
                            setData(prev => ({ ...prev, transactions: [...txRows, ...prev.transactions] }));
                            for (const row of txRows) {
                                await syncSharedBudgetTransactionMirror(row as any);
                                auditChangeLog({
                                    action: 'create',
                                    entity: 'transaction',
                                    entityId: row.id,
                                    summary: `${row.type}: ${String(row.description ?? '').slice(0, 120)} · ${row.amount}`,
                                    userId: auth.user.id,
                                });
                                await applyCashAccountDeltaForTransaction(row.accountId, Number(row.amount) || 0);
                            }
                        }
                    }
                    return;
                }
                const missingRpc = rpcError?.code === 'PGRST202' || (String(rpcError?.message || '').toLowerCase().includes('function') && String(rpcError?.message || '').toLowerCase().includes('does not exist'));
                if (rpcError && !missingRpc) throw rpcError;
            }
            try {
                await recordTrade({
                    type: 'deposit',
                    date: dateStr,
                    accountId: toAccountId,
                    total: absAmount,
                    currency: ledgerCurrencyCashToInvestment(fromAcc, data ?? null),
                    symbol: 'CASH',
                    quantity: 0,
                    price: 0,
                    linkedCashAccountId,
                    transferGroupId,
                } as Parameters<typeof recordTrade>[0]);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Transfer failed.';
                toast(msg, 'error');
                return;
            }
            if (!linkedCashAccountId) {
                await addTransaction({
                    date: dateStr,
                    description: descOut,
                    amount: -absAmount,
                    type: 'expense',
                    accountId: fromAccountId,
                    category: 'Transfer',
                    transferGroupId,
                    transferRole: 'principal_out',
                });
            }
            if (fee > 0) {
                await addTransaction({
                    date: dateStr,
                    description: `Transfer fee to ${toName}`,
                    amount: -fee,
                    type: 'expense',
                    accountId: fromAccountId,
                    category: 'Fee',
                    transferGroupId,
                    transferRole: 'fee',
                });
            }
            return;
        }

        if (fromAcc?.type === 'Investment' && isCashAccount(toAcc)) {
            const links = fromAcc.linkedAccountIds ?? [];
            if (links.length > 0 && !links.includes(toAccountId)) {
                toast('This investment platform only allows withdrawals to its linked cash accounts. Link the destination account to the platform first.', 'error');
                return;
            }
            const linkedCashAccountId = links.length > 0 ? toAccountId : undefined;
            if (linkedCashAccountId) {
                const rpcRes = await supabase.rpc('create_investment_cash_transfer_with_fee', {
                    p_investment_account_id: fromAccountId,
                    p_cash_account_id: linkedCashAccountId,
                    p_direction: 'investment_to_cash',
                    p_amount: absAmount,
                    p_fee_amount: fee,
                    p_date: dateStr,
                    p_cash_description: descIn,
                    p_fee_description: `Transfer fee from ${fromName}`,
                    p_transfer_group_id: transferGroupId,
                } as any);
                const rpcError = rpcRes.error;
                const rpcRows = (rpcRes.data as Array<{ investment_transaction_id?: string; cash_transaction_ids?: string[] }> | null) ?? null;
                if (!rpcError && rpcRows && rpcRows[0]) {
                    const invId = rpcRows[0].investment_transaction_id;
                    const cashIds = rpcRows[0].cash_transaction_ids ?? [];
                    if (invId) {
                        const invFetch = await supabase.from('investment_transactions').select('*').eq('id', invId).single();
                        if (!invFetch.error && invFetch.data) {
                            const normalizedInv = normalizeInvestmentTransaction(invFetch.data);
                            setData(prev => ({ ...prev, investmentTransactions: [normalizedInv, ...prev.investmentTransactions] }));
                        }
                    }
                    if (cashIds.length > 0) {
                        const cashFetch = await supabase.from('transactions').select('*').in('id', cashIds);
                        const txRows = (cashFetch.data ?? []).map((r: any) => normalizeTransaction(r))
                            .sort((a, b) => {
                                const rank = (v: Transaction) => (v.transferRole === 'principal_in' ? 0 : v.transferRole === 'fee' ? 1 : 2);
                                return rank(a) - rank(b);
                            });
                        if (txRows.length > 0) {
                            setData(prev => ({ ...prev, transactions: [...txRows, ...prev.transactions] }));
                            for (const row of txRows) {
                                await syncSharedBudgetTransactionMirror(row as any);
                                auditChangeLog({
                                    action: 'create',
                                    entity: 'transaction',
                                    entityId: row.id,
                                    summary: `${row.type}: ${String(row.description ?? '').slice(0, 120)} · ${row.amount}`,
                                    userId: auth.user.id,
                                });
                                await applyCashAccountDeltaForTransaction(row.accountId, Number(row.amount) || 0);
                            }
                        }
                    }
                    return;
                }
                const missingRpc = rpcError?.code === 'PGRST202' || (String(rpcError?.message || '').toLowerCase().includes('function') && String(rpcError?.message || '').toLowerCase().includes('does not exist'));
                if (rpcError && !missingRpc) throw rpcError;
            }
            try {
                await recordTrade({
                    type: 'withdrawal',
                    date: dateStr,
                    accountId: fromAccountId,
                    total: absAmount,
                    currency: ledgerCurrencyInvestmentToCash(toAcc, data ?? null),
                    symbol: 'CASH',
                    quantity: 0,
                    price: 0,
                    linkedCashAccountId,
                    transferGroupId,
                } as Parameters<typeof recordTrade>[0]);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Transfer failed.';
                toast(msg, 'error');
                return;
            }
            if (!linkedCashAccountId) {
                await addTransaction({
                    date: dateStr,
                    description: descIn,
                    amount: absAmount,
                    type: 'income',
                    accountId: toAccountId,
                    category: 'Transfer',
                    transferGroupId,
                    transferRole: 'principal_in',
                });
            }
            if (fee > 0) {
                await addTransaction({
                    date: dateStr,
                    description: `Transfer fee from ${fromName}`,
                    amount: -fee,
                    type: 'expense',
                    accountId: fromAccountId,
                    category: 'Fee',
                    transferGroupId,
                    transferRole: 'fee',
                });
            }
            return;
        }

        const rate = resolveSarPerUsd(data ?? null, (data as any)?.investmentPlan?.fxRate);
        const fromCur = fromAcc?.currency === 'USD' ? 'USD' : 'SAR';
        const toCur = toAcc?.currency === 'USD' ? 'USD' : 'SAR';
        const inboundAmount = fromCur === toCur ? absAmount : fromSAR(toSAR(absAmount, fromCur, rate), toCur, rate);
        const rpcPayload = {
            p_from_account_id: fromAccountId,
            p_to_account_id: toAccountId,
            p_amount: absAmount,
            p_inbound_amount: inboundAmount,
            p_fee_amount: fee,
            p_date: dateStr,
            p_description_out: descOut,
            p_description_in: descIn,
            p_fee_description: `Transfer fee to ${toName}`,
            p_transfer_group_id: transferGroupId,
        };
        const rpcRes = await supabase.rpc('create_linked_transfer_with_fee', rpcPayload as any);
        const rpcRows = (rpcRes.data as any[] | null) ?? null;
        const rpcError = rpcRes.error;
        if (rpcRows && !rpcError) {
            const normalizedRows = rpcRows
                .map((r) => normalizeTransaction(r))
                .sort((a, b) => {
                    const rank = (v: Transaction) => (v.transferRole === 'principal_out' ? 0 : v.transferRole === 'fee' ? 1 : 2);
                    return rank(a) - rank(b);
                });
            setData(prev => ({ ...prev, transactions: [...normalizedRows, ...prev.transactions] }));
            for (const row of normalizedRows) {
                await syncSharedBudgetTransactionMirror(row as any);
                auditChangeLog({
                    action: 'create',
                    entity: 'transaction',
                    entityId: row.id,
                    summary: `${row.type}: ${String(row.description ?? '').slice(0, 120)} · ${row.amount}`,
                    userId: auth.user.id,
                });
                await applyCashAccountDeltaForTransaction(row.accountId, Number(row.amount) || 0);
            }
            return;
        }

        const missingRpc = rpcError?.code === 'PGRST202' || String(rpcError?.message || '').toLowerCase().includes('function') && String(rpcError?.message || '').toLowerCase().includes('does not exist');
        if (rpcError && !missingRpc) {
            throw rpcError;
        }
        if (missingRpc) {
            toast('Transfer saved via legacy flow. For full atomic transfer+fee writes, run migration `supabase/migrations/20260328091000_add_linked_transfer_rpc.sql`.', 'info');
        }

        await addTransaction({
            date: dateStr,
            description: descOut,
            amount: -absAmount,
            type: 'expense',
            accountId: fromAccountId,
            category: 'Transfer',
            transferGroupId,
            transferRole: 'principal_out',
        });
        if (fee > 0) {
            await addTransaction({
                date: dateStr,
                description: `Transfer fee to ${toName}`,
                amount: -fee,
                type: 'expense',
                accountId: fromAccountId,
                category: 'Fee',
                transferGroupId,
                transferRole: 'fee',
            });
        }
        await addTransaction({
            date: dateStr,
            description: descIn,
            amount: inboundAmount,
            type: 'income',
            accountId: toAccountId,
            category: 'Transfer',
            transferGroupId,
            transferRole: 'principal_in',
        });
    };
    const updateTransaction = async (transaction: Transaction) => {
        if(!supabase || !auth?.user) return;
        const core = validateTransactionCore({ date: transaction.date, amount: transaction.amount, accountId: transaction.accountId, description: transaction.description });
        if (!core.valid) { toast(core.errors.join('\n'), 'error'); return; }
        const db = supabase;
        let error: any = null;
        let savedWithoutNote = false;
        const hadSplitNote =
            typeof transaction.note === 'string' && transaction.note.includes('__FINOVA_SPLITS__');
        const variants = transactionPayloadVariants(transaction);
        for (let i = 0; i < variants.length; i++) {
            const result = await db
                .from('transactions')
                .update(variants[i])
                .match({ id: transaction.id, user_id: auth.user.id });
            error = result.error;
            if (!error) {
                savedWithoutNote = hadSplitNote && i >= 2;
                break;
            }
            if (!isMissingColumnError(error) && String(error?.message || '').toLowerCase().indexOf('note') < 0) break;
        }
        if (savedWithoutNote) {
            try {
                toast('Update saved without memo/splits: run supabase/migrations/add_transactions_note.sql to add the `note` column.', 'info');
            } catch {}
        }
        if(error) console.error("Error updating transaction:", error);
        else {
            const prev = data?.transactions?.find((t) => t.id === transaction.id);
            const normalized = normalizeTransaction(transaction as any);
            if (prev) {
                if (prev.accountId === normalized.accountId) {
                    await applyCashAccountDeltaForTransaction(
                        normalized.accountId,
                        (Number(normalized.amount) || 0) - (Number(prev.amount) || 0)
                    );
                } else {
                    await applyCashAccountDeltaForTransaction(prev.accountId, -(Number(prev.amount) || 0));
                    await applyCashAccountDeltaForTransaction(normalized.accountId, Number(normalized.amount) || 0);
                }
            }
            setData(prevState => ({ ...prevState, transactions: prevState.transactions.map(t => t.id === transaction.id ? normalized : t) }));
            await syncSharedBudgetTransactionMirror(normalized as any);
            auditChangeLog({
                action: 'update',
                entity: 'transaction',
                entityId: transaction.id,
                summary: `${normalized.type}: ${String(normalized.description ?? '').slice(0, 120)}`,
                userId: auth.user.id,
            });
        }
    };
    const deleteTransaction = async (transactionId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const prevTx = data?.transactions?.find((t) => t.id === transactionId);
        const { error } = await db.from('transactions').delete().match({ id: transactionId, user_id: auth.user.id });
        if(error) console.error("Error deleting transaction:", error);
        else {
            await applyCashAccountDeltaForTransaction(prevTx?.accountId, -(Number(prevTx?.amount) || 0));
            setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== transactionId) }));
            await removeSharedBudgetTransactionMirror(transactionId);
            auditChangeLog({
                action: 'delete',
                entity: 'transaction',
                entityId: transactionId,
                summary: prevTx ? `Removed: ${String(prevTx.description ?? '').slice(0, 120)}` : 'Transaction removed',
                userId: auth.user.id,
            });
        }
    };

    // --- Recurring transactions ---
    const addRecurringTransaction = async (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>) => {
        if (!supabase || !auth?.user) return;
        const v = validateRecurringTransaction({ description: recurring.description, amount: recurring.amount, type: recurring.type, accountId: recurring.accountId, category: recurring.category, dayOfMonth: recurring.dayOfMonth });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
            add_manually: recurring.addManually === true,
        };
        const { data: inserted, error } = await db.from('recurring_transactions').insert(withUser(row)).select().single();
        if (error) {
            console.error("Error adding recurring transaction:", error);
            toast(`Failed to add recurring: ${error.message}`, 'error');
            throw error;
        }
        if (inserted) {
            const normalized = normalizeRecurringTransaction(inserted, resolveAccountId((inserted as any).account_id, data?.accounts ?? []) ?? (inserted as any).account_id);
            setData(prev => ({ ...prev, recurringTransactions: [...prev.recurringTransactions, normalized] }));
        }
    };

    const updateRecurringTransaction = async (recurring: RecurringTransaction) => {
        if (!supabase || !auth?.user) return;
        const v = validateRecurringTransaction({ description: recurring.description, amount: recurring.amount, type: recurring.type, accountId: recurring.accountId, category: recurring.category, dayOfMonth: recurring.dayOfMonth });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
            add_manually: recurring.addManually === true,
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
        cashBalanceAccumulatorRef.current = {};
        const enabled = data.recurringTransactions.filter(r => r.enabled && !(r.addManually === true));
        const monthStr = String(month).padStart(2, '0');
        const dayStr = (d: number) => String(d).padStart(2, '0');
        let applied = 0;
        let skipped = 0;
        for (const rule of enabled) {
            const date = `${year}-${monthStr}-${dayStr(rule.dayOfMonth)}`;
            const monthPrefix = `${year}-${monthStr}-`;
            // For EOM rules (dayOfMonth 28), treat any transaction on 28–31 in this month as already applied (matches applyRecurringDueToday which uses effectiveDateStr 28th on days 29–31)
            const already = (data?.transactions ?? []).some(t => {
                const rid = t.recurringId ?? (t as any).recurring_id;
                if (rid !== rule.id) return false;
                if (!t.date.startsWith(monthPrefix)) return false;
                if (rule.dayOfMonth === 28) {
                    const day = parseInt(t.date.slice(8, 10), 10);
                    if (day >= 28) return true;
                }
                return t.date.startsWith(date);
            });
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
        cashBalanceAccumulatorRef.current = {};
        return { applied, skipped };
    };

    /** Apply recurring rules that are due today (dayOfMonth === today) and not addManually. Called after data load, once per day.
     * dayOfMonth is stored clamped to 1–28, so on the 29th/30th/31st we treat dayOfMonth 28 as due (end-of-month); we use effectiveDateStr 28th so duplicates are detected by applyRecurringForMonth. */
    const applyRecurringDueToday = useCallback(async (): Promise<number> => {
        if (!supabase || !auth?.user) return 0;
        cashBalanceAccumulatorRef.current = {};
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        const day = today.getDate();
        const monthStr = String(month).padStart(2, '0');
        const dayStr = (d: number) => String(d).padStart(2, '0');
        // dayOfMonth is clamped to 1–28, so (dayOfMonth > lastDayOfMonth) is never true; only exact match and EOM-28 apply
        const isDueToday = (r: { dayOfMonth: number }) =>
            r.dayOfMonth === day || (day >= 28 && r.dayOfMonth === 28);
        const toApply = data.recurringTransactions.filter(
            r => r.enabled && !(r.addManually === true) && isDueToday(r)
        );
        let applied = 0;
        const todayStr = `${year}-${monthStr}-${dayStr(day)}`;
        const appliedThisRun = new Set<string>();
        for (const rule of toApply) {
            // Use effective due date so we match applyRecurringForMonth: dayOfMonth 28 on 29th–31st → 28th
            const effectiveDateStr = (day >= 28 && rule.dayOfMonth === 28)
                ? `${year}-${monthStr}-28`
                : todayStr;
            const key = `${rule.id}:${effectiveDateStr}`;
            if (appliedThisRun.has(key)) continue;
            const already = (transactionsRef.current ?? []).some(
                t => (t.recurringId ?? (t as any).recurring_id) === rule.id &&
                    t.date.startsWith(effectiveDateStr)
            );
            if (already) continue;
            const amount = rule.type === 'income' ? rule.amount : -rule.amount;
            try {
                await addTransaction({
                    date: effectiveDateStr,
                    description: rule.description,
                    amount,
                    category: rule.category,
                    accountId: rule.accountId,
                    budgetCategory: rule.type === 'expense' ? rule.budgetCategory : undefined,
                    type: rule.type,
                    recurringId: rule.id,
                });
                appliedThisRun.add(key);
                applied++;
            } catch (err) {
                // Re-throw so the effect's .catch() runs and clears the sessionStorage lock, allowing retry later
                throw err;
            }
        }
        cashBalanceAccumulatorRef.current = {};
        return applied;
    }, [data.recurringTransactions, addTransaction, supabase, auth?.user?.id]);

    // Auto-apply recurring transactions due today (dayOfMonth === today, addManually === false), once per calendar day.
    // Intentionally omit data.transactions so the effect does not re-run when we add transactions (avoids effect loop); duplicate check uses transactionsRef.
    useEffect(() => {
        if (loading || !auth?.user || !data.recurringTransactions?.length) return;
        const todayStr = new Date().toDateString();
        const storageKey = `recurring_auto_apply_${auth.user.id}`;
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(storageKey) === todayStr) return;
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(storageKey, todayStr);
        applyRecurringDueToday().catch(() => {
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey);
        });
    }, [loading, auth?.user?.id, data.recurringTransactions, applyRecurringDueToday]);

    // --- Accounts / Platforms ---
    const addPlatform = async (platform: Omit<Account, 'id' | 'user_id' | 'balance'> & { balance?: number }) => {
        if(!supabase || !auth?.user) {
            toast("You must be logged in to add a platform.", 'error');
            return undefined;
        }
        const v = validateAccount({ name: platform.name, type: platform.type, balance: platform.balance ?? 0 });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return undefined;
        }
        const db = supabase;
        const payload = buildAccountInsertPayload(platform);
        let { data: newPlatform, error } = await db.from('accounts').insert(withUser(payload)).select().single();
        if (error && isAccountsCurrencyColumnMissing(error) && 'currency' in payload) {
            const { currency: _omit, ...withoutCurrency } = payload;
            ({ data: newPlatform, error } = await db.from('accounts').insert(withUser(withoutCurrency)).select().single());
            if (!error) {
                console.warn(
                    '[accounts] Saved without currency column. Apply supabase/migrations/add_accounts_currency.sql to persist SAR/USD on accounts.',
                );
            }
        }
        if(error) {
            console.error("Error adding platform:", error);
            toast(`Failed to add platform: ${error.message}`, 'error');
            throw error;
        }
        if (newPlatform) {
            const normalized = normalizeAccount(newPlatform);
            setData(prev => ({ ...prev, accounts: [...prev.accounts, normalized] }));
            return normalized.id;
        }
        return undefined;
    };
    const updatePlatform = async (platform: Account, opts?: { fromTransactionDelta?: boolean }) => {
        if(!supabase || !auth?.user) return;
        const v = validateAccount(
            { name: platform.name, type: platform.type, balance: platform.balance },
            opts?.fromTransactionDelta ? { allowNegativeBalance: true } : undefined
        );
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const db = supabase;

        // Build payload with proper snake_case for DB
        const payload: any = {
            name: platform.name,
            type: platform.type,
            owner: platform.owner,
            balance: platform.balance,
        };
        if (platform.currency === 'SAR' || platform.currency === 'USD') {
            payload.currency = platform.currency;
        }

        // Always sync linkedAccountIds to linked_account_ids in DB
        if (Array.isArray(platform.linkedAccountIds)) {
            payload.linked_account_ids = platform.linkedAccountIds;
        } else {
            payload.linked_account_ids = [];
        }
        
        // Handle platform details if present
        if (platform.platformDetails) {
            payload.platform_details = platform.platformDetails;
        }
        
        let { error } = await db.from('accounts').update(payload).match({ id: platform.id, user_id: auth.user.id });
        if (error && isAccountsCurrencyColumnMissing(error) && 'currency' in payload) {
            const { currency: _omit, ...withoutCurrency } = payload;
            ({ error } = await db.from('accounts').update(withoutCurrency).match({ id: platform.id, user_id: auth.user.id }));
            if (!error) {
                console.warn(
                    '[accounts] Updated without currency column. Apply supabase/migrations/add_accounts_currency.sql to persist SAR/USD on accounts.',
                );
            }
        }
        if(error) {
            console.error("Error updating platform:", error);
            toast(`Failed to update platform: ${error.message}`, 'error');
        } else {
            if (!opts?.fromTransactionDelta) delete cashBalanceAccumulatorRef.current[platform.id]; // Manual edit overrides; transaction-driven updates keep accumulator for next iteration
            const normalized = normalizeAccount({ ...platform, ...payload, linkedAccountIds: payload.linked_account_ids });
            setData(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === platform.id ? normalized : a) }));
        }
    };
    updatePlatformRef.current = updatePlatform;
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
            toast("You must be logged in to add a portfolio.", 'error');
            return;
        }
        const v = validatePortfolio({ name: portfolio.name, accountId: portfolio.accountId });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const row = investmentPortfolioToRow(portfolio);
        const { data: newPortfolio, error } = await db.from('investment_portfolios').insert(withUser(row)).select().single();
        if(error) {
            console.error("Error adding portfolio:", error);
            toast(`Failed to add portfolio: ${error.message}`, 'error');
            throw error;
        }
        if (newPortfolio) {
            const np = newPortfolio as any;
            setData((prev) => ({
                ...prev,
                investments: [
                    ...prev.investments,
                    {
                        ...np,
                        accountId: np.account_id ?? np.accountId,
                        goalId: np.goal_id ?? np.goalId,
                        holdings: [],
                    },
                ],
            }));
        }
    };
    const updatePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'holdings'>) => {
        if(!supabase || !auth?.user) return;
        const v = validatePortfolio({ name: portfolio.name, accountId: portfolio.accountId });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        const v = validateHolding({
            symbol: holding.symbol,
            quantity: holding.quantity,
            avgCost: holding.avgCost,
            currentValue: holding.currentValue,
            portfolio_id: holding.portfolio_id,
            portfolioId: (holding as any).portfolioId,
            holdingType: holding.holdingType,
        });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
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
        const v = validateHolding({
            symbol: holding.symbol,
            quantity: holding.quantity,
            avgCost: holding.avgCost,
            currentValue: holding.currentValue,
            portfolio_id: holding.portfolio_id,
            portfolioId: (holding as any).portfolioId,
            holdingType: holding.holdingType,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
    const recordTrade = async (
        trade: { portfolioId?: string, name?: string, manualCurrentValue?: number, holdingType?: string, transferGroupId?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number },
        executedPlanId?: string,
    ) => {
        if (!supabase || !auth?.user) return;
        if (tradeSubmissionInFlightRef.current) {
            throw new Error('A trade submission is already in progress. Please wait.');
        }
        const isCashFlow = trade.type === 'deposit' || trade.type === 'withdrawal';
        const tradeVal = validateTrade({
            type: trade.type,
            quantity: trade.quantity,
            price: trade.price,
            total: trade.total,
            symbol: trade.symbol,
            date: trade.date,
        });
        if (!tradeVal.valid) {
            throw new Error(tradeVal.errors.join('\n'));
        }

        tradeSubmissionInFlightRef.current = true;
        try {
            const { portfolioId, name, assetClass: tradeAssetClass, manualCurrentValue: manualCvInput, holdingType: incomingHoldingType, fees: feesInput, ...tradeData } = trade as typeof trade & {
                assetClass?: string;
                manualCurrentValue?: number;
                holdingType?: string;
                fees?: number;
            };
            const feesRecorded =
                typeof feesInput === 'number' && Number.isFinite(feesInput) ? Math.max(0, roundMoney(feesInput)) : 0;
            const manualCv =
                typeof manualCvInput === 'number' && Number.isFinite(manualCvInput) && manualCvInput >= 0
                    ? roundMoney(manualCvInput)
                    : undefined;

        let accountIdForInsert: string;
        let portfolio: InvestmentPortfolio | undefined;
        let existingHolding: Holding | undefined;
        let symbolHoldingsForTrade: Holding[] = [];
        let normalizedSymbol: string;

        let investmentAccount: Account | undefined;
        if (isCashFlow) {
            accountIdForInsert = resolveAccountId(trade.accountId, data?.accounts ?? []) ?? trade.accountId;
            if (!accountIdForInsert) throw new Error("Please select the platform (account).");
            investmentAccount = (data?.accounts ?? []).find((a: Account) => a.id === accountIdForInsert);
            if (!investmentAccount) throw new Error("Selected account is not in the system.");
            if (investmentAccount.type !== 'Investment') throw new Error("Selected account must be an Investment platform.");
            
            // Validate linked cash account if platform has linked accounts
            const linkedCashAccountId = (trade as any).linkedCashAccountId;
            if (investmentAccount.linkedAccountIds && investmentAccount.linkedAccountIds.length > 0) {
                if (!linkedCashAccountId) {
                    throw new Error(trade.type === 'deposit' 
                        ? "Please select the cash account this deposit came from."
                        : "Please select the cash account this withdrawal goes to.");
                }
                if (!investmentAccount.linkedAccountIds.includes(linkedCashAccountId)) {
                    throw new Error("Selected cash account is not linked to this platform. Please select a linked account or update the platform's linked accounts.");
                }
            }
            
            normalizedSymbol = 'CASH';
        } else {
            portfolio = (data?.investments ?? []).find(p => p.id === portfolioId);
            if (!portfolio) throw new Error("Portfolio not found");
            
            // Validate that portfolio belongs to the selected account
            const portfolioAccountId = resolveAccountId(portfolio.accountId || (portfolio as any).account_id, data?.accounts ?? []);
            const tradeAccountId = resolveAccountId(trade.accountId, data?.accounts ?? []) ?? trade.accountId;
            
            if (tradeAccountId && portfolioAccountId && tradeAccountId !== portfolioAccountId) {
                throw new Error(`Portfolio "${portfolio.name}" belongs to a different platform. Please select the correct platform for this portfolio.`);
            }
            
            normalizedSymbol = (tradeData.symbol || '').trim().toUpperCase();
            symbolHoldingsForTrade = portfolio.holdings.filter((h: Holding) => (h.symbol || '').trim().toUpperCase() === normalizedSymbol);
            existingHolding = consolidateHoldingsBySymbol(symbolHoldingsForTrade) ?? undefined;
            if (tradeData.type === 'sell') {
                if (!existingHolding) throw new Error("Cannot sell a holding you don't own.");
                if (existingHolding.quantity < tradeData.quantity) throw new Error("Not enough shares to sell.");
            }
            accountIdForInsert = portfolioAccountId ?? tradeAccountId;
            if (!accountIdForInsert) throw new Error("Account not found for this portfolio. Please refresh the page and try again.");
            const accountExists = (data?.accounts ?? []).some((a: Account) => a.id === accountIdForInsert);
            if (!accountExists) throw new Error("Selected account is not in the system (or portfolio points to a deleted account).");
            if ((tradeData.type === 'buy' || tradeData.type === 'sell') && !(tradeData.quantity > 0)) {
                throw new Error('Trade quantity must be greater than zero.');
            }
        }

        // 2. Validate cash ledger limits before writing the transaction.
        const basisNotional = tradeData.quantity * tradeData.price;
        const tradeTotal = isCashFlow
            ? (trade.total ?? 0)
            : tradeData.type === 'dividend'
              ? roundMoney(Math.max(0, Number(trade.total) || 0))
              : tradeData.type === 'buy'
                ? basisNotional + feesRecorded
                : tradeData.type === 'sell'
                  ? Math.max(0, basisNotional - feesRecorded)
                  : basisNotional;
        if (!isCashFlow && tradeData.type === 'sell' && feesRecorded > basisNotional + 1e-9) {
            throw new Error('Fees cannot exceed gross sale proceeds (quantity × price).');
        }
        /** Buys/sells are always booked in the portfolio base currency so SAR/USD buckets match holdings. */
        let portfolioLedgerCurrency: TradeCurrency | undefined;
        if (!isCashFlow && portfolio) {
            const pc = portfolio.currency as string | undefined;
            portfolioLedgerCurrency = pc === 'SAR' || pc === 'USD' ? (pc as TradeCurrency) : 'USD';
        }
        const txCurrency: TradeCurrency =
            portfolioLedgerCurrency ??
            ((trade.currency === 'SAR' || trade.currency === 'USD')
                ? trade.currency
                : inferInvestmentTransactionCurrency(
                    { accountId: accountIdForInsert, currency: trade.currency as TradeCurrency | undefined },
                    data?.accounts ?? [],
                    data?.investments ?? [],
                ));
        const availableBefore = getAvailableCashForAccount(accountIdForInsert);
        const sarPerUsd = resolveSarPerUsd(data ?? null);
        const availableInTxCurrency = availableTradableCashInLedgerCurrency(availableBefore, txCurrency, sarPerUsd);
        if (tradeData.type === 'buy' && tradeTotal > availableInTxCurrency + 1e-9) {
            throw new Error(
                `Insufficient investment cash. Needed ${roundMoney(tradeTotal).toLocaleString()} ${txCurrency}, available ${roundMoney(availableInTxCurrency).toLocaleString()} ${txCurrency} (pooled from ${roundMoney(availableBefore.SAR).toLocaleString()} SAR + ${roundMoney(availableBefore.USD).toLocaleString()} USD). Transfer funds from Checking/Savings first.`,
            );
        }
        if (tradeData.type === 'dividend' && tradeTotal <= 0) {
            throw new Error('Dividend amount must be greater than zero.');
        }
        if (tradeData.type === 'withdrawal' && tradeTotal > availableInTxCurrency + 1e-9) {
            throw new Error(
                `Cannot withdraw ${roundMoney(tradeTotal).toLocaleString()} ${txCurrency}. Available cash is ${roundMoney(availableInTxCurrency).toLocaleString()} ${txCurrency} (pooled from ${roundMoney(availableBefore.SAR).toLocaleString()} SAR + ${roundMoney(availableBefore.USD).toLocaleString()} USD).`,
            );
        }

        // 3. Log the transaction to the database
        let newTransaction: any = null;
        let txError: any = null;
        const linkedCashAccountId = (trade as any).linkedCashAccountId;
        const tradePayload: any = {
            ...tradeData,
            accountId: accountIdForInsert,
            symbol: normalizedSymbol,
            quantity: isCashFlow ? 0 : tradeData.quantity,
            price: isCashFlow ? 0 : tradeData.price,
            total: tradeTotal,
        };
        if (portfolioLedgerCurrency) {
            tradePayload.currency = portfolioLedgerCurrency;
        }
        if (linkedCashAccountId) {
            tradePayload.linked_cash_account_id = linkedCashAccountId;
        }
        if (isCashFlow && !(tradePayload.currency === 'SAR' || tradePayload.currency === 'USD')) {
            const cashAcc = linkedCashAccountId
                ? (data?.accounts ?? []).find((a: Account) => a.id === linkedCashAccountId)
                : undefined;
            if (cashAcc && (cashAcc.type === 'Checking' || cashAcc.type === 'Savings')) {
                tradePayload.currency = resolveCashAccountCurrency(cashAcc, data);
            } else {
                const pf = (data?.investments ?? []).find(
                    (p) => resolveAccountId(p.accountId || (p as { account_id?: string }).account_id, data?.accounts ?? []) === accountIdForInsert,
                );
                const pc = pf?.currency as string | undefined;
                tradePayload.currency = pc === 'SAR' || pc === 'USD' ? pc : 'SAR';
            }
        }
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
        
        // 3. For deposits/withdrawals with linked accounts, create corresponding cash account transactions
        if (isCashFlow && linkedCashAccountId && investmentAccount) {
            try {
                const cashAccount = (data?.accounts ?? []).find((a: Account) => a.id === linkedCashAccountId);
                if (cashAccount) {
                    const description = trade.type === 'deposit' 
                        ? `Transfer to ${investmentAccount.name}`
                        : `Transfer from ${investmentAccount.name}`;
                    const amount = trade.type === 'deposit' 
                        ? -Math.abs(tradeTotal) // Negative (expense from cash account)
                        : Math.abs(tradeTotal); // Positive (income to cash account)
                    
                    // Create the transaction in the cash account
                    await addTransaction({
                        date: trade.date,
                        description,
                        amount,
                        category: 'Transfer',
                        type: trade.type === 'deposit' ? 'expense' : 'income',
                        accountId: linkedCashAccountId,
                        transferGroupId: (trade as any).transferGroupId,
                        transferRole: trade.type === 'deposit' ? 'principal_out' : 'principal_in',
                    });
                }
            } catch (cashTxError) {
                console.warn("Failed to create corresponding cash account transaction:", cashTxError);
                // Don't fail the investment transaction if cash transaction fails
            }
        }

        // 3. Process trade logic (skip for deposit/withdrawal / dividend — dividend only updates ledger cash)
        if (isCashFlow) {
            tradeSubmissionInFlightRef.current = false;
            return;
        }

        if (tradeData.type === 'dividend') {
            tradeSubmissionInFlightRef.current = false;
            return;
        }

        try {
            if (!portfolio) throw new Error('Portfolio not found');
            if (symbolHoldingsForTrade.length > 1 && existingHolding) {
                await updateHolding(existingHolding);
                for (const duplicateHolding of symbolHoldingsForTrade.slice(1)) {
                    await deleteHolding(duplicateHolding.id);
                }
            }
            
            if (tradeData.type === 'buy') {
                const qAdd = tradeData.quantity;
                const px = tradeData.price;
                const newManualFund = incomingHoldingType === 'manual_fund';
                if (newManualFund && !existingHolding && (manualCv == null || manualCv <= 0)) {
                    throw new Error('For manual valuation, enter the current position value (e.g. Mashora balance, retirement account value).');
                }
                if (existingHolding && qAdd > 0) {
                    const merged =
                        existingHolding.holdingType === 'manual_fund'
                            ? applyBuyToHolding(existingHolding, qAdd, px, {
                                  currentValueAdd: manualCv ?? qAdd * px,
                              })
                            : applyBuyToHolding(existingHolding, qAdd, px);
                    await updateHolding({
                        ...existingHolding,
                        name: name || existingHolding.name || tradeData.symbol,
                        quantity: merged.quantity,
                        avgCost: merged.avgCost,
                        currentValue: merged.currentValue,
                    });
                } else {
                    const resolvedClass = (normalizeAssetClassForDb(tradeAssetClass) ?? 'Stock') as HoldingAssetClass;
                    const newHoldingData: Omit<Holding, 'id' | 'user_id'> = {
                        portfolio_id: portfolio.id,
                        symbol: tradeData.symbol,
                        name: name || tradeData.symbol,
                        quantity: qAdd,
                        avgCost: px,
                        currentValue: newManualFund && manualCv != null ? manualCv : px * qAdd,
                        assetClass: resolvedClass,
                        zakahClass: 'Zakatable' as const,
                        realizedPnL: 0,
                        holdingType: newManualFund ? 'manual_fund' : 'ticker',
                    };
                    await addHolding(newHoldingData);
                }
            } else if (tradeData.type === 'sell') {
                if (!existingHolding) throw new Error("Cannot sell a holding you don't own.");
                const holdingForSell = existingHolding;
                const newQuantity = holdingForSell.quantity - tradeData.quantity;
                const realizedGain = (tradeData.price - holdingForSell.avgCost) * tradeData.quantity;
                const newRealizedPnL = holdingForSell.realizedPnL + realizedGain;

                if (newQuantity > HOLDING_QUANTITY_EPSILON) { // Use a small epsilon for floating point comparison
                    await updateHolding({ ...holdingForSell, quantity: newQuantity, realizedPnL: newRealizedPnL });
                } else {
                    await deleteHolding(holdingForSell.id);
                }
            } else {
                throw new Error(`Unsupported trade type for holding update: ${tradeData.type}`);
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
            const plan = (data?.plannedTrades ?? []).find(p => p.id === executedPlanId);
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
        const v = validatePlannedTrade({ symbol: plan.symbol, name: plan.name, tradeType: plan.tradeType, conditionType: plan.conditionType, targetValue: plan.targetValue, quantity: plan.quantity, amount: plan.amount, priority: plan.priority });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const { data: newPlan, error } = await supabase.from('planned_trades').insert(withUser(plan)).select().single();
        if (error) { console.error(error); }
        else if (newPlan) { setData(prev => ({ ...prev, plannedTrades: [...prev.plannedTrades, newPlan] })); }
    };
    const updatePlannedTrade = async (plan: PlannedTrade) => {
        if(!supabase || !auth?.user) return;
        const v = validatePlannedTrade({ symbol: plan.symbol, name: plan.name, tradeType: plan.tradeType, conditionType: plan.conditionType, targetValue: plan.targetValue, quantity: plan.quantity, amount: plan.amount, priority: plan.priority });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        const v = validateCommodityHolding({ name: holding.name, quantity: holding.quantity, purchaseValue: holding.purchaseValue, currentValue: holding.currentValue, symbol: holding.symbol });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        const v = validateCommodityHolding({ name: holding.name, quantity: holding.quantity, purchaseValue: holding.purchaseValue, currentValue: holding.currentValue, symbol: holding.symbol });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        const db = supabase;
        // Update only existing rows by id/user_id. Avoid upsert so we never attempt inserts
        // that violate NOT NULL columns such as `name` when stale ids appear during refresh cycles.
        const safeUpdates = updates.filter(u => !!u.id);
        const results = await Promise.all(
            safeUpdates.map(u =>
                db
                    .from('commodity_holdings')
                    .update({ current_value: u.currentValue })
                    .match({ id: u.id, user_id: auth.user!.id })
            )
        );
        const failed = results.find(r => r.error);
        if (failed?.error) {
            console.error("Error batch updating commodity values:", failed.error);
            return;
        }
        setData(prevData => {
            const updatesMap = new Map(safeUpdates.map(u => [u.id, u.currentValue]));
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
        if (!supabase || !auth?.user) {
            console.error('Supabase client not available or user not authenticated');
            toast('You must be logged in to manage your watchlist.', 'error');
            return;
        }
        const v = validateWatchlistItem({ symbol: item.symbol });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const symbol = String(item.symbol || '').trim().toUpperCase();
        if ((data?.watchlist ?? []).some((w) => String(w.symbol || '').trim().toUpperCase() === symbol)) {
            toast(`${symbol} is already in your watchlist.`, 'info');
            return;
        }
        const row = withUser({ ...item, symbol, name: String(item.name || symbol).trim() || symbol });
        const { data: inserted, error } = await db.from('watchlist').upsert(row, { onConflict: 'user_id,symbol' }).select().single();
        if (error) {
            console.error('Error adding watchlist item:', error);
            toast(`Failed to add ${symbol} to watchlist: ${error.message}`, 'error');
            return;
        }
        if (inserted) {
            const normalized: WatchlistItem = {
                user_id: inserted.user_id ?? auth.user.id,
                symbol: String(inserted.symbol ?? symbol).toUpperCase(),
                name: String(inserted.name ?? item.name ?? '').trim() || String(inserted.symbol ?? symbol).toUpperCase(),
            };
            setData(prev => ({
                ...prev,
                watchlist: prev.watchlist.some((w) => String(w.symbol || '').toUpperCase() === normalized.symbol)
                    ? prev.watchlist.map((w) => (String(w.symbol || '').toUpperCase() === normalized.symbol ? normalized : w))
                    : [...prev.watchlist, normalized],
            }));
        }
    };
    const deleteWatchlistItem = async (symbol: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        await db.from('watchlist').delete().match({ user_id: auth.user.id, symbol });
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    };
    const addPriceAlert = async (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>) => {
        if(!supabase) return;
        const v = validatePriceAlert({ symbol: alert.symbol, targetPrice: alert.targetPrice });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        if (alert.targetPrice != null) {
            const v = validatePriceAlert({ symbol: alert.symbol, targetPrice: alert.targetPrice });
            if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        }
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
        const v = validateZakatPayment({ date: payment.date, amount: payment.amount });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const { data: newPayment, error } = await db.from('zakat_payments').insert(withUser(payment)).select().single();
        if(error) console.error(error);
        else if(newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };
    const updateSettings = async (settingsUpdate: Partial<Settings>) => {
        if (!supabase || !auth?.user) return;
        const merged = { ...(data?.settings ?? {}), ...settingsUpdate };
        const toValidate: Partial<Settings> = {};
        if ('goldPrice' in settingsUpdate) toValidate.goldPrice = merged.goldPrice ?? (merged as any).gold_price;
        if ('nisabAmount' in settingsUpdate) toValidate.nisabAmount = merged.nisabAmount ?? (merged as any).nisab_amount;
        if ('budgetThreshold' in settingsUpdate) toValidate.budgetThreshold = merged.budgetThreshold;
        if ('driftThreshold' in settingsUpdate) toValidate.driftThreshold = merged.driftThreshold;
        if ('riskProfile' in settingsUpdate) toValidate.riskProfile = merged.riskProfile;
        const v = validateSettings(toValidate);
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const overrides = settingsOverridesToRow(merged, settingsUpdate);
        const row = { ...overrides, user_id: auth.user.id };
        const { error } = await supabase.from('settings').upsert([row], { onConflict: 'user_id' });
        if (error) {
            console.error("Error updating settings:", error);
        } else {
            setData(prev => ({ ...prev, settings: merged }));
        }
    };

    const saveInvestmentPlan = async (plan: InvestmentPlanSettings, portfolioId?: string) => {
        if (!supabase || !auth?.user) return;
        const mergedPlan: InvestmentPlanSettings =
            portfolioId && data?.investmentPlan
                ? {
                      ...data.investmentPlan,
                      plansByPortfolioId: {
                          ...(data.investmentPlan.plansByPortfolioId ?? {}),
                          [portfolioId]: toPlanSlice(stripNestedPlans(plan)),
                      },
                  }
                : plan;
        const v = validateInvestmentPlan({
            monthlyBudget: mergedPlan.monthlyBudget,
            coreAllocation: mergedPlan.coreAllocation,
            upsideAllocation: mergedPlan.upsideAllocation,
            minimumUpsidePercentage: mergedPlan.minimumUpsidePercentage,
            stale_days: mergedPlan.stale_days,
            min_coverage_threshold: mergedPlan.min_coverage_threshold,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const overrides = investmentPlanOverridesToRow(mergedPlan);
        const planWithUser = { ...overrides, user_id: auth.user.id };
        const planStamped: InvestmentPlanSettings = {
            ...mergedPlan,
            fxRateUpdatedAt: new Date().toISOString(),
        };
        const overridesStamped = investmentPlanOverridesToRow(planStamped);
        const planWithUserStamped = { ...overridesStamped, user_id: auth.user.id };
        const { error } = await supabase.from('investment_plan').upsert(planWithUserStamped, { onConflict: 'user_id' });
        if (error) {
            console.warn("investment_plan upsert (with fx_rate_updated_at):", error.message);
            const { error: err2 } = await supabase.from('investment_plan').upsert(planWithUser, { onConflict: 'user_id' });
            if (err2) {
                console.error("Error saving investment plan:", err2);
                throw new Error(err2.message || 'Failed to save plan');
            }
        }
        setData(prev => ({ ...prev, investmentPlan: planStamped }));
        try {
            if (typeof window !== 'undefined' && auth.user.id) {
                localStorage.setItem(`finova_fx_plan_confirmed_${auth.user.id}`, new Date().toISOString());
            }
        } catch {}
    };

    const addUniverseTicker = async (ticker: Omit<UniverseTicker, 'id' | 'user_id'>) => {
        if (!supabase) return;
        const v = validateUniverseTicker({ ticker: ticker.ticker, name: ticker.name, status: ticker.status });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const { portfolioId: universePortfolioId, ...tickerRest } = ticker;
        const { data: newTicker, error } = await supabase
            .from('portfolio_universe')
            .insert(
                withUser({
                    ...tickerRest,
                    portfolio_id: universePortfolioId ?? null,
                } as Record<string, unknown>),
            )
            .select()
            .single();
        if (error) {
            console.error("Error adding ticker:", error);
        } else if (newTicker) {
            setData(prev => ({ ...prev, portfolioUniverse: [...prev.portfolioUniverse, normalizeUniverseTicker(newTicker)] }));
        }
    };

    const updateUniverseTickerStatus = async (tickerId: string, status: TickerStatus, updates: Partial<UniverseTicker> = {}) => {
        if (!supabase || !auth?.user) return;
        const v = validateTickerStatus(status);
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const ticker = (data?.portfolioUniverse ?? []).find(t => t.id === tickerId);
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
        const v = validateExecutionLog({
            date: log.date,
            totalInvestment: log.totalInvestment,
            status: log.status,
            trades: log.trades,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
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
        const map: Record<string, { SAR: number; USD: number }> = {};
        (data?.accounts ?? []).forEach((acc: Account) => {
            if (acc.type !== 'Investment') return;
            const accId = resolveCanonicalAccountId(acc.id, data?.accounts ?? []) ?? acc.id;
            if (!accId) return;
            if (!(accId in map)) map[accId] = { SAR: 0, USD: 0 };
            const openingBalance = Math.max(0, Number(acc.balance ?? 0));
            if (!Number.isFinite(openingBalance) || openingBalance <= 0) return;
            const baseCur: TradeCurrency = acc.currency === 'USD' ? 'USD' : 'SAR';
            map[accId][baseCur] += openingBalance;
        });
        (data.investmentTransactions || []).forEach((t: InvestmentTransaction) => {
            const portfolioId = t.portfolioId ?? (t as any).portfolio_id;
            const linkedPortfolio: any = portfolioId ? (data?.investments ?? []).find((p: any) => p.id === portfolioId) : undefined;
            const fallbackPortfolioAccount = portfolioId
                ? resolveAccountId(
                      linkedPortfolio?.accountId ?? linkedPortfolio?.account_id,
                      data?.accounts ?? [],
                  )
                : undefined;
            const raw = t.accountId ?? (t as any).account_id ?? fallbackPortfolioAccount;
            if (!raw) return;
            const accId = resolveCanonicalAccountId(String(raw), data?.accounts ?? []);
            if (!accId) return;
            if (!(accId in map)) map[accId] = { SAR: 0, USD: 0 };
            const amt = Number(t.total ?? 0);
            if (!Number.isFinite(amt)) return;
            const cur = inferInvestmentTransactionCurrency(t, data?.accounts ?? [], data?.investments ?? []);
            const txType = String(t.type ?? '').toLowerCase();
            const delta = txType === 'deposit' || txType === 'sell' || txType === 'dividend'
                ? amt
                : (txType === 'withdrawal' || txType === 'buy' ? -amt : 0);
            map[accId][cur] += delta;
        });
        Object.keys(map).forEach(accId => {
            map[accId].SAR = Math.max(0, map[accId].SAR);
            map[accId].USD = Math.max(0, map[accId].USD);
        });
        return map;
    }, [data?.investmentTransactions, data?.accounts, data?.investments]);

    const getAvailableCashForAccount = useCallback((accountId: string): { SAR: number; USD: number } => {
        const canonical = resolveCanonicalAccountId(accountId, data?.accounts ?? []) ?? accountId;
        const v = availableCashByAccountId[canonical] ?? { SAR: 0, USD: 0 };
        return { SAR: v.SAR, USD: v.USD };
    }, [availableCashByAccountId, data?.accounts]);

    /**
     * Personal wealth slices must use the getters — not a raw merge from getPersonalWealthData.
     * Otherwise `personalInvestments: []` (all portfolios have an owner) overwrites `investments` for
     * consumers that read `personalInvestments` first, and `??` does not fall back (empty array is not nullish).
     */
    const dataWithPersonal = useMemo(() => {
        if (!data) return data;
        return {
            ...data,
            personalAccounts: getPersonalAccounts(data),
            personalAssets: getPersonalAssets(data),
            personalLiabilities: getPersonalLiabilities(data),
            personalInvestments: getPersonalInvestments(data),
            personalCommodityHoldings: getPersonalCommodityHoldings(data),
            personalTransactions: getPersonalTransactions(data),
        };
    }, [data]);

    const accountsForDeployable = useMemo((): Account[] => {
        const d = dataWithPersonal as FinancialData & { personalAccounts?: Account[] };
        return (d.personalAccounts ?? d.accounts ?? EMPTY_ACCOUNTS_FOR_DEPLOY) as Account[];
    }, [dataWithPersonal]);

    const totalDeployableCash = useMemo(() => {
        const sarPerUsd = resolveSarPerUsd(data as FinancialData);
        const bank = accountsForDeployable.filter((a: Account) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: Account) => s + Math.max(0, a.balance ?? 0), 0);
        const platformCash = accountsForDeployable.filter((a: Account) => a.type === 'Investment').reduce((s: number, a: Account) => {
            const cash = getAvailableCashForAccount(a.id);
            return s + tradableCashBucketToSAR(cash, sarPerUsd);
        }, 0);
        return bank + platformCash;
    }, [accountsForDeployable, getAvailableCashForAccount, data]);

    // Auto-heal legacy duplicate holdings (same portfolio + symbol) once per unique snapshot.
    useEffect(() => {
        if (loading || !auth?.user || duplicateHoldingsReconcileInFlightRef.current) return;
        const duplicateGroups: Holding[][] = [];
        (data.investments ?? []).forEach((portfolio: InvestmentPortfolio) => {
            const bySymbol = new Map<string, Holding[]>();
            (portfolio.holdings ?? []).forEach((h: Holding) => {
                const key = String(h.symbol ?? '').trim().toUpperCase();
                if (!key) return;
                const list = bySymbol.get(key) ?? [];
                list.push(h);
                bySymbol.set(key, list);
            });
            bySymbol.forEach((list) => {
                if (list.length > 1) duplicateGroups.push(list);
            });
        });
        if (!duplicateGroups.length) return;
        const signature = duplicateGroups
            .map((list) => list.map((h) => h.id).sort().join(','))
            .sort()
            .join('|');
        if (!signature || signature === duplicateHoldingsLastSignatureRef.current) return;

        duplicateHoldingsReconcileInFlightRef.current = true;
        (async () => {
            try {
                for (const group of duplicateGroups) {
                    const merged = consolidateHoldingsBySymbol(group);
                    if (!merged) continue;
                    await updateHolding(merged);
                    for (const dup of group.slice(1)) {
                        await deleteHolding(dup.id);
                    }
                }
                duplicateHoldingsLastSignatureRef.current = signature;
            } catch (error) {
                console.warn('Duplicate holdings reconciliation skipped due to error:', error);
            } finally {
                duplicateHoldingsReconcileInFlightRef.current = false;
            }
        })();
    }, [loading, auth?.user?.id, data.investments]);

    const value = { data: dataWithPersonal, loading, dataResetKey, allTransactions: data?.transactions ?? [], allBudgets: data?.budgets ?? [], addAsset, updateAsset, deleteAsset, addGoal, updateGoal, deleteGoal, updateGoalAllocations, addLiability, updateLiability, deleteLiability, addBudget, updateBudget, deleteBudget, copyBudgetsFromPreviousMonth, addTransaction, updateTransaction, deleteTransaction, addTransfer, addRecurringTransaction, updateRecurringTransaction, deleteRecurringTransaction, applyRecurringForMonth, applyRecurringDueToday, addPlatform, updatePlatform, deletePlatform, addPortfolio, updatePortfolio, deletePortfolio, addHolding, updateHolding, batchUpdateHoldingValues, recordTrade, addWatchlistItem, deleteWatchlistItem, addZakatPayment, addPriceAlert, updatePriceAlert, deletePriceAlert, addPlannedTrade, updatePlannedTrade, deletePlannedTrade, addCommodityHolding, updateCommodityHolding, deleteCommodityHolding, batchUpdateCommodityHoldingValues, updateSettings, resetData, loadDemoData, restoreFromBackup, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog, getAvailableCashForAccount, totalDeployableCash };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
