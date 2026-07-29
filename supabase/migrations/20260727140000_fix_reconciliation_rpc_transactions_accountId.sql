-- Fix apply/reverse reconciliation RPCs for production transactions schemas that use
-- quoted camelCase "accountId" (no snake_case account_id). Error observed:
--   column t.account_id does not exist
-- Matches create_linked_transfer_with_fee / 20260428130000_transactions_rpcs_use_accountId_column.
-- Detects which column exists so greenfield (snake) and production (camel) both work.

begin;

create or replace function public.apply_reconciliation_adjustment(
  p_entity_type text,
  p_entity_id uuid,
  p_actual_value numeric,
  p_reason text,
  p_mechanism text default 'reconcile_balance',
  p_effective_date date default (timezone('UTC', now()))::date,
  p_idempotency_key text default null,
  p_client_nonce text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  acc record;
  before_v numeric;
  delta_v numeric;
  currency_v text;
  idem text;
  existing_id uuid;
  adj_id uuid;
  tx_id uuid;
  liab_id uuid;
  category_v text;
  desc_v text;
  tx_type text;
  acct_col text;
  pending_blocked boolean := false;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_entity_type <> 'account' then
    raise exception 'apply_reconciliation_adjustment RPC supports account cash reconcile; use client protocols for other entities';
  end if;
  if p_mechanism not in ('reconcile_balance', 'opening_balance') then
    raise exception 'Unsupported mechanism for cash apply RPC';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Reason is required (min 3 characters)';
  end if;
  if p_actual_value is null or not (p_actual_value = p_actual_value) then
    raise exception 'actual_value must be a finite number';
  end if;

  select id, type, balance, currency into acc
  from public.accounts
  where id = p_entity_id and user_id = uid
  for update;
  if not found then
    raise exception 'Account not found';
  end if;
  if acc.type not in ('Checking', 'Savings', 'Credit') then
    raise exception 'RPC apply supports Checking/Savings/Credit; Investment broker cash uses client path';
  end if;

  select case
    when exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'transactions' and c.column_name = 'account_id'
    ) then 'account_id'
    else '"accountId"'
  end into acct_col;

  execute format(
    $q$
      select exists (
        select 1 from public.transactions t
        where t.user_id = $1
          and t.%s = $2
          and lower(coalesce(t.status::text, '')) in ('pending', 'pending_approval', 'awaiting_approval')
      )
    $q$,
    acct_col
  ) into pending_blocked using uid, acc.id;

  if pending_blocked then
    raise exception 'Apply blocked: pending/approval transactions exist on this account';
  end if;

  before_v := coalesce(acc.balance, 0);
  delta_v := round(p_actual_value - before_v, 4);
  currency_v := coalesce(acc.currency, 'SAR');
  idem := coalesce(
    nullif(trim(p_idempotency_key), ''),
    uid::text || '|account|' || acc.id::text || '|' || p_effective_date::text || '|' || p_mechanism
      || '|' || delta_v::text || '|' || left(md5(trim(p_reason)), 8)
      || coalesce('|' || nullif(trim(p_client_nonce), ''), '')
  );

  select id into existing_id
  from public.reconciliation_adjustments
  where user_id = uid and idempotency_key = idem;
  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'noop', abs(delta_v) < 0.00005,
      'adjustmentId', existing_id
    );
  end if;

  if abs(delta_v) < 0.00005 then
    insert into public.reconciliation_adjustments (
      user_id, mechanism, entity_type, entity_id, account_id, effective_date, currency,
      before_value, actual_value, delta, reason, idempotency_key, status
    ) values (
      uid, p_mechanism, 'account', acc.id, acc.id, p_effective_date, currency_v,
      before_v, p_actual_value, 0, trim(p_reason), idem, 'noop'
    ) returning id into adj_id;

    insert into public.reconciliation_audit_events (
      user_id, kind, mechanism, entity_type, entity_id, effective_date,
      before_value, after_value, delta, currency, reason, adjustment_id, summary
    ) values (
      uid, 'noop', p_mechanism, 'account', acc.id::text, p_effective_date,
      before_v, p_actual_value, 0, currency_v, trim(p_reason), adj_id,
      'No-op reconcile — balance already matches'
    );

    return jsonb_build_object('ok', true, 'noop', true, 'adjustmentId', adj_id, 'delta', 0);
  end if;

  category_v := case when p_mechanism = 'opening_balance' then 'Opening Balance' else 'Reconciliation Adjustment' end;
  desc_v := left(category_v || ': ' || trim(p_reason), 200);
  tx_type := case when delta_v >= 0 then 'income' else 'expense' end;

  execute format(
    $q$
      insert into public.transactions (
        user_id, date, description, amount, category, type, %s, note
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) returning id
    $q$,
    acct_col
  ) into tx_id
  using uid, p_effective_date, desc_v, delta_v, category_v, tx_type, acc.id, 'reconciliation:' || p_mechanism;

  update public.accounts
  set balance = round(before_v + delta_v, 4)
  where id = acc.id and user_id = uid;

  if acc.type = 'Credit' then
    select id into liab_id
    from public.liabilities
    where user_id = uid
      and type = 'Credit Card'
      and account_id = acc.id
    limit 1;
    if liab_id is not null then
      update public.liabilities
      set amount = round(before_v + delta_v, 4)
      where id = liab_id and user_id = uid;
    end if;
  end if;

  insert into public.reconciliation_adjustments (
    user_id, mechanism, entity_type, entity_id, account_id, effective_date, currency,
    before_value, actual_value, delta, reason, idempotency_key, status,
    generated_transaction_id
  ) values (
    uid, p_mechanism, 'account', acc.id, acc.id, p_effective_date, currency_v,
    before_v, p_actual_value, delta_v, trim(p_reason), idem, 'applied',
    tx_id
  ) returning id into adj_id;

  begin
    update public.transactions
    set reconciliation_adjustment_id = adj_id
    where id = tx_id and user_id = uid;
  exception when undefined_column then
    null;
  end;

  insert into public.reconciliation_audit_events (
    user_id, kind, mechanism, entity_type, entity_id, effective_date,
    before_value, after_value, delta, currency, reason, adjustment_id, summary
  ) values (
    uid, 'adjustment', p_mechanism, 'account', acc.id::text, p_effective_date,
    before_v, p_actual_value, delta_v, currency_v, trim(p_reason), adj_id,
    'Reconcile Balance ' || before_v::text || ' → ' || p_actual_value::text || ' (Δ ' || delta_v::text || ' ' || currency_v || ')'
  );

  return jsonb_build_object(
    'ok', true,
    'noop', false,
    'adjustmentId', adj_id,
    'transactionId', tx_id,
    'beforeValue', before_v,
    'actualValue', p_actual_value,
    'delta', delta_v,
    'currency', currency_v,
    'liabilityId', liab_id
  );
