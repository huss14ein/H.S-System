-- Budget sharing (share only budgets with specific users)
-- Run in Supabase SQL editor.

create table if not exists public.budget_shares (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  shared_with_user_id uuid not null references public.users(id) on delete cascade,
  owner_email text,
  category text null,
  created_at timestamptz not null default now(),
  unique(owner_user_id, shared_with_user_id, category)
);

alter table public.budget_shares enable row level security;

-- Owner can create/update/delete shares they own.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'budget_shares'
      and policyname = 'budget_shares_owner_write'
  ) then
    create policy budget_shares_owner_write
      on public.budget_shares
      for all
      using (auth.uid() = owner_user_id)
      with check (auth.uid() = owner_user_id);
  end if;
end
$$;

-- Recipient can read only rows shared with them.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'budget_shares'
      and policyname = 'budget_shares_recipient_read'
  ) then
    create policy budget_shares_recipient_read
      on public.budget_shares
      for select
      using (auth.uid() = shared_with_user_id or auth.uid() = owner_user_id);
  end if;
end
$$;

-- Optional hardening: ensure budgets remain owner-private at DB level.
alter table public.budgets enable row level security;
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'budgets'
      and policyname = 'budgets_owner_only'
  ) then
    create policy budgets_owner_only
      on public.budgets
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;


-- Mirror table: contributor transactions that should count toward owner-shared budgets.
create table if not exists public.budget_shared_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  contributor_user_id uuid not null references public.users(id) on delete cascade,
  contributor_email text,
  source_transaction_id uuid not null,
  budget_category text not null,
  amount numeric not null,
  transaction_date date not null,
  description text,
  created_at timestamptz not null default now(),
  unique(owner_user_id, contributor_user_id, source_transaction_id)
);

alter table public.budget_shared_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='budget_shared_transactions' and policyname='budget_shared_transactions_owner_read'
  ) then
    create policy budget_shared_transactions_owner_read
      on public.budget_shared_transactions
      for select
      using (auth.uid() = owner_user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='budget_shared_transactions' and policyname='budget_shared_transactions_contributor_rw'
  ) then
    create policy budget_shared_transactions_contributor_rw
      on public.budget_shared_transactions
      for all
      using (auth.uid() = contributor_user_id)
      with check (auth.uid() = contributor_user_id);
  end if;
end
$$;

-- Helper RPC for secure recipient lookup by email (used by Budget sharing UI).
create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email
  from public.users u
  where lower(u.email) = lower(target_email)
  limit 1
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

