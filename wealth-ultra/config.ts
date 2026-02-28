import type { WealthUltraConfig } from '../types';

/** Default numeric/percentage config only; ticker lists come from the system (e.g. investment_plan). */
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
