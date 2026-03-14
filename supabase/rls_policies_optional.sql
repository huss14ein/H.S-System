-- =============================================================================
-- Optional: Row Level Security (RLS) for investment_plan, portfolio_universe,
-- status_change_log, execution_logs. Run after full_schema_for_app.sql if you
-- use Supabase Auth and want per-user isolation.
-- =============================================================================

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

-- wealth_ultra_config: system-wide row (user_id null) readable by all; per-user rows only by owner
alter table public.wealth_ultra_config enable row level security;
drop policy if exists "wealth_ultra_config_select" on public.wealth_ultra_config;
create policy "wealth_ultra_config_select" on public.wealth_ultra_config
  for select using (user_id is null or auth.uid() = user_id);
drop policy if exists "wealth_ultra_config_insert" on public.wealth_ultra_config;
create policy "wealth_ultra_config_insert" on public.wealth_ultra_config
  for insert with check (auth.uid() = user_id);
drop policy if exists "wealth_ultra_config_update_delete" on public.wealth_ultra_config;
create policy "wealth_ultra_config_update_delete" on public.wealth_ultra_config
  for update using (auth.uid() = user_id);
drop policy if exists "wealth_ultra_config_delete" on public.wealth_ultra_config;
create policy "wealth_ultra_config_delete" on public.wealth_ultra_config
  for delete using (auth.uid() = user_id);
