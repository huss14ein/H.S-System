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
