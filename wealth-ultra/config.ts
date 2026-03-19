import type { WealthUltraConfig, WealthUltraSystemConfig } from '../types';

/** Front-end only: Wealth Ultra defaults (no database). Used by Settings, Wealth Ultra dashboard, and Recovery Plan. */
const DEFAULT_CONFIG: Omit<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'> = {
  fxRate: 0.2667,
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
