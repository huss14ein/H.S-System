import type { WealthUltraConfig, WealthUltraSystemConfig } from '../types';

/** Front-end only: Wealth Ultra defaults (no database). Used by Settings, Wealth Ultra dashboard, and Recovery Plan. */
const DEFAULT_CONFIG: Omit<WealthUltraConfig, 'coreTickers' | 'upsideTickers' | 'specTickers'> = {
  fxRate: 0.27,
  targetCorePct: 70,
  targetUpsidePct: 25,
  targetSpecPct: 5,
  defaultTarget1Pct: 15,
  defaultTarget2Pct: 25,
  defaultTrailingPct: 10,
  monthlyDeposit: 6000,
  cashAvailable: 50000,
  cashReservePct: 10,
  maxPerTickerPct: 20,
  riskWeightLow: 1,
  riskWeightMed: 1.25,
  riskWeightHigh: 1.5,
  riskWeightSpec: 2,
};

export function getDefaultWealthUltraConfig(): WealthUltraConfig {
  return { ...DEFAULT_CONFIG };
}

/** Front-end Wealth Ultra system config (no DB). Use this everywhere instead of fetching wealth_ultra_config. */
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
  switch (tier) {
    case 'Low': return config.riskWeightLow;
    case 'Med': return config.riskWeightMed;
    case 'High': return config.riskWeightHigh;
    case 'Spec': return config.riskWeightSpec;
    default: return config.riskWeightMed;
  }
}
