#!/usr/bin/env node
/*
 * CI guard for critical atomic workflows.
 * Verifies that DB RPC migrations and app call-sites stay wired together.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`Missing required file: ${rel}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function expectContains(content, needle, label) {
  if (!content.includes(needle)) failures.push(`${label} missing: ${needle}`);
}

const migrationChecks = [
  {
    file: 'supabase/migrations/20260328091000_add_linked_transfer_rpc.sql',
    fn: 'create_linked_transfer_with_fee',
  },
  {
    file: 'supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql',
    fn: 'create_investment_cash_transfer_with_fee',
  },
  {
    file: 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql',
    fn: 'finalize_advance_budget_request',
  },
];

for (const m of migrationChecks) {
  const content = read(m.file);
  expectContains(content, `create or replace function public.${m.fn}`, m.file);
  expectContains(content, 'grant execute on function public.', m.file);
}

const dataContext = read('context/DataContext.tsx');
expectContains(dataContext, "rpc('create_linked_transfer_with_fee'", 'context/DataContext.tsx');
expectContains(dataContext, "rpc('create_investment_cash_transfer_with_fee'", 'context/DataContext.tsx');

const budgets = read('pages/Budgets.tsx');
expectContains(budgets, "rpc('finalize_advance_budget_request'", 'pages/Budgets.tsx');

const investmentCashMigration = read('supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');
expectContains(investmentCashMigration, 'linked_cash_account_id', 'supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');
expectContains(investmentCashMigration, 'p_cash_account_id', 'supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');

const advanceFinalizeMigration = read('supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
if (advanceFinalizeMigration.includes('p_request_user_id')) {
  failures.push('supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql should not accept caller-supplied p_request_user_id');
}
expectContains(advanceFinalizeMigration, 'Only admins can finalize budget requests', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
expectContains(advanceFinalizeMigration, 'v_target_user_id := v_request.user_id', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');

if (failures.length > 0) {
  console.error('Critical atomic workflow verification failed:\n');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log('Atomic workflow verification passed.');
