-- Optional migration: cloud-sync household budget engine profile per user.
-- This keeps local profile behavior intact while allowing multi-device sync.

create table if not exists public.household_budget_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.household_budget_profiles enable row level security;

drop policy if exists "household_budget_profiles_select_own" on public.household_budget_profiles;
create policy "household_budget_profiles_select_own"
  on public.household_budget_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "household_budget_profiles_insert_own" on public.household_budget_profiles;
create policy "household_budget_profiles_insert_own"
  on public.household_budget_profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "household_budget_profiles_update_own" on public.household_budget_profiles;
create policy "household_budget_profiles_update_own"
  on public.household_budget_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "household_budget_profiles_delete_own" on public.household_budget_profiles;
create policy "household_budget_profiles_delete_own"
  on public.household_budget_profiles
  for delete
  using (auth.uid() = user_id);
