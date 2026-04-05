-- Ensure transaction columns used by app/runtime exist on snake_case schemas
-- and harden admin pending RPC against camelCase column assumptions.

alter table public.transactions
  add column if not exists account_id uuid;

alter table public.transactions
  add column if not exists budget_category text;

alter table public.transactions
  add column if not exists recurring_id uuid;

-- Backfill from legacy camelCase columns when present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transactions' and column_name='accountId'
  ) then
    begin
      execute $sql$
        update public.transactions
        set account_id = nullif("accountId"::text,'')::uuid
        where account_id is null
          and "accountId" is not null
          and nullif("accountId"::text,'') is not null
          and "accountId"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      $sql$;
    exception when others then
      raise notice 'Skipping account_id backfill from "accountId" due to cast/shape mismatch on some rows.';
    end;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transactions' and column_name='budgetCategory'
  ) then
    execute 'update public.transactions set budget_category = "budgetCategory" where (budget_category is null or budget_category = '''') and "budgetCategory" is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transactions' and column_name='recurringId'
  ) then
    begin
      execute $sql$
        update public.transactions
        set recurring_id = nullif("recurringId"::text,'')::uuid
        where recurring_id is null
          and "recurringId" is not null
          and nullif("recurringId"::text,'') is not null
          and "recurringId"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      $sql$;
    exception when others then
      raise notice 'Skipping recurring_id backfill from "recurringId" due to cast/shape mismatch on some rows.';
    end;
  end if;
end $$;

create index if not exists idx_transactions_account_id on public.transactions(account_id);
create index if not exists idx_transactions_budget_category on public.transactions(budget_category);
create index if not exists idx_transactions_recurring_id on public.transactions(recurring_id) where recurring_id is not null;

-- Recreate admin pending RPC using safe snake_case projection only.
drop function if exists public.get_pending_transactions_for_admin();
create or replace function public.get_pending_transactions_for_admin()
returns table (
  id uuid,
  user_id uuid,
  description text,
  amount numeric,
  budget_category text,
  date date,
  status text
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.user_id,
    t.description,
    t.amount,
    t.budget_category,
    t.date,
    t.status
  from public.transactions t
  where lower(coalesce(t.status, '')) = 'pending'
  order by t.date desc, t.id desc;
$$;

grant execute on function public.get_pending_transactions_for_admin() to authenticated;
