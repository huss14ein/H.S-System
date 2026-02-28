import type { WealthUltraConfig, WealthUltraSleeveAllocation } from '../types';

const SPEC_BREACH_THRESHOLD_PCT = 2;

export function isSpecBreach(config: WealthUltraConfig, specAllocation: WealthUltraSleeveAllocation | undefined): boolean {
  if (!specAllocation) return false;
  return specAllocation.allocationPct > config.targetSpecPct + SPEC_BREACH_THRESHOLD_PCT;
}

export function shouldDisableNewSpecBuys(config: WealthUltraConfig, specAllocation: WealthUltraSleeveAllocation | undefined): boolean {
  return isSpecBreach(config, specAllocation);
}
