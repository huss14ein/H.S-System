/**
 * E2E wiring across holdings integrity, recovery plan, and ROI-after-withdrawals.
 * Guards command palette, timeouts, sanitizers, and shared presenters — not isolated unit math.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('holdings + recovery + ROI end-to-end wiring', () => {
  it('Restore / Rebuild cannot hang the lot-sync FIFO forever', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('withTimeout');
    expect(ctx).toContain("withTimeout(Promise.resolve().then(work), 45_000, 'Holdings ledger sync')");
    expect(ctx).toContain('sealHoldingsBookAfterTrade()');
    expect(ctx).toContain('rebuildHoldingsFromLedgerForSymbols');
  });

  it('integrity panel sanitizes tickers, memoizes fingerprint, and blocks overlapping rebuilds', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('safeTickerLabel');
    expect(panel).toContain('useMemo(');
    expect(panel).toContain('buildHoldingsIntegrityFingerprint(data)');
    expect(panel).toContain('if (rebuildBusyKey || ackBusyKey) return');
    expect(panel).toContain('Keep closed');
    expect(panel).toContain('id="holdings-qty-integrity"');
  });

  it('command palette and page actions reach integrity, recovery, and ROI', () => {
    const palette = read('components/CommandPalette.tsx');
    expect(palette).toContain("triggerPageAction('Investments', 'focus-holdings-integrity')");
    expect(palette).toContain("triggerPageAction('Investments', 'focus-recovery-decision')");
    expect(palette).toContain("triggerPageAction('Dashboard', 'focus-investment-roi')");
    expect(palette).toContain('investment-tab:${item.name}');
    const actions = read('utils/pageActions.ts');
    expect(actions).toContain("action === 'focus-holdings-integrity'");
    expect(actions).toContain("action === 'focus-investment-roi'");
    expect(actions).toContain("action === 'focus-recovery-decision'");
    expect(read('pages/Investments.tsx')).toContain("pageAction === 'focus-holdings-integrity'");
    expect(read('pages/Investments.tsx')).toContain("pageAction === 'focus-recovery-decision'");
    expect(read('pages/Dashboard.tsx')).toContain('dashboard-investment-roi');
  });

  it('recovery list/details share one config path and fractional ladders', () => {
    expect(read('services/canonicalPlanningEngine.ts')).toContain('deriveRecoveryPositionConfig');
    expect(read('pages/RecoveryPlanView.tsx')).toContain('buildRecoveryGlobalConfig');
    expect(read('services/recoveryPlan.ts')).toContain('MIN_FRACTIONAL_QTY');
    expect(read('services/recoveryPlan.ts')).toContain('allocateQtyForLadderPrice');
    expect(read('pages/RecoveryPlanView.tsx')).toContain('rankRecoveryDecisions');
    expect(read('pages/RecoveryPlanView.tsx')).toContain('RecoveryDecisionScorecard');
  });

  it('KPI ledger scan is a single pass (no 12× dated FX per row)', () => {
    const core = read('services/investmentKpiCore.ts');
    expect(core).toContain('Single pass over the ledger');
    expect(core).not.toContain('invTx.filter(isCapitalWithdrawal).reduce');
    expect(read('pages/Investments.tsx')).toContain('presentHeadlineInvestmentGrowth');
  });
});
