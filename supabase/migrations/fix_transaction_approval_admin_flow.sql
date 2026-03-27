-- Harden transaction approval flow:
-- 1) Admin-only approve/reject RPCs
-- 2) Admin-only pending transactions RPC for RLS-safe review queue

begin;

-- Ensure helper exists.
create or replace function public.is_admin_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and lower(trim(role)) = 'admin'
  );
$$;

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
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Only admins can review pending transactions';
  end if;

  set local row_security = off;
  return query
  select
    t.id,
    t.user_id,
    t.description,
    t.amount,
    coalesce(t.budget_category, t.budgetCategory) as budget_category,
    t.date,
    t.status
  from public.transactions t
  where lower(coalesce(t.status, 'approved')) = 'pending'
  order by t.date desc;
end;
$$;

drop function if exists public.approve_pending_transaction(uuid);
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
  if not public.is_admin_user() then
    raise exception 'Only admins can approve transactions';
  end if;

  set local row_security = off;

  select *
  into tx
  from public.transactions
  where id = p_transaction_id
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
  where id = p_transaction_id;

  if budget_category_name is not null and tx_amount is not null then
    update public.categories
    set total_spent = coalesce(total_spent, 0) + abs(tx_amount)
    where name = budget_category_name;
  end if;
  return true;
end;
$$;

drop function if exists public.reject_pending_transaction(uuid, text);
create or replace function public.reject_pending_transaction(p_transaction_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tx_status text;
begin
  if not public.is_admin_user() then
    raise exception 'Only admins can reject transactions';
  end if;

  set local row_security = off;

  select coalesce(to_jsonb(t)->>'status', 'Approved')
  into tx_status
  from public.transactions t
  where t.id = p_transaction_id
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
  where id = p_transaction_id;
  return true;
end;
$$;

grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.get_pending_transactions_for_admin() to authenticated;
grant execute on function public.approve_pending_transaction(uuid) to authenticated;
grant execute on function public.reject_pending_transaction(uuid, text) to authenticated;

commit;
