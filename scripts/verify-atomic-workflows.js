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
  {
    file: 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql',
    fn: 'get_shared_accounts_for_me',
  },
  {
    file: 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql',
    fn: 'get_shared_budgets_for_me',
  },
  {
    file: 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql',
    fn: 'get_shared_budget_consumed_for_me',
  },
  {
    file: 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql',
    fn: 'get_shared_budgets_for_me',
  },
  {
    file: 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql',
    fn: 'get_shared_budget_consumed_for_me',
  },
  {
    file: 'supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql',
    fn: 'get_shared_accounts_for_me',
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
expectContains(budgets, "rpc('get_shared_budgets_for_me'", 'pages/Budgets.tsx');
expectContains(budgets, "rpc('get_shared_budget_consumed_for_me'", 'pages/Budgets.tsx');

const accountsPage = read('pages/Accounts.tsx');
expectContains(accountsPage, "rpc('get_shared_accounts_for_me'", 'pages/Accounts.tsx');

const investmentCashMigration = read('supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');
expectContains(investmentCashMigration, 'linked_cash_account_id', 'supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');
expectContains(investmentCashMigration, 'p_cash_account_id', 'supabase/migrations/20260328101000_add_investment_cash_transfer_rpc.sql');

const advanceFinalizeMigration = read('supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
if (advanceFinalizeMigration.includes('p_request_user_id')) {
  failures.push('supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql should not accept caller-supplied p_request_user_id');
}
expectContains(advanceFinalizeMigration, 'Only admins can finalize budget requests', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
expectContains(advanceFinalizeMigration, 'v_target_user_id := v_request.user_id', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
expectContains(advanceFinalizeMigration, 'Advance window parameters do not match the locked budget request', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');
expectContains(advanceFinalizeMigration, 'Provided category does not match the locked budget request', 'supabase/migrations/20260328112000_add_finalize_advance_budget_request_rpc.sql');


const sharedMigration = read('supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql');
expectContains(sharedMigration, 'security definer', 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql');
expectContains(sharedMigration, 'set local row_security = off', 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql');
expectContains(sharedMigration, 'where s.shared_with_user_id = auth.uid()', 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql');
expectContains(sharedMigration, 'where bs.shared_with_user_id = auth.uid()', 'supabase/migrations/20260328130000_fix_shared_accounts_and_budgets_rpc_bypass_rls.sql');


const sharedRpcFixMigration = read('supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql');
expectContains(sharedRpcFixMigration, 'b.month::integer as month', 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql');
expectContains(sharedRpcFixMigration, 'b.year::integer as year', 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql');
expectContains(sharedRpcFixMigration, 'select os.owner_user_id, os.category, os.amount from owner_spend os', 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql');
expectContains(sharedRpcFixMigration, 'select cs.owner_user_id, cs.category, cs.amount from contributor_spend cs', 'supabase/migrations/20260328133000_fix_shared_rpc_return_types_and_ambiguity.sql');


const sharedAccountsTypeFixMigration = read('supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql');
expectContains(sharedAccountsTypeFixMigration, 'a.name::text as name', 'supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql');
expectContains(sharedAccountsTypeFixMigration, 'a.type::text as type', 'supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql');
expectContains(sharedAccountsTypeFixMigration, 'a.owner::text as owner', 'supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql');
expectContains(sharedAccountsTypeFixMigration, 'coalesce(owner_u.email::text, s.owner_user_id::text) as owner_email', 'supabase/migrations/20260328134000_fix_shared_accounts_return_text_types.sql');

if (failures.length > 0) {
  console.error('Critical atomic workflow verification failed:\n');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log('Atomic/shared workflow verification passed.');
