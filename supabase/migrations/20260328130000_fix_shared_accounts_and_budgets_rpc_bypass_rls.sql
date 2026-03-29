-- Shared account/budget RPCs join rows owned by another user (owner's accounts, budgets,
-- transactions). Table RLS is "auth.uid() = user_id", so the recipient sees zero rows unless
-- the function disables RLS for the query body (still scoped by account_shares / budget_shares).

begin;

do $m$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'account_shares') then
    alter table public.account_shares add column if not exists show_balance boolean default true;
  end if;
end $m$;

-- CREATE OR REPLACE cannot change the OUT/return row type (42P13); drop first.
drop function if exists public.get_shared_accounts_for_me();
drop function if exists public.get_shared_budgets_for_me();
drop function if exists public.get_shared_budget_consumed_for_me();

-- ---------------------------------------------------------------------------
-- Shared accounts: recipient must read owner's account rows joined via account_shares
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_accounts_for_me()
returns table (
  id uuid,
  account_id uuid,
  user_id uuid,
  name text,
  type text,
  balance numeric,
  owner text,
  owner_user_id uuid,
  owner_email text,
  show_balance boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  set local row_security = off;
  return query
  select
    a.id,
    a.id as account_id,
    a.user_id,
    a.name::text as name,
    a.type::text as type,
    case when coalesce(s.show_balance, true) then a.balance else null end as balance,
    a.owner::text as owner,
    s.owner_user_id,
    coalesce(owner_u.email::text, s.owner_user_id::text) as owner_email,
    coalesce(s.show_balance, true) as show_balance
  from public.account_shares s
  join public.accounts a on a.id = s.account_id
  left join auth.users owner_u on owner_u.id = s.owner_user_id
  where s.shared_with_user_id = auth.uid();
end;
$$;

revoke all on function public.get_shared_accounts_for_me() from public;
grant execute on function public.get_shared_accounts_for_me() to authenticated;

-- ---------------------------------------------------------------------------
-- Shared budgets: recipient must read owner's budget rows via budget_shares
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_budgets_for_me()
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
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  set local row_security = off;
  return query
  select
    b.id,
    b.user_id,
    b.category,
    b.month::integer as month,
    b.year::integer as year,
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
end;
$$;

revoke all on function public.get_shared_budgets_for_me() from public;
grant execute on function public.get_shared_budgets_for_me() to authenticated;

-- ---------------------------------------------------------------------------
-- Consumption rollup reads owner's transactions (RLS would hide them)
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_budget_consumed_for_me()
returns table (
  owner_user_id uuid,
  category text,
  consumed_amount numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  set local row_security = off;
  return query
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
    select os.owner_user_id, os.category, os.amount from owner_spend os
    union all
    select cs.owner_user_id, cs.category, cs.amount from contributor_spend cs
  )
  select m.owner_user_id, initcap(m.category) as category, sum(m.amount)::numeric as consumed_amount
  from merged m
  group by m.owner_user_id, m.category
  order by m.owner_user_id, m.category;
end;
$$;

revoke all on function public.get_shared_budget_consumed_for_me() from public;
grant execute on function public.get_shared_budget_consumed_for_me() to authenticated;

commit;
