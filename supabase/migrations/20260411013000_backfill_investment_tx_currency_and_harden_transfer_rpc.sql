-- Ensure currency is persisted for investment cash-flow rows and repair legacy nulls.

alter table public.accounts
  add column if not exists currency text check (currency is null or currency in ('SAR', 'USD'));

alter table public.investment_transactions
  add column if not exists currency text check (currency is null or currency in ('SAR', 'USD'));

-- 1) Prefer linked cash account currency for deposit/withdrawal rows.
update public.investment_transactions it
set currency = case when a.currency = 'USD' then 'USD' else 'SAR' end
from public.accounts a
where (it.currency is null or it.currency not in ('SAR', 'USD'))
  and it.type in ('deposit', 'withdrawal')
  and it.linked_cash_account_id is not null
  and a.id = it.linked_cash_account_id;

-- 2) For remaining rows, infer from account's portfolio currency when unique.
with account_currency as (
  select
    p.account_id,
    case
      when count(distinct case when p.currency in ('SAR','USD') then p.currency end) = 1
      then min(case when p.currency in ('SAR','USD') then p.currency end)
      else null
    end as inferred_currency
  from public.investment_portfolios p
  group by p.account_id
)
update public.investment_transactions it
set currency = ac.inferred_currency
from account_currency ac
where (it.currency is null or it.currency not in ('SAR', 'USD'))
  and ac.inferred_currency is not null
  and it.account_id = ac.account_id;

-- 3) Hard fallback to SAR so KPI math never runs with unknown currency.
update public.investment_transactions
set currency = 'SAR'
where currency is null or currency not in ('SAR', 'USD');

-- Ensure transfer RPC writes explicit currency on investment side.
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

  select case when a.currency = 'USD' then 'USD' else 'SAR' end
  into v_cash_currency
  from public.accounts a
  where a.id = p_cash_account_id;

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
    user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
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
      user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
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
