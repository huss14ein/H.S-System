-- Atomic investment<->cash transfer with optional fee and grouped cash ledger rows.

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

  v_trade_type := case when p_direction = 'cash_to_investment' then 'deposit' else 'withdrawal' end;

  insert into public.investment_transactions (
    user_id, account_id, date, type, symbol, quantity, price, total
  )
  values (
    v_user_id,
    p_investment_account_id,
    p_date::text,
    v_trade_type,
    'CASH',
    0,
    0,
    abs(p_amount)
  )
  returning id into v_investment_tx_id;

  v_cash_amount := case when p_direction = 'cash_to_investment' then -abs(p_amount) else abs(p_amount) end;
  v_cash_type := case when p_direction = 'cash_to_investment' then 'expense' else 'income' end;
  v_cash_role := case when p_direction = 'cash_to_investment' then 'principal_out' else 'principal_in' end;

  insert into public.transactions (
    user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
  )
  values (
    v_user_id,
    p_date::text,
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
      user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
    )
    values (
      v_user_id,
      p_date::text,
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
