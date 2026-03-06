begin;

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
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'budget_shared_transactions'
      and policyname = 'budget_shared_transactions_owner_read'
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
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'budget_shared_transactions'
      and policyname = 'budget_shared_transactions_contributor_rw'
  ) then
    create policy budget_shared_transactions_contributor_rw
      on public.budget_shared_transactions
      for all
      using (auth.uid() = contributor_user_id)
      with check (auth.uid() = contributor_user_id);
  end if;
end
$$;

create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, au.email
  from public.users u
  join auth.users au on au.id = u.id
  where lower(au.email) = lower(target_email)
  limit 1
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create or replace function public.list_shareable_users()
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, au.email
  from public.users u
  join auth.users au on au.id = u.id
  where u.id <> auth.uid()
    and exists (
      select 1
      from public.users me
      where me.id = auth.uid()
        and me.role = 'Admin'
    )
  order by lower(au.email)
$$;

revoke all on function public.list_shareable_users() from public;
grant execute on function public.list_shareable_users() to authenticated;


create or replace function public.get_shared_budgets_for_me()
returns table (
  id uuid,
  user_id uuid,
  category text,
  period text,
  tier text,
  "limit" numeric,
  owner_user_id uuid,
  owner_email text,
  shared_category text,
  shared_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    b.id,
    b.user_id,
    b.category,
    b.period,
    coalesce(b.tier, b.budget_tier, 'Optional') as tier,
    b."limit",
    bs.owner_user_id,
    coalesce(bs.owner_email, au.email, bs.owner_user_id::text) as owner_email,
    bs.category as shared_category,
    bs.created_at as shared_at
  from public.budget_shares bs
  join public.budgets b on b.user_id = bs.owner_user_id
  left join auth.users au on au.id = bs.owner_user_id
  where bs.shared_with_user_id = auth.uid()
    and (
      bs.category is null
      or lower(bs.category) = 'all'
      or lower(coalesce(b.category, '')) = lower(bs.category)
    )
  order by bs.created_at desc, lower(coalesce(b.category, ''))
$$;

revoke all on function public.get_shared_budgets_for_me() from public;
grant execute on function public.get_shared_budgets_for_me() to authenticated;

commit;
