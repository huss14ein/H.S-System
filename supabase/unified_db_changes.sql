-- =============================================================================
-- Unified DB changes for app plans (budgets savings destination, manual holdings,
-- optional household profile). Safe to run multiple times (idempotent).
-- Run in Supabase SQL editor after core tables (budgets, holdings, accounts) exist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Budgets: savings destination account (for "Savings & Investments" budget)
--    Used to show "Savings → Account name" and pre-fill transaction account.
-- -----------------------------------------------------------------------------
alter table if exists public.budgets
  add column if not exists destination_account_id text default null;

comment on column public.budgets.destination_account_id is
  'Account id where savings for this budget (e.g. Savings & Investments) are directed. Used to pre-fill transaction account and show "Savings → Account name" on Budgets page.';


-- -----------------------------------------------------------------------------
-- 2. Holdings: manual / unmapped fund type (e.g. Al Rajhi Mashura)
--    holding_type: ticker = listed symbol; manual_fund = bank product, no ticker.
--    When manual_fund, symbol may be null or placeholder; valuation from current_value.
-- -----------------------------------------------------------------------------
alter table if exists public.holdings
  add column if not exists holding_type text default 'ticker';

comment on column public.holdings.holding_type is
  'ticker = listed instrument (symbol required); manual_fund = bank product / unmapped (e.g. Al Rajhi Mashura), no market feed, valuation from current_value.';

-- Allow symbol to be null for manual_fund holdings (existing rows keep symbol).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'holdings' and column_name = 'symbol'
  ) then
    alter table public.holdings alter column symbol drop not null;
  end if;
exception
  when others then
    null; -- Ignore if already nullable or not applicable
end $$;


-- -----------------------------------------------------------------------------
-- 3. Optional: household profile (single source of truth for adults, kids, overrides)
--    Enables Plan, Budgets, and Investment Control Tower to share the same profile.
-- -----------------------------------------------------------------------------
create table if not exists public.household_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  adults integer not null default 1 check (adults >= 1),
  kids integer not null default 0 check (kids >= 0),
  monthly_overrides jsonb default '[]',
  updated_at timestamptz default now()
);

comment on table public.household_profile is
  'One row per user: adults, kids, optional monthly overrides. Used by Plan, Budgets, and Investment Control Tower for consistent household inputs.';

create index if not exists idx_household_profile_user on public.household_profile(user_id);

-- RLS: user can only read/update own row
alter table public.household_profile enable row level security;

drop policy if exists household_profile_select_own on public.household_profile;
create policy household_profile_select_own on public.household_profile
  for select using (auth.uid() = user_id);

drop policy if exists household_profile_insert_own on public.household_profile;
create policy household_profile_insert_own on public.household_profile
  for insert with check (auth.uid() = user_id);

drop policy if exists household_profile_update_own on public.household_profile;
create policy household_profile_update_own on public.household_profile
  for update using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- End of unified DB changes
-- -----------------------------------------------------------------------------
