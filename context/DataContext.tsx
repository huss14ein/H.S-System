import React, { createContext, useState, ReactNode, useEffect, useLayoutEffect, useContext, useRef, useMemo, useCallback, startTransition, useDeferredValue } from 'react';
import { flushSync } from 'react-dom';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { FinancialData, Asset, Goal, Liability, Budget, Holding, InvestmentTransaction, WatchlistItem, Account, Transaction, ZakatPayment, InvestmentPortfolio, PriceAlert, PlannedTrade, CommodityHolding, Settings, InvestmentPlanSettings, UniverseTicker, TickerStatus, InvestmentPlanExecutionLog, SleeveDefinition, RecurringTransaction, HOLDING_ASSET_CLASS_OPTIONS, type HoldingAssetClass, type TradeCurrency, type SukukPayoutSchedule, type SukukPayoutEvent, type SukukPosition, type CorporateActionEvent } from '../types';
import { getDefaultWealthUltraSystemConfig, mergeWealthUltraSystemConfigFromRow } from '../wealth-ultra/config';
import {
  getPersonalAccounts,
  getPersonalAssets,
  getPersonalCommodityHoldings,
  getPersonalSukukPositions,
  getPersonalInvestments,
  getPersonalLiabilities,
  getPersonalTransactions,
} from '../utils/wealthScope';
import { resolveSarPerUsd, toSAR, fromSAR, availableTradableCashInLedgerCurrency, DEFAULT_SAR_PER_USD } from '../utils/currencyMath';
import {
    inferInvestmentTransactionCurrency,
    ledgerCurrencyCashToInvestment,
    ledgerCurrencyInvestmentToCash,
    resolveCanonicalAccountId,
    resolveCashAccountCurrency,
} from '../utils/investmentLedgerCurrency';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { formatUnknownError } from '../utils/formatUnknownError';
import { buildInvestmentTradeInsertVariants } from '../services/investmentTradeInsertPayload';
import { stampInvestmentTradeIdentity } from '../services/investmentTradeIdentity';
import { auditChangeLog } from '../services/auditLog';
import { toast } from './ToastContext';
import { validateAccount, validateGoal, validateHolding, validateTrade, validateTransactionCore, validateSettings, validateBackup, validateLiability, validateCommodityHolding, validateBudget, validateAsset, validatePlannedTrade, validateUniverseTicker, validatePortfolio, validateRecurringTransaction, validatePriceAlert, validateZakatPayment, validateWatchlistItem, validateGoalAllocation, validateTickerStatus, validateInvestmentPlan, validateExecutionLog, validateSukukPosition } from '../services/dataQuality/validation';
import { normalizeSukukPositionRow, sukukPositionToRow } from '../services/sukuk/sukukPositionDb';
import { normalizeSukukPayoutScheduleRow, normalizeSukukPayoutEventRow, sukukPayoutScheduleToRow, sukukPayoutEventToRow } from '../services/sukuk/sukukPayoutDb';
import { saveSukukPayoutScheduleToDb } from '../services/sukuk/sukukPayoutScheduleSave';
import { applyPrincipalPaymentToSukukPosition, buildMaturityPrincipalEventDraft, sukukPayoutInvestmentSymbol } from '../services/sukuk/sukukPayoutLifecycle';
import { assertDividendNotDuplicate, validateDividendRecordInput } from '../services/dividendLedgerGuards';
import type { CorporateAction } from '../services/corporateActions';
import {
  buildCorporateActionEventPayload,
  buildReverseCorporateAction,
  computeCashInLieuDepositSar,
  corporateActionCashDepositIdempotencyKey,
  corporateActionCashDepositIdempotencyKeysForEvent,
  corporateActionDepositsCash,
  corporateActionFromEvent,
  normalizeCorporateActionEventRow,
  validateCorporateActionApplyPrerequisites,
} from '../services/corporateActionApply';
import { adjustQuotesForCorporateActionNow } from '../utils/corporateActionQuoteBridge';
import { normalizeInvestmentCostLotRow } from '../services/investmentCostLotDb';
import {
    rebuildHoldingsFromLedger,
    syncLotsAfterTrade,
    syncPortfolioLedgerAfterChange,
} from '../services/portfolioLedgerSync';
import {
    filterTransactionsForPortfolio,
    filterTransactionsForPortfolioReplay,
    hasPositionAffectingTransactions,
} from '../services/portfolioTransactionScope';
import {
    assertDividendUpdateNotDuplicate,
    computeInvestmentTxCashDelta,
    investmentTransactionToRow,
    netBalanceDeltaForInvestmentTxUpdate,
    validateDividendTransactionUpdate,
} from '../services/investmentTransactionLedger';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';
import { parseSplitsFromNote } from '../services/transactionSplitNote';
import { resolveDuplicateHoldingsGroup } from '../services/holdingsDedupe';
import { applyPositionDeltaForTrade } from '../services/applyPositionDeltaForTrade';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';
import { normalizeCoreUpsideAllocations } from '../utils/investmentPlanAllocations';
import { normalizePlanSlice, stripNestedPlans, toPlanSlice } from '../utils/investmentPlanPerPortfolio';
import { financialDataHasHydrated } from '../services/financialDataHydration';
import {
    clearWorkspaceHydrateCache,
    readWorkspaceHydrateCache,
    writeWorkspaceHydrateCache,
} from '../services/workspaceHydrateCache';
import {
    FAST_HYDRATE_INDICES,
    HEAVY_HYDRATE_INDICES,
    HYDRATE_FETCH_KEYS,
    HYDRATE_SECONDARY_START_INDEX,
} from '../services/workspaceHydrateTiers';
import { pauseBackgroundWork } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';
import { mergeNetWorthSnapshotsFromServer } from '../services/netWorthSnapshot';
import { deltaForInvestmentTrade } from '../services/investmentBalanceDelta';
import { buildTransactionPayloadVariants } from '../services/transactionPayloadVariants';
import { decodeInstallmentPaymentNote } from '../services/installments/installmentLinkNote';
import { brokerCashBucketsFromInvestmentAccount, getTradableCashBucketsForAccount, sumTradableCashSarFromInvestmentAccounts } from '../services/investmentCashLedger';
import { findCreditCardLiabilityForAccount } from '../services/creditCardLinking';
import { normalizePlannedTradeRow, plannedTradeToDbInsert, plannedTradeToDbUpdate } from '../utils/plannedTradeDb';
import {
    dateInRange,
    effectiveMonthStartDate,
    addMonthsToKey,
    budgetAppliesToFinancialView,
    financialMonthRange,
    financialMonthRangeFromKey,
    resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { sortByNewestFirst, sortPlannedTradesNewestFirst } from '../utils/sortRecency';
import { normalizeWatchlistRow, watchlistToDbRow } from '../utils/watchlistDb';
import { recomputeTrancheAfterFill } from '../services/plannedTradeTranches';
import { guardRecordWrite, type RecordWriteOptions } from '../services/recordConfirmBridge';
import { bindStableActions } from '../utils/stableActionBindings';
import {
    summarizeBudgetForConfirm,
    summarizeCommodityForConfirm,
    summarizeGoalForConfirm,
    summarizeInvestmentTradeForConfirm,
    summarizeLiabilityForConfirm,
    summarizePriceAlertForConfirm,
    summarizeRecurringForConfirm,
    summarizeTransactionForConfirm,
    summarizeTransferForConfirm,
    summarizeUpdateTransactionForConfirm,
    summarizeWatchlistForConfirm,
    summarizeZakatPaymentForConfirm,
} from '../utils/recordConfirmMessages';

export type { RecordWriteOptions };

// Default parameters: wealth-ultra/config + optional `wealth_ultra_config` in Supabase (merged in fetchData).
const initialData: FinancialData = {
    accounts: [], assets: [], liabilities: [], goals: [], transactions: [], recurringTransactions: [],
    investments: [], investmentTransactions: [], budgets: [], commodityHoldings: [], watchlist: [],
    sukukPositions: [], sukukPayoutSchedules: [], sukukPayoutEvents: [], corporateActionEvents: [], investmentCostLots: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275, monthStartDay: 28 },
    zakatPayments: [], priceAlerts: [], plannedTrades: [], notifications: [],
    investmentPlan: {
        monthlyBudget: 0, budgetCurrency: 'SAR', executionCurrency: 'USD', fxRateSource: 'GoogleFinance:CURRENCY:SARUSD',
        coreAllocation: 0.7, upsideAllocation: 0.3, minimumUpsidePercentage: 25,
        stale_days: 5, min_coverage_threshold: 3, redirect_policy: 'priority', target_provider: 'Finnhub',
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

function normalizeMinCoverageThreshold(raw: unknown, fallback = initialData.investmentPlan.min_coverage_threshold): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    // Legacy rows sometimes stored decimal coverage values (e.g. 0.8). Convert to valid integer.
    const normalized = n > 0 && n < 1 ? Math.ceil(n) : Math.round(n);
    return Math.max(0, Math.min(50, normalized));
}

/** Stable fallback for deployable accounts so memo deps don’t churn each render when lists are missing. */
const EMPTY_ACCOUNTS_FOR_DEPLOY: Account[] = [];
interface DataContextType {
  data: FinancialData;
  loading: boolean;
  /** True during first Supabase hydrate — use for inline hints only (Layout banner). Never full-page block. */
  showHydrateBanner: boolean;
  /** True while heavy/secondary tables finish syncing after the hydrate banner cleared. */
  isBackgroundSyncing: boolean;
  /** Non-null when the transactions table failed to load on hydrate (retry may follow). */
  transactionsLoadWarning: string | null;
  /** @deprecated Always false — pages must not early-return on this; use showHydrateBanner + Layout banner. */
  showBlockingLoader: boolean;
  /** Force a reload from the backend (non-destructive). */
  refreshData: () => Promise<void>;
  addAsset: (asset: Asset, opts?: RecordWriteOptions) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  addGoal: (goal: Goal, opts?: RecordWriteOptions) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (goalId: string) => Promise<void>;
  updateGoalAllocations: (allocations: { id: string, savingsAllocationPercent: number }[]) => Promise<void>;
  addLiability: (liability: Liability, opts?: RecordWriteOptions) => Promise<void>;
  updateLiability: (liability: Liability) => Promise<void>;
  deleteLiability: (liabilityId: string) => Promise<void>;
  addBudget: (budget: Omit<Budget, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  updateBudget: (budget: Budget) => Promise<void>;
  deleteBudget: (category: string, month: number, year: number) => Promise<void>;
  copyBudgetsFromPreviousMonth: (targetYear: number, targetMonth: number) => Promise<void>;
  addTransaction: (transaction: Omit<Transaction, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  updateTransaction: (transaction: Transaction, opts?: RecordWriteOptions) => Promise<void>;
  deleteTransaction: (transactionId: string) => Promise<void>;
  /** Create a transfer between two accounts (two transactions: out from fromAccountId, in to toAccountId). */
  addTransfer: (fromAccountId: string, toAccountId: string, amount: number, date?: string, note?: string, feeAmount?: number, opts?: RecordWriteOptions) => Promise<void>;
  addRecurringTransaction: (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  updateRecurringTransaction: (recurring: RecurringTransaction) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  /** `skipped` counts any rule where `applyRecurringRuleForMonth` returns `skipped: true` (not only duplicate-in-month). */
  applyRecurringForMonth: (year: number, month: number) => Promise<{ applied: number; skipped: number }>;
  /** Create one month’s transaction for a single recurring rule (same duplicate rules as bulk apply). */
  applyRecurringRuleForMonth: (
    recurringId: string,
    year: number,
    month: number,
  ) => Promise<{ applied: boolean; skipped: boolean; skipReason?: 'disabled' | 'manual' | 'already' | 'not_found' }>;
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
  recordTrade: (trade: { portfolioId?: string, name?: string, manualCurrentValue?: number, holdingType?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number }, executedPlanId?: string, opts?: RecordWriteOptions) => Promise<{
    insertedInvestmentTransactionId: string | null;
    insertedTradeTransactions: number;
    insertedCashLedgerRows: number;
    recomputed: boolean;
    cashDelta: number;
    positionDelta: number;
  }>;
  updateInvestmentTransaction: (tx: InvestmentTransaction, opts?: RecordWriteOptions) => Promise<void>;
  deleteInvestmentTransaction: (transactionId: string, opts?: RecordWriteOptions) => Promise<void>;
  applyCorporateActionEvent: (args: {
    portfolioId: string;
    symbol: string;
    executionDate: string;
    action: CorporateAction;
    linkedSymbol?: string;
  }) => Promise<void>;
  reverseCorporateActionEvent: (eventId: string) => Promise<void>;
  /** Explicit repair — rebuild named symbols from portfolio_id ledger (never runs on trade). */
  rebuildHoldingsFromLedgerForSymbols: (args: { portfolioId: string; symbols: string[] }) => Promise<void>;
  addWatchlistItem: (item: WatchlistItem, opts?: RecordWriteOptions) => Promise<void>;
  updateWatchlistItem: (item: WatchlistItem) => Promise<void>;
  deleteWatchlistItem: (symbol: string) => Promise<void>;
  addZakatPayment: (payment: Omit<ZakatPayment, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  addPriceAlert: (alert: Omit<PriceAlert, 'id' | 'user_id' | 'status' | 'createdAt'>, opts?: RecordWriteOptions) => Promise<void>;
  updatePriceAlert: (alert: PriceAlert) => Promise<void>;
  deletePriceAlert: (alertId: string) => Promise<void>;
  addPlannedTrade: (plan: Omit<PlannedTrade, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<boolean>;
  updatePlannedTrade: (plan: PlannedTrade) => Promise<boolean>;
  deletePlannedTrade: (planId: string) => Promise<void>;
  saveInvestmentPlan: (plan: InvestmentPlanSettings, portfolioId?: string) => Promise<void>;
  addUniverseTicker: (ticker: Omit<UniverseTicker, 'id' | 'user_id'>) => Promise<void>;
  updateUniverseTickerStatus: (tickerId: string, status: TickerStatus, updates?: Partial<UniverseTicker>) => Promise<void>;
  deleteUniverseTicker: (tickerId: string) => Promise<void>;
  addCommodityHolding: (holding: Omit<CommodityHolding, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  updateCommodityHolding: (holding: CommodityHolding) => Promise<void>;
  deleteCommodityHolding: (holdingId: string) => Promise<void>;
  batchUpdateCommodityHoldingValues: (updates: { id: string; currentValue: number }[]) => Promise<void>;
  addSukukPosition: (position: Omit<SukukPosition, 'id' | 'user_id'>, opts?: RecordWriteOptions) => Promise<void>;
  updateSukukPosition: (position: SukukPosition) => Promise<void>;
  deleteSukukPosition: (positionId: string) => Promise<void>;
  saveSukukPayoutSchedule: (input: {
    position: SukukPosition;
    existingSchedule: SukukPayoutSchedule | null;
    investmentAccountId: string;
    currency: 'SAR' | 'USD';
    cadence: SukukPayoutSchedule['cadence'];
    dayOfMonth?: number | null;
    couponAmount?: number | null;
    principalAmount?: number | null;
    principalInstallmentAmount?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    enabled?: boolean;
  }) => Promise<void>;
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

const DATA_CONTEXT_ACTION_KEYS = [
  'refreshData',
  'addAsset',
  'updateAsset',
  'deleteAsset',
  'addGoal',
  'updateGoal',
  'deleteGoal',
  'updateGoalAllocations',
  'addLiability',
  'updateLiability',
  'deleteLiability',
  'addBudget',
  'updateBudget',
  'deleteBudget',
  'copyBudgetsFromPreviousMonth',
  'addTransaction',
  'updateTransaction',
  'deleteTransaction',
  'addTransfer',
  'addRecurringTransaction',
  'updateRecurringTransaction',
  'deleteRecurringTransaction',
  'applyRecurringForMonth',
  'applyRecurringRuleForMonth',
  'applyRecurringDueToday',
  'addPlatform',
  'updatePlatform',
  'deletePlatform',
  'addPortfolio',
  'updatePortfolio',
  'deletePortfolio',
  'addHolding',
  'updateHolding',
  'batchUpdateHoldingValues',
  'recordTrade',
  'updateInvestmentTransaction',
  'deleteInvestmentTransaction',
  'applyCorporateActionEvent',
  'reverseCorporateActionEvent',
  'rebuildHoldingsFromLedgerForSymbols',
  'addWatchlistItem',
  'updateWatchlistItem',
  'deleteWatchlistItem',
  'addZakatPayment',
  'addPriceAlert',
  'updatePriceAlert',
  'deletePriceAlert',
  'addPlannedTrade',
  'updatePlannedTrade',
  'deletePlannedTrade',
  'saveInvestmentPlan',
  'addUniverseTicker',
  'updateUniverseTickerStatus',
  'deleteUniverseTicker',
  'addCommodityHolding',
  'updateCommodityHolding',
  'deleteCommodityHolding',
  'batchUpdateCommodityHoldingValues',
  'addSukukPosition',
  'updateSukukPosition',
  'deleteSukukPosition',
  'saveSukukPayoutSchedule',
  'updateSettings',
  'resetData',
  'loadDemoData',
  'restoreFromBackup',
  'saveExecutionLog',
] as const;

type DataContextActions = Pick<DataContextType, (typeof DATA_CONTEXT_ACTION_KEYS)[number]>;

function normalizeSettings(raw: any): Settings {
    if (!raw) return initialData.settings;
    return {
        riskProfile: (raw.risk_profile ?? raw.riskProfile ?? initialData.settings.riskProfile) as Settings['riskProfile'],
        budgetThreshold: Number(raw.budget_threshold ?? raw.budgetThreshold ?? initialData.settings.budgetThreshold),
        driftThreshold: Number(raw.drift_threshold ?? raw.driftThreshold ?? initialData.settings.driftThreshold),
        enableEmails: Boolean(raw.enable_emails ?? raw.enableEmails ?? initialData.settings.enableEmails),
        goldPrice: Number(raw.gold_price ?? raw.goldPrice ?? initialData.settings.goldPrice),
        monthStartDay: (() => {
            const n = Number(raw.month_start_day ?? raw.monthStartDay ?? initialData.settings.monthStartDay);
            if (!Number.isFinite(n)) return initialData.settings.monthStartDay ?? 28;
            return Math.min(31, Math.max(1, Math.round(n)));
        })(),
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
    if (settings.monthStartDay != null) row.month_start_day = settings.monthStartDay;
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
        min_coverage_threshold: normalizeMinCoverageThreshold(raw.min_coverage_threshold ?? initialData.investmentPlan.min_coverage_threshold),
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
    const rawType = String(raw.type ?? '').trim().toLowerCase();
    const type = (
        raw.type === 'Savings' || raw.type === 'Investment' || raw.type === 'Credit'
            ? raw.type
            : rawType.includes('invest')
                ? 'Investment'
                : rawType.includes('sav')
                    ? 'Savings'
                    : rawType.includes('credit')
                        ? 'Credit'
                        : 'Checking'
    ) as Account['type'];
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
        accountRole: raw.account_role ?? raw.accountRole,
        bucketType: raw.bucket_type ?? raw.bucketType,
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
    if (platform.accountRole) payload.account_role = platform.accountRole;
    if (platform.bucketType) payload.bucket_type = platform.bucketType;
    return payload;
}

function normalizeAssetRow(raw: any): Asset {
    if (!raw || typeof raw !== 'object') {
        return { id: '', name: '', type: 'Property', value: 0 };
    }
    const pp = raw.purchase_price ?? raw.purchasePrice;
    const mr = raw.monthly_rent ?? raw.monthlyRent;
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
        notes,
    };
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
    if (holding.dividendYield != null && Number.isFinite(Number(holding.dividendYield))) {
        row.dividend_yield = Number(holding.dividendYield);
    }
    if (holding.dividendDistribution === 'Reinvest' || holding.dividendDistribution === 'Payout') {
        row.dividend_distribution = holding.dividendDistribution;
    }
    if (holding.expectedAnnualDividendSar != null && Number.isFinite(Number(holding.expectedAnnualDividendSar))) {
        row.expected_annual_dividend_sar = roundMoney(Math.max(0, Number(holding.expectedAnnualDividendSar)));
    } else if ((holding as any).expected_annual_dividend_sar === null) {
        row.expected_annual_dividend_sar = null;
    }
    const cadence = holding.dividendPayoutCadence ?? (holding as any).dividend_payout_cadence;
    if (cadence) row.dividend_payout_cadence = cadence;
    const months = holding.typicalPayoutMonths ?? (holding as any).typical_payout_months;
    if (Array.isArray(months) && months.length > 0) {
        row.typical_payout_months = months.filter((m: number) => m >= 1 && m <= 12);
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
        dividendDistribution: row.dividend_distribution ?? row.dividendDistribution,
        dividendYield: row.dividend_yield != null ? Number(row.dividend_yield) : row.dividendYield,
        expectedAnnualDividendSar:
            row.expected_annual_dividend_sar != null ? Number(row.expected_annual_dividend_sar) : row.expectedAnnualDividendSar,
        dividendPayoutCadence: row.dividend_payout_cadence ?? row.dividendPayoutCadence,
        typicalPayoutMonths: Array.isArray(row.typical_payout_months) ? row.typical_payout_months : row.typicalPayoutMonths,
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
        min_coverage_threshold: normalizeMinCoverageThreshold(plan.min_coverage_threshold),
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
    const dataActionsRef = useRef({} as DataContextActions);
    const [data, setData] = useState<FinancialData>(initialData);
    const [loading, setLoading] = useState(true);
    const [dataResetKey, setDataResetKey] = useState(0);
    const auth = useContext(AuthContext);
    const tradeSubmissionInFlightRef = useRef(false);
    const corporateActionInFlightRef = useRef(false);
    const duplicateHoldingsReconcileInFlightRef = useRef(false);
    const duplicateHoldingsLastSignatureRef = useRef<string>('');
    /**
     * Monotonic book generation — bumped after local holdings mutations / successful recordTrade.
     * Stale fetchData investments payloads are ignored when generation advanced mid-fetch.
     */
    const holdingsBookGenerationRef = useRef(0);
    /** After first successful Supabase hydrate, refetches refresh in the background without blocking pages. */
    const financialDataLoadedRef = useRef(false);
    /** UI gate: true until first hydrate for this session/user completes (independent of background `loading`). */
    const [awaitingInitialHydrate, setAwaitingInitialHydrate] = useState(true);
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
    const backgroundSyncInFlightRef = useRef(false);
    const [transactionsLoadWarning, setTransactionsLoadWarning] = useState<string | null>(null);
    const recurringAutoApplyInFlightRef = useRef(false);
    const transactionsRef = useRef<FinancialData['transactions']>(data?.transactions ?? []);
    transactionsRef.current = data?.transactions ?? [];
    const dataRef = useRef(data);
    /** Eagerly patch dataRef before setState so sequential awaits (recordTrade → holdings patch) see fresh state. */
    const applyFinancialDataPatch = (recipe: (prev: FinancialData) => FinancialData) => {
        const next = recipe(dataRef.current);
        dataRef.current = next;
        setData(next);
    };
    const bumpHoldingsBookGeneration = () => {
        holdingsBookGenerationRef.current += 1;
    };
    /** After buy/sell/dividend/DRIP — advance generation and persist hydrate cache so ghosts cannot return from stale cache. */
    const sealHoldingsBookAfterTrade = () => {
        bumpHoldingsBookGeneration();
        if (auth?.user?.id && financialDataHasHydrated(dataRef.current)) {
            writeWorkspaceHydrateCache(auth.user.id, dataRef.current);
        }
    };
    /** Keep dataRef aligned after React commits — useLayoutEffect so cash reads see accounts before paint. */
    useLayoutEffect(() => {
        dataRef.current = data;
    }, [data]);
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
            expectedAnnualDividendSar:
                holding.expectedAnnualDividendSar ?? holding.expected_annual_dividend_sar ?? undefined,
            dividendPayoutCadence: holding.dividendPayoutCadence ?? holding.dividend_payout_cadence ?? undefined,
            typicalPayoutMonths: Array.isArray(holding.typicalPayoutMonths)
                ? holding.typicalPayoutMonths
                : Array.isArray(holding.typical_payout_months)
                  ? holding.typical_payout_months
                  : undefined,
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
            idempotencyKey: transaction.idempotencyKey ?? transaction.idempotency_key ?? undefined,
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
        const accountIdRaw = raw.accountId ?? raw.account_id;
        const accountId =
            accountIdRaw != null && String(accountIdRaw).trim() !== '' ? String(accountIdRaw) : undefined;
        return {
            ...raw,
            type,
            amount: roundMoney(amount),
            goalId: raw.goalId ?? raw.goal_id,
            accountId,
            apr: raw.apr != null ? Number(raw.apr) : undefined,
            minPayment: raw.min_payment != null ? Number(raw.min_payment) : raw.minPayment != null ? Number(raw.minPayment) : undefined,
            maturityDate: raw.maturity_date != null ? String(raw.maturity_date).slice(0, 10) : raw.maturityDate != null ? String(raw.maturityDate).slice(0, 10) : undefined,
            payoffPriority: raw.payoff_priority != null ? Number(raw.payoff_priority) : raw.payoffPriority != null ? Number(raw.payoffPriority) : undefined,
        };
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
        const accountLink =
            liability.accountId != null && String(liability.accountId).trim() !== '' ? liability.accountId : null;
        const enrich = {
            apr: liability.apr ?? null,
            min_payment: liability.minPayment ?? null,
            maturity_date: liability.maturityDate ?? null,
            payoff_priority: liability.payoffPriority ?? null,
        };
        const snake = { ...common, goal_id: goal, account_id: accountLink };
        const snakeEnriched = { ...snake, ...enrich };
        const camel = { ...common, goalId: goal, accountId: accountLink };
        const snakeLegacy = { ...common, goal_id: goal };
        return [snakeEnriched, snake, snakeLegacy, camel, common];
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
    const formatDbError = (error: any): string => {
        return formatUnknownError(error, 'Unknown database error.');
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

    const tradePayloadVariants = (trade: Omit<InvestmentTransaction, 'id' | 'user_id'>) =>
        buildInvestmentTradeInsertVariants(trade);

    const transactionPayloadVariants = buildTransactionPayloadVariants;

    const trySelectOptionalTable = <T,>(q: PromiseLike<any>) =>
        q.then((r: any) => r, () => ({ data: [] as T[], error: { code: 'PGRST205', message: 'Table not found' } }));

    const FETCH_SETTLE_BUDGET_MS = 25_000;

    const fetchData = async () => {
        if (!auth?.user || !supabase) {
            financialDataLoadedRef.current = true;
            setAwaitingInitialHydrate(false);
            setLoading(false);
            return;
        }
        const isInitialHydrate = !financialDataLoadedRef.current;
        if (isInitialHydrate) {
            pauseBackgroundWork(1500);
            setLoading(true);
        }
        try {
            const db = supabase;
            const recurringPromise = trySelectOptionalTable<any>(db.from('recurring_transactions').select('*').eq('user_id', auth.user.id));
            const sukukSchedulesPromise = trySelectOptionalTable<any>(db.from('sukuk_payout_schedules').select('*').eq('user_id', auth.user.id));
            const sukukEventsPromise = trySelectOptionalTable<any>(db.from('sukuk_payout_events').select('*').eq('user_id', auth.user.id));
            const sukukPositionsPromise = trySelectOptionalTable<any>(db.from('sukuk_positions').select('*').eq('user_id', auth.user.id));
            const corporateActionEventsPromise = trySelectOptionalTable<any>(
                db.from('corporate_action_events').select('*').eq('user_id', auth.user.id).order('execution_date', { ascending: false }),
            );
            const investmentCostLotsPromise = trySelectOptionalTable<any>(
                db.from('investment_cost_lots').select('*').eq('user_id', auth.user.id),
            );

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
                db.from('execution_logs').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(150),
                recurringPromise,
                db.from('budget_requests').select('*').eq('user_id', auth.user.id),
                sukukPositionsPromise,
                sukukSchedulesPromise,
                sukukEventsPromise,
                corporateActionEventsPromise,
                investmentCostLotsPromise,
            ];
            const keys = HYDRATE_FETCH_KEYS;
            const emptyResult = (err?: any) => ({ data: null, error: err || { code: 'FETCH_FAILED' } });
            const settleFetches = (promises: PromiseLike<any>[], keySlice: readonly (typeof keys)[number][]) =>
                Promise.allSettled(promises.map((p) => Promise.resolve(p))).then((settled) =>
                    settled.map((s, i) => {
                        if (s.status === 'fulfilled') return s.value as any;
                        console.error(`Error fetching ${keySlice[i]}:`, s.reason);
                        return emptyResult(s.reason);
                    }),
                );
            const fastKeys = FAST_HYDRATE_INDICES.map((i) => keys[i]);
            const heavyKeys = HEAVY_HYDRATE_INDICES.map((i) => keys[i]);
            const secondaryKeys = keys.slice(HYDRATE_SECONDARY_START_INDEX);
            const slowFetchTimer = window.setTimeout(() => {
                if (import.meta.env.DEV) {
                    console.warn(
                        `Financial data fetch still running after ${FETCH_SETTLE_BUDGET_MS}ms — background sync continues.`,
                    );
                }
            }, FETCH_SETTLE_BUDGET_MS);
            const fastPromise = settleFetches(
                FAST_HYDRATE_INDICES.map((i) => fetchPromises[i]),
                fastKeys,
            );
            const heavyPromise = settleFetches(
                HEAVY_HYDRATE_INDICES.map((i) => fetchPromises[i]),
                heavyKeys,
            );
            const secondaryFetchPromise = settleFetches(
                fetchPromises.slice(HYDRATE_SECONDARY_START_INDEX),
                secondaryKeys,
            );
            const fastResults = await fastPromise;
            window.clearTimeout(slowFetchTimer);
            let [
                accounts,
                goals,
                investments,
                budgets,
                watchlist,
                settings,
            ] = fastResults;
            let assets = emptyResult();
            let liabilities = emptyResult();
            let transactions = emptyResult();
            let investmentTransactions = emptyResult();
            let zakatPayments = emptyResult();
            let priceAlerts = emptyResult();
            let commodityHoldings = emptyResult();
            let plannedTrades = emptyResult();
            let investmentPlan = emptyResult();
            let portfolioUniverse = emptyResult();
            let statusChangeLog = emptyResult();
            let executionLogs = emptyResult();
            let recurringTransactions = emptyResult();
            let budgetRequests = emptyResult();
            let sukukPositions = emptyResult();
            let sukukPayoutSchedules = emptyResult();
            let sukukPayoutEvents = emptyResult();
            let corporateActionEvents = emptyResult();
            let investmentCostLots = emptyResult();
            const allFetches = {
                accounts,
                goals,
                investments,
                budgets,
                watchlist,
                settings,
            };
            Object.entries(allFetches).forEach(([key, value]) => {
              if (value?.error && value.error.code !== 'PGRST116') console.error(`Error fetching ${key}:`, value.error);
            });

            const normalizedAccounts = ((accounts.data as any[]) || []).map(normalizeAccount);
            const ownerId = auth.user.id;
            const filterOwnedRows = <T extends { user_id?: string }>(rows: T[] | null | undefined): T[] =>
                ((rows || []) as T[]).filter((r) => r?.user_id === ownerId);
            const normalizeCashTransactionRow = (row: any): Transaction => {
                const norm = normalizeTransaction(row);
                const resolved = resolveAccountId(norm.accountId, normalizedAccounts);
                return resolved ? { ...norm, accountId: resolved } : norm;
            };
            const normalizeInvestmentTransactionRows = (rows: any[] | null | undefined) =>
                filterOwnedRows(rows as any[]).map((t: any) => {
                    const norm = normalizeInvestmentTransaction(t);
                    const resolved = resolveAccountId(norm.accountId, normalizedAccounts);
                    return resolved ? { ...norm, accountId: resolved } : norm;
                });
            const ownedAccounts = filterOwnedRows(normalizedAccounts);

            const todayYmd = new Date().toISOString().slice(0, 10);
            const wuBase = getDefaultWealthUltraSystemConfig();

            await yieldToMain();

            /** Captured before network apply — if a trade bumps generation mid-fetch, skip investments overwrite. */
            const investmentsHydrateGenAtStart = holdingsBookGenerationRef.current;

            const applyHydrateFinancialDataPatch = (
                patch: Partial<FinancialData> & Pick<FinancialData, 'accounts'>,
                wealthUltraConfig = wuBase,
            ) => {
            const investmentsStale =
                patch.investments != null &&
                holdingsBookGenerationRef.current !== investmentsHydrateGenAtStart;
            if (investmentsStale) {
                console.warn(
                    '[holdings] Skipping stale investments hydrate — local book generation advanced during fetch.',
                );
            }
            startTransition(() => {
            setData((prev) => ({
                ...prev,
                accounts: patch.accounts,
                assets: patch.assets ?? prev.assets,
                liabilities: patch.liabilities ?? prev.liabilities,
                goals: patch.goals ?? prev.goals,
                transactions: patch.transactions ?? prev.transactions,
                investments: investmentsStale ? prev.investments : (patch.investments ?? prev.investments),
                investmentTransactions: patch.investmentTransactions ?? prev.investmentTransactions,
                sukukPayoutSchedules: patch.sukukPayoutSchedules ?? prev.sukukPayoutSchedules,
                sukukPayoutEvents: patch.sukukPayoutEvents ?? prev.sukukPayoutEvents,
                sukukPositions: patch.sukukPositions ?? prev.sukukPositions,
                corporateActionEvents: patch.corporateActionEvents ?? prev.corporateActionEvents,
                investmentCostLots: patch.investmentCostLots ?? prev.investmentCostLots,
                budgets: patch.budgets ?? prev.budgets,
                commodityHoldings: patch.commodityHoldings ?? prev.commodityHoldings,
                watchlist: patch.watchlist ?? prev.watchlist,
                settings: patch.settings ?? prev.settings,
                zakatPayments: patch.zakatPayments ?? prev.zakatPayments,
                priceAlerts: patch.priceAlerts ?? prev.priceAlerts,
                plannedTrades: patch.plannedTrades ?? prev.plannedTrades,
                investmentPlan: patch.investmentPlan ?? prev.investmentPlan,
                wealthUltraConfig: patch.wealthUltraConfig ?? wealthUltraConfig,
                portfolioUniverse: patch.portfolioUniverse ?? prev.portfolioUniverse,
                statusChangeLog: patch.statusChangeLog ?? prev.statusChangeLog,
                executionLogs: patch.executionLogs ?? prev.executionLogs,
                recurringTransactions: patch.recurringTransactions ?? prev.recurringTransactions,
                budgetRequests: patch.budgetRequests ?? prev.budgetRequests,
                notifications: patch.notifications ?? prev.notifications,
                allTransactions: patch.allTransactions ?? prev.allTransactions,
                allBudgets: patch.allBudgets ?? prev.allBudgets,
            }));
            });
            };

            const buildInvestmentsFromRows = (rows: any) =>
                filterOwnedRows((rows as any) || []).map((portfolio: any) => {
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
                });

            applyHydrateFinancialDataPatch({
                accounts: ownedAccounts,
                goals: [...filterOwnedRows(goals.data as any[]).map(normalizeGoalRow)].sort((a, b) =>
                    b.id.localeCompare(a.id),
                ),
                investments: buildInvestmentsFromRows(investments.data),
                budgets: filterOwnedRows(budgets.data as any[]).map((b: any) => ({
                    ...b,
                    period: b.period ?? 'monthly',
                    tier: b.tier ?? b.budget_tier ?? 'Optional',
                    destinationAccountId: b.destination_account_id ?? undefined,
                    goalId: b.goal_id ?? b.goalId ?? undefined,
                    limit: roundMoney(Number(b.limit ?? 0)),
                })),
                watchlist: filterOwnedRows(watchlist.data as any[])
                    .map((w: any) => normalizeWatchlistRow(w))
                    .sort((a, b) => String(b.symbol).localeCompare(String(a.symbol))),
                settings: normalizeSettings((settings as any).data ?? initialData.settings),
                notifications: [],
                allTransactions: [],
                allBudgets: [],
            });

            financialDataLoadedRef.current = true;
            setAwaitingInitialHydrate(false);
            setLoading(false);

            void (async () => {
                backgroundSyncInFlightRef.current = true;
                setIsBackgroundSyncing(true);
                try {
                    const heavyResults = await heavyPromise;
                    [assets, liabilities, transactions, investmentTransactions] = heavyResults;
                    const heavyFetches = { assets, liabilities, transactions, investmentTransactions };
                    Object.entries(heavyFetches).forEach(([key, value]) => {
                        if (value?.error && value.error.code !== 'PGRST116') {
                            console.error(`Error fetching ${key}:`, value.error);
                        }
                    });
                    const normalizedInvestmentTransactions = normalizeInvestmentTransactionRows(
                        (investmentTransactions.data ?? undefined) as any[] | undefined,
                    );
                    await yieldToMain();
                    applyHydrateFinancialDataPatch({
                        accounts: ownedAccounts,
                        assets: filterOwnedRows((assets.data ?? undefined) as any[] | undefined).map(normalizeAssetRow),
                        liabilities: [...filterOwnedRows((((liabilities.data ?? undefined) as any[] | undefined) || []).map(normalizeLiability))].sort(
                            (a, b) => b.id.localeCompare(a.id),
                        ),
                        transactions: sortByNewestFirst(
                            filterOwnedRows((transactions.data ?? undefined) as any[] | undefined).map(normalizeCashTransactionRow),
                        ),
                        investmentTransactions: sortByNewestFirst(normalizedInvestmentTransactions),
                    });

                    const txFetchError = transactions?.error;
                    const txFetchTimedOut = txFetchError?.code === 'TIMEOUT';
                    const initialTxCount = filterOwnedRows((transactions.data ?? undefined) as any[] | undefined).length;
                    if (txFetchTimedOut || (txFetchError && txFetchError.code !== 'PGRST116' && initialTxCount === 0)) {
                        const retryUserId = auth.user?.id;
                        if (retryUserId) {
                            try {
                                const retry = await db.from('transactions').select('*').eq('user_id', retryUserId);
                                if (retry.error) {
                                    setTransactionsLoadWarning(
                                        'Transactions could not be loaded. Use Settings → Refresh data or reload the page.',
                                    );
                                } else {
                                    setTransactionsLoadWarning(null);
                                    const retried = sortByNewestFirst(
                                        filterOwnedRows(retry.data as any[]).map(normalizeCashTransactionRow),
                                    );
                                    if (retried.length > 0 || !retry.error) {
                                        startTransition(() => {
                                            setData((prev) => ({ ...prev, transactions: retried }));
                                        });
                                    }
                                }
                            } catch {
                                setTransactionsLoadWarning(
                                    'Transactions could not be loaded. Use Settings → Refresh data or reload the page.',
                                );
                            }
                        }
                    } else {
                        setTransactionsLoadWarning(null);
                    }

                    const secondaryResults = await secondaryFetchPromise;
                    [
                        zakatPayments,
                        priceAlerts,
                        commodityHoldings,
                        plannedTrades,
                        investmentPlan,
                        portfolioUniverse,
                        statusChangeLog,
                        executionLogs,
                        recurringTransactions,
                        budgetRequests,
                        sukukPositions,
                        sukukPayoutSchedules,
                        sukukPayoutEvents,
                        corporateActionEvents,
                        investmentCostLots,
                    ] = secondaryResults;
                    const secondaryFetches = {
                        zakatPayments,
                        priceAlerts,
                        commodityHoldings,
                        plannedTrades,
                        investmentPlan,
                        portfolioUniverse,
                        statusChangeLog,
                        executionLogs,
                        recurringTransactions,
                        budgetRequests,
                        sukukPositions,
                        sukukPayoutSchedules,
                        sukukPayoutEvents,
                        corporateActionEvents,
                        investmentCostLots,
                    };
                    Object.entries(secondaryFetches).forEach(([key, value]) => {
                        if (value?.error && value.error.code !== 'PGRST116') {
                            console.error(`Error fetching ${key}:`, value.error);
                            if (key === 'sukukPositions' && value.error.code === 'PGRST205') {
                                console.warn(
                                    'sukuk_positions table missing — apply migration 20260627120000_sukuk_positions.sql on Supabase.',
                                );
                            }
                            if (key === 'corporateActionEvents' && value.error.code === 'PGRST205') {
                                console.warn(
                                    'corporate_action_events table missing — apply migration 20260706130000_corporate_actions_and_cost_lots.sql.',
                                );
                            }
                            if (key === 'investmentCostLots' && value.error.code === 'PGRST205') {
                                console.warn(
                                    'investment_cost_lots table missing — apply migration 20260706130000_corporate_actions_and_cost_lots.sql.',
                                );
                            }
                        }
                    });
                    const normalizedSukukPositionsBg = filterOwnedRows(((sukukPositions.data ?? undefined) as any[] | undefined) || []).map(
                        normalizeSukukPositionRow,
                    );
                    const normalizedSukukSchedulesBg = filterOwnedRows(((sukukPayoutSchedules.data ?? undefined) as any[] | undefined) || []).map(
                        normalizeSukukPayoutScheduleRow,
                    );
                    const normalizedSukukEventsBg = filterOwnedRows(((sukukPayoutEvents.data ?? undefined) as any[] | undefined) || []).map(
                        normalizeSukukPayoutEventRow,
                    );
                    const dueSukukEventsBg = normalizedSukukEventsBg
                        .filter((e) => !e.posted && e.amount > 0 && String(e.payoutDate) <= todayYmd)
                        .slice(0, 50);
                    const matureSukukDirectPosts = normalizedSukukPositionsBg
                        .map((p) => {
                            const hasSchedule = normalizedSukukSchedulesBg.some((s) => s.sukukPositionId === p.id);
                            const meta = (p as SukukPosition & { metadata?: { autoCloseOnMaturity?: boolean } }).metadata;
                            const autoClose =
                                meta && typeof meta.autoCloseOnMaturity === 'boolean' ? meta.autoCloseOnMaturity : undefined;
                            const draft = buildMaturityPrincipalEventDraft(p, todayYmd, {
                                hasPayoutSchedule: hasSchedule,
                                autoCloseOnMaturity: autoClose,
                            });
                            if (!draft) return null;
                            const hasPrincipalEvent = normalizedSukukEventsBg.some(
                                (e) => e.sukukPositionId === p.id && e.kind === 'principal',
                            );
                            if (hasPrincipalEvent) return null;
                            return { position: p, draft };
                        })
                        .filter((x): x is { position: SukukPosition; draft: NonNullable<ReturnType<typeof buildMaturityPrincipalEventDraft>> } => x != null);
                    const normalizedCorporateActionEventsBg = filterOwnedRows(
                        ((corporateActionEvents.data ?? undefined) as any[] | undefined) || [],
                    ).map((row) => normalizeCorporateActionEventRow(row));
                    const normalizedCostLotsBg = filterOwnedRows(
                        ((investmentCostLots.data ?? undefined) as any[] | undefined) || [],
                    ).map((row) => normalizeInvestmentCostLotRow(row as Record<string, unknown>));
                    await yieldToMain();
                    applyHydrateFinancialDataPatch(
                        {
                            accounts: ownedAccounts,
                            sukukPositions: normalizedSukukPositionsBg,
                            sukukPayoutSchedules: normalizedSukukSchedulesBg,
                            sukukPayoutEvents: normalizedSukukEventsBg,
                            corporateActionEvents: normalizedCorporateActionEventsBg,
                            investmentCostLots: normalizedCostLotsBg,
                            commodityHoldings: filterOwnedRows((commodityHoldings.data ?? undefined) as any[] | undefined).map(normalizeCommodityHolding),
                            zakatPayments: sortByNewestFirst(filterOwnedRows((zakatPayments.data ?? undefined) as any[] | undefined)),
                            priceAlerts: filterOwnedRows((priceAlerts.data ?? undefined) as any[] | undefined).map(normalizePriceAlert),
                            plannedTrades: sortPlannedTradesNewestFirst(
                                filterOwnedRows((plannedTrades.data ?? undefined) as any[] | undefined).map(normalizePlannedTradeRow),
                            ),
                            investmentPlan: normalizeInvestmentPlan((investmentPlan as any).data),
                            portfolioUniverse: filterOwnedRows((portfolioUniverse as any).data || []).map(normalizeUniverseTicker),
                            statusChangeLog: sortByNewestFirst(filterOwnedRows((statusChangeLog as any).data || [])),
                            executionLogs: sortByNewestFirst(
                                filterOwnedRows((executionLogs as any).data || []).map(normalizeExecutionLog),
                            ),
                            recurringTransactions: (recurringTransactions as any).error
                                ? []
                                : [...filterOwnedRows((recurringTransactions as any).data || []).map((r: any) =>
                                      normalizeRecurringTransaction(
                                          r,
                                          resolveAccountId(r.account_id ?? r.accountId, normalizedAccounts) ?? undefined,
                                      ),
                                  )].sort((a, b) => b.id.localeCompare(a.id)),
                            budgetRequests: sortByNewestFirst(
                                ((budgetRequests as any).data || []).map((r: any) => ({
                                    id: r.id,
                                    userId: r.user_id ?? r.userId,
                                    requestType:
                                        (r.request_type ?? r.requestType) === 'IncreaseLimit' ? 'IncreaseLimit' : 'NewCategory',
                                    categoryId: r.category_id ?? r.categoryId,
                                    categoryName: r.category_name ?? r.categoryName,
                                    amount: roundMoney(Number(r.amount ?? 0)),
                                    note: r.note ?? r.request_note,
                                    status:
                                        r.status === 'Finalized'
                                            ? 'Finalized'
                                            : r.status === 'Rejected'
                                              ? 'Rejected'
                                              : 'Pending',
                                    created_at: r.created_at,
                                })),
                            ),
                        },
                    );
                    if (supabase && auth.user) {
                        try {
                            const { data: wuUser } = await supabase
                                .from('wealth_ultra_config')
                                .select('*')
                                .eq('user_id', auth.user.id)
                                .maybeSingle();
                            let wealthUltraConfig = wuBase;
                            if (wuUser) {
                                wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(
                                    wuUser as Record<string, unknown>,
                                    wuBase,
                                );
                            } else {
                                const { data: wuGlobal } = await supabase
                                    .from('wealth_ultra_config')
                                    .select('*')
                                    .is('user_id', null)
                                    .limit(1)
                                    .maybeSingle();
                                if (wuGlobal) {
                                    wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(
                                        wuGlobal as Record<string, unknown>,
                                        wuBase,
                                    );
                                }
                            }
                            startTransition(() => {
                                setData((prev) => ({ ...prev, wealthUltraConfig }));
                            });
                        } catch (e) {
                            console.warn('Optional wealth_ultra_config load skipped:', e);
                        }
                    }
                    if ((dueSukukEventsBg.length || matureSukukDirectPosts.length) && auth.user) {
                        const userId = auth.user.id;
                        void (async () => {
                            try {
                                const appendedInvestmentTx: InvestmentTransaction[] = [];
                                const postedEventIds = new Set<string>();
                                const updatedPositions = new Map<string, SukukPosition>();
                                const sukukPostDeadline = Date.now() + 5000;
                                for (const ev of dueSukukEventsBg) {
                                    if (Date.now() > sukukPostDeadline) {
                                        console.warn(
                                            'Sukuk auto-post time budget reached; remaining events deferred to next refresh.',
                                        );
                                        break;
                                    }
                                    const symbol = sukukPayoutInvestmentSymbol(ev.sukukPositionId, ev.kind);
                                    const txType: InvestmentTransaction['type'] =
                                        ev.kind === 'principal' ? 'deposit' : 'dividend';
                                    const payload: Omit<InvestmentTransaction, 'id' | 'user_id'> = {
                                        accountId: ev.investmentAccountId,
                                        date: ev.payoutDate,
                                        type: txType,
                                        symbol,
                                        quantity: 0,
                                        price: 0,
                                        total: ev.amount,
                                        currency: ev.currency,
                                    };
                                    let inserted: any | null = null;
                                    for (const variant of tradePayloadVariants(payload)) {
                                        const res = await db
                                            .from('investment_transactions')
                                            .insert(withUser(variant))
                                            .select('*')
                                            .maybeSingle();
                                        if (!res.error && res.data) {
                                            inserted = res.data;
                                            break;
                                        }
                                    }
                                    if (inserted?.id) {
                                        const postUpdate = await db
                                            .from('sukuk_payout_events')
                                            .update({
                                                posted: true,
                                                posted_at: new Date().toISOString(),
                                                posted_investment_transaction_id: inserted.id,
                                            })
                                            .eq('id', ev.id)
                                            .eq('user_id', userId)
                                            .select('id')
                                            .maybeSingle();
                                        if (postUpdate.error || !postUpdate.data?.id) {
                                            try {
                                                await db.from('investment_transactions').delete().eq('id', inserted.id);
                                            } catch {
                                                // ignore rollback failures
                                            }
                                        } else {
                                            appendedInvestmentTx.push(normalizeInvestmentTransaction(inserted));
                                            postedEventIds.add(ev.id);
                                            if (ev.kind === 'principal') {
                                                const current =
                                                    updatedPositions.get(ev.sukukPositionId) ??
                                                    dataRef.current.sukukPositions?.find((p) => p.id === ev.sukukPositionId);
                                                if (current) {
                                                    const next = applyPrincipalPaymentToSukukPosition(
                                                        current,
                                                        ev.amount,
                                                        ev.payoutDate,
                                                    );
                                                    const merged: SukukPosition = {
                                                        ...current,
                                                        outstandingPrincipal: next.outstandingPrincipal,
                                                        status: next.status,
                                                    };
                                                    updatedPositions.set(ev.sukukPositionId, merged);
                                                    try {
                                                        await db
                                                            .from('sukuk_positions')
                                                            .update({
                                                                outstanding_principal: merged.outstandingPrincipal,
                                                                status: merged.status,
                                                            })
                                                            .eq('id', ev.sukukPositionId)
                                                            .eq('user_id', userId);
                                                    } catch {
                                                        // position update best-effort; refresh will reconcile
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                for (const { position, draft } of matureSukukDirectPosts) {
                                    if (Date.now() > sukukPostDeadline) break;
                                    const symbol = sukukPayoutInvestmentSymbol(draft.sukukPositionId, 'principal');
                                    const payload: Omit<InvestmentTransaction, 'id' | 'user_id'> = {
                                        accountId: draft.investmentAccountId,
                                        date: draft.payoutDate,
                                        type: 'deposit',
                                        symbol,
                                        quantity: 0,
                                        price: 0,
                                        total: draft.amount,
                                        currency: draft.currency,
                                    };
                                    let inserted: any | null = null;
                                    for (const variant of tradePayloadVariants(payload)) {
                                        const res = await db
                                            .from('investment_transactions')
                                            .insert(withUser(variant))
                                            .select('*')
                                            .maybeSingle();
                                        if (!res.error && res.data) {
                                            inserted = res.data;
                                            break;
                                        }
                                    }
                                    if (!inserted?.id) continue;
                                    appendedInvestmentTx.push(normalizeInvestmentTransaction(inserted));
                                    const next = applyPrincipalPaymentToSukukPosition(position, draft.amount, draft.payoutDate);
                                    const merged: SukukPosition = {
                                        ...position,
                                        outstandingPrincipal: next.outstandingPrincipal,
                                        status: next.status,
                                    };
                                    updatedPositions.set(position.id, merged);
                                    try {
                                        await db
                                            .from('sukuk_positions')
                                            .update({
                                                outstanding_principal: merged.outstandingPrincipal,
                                                status: merged.status,
                                            })
                                            .eq('id', position.id)
                                            .eq('user_id', userId);
                                    } catch {
                                        // best-effort
                                    }
                                }
                                if (!appendedInvestmentTx.length && postedEventIds.size === 0 && updatedPositions.size === 0) return;
                                setData((prev) => ({
                                    ...prev,
                                    investmentTransactions: appendedInvestmentTx.length
                                        ? sortByNewestFirst([...prev.investmentTransactions, ...appendedInvestmentTx])
                                        : prev.investmentTransactions,
                                    sukukPayoutEvents: postedEventIds.size
                                        ? (prev.sukukPayoutEvents ?? []).map((e) =>
                                              postedEventIds.has(e.id) ? { ...e, posted: true } : e,
                                          )
                                        : prev.sukukPayoutEvents,
                                    sukukPositions:
                                        updatedPositions.size > 0
                                            ? (prev.sukukPositions ?? []).map((p) =>
                                                  updatedPositions.has(p.id) ? updatedPositions.get(p.id)! : p,
                                              )
                                            : prev.sukukPositions,
                                }));
                            } catch (e) {
                                console.warn('Sukuk auto-post skipped:', e);
                            }
                        })();
                    }
                    if (auth.user?.id && financialDataHasHydrated(dataRef.current)) {
                        writeWorkspaceHydrateCache(auth.user.id, dataRef.current);
                    }
                } catch (e) {
                    console.warn('Background financial data hydrate skipped:', e);
                } finally {
                    backgroundSyncInFlightRef.current = false;
                    setIsBackgroundSyncing(false);
                }
            })();

        } catch (error) {
            console.error("Error fetching financial data:", error);
        } finally {
            if (!financialDataLoadedRef.current) {
                financialDataLoadedRef.current = true;
                setAwaitingInitialHydrate(false);
                setLoading(false);
            }
        }
    };

    const refreshData = async () => {
        await fetchData();
    };


    useEffect(() => {
        if (!auth?.user?.id || !supabase) {
            financialDataLoadedRef.current = false;
            setAwaitingInitialHydrate(false);
            setIsBackgroundSyncing(false);
            setLoading(false);
            return;
        }
        const userId = auth.user.id;
        const cached = readWorkspaceHydrateCache(userId);
        if (cached) {
            startTransition(() => {
                setData((prev) => ({
                    ...initialData,
                    ...cached,
                    notifications: prev.notifications,
                    allTransactions: prev.allTransactions,
                    allBudgets: prev.allBudgets,
                }));
            });
            financialDataLoadedRef.current = true;
            setAwaitingInitialHydrate(false);
            setLoading(false);
        } else {
            setData(initialData);
            financialDataLoadedRef.current = false;
            setAwaitingInitialHydrate(true);
        }
        setTransactionsLoadWarning(null);
        void fetchData();
        // Use user id only: `user` object reference changes on TOKEN_REFRESHED; refetching then caused global loading flashes.
    }, [auth?.user?.id]);

    useEffect(() => {
        if (!auth?.user?.id || !supabase) return;
        void mergeNetWorthSnapshotsFromServer(supabase, auth.user.id);
    }, [auth?.user?.id]);

    /** FX map hydration runs idle via CanonicalFinancialMetricsProvider — avoid sync loop on data reset. */
    const fxHydrateKeyRef = useRef<number | null>(null);
    useEffect(() => {
        fxHydrateKeyRef.current = dataResetKey;
    }, [dataResetKey]);

    // Helper to add user_id to any object
    const withUser = (obj: any) => ({ ...obj, user_id: auth?.user?.id });

    const _internalResetData = async () => {
        if (!supabase || !auth?.user) return;
        const db = supabase;
        setLoading(true);
        financialDataLoadedRef.current = false;
        setAwaitingInitialHydrate(true);
        const tables = [
            'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'holdings',
            'investment_portfolios', 'investment_transactions', 'budgets', 'watchlist',
            'zakat_payments', 'price_alerts', 'settings', 'commodity_holdings', 'planned_trades',
            'investment_plan', 'portfolio_universe', 'status_change_log', 'execution_logs',
            'recurring_transactions',
            'budget_requests',
            'sukuk_payout_events',
            'sukuk_payout_schedules',
            'sukuk_positions',
        ];
        // allSettled so missing tables (e.g. recurring_transactions) don't fail the whole reset
        await Promise.allSettled(tables.map(table => db.from(table).delete().eq('user_id', auth.user!.id)));
        setData(initialData);
        setDataResetKey((k) => k + 1);
        clearWorkspaceHydrateCache(auth.user!.id);
        financialDataLoadedRef.current = true;
        setAwaitingInitialHydrate(false);
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
            setAwaitingInitialHydrate(true);
            financialDataLoadedRef.current = false;
            await _internalResetData();
            if (!supabase || !auth?.user) return { ok: false, error: 'Session lost' };
            setLoading(true);
            setAwaitingInitialHydrate(true);
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
            const sukukPositionsBackup = arr(backup.sukukPositions);
            if (sukukPositionsBackup.length) {
                const rows = sukukPositionsBackup.map((p: SukukPosition) => ({
                    id: p.id,
                    user_id: uid,
                    ...sukukPositionToRow(p),
                }));
                const { error } = await db.from('sukuk_positions').insert(rows);
                if (error) console.warn('Restore sukuk_positions:', error);
            }
            const sukukSchedulesBackup = arr(backup.sukukPayoutSchedules);
            if (sukukSchedulesBackup.length) {
                const rows = sukukSchedulesBackup.map((s: SukukPayoutSchedule) => ({
                    id: s.id,
                    user_id: uid,
                    ...sukukPayoutScheduleToRow(s),
                }));
                const { error } = await db.from('sukuk_payout_schedules').insert(rows);
                if (error) console.warn('Restore sukuk_payout_schedules:', error);
            }
            const sukukEventsBackup = arr(backup.sukukPayoutEvents);
            if (sukukEventsBackup.length) {
                const rows = sukukEventsBackup.map((e: SukukPayoutEvent) => ({
                    id: e.id,
                    user_id: uid,
                    ...sukukPayoutEventToRow(e),
                }));
                const { error } = await db.from('sukuk_payout_events').insert(rows);
                if (error) console.warn('Restore sukuk_payout_events:', error);
            }
            const investments = arr(backup.investments);
            if (investments.length) {
                const portfolioRows = investments.map((p: any) => {
                    const { holdings: _h, ...rest } = p;
                    const accountId = rest.accountId ?? rest.account_id;
                    return {
                        id: rest.id,
                        user_id: uid,
                        ...investmentPortfolioToRow({
                            name: String(rest.name ?? 'Portfolio'),
                            accountId: String(accountId ?? ''),
                            goalId: rest.goalId ?? rest.goal_id,
                            owner: rest.owner,
                            currency: rest.currency,
                        }),
                    };
                }).filter((r: Record<string, unknown>) => Boolean(r.id && r.account_id));
                if (portfolioRows.length) {
                    const { error: ep } = await db.from('investment_portfolios').insert(portfolioRows);
                    if (ep) console.warn('Restore investment_portfolios:', ep);
                }
                const allHoldings = investments.flatMap((p: any) =>
                    (p.holdings ?? []).map((h: any) => {
                        const portfolioId = h.portfolio_id ?? h.portfolioId ?? p.id;
                        const mapped = holdingToRow({
                            ...h,
                            portfolio_id: portfolioId,
                            quantity: Number(h.quantity ?? 0),
                        });
                        return {
                            ...(h.id ? { id: h.id } : {}),
                            user_id: uid,
                            ...mapped,
                        };
                    }),
                );
                if (allHoldings.length) {
                    const { error: eh } = await db.from('holdings').insert(allHoldings);
                    if (eh) console.warn('Restore holdings:', eh);
                }
            }
            const invTx = arr(backup.investmentTransactions);
            if (invTx.length) {
                const invRows = invTx
                    .map((t: any): Record<string, unknown> => {
                        const mapped = investmentTransactionToRow(
                            {
                                id: t.id,
                                accountId: t.accountId ?? t.account_id,
                                portfolioId: t.portfolioId ?? t.portfolio_id,
                                date: t.date,
                                type: t.type,
                                symbol: t.symbol,
                                quantity: Number(t.quantity ?? 0),
                                price: Number(t.price ?? 0),
                                total: Number(t.total ?? 0),
                                currency: t.currency,
                                linkedCashAccountId: t.linkedCashAccountId ?? t.linked_cash_account_id,
                                idempotencyKey: t.idempotencyKey ?? t.idempotency_key,
                            } as InvestmentTransaction,
                            null,
                            { includeId: true },
                        );
                        return { user_id: uid, ...mapped };
                    })
                    .filter((r) => Boolean(r.account_id && r.date && r.type && r.symbol != null));
                if (invRows.length) {
                    const { error } = await db.from('investment_transactions').insert(invRows);
                    if (error) console.warn('Restore investment_transactions:', error);
                }
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
            financialDataLoadedRef.current = true;
            setAwaitingInitialHydrate(false);
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
    const addAsset = async (asset: Asset, opts?: RecordWriteOptions) => {
        if(!supabase || !auth?.user) {
            toast("You must be logged in to add an asset.", 'error');
            return;
        }
        const sanitized = normalizeAssetRow(asset);
        const v = validateAsset({
            name: sanitized.name,
            type: sanitized.type,
            value: sanitized.value,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const assetOk = await guardRecordWrite(opts, {
            title: 'Add asset?',
            message: 'Add this physical asset to your balance sheet?',
            confirmLabel: 'Add',
            details: [`${sanitized.name} (${sanitized.type})`, `Value: ${sanitized.value} SAR`],
        });
        if (!assetOk) return;
        const db = supabase;
        const { id: _omitId, user_id: _omitUid, notes: notesForDb, ...insertRest } = sanitized;
        const notesPayload =
            notesForDb != null && String(notesForDb).trim() !== '' ? String(notesForDb).trim() : null;
        const { data: newAsset, error } = await db
            .from('assets')
            .insert(withUser({ ...insertRest, notes: notesPayload }))
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
            notes: sanitized.notes,
        });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const db = supabase;
        const { id: _assetId, user_id: _uid, notes: notesForDb, ...updateRest } = sanitized;
        const notesPayload =
            notesForDb != null && String(notesForDb).trim() !== '' ? String(notesForDb).trim() : null;
        const { error } = await db
            .from('assets')
            .update({ ...updateRest, notes: notesPayload })
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
    const addGoal = async (goal: Goal, opts?: RecordWriteOptions) => {
        if(!supabase || !auth?.user) {
            toast("You must be logged in to add a goal.", 'error');
            return;
        }
        const v = validateGoal({ name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, deadline: goal.deadline });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const goalOk = await guardRecordWrite(opts, summarizeGoalForConfirm({
            name: goal.name,
            targetAmount: goal.targetAmount,
            deadline: goal.deadline,
        }));
        if (!goalOk) return;
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
    const addLiability = async (liability: Liability, opts?: RecordWriteOptions) => {
      if(!supabase || !auth?.user) return;
      const v = validateLiability({ name: liability.name, type: liability.type, amount: liability.amount, status: liability.status });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const liabOk = await guardRecordWrite(opts, summarizeLiabilityForConfirm({
        name: liability.name,
        type: liability.type,
        amount: Math.abs(liability.amount),
      }));
      if (!liabOk) return;
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
        let accountPatch: Account | null = null;
        if (
          normalized.type === 'Credit Card' &&
          normalized.accountId &&
          (normalized.status ?? 'Active') === 'Active'
        ) {
          const acc = (data?.accounts ?? []).find((a) => a.id === normalized.accountId);
          if (acc?.type === 'Credit') {
            const newBal = roundMoney(normalized.amount);
            const { error: ae } = await supabase
              .from('accounts')
              .update({ balance: newBal })
              .match({ id: acc.id, user_id: auth.user.id });
            if (!ae) accountPatch = { ...acc, balance: newBal };
            else console.warn('Could not mirror new credit card liability to account balance:', ae);
          }
        }
        setData((prev) => ({
          ...prev,
          liabilities: [...prev.liabilities, normalized],
          accounts: accountPatch ? prev.accounts.map((a) => (a.id === accountPatch!.id ? accountPatch! : a)) : prev.accounts,
        }));
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
      else {
        let accountPatch: Account | null = null;
        if (liability.type === 'Credit Card' && liability.accountId && (liability.status ?? 'Active') === 'Active') {
          const acc = (data?.accounts ?? []).find((a) => a.id === liability.accountId);
          if (acc?.type === 'Credit') {
            const newBal = roundMoney(liability.amount);
            const { error: ae } = await supabase
              .from('accounts')
              .update({ balance: newBal })
              .match({ id: acc.id, user_id: auth.user.id });
            if (!ae) accountPatch = { ...acc, balance: newBal };
            else console.warn('Could not mirror credit card liability to account balance:', ae);
          }
        }
        setData((prev) => ({
          ...prev,
          liabilities: prev.liabilities.map((l) => (l.id === liability.id ? liability : l)),
          accounts: accountPatch ? prev.accounts.map((a) => (a.id === accountPatch!.id ? accountPatch! : a)) : prev.accounts,
        }));
      }
    };
    const deleteLiability = async (liabilityId: string) => {
      if(!supabase || !auth?.user) return;
      const db = supabase;
      const { error } = await db.from('liabilities').delete().match({ id: liabilityId, user_id: auth.user.id });
      if(error) console.error("Error deleting liability:", error);
      else setData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== liabilityId) }));
    };

    // --- Budgets ---
    const addBudget = async (budget: Omit<Budget, 'id' | 'user_id'>, opts?: RecordWriteOptions) => {
      if(!supabase) return;
      const v = validateBudget({ category: budget.category, month: budget.month, year: budget.year, limit: budget.limit, period: (budget as Budget).period });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const budgetOk = await guardRecordWrite(opts, summarizeBudgetForConfirm({
        category: budget.category,
        limit: budget.limit,
        month: budget.month,
        year: budget.year,
      }));
      if (!budgetOk) return;
      const db = supabase;
      const payload: Record<string, unknown> = { ...withUser(budget) as Record<string, unknown> };
      if (budget.destinationAccountId != null) payload.destination_account_id = budget.destinationAccountId;
      if (budget.goalId != null && String(budget.goalId).trim() !== '') payload.goal_id = budget.goalId;
      else payload.goal_id = null;
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
        const withPeriod = {
          ...newBudget,
          period: (budget as Budget).period,
          tier: (budget as Budget).tier,
          destinationAccountId: (newBudget as any).destination_account_id ?? undefined,
          goalId: (newBudget as any).goal_id ?? (budget as Budget).goalId ?? undefined,
        };
        if ((budget as Budget).period === 'yearly' || (budget as Budget).period === 'weekly' || (budget as Budget).period === 'daily') withPeriod.limit = budget.limit;
        setData(prev => ({ ...prev, budgets: [...prev.budgets, withPeriod] }));
      }
    };
    const updateBudget = async (budget: Budget) => {
      if (!supabase || !auth?.user) return;
      const v = validateBudget({ category: budget.category, month: budget.month, year: budget.year, limit: budget.limit, period: budget.period });
      if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
      const db = supabase;
      const { category, month, year, limit, period, tier, destinationAccountId, goalId } = budget;
      const payload: Record<string, unknown> = {
        limit,
        period,
        tier,
      };
      if (destinationAccountId !== undefined) payload.destination_account_id = destinationAccountId;
      if (goalId !== undefined) payload.goal_id = goalId != null && String(goalId).trim() !== '' ? goalId : null;
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
            ? { ...b, limit, period, tier, destinationAccountId, goalId }
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
        const monthStartDay = resolveMonthStartDayFromData(data);
        const targetKey = { year: targetYear, month: targetMonth };
        const sourceKey = addMonthsToKey(targetKey, -1);

        const { data: allUserBudgets, error } = await supabase.from('budgets').select('*').eq('user_id', auth.user.id);
        if (error) { console.error("Error fetching source budgets:", error); toast("Could not fetch last month's budgets.", 'warning'); return; }
        const sourceBudgets = (allUserBudgets ?? []).filter((b) =>
            budgetAppliesToFinancialView(b, sourceKey, monthStartDay, 'Monthly'),
        );
        if (!sourceBudgets || sourceBudgets.length === 0) { toast("No budgets found for the previous month to copy.", 'info'); return; }

        const existingTargetCategories = new Set(
            (data?.budgets ?? [])
                .filter((b) => budgetAppliesToFinancialView(b, targetKey, monthStartDay, 'Monthly'))
                .map((b) => b.category),
        );
        
        const budgetsToInsert = sourceBudgets
            .filter((b: any) => !existingTargetCategories.has(b.category))
            .map((b: any) => {
                const { id, user_id, ...rest } = b;
                return {
                    ...rest,
                    month: targetMonth,
                    year: targetYear,
                    period: b.period ?? 'monthly',
                    destination_account_id: b.destination_account_id ?? undefined,
                    goal_id: b.goal_id ?? b.goalId ?? null,
                };
            });

        if (budgetsToInsert.length === 0) { toast("All budgets from last month already exist for the selected month.", 'info'); return; }

        const { data: insertedData, error: insertError } = await supabase.from('budgets').insert(budgetsToInsert.map(b => withUser(b))).select();
        if (insertError) { console.error("Error copying budgets:", insertError); toast("Failed to copy budgets.", 'error'); }
        else {
            const normalized = (insertedData || []).map((b: any) => ({
                ...b,
                period: b.period ?? 'monthly',
                tier: b.tier ?? b.budget_tier ?? 'Optional',
                destinationAccountId: b.destination_account_id ?? undefined,
                goalId: b.goal_id ?? b.goalId ?? undefined,
            }));
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
        note?: string;
    }) => {
        if (!supabase || !auth?.user) return;
        const currentUser = auth.user;
        const category = (tx.budgetCategory || '').trim();
        const status = (tx.status ?? 'Approved') as 'Pending' | 'Approved' | 'Rejected';
        const isExpense = tx.type === 'expense';
        const splitLines = (() => {
            try {
                return parseSplitsFromNote(tx.note).splitLines ?? [];
            } catch {
                return [];
            }
        })();
        if ((!category && splitLines.length === 0) || !isExpense || status === 'Rejected') {
            await removeSharedBudgetTransactionMirror(tx.id);
            return;
        }

        const { data: shares } = await supabase
            .from('budget_shares')
            .select('owner_user_id, category')
            .eq('shared_with_user_id', auth.user.id)
            .then((r) => r, () => ({ data: [] as any[] } as any));

        const rows = (shares || []) as Array<{ owner_user_id?: string; category?: string | null }>;
        const splitAllocations = splitLines.length > 0
            ? splitLines
            : [{ category: category || 'Uncategorized', amount: Math.abs(Number(tx.amount) || 0) }];
        const splitTotal = splitAllocations.reduce((sum, line) => sum + Math.abs(Number(line.amount) || 0), 0);
        const parentAmountAbs = Math.abs(Number(tx.amount) || 0);
        const scale = splitTotal > 0 ? parentAmountAbs / splitTotal : 1;
        const normalizeShareCategory = (v: unknown) => String(v ?? '').trim().toLowerCase();
        const txCategories = new Set(
            splitAllocations
                .map((line) => normalizeShareCategory(line.category))
                .filter(Boolean),
        );
        const matchingShares = rows.filter((row) => {
            const shareCat = normalizeShareCategory(row.category);
            return !shareCat || shareCat === 'all' || txCategories.has(shareCat);
        });
        if (matchingShares.length === 0) {
            await removeSharedBudgetTransactionMirror(tx.id);
            return;
        }

        await removeSharedBudgetTransactionMirror(tx.id);

        const payload = matchingShares
            .map((r) => ({ ownerId: r.owner_user_id, sharedCategory: String(r.category ?? '').trim() }))
            .filter((row): row is { ownerId: string; sharedCategory: string } => Boolean(row.ownerId) && row.ownerId !== currentUser.id)
            .flatMap((row) => {
                const ownerId = row.ownerId;
                const explicitShareCategory = normalizeShareCategory(row.sharedCategory);
                return splitAllocations
                    .filter((line) => {
                        const allocCat = normalizeShareCategory(line.category);
                        if (!allocCat) return false;
                        if (!explicitShareCategory || explicitShareCategory === 'all') return true;
                        return explicitShareCategory === allocCat;
                    })
                    .map((line) => ({
                        owner_user_id: ownerId,
                        contributor_user_id: currentUser.id,
                        contributor_email: currentUser.email ?? null,
                        source_transaction_id: tx.id,
                        budget_category: String(line.category || '').trim(),
                        amount: Math.abs(Number(line.amount) || 0) * scale,
                        transaction_date: tx.date,
                        description: tx.description,
                        status,
                    }));
            });

        if (payload.length === 0) return;
        await supabase.from('budget_shared_transactions').upsert(payload).then(() => {}, () => {});
    };

    /** Keep Checking/Savings/Credit `balance` aligned with the personal transaction ledger.
     * Uses cashBalanceAccumulatorRef when multiple transactions hit the same account in a loop (e.g. applyRecurringForMonth). */
    const applyLedgerAccountDeltaForTransaction = async (accountId: string | undefined, delta: number) => {
        if (!accountId || !supabase || !auth?.user) return;
        const d = Number(delta);
        if (!Number.isFinite(d) || d === 0) return;
        const up = updatePlatformRef.current;
        if (!up) return;
        const snap = dataRef.current ?? data;
        const acc = (snap?.accounts ?? []).find((a) => a.id === accountId);
        if (!acc || (acc.type !== 'Checking' && acc.type !== 'Savings' && acc.type !== 'Credit')) return;
        const prevBalance = cashBalanceAccumulatorRef.current[accountId] ?? Number(acc.balance ?? 0);
        const newBalance = prevBalance + d;
        cashBalanceAccumulatorRef.current[accountId] = newBalance;
        await up({ ...acc, balance: newBalance }, { fromTransactionDelta: true });
    };

    /** Keep Investment platform `balance` aligned with investment transaction cash flows (buy/sell/deposit/withdrawal/dividend). */
    const applyInvestmentAccountDeltaForTrade = async (
        accountId: string | undefined,
        delta: number,
        opts?: { includeTransaction?: InvestmentTransaction; excludeTransactionId?: string },
    ) => {
        if (!accountId || !supabase || !auth?.user) return;
        const d = Number(delta);
        if (!Number.isFinite(d) || d === 0) return;
        const up = updatePlatformRef.current;
        if (!up) return;
        // Prefer dataRef — applyFinancialDataPatch updates it eagerly before React commits.
        const snap = dataRef.current ?? data;
        const acc = (snap?.accounts ?? []).find((a) => a.id === accountId);
        if (!acc || acc.type !== 'Investment') return;
        const accountCurrency: TradeCurrency = acc.currency === 'USD' ? 'USD' : 'SAR';
        const txCurrencyRaw = opts?.includeTransaction?.currency;
        const txCurrency: TradeCurrency =
            txCurrencyRaw === 'USD' || txCurrencyRaw === 'SAR' ? txCurrencyRaw : accountCurrency;
        const sarPerUsd = resolveSarPerUsd(snap ?? null);
        const deltaInAccountCurrency = txCurrency === accountCurrency
            ? d
            : fromSAR(toSAR(d, txCurrency, sarPerUsd), accountCurrency, sarPerUsd);
        const prevBalance = cashBalanceAccumulatorRef.current[accountId] ?? Number(acc.balance ?? 0);
        const newBalance = roundMoney(prevBalance + deltaInAccountCurrency);
        cashBalanceAccumulatorRef.current[accountId] = newBalance;
        await up({ ...acc, balance: newBalance }, { fromTransactionDelta: true });
    };

    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'user_id'>, opts?: RecordWriteOptions) => {
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
        const postingAccount = (data?.accounts ?? []).find((a) => a.id === transaction.accountId);
        const postingPolicy = canPostTransactionToAccount(postingAccount, {
            transactionType: transaction.type,
            category: transaction.category,
        });
        if (!postingPolicy.allowed) {
            toast(postingPolicy.reason ?? 'Transaction blocked by account posting policy.', 'error');
            return;
        }
        const txConfirm = summarizeTransactionForConfirm(
            { ...transaction, id: 'new' } as Transaction,
            postingAccount?.name,
        );
        const txOk = await guardRecordWrite(opts, txConfirm);
        if (!txOk) return;
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
            /**
             * Always use app-side `recordTrade` path for investment↔cash transfers so transfer currency
             * is persisted consistently (RPC path may omit currency on some DB schemas).
             */
            try {
                toast('Transaction saved, but split/memo was not stored: add column `note` on `transactions`. Run supabase/migrations/add_transactions_note.sql in Supabase SQL.', 'info');
            } catch {}
        }
        if(error) {
            console.error("Error adding transaction:", error);
            const msg = String(error?.message || 'Unknown error');
            const detail = String(error?.details || '');
            const accountColMissing =
                /accountid|account_id/i.test(msg) && /column|schema cache|could not find/i.test(`${msg} ${detail}`);
            toast(
                accountColMissing
                    ? 'Failed to add transaction: transactions table is missing accountId. Run the latest Supabase migrations and refresh schema cache.'
                    : `Failed to add transaction: ${msg}`,
                'error'
            );
            throw error;
        }
        if (newTx) {
            const normalized = normalizeTransaction(newTx);
            startTransition(() => {
                setData((prev) => ({ ...prev, transactions: [normalized, ...prev.transactions] }));
            });
            await syncSharedBudgetTransactionMirror(normalized as any);
            auditChangeLog({
                action: 'create',
                entity: 'transaction',
                entityId: normalized.id,
                summary: `${normalized.type}: ${String(normalized.description ?? '').slice(0, 120)} · ${normalized.amount}`,
                userId: auth.user.id,
            });
            await applyLedgerAccountDeltaForTransaction(normalized.accountId, Number(normalized.amount) || 0);

            // Installment linkage: if this transaction is marked as an installment payment, mark that installment as PAID.
            // This prevents double-counting between (a) budget projection and (b) real expense transaction.
            try {
                const link = decodeInstallmentPaymentNote((normalized as any).note);
                if (link?.installmentId) {
                    // `installments` has no `user_id` column; ownership is via `installment_plans.user_id`.
                    // Verify ownership explicitly before updating (defense-in-depth; RLS remains the main gate).
                    const { data: owned } = await supabase
                        .from('installments')
                        .select('id, plan_id, installment_plans!inner(user_id)')
                        .eq('id', link.installmentId)
                        .eq('installment_plans.user_id', auth.user.id)
                        .maybeSingle();
                    if (!owned?.id) throw new Error('Installment not owned by current user.');
                    await supabase
                        .from('installments')
                        .update({
                            status: 'PAID',
                            paid_at: new Date(normalized.date).toISOString(),
                            failure_code: null,
                            failure_message: null,
                        })
                        .match({ id: link.installmentId });
                }
            } catch (e) {
                console.warn('Failed to mark installment as paid:', e);
            }
        }
    };
    const addTransfer = async (fromAccountId: string, toAccountId: string, amount: number, date?: string, note?: string, feeAmount?: number, opts?: RecordWriteOptions) => {
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
        const fromPostingPolicy = canPostTransactionToAccount(fromAcc, {
            transactionType: 'expense',
            category: 'Transfer',
        });
        if (!fromPostingPolicy.allowed) {
            toast(fromPostingPolicy.reason ?? 'Transfer blocked by account posting policy.', 'error');
            return;
        }
        const fromName = fromAcc?.name ?? fromAccountId;
        const toName = toAcc?.name ?? toAccountId;
        const dateStr = date ?? new Date().toISOString().split('T')[0];
        const fromCur = fromAcc?.currency === 'USD' ? 'USD' : 'SAR';
        const transferOk = await guardRecordWrite(
            opts,
            summarizeTransferForConfirm({
                amount: absAmount,
                fromName,
                toName,
                fromCurrency: fromCur,
                feeAmount: fee > 0 ? fee : undefined,
                note: note?.trim() || undefined,
            }),
        );
        if (!transferOk) return;
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
            /**
             * Use app-side `recordTrade` so investment cash transfer rows carry an explicit currency
             * and stay consistent with ledger calculations.
             */
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
                } as Parameters<typeof recordTrade>[0], undefined, { system: true });
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
                }, { system: true });
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
                }, { system: true });
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
            /**
             * Use app-side `recordTrade` so investment cash transfer rows carry an explicit currency
             * and stay consistent with ledger calculations.
             */
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
                } as Parameters<typeof recordTrade>[0], undefined, { system: true });
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
                }, { system: true });
            }
            if (fee > 0) {
                const feeAccountId = linkedCashAccountId ?? fromAccountId;
                await addTransaction({
                    date: dateStr,
                    description: `Transfer fee from ${fromName}`,
                    amount: -fee,
                    type: 'expense',
                    accountId: feeAccountId,
                    category: 'Fee',
                    transferGroupId,
                    transferRole: 'fee',
                }, { system: true });
            }
            return;
        }

        const rate = resolveSarPerUsd(data ?? null, (data as any)?.investmentPlan?.fxRate);
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
            startTransition(() => {
                setData((prev) => ({ ...prev, transactions: [...normalizedRows, ...prev.transactions] }));
            });
            for (const row of normalizedRows) {
                await syncSharedBudgetTransactionMirror(row as any);
                auditChangeLog({
                    action: 'create',
                    entity: 'transaction',
                    entityId: row.id,
                    summary: `${row.type}: ${String(row.description ?? '').slice(0, 120)} · ${row.amount}`,
                    userId: auth.user.id,
                });
                await applyLedgerAccountDeltaForTransaction(row.accountId, Number(row.amount) || 0);
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
        }, { system: true });
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
            }, { system: true });
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
        }, { system: true });
    };
    const updateTransaction = async (transaction: Transaction, opts?: RecordWriteOptions) => {
        if(!supabase || !auth?.user) return;
        const core = validateTransactionCore({ date: transaction.date, amount: transaction.amount, accountId: transaction.accountId, description: transaction.description });
        if (!core.valid) { toast(core.errors.join('\n'), 'error'); return; }
        const postingAccount = (data?.accounts ?? []).find((a) => a.id === transaction.accountId);
        const updateOk = await guardRecordWrite(opts, summarizeUpdateTransactionForConfirm(transaction, postingAccount?.name));
        if (!updateOk) return;
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
            const postingAccount = (data?.accounts ?? []).find((a) => a.id === normalized.accountId);
            const postingPolicy = canPostTransactionToAccount(postingAccount, {
                transactionType: normalized.type,
                category: normalized.category,
            });
            if (!postingPolicy.allowed) {
                toast(postingPolicy.reason ?? 'Transaction blocked by account posting policy.', 'error');
                return;
            }
            if (prev) {
                if (prev.accountId === normalized.accountId) {
                    await applyLedgerAccountDeltaForTransaction(
                        normalized.accountId,
                        (Number(normalized.amount) || 0) - (Number(prev.amount) || 0)
                    );
                } else {
                    await applyLedgerAccountDeltaForTransaction(prev.accountId, -(Number(prev.amount) || 0));
                    await applyLedgerAccountDeltaForTransaction(normalized.accountId, Number(normalized.amount) || 0);
                }
            }
            startTransition(() => {
                setData((prevState) => ({
                    ...prevState,
                    transactions: prevState.transactions.map((t) => (t.id === transaction.id ? normalized : t)),
                }));
            });
            await syncSharedBudgetTransactionMirror(normalized as any);
            auditChangeLog({
                action: 'update',
                entity: 'transaction',
                entityId: transaction.id,
                summary: `${normalized.type}: ${String(normalized.description ?? '').slice(0, 120)}`,
                userId: auth.user.id,
            });

            // If installment link changed, keep installment status consistent.
            try {
                const prevLink = decodeInstallmentPaymentNote((prev as any)?.note);
                const nextLink = decodeInstallmentPaymentNote((normalized as any)?.note);
                const prevId = prevLink?.installmentId ?? null;
                const nextId = nextLink?.installmentId ?? null;
                if (prevId && prevId !== nextId) {
                    const { data: ownedPrev } = await supabase
                        .from('installments')
                        .select('id, plan_id, installment_plans!inner(user_id)')
                        .eq('id', prevId)
                        .eq('installment_plans.user_id', auth.user.id)
                        .maybeSingle();
                    if (ownedPrev?.id) {
                        await supabase.from('installments').update({ status: 'SCHEDULED', paid_at: null }).match({ id: prevId });
                    }
                }
                if (nextId) {
                    const { data: ownedNext } = await supabase
                        .from('installments')
                        .select('id, plan_id, installment_plans!inner(user_id)')
                        .eq('id', nextId)
                        .eq('installment_plans.user_id', auth.user.id)
                        .maybeSingle();
                    if (!ownedNext?.id) throw new Error('Installment not owned by current user.');
                    await supabase
                        .from('installments')
                        .update({ status: 'PAID', paid_at: new Date(normalized.date).toISOString() })
                        .match({ id: nextId });
                }
            } catch (e) {
                console.warn('Failed to sync installment link on update:', e);
            }
        }
    };
    const deleteTransaction = async (transactionId: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        const prevTx = data?.transactions?.find((t) => t.id === transactionId);
        const { error } = await db.from('transactions').delete().match({ id: transactionId, user_id: auth.user.id });
        if(error) console.error("Error deleting transaction:", error);
        else {
            await applyLedgerAccountDeltaForTransaction(prevTx?.accountId, -(Number(prevTx?.amount) || 0));
            startTransition(() => {
                setData((prev) => ({ ...prev, transactions: prev.transactions.filter((t) => t.id !== transactionId) }));
            });
            await removeSharedBudgetTransactionMirror(transactionId);
            auditChangeLog({
                action: 'delete',
                entity: 'transaction',
                entityId: transactionId,
                summary: prevTx ? `Removed: ${String(prevTx.description ?? '').slice(0, 120)}` : 'Transaction removed',
                userId: auth.user.id,
            });

            // If deleted transaction was an installment payment, unmark it so budgets project it again.
            try {
                const link = decodeInstallmentPaymentNote((prevTx as any)?.note);
                if (link?.installmentId) {
                    const { data: owned } = await supabase
                        .from('installments')
                        .select('id, plan_id, installment_plans!inner(user_id)')
                        .eq('id', link.installmentId)
                        .eq('installment_plans.user_id', auth.user.id)
                        .maybeSingle();
                    if (owned?.id) {
                        await supabase.from('installments').update({ status: 'SCHEDULED', paid_at: null }).match({ id: link.installmentId });
                    }
                }
            } catch (e) {
                console.warn('Failed to unmark installment on delete:', e);
            }
        }
    };

    // --- Recurring transactions ---
    const addRecurringTransaction = async (recurring: Omit<RecurringTransaction, 'id' | 'user_id'>, opts?: RecordWriteOptions) => {
        if (!supabase || !auth?.user) return;
        const v = validateRecurringTransaction({ description: recurring.description, amount: recurring.amount, type: recurring.type, accountId: recurring.accountId, category: recurring.category, dayOfMonth: recurring.dayOfMonth });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const acc = (data?.accounts ?? []).find((a) => a.id === recurring.accountId);
        const recOk = await guardRecordWrite(opts, summarizeRecurringForConfirm({
            description: recurring.description,
            amount: recurring.amount,
            type: recurring.type,
            dayOfMonth: recurring.dayOfMonth,
            accountName: acc?.name,
        }));
        if (!recOk) return;
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

    const applyRecurringRuleForMonth = async (
        recurringId: string,
        year: number,
        month: number,
    ): Promise<{ applied: boolean; skipped: boolean; skipReason?: 'disabled' | 'manual' | 'already' | 'not_found' }> => {
        const rule = data.recurringTransactions.find((r) => r.id === recurringId);
        if (!rule) return { applied: false, skipped: true, skipReason: 'not_found' };
        if (!rule.enabled) return { applied: false, skipped: true, skipReason: 'disabled' };
        if (rule.addManually === true) return { applied: false, skipped: true, skipReason: 'manual' };
        if (!supabase || !auth?.user) return { applied: false, skipped: true };

        const monthStartDay = resolveMonthStartDayFromData(data);
        const finKey = { year, month };
        const { start, end } = financialMonthRangeFromKey(finKey, monthStartDay);
        let postDate: Date;
        if (monthStartDay === 1) {
            postDate = effectiveMonthStartDate(year, month, rule.dayOfMonth);
        } else {
            const preferred = effectiveMonthStartDate(finKey.year, finKey.month, rule.dayOfMonth);
            postDate =
                preferred.getTime() >= start.getTime() && preferred.getTime() <= end.getTime()
                    ? preferred
                    : start;
        }
        const date = postDate.toISOString().slice(0, 10);
        const already = (data?.transactions ?? []).some((t) => {
            const rid = t.recurringId ?? (t as any).recurring_id;
            if (rid !== rule.id) return false;
            return dateInRange(t.date, start, end);
        });
        if (already) return { applied: false, skipped: true, skipReason: 'already' };

        cashBalanceAccumulatorRef.current = {};
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
            }, { system: true });
            cashBalanceAccumulatorRef.current = {};
            return { applied: true, skipped: false };
        } catch (_) {
            cashBalanceAccumulatorRef.current = {};
            return { applied: false, skipped: true };
        }
    };

    const applyRecurringForMonth = async (year: number, month: number): Promise<{ applied: number; skipped: number }> => {
        if (!supabase || !auth?.user) return { applied: 0, skipped: 0 };
        cashBalanceAccumulatorRef.current = {};
        const enabled = data.recurringTransactions.filter((r) => r.enabled && !(r.addManually === true));
        let applied = 0;
        let skipped = 0;
        for (const rule of enabled) {
            const res = await applyRecurringRuleForMonth(rule.id, year, month);
            if (res.applied) applied++;
            else if (res.skipped) skipped++;
        }
        cashBalanceAccumulatorRef.current = {};
        return { applied, skipped };
    };

    /** Apply recurring rules that are due today (dayOfMonth === today) and not addManually. Called after data load, once per day.
     * dayOfMonth is stored clamped to 1–28, so on the 29th/30th/31st we treat dayOfMonth 28 as due (end-of-month); we use effectiveDateStr 28th so duplicates are detected by applyRecurringForMonth. */
    const applyRecurringDueToday = useCallback(async (): Promise<number> => {
        if (!supabase || !auth?.user) return 0;
        const snapshot = dataRef.current;
        if (!snapshot) return 0;
        cashBalanceAccumulatorRef.current = {};
        const today = new Date();
        const monthStartDay = resolveMonthStartDayFromData(snapshot);
        const { start: fmStart, end: fmEnd } = financialMonthRange(today, monthStartDay);
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        const day = today.getDate();
        const monthStr = String(month).padStart(2, '0');
        const dayStr = (d: number) => String(d).padStart(2, '0');
        // dayOfMonth is clamped to 1–28, so (dayOfMonth > lastDayOfMonth) is never true; only exact match and EOM-28 apply
        const isDueToday = (r: { dayOfMonth: number }) =>
            r.dayOfMonth === day || (day >= 28 && r.dayOfMonth === 28);
        const toApply = (snapshot.recurringTransactions ?? []).filter(
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
            const already = (transactionsRef.current ?? []).some((t) => {
                if ((t.recurringId ?? (t as any).recurring_id) !== rule.id) return false;
                return dateInRange(t.date, fmStart, fmEnd);
            });
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
                }, { system: true });
                appliedThisRun.add(key);
                applied++;
            } catch (err) {
                // Re-throw so the effect's .catch() runs and clears the sessionStorage lock, allowing retry later
                throw err;
            }
        }
        cashBalanceAccumulatorRef.current = {};
        return applied;
    }, [data, addTransaction, supabase, auth?.user?.id]);

    // Auto-apply recurring transactions due today (dayOfMonth === today, addManually === false), once per calendar day.
    // Intentionally omit data.transactions from this effect so it does not re-run on every new tx (avoids loop); duplicate check uses transactionsRef.
    // applyRecurringDueToday reads settings/rules via dataRef at invoke time and lists `data` in its deps when rules/settings change.
    useEffect(() => {
        if (
            loading ||
            awaitingInitialHydrate ||
            !financialDataHasHydrated(data) ||
            !auth?.user ||
            !data.recurringTransactions?.length ||
            recurringAutoApplyInFlightRef.current
        ) {
            return;
        }
        const todayStr = new Date().toDateString();
        const storageKey = `recurring_auto_apply_${auth.user.id}`;
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(storageKey) === todayStr) return;
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(storageKey, todayStr);
        recurringAutoApplyInFlightRef.current = true;
        applyRecurringDueToday()
            .catch(() => {
                if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey);
            })
            .finally(() => {
                recurringAutoApplyInFlightRef.current = false;
            });
    }, [loading, awaitingInitialHydrate, data, auth?.user?.id, data.recurringTransactions, applyRecurringDueToday]);

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
        if (platform.accountRole) payload.account_role = platform.accountRole;
        if (platform.bucketType) payload.bucket_type = platform.bucketType;
        
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
            let liabilityPatch: Liability | null = null;
            if (normalized.type === 'Credit') {
              const liab = findCreditCardLiabilityForAccount(data?.liabilities ?? [], normalized.id);
              if (liab && (liab.status ?? 'Active') === 'Active') {
                const newAmt = roundMoney(normalized.balance);
                if (Math.abs(newAmt - Number(liab.amount ?? 0)) > 0.0001) {
                  const { error: le } = await supabase
                    .from('liabilities')
                    .update({ amount: newAmt })
                    .match({ id: liab.id, user_id: auth.user.id });
                  if (!le) liabilityPatch = { ...liab, amount: newAmt };
                  else console.warn('Could not mirror credit account balance to liability:', le);
                }
              }
            }
            applyFinancialDataPatch((prev) => ({
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === platform.id ? normalized : a)),
              liabilities: liabilityPatch
                ? prev.liabilities.map((l) => (l.id === liabilityPatch!.id ? liabilityPatch! : l))
                : prev.liabilities,
            }));
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
            const msg = v.errors.join('\n');
            toast(msg, 'error');
            /** Throw so trade/CA callers cannot claim success after a silent no-op. */
            throw new Error(msg);
        }
        const portfolioKey = String(
            holding.portfolio_id ?? (holding as { portfolioId?: string }).portfolioId ?? '',
        );
        const sym = String(holding.symbol ?? '').trim().toUpperCase();
        /**
         * Never insert a second row for the same portfolio+symbol (LCID ghost path).
         * Callers must update the existing row; DB unique index is the hard backstop.
         */
        if (portfolioKey && sym) {
            const pf = (dataRef.current?.investments ?? []).find((p) => p.id === portfolioKey);
            const existing = (pf?.holdings ?? []).find(
                (h) => String(h.symbol ?? '').trim().toUpperCase() === sym && h.id,
            );
            if (existing) {
                throw new Error(
                    `Holding ${sym} already exists in this portfolio — refusing duplicate insert.`,
                );
            }
        }
        const row = holdingToRow(holding);
        const { data: newHolding, error } = await supabase.from('holdings').insert(withUser(row)).select().single();
        if (error) { console.error("Error adding holding:", error); throw new Error(formatDbError(error)); }
        if (newHolding) {
            const normalized = normalizeHoldingFromRow(newHolding);
            const portfolioIdKey = newHolding.portfolio_id ?? (newHolding as any).portfolioId;
            applyFinancialDataPatch((prev) => ({
                ...prev,
                investments: prev.investments.map((p) =>
                    p.id === portfolioIdKey ? { ...p, holdings: [...p.holdings, normalized] } : p,
                ),
            }));
            bumpHoldingsBookGeneration();
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
        if (!v.valid) {
            const msg = v.errors.join('\n');
            toast(msg, 'error');
            /** Throw so applyPositionDeltaForTrade / CA sync cannot claim success after a silent no-op. */
            throw new Error(msg);
        }
        const prevQty = (() => {
            for (const p of dataRef.current?.investments ?? []) {
                const h = p.holdings.find((x) => x.id === holding.id);
                if (h) return Math.max(0, Number(h.quantity) || 0);
            }
            return null;
        })();
        const db = supabase;
        const row = holdingToRow(holding);
        const { error } = await db.from('holdings').update(row).match({ id: holding.id, user_id: auth.user.id });
        if (error) {
            console.error(error);
            throw new Error(formatDbError(error));
        } else {
            applyFinancialDataPatch((prev) => ({
                ...prev,
                investments: prev.investments.map((p) => ({
                    ...p,
                    holdings: p.holdings.map((h) => (h.id === holding.id ? holding : h)),
                })),
            }));
            const nextQty = Math.max(0, Number(holding.quantity) || 0);
            if (prevQty == null || Math.abs(prevQty - nextQty) > 1e-9) {
                bumpHoldingsBookGeneration();
            }
        }
    };
    const deleteHolding = async (holdingId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('holdings').delete().match({ id: holdingId, user_id: auth.user.id });
        if (error) { console.error("Error deleting holding:", error); throw new Error(formatDbError(error)); }
        applyFinancialDataPatch((prev) => ({
            ...prev,
            investments: prev.investments.map((p) => ({
                ...p,
                holdings: p.holdings.filter((h) => h.id !== holdingId),
            })),
        }));
        bumpHoldingsBookGeneration();
    };
    const restoreHoldingRowsAfterTradeRollback = async (args: {
        portfolioId: string;
        symbol: string;
        holdings: Holding[];
    }) => {
        if (!supabase || !auth?.user) throw new Error('Cannot restore holdings without an authenticated database.');
        const userId = auth.user.id;
        if (args.holdings.some((holding) => !holding.id)) {
            throw new Error('Cannot restore a holding snapshot without row ids.');
        }
        const rows = args.holdings.map((holding) => ({
            id: holding.id,
            ...holdingToRow({ ...holding, portfolio_id: args.portfolioId }),
            user_id: userId,
        }));
        if (rows.length > 0) {
            const { error } = await supabase.from('holdings').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatDbError(error));
        }

        const { data: currentRows, error: currentRowsError } = await supabase
            .from('holdings')
            .select('id, symbol')
            .eq('user_id', userId)
            .eq('portfolio_id', args.portfolioId);
        if (currentRowsError) throw new Error(formatDbError(currentRowsError));
        const originalIds = new Set(args.holdings.map((holding) => holding.id));
        const extraIds = (currentRows ?? [])
            .filter((row) => String(row.symbol ?? '').trim().toUpperCase() === args.symbol.toUpperCase())
            .map((row) => String(row.id ?? ''))
            .filter((id) => id && !originalIds.has(id));
        if (extraIds.length > 0) {
            const { error } = await supabase
                .from('holdings')
                .delete()
                .eq('user_id', userId)
                .in('id', extraIds);
            if (error) throw new Error(formatDbError(error));
        }

        const symbolUpper = args.symbol.toUpperCase();
        applyFinancialDataPatch((prev) => ({
            ...prev,
            investments: prev.investments.map((portfolio) =>
                portfolio.id === args.portfolioId
                    ? {
                          ...portfolio,
                          holdings: [
                              ...portfolio.holdings.filter(
                                  (holding) => String(holding.symbol ?? '').toUpperCase() !== symbolUpper,
                              ),
                              ...args.holdings,
                          ],
                      }
                    : portfolio,
            ),
        }));
    };
    const syncPortfolioAfterLedgerMutation = async (
        portfolioId: string,
        overrides: {
            corporateActionEvents?: CorporateActionEvent[];
            investmentTransactions?: InvestmentTransaction[];
            holdingsBaselineMode?: import('../services/corporateActionApply').HoldingsReplayBaselineMode;
            /** Delta-only events for as_stored holdings replay (fresh CA apply/undo). */
            holdingsReplayEvents?: CorporateActionEvent[];
            /** Required — only these symbols are persisted from replay. */
            symbols: string[];
        },
    ) => {
        if (!auth?.user) return;
        const snapshot = dataRef.current;
        const portfolio = (snapshot?.investments ?? []).find((p) => p.id === portfolioId);
        if (!portfolio) return;
        const symbols = (overrides.symbols ?? [])
            .map((s) => String(s ?? '').trim().toUpperCase())
            .filter(Boolean);
        if (symbols.length === 0) {
            throw new Error('syncPortfolioAfterLedgerMutation requires at least one symbol.');
        }
        await syncPortfolioLedgerAfterChange({
            portfolio,
            investmentTransactions: overrides.investmentTransactions ?? snapshot?.investmentTransactions ?? [],
            corporateActionEvents: overrides.corporateActionEvents ?? snapshot?.corporateActionEvents ?? [],
            updateHolding,
            addHolding,
            deleteHolding,
            supabase,
            userId: auth.user.id,
            holdingsBaselineMode: overrides.holdingsBaselineMode ?? 'replay_derived',
            holdingsReplayEvents: overrides.holdingsReplayEvents,
            symbols,
            onLotsUpdated: (updatedLots) => {
                applyFinancialDataPatch((prev) => ({
                    ...prev,
                    investmentCostLots: [
                        ...updatedLots,
                        ...(prev.investmentCostLots ?? []).filter((l) => l.portfolioId !== portfolioId),
                    ],
                }));
            },
        });
    };

    /** Explicit repair: rebuild named symbols from portfolio_id ledger (never auto on trade). */
    const rebuildHoldingsFromLedgerForSymbols = async (args: {
        portfolioId: string;
        symbols: string[];
    }) => {
        if (!auth?.user) return;
        const snapshot = dataRef.current;
        const portfolio = (snapshot?.investments ?? []).find((p) => p.id === args.portfolioId);
        if (!portfolio) throw new Error('Portfolio not found');
        const symbols = args.symbols.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean);
        if (symbols.length === 0) throw new Error('Select at least one symbol to rebuild.');
        await rebuildHoldingsFromLedger({
            portfolio,
            investmentTransactions: filterTransactionsForPortfolio(
                args.portfolioId,
                snapshot?.investmentTransactions ?? [],
            ),
            corporateActionEvents: snapshot?.corporateActionEvents ?? [],
            symbols,
            updateHolding,
            addHolding,
            deleteHolding,
            resolveHolding: (sym) => {
                const pf = (dataRef.current?.investments ?? []).find((p) => p.id === args.portfolioId);
                return pf?.holdings.find((h) => String(h.symbol ?? '').toUpperCase() === sym);
            },
            supabase,
            userId: auth.user.id,
            onLotsUpdated: (updatedLots) => {
                applyFinancialDataPatch((prev) => ({
                    ...prev,
                    investmentCostLots: [
                        ...updatedLots,
                        ...(prev.investmentCostLots ?? []).filter((l) => l.portfolioId !== args.portfolioId),
                    ],
                }));
            },
        });
    };
    const applyCorporateActionEvent = async (args: {
        portfolioId: string;
        symbol: string;
        executionDate: string;
        action: CorporateAction;
        linkedSymbol?: string;
    }) => {
        if (!supabase || !auth?.user) return;
        if (corporateActionInFlightRef.current) {
            throw new Error('A corporate action is already in progress. Please wait.');
        }
        corporateActionInFlightRef.current = true;
        try {
        const snapshot = dataRef.current;
        const portfolio = (snapshot?.investments ?? []).find((p) => p.id === args.portfolioId);
        if (!portfolio) throw new Error('Portfolio not found');
        const symUpper = args.symbol.trim().toUpperCase();
        const holding = portfolio.holdings?.find((h) => String(h.symbol ?? '').toUpperCase() === symUpper);
        if (!holding || (Number(holding.quantity) || 0) <= 0) {
            throw new Error(`No holding for ${args.symbol} in this portfolio.`);
        }
        const prereq = validateCorporateActionApplyPrerequisites({
            portfolioId: args.portfolioId,
            symbol: args.symbol,
            transactions: snapshot?.investmentTransactions ?? [],
            corporateActionEvents: snapshot?.corporateActionEvents ?? [],
            accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
            holdingSymbols: (portfolio.holdings ?? []).map((h) => String(h.symbol ?? '')),
        });
        if (!prereq.valid) throw new Error(prereq.error ?? 'Corporate action prerequisites not met.');
        const payload = buildCorporateActionEventPayload({
            portfolioId: args.portfolioId,
            symbol: args.symbol,
            executionDate: args.executionDate,
            action: args.action,
            linkedSymbol: args.linkedSymbol,
        });
        const row = withUser({
            portfolio_id: payload.portfolio_id,
            action_type: payload.action_type,
            symbol: payload.symbol,
            linked_symbol: payload.linked_symbol,
            execution_date: payload.execution_date,
            ratio_numerator: payload.ratio_numerator,
            ratio_denominator: payload.ratio_denominator,
            cash_per_share: payload.cash_per_share,
            price_per_share: payload.price_per_share ?? null,
            cost_basis_allocation_pct: payload.cost_basis_allocation_pct,
            metadata: payload.metadata ?? {},
            idempotency_key: payload.idempotency_key,
            status: payload.status ?? 'applied',
        });
        const { data: inserted, error } = await supabase.from('corporate_action_events').insert(row).select().single();
        if (error) {
            if (error.code === 'PGRST205') {
                console.warn('corporate_action_events table missing — apply migration 20260706130000_corporate_actions_and_cost_lots.sql');
                return;
            }
            if (error.code === '23505') {
                return;
            }
            throw error;
        }
        if (!inserted) return;

        const ev: CorporateActionEvent = normalizeCorporateActionEventRow(inserted as Record<string, unknown>);
        const mergedEvents = [ev, ...(snapshot?.corporateActionEvents ?? [])];
        setData((prev) => ({
            ...prev,
            corporateActionEvents: mergedEvents,
        }));
        await yieldToMain();
        const replayTxs = filterTransactionsForPortfolioReplay({
            portfolioId: args.portfolioId,
            transactions: snapshot?.investmentTransactions ?? [],
            holdingSymbols: portfolio.holdings?.map((h) => String(h.symbol ?? '')),
            accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
        });
        const manualOnly = !hasPositionAffectingTransactions(replayTxs);
        const caSymbols = [args.symbol, args.linkedSymbol]
            .map((s) => String(s ?? '').trim().toUpperCase())
            .filter(Boolean);
        await syncPortfolioAfterLedgerMutation(args.portfolioId, {
            corporateActionEvents: mergedEvents,
            holdingsBaselineMode: manualOnly ? 'as_stored' : 'replay_derived',
            /** Delta-only is safe only when there are no ledger buys/sells (manual books). */
            ...(manualOnly ? { holdingsReplayEvents: [ev] } : {}),
            symbols: caSymbols,
        });

        adjustQuotesForCorporateActionNow({
            symbol: args.symbol,
            action: args.action,
            portfolioId: args.portfolioId,
        });

        if (corporateActionDepositsCash(args.action) && portfolio.accountId) {
            const preHolding = holding;
            const cashInLieu = computeCashInLieuDepositSar({
                action: args.action,
                holding: {
                    quantity: preHolding?.quantity ?? 0,
                    avgCost: preHolding?.avgCost ?? 0,
                },
            });
            if (cashInLieu > 0) {
                const depositKey = corporateActionCashDepositIdempotencyKey(
                    args.action.type === 'cash_in_lieu' ? 'cash_in_lieu' : 'reverse_stock_split',
                    payload.idempotency_key,
                );
                await recordTrade(
                    {
                        portfolioId: portfolio.id,
                        accountId: portfolio.accountId,
                        type: 'deposit',
                        symbol: args.symbol.toUpperCase(),
                        quantity: 0,
                        price: 0,
                        total: cashInLieu,
                        date: args.executionDate,
                        idempotencyKey: depositKey,
                    },
                    undefined,
                    { system: true },
                );
            }
        }
        } finally {
            corporateActionInFlightRef.current = false;
        }
    };

    const removeCorporateActionCashDeposits = async (idempotencyKey: string) => {
        if (!supabase || !auth?.user) return;
        const keys = corporateActionCashDepositIdempotencyKeysForEvent(idempotencyKey);
        const snapshot = dataRef.current;

        const { data: dbRows, error: fetchErr } = await supabase
            .from('investment_transactions')
            .select('*')
            .eq('user_id', auth.user.id)
            .eq('type', 'deposit')
            .in('idempotency_key', keys);
        if (fetchErr && fetchErr.code !== 'PGRST205') {
            console.warn('Corporate action deposit lookup failed:', fetchErr);
        }

        const depositsById = new Map<string, InvestmentTransaction>();
        for (const row of dbRows ?? []) {
            const normalized = normalizeInvestmentTransaction(row);
            if (normalized.id) depositsById.set(normalized.id, normalized);
        }
        for (const t of snapshot?.investmentTransactions ?? []) {
            if (t.type === 'deposit' && t.idempotencyKey && keys.includes(String(t.idempotencyKey)) && t.id) {
                depositsById.set(t.id, t);
            }
        }

        for (const deposit of depositsById.values()) {
            if (!deposit.id) continue;
            const { error } = await supabase
                .from('investment_transactions')
                .delete()
                .match({ id: deposit.id, user_id: auth.user.id });
            if (error) {
                console.warn('Corporate action deposit reversal failed:', error);
                continue;
            }
            const reverseDelta = -computeInvestmentTxCashDelta(deposit);
            setData((prev) => ({
                ...prev,
                investmentTransactions: prev.investmentTransactions.filter((t) => t.id !== deposit.id),
            }));
            const accountId = resolveCanonicalAccountId(deposit.accountId, snapshot?.accounts ?? []);
            if (reverseDelta !== 0) {
                await applyInvestmentAccountDeltaForTrade(accountId, reverseDelta);
            }
        }
    };

    const reverseCorporateActionEvent = async (eventId: string) => {
        if (!supabase || !auth?.user) return;
        if (corporateActionInFlightRef.current) {
            throw new Error('A corporate action is already in progress. Please wait.');
        }
        corporateActionInFlightRef.current = true;
        try {
        const snapshot = dataRef.current;
        const ev = (snapshot?.corporateActionEvents ?? []).find((e) => e.id === eventId);
        if (!ev || ev.status === 'reversed') throw new Error('Corporate action not found or already reversed.');
        const portfolio = (snapshot?.investments ?? []).find((p) => p.id === ev.portfolioId);
        if (!portfolio) throw new Error('Portfolio not found.');

        const reverseAction = buildReverseCorporateAction(corporateActionFromEvent(ev));
        const payload = buildCorporateActionEventPayload({
            portfolioId: ev.portfolioId,
            symbol: ev.symbol,
            executionDate: ev.executionDate,
            action: reverseAction,
            linkedSymbol: ev.linkedSymbol ?? undefined,
        });
        const reverseRow = withUser({
            ...payload,
            idempotency_key: `${payload.idempotency_key}|reverse|${eventId}`,
            status: 'applied',
        });
        const { data: inserted, error: insertErr } = await supabase
            .from('corporate_action_events')
            .insert(reverseRow)
            .select()
            .single();
        if (insertErr && insertErr.code !== 'PGRST205' && insertErr.code !== '23505') throw insertErr;

        const { error: markErr } = await supabase
            .from('corporate_action_events')
            .update({ status: 'reversed', reversed_by_event_id: inserted?.id ?? null })
            .match({ id: eventId, user_id: auth.user.id });
        if (markErr && markErr.code !== 'PGRST205') throw markErr;

        const reversalEv = normalizeCorporateActionEventRow(
            (inserted ?? { ...reverseRow, id: `local-reversal-${eventId}` }) as Record<string, unknown>,
        );
        const updatedEvents = (snapshot?.corporateActionEvents ?? []).map((e) =>
            e.id === eventId ? { ...e, status: 'reversed' as const } : e,
        );
        const mergedEvents = [reversalEv, ...updatedEvents];
        setData((prev) => ({
            ...prev,
            corporateActionEvents: mergedEvents,
        }));
        await removeCorporateActionCashDeposits(ev.idempotencyKey);
        await yieldToMain();
        const replayTxs = filterTransactionsForPortfolioReplay({
            portfolioId: ev.portfolioId,
            transactions: snapshot?.investmentTransactions ?? [],
            holdingSymbols: portfolio.holdings?.map((h) => String(h.symbol ?? '')),
            accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
        });
        const manualOnly = !hasPositionAffectingTransactions(replayTxs);
        const undoSymbols = [ev.symbol, ev.linkedSymbol]
            .map((s) => String(s ?? '').trim().toUpperCase())
            .filter(Boolean);
        await syncPortfolioAfterLedgerMutation(ev.portfolioId, {
            corporateActionEvents: mergedEvents,
            holdingsBaselineMode: manualOnly ? 'as_stored' : 'replay_derived',
            ...(manualOnly ? { holdingsReplayEvents: [reversalEv] } : {}),
            symbols: undoSymbols,
        });
        adjustQuotesForCorporateActionNow({
            symbol: ev.symbol,
            action: reverseAction,
            portfolioId: ev.portfolioId,
        });
        } finally {
            corporateActionInFlightRef.current = false;
        }
    };

    const batchUpdateHoldingValues = (updates: { id: string; currentValue: number }[]) => {
      startTransition(() => {
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
      });
    };
    const recordTrade = async (
        trade: { portfolioId?: string, name?: string, manualCurrentValue?: number, holdingType?: string, transferGroupId?: string } & Omit<InvestmentTransaction, 'id' | 'user_id'> & { total?: number },
        executedPlanId?: string,
        opts?: RecordWriteOptions,
    ) => {
        if (!supabase || !auth?.user) {
            return {
                insertedInvestmentTransactionId: null,
                insertedTradeTransactions: 0,
                insertedCashLedgerRows: 0,
                recomputed: false,
                cashDelta: 0,
                positionDelta: 0,
            };
        }
        if (tradeSubmissionInFlightRef.current) {
            throw new Error('A trade submission is already in progress. Please wait.');
        }
        const isCashFlow = trade.type === 'deposit' || trade.type === 'withdrawal' || trade.type === 'fee' || trade.type === 'vat';
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

        const portfolioForConfirm = (data?.investments ?? []).find((p) => p.id === trade.portfolioId);
        const accountForConfirm = (data?.accounts ?? []).find((a) => a.id === trade.accountId);
        const tradeOk = await guardRecordWrite(
            opts,
            summarizeInvestmentTradeForConfirm(trade, {
                portfolioName: portfolioForConfirm?.name,
                accountName: accountForConfirm?.name,
            }),
        );
        if (!tradeOk) {
            return {
                insertedInvestmentTransactionId: null,
                insertedTradeTransactions: 0,
                insertedCashLedgerRows: 0,
                recomputed: false,
                cashDelta: 0,
                positionDelta: 0,
            };
        }

        tradeSubmissionInFlightRef.current = true;
        let recomputed = false;
        let insertedInvestmentTransactionId: string | null = null;
        let insertedTradeTransactions = 0;
        let insertedCashLedgerRows = 0;
        let cashDeltaOut = 0;
        let positionDeltaOut = 0;
        try {
            const { portfolioId, name, assetClass: tradeAssetClass, manualCurrentValue: manualCvInput, holdingType: incomingHoldingType, fees: feesInput, goalId: tradeGoalId, ...tradeData } = trade as typeof trade & {
                assetClass?: string;
                manualCurrentValue?: number;
                holdingType?: string;
                fees?: number;
                goalId?: string;
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
        /** Ghost duplicate ids to delete — from resolveDuplicateHoldingsGroup (never sum). */
        let duplicateHoldingIdsForTrade: string[] = [];
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
            symbolHoldingsForTrade = portfolio.holdings
                .filter((h: Holding) => (h.symbol || '').trim().toUpperCase() === normalizedSymbol)
                .map((holding) => ({ ...holding }));
            /**
             * Never consolidateHoldingsBySymbol here — that sums ghost rows (LCID 500+1390→1890).
             * Pick one canonical row via resolveDuplicateHoldingsGroup; delete extras on apply.
             */
            if (symbolHoldingsForTrade.length === 1) {
                existingHolding = symbolHoldingsForTrade[0];
            } else if (symbolHoldingsForTrade.length > 1) {
                const resolved = resolveDuplicateHoldingsGroup({
                    holdings: symbolHoldingsForTrade,
                    portfolioId: portfolio.id,
                    symbol: normalizedSymbol,
                    transactions: data?.investmentTransactions ?? [],
                });
                existingHolding = resolved.keep;
                duplicateHoldingIdsForTrade = resolved.deleteIds;
                if (resolved.disagreed) {
                    console.warn(
                        `[holdings] Trade prep ${normalizedSymbol}: keeping qty ${resolved.keep.quantity}, discarding ${resolved.discardedQuantities.join('+')} (never sum).`,
                    );
                }
            }
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
        const explicitTotal = roundMoney(Math.max(0, Number(trade.total) || 0));
        const tradeTotal = isCashFlow || tradeData.type === 'dividend'
            ? explicitTotal
            : explicitTotal > 0
              ? explicitTotal
              : tradeData.type === 'buy'
                ? basisNotional + feesRecorded
                : tradeData.type === 'sell'
                  ? Math.max(0, basisNotional - feesRecorded)
                  : basisNotional;
        if (!isCashFlow && tradeData.type === 'sell' && explicitTotal <= 0 && feesRecorded > basisNotional + 1e-9) {
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
        if (tradeData.type === 'dividend') {
            const divExtra = validateDividendRecordInput({
                symbol: normalizedSymbol,
                date: trade.date,
                total: tradeTotal,
                portfolioId: portfolio?.id,
                accountId: accountIdForInsert,
            });
            if (!divExtra.valid) {
                throw new Error(divExtra.errors.join('\n'));
            }
            assertDividendNotDuplicate({
                transactions: data?.investmentTransactions ?? [],
                accounts: data?.accounts ?? [],
                accountId: accountIdForInsert,
                symbol: normalizedSymbol,
                payDate: trade.date,
                totalBook: tradeTotal,
                bookCurrency: txCurrency,
                portfolioId: portfolio?.id,
            });
        }
        if ((tradeData.type === 'withdrawal' || tradeData.type === 'fee' || tradeData.type === 'vat') && tradeTotal > availableInTxCurrency + 1e-9) {
            throw new Error(
                `Cannot withdraw ${roundMoney(tradeTotal).toLocaleString()} ${txCurrency}. Available cash is ${roundMoney(availableInTxCurrency).toLocaleString()} ${txCurrency} (pooled from ${roundMoney(availableBefore.SAR).toLocaleString()} SAR + ${roundMoney(availableBefore.USD).toLocaleString()} USD).`,
            );
        }
        const investmentBalanceDelta = deltaForInvestmentTrade(tradeData.type, tradeTotal);
        cashDeltaOut = investmentBalanceDelta;
        positionDeltaOut = tradeData.type === 'buy' ? tradeData.quantity : tradeData.type === 'sell' ? -tradeData.quantity : 0;

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
        if (portfolio?.id) {
            tradePayload.portfolio_id = portfolio.id;
            tradePayload.portfolioId = portfolio.id;
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

        /** Atomic investment ↔ linked cash ledger (migration `create_investment_cash_transfer_with_fee`). Fees stay on addTransfer/addTransaction path. */
        if (
            isCashFlow &&
            linkedCashAccountId &&
            investmentAccount &&
            (tradeData.type === 'deposit' || tradeData.type === 'withdrawal')
        ) {
            const dateSlice =
                typeof trade.date === 'string' && trade.date.length >= 10 ? trade.date.slice(0, 10) : String(trade.date ?? '').slice(0, 10);
            const cashRpcPayload = {
                p_investment_account_id: accountIdForInsert,
                p_cash_account_id: linkedCashAccountId,
                p_direction: tradeData.type === 'deposit' ? 'cash_to_investment' : 'investment_to_cash',
                p_amount: tradeTotal,
                p_fee_amount: 0,
                p_date: dateSlice || new Date().toISOString().slice(0, 10),
                p_cash_description:
                    tradeData.type === 'deposit'
                        ? `Transfer to ${investmentAccount.name}`
                        : `Transfer from ${investmentAccount.name}`,
                p_fee_description: null as string | null,
                p_transfer_group_id: (trade as { transferGroupId?: string }).transferGroupId ?? null,
            };
            const invRpcRes = await supabase.rpc('create_investment_cash_transfer_with_fee', cashRpcPayload as Record<string, unknown>);
            const invRpcErr = invRpcRes.error as { code?: string; message?: string } | null;
            const invRpcRowRaw = invRpcRes.data as
                | { investment_transaction_id?: string; cash_transaction_ids?: string[] }
                | { investment_transaction_id?: string; cash_transaction_ids?: string[] }[]
                | null;
            const invRpcRow = Array.isArray(invRpcRowRaw) ? invRpcRowRaw[0] : invRpcRowRaw;
            const missingInvestRpc =
                invRpcErr?.code === 'PGRST202' ||
                (String(invRpcErr?.message || '').toLowerCase().includes('function') &&
                    String(invRpcErr?.message || '').toLowerCase().includes('does not exist'));

            if (!invRpcErr && invRpcRow?.investment_transaction_id) {
                const invId = invRpcRow.investment_transaction_id;
                const cashIds = Array.isArray(invRpcRow.cash_transaction_ids) ? invRpcRow.cash_transaction_ids : [];

                const { data: invFetched, error: invFetchErr } = await supabase
                    .from('investment_transactions')
                    .select('*')
                    .eq('id', invId)
                    .maybeSingle();
                if (invFetchErr) console.error(invFetchErr);
                if (!invFetched) {
                    tradeSubmissionInFlightRef.current = false;
                    throw new Error(
                        invFetchErr?.message ??
                            'Atomic transfer RPC succeeded but investment transaction could not be loaded. Refresh and verify balances.',
                    );
                }
                const normalizedInserted = stampInvestmentTradeIdentity(
                    normalizeInvestmentTransaction(invFetched),
                    {
                        portfolioId: portfolio?.id,
                        currency: tradePayload.currency ?? portfolioLedgerCurrency ?? txCurrency,
                    },
                );
                applyFinancialDataPatch((prev) => ({
                    ...prev,
                    investmentTransactions: [normalizedInserted, ...prev.investmentTransactions],
                }));
                await applyInvestmentAccountDeltaForTrade(accountIdForInsert, investmentBalanceDelta, {
                    includeTransaction: normalizedInserted,
                });
                recomputed = true;
                insertedInvestmentTransactionId = String(normalizedInserted.id || '');
                insertedTradeTransactions = 1;

                for (const cid of cashIds) {
                    if (!cid) continue;
                    const { data: cashRow, error: cashFetchErr } = await supabase.from('transactions').select('*').eq('id', cid).maybeSingle();
                    if (cashFetchErr) console.warn(cashFetchErr);
                    if (!cashRow) continue;
                    const nt = normalizeTransaction(cashRow);
                    setData((prev) => ({ ...prev, transactions: [nt, ...prev.transactions] }));
                    await syncSharedBudgetTransactionMirror(nt as any);
                    auditChangeLog({
                        action: 'create',
                        entity: 'transaction',
                        entityId: nt.id,
                        summary: `${nt.type}: ${String(nt.description ?? '').slice(0, 120)} · ${nt.amount}`,
                        userId: auth.user.id,
                    });
                    await applyLedgerAccountDeltaForTransaction(nt.accountId, Number(nt.amount) || 0);
                }

                insertedCashLedgerRows = cashIds.filter(Boolean).length;
                tradeSubmissionInFlightRef.current = false;
                return {
                    insertedInvestmentTransactionId,
                    insertedTradeTransactions,
                    insertedCashLedgerRows,
                    recomputed,
                    cashDelta: cashDeltaOut,
                    positionDelta: positionDeltaOut,
                };
            }
            if (invRpcErr && !missingInvestRpc) {
                console.error(invRpcErr);
                throw new Error(formatDbError(invRpcErr));
            }
            if (missingInvestRpc) {
                try {
                    toast(
                        'Investment cash transfer saved via legacy path. For atomic deposit/withdrawal + cash rows, deploy migration `20260328101000_add_investment_cash_transfer_rpc.sql` (and latest fixes).',
                        'info',
                    );
                } catch {}
            }
        }

        for (const payload of tradePayloadVariants(tradePayload)) {
            const result = await supabase.from('investment_transactions').insert(withUser(payload)).select().single();
            newTransaction = result.data;
            txError = result.error;
            if (!txError) break;
            if (txError.code === '23505') {
                const idem =
                    trade.idempotencyKey ??
                    (trade as { idempotency_key?: string }).idempotency_key ??
                    (tradePayload as { idempotency_key?: string }).idempotency_key;
                if (idem) {
                    const { data: existing } = await supabase
                        .from('investment_transactions')
                        .select('*')
                        .eq('user_id', auth.user.id)
                        .eq('idempotency_key', idem)
                        .maybeSingle();
                    if (existing) {
                        newTransaction = existing;
                        txError = null;
                        break;
                    }
                }
            }
            if (!isMissingColumnError(txError)) break;
        }
        if (txError) {
            console.error('Error recording transaction:', txError);
            throw new Error(formatDbError(txError));
        }
        if (newTransaction) {
            const normalizedInserted = stampInvestmentTradeIdentity(normalizeInvestmentTransaction(newTransaction), {
                portfolioId: portfolio?.id,
                currency: tradePayload.currency ?? portfolioLedgerCurrency ?? txCurrency,
            });
            applyFinancialDataPatch((prev) => ({
                ...prev,
                investmentTransactions: [normalizedInserted, ...prev.investmentTransactions],
            }));
            await applyInvestmentAccountDeltaForTrade(accountIdForInsert, investmentBalanceDelta, {
                includeTransaction: normalizedInserted,
            });
            recomputed = true;
            insertedInvestmentTransactionId = String(normalizedInserted.id || '');
            insertedTradeTransactions = 1;
            insertedCashLedgerRows = 1;
            newTransaction = normalizedInserted;
        }
        
        // IMPORTANT: do not auto-create cash `transactions` here.
        // - Deposits/withdrawals are already handled by the atomic RPC path when available (it inserts the cash legs).
        // - When RPC is missing, we still record the investment transaction and update balances, but we avoid creating
        //   additional cash transactions because it can double-count with user-entered transfers.

        // 3. Process trade logic (skip for deposit/withdrawal / dividend — dividend only updates ledger cash)
        if (isCashFlow) {
            sealHoldingsBookAfterTrade();
            tradeSubmissionInFlightRef.current = false;
            return {
                insertedInvestmentTransactionId,
                insertedTradeTransactions,
                insertedCashLedgerRows,
                recomputed,
                cashDelta: cashDeltaOut,
                positionDelta: positionDeltaOut,
            };
        }

        if (tradeData.type === 'dividend') {
            /**
             * Dividend (payout): cash only — no position delta and no ledger holdings persist.
             * DRIP nests recordTrade(buy) for the same symbol only.
             */
            const dripHolding = existingHolding;
            const divId = insertedInvestmentTransactionId;
            sealHoldingsBookAfterTrade();
            tradeSubmissionInFlightRef.current = false;
            if (
                dripHolding?.dividendDistribution === 'Reinvest' &&
                tradeTotal > 0 &&
                tradeData.price > 0 &&
                portfolio?.id &&
                divId
            ) {
                try {
                    await recordTrade(
                        {
                            portfolioId: portfolio.id,
                            accountId: accountIdForInsert,
                            type: 'buy',
                            symbol: normalizedSymbol,
                            quantity: tradeTotal / tradeData.price,
                            price: tradeData.price,
                            total: tradeTotal,
                            date: trade.date,
                            idempotencyKey: `drip|${divId}|${normalizedSymbol}`,
                        },
                        undefined,
                        { system: true },
                    );
                } catch (dripErr) {
                    console.warn('DRIP reinvest after dividend failed:', dripErr);
                }
            }
            return {
                insertedInvestmentTransactionId,
                insertedTradeTransactions,
                insertedCashLedgerRows,
                recomputed,
                cashDelta: cashDeltaOut,
                positionDelta: positionDeltaOut,
            };
        }

        try {
            if (!portfolio) throw new Error('Portfolio not found');
            if (
                tradeData.type === 'buy' &&
                incomingHoldingType === 'manual_fund' &&
                !existingHolding &&
                (manualCv == null || manualCv <= 0)
            ) {
                throw new Error(
                    'For manual valuation, enter the current position value (e.g. Mashora balance, retirement account value).',
                );
            }
            const mergedTxs = newTransaction
                ? [
                      stampInvestmentTradeIdentity(
                          normalizeInvestmentTransaction(newTransaction),
                          {
                              portfolioId: portfolio.id,
                              currency: tradePayload.currency ?? portfolioLedgerCurrency ?? txCurrency,
                          },
                      ),
                      ...(dataRef.current?.investmentTransactions ?? []).filter((t) => t.id !== newTransaction.id),
                  ]
                : [...(dataRef.current?.investmentTransactions ?? [])];

            /**
             * Position book: incremental mutation of the traded symbol only.
             * Never run portfolio-wide persistHoldingsFromReplayMap after buy/sell.
             */
            if (tradeData.type === 'buy' || tradeData.type === 'sell') {
                const deltaResult = await applyPositionDeltaForTrade({
                    portfolioId: portfolio.id,
                    symbol: normalizedSymbol,
                    side: tradeData.type,
                    quantity: tradeData.quantity,
                    price: tradeData.price,
                    existingHolding: existingHolding ?? null,
                    duplicateHoldingIds: duplicateHoldingIdsForTrade,
                    name,
                    assetClass: tradeAssetClass as Holding['assetClass'] | undefined,
                    holdingType: incomingHoldingType as Holding['holdingType'] | undefined,
                    manualCurrentValue: manualCv,
                    goalId: tradeGoalId,
                    updateHolding,
                    addHolding,
                    deleteHolding,
                });
                positionDeltaOut = deltaResult.positionDelta;

                await yieldToMain();
                const portfolioAfter = (dataRef.current?.investments ?? []).find((p) => p.id === portfolio.id) ?? portfolio;
                await syncLotsAfterTrade({
                    portfolio: portfolioAfter,
                    investmentTransactions: mergedTxs,
                    corporateActionEvents: dataRef.current?.corporateActionEvents ?? [],
                    touchedSymbols: [normalizedSymbol],
                    resolveHolding: (sym) => {
                        const pf = (dataRef.current?.investments ?? []).find((p) => p.id === portfolio.id);
                        return pf?.holdings.find((h) => String(h.symbol ?? '').toUpperCase() === sym);
                    },
                    updateHolding,
                    supabase,
                    userId: auth.user.id,
                    onLotsUpdated: (updatedLots) => {
                        applyFinancialDataPatch((prev) => ({
                            ...prev,
                            investmentCostLots: [
                                ...updatedLots,
                                ...(prev.investmentCostLots ?? []).filter((l) => l.portfolioId !== portfolio.id),
                            ],
                        }));
                    },
                });
            }
            if (tradeData.type === 'buy') {
                const snap = dataRef.current;
                const pf = (snap?.investments ?? []).find((p) => p.id === portfolio.id);
                let holdingAfter = pf?.holdings.find(
                    (h) => (h.symbol || '').trim().toUpperCase() === normalizedSymbol,
                );
                if (!holdingAfter && supabase && auth?.user) {
                    const { data: holdingRow, error: holdingReadError } = await supabase
                        .from('holdings')
                        .select('*')
                        .eq('user_id', auth.user.id)
                        .eq('portfolio_id', portfolio.id)
                        .ilike('symbol', normalizedSymbol)
                        .maybeSingle();
                    if (holdingReadError) throw new Error(formatDbError(holdingReadError));
                    if (holdingRow) holdingAfter = normalizeHoldingFromRow(holdingRow);
                }
                if (holdingAfter) {
                    const patched: Holding = {
                        ...holdingAfter,
                        ...(name ? { name } : {}),
                        ...(tradeAssetClass ? { assetClass: tradeAssetClass as Holding['assetClass'] } : {}),
                        ...(incomingHoldingType ? { holdingType: incomingHoldingType as Holding['holdingType'] } : {}),
                        ...(manualCv != null ? { currentValue: manualCv } : {}),
                        ...(tradeGoalId ? { goalId: tradeGoalId } : {}),
                    };
                    const needsPatch =
                        (name && holdingAfter.name !== name) ||
                        (tradeAssetClass && holdingAfter.assetClass !== tradeAssetClass) ||
                        (incomingHoldingType && holdingAfter.holdingType !== incomingHoldingType) ||
                        (manualCv != null && Math.abs((holdingAfter.currentValue ?? 0) - manualCv) > 0.01) ||
                        (tradeGoalId && holdingAfter.goalId !== tradeGoalId);
                    if (needsPatch) await updateHolding(patched);
                }
            }
            sealHoldingsBookAfterTrade();
        } catch (error) {
            console.error("Error updating holdings after trade:", error);
            let rollbackSucceeded = false;
            let holdingsRollbackSucceeded = false;
            if (newTransaction?.id) {
                const rollback = await supabase
                    .from('investment_transactions')
                    .delete()
                    .match({ id: newTransaction.id, user_id: auth.user.id });
                if (rollback.error) {
                    console.error("Failed to rollback recorded transaction after holding update failure:", rollback.error);
                } else {
                    rollbackSucceeded = true;
                    applyFinancialDataPatch((prev) => ({
                        ...prev,
                        investmentTransactions: prev.investmentTransactions.filter((t) => t.id !== newTransaction.id),
                    }));
                    try {
                        await applyInvestmentAccountDeltaForTrade(accountIdForInsert, -investmentBalanceDelta, {
                            excludeTransactionId: newTransaction.id,
                        });
                    } catch (cashRollbackError) {
                        console.error("Failed to rollback investment cash after holding update failure:", cashRollbackError);
                    }
                }
            }
            if (rollbackSucceeded && portfolio) {
                try {
                    await restoreHoldingRowsAfterTradeRollback({
                        portfolioId: portfolio.id,
                        symbol: normalizedSymbol,
                        holdings: symbolHoldingsForTrade,
                    });
                    const restoredPortfolio =
                        (dataRef.current?.investments ?? []).find((candidate) => candidate.id === portfolio.id) ??
                        portfolio;
                    await syncLotsAfterTrade({
                        portfolio: restoredPortfolio,
                        investmentTransactions: dataRef.current?.investmentTransactions ?? [],
                        corporateActionEvents: dataRef.current?.corporateActionEvents ?? [],
                        touchedSymbols: [normalizedSymbol],
                        resolveHolding: (sym) => {
                            const currentPortfolio = (dataRef.current?.investments ?? []).find(
                                (candidate) => candidate.id === portfolio.id,
                            );
                            return currentPortfolio?.holdings.find(
                                (holding) => String(holding.symbol ?? '').toUpperCase() === sym,
                            );
                        },
                        updateHolding,
                        supabase,
                        userId: auth.user.id,
                        onLotsUpdated: (updatedLots) => {
                            applyFinancialDataPatch((prev) => ({
                                ...prev,
                                investmentCostLots: [
                                    ...updatedLots,
                                    ...(prev.investmentCostLots ?? []).filter(
                                        (lot) => lot.portfolioId !== portfolio.id,
                                    ),
                                ],
                            }));
                        },
                    });
                    holdingsRollbackSucceeded = true;
                } catch (holdingsRollbackError) {
                    console.error("Failed to restore holdings after trade rollback:", holdingsRollbackError);
                }
            }
            await fetchData();
            const rollbackNote = rollbackSucceeded && holdingsRollbackSucceeded
                ? 'The trade was not kept (rolled back).'
                : rollbackSucceeded
                  ? 'The trade was removed, but its holdings rollback needs verification after refresh.'
                : 'The trade may still be in your ledger — refresh and verify.';
            throw new Error(
                `Could not update holdings after trade. ${rollbackNote} ${formatUnknownError(error, 'Unknown holding update error.')}`,
            );
        }
        
        // 4. If trade came from a plan, update the plan's status
        if (executedPlanId) {
            const plan = (data?.plannedTrades ?? []).find(p => p.id === executedPlanId);
            if (plan) {
                const filledQty = Math.abs(Number(tradeData.quantity) || 0);
                const executedPatch: PlannedTrade = {
                    ...plan,
                    status: 'Executed',
                    filledQty: Math.max(plan.filledQty ?? 0, filledQty),
                };
                const { error: pe } = await supabase
                    .from('planned_trades')
                    .update(plannedTradeToDbUpdate(executedPatch))
                    .match({ id: plan.id, user_id: auth.user.id });
                if (pe) console.error('Error updating executed plan:', pe);
                const applyTrancheRecompute = (plannedTrades: PlannedTrade[]) => {
                    let trades = plannedTrades.map((p) => (p.id === plan.id ? executedPatch : p));
                    if (plan.trancheGroupId && filledQty > 0) {
                        trades = recomputeTrancheAfterFill(trades, plan.id, filledQty);
                    }
                    return trades;
                };
                let refreshedTrades: PlannedTrade[] = [];
                flushSync(() => {
                    setData((prev) => {
                        refreshedTrades = applyTrancheRecompute(prev.plannedTrades);
                        return { ...prev, plannedTrades: refreshedTrades };
                    });
                });
                if (plan.trancheGroupId && filledQty > 0) {
                    const trancheUpdateErrors: string[] = [];
                    const siblingsToPersist = refreshedTrades.filter(
                        (t) =>
                            t.trancheGroupId === plan.trancheGroupId &&
                            t.id !== plan.id &&
                            t.status === 'Planned',
                    );
                    for (const t of siblingsToPersist) {
                        const { error: te } = await supabase
                            .from('planned_trades')
                            .update(plannedTradeToDbUpdate(t))
                            .match({ id: t.id, user_id: auth.user.id });
                        if (te) {
                            console.error('Error updating tranche planned trade:', te, {
                                id: t.id,
                                symbol: t.symbol,
                                trancheIndex: t.trancheIndex,
                            });
                            trancheUpdateErrors.push(t.symbol || t.id);
                        }
                    }
                    if (trancheUpdateErrors.length > 0) {
                        toast(
                            `Trade recorded, but ${trancheUpdateErrors.length} tranche row(s) failed to save (${trancheUpdateErrors.slice(0, 3).join(', ')}). Refresh and update remaining tranches in Execution History.`,
                            'warning',
                        );
                    }
                }
            }
        }
        return {
            insertedInvestmentTransactionId,
            insertedTradeTransactions,
            insertedCashLedgerRows,
            recomputed,
            cashDelta: cashDeltaOut,
            positionDelta: positionDeltaOut,
        };
        } finally {
            tradeSubmissionInFlightRef.current = false;
        }
    };

    const updateInvestmentTransaction = async (tx: InvestmentTransaction, opts?: RecordWriteOptions) => {
        if (!supabase || !auth?.user) return;
        const editOk = await guardRecordWrite(opts, {
            title: 'Save dividend changes?',
            message: 'Update this dividend in your investment ledger?',
            confirmLabel: 'Save changes',
            details: [`Symbol: ${tx.symbol}`, `Date: ${tx.date}`, `Amount: ${tx.total}`],
        });
        if (!editOk) return;
        const existing = (data?.investmentTransactions ?? []).find((t) => t.id === tx.id);
        if (!existing) throw new Error('Transaction not found.');
        if (existing.type !== 'dividend' || tx.type !== 'dividend') {
            throw new Error('Only dividend rows can be edited here. For buys/sells, adjust via Record Trade or holdings.');
        }
        const total = roundMoney(Math.max(0, Number(tx.total) || 0));
        const book: 'USD' | 'SAR' = tx.currency === 'SAR' ? 'SAR' : 'USD';
        const v = validateDividendTransactionUpdate({
            symbol: tx.symbol,
            date: tx.date,
            total,
            portfolioId: tx.portfolioId,
            accountId: tx.accountId,
        });
        if (!v.valid) throw new Error(v.errors.join('\n'));
        assertDividendUpdateNotDuplicate({
            existingId: tx.id,
            transactions: data?.investmentTransactions ?? [],
            accounts: data?.accounts ?? [],
            accountId: tx.accountId,
            portfolioId: tx.portfolioId,
            symbol: tx.symbol,
            payDate: tx.date,
            totalBook: total,
            bookCurrency: book,
        });
        const row = investmentTransactionToRow({ ...tx, total, currency: book }, data ?? null);
        let lastUpdateErr: unknown = null;
        const updateVariants: Record<string, unknown>[] = [row];
        if ('portfolio_id' in row) {
            const { portfolio_id: _pid, ...withoutPortfolio } = row;
            updateVariants.push(withoutPortfolio);
        }
        if ('currency' in row) {
            const { currency: _c, ...withoutCurrency } = row;
            updateVariants.push(withoutCurrency);
            if ('portfolio_id' in withoutCurrency) {
                const { portfolio_id: _pid2, ...core } = withoutCurrency;
                updateVariants.push(core);
            }
        }
        for (const variant of updateVariants) {
            const { error } = await supabase
                .from('investment_transactions')
                .update(variant)
                .match({ id: tx.id, user_id: auth.user.id });
            lastUpdateErr = error;
            if (!error) {
                lastUpdateErr = null;
                break;
            }
            if (!isMissingColumnError(error)) break;
        }
        if (lastUpdateErr) {
            console.error(lastUpdateErr);
            throw new Error(formatDbError(lastUpdateErr));
        }
        const normalized: InvestmentTransaction = normalizeInvestmentTransaction({ ...existing, ...tx, total, currency: book });
        const netDelta = netBalanceDeltaForInvestmentTxUpdate(existing, normalized);
        applyFinancialDataPatch((prev) => ({
            ...prev,
            investmentTransactions: prev.investmentTransactions.map((t) => (t.id === tx.id ? normalized : t)),
        }));
        const accountId = resolveCanonicalAccountId(tx.accountId, dataRef.current?.accounts ?? data?.accounts ?? []);
        if (netDelta !== 0) {
            await applyInvestmentAccountDeltaForTrade(accountId, netDelta);
        }
    };

    const deleteInvestmentTransaction = async (transactionId: string, opts?: RecordWriteOptions) => {
        if (!supabase || !auth?.user) return;
        const existing = (data?.investmentTransactions ?? []).find((t) => t.id === transactionId);
        const delOk = await guardRecordWrite(opts, {
            title: 'Delete dividend?',
            message: 'Remove this dividend from your ledger and reverse its cash impact?',
            confirmLabel: 'Delete',
            variant: 'danger',
            details: existing ? [`Symbol: ${existing.symbol}`, `Date: ${existing.date}`] : [],
        });
        if (!delOk) return;
        if (!existing) throw new Error('Transaction not found.');
        if (existing.type !== 'dividend') {
            throw new Error('Only dividend rows can be deleted here to protect buy/sell history. Contact support if you need to remove other trade types.');
        }
        const { error } = await supabase
            .from('investment_transactions')
            .delete()
            .match({ id: transactionId, user_id: auth.user.id });
        if (error) {
            console.error(error);
            throw new Error(formatDbError(error));
        }
        const reverseDelta = -computeInvestmentTxCashDelta(existing);
        applyFinancialDataPatch((prev) => ({
            ...prev,
            investmentTransactions: prev.investmentTransactions.filter((t) => t.id !== transactionId),
        }));
        const accountId = resolveCanonicalAccountId(existing.accountId, dataRef.current?.accounts ?? data?.accounts ?? []);
        if (reverseDelta !== 0) {
            await applyInvestmentAccountDeltaForTrade(accountId, reverseDelta);
        }
    };

    // --- Planned Trades ---
    const addPlannedTrade = async (plan: Omit<PlannedTrade, 'id' | 'user_id'>, opts?: RecordWriteOptions): Promise<boolean> => {
        if(!supabase) return false;
        const v = validatePlannedTrade({ symbol: plan.symbol, name: plan.name, tradeType: plan.tradeType, conditionType: plan.conditionType, targetValue: plan.targetValue, quantity: plan.quantity, amount: plan.amount, priority: plan.priority });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return false; }
        const planOk = await guardRecordWrite(opts, {
            title: 'Create investment plan?',
            message: `Create planned ${plan.tradeType} for ${plan.symbol}? Execution still happens via Record Trade.`,
            confirmLabel: 'Create',
            details: [`${plan.tradeType.toUpperCase()} · ${plan.symbol}`, plan.amount != null ? `Amount: ${plan.amount}` : ''].filter(Boolean),
        });
        if (!planOk) return false;
        const { data: newPlan, error } = await supabase.from('planned_trades').insert(withUser(plannedTradeToDbInsert(plan))).select().single();
        if (error) { console.error(error); return false; }
        if (newPlan) { setData(prev => ({ ...prev, plannedTrades: [...prev.plannedTrades, normalizePlannedTradeRow(newPlan)] })); return true; }
        return false;
    };
    const updatePlannedTrade = async (plan: PlannedTrade): Promise<boolean> => {
        if(!supabase || !auth?.user) return false;
        const v = validatePlannedTrade({ symbol: plan.symbol, name: plan.name, tradeType: plan.tradeType, conditionType: plan.conditionType, targetValue: plan.targetValue, quantity: plan.quantity, amount: plan.amount, priority: plan.priority });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return false; }
        const { error } = await supabase.from('planned_trades').update(plannedTradeToDbUpdate(plan)).match({ id: plan.id, user_id: auth.user.id });
        if (error) { console.error(error); return false; }
        setData((prev) => {
            let trades = prev.plannedTrades.map((p) => (p.id === plan.id ? plan : p));
            if (plan.status === 'Executed' && plan.trancheGroupId && (plan.filledQty ?? 0) > 0) {
                trades = recomputeTrancheAfterFill(trades, plan.id, plan.filledQty ?? 0);
            }
            return { ...prev, plannedTrades: trades };
        });
        return true;
    };
    const deletePlannedTrade = async (planId: string) => {
        if(!supabase || !auth?.user) return;
        const { error } = await supabase.from('planned_trades').delete().match({ id: planId, user_id: auth.user.id });
        if (error) { console.error(error); }
        else { setData(prev => ({ ...prev, plannedTrades: prev.plannedTrades.filter(p => p.id !== planId) })); }
    };

    // --- Commodities --- (snake_case: purchase_value, current_value, zakah_class; name required)
    const addCommodityHolding = async (holding: Omit<CommodityHolding, 'id' | 'user_id'>, opts?: RecordWriteOptions) => {
        if (!supabase) return;
        const v = validateCommodityHolding({ name: holding.name, quantity: holding.quantity, purchaseValue: holding.purchaseValue, currentValue: holding.currentValue, symbol: holding.symbol });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const commodityOk = await guardRecordWrite(opts, summarizeCommodityForConfirm({
            name: holding.name,
            quantity: holding.quantity,
            unit: holding.unit,
            purchaseValue: holding.purchaseValue,
        }));
        if (!commodityOk) return;
        const row = commodityHoldingToRow(holding);
        const { data: newHolding, error } = await supabase.from('commodity_holdings').insert(withUser(row)).select().single();
        if (error) {
            console.error("Error adding commodity:", error);
            throw new Error(`Failed to add commodity: ${formatDbError(error)}`);
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
            throw new Error(`Failed to update commodity: ${formatDbError(error)}`);
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
        startTransition(() => {
        setData(prevData => {
            const updatesMap = new Map(safeUpdates.map(u => [u.id, u.currentValue]));
            return {
                ...prevData,
                commodityHoldings: prevData.commodityHoldings.map(h =>
                    updatesMap.has(h.id) ? { ...h, currentValue: updatesMap.get(h.id)! } : h
                )
            };
        });
        });
    };

    const addSukukPosition = async (position: Omit<SukukPosition, 'id' | 'user_id'>, _opts?: RecordWriteOptions) => {
        if (!supabase) return;
        const v = validateSukukPosition({
            name: position.name,
            investmentAccountId: position.investmentAccountId,
            faceValue: position.faceValue,
            outstandingPrincipal: position.outstandingPrincipal ?? position.faceValue,
            issueDate: position.issueDate,
            maturityDate: position.maturityDate,
            currency: position.currency,
        });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const row = sukukPositionToRow({
            ...position,
            outstandingPrincipal: position.outstandingPrincipal ?? position.faceValue,
            status: position.status ?? 'active',
        });
        const { data: inserted, error } = await supabase.from('sukuk_positions').insert(withUser(row)).select().single();
        if (error) {
            console.error('Error adding Sukuk position:', error);
            throw new Error(`Failed to add Sukuk: ${formatDbError(error)}`);
        }
        if (inserted) {
            setData((prev) => ({
                ...prev,
                sukukPositions: [...(prev.sukukPositions ?? []), normalizeSukukPositionRow(inserted)],
            }));
        }
    };

    const updateSukukPosition = async (position: SukukPosition) => {
        if (!supabase || !auth?.user) return;
        const v = validateSukukPosition({
            name: position.name,
            investmentAccountId: position.investmentAccountId,
            faceValue: position.faceValue,
            outstandingPrincipal: position.outstandingPrincipal,
            issueDate: position.issueDate,
            maturityDate: position.maturityDate,
            currency: position.currency,
        });
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const row = sukukPositionToRow(position);
        const { error } = await supabase
            .from('sukuk_positions')
            .update(row)
            .match({ id: position.id, user_id: auth.user.id });
        if (error) {
            console.error(error);
            throw new Error(`Failed to update Sukuk: ${formatDbError(error)}`);
        }
        setData((prev) => ({
            ...prev,
            sukukPositions: (prev.sukukPositions ?? []).map((p) => (p.id === position.id ? position : p)),
        }));
    };

    const deleteSukukPosition = async (positionId: string) => {
        if (!supabase || !auth?.user) return;
        const { error } = await supabase.from('sukuk_positions').delete().match({ id: positionId, user_id: auth.user.id });
        if (error) console.error(error);
        else {
            setData((prev) => ({
                ...prev,
                sukukPositions: (prev.sukukPositions ?? []).filter((p) => p.id !== positionId),
                sukukPayoutSchedules: (prev.sukukPayoutSchedules ?? []).filter((s) => s.sukukPositionId !== positionId),
                sukukPayoutEvents: (prev.sukukPayoutEvents ?? []).filter((e) => e.sukukPositionId !== positionId),
            }));
        }
    };

    const saveSukukPayoutSchedule = async (input: {
        position: SukukPosition;
        existingSchedule: SukukPayoutSchedule | null;
        investmentAccountId: string;
        currency: 'SAR' | 'USD';
        cadence: SukukPayoutSchedule['cadence'];
        dayOfMonth?: number | null;
        couponAmount?: number | null;
        principalAmount?: number | null;
        principalInstallmentAmount?: number | null;
        startDate?: string | null;
        endDate?: string | null;
        enabled?: boolean;
    }) => {
        if (!supabase || !auth?.user) return;
        const { schedule, events } = await saveSukukPayoutScheduleToDb(supabase as any, {
            userId: auth.user.id,
            position: input.position,
            existingSchedule: input.existingSchedule,
            investmentAccountId: input.investmentAccountId,
            currency: input.currency,
            cadence: input.cadence,
            dayOfMonth: input.dayOfMonth,
            couponAmount: input.couponAmount,
            principalAmount: input.principalAmount,
            principalInstallmentAmount: input.principalInstallmentAmount,
            startDate: input.startDate,
            endDate: input.endDate,
            enabled: input.enabled,
            scheduleId: input.existingSchedule?.id,
        });
        setData((prev) => {
            const scheduleId = schedule.id;
            const postedForSchedule = (prev.sukukPayoutEvents ?? []).filter(
                (e) => e.scheduleId === scheduleId && e.posted,
            );
            const otherSchedules = (prev.sukukPayoutSchedules ?? []).filter((s) => s.id !== scheduleId);
            const otherEvents = (prev.sukukPayoutEvents ?? []).filter((e) => e.scheduleId !== scheduleId);
            return {
                ...prev,
                sukukPayoutSchedules: [...otherSchedules, schedule],
                sukukPayoutEvents: [...otherEvents, ...postedForSchedule, ...events],
            };
        });
    };


    // --- Watchlist, Alerts, Zakat, Settings ---
    const addWatchlistItem = async (item: WatchlistItem, opts?: RecordWriteOptions) => {
        if (!supabase || !auth?.user) {
            console.error('Supabase client not available or user not authenticated');
            toast('You must be logged in to manage your watchlist.', 'error');
            return;
        }
        const v = validateWatchlistItem({ symbol: item.symbol });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const watchOk = await guardRecordWrite(opts, summarizeWatchlistForConfirm({ symbol: item.symbol, name: item.name }));
        if (!watchOk) return;
        const db = supabase;
        const symbol = String(item.symbol || '').trim().toUpperCase();
        if ((data?.watchlist ?? []).some((w) => String(w.symbol || '').trim().toUpperCase() === symbol)) {
            toast(`${symbol} is already in your watchlist.`, 'info');
            return;
        }
        const row = watchlistToDbRow({ ...item, symbol, name: String(item.name || symbol).trim() || symbol }, auth.user.id);
        const { data: inserted, error } = await db.from('watchlist').upsert(row, { onConflict: 'user_id,symbol' }).select().single();
        if (error) {
            console.error('Error adding watchlist item:', error);
            toast(`Failed to add ${symbol} to watchlist: ${error.message}`, 'error');
            return;
        }
        if (inserted) {
            const normalized = normalizeWatchlistRow(inserted as Record<string, unknown>);
            setData(prev => ({
                ...prev,
                watchlist: prev.watchlist.some((w) => String(w.symbol || '').toUpperCase() === normalized.symbol)
                    ? prev.watchlist.map((w) => (String(w.symbol || '').toUpperCase() === normalized.symbol ? normalized : w))
                    : [...prev.watchlist, normalized],
            }));
        }
    };
    const updateWatchlistItem = async (item: WatchlistItem) => {
        if (!supabase || !auth?.user) {
            toast('You must be logged in to update your watchlist.', 'error');
            return;
        }
        const symbol = String(item.symbol || '').trim().toUpperCase();
        const row = watchlistToDbRow(item, auth.user.id);
        let lastErr: unknown = null;
        for (const payload of [row, { user_id: auth.user.id, symbol, name: row.name }]) {
            const { data: updated, error } = await supabase
                .from('watchlist')
                .update(payload)
                .match({ user_id: auth.user.id, symbol })
                .select()
                .single();
            lastErr = error;
            if (!error && updated) {
                const normalized = normalizeWatchlistRow(updated as Record<string, unknown>);
                setData((prev) => ({
                    ...prev,
                    watchlist: prev.watchlist.map((w) =>
                        String(w.symbol || '').toUpperCase() === symbol ? normalized : w,
                    ),
                }));
                return;
            }
            if (error && !isMissingColumnError(error)) break;
        }
        if (lastErr) {
            console.error('Error updating watchlist item:', lastErr);
            toast(`Failed to update ${symbol} on watchlist.`, 'error');
        }
    };
    const deleteWatchlistItem = async (symbol: string) => {
        if(!supabase || !auth?.user) return;
        const db = supabase;
        await db.from('watchlist').delete().match({ user_id: auth.user.id, symbol });
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter(i => i.symbol !== symbol) }));
    };
    const addPriceAlert = async (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>, opts?: RecordWriteOptions) => {
        if(!supabase) return;
        const v = validatePriceAlert({ symbol: alert.symbol, targetPrice: alert.targetPrice });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const alertOk = await guardRecordWrite(opts, summarizePriceAlertForConfirm({
            symbol: alert.symbol,
            targetPrice: alert.targetPrice,
            currency: alert.currency ?? 'USD',
        }));
        if (!alertOk) return;
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
    const addZakatPayment = async (payment: Omit<ZakatPayment, 'id' | 'user_id'>, opts?: RecordWriteOptions) => {
        if(!supabase) return;
        const v = validateZakatPayment({ date: payment.date, amount: payment.amount });
        if (!v.valid) { toast(v.errors.join('\n'), 'error'); return; }
        const zakatOk = await guardRecordWrite(opts, summarizeZakatPaymentForConfirm({
            amount: payment.amount,
            date: payment.date,
            notes: payment.notes,
        }));
        if (!zakatOk) return;
        const db = supabase;
        const { data: newPayment, error } = await db.from('zakat_payments').insert(withUser(payment)).select().single();
        if(error) console.error(error);
        else if(newPayment) setData(prev => ({ ...prev, zakatPayments: [newPayment, ...prev.zakatPayments] }));
    };
    const updateSettings = async (settingsUpdate: Partial<Settings>) => {
        if (!supabase || !auth?.user) return;
        let merged = { ...(data?.settings ?? {}), ...settingsUpdate };
        const toValidate: Partial<Settings> = {};
        if ('goldPrice' in settingsUpdate) toValidate.goldPrice = merged.goldPrice ?? (merged as any).gold_price;
        if ('nisabAmount' in settingsUpdate) toValidate.nisabAmount = merged.nisabAmount ?? (merged as any).nisab_amount;
        if ('budgetThreshold' in settingsUpdate) toValidate.budgetThreshold = merged.budgetThreshold;
        if ('driftThreshold' in settingsUpdate) toValidate.driftThreshold = merged.driftThreshold;
        if ('riskProfile' in settingsUpdate) toValidate.riskProfile = merged.riskProfile;
        if ('monthStartDay' in settingsUpdate) toValidate.monthStartDay = (merged as any).monthStartDay ?? (merged as any).month_start_day;
        const v = validateSettings(toValidate);
        if (!v.valid) {
            toast(v.errors.join('\n'), 'error');
            return;
        }
        const overrides = settingsOverridesToRow(merged, settingsUpdate);
        const row: Record<string, unknown> = { ...overrides, user_id: auth.user.id };
        /** Always persist when the user changes this field — `settingsOverridesToRow` omits values equal to app defaults, which would leave a stale DB value (e.g. reverting 25 → 1). */
        if ('monthStartDay' in settingsUpdate) {
          const d = Math.min(31, Math.max(1, Math.round(Number(merged.monthStartDay ?? initialData.settings.monthStartDay ?? 28))));
          row.month_start_day = d;
          merged = { ...merged, monthStartDay: d };
        }
        const { error } = await supabase.from('settings').upsert([row], { onConflict: 'user_id' });
        if (error) {
            console.error("Error updating settings:", error);
        } else {
            setData(prev => ({ ...prev, settings: merged }));
        }
    };

    const saveInvestmentPlan = async (plan: InvestmentPlanSettings, portfolioId?: string) => {
        if (!supabase || !auth?.user) return;
        const mergedPlanRaw: InvestmentPlanSettings =
            portfolioId && data?.investmentPlan
                ? {
                      ...data.investmentPlan,
                      plansByPortfolioId: {
                          ...(data.investmentPlan.plansByPortfolioId ?? {}),
                          [portfolioId]: toPlanSlice(stripNestedPlans(plan)),
                      },
                  }
                : plan;
        const mergedPlan: InvestmentPlanSettings = {
            ...mergedPlanRaw,
            min_coverage_threshold: normalizeMinCoverageThreshold(mergedPlanRaw.min_coverage_threshold),
        };
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

    /**
     * Reads only refs so sequential trade/cash awaits see eager patches + accumulator without waiting for re-render.
     * Stable identity (empty deps) — freshness comes from dataRef / cashBalanceAccumulatorRef at call time.
     */
    const getAvailableCashForAccount = useCallback((accountId: string): { SAR: number; USD: number } => {
        const accounts = dataRef.current?.accounts ?? [];
        const acc = accounts.find((a) => a.id === accountId);
        const accumulated = cashBalanceAccumulatorRef.current[accountId];
        if (acc?.type === 'Investment' && accumulated != null && Number.isFinite(accumulated)) {
            return brokerCashBucketsFromInvestmentAccount({ ...acc, balance: accumulated });
        }
        return getTradableCashBucketsForAccount(accountId, accounts);
    }, []);

    /**
     * Personal wealth slices must use the getters — not a raw merge from getPersonalWealthData.
     * Otherwise `personalInvestments: []` (all portfolios have an owner) overwrites `investments` for
     * consumers that read `personalInvestments` first, and `??` does not fall back (empty array is not nullish).
     */
    const deferredData = useDeferredValue(data);
    const dataWithPersonal = useMemo(() => {
        if (!deferredData) return deferredData;
        return {
            ...deferredData,
            personalAccounts: getPersonalAccounts(deferredData),
            personalAssets: getPersonalAssets(deferredData),
            personalLiabilities: getPersonalLiabilities(deferredData),
            personalInvestments: getPersonalInvestments(deferredData),
            personalCommodityHoldings: getPersonalCommodityHoldings(deferredData),
            personalSukukPositions: getPersonalSukukPositions(deferredData),
            personalTransactions: getPersonalTransactions(deferredData),
        };
    }, [deferredData]);

    const accountsForDeployable = useMemo((): Account[] => {
        const d = dataWithPersonal as FinancialData & { personalAccounts?: Account[] };
        return (d.personalAccounts ?? d.accounts ?? EMPTY_ACCOUNTS_FOR_DEPLOY) as Account[];
    }, [dataWithPersonal]);

    /** Full account list for canonical ids + fresh Investment balances (scope may hold older object refs). */
    const allAccountsForDeployableCanon = useMemo(
        (): Account[] => (data?.accounts ?? EMPTY_ACCOUNTS_FOR_DEPLOY) as Account[],
        [data?.accounts],
    );

    const totalDeployableCash = useMemo(() => {
        if (!data) return 0;
        const sarPerUsd = resolveSarPerUsd(data as FinancialData, DEFAULT_SAR_PER_USD);
        return sumTradableCashSarFromInvestmentAccounts(
            accountsForDeployable.filter((a: Account) => a.type === 'Investment'),
            allAccountsForDeployableCanon,
            sarPerUsd,
        );
    }, [accountsForDeployable, allAccountsForDeployableCanon, data]);

    const showHydrateBanner = awaitingInitialHydrate;
    const showBlockingLoader = false;

    // Auto-heal legacy duplicate holdings — never sum disagreeing quantities (LCID 500→1890 bug).
    useEffect(() => {
        if (
            loading ||
            awaitingInitialHydrate ||
            showHydrateBanner ||
            !financialDataHasHydrated(data) ||
            !auth?.user ||
            duplicateHoldingsReconcileInFlightRef.current
        ) {
            return;
        }
        const duplicateGroups: { portfolioId: string; symbol: string; holdings: Holding[] }[] = [];
        (data.investments ?? []).forEach((portfolio: InvestmentPortfolio) => {
            const bySymbol = new Map<string, Holding[]>();
            (portfolio.holdings ?? []).forEach((h: Holding) => {
                const key = String(h.symbol ?? '').trim().toUpperCase();
                if (!key) return;
                const list = bySymbol.get(key) ?? [];
                list.push(h);
                bySymbol.set(key, list);
            });
            bySymbol.forEach((list, symbol) => {
                if (list.length > 1) {
                    duplicateGroups.push({ portfolioId: portfolio.id, symbol, holdings: list });
                }
            });
        });
        if (!duplicateGroups.length) return;
        const signature = duplicateGroups
            .map((g) => g.holdings.map((h) => h.id).sort().join(','))
            .sort()
            .join('|');
        if (!signature || signature === duplicateHoldingsLastSignatureRef.current) return;

        duplicateHoldingsLastSignatureRef.current = signature;
        duplicateHoldingsReconcileInFlightRef.current = true;
        (async () => {
            try {
                const txs = dataRef.current?.investmentTransactions ?? [];
                for (const group of duplicateGroups) {
                    const resolved = resolveDuplicateHoldingsGroup({
                        holdings: group.holdings,
                        portfolioId: group.portfolioId,
                        symbol: group.symbol,
                        transactions: txs,
                    });
                    if (resolved.disagreed) {
                        console.warn(
                            `[holdings] Duplicate ${group.symbol} in portfolio ${group.portfolioId}: keeping qty ${resolved.keep.quantity}, discarding ${resolved.discardedQuantities.join('+')} (never sum).`,
                        );
                    }
                    for (const dupId of resolved.deleteIds) {
                        await deleteHolding(dupId);
                    }
                }
            } catch (error) {
                console.warn('Duplicate holdings reconciliation skipped due to error:', error);
                duplicateHoldingsLastSignatureRef.current = '';
            } finally {
                duplicateHoldingsReconcileInFlightRef.current = false;
            }
        })();
    }, [loading, awaitingInitialHydrate, showHydrateBanner, data, auth?.user?.id, data.investments]);

    dataActionsRef.current = {
        refreshData,
        addAsset,
        updateAsset,
        deleteAsset,
        addGoal,
        updateGoal,
        deleteGoal,
        updateGoalAllocations,
        addLiability,
        updateLiability,
        deleteLiability,
        addBudget,
        updateBudget,
        deleteBudget,
        copyBudgetsFromPreviousMonth,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addTransfer,
        addRecurringTransaction,
        updateRecurringTransaction,
        deleteRecurringTransaction,
        applyRecurringForMonth,
        applyRecurringRuleForMonth,
        applyRecurringDueToday,
        addPlatform,
        updatePlatform,
        deletePlatform,
        addPortfolio,
        updatePortfolio,
        deletePortfolio,
        addHolding,
        updateHolding,
        batchUpdateHoldingValues,
        recordTrade,
        updateInvestmentTransaction,
        deleteInvestmentTransaction,
        applyCorporateActionEvent,
        reverseCorporateActionEvent,
        rebuildHoldingsFromLedgerForSymbols,
        addWatchlistItem,
        updateWatchlistItem,
        deleteWatchlistItem,
        addZakatPayment,
        addPriceAlert,
        updatePriceAlert,
        deletePriceAlert,
        addPlannedTrade,
        updatePlannedTrade,
        deletePlannedTrade,
        saveInvestmentPlan,
        addUniverseTicker,
        updateUniverseTickerStatus,
        deleteUniverseTicker,
        addCommodityHolding,
        updateCommodityHolding,
        deleteCommodityHolding,
        batchUpdateCommodityHoldingValues,
        addSukukPosition,
        updateSukukPosition,
        deleteSukukPosition,
        saveSukukPayoutSchedule,
        updateSettings,
        resetData,
        loadDemoData,
        restoreFromBackup,
        saveExecutionLog,
    };

    const stableDataActions = useMemo(
        () => bindStableActions(dataActionsRef, DATA_CONTEXT_ACTION_KEYS),
        [],
    );

    const value = useMemo(
        (): DataContextType => ({
            data: dataWithPersonal ?? initialData,
            loading,
            showHydrateBanner,
            isBackgroundSyncing,
            transactionsLoadWarning,
            showBlockingLoader,
            dataResetKey,
            allTransactions: data?.transactions ?? [],
            allBudgets: data?.budgets ?? [],
            getAvailableCashForAccount,
            totalDeployableCash,
            ...stableDataActions,
        }),
        [
            dataWithPersonal,
            loading,
            showHydrateBanner,
            isBackgroundSyncing,
            transactionsLoadWarning,
            dataResetKey,
            data?.transactions,
            data?.budgets,
            getAvailableCashForAccount,
            totalDeployableCash,
            stableDataActions,
        ],
    );

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
