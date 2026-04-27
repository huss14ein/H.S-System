import type { WealthUltraConfig, WealthUltraSystemConfig } from '../types';
import { DEFAULT_SAR_PER_USD } from '../utils/currencyMath';

/** Front-end only: Wealth Ultra defaults (no database). Used by Settings, Wealth Ultra dashboard, and Recovery Plan. */
const DEFAULT_CONFIG: Omit<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'> = {
  /** SAR per 1 USD — same convention as `resolveSarPerUsd` / Settings “USD→SAR”. */
  fxRate: DEFAULT_SAR_PER_USD,
  targetCorePct: 65,
  targetUpsidePct: 28,
  targetSpecPct: 7,
  defaultTarget1Pct: 14,
  defaultTarget2Pct: 27,
  defaultTrailingPct: 11,
  monthlyDeposit: 8000,
  cashAvailable: 50000,
  cashReservePct: 12,
  maxPerTickerPct: 16,
  riskWeightLow: 1,
  riskWeightMed: 1.3,
  riskWeightHigh: 1.65,
  riskWeightSpec: 2.2,
};

export function getDefaultWealthUltraConfig(): WealthUltraConfig {
  return { ...DEFAULT_CONFIG };
}

/** Default Wealth Ultra system parameters. DataContext merges `wealth_ultra_config` from Supabase (user row, else global row) over this when the table exists. */
export function getDefaultWealthUltraSystemConfig(): WealthUltraSystemConfig {
  return {
    fxRate: DEFAULT_CONFIG.fxRate,
    cashReservePct: DEFAULT_CONFIG.cashReservePct,
    maxPerTickerPct: DEFAULT_CONFIG.maxPerTickerPct,
    riskWeightLow: DEFAULT_CONFIG.riskWeightLow,
    riskWeightMed: DEFAULT_CONFIG.riskWeightMed,
    riskWeightHigh: DEFAULT_CONFIG.riskWeightHigh,
    riskWeightSpec: DEFAULT_CONFIG.riskWeightSpec,
    defaultTarget1Pct: DEFAULT_CONFIG.defaultTarget1Pct,
    defaultTarget2Pct: DEFAULT_CONFIG.defaultTarget2Pct,
    defaultTrailingPct: DEFAULT_CONFIG.defaultTrailingPct,
  };
}

/** Merge a `wealth_ultra_config` row over defaults (same rules as DataContext Supabase load). */
export function mergeWealthUltraSystemConfigFromRow(
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

export function validateWealthUltraConfig(c: WealthUltraConfig): { valid: boolean; error?: string } {
  const sum = c.targetCorePct + c.targetUpsidePct + c.targetSpecPct;
  if (Math.abs(sum - 100) > 0.01) {
    return { valid: false, error: `Core + Upside + Spec must equal 100%. Got ${sum}%.` };
  }
  if (c.cashReservePct < 0 || c.cashReservePct > 100) {
    return { valid: false, error: 'Cash reserve % must be between 0 and 100.' };
  }
  if (c.maxPerTickerPct <= 0 || c.maxPerTickerPct > 100) {
    return { valid: false, error: 'Max per ticker % must be between 0 and 100.' };
  }
  return { valid: true };
}

export function getRiskWeight(config: WealthUltraConfig, tier: string): number {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const fallback = (v: number, def: number): number => (Number.isFinite(v) ? v : def);
  switch (String(tier)) {
    case 'Low': return fallback(num(config.riskWeightLow), DEFAULT_CONFIG.riskWeightLow);
    case 'Med': return fallback(num(config.riskWeightMed), DEFAULT_CONFIG.riskWeightMed);
    case 'High': return fallback(num(config.riskWeightHigh), DEFAULT_CONFIG.riskWeightHigh);
    case 'Spec': return fallback(num(config.riskWeightSpec), DEFAULT_CONFIG.riskWeightSpec);
    default: return fallback(num(config.riskWeightMed), DEFAULT_CONFIG.riskWeightMed);
  }
}
