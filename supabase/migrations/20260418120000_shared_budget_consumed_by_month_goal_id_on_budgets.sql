-- Time-scoped shared budget consumption (matches owner's month view) + optional goal link on budgets.

begin;

-- Optional: tie a budget row to a goal (e.g. "Savings & Investments" funding a house goal).
alter table public.budgets
  add column if not exists goal_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'budgets_goal_id_fkey'
      and conrelid = 'public.budgets'::regclass
  ) then
    alter table public.budgets
      add constraint budgets_goal_id_fkey
      foreign key (goal_id) references public.goals(id) on delete set null;
  end if;
exception
  when undefined_table then null;
end $$;

comment on column public.budgets.goal_id is 'Optional link to a savings/life goal this envelope funds (same user as budget row).';

-- Remove older overloads so the app uses a single security definer signature.
drop function if exists public.get_shared_budget_consumed_for_me();
drop function if exists public.get_shared_budget_consumed_for_me(integer, integer);

-- Consumed rollup: optional date range so recipients match the owner's Budgets page for Monthly / Yearly / Weekly / Daily windows.
create or replace function public.get_shared_budget_consumed_for_me(
  p_year integer default null,
  p_month integer default null,
  p_range_start date default null,
  p_range_end date default null
)
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
      and (
        (p_range_start is null and p_range_end is null and (
          p_year is null
          or p_month is null
          or date_trunc(
            'month',
            coalesce(nullif(trim(t.date), '')::date, current_date)
          ) = make_date(p_year, p_month, 1)
        ))
        or (
          p_range_start is not null
          and p_range_end is not null
          and coalesce(nullif(trim(t.date), '')::date, current_date) >= p_range_start
          and coalesce(nullif(trim(t.date), '')::date, current_date) <= p_range_end
        )
      )
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
      and (
        (p_range_start is null and p_range_end is null and (
          p_year is null
          or p_month is null
          or date_trunc(
            'month',
            coalesce(bst.transaction_date::date, bst.created_at::date, current_date)
          ) = make_date(p_year, p_month, 1)
        ))
        or (
          p_range_start is not null
          and p_range_end is not null
          and coalesce(bst.transaction_date::date, bst.created_at::date, current_date) >= p_range_start
          and coalesce(bst.transaction_date::date, bst.created_at::date, current_date) <= p_range_end
        )
      )
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

revoke all on function public.get_shared_budget_consumed_for_me(integer, integer, date, date) from public;
grant execute on function public.get_shared_budget_consumed_for_me(integer, integer, date, date) to authenticated;

commit;
