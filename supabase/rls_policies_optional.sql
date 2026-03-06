-- -----------------------------------------------------------------------------
-- Optional: Row Level Security (RLS) for investment_plan, portfolio_universe,
-- status_change_log, execution_logs. Run after full_schema_for_app.sql if you
-- use Supabase Auth and want per-user isolation.
-- -----------------------------------------------------------------------------

alter table public.investment_plan enable row level security;
alter table public.portfolio_universe enable row level security;
alter table public.status_change_log enable row level security;
alter table public.execution_logs enable row level security;

drop policy if exists "Users can manage own investment_plan" on public.investment_plan;
create policy "Users can manage own investment_plan"
  on public.investment_plan for all using (auth.uid() = user_id);

drop policy if exists "Users can manage own portfolio_universe" on public.portfolio_universe;
create policy "Users can manage own portfolio_universe"
  on public.portfolio_universe for all using (auth.uid() = user_id);

drop policy if exists "Users can manage own status_change_log" on public.status_change_log;
create policy "Users can manage own status_change_log"
  on public.status_change_log for all using (auth.uid() = user_id);

drop policy if exists "Users can manage own execution_logs" on public.execution_logs;
create policy "Users can manage own execution_logs"
  on public.execution_logs for all using (auth.uid() = user_id);
