-- Household members + per-member monthly allocations (KSA resident wealth OS).
-- Additive + RLS. Live-data safe: create-if-not-exists only.

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'dependent' check (role in ('self', 'spouse', 'dependent')),
  owner text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists household_members_user_idx
  on public.household_members (user_id, created_at desc);

alter table public.household_members enable row level security;

drop policy if exists "Users manage own household_members" on public.household_members;
create policy "Users manage own household_members"
  on public.household_members for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.member_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  kind text not null default 'allowance' check (kind in (
    'allowance', 'education_public', 'education_private', 'other'
  )),
  category_id text not null default 'allowance',
  label text not null,
  monthly_amount numeric not null default 0,
  -- Months 1-12 when this allocation applies; null/empty = every month.
  schedule_months integer[] null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_allocations_user_idx
  on public.member_allocations (user_id, member_id);

alter table public.member_allocations enable row level security;

drop policy if exists "Users manage own member_allocations" on public.member_allocations;
create policy "Users manage own member_allocations"
  on public.member_allocations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.household_members is
  'Household members (self/spouse/dependent) for per-member budgeting.';
comment on table public.member_allocations is
  'Per-member monthly allowance / education envelopes (virtual budgeting rows).';
