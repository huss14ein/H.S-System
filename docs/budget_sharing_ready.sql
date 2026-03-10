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

drop policy if exists budget_shares_owner_write on public.budget_shares;
create policy budget_shares_owner_write
  on public.budget_shares
  for all
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists budget_shares_recipient_read on public.budget_shares;
create policy budget_shares_recipient_read
  on public.budget_shares
  for select
  using (auth.uid() = shared_with_user_id or auth.uid() = owner_user_id);

alter table public.budgets enable row level security;

drop policy if exists budgets_owner_only on public.budgets;
create policy budgets_owner_only
  on public.budgets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
  status text not null default 'Approved',
  created_at timestamptz not null default now(),
  unique(owner_user_id, contributor_user_id, source_transaction_id)
);

alter table public.budget_shared_transactions enable row level security;
alter table public.budget_shared_transactions add column if not exists status text not null default 'Approved';

drop policy if exists budget_shared_transactions_owner_read on public.budget_shared_transactions;
create policy budget_shared_transactions_owner_read
  on public.budget_shared_transactions
  for select
  using (auth.uid() = owner_user_id);

drop policy if exists budget_shared_transactions_contributor_rw on public.budget_shared_transactions;
create policy budget_shared_transactions_contributor_rw
  on public.budget_shared_transactions
  for all
  using (auth.uid() = contributor_user_id)
  with check (auth.uid() = contributor_user_id);

create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select usr.id, au.email
  from public.users as usr
  join auth.users as au on au.id = usr.id
  where lower(au.email) = lower(target_email)
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create or replace function public.list_shareable_users()
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select usr.id, au.email
  from public.users as usr
  join auth.users as au on au.id = usr.id
  where usr.id <> auth.uid()
    and exists (
      select 1
      from public.users as me
      where me.id = auth.uid()
        and me.role = 'Admin'
    )
  order by lower(au.email);
$$;

revoke all on function public.list_shareable_users() from public;
grant execute on function public.list_shareable_users() to authenticated;

drop function if exists public.get_shared_budgets_for_me();
create function public.get_shared_budgets_for_me()
returns table (
  id uuid,
  user_id uuid,
  category text,
  month integer,
  year integer,
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
    b.month,
    b.year,
    b.period,
    coalesce(
      nullif(to_jsonb(b)->>'tier', ''),
      nullif(to_jsonb(b)->>'budget_tier', ''),
      'Optional'
    ) as tier,
    b."limit",
    bs.owner_user_id,
    coalesce(bs.owner_email, au.email, bs.owner_user_id::text) as owner_email,
    bs.category as shared_category,
    bs.created_at as shared_at
  from public.budget_shares as bs
  join public.budgets as b on b.user_id = bs.owner_user_id
  left join auth.users as au on au.id = bs.owner_user_id
  where bs.shared_with_user_id = auth.uid()
    and (
      bs.category is null
      or lower(bs.category) = 'all'
      or lower(coalesce(b.category, '')) = lower(bs.category)
    )
  order by bs.created_at desc, lower(coalesce(b.category, ''));
$$;

revoke all on function public.get_shared_budgets_for_me() from public;
grant execute on function public.get_shared_budgets_for_me() to authenticated;


drop function if exists public.get_shared_budget_consumed_for_me();
create function public.get_shared_budget_consumed_for_me()
returns table (
  owner_user_id uuid,
  category text,
  consumed_amount numeric
)
language sql
security definer
set search_path = public, auth
as $$
  with shared_scope as (
    select distinct
      bs.owner_user_id,
      case
        when bs.category is null or lower(bs.category) = 'all' then null
        else lower(bs.category)
      end as shared_category
    from public.budget_shares bs
    where bs.shared_with_user_id = auth.uid()
  ),
  owner_spend as (
    select
      t.user_id as owner_user_id,
      lower(coalesce(t.budget_category, t.category, '')) as category,
      sum(abs(t.amount))::numeric as amount
    from public.transactions t
    join shared_scope ss on ss.owner_user_id = t.user_id
    where t.type = 'expense'
      and coalesce(t.status, 'Approved') = 'Approved'
      and coalesce(t.budget_category, t.category, '') <> ''
      and (ss.shared_category is null or lower(coalesce(t.budget_category, t.category, '')) = ss.shared_category)
    group by t.user_id, lower(coalesce(t.budget_category, t.category, ''))
  ),
  contributor_spend as (
    select
      bst.owner_user_id,
      lower(coalesce(bst.budget_category, '')) as category,
      sum(abs(bst.amount))::numeric as amount
    from public.budget_shared_transactions bst
    join shared_scope ss on ss.owner_user_id = bst.owner_user_id
    where coalesce(bst.status, 'Approved') = 'Approved'
      and coalesce(bst.budget_category, '') <> ''
      and (ss.shared_category is null or lower(coalesce(bst.budget_category, '')) = ss.shared_category)
    group by bst.owner_user_id, lower(coalesce(bst.budget_category, ''))
  ),
  merged as (
    select owner_user_id, category, amount from owner_spend
    union all
    select owner_user_id, category, amount from contributor_spend
  )
  select owner_user_id, initcap(category) as category, sum(amount)::numeric as consumed_amount
  from merged
  group by owner_user_id, category
  order by owner_user_id, category;
$$;

revoke all on function public.get_shared_budget_consumed_for_me() from public;
grant execute on function public.get_shared_budget_consumed_for_me() to authenticated;

commit;
