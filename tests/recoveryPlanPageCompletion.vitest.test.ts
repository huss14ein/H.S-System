/**
 * Recovery Plan page — list, details, and eligibility must share one config path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('recovery plan page accuracy wiring', () => {
  it('canonical snapshot and the page use recoveryPositionSetup', () => {
    const engine = read('services/canonicalPlanningEngine.ts');
    const page = read('pages/RecoveryPlanView.tsx');
    expect(engine).toContain('deriveRecoveryPositionConfig');
    expect(engine).toContain('withRecoveryAddBounds');
    expect(engine).toContain('recyclingSummary');
    expect(engine).toContain('positionConfig');
    expect(page).toContain('buildRecoveryGlobalConfig');
    expect(page).toContain('row.recyclingSummary');
    expect(page).toContain('row.positionConfig');
  });

  it('does not show stale hardcoded 20% / 5,000 defaults', () => {
    const page = read('pages/RecoveryPlanView.tsx');
    expect(page).not.toContain('20% of deployable cash');
    expect(page).not.toContain('5,000 (default)');
    expect(page).toContain('How this page decides');
    expect(page).toContain('globalConfig.recoveryBudgetPct');
    expect(page).toContain('positionConfig.lossTriggerPct');
  });

  it('ladder copy uses average cost, not last price as the starting avg', () => {
    const summaries = read('services/recoveryPathSummaries.ts');
    expect(summaries).toContain('formatMoney(ladder.avgCost)');
    expect(summaries).not.toContain('formatMoney(ladder.currentPrice)} toward');
  });

  it('auto-opens a losing position even when the buy ladder is not qualified', () => {
    const page = read('pages/RecoveryPlanView.tsx');
    expect(page).toContain('losingPositions.find((p) => p.plan.qualified || p.recyclingSummary?.planAvailable)');
  });
});
