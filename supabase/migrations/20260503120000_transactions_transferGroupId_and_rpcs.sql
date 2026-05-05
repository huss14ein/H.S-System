-- Some deployments store link columns as quoted "transferGroupId" / "transferRole" (not snake_case).
-- RPCs used transfer_group_id / transfer_role → 42703 on camelCase-only schemas.

alter table if exists public.transactions
  add column if not exists "transferGroupId" uuid;

alter table if exists public.transactions
  add column if not exists "transferRole" text;

-- Backfill when an older migration added snake_case only.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'transfer_group_id'
  ) then
    execute '
      update public.transactions t
      set "transferGroupId" = transfer_group_id
      where t."transferGroupId" is null and t.transfer_group_id is not null
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'transfer_role'
  ) then
    execute '
      update public.transactions t
      set "transferRole" = transfer_role
      where t."transferRole" is null and t.transfer_role is not null
    ';
  end if;
end $$;

create index if not exists idx_transactions_transfergroupid_camel
  on public.transactions("transferGroupId")
  where "transferGroupId" is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_transferRole_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_transferRole_check
      check ("transferRole" is null or "transferRole" in ('principal_out', 'principal_in', 'fee'));
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- create_linked_transfer_with_fee (same as 20260428130000; column list fix)
-- ---------------------------------------------------------------------------
create or replace function public.create_linked_transfer_with_fee(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_inbound_amount numeric,
  p_fee_amount numeric default 0,
  p_date date default current_date,
  p_description_out text default null,
  p_description_in text default null,
  p_fee_description text default null,
  p_transfer_group_id uuid default null
)
returns setof public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid := coalesce(p_transfer_group_id, gen_random_uuid());
  v_out_tx_id uuid;
  v_in_tx_id uuid;
  v_fee_tx_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_from_account_id is null or p_to_account_id is null then
    raise exception using errcode = '22023', message = 'Both source and destination accounts are required';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception using errcode = '22023', message = 'Source and destination must differ';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'Transfer amount must be > 0';
  end if;

  if coalesce(p_inbound_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'Inbound amount must be > 0';
  end if;

  if coalesce(p_fee_amount, 0) < 0 then
    raise exception using errcode = '22023', message = 'Transfer fee cannot be negative';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = p_from_account_id
      and a.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Source account not accessible';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = p_to_account_id
      and a.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Destination account not accessible';
  end if;

  insert into public.transactions (
    user_id, date, description, amount, type, "accountId", category, "transferGroupId", "transferRole"
  )
  values (
    v_user_id,
    p_date,
    coalesce(nullif(trim(p_description_out), ''), 'Transfer out'),
    -abs(p_amount),
    'expense',
    p_from_account_id,
    'Transfer',
    v_group_id,
    'principal_out'
  )
  returning id into v_out_tx_id;

  insert into public.transactions (
    user_id, date, description, amount, type, "accountId", category, "transferGroupId", "transferRole"
  )
  values (
    v_user_id,
    p_date,
    coalesce(nullif(trim(p_description_in), ''), 'Transfer in'),
    abs(p_inbound_amount),
    'income',
    p_to_account_id,
    'Transfer',
    v_group_id,
    'principal_in'
  )
  returning id into v_in_tx_id;

  if coalesce(p_fee_amount, 0) > 0 then
    insert into public.transactions (
      user_id, date, description, amount, type, "accountId", category, "transferGroupId", "transferRole"
    )
    values (
      v_user_id,
      p_date,
      coalesce(nullif(trim(p_fee_description), ''), 'Transfer fee'),
      -abs(p_fee_amount),
      'expense',
      p_from_account_id,
      'Fee',
      v_group_id,
      'fee'
    )
    returning id into v_fee_tx_id;
  end if;

  return query
  select t.*
  from public.transactions t
  where t.id in (v_out_tx_id, v_in_tx_id, coalesce(v_fee_tx_id, '00000000-0000-0000-0000-000000000000'::uuid));
end;
$$;

revoke all on function public.create_linked_transfer_with_fee(uuid, uuid, numeric, numeric, numeric, date, text, text, text, uuid) from public;
grant execute on function public.create_linked_transfer_with_fee(uuid, uuid, numeric, numeric, numeric, date, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_investment_cash_transfer_with_fee
-- ---------------------------------------------------------------------------
create or replace function public.create_investment_cash_transfer_with_fee(
  p_investment_account_id uuid,
  p_cash_account_id uuid,
  p_direction text,
  p_amount numeric,
  p_fee_amount numeric default 0,
  p_date date default current_date,
  p_cash_description text default null,
  p_fee_description text default null,
  p_transfer_group_id uuid default null
)
returns table (
  investment_transaction_id uuid,
  cash_transaction_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid := coalesce(p_transfer_group_id, gen_random_uuid());
  v_investment_tx_id uuid;
  v_cash_tx_ids uuid[] := '{}';
  v_cash_tx_id uuid;
  v_trade_type text;
  v_cash_amount numeric;
  v_cash_type text;
  v_cash_role text;
  v_cash_currency text := 'SAR';
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_direction not in ('cash_to_investment', 'investment_to_cash') then
    raise exception using errcode = '22023', message = 'Direction must be cash_to_investment or investment_to_cash';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'Amount must be > 0';
  end if;

  if coalesce(p_fee_amount, 0) < 0 then
    raise exception using errcode = '22023', message = 'Fee cannot be negative';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = p_investment_account_id
      and a.user_id = v_user_id
      and a.type = 'Investment'
  ) then
    raise exception using errcode = '42501', message = 'Investment account not accessible';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = p_cash_account_id
      and a.user_id = v_user_id
      and a.type in ('Checking', 'Savings')
  ) then
    raise exception using errcode = '42501', message = 'Cash account not accessible';
  end if;

  select
    case
      when a.currency in ('SAR', 'USD') then a.currency
      else null
    end
  into v_cash_currency
  from public.accounts a
  where a.id = p_cash_account_id;

  if v_cash_currency is null then
    select
      case
        when count(distinct p.currency) = 1 then min(p.currency)
        else null
      end
    into v_cash_currency
    from public.investment_portfolios p
    where p.account_id = p_investment_account_id
      and p.currency in ('SAR', 'USD');
  end if;
  v_cash_currency := coalesce(v_cash_currency, 'SAR');

  v_trade_type := case when p_direction = 'cash_to_investment' then 'deposit' else 'withdrawal' end;

  insert into public.investment_transactions (
    user_id, account_id, date, type, symbol, quantity, price, total, linked_cash_account_id, currency
  )
  values (
    v_user_id,
    p_investment_account_id,
    p_date,
    v_trade_type,
    'CASH',
    0,
    0,
    abs(p_amount),
    p_cash_account_id,
    v_cash_currency
  )
  returning id into v_investment_tx_id;

  v_cash_amount := case when p_direction = 'cash_to_investment' then -abs(p_amount) else abs(p_amount) end;
  v_cash_type := case when p_direction = 'cash_to_investment' then 'expense' else 'income' end;
  v_cash_role := case when p_direction = 'cash_to_investment' then 'principal_out' else 'principal_in' end;

  insert into public.transactions (
    user_id, date, description, amount, type, "accountId", category, "transferGroupId", "transferRole"
  )
  values (
    v_user_id,
    p_date,
    coalesce(nullif(trim(p_cash_description), ''), case when p_direction = 'cash_to_investment' then 'Transfer to investment' else 'Transfer from investment' end),
    v_cash_amount,
    v_cash_type,
    p_cash_account_id,
    'Transfer',
    v_group_id,
    v_cash_role
  )
  returning id into v_cash_tx_id;
  v_cash_tx_ids := array_append(v_cash_tx_ids, v_cash_tx_id);

  if coalesce(p_fee_amount, 0) > 0 then
    insert into public.transactions (
      user_id, date, description, amount, type, "accountId", category, "transferGroupId", "transferRole"
    )
    values (
      v_user_id,
      p_date,
      coalesce(nullif(trim(p_fee_description), ''), 'Transfer fee'),
      -abs(p_fee_amount),
      'expense',
      p_cash_account_id,
      'Fee',
      v_group_id,
      'fee'
    )
    returning id into v_cash_tx_id;
    v_cash_tx_ids := array_append(v_cash_tx_ids, v_cash_tx_id);
  end if;

  return query
  select v_investment_tx_id, v_cash_tx_ids;
end;
$$;

revoke all on function public.create_investment_cash_transfer_with_fee(uuid, uuid, text, numeric, numeric, date, text, text, uuid) from public;
grant execute on function public.create_investment_cash_transfer_with_fee(uuid, uuid, text, numeric, numeric, date, text, text, uuid) to authenticated;
