-- Linked transfer principal+fee logging with atomic DB write

alter table if exists public.transactions
  add column if not exists transfer_group_id uuid,
  add column if not exists transfer_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_transfer_role_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_transfer_role_check
      CHECK (transfer_role IS NULL OR transfer_role IN ('principal_out', 'principal_in', 'fee'));
  END IF;
END $$;

create index if not exists idx_transactions_transfer_group_id
  on public.transactions(transfer_group_id)
  where transfer_group_id is not null;

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
    user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
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
    user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
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
      user_id, date, description, amount, type, account_id, category, transfer_group_id, transfer_role
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
