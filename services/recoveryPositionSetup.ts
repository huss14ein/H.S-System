/**
 * Single source of recovery position + global config.
 * Used by the Recovery Plan page and canonical planning snapshot so list, details, and eligibility match.
 */
import type { RecoveryGlobalConfig, RecoveryPositionConfig, WealthUltraRiskTier, WealthUltraSleeve } from '../types';
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
