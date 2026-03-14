-- -----------------------------------------------------------------------------
-- RLS for all user-scoped tables (production hardening).
-- Run after base tables and full_schema_for_app.sql exist.
-- Ensures auth.uid() = user_id for all app tables. Safe to run multiple times.
-- -----------------------------------------------------------------------------

-- Helper: enable RLS and create policy for a table with user_id column
do $$
declare
  t text;
  tables_with_user_id text[] := array[
    'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'budgets',
    'recurring_transactions', 'investment_portfolios', 'holdings', 'investment_transactions',
    'watchlist', 'settings', 'zakat_payments', 'price_alerts', 'commodity_holdings',
    'planned_trades', 'investment_plan', 'portfolio_universe', 'status_change_log',
    'execution_logs', 'budget_requests'
  ];
begin
  foreach t in array tables_with_user_id
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "Users can manage own %s" on public.%I', t, t);
      execute format('create policy "Users can manage own %s" on public.%I for all using (auth.uid() = user_id)', t, t);
    end if;
  end loop;
end $$;
