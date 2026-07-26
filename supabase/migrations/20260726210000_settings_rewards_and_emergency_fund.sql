-- Persist the two settings that Rewards net worth and Available Liquidity read.
-- Live-data safe: additive columns with app defaults, no rewrites of existing rows.

alter table if exists public.settings
  add column if not exists include_rewards_in_net_worth boolean not null default true;

alter table if exists public.settings
  add column if not exists emergency_fund_months_target integer not null default 6;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'emergency_fund_months_target'
  ) then
    alter table public.settings
      drop constraint if exists settings_emergency_fund_months_target_check;
    alter table public.settings
      add constraint settings_emergency_fund_months_target_check
      check (emergency_fund_months_target >= 1 and emergency_fund_months_target <= 24);
  end if;
end $$;

comment on column public.settings.include_rewards_in_net_worth is
  'When true (default), unredeemed rewards points/miles show as a separate non-cash Rewards net worth bucket.';
comment on column public.settings.emergency_fund_months_target is
  'Months of essential expenses reserved as the emergency-fund floor in Available Liquidity (1-24).';
