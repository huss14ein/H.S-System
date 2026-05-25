-- Per-user data isolation: admins only see their own rows unless data is explicitly shared
-- (budget_shares / account_shares RPCs). No cross-tenant reads via admin RPCs.

begin;

-- Pending transaction review: only the signed-in user's own pending rows.
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
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    t.id,
    t.user_id,
    t.description,
    t.amount,
    t.budget_category,
    t.date,
    t.status
  from public.transactions t
  where t.user_id = auth.uid()
    and lower(coalesce(t.status, 'approved')) = 'pending'
  order by t.date desc;
end;
$$;

-- Approve/reject only own transactions (no cross-user access).
create or replace function public.approve_pending_transaction(p_transaction_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tx record;
  tx_json jsonb;
  tx_status text;
  tx_amount numeric;
  budget_category_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  set local row_security = off;

  select *
  into tx
  from public.transactions
  where id = p_transaction_id
    and user_id = auth.uid()
  for update;

  if not found then
    return false;
  end if;

  tx_json := to_jsonb(tx);
  tx_status := coalesce(tx_json->>'status', 'Approved');
  tx_amount := nullif(tx_json->>'amount', '')::numeric;
  budget_category_name := coalesce(tx_json->>'budgetCategory', tx_json->>'budget_category');

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Approved'
  where id = p_transaction_id
    and user_id = auth.uid();

  if budget_category_name is not null and tx_amount is not null then
    update public.categories
    set total_spent = coalesce(total_spent, 0) + abs(tx_amount)
    where name = budget_category_name;
  end if;
  return true;
end;
$$;

create or replace function public.reject_pending_transaction(p_transaction_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tx_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  set local row_security = off;

  select coalesce(to_jsonb(t)->>'status', 'Approved')
  into tx_status
  from public.transactions t
  where t.id = p_transaction_id
    and t.user_id = auth.uid()
  for update;

  if not found then
    return false;
  end if;

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Rejected',
      rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_transaction_id
    and user_id = auth.uid();
  return true;
end;
$$;

grant execute on function public.get_pending_transactions_for_admin() to authenticated;
grant execute on function public.approve_pending_transaction(uuid) to authenticated;
grant execute on function public.reject_pending_transaction(uuid, text) to authenticated;

-- Do not enumerate all platform users for share dropdowns (privacy).
create or replace function public.list_shareable_users()
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select null::uuid, null::text where false;
$$;

revoke all on function public.list_shareable_users() from public;
grant execute on function public.list_shareable_users() to authenticated;

-- RLS for enhancement-rollout tables (if present).
do $$
declare
  t text;
  tables_with_user_id text[] := array[
    'investment_thesis',
    'investment_journal_entries',
    'net_worth_snapshots',
    'installment_plans',
    'installments',
    'sukuk_payout_schedules',
    'sukuk_payout_events',
    'financial_statements'
  ];
begin
  foreach t in array tables_with_user_id
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "Users can manage own %s" on public.%I', t, t);
      execute format(
        'create policy "Users can manage own %s" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        t, t
      );
    end if;
  end loop;
end $$;

-- budget_requests: each user sees only their requests (admin included).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'budget_requests'
  ) then
    alter table public.budget_requests enable row level security;
    drop policy if exists "budget_requests_own_rows" on public.budget_requests;
    create policy "budget_requests_own_rows"
      on public.budget_requests for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

commit;