end;
$$;

revoke all on function public.apply_reconciliation_adjustment(text, uuid, numeric, text, text, date, text, text) from public;
grant execute on function public.apply_reconciliation_adjustment(text, uuid, numeric, text, text, date, text, text) to authenticated;

create or replace function public.reverse_reconciliation_adjustment(
  p_adjustment_id uuid,
  p_reason text default 'Reverse adjustment'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  adj record;
  acc record;
  rev_delta numeric;
  rev_id uuid;
  tx_id uuid;
  liab_id uuid;
  idem text;
  desc_v text;
  tx_type text;
  acct_col text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Reason is required (min 3 characters)';
  end if;

  select * into adj
  from public.reconciliation_adjustments
  where id = p_adjustment_id and user_id = uid
  for update;
  if not found then
    raise exception 'Adjustment not found';
  end if;
  if adj.status = 'reversed' or adj.reversed_by_adjustment_id is not null then
    raise exception 'This adjustment was already reversed';
  end if;
  if adj.status = 'noop' or abs(coalesce(adj.delta, 0)) < 0.00005 then
    raise exception 'No-op adjustments cannot be reversed';
  end if;
  if adj.entity_type <> 'account' or adj.mechanism not in ('reconcile_balance', 'opening_balance') then
    raise exception 'RPC reverse currently supports cash account adjustments';
  end if;

  select id, type, balance, currency into acc
  from public.accounts
  where id = adj.entity_id and user_id = uid
  for update;
  if not found then
    raise exception 'Account not found';
  end if;

  rev_delta := round(-adj.delta, 4);
  idem := uid::text || '|reverse|' || adj.id::text;
  if exists (select 1 from public.reconciliation_adjustments where user_id = uid and idempotency_key = idem) then
    raise exception 'This adjustment was already reversed';
  end if;

  desc_v := left('Reconciliation Adjustment: ' || trim(p_reason), 200);
  tx_type := case when rev_delta >= 0 then 'income' else 'expense' end;

  select case
    when exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'transactions' and c.column_name = 'account_id'
    ) then 'account_id'
    else '"accountId"'
  end into acct_col;

  execute format(
    $q$
      insert into public.transactions (
        user_id, date, description, amount, category, type, %s, note
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) returning id
    $q$,
    acct_col
  ) into tx_id
  using uid, (timezone('UTC', now()))::date, desc_v, rev_delta, 'Reconciliation Adjustment', tx_type, acc.id,
    'reconciliation:reverse_adjustment';

  update public.accounts
  set balance = round(coalesce(acc.balance, 0) + rev_delta, 4)
  where id = acc.id and user_id = uid;

  if acc.type = 'Credit' then
    select id into liab_id
    from public.liabilities
    where user_id = uid
      and type = 'Credit Card'
      and account_id = acc.id
    limit 1;
    if liab_id is not null then
      update public.liabilities
      set amount = round(coalesce(acc.balance, 0) + rev_delta, 4)
      where id = liab_id and user_id = uid;
    end if;
  end if;

  insert into public.reconciliation_adjustments (
    user_id, mechanism, entity_type, entity_id, account_id, effective_date, currency,
    before_value, actual_value, delta, reason, idempotency_key, status,
    reverses_adjustment_id, generated_transaction_id
  ) values (
    uid, 'reverse_adjustment', 'account', acc.id, acc.id, (timezone('UTC', now()))::date,
    coalesce(adj.currency, 'SAR'),
    adj.actual_value, adj.before_value, rev_delta, trim(p_reason), idem, 'applied',
    adj.id, tx_id
  ) returning id into rev_id;

  update public.reconciliation_adjustments
  set status = 'reversed', reversed_by_adjustment_id = rev_id
  where id = adj.id and user_id = uid;

  insert into public.reconciliation_audit_events (
    user_id, kind, mechanism, entity_type, entity_id, effective_date,
    before_value, after_value, delta, currency, reason, adjustment_id, summary,
    metadata
  ) values (
    uid, 'reversal', 'reverse_adjustment', 'account', acc.id::text, (timezone('UTC', now()))::date,
    adj.actual_value, adj.before_value, rev_delta, adj.currency, trim(p_reason), rev_id,
    'Reversed adjustment ' || adj.id::text,
    jsonb_build_object('reversesAdjustmentId', adj.id)
  );

  return jsonb_build_object(
    'ok', true,
    'adjustmentId', rev_id,
    'reversesAdjustmentId', adj.id,
    'delta', rev_delta,
    'transactionId', tx_id
  );
end;
$$;

revoke all on function public.reverse_reconciliation_adjustment(uuid, text) from public;
grant execute on function public.reverse_reconciliation_adjustment(uuid, text) to authenticated;

commit;
