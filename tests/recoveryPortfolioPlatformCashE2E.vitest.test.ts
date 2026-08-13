/**
 * E2E wiring: Recovery decisions must use portfolio → platform cash everywhere,
 * not a global Investment-account sum for ladder math / ranking.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRecoveryBudgetByAccountId,
  recoveryBudgetSarForPlatformCash,
  recoveryBudgetSarForPlatformVenue,
  resolvePortfolioRecoveryCash,
  buildRecoveryGlobalConfig,
} from '../services/recoveryPositionSetup';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('recovery portfolio platform cash — helpers', () => {
  it('resolves broker cash from the portfolio account only', () => {
    const venue = resolvePortfolioRecoveryCash({
      portfolio: { id: 'pf1', accountId: 'acc-a', name: 'Port A' },
      accounts: [
        { id: 'acc-a', type: 'Investment', name: 'Broker A', currency: 'USD' } as any,
        { id: 'acc-b', type: 'Investment', name: 'Broker B', currency: 'USD' } as any,
      ],
      getAvailableCashForAccount: (id) =>
        id === 'acc-a' ? { SAR: 0, USD: 1000 } : { SAR: 0, USD: 50000 },
      sarPerUsd: 3.75,
      bookCurrency: 'USD',
    });
    expect(venue.accountId).toBe('acc-a');
    expect(venue.platformName).toBe('Broker A');
    expect(venue.deployableCashSar).toBeCloseTo(1000 * 3.75, 5);
    expect(venue.deployableCashBook).toBeCloseTo(1000, 5);
  });

  it('builds per-platform budgets from each platform’s own cash band', () => {
    const small = recoveryBudgetSarForPlatformCash(10_000);
    const large = recoveryBudgetSarForPlatformCash(80_000);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    // Large books use a higher pct band — must not reuse the small book’s pct on large cash via a global sum.
    expect(large / 80_000).toBeGreaterThanOrEqual(small / 10_000);

    const map = buildRecoveryBudgetByAccountId({
      'acc-small': 10_000,
      'acc-large': 80_000,
    });
    expect(map['acc-small']).toBeCloseTo(small, 5);
    expect(map['acc-large']).toBeCloseTo(large, 5);
  });

  it('USD mid-cash (~$20k @ 3.75) uses book cash for pct band, not inflated SAR', () => {
    const cashUsd = 20_000;
    const rate = 3.75;
    const cashSar = cashUsd * rate; // 75_000 — crosses the 50k SAR band if misused as book cash
    const wrongPct = buildRecoveryGlobalConfig(cashSar).recoveryBudgetPct;
    const rightPct = buildRecoveryGlobalConfig(cashUsd).recoveryBudgetPct;
    expect(wrongPct).toBeGreaterThan(rightPct);

    const budget = recoveryBudgetSarForPlatformVenue({
      deployableCashSar: cashSar,
      deployableCashBook: cashUsd,
    });
    expect(budget).toBeCloseTo(cashSar * rightPct, 5);
    expect(budget).not.toBeCloseTo(cashSar * wrongPct, 5);

    const venueMap = buildRecoveryBudgetByAccountId({
      'acc-usd': { cashSar, cashBook: cashUsd },
    });
    expect(venueMap['acc-usd']).toBeCloseTo(budget, 5);
  });
});

describe('recovery portfolio platform cash — surface wiring', () => {
  it('canonical snapshot builds venue cash + per-account budgets', () => {
    const engine = read('services/canonicalPlanningEngine.ts');
    expect(engine).toContain('resolvePortfolioRecoveryCash');
    expect(engine).toContain('recoveryBudgetSarForPlatformVenue');
    expect(engine).toContain('platformDeployableCashSar');
    expect(engine).toContain('platformDeployableCashBook');
    expect(engine).toContain('recoveryBudgetByAccountId');
    expect(engine).not.toMatch(
      /headlineRecoveryConfig\s*=\s*buildRecoveryGlobalConfig\(deployableCashSar\)/,
    );
  });

  it('Recovery Plan page ranks with platform budgets and shows venue cash', () => {
    const page = read('pages/RecoveryPlanView.tsx');
    expect(page).toContain('buildRecoveryBudgetByAccountId');
    expect(page).toContain('platformDeployableCashSar');
    expect(page).toContain('platformDeployableCashBook');
    expect(page).toContain('recoveryBudgetByAccountId');
    expect(page).toContain('mapped portfolio');
    expect(page).toContain('Platform cash');
    expect(page).toContain('not linked to an Investment platform');
    expect(page).not.toContain('recoveryBudgetPct: globalConfig.recoveryBudgetPct');
    expect(page).not.toContain('This exceeds your total deployable cash shown above');
  });

  it('scorecard and path briefs describe platform-scoped cash', () => {
    expect(read('components/RecoveryDecisionScorecard.tsx')).toContain("this portfolio’s platform cash");
    expect(read('components/RecoveryDecisionScorecard.tsx')).toContain('fundedLadderLevels');
    expect(read('services/recoveryPathSummaries.ts')).toContain("this platform’s deployable cash");
  });

  it('decision engine allocates per accountId', () => {
    const eng = read('services/recoveryDecisionEngine.ts');
    expect(eng).toContain('recoveryBudgetByAccountId');
    expect(eng).toContain('platformDeployableCashSar');
    expect(eng).toContain('Cash cannot move across brokers');
  });
});
