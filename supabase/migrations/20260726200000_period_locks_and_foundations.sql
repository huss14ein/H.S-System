-- Foundations: period locks + document vault + subscriptions + pension/GOSI + estate.
-- Additive + RLS. Live-data safe: create-if-not-exists only.
-- Debt amortization schedules are computed in-service (services/debtAmortization.ts) — no table.

-- ── Period locks (durable closed-month SOT; replaces localStorage-only lock) ──
create table if not exists public.period_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year_month text not null,
  locked_at timestamptz not null default now(),
  reason text null,
  unique (user_id, year_month)
);

create index if not exists period_locks_user_idx
  on public.period_locks (user_id, year_month);

alter table public.period_locks enable row level security;

drop policy if exists "Users manage own period_locks" on public.period_locks;
create policy "Users manage own period_locks"
  on public.period_locks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Document vault (non-insurance) ──
create table if not exists public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in ('deed', 'contract', 'statement', 'other')),
  linked_entity_type text null check (linked_entity_type in ('asset', 'liability', 'account', 'goal')),
  linked_entity_id text null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists vault_documents_user_idx
  on public.vault_documents (user_id, created_at desc);

alter table public.vault_documents enable row level security;

drop policy if exists "Users manage own vault_documents" on public.vault_documents;
create policy "Users manage own vault_documents"
  on public.vault_documents for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Subscriptions (lifecycle beyond raw recurring txs) ──
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null default 0,
  currency text not null default 'SAR' check (currency in ('SAR', 'USD')),
  cadence text not null default 'monthly' check (cadence in ('monthly', 'yearly', 'weekly')),
  next_renewal_date date null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  price_history jsonb null,
  account_id text null,
  category_id text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id, status);

alter table public.subscriptions enable row level security;

drop policy if exists "Users manage own subscriptions" on public.subscriptions;
create policy "Users manage own subscriptions"
  on public.subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── GOSI / pension / provident accounts ──
create table if not exists public.pension_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'gosi' check (kind in ('gosi', 'provident', 'pension', 'other')),
  balance numeric not null default 0,
  currency text not null default 'SAR' check (currency in ('SAR', 'USD')),
  employee_contribution_monthly numeric null,
  employer_contribution_monthly numeric null,
  owner text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pension_accounts_user_idx
  on public.pension_accounts (user_id, created_at desc);

alter table public.pension_accounts enable row level security;

drop policy if exists "Users manage own pension_accounts" on public.pension_accounts;
create policy "Users manage own pension_accounts"
  on public.pension_accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Estate beneficiaries ──
create table if not exists public.estate_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relationship text null,
  share_percent numeric null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists estate_beneficiaries_user_idx
  on public.estate_beneficiaries (user_id, created_at desc);

alter table public.estate_beneficiaries enable row level security;

drop policy if exists "Users manage own estate_beneficiaries" on public.estate_beneficiaries;
create policy "Users manage own estate_beneficiaries"
  on public.estate_beneficiaries for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.period_locks is
  'Durable closed accounting months (server SOT for reconciliation guards).';
comment on table public.vault_documents is
  'Non-insurance document vault (deeds, contracts, statements).';
comment on table public.subscriptions is
  'Subscription lifecycle records (status, cadence, price history).';
comment on table public.pension_accounts is
  'GOSI / pension / provident contribution accounts (KSA).';
comment on table public.estate_beneficiaries is
  'Estate planning beneficiaries and intended shares.';
