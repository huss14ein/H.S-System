/**
 * Corporate actions schema security — RLS + idempotency constraints.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('corporateActionSecurity', () => {
  it('migration enables RLS and per-user policies on new tables', () => {
    const migration = read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql');
    expect(migration).toContain('corporate_action_events');
    expect(migration).toContain('investment_cost_lots');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('Users manage own corporate_action_events');
    expect(migration).toContain('Users manage own investment_cost_lots');
    expect(migration).toMatch(/using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
  });

  it('corporate_action_events has user-scoped idempotency unique constraint', () => {
    const migration = read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql');
    expect(migration).toContain('idempotency_key text not null');
    expect(migration).toContain('unique (user_id, idempotency_key)');
  });

  it('investment_transactions idempotency partial unique index', () => {
    const migration = read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql');
    expect(migration).toContain('investment_transactions_idempotency_unique');
    expect(migration).toContain('where idempotency_key is not null');
  });

  it('apply path is wired in DataContext and Investments overview UI', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('applyCorporateActionEvent');
    expect(ctx).toContain('reverseCorporateActionEvent');
    expect(ctx).toContain('corporateActionInFlightRef');
    expect(ctx).toContain('idempotency_key');
    expect(ctx).toContain('.in(\'idempotency_key\', keys)');
    expect(read('pages/Investments.tsx')).toContain('CorporateActionApplyPanel');
    expect(read('pages/Investments.tsx')).toContain('CorporateActionWizard');
    expect(read('services/corporateActionWizardModel.ts')).toContain('validateCorporateActionWizardPortfolioAccess');
    expect(read('components/investments/CorporateActionApplyPanel.tsx')).toContain('validateCorporateActionWizardPortfolioAccess');
    expect(read('services/corporateActionNavigation.ts')).toContain('openCorporateActionWizard');
  });
});
