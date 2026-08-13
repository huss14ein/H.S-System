/**
 * Single source of recovery position + global config.
 * Used by the Recovery Plan page and canonical planning snapshot so list, details, and eligibility match.
 */
import type {
  Account,
  RecoveryGlobalConfig,
  RecoveryPositionConfig,
  TradeCurrency,
  WealthUltraRiskTier,
  WealthUltraSleeve,
} from '../types';
import { tradableCashBucketToSAR } from '../utils/currencyMath';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { DEFAULT_RECOVERY_GLOBAL_CONFIG } from './recoveryPlan';

export function buildRecoveryGlobalConfig(deployableCash: number): RecoveryGlobalConfig {
  const cash = Math.max(0, Number(deployableCash) || 0);
  return {
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash: cash,
    /** Must be payable from this book’s cash — never freeze a book because a 300 unit floor exceeds what they have. */
    minDeployableThreshold: cash <= 0 ? 1 : Math.min(cash, Math.max(50, cash * 0.02)),
    recoveryBudgetPct: Math.max(0.12, Math.min(0.35, 0.18 + (cash > 50000 ? 0.04 : 0))),
  };
}

/**
 * Broker cash for the platform linked to a portfolio (not a split of multi-portfolio wallets).
 * Ladders must settle on this account — cash on another broker cannot fund this holding.
 */
export function resolvePortfolioRecoveryCash(args: {
  portfolio: { id?: string | null; accountId?: string | null; name?: string | null };
  accounts: Account[];
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  sarPerUsd: number;
  bookCurrency: TradeCurrency;
}): {
  accountId: string;
  platformName: string;
  deployableCashSar: number;
  deployableCashBook: number;
} {
  const accounts = args.accounts ?? [];
  const rawAid = String(args.portfolio.accountId ?? '').trim();
  const accountId = rawAid ? resolveCanonicalAccountId(rawAid, accounts) || rawAid : '';
  const acc = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  const platformName = String(acc?.name ?? '').trim() || 'Platform';
  const rate = Number(args.sarPerUsd) > 0 ? Number(args.sarPerUsd) : 3.75;
  const deployableCashSar = accountId
    ? Math.max(0, tradableCashBucketToSAR(args.getAvailableCashForAccount(accountId), rate))
    : 0;
  const book = args.bookCurrency === 'SAR' ? 'SAR' : 'USD';
  const deployableCashBook =
    book === 'SAR' ? deployableCashSar : rate > 0 ? deployableCashSar / rate : deployableCashSar;
  return { accountId, platformName, deployableCashSar, deployableCashBook };
}

/** Recovery budget SAR for one platform.
 * Pct band uses book-currency cash (same unit as ladder caps); SAR budget = cashSar × pct.
 */
export function recoveryBudgetSarForPlatformVenue(args: {
  deployableCashSar: number;
  deployableCashBook: number;
}): number {
  const cashSar = Math.max(0, Number(args.deployableCashSar) || 0);
  const cashBook = Math.max(0, Number(args.deployableCashBook) || 0);
  const pct = buildRecoveryGlobalConfig(cashBook).recoveryBudgetPct;
  return cashSar * pct;
}

/** @deprecated Prefer recoveryBudgetSarForPlatformVenue so pct matches ladder book cash. */
export function recoveryBudgetSarForPlatformCash(platformCashSar: number): number {
  return recoveryBudgetSarForPlatformVenue({
    deployableCashSar: platformCashSar,
    deployableCashBook: platformCashSar,
  });
}

/** Build per-account recovery budgets from platform venue cash (SAR + book for pct band). */
export function buildRecoveryBudgetByAccountId(
  platformCashByAccountId:
    | Record<string, number | { cashSar: number; cashBook: number }>
    | Map<string, number | { cashSar: number; cashBook: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const entries =
    platformCashByAccountId instanceof Map
      ? platformCashByAccountId.entries()
      : Object.entries(platformCashByAccountId);
  for (const [aid, raw] of entries) {
    const key = String(aid ?? '').trim();
    if (!key) continue;
    if (typeof raw === 'number') {
      out[key] = recoveryBudgetSarForPlatformCash(raw);
      continue;
    }
    out[key] = recoveryBudgetSarForPlatformVenue({
      deployableCashSar: raw.cashSar,
      deployableCashBook: raw.cashBook,
    });
  }
  return out;
}

export function deriveRecoveryPositionConfig(args: {
  symbol: string;
  sleeveType: WealthUltraSleeve;
  riskTier: WealthUltraRiskTier;
  deployableCash: number;
  plPct: number;
  recoveryBudgetPct: number;
}): RecoveryPositionConfig {
  const { symbol, sleeveType, riskTier, deployableCash, plPct, recoveryBudgetPct } = args;
  const cash = Math.max(0, Number(deployableCash) || 0);
  const lossSeverity = Math.min(1, Math.max(0, Math.abs(Number(plPct) || 0) / 45));
  const riskCapFactor = riskTier === 'Low' ? 0.14 : riskTier === 'Med' ? 0.11 : riskTier === 'High' ? 0.085 : 0.06;
  const budgetSlice = cash * Math.max(0, Number(recoveryBudgetPct) || 0);
  const riskSlice = cash * (riskCapFactor + lossSeverity * 0.06);
  const cashCap = Math.max(0, Math.min(cash, cash * 0.35, Math.max(budgetSlice, riskSlice)));
  const triggerBase = riskTier === 'Low' ? 12 : riskTier === 'Med' ? 15 : riskTier === 'High' ? 18 : 22;
  const dynamicTrigger = Math.max(8, Math.min(30, triggerBase - lossSeverity * 3));
  return {
    symbol,
    sleeveType,
    riskTier,
    recoveryEnabled: sleeveType !== 'Spec',
    lossTriggerPct: Number(dynamicTrigger.toFixed(1)),
    cashCap: Number(cashCap.toFixed(2)),
  };
}

export function withRecoveryAddBounds(
  config: RecoveryPositionConfig,
  args: {
    quantity: number;
    marketValue: number;
    deployableCash: number;
    recoveryBudgetPct: number;
  },
): RecoveryPositionConfig {
  const riskTier = config.riskTier;
  const qty = Math.max(0, Number(args.quantity) || 0);
  const shareCapMultiplier = riskTier === 'Low' ? 1.0 : riskTier === 'Med' ? 0.75 : riskTier === 'High' ? 0.5 : 0.3;
  const costCapMultiplier = riskTier === 'Low' ? 0.6 : riskTier === 'Med' ? 0.45 : riskTier === 'High' ? 0.3 : 0.2;
  const floored = Math.floor(qty * shareCapMultiplier);
  const maxAddShares = qty >= 1 ? Math.max(1, floored) : 0;
  const boundedMaxAddCost = Math.max(
    0,
    Math.min(
      Number(config.cashCap) || 0,
      args.marketValue > 0 ? args.marketValue * costCapMultiplier : Number(config.cashCap) || 0,
      Math.max(0, Number(args.deployableCash) || 0) * Math.max(0, Number(args.recoveryBudgetPct) || 0),
    ),
  );
  return { ...config, maxAddShares, maxAddCost: Number(boundedMaxAddCost.toFixed(2)) };
}
