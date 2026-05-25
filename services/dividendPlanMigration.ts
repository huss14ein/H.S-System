import type { FinancialData, Holding } from '../types';
import {
  expectedOverrideKey,
  loadAllExpectedOverrides,
  saveExpectedAnnualOverride,
} from './dividendExpectedOverrides';

/**
 * One-time migration: copy legacy localStorage expected-annual overrides onto holdings rows in Supabase.
 */
export async function migrateLocalDividendOverridesToHoldings(
  data: Pick<FinancialData, 'investments'>,
  updateHolding: (holding: Holding) => Promise<void>,
): Promise<number> {
  const overrides = loadAllExpectedOverrides();
  let migrated = 0;

  for (const [key, annualSar] of Object.entries(overrides)) {
    if (!Number.isFinite(annualSar) || annualSar <= 0) continue;
    const colon = key.indexOf(':');
    if (colon <= 0) continue;
    const portfolioId = key.slice(0, colon);
    const symbol = key.slice(colon + 1).toUpperCase();
    const portfolio = (data.investments ?? []).find((p) => p.id === portfolioId);
    const holding = portfolio?.holdings?.find((h) => String(h.symbol).toUpperCase() === symbol);
    if (!holding) continue;

    const existing = Number(holding.expectedAnnualDividendSar);
    if (Number.isFinite(existing) && existing > 0) {
      saveExpectedAnnualOverride(portfolioId, symbol, null);
      continue;
    }

    await updateHolding({ ...holding, expectedAnnualDividendSar: annualSar });
    saveExpectedAnnualOverride(portfolioId, symbol, null);
    migrated += 1;
  }

  return migrated;
}

export function legacyOverrideKeyForHolding(portfolioId: string, symbol: string): string {
  return expectedOverrideKey(portfolioId, symbol);
}
