import { describe, expect, it } from 'vitest';
import { defaultLinksForWealthUltraAlert, runAlertEngine } from '../wealth-ultra/alertEngine';
import { getDefaultWealthUltraConfig } from '../wealth-ultra/config';
import type { WealthUltraPosition, WealthUltraSleeveAllocation } from '../types';

describe('Wealth Ultra alert deep-links', () => {
  it('maps cash alerts to Accounts and concentration to Investments', () => {
    const cash = defaultLinksForWealthUltraAlert('cash_reserve_low');
    expect(cash.some((l) => l.page === 'Accounts')).toBe(true);
    const conc = defaultLinksForWealthUltraAlert('concentration_risk');
    expect(conc.some((l) => l.page === 'Investments')).toBe(true);
    const budget = defaultLinksForWealthUltraAlert('over_budget');
    expect(budget.some((l) => l.page === 'Budgets')).toBe(true);
  });

  it('attaches links on every engine alert', () => {
    const config = getDefaultWealthUltraConfig();
    const positions: WealthUltraPosition[] = [
      {
        ticker: 'AAPL',
        quantity: 10,
        avgCost: 100,
        lastPrice: 200,
        marketValue: 2000,
        plPct: 100,
        sleeveType: 'Core',
      } as WealthUltraPosition,
    ];
    const allocations: WealthUltraSleeveAllocation[] = [
      {
        sleeve: 'Core',
        allocationPct: 90,
        targetPct: 70,
        driftPct: 20,
        marketValue: 2000,
      } as WealthUltraSleeveAllocation,
    ];
    const alerts = runAlertEngine(config, positions, allocations);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => (a.links?.length ?? 0) > 0)).toBe(true);
  });
});
