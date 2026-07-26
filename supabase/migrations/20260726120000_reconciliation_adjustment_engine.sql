-- Adjustment & Reconciliation Engine (live-data safe: additive only).
-- Append-only adjustment events, audit trail, snapshot revisions, and cash reconcile RPC.

begin;

-- ---------------------------------------------------------------------------
-- reconciliation_adjustments (immutable event ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mechanism text not null check (mechanism in (
    'reconcile_balance',
    'opening_balance',
    'reconcile_quantity',
    'edit_trade',
    'sukuk_face_yield',
    'dividend_edit',
    'fee_vat_edit',
    'asset_revaluation',
    'commodity_revaluation',
    'liability_restatement',
    'corporate_action_undo',
    'corporate_action_correct',
    'reverse_adjustment'
  )),
  entity_type text not null check (entity_type in (
    'account', 'holding', 'investment_transaction', 'sukuk_position',
    'asset', 'commodity', 'liability', 'corporate_action', 'adjustment'
  )),
  entity_id uuid not null,
  portfolio_id uuid null,
  account_id uuid null,
  symbol text null,
  effective_date date not null,
  currency text not null default 'SAR' check (currency in ('SAR', 'USD')),
  before_value numeric not null,
  actual_value numeric not null,
  delta numeric not null,
  cost_basis_total numeric null,
  reason text not null check (char_length(trim(reason)) >= 3),
  idempotency_key text not null,
  status text not null default 'applied' check (status in ('applied', 'reversed', 'noop')),
  reversed_by_adjustment_id uuid null references public.reconciliation_adjustments(id) on delete set null,
  reverses_adjustment_id uuid null references public.reconciliation_adjustments(id) on delete set null,
  generated_transaction_id uuid null,
  generated_investment_transaction_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists reconciliation_adjustments_user_created_idx
  on public.reconciliation_adjustments (user_id, created_at desc);
create index if not exists reconciliation_adjustments_user_entity_idx
  on public.reconciliation_adjustments (user_id, entity_type, entity_id);

alter table public.reconciliation_adjustments enable row level security;

drop policy if exists "Users manage own reconciliation_adjustments" on public.reconciliation_adjustments;
create policy "Users manage own reconciliation_adjustments"
  on public.reconciliation_adjustments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Prevent client UPDATE/DELETE of applied rows via trigger (append-only semantics).
create or replace function public.reconciliation_adjustments_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliation_adjustments are append-only; delete is not allowed';
  end if;
  -- Allow status flip to reversed + reversed_by only.
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.mechanism is distinct from old.mechanism
       or new.entity_type is distinct from old.entity_type
       or new.entity_id is distinct from old.entity_id
       or new.delta is distinct from old.delta
       or new.before_value is distinct from old.before_value
       or new.actual_value is distinct from old.actual_value
       or new.idempotency_key is distinct from old.idempotency_key
    then
      raise exception 'reconciliation_adjustments core fields are immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconciliation_adjustments_immutable on public.reconciliation_adjustments;
create trigger trg_reconciliation_adjustments_immutable
  before update or delete on public.reconciliation_adjustments
  for each row execute function public.reconciliation_adjustments_immutable();

-- ---------------------------------------------------------------------------
-- reconciliation_runs
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  adjustment_id uuid null references public.reconciliation_adjustments(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'running', 'completed', 'blocked', 'failed'
  )),
  effective_from date null,
  entity_type text null,
  entity_ids jsonb not null default '[]'::jsonb,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists reconciliation_runs_user_created_idx
  on public.reconciliation_runs (user_id, created_at desc);

alter table public.reconciliation_runs enable row level security;

drop policy if exists "Users manage own reconciliation_runs" on public.reconciliation_runs;
create policy "Users manage own reconciliation_runs"
  on public.reconciliation_runs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reconciliation_audit_events (durable read-only audit)
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'adjustment', 'correction', 'reversal', 'corporate_action', 'revaluation', 'noop', 'error'
  )),
  mechanism text not null,
  entity_type text not null,
  entity_id text not null,
  effective_date date null,
  before_value numeric null,
  after_value numeric null,
  delta numeric null,
  currency text null,
  reason text null,
  adjustment_id uuid null references public.reconciliation_adjustments(id) on delete set null,
  run_id uuid null references public.reconciliation_runs(id) on delete set null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists reconciliation_audit_events_user_at_idx
  on public.reconciliation_audit_events (user_id, at desc);

alter table public.reconciliation_audit_events enable row level security;

drop policy if exists "Users read own reconciliation_audit_events" on public.reconciliation_audit_events;
create policy "Users read own reconciliation_audit_events"
  on public.reconciliation_audit_events for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own reconciliation_audit_events" on public.reconciliation_audit_events;
create policy "Users insert own reconciliation_audit_events"
  on public.reconciliation_audit_events for insert
  with check (auth.uid() = user_id);

-- No update/delete policies → clients cannot mutate audit rows.

-- ---------------------------------------------------------------------------
-- net_worth_snapshot_revisions (append-only history of daily NW)
-- ---------------------------------------------------------------------------
create table if not exists public.net_worth_snapshot_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_day date not null,
  captured_at timestamptz not null default now(),
  net_worth numeric not null,
  buckets jsonb null,
  sar_per_usd numeric null,
  superseded_by_adjustment_id uuid null references public.reconciliation_adjustments(id) on delete set null,
  run_id uuid null references public.reconciliation_runs(id) on delete set null,
  revision integer not null default 1,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists net_worth_snapshot_revisions_user_day_idx
  on public.net_worth_snapshot_revisions (user_id, snapshot_day, revision desc);

alter table public.net_worth_snapshot_revisions enable row level security;

drop policy if exists "Users manage own net_worth_snapshot_revisions" on public.net_worth_snapshot_revisions;
create policy "Users manage own net_worth_snapshot_revisions"
  on public.net_worth_snapshot_revisions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optional link columns on ledger rows (nullable; safe if absent elsewhere).
alter table if exists public.transactions
  add column if not exists reconciliation_adjustment_id uuid null;

alter table if exists public.investment_transactions
  add column if not exists reconciliation_adjustment_id uuid null;

create index if not exists idx_transactions_reconciliation_adjustment_id
  on public.transactions (reconciliation_adjustment_id)
  where reconciliation_adjustment_id is not null;

create index if not exists idx_investment_transactions_reconciliation_adjustment_id
  on public.investment_transactions (reconciliation_adjustment_id)
  where reconciliation_adjustment_id is not null;

-- ---------------------------------------------------------------------------
-- preview: compute cash reconcile delta from server state
-- ---------------------------------------------------------------------------
create or replace function public.preview_reconciliation_adjustment(
  p_entity_type text,
  p_entity_id uuid,
  p_actual_value numeric,
  p_mechanism text default 'reconcile_balance'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  acc record;
  before_v numeric;
  delta_v numeric;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_entity_type <> 'account' or p_mechanism not in ('reconcile_balance', 'opening_balance') then
    raise exception 'preview_reconciliation_adjustment currently supports account reconcile_balance only';
  end if;
  if p_actual_value is null or not (p_actual_value = p_actual_value) then
    raise exception 'actual_value must be a finite number';
  end if;

  select id, type, balance, currency into acc
  from public.accounts
  where id = p_entity_id and user_id = uid
  for share;
  if not found then
    raise exception 'Account not found';
  end if;
  if acc.type not in ('Checking', 'Savings', 'Credit', 'Investment') then
    raise exception 'Unsupported account type for reconcile';
  end if;

  before_v := coalesce(acc.balance, 0);
  delta_v := round(p_actual_value - before_v, 4);
  return jsonb_build_object(
    'entityType', 'account',
    'entityId', acc.id,
    'mechanism', p_mechanism,
    'beforeValue', before_v,
    'actualValue', p_actual_value,
    'delta', delta_v,
    'currency', coalesce(acc.currency, 'SAR'),
    'accountType', acc.type,
    'noop', abs(delta_v) < 0.00005
  );
end;
$$;

revoke all on function public.preview_reconciliation_adjustment(text, uuid, numeric, text) from public;
grant execute on function public.preview_reconciliation_adjustment(text, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- apply: atomic cash/credit reconcile (server-computed delta + row lock)
-- ---------------------------------------------------------------------------
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

  -- Block while pending/approval txs exist on this account.
  if exists (
    select 1 from public.transactions t
    where t.user_id = uid
      and t.account_id = acc.id
      and lower(coalesce(t.status::text, '')) in ('pending', 'pending_approval', 'awaiting_approval')
  ) then
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

  insert into public.transactions (
    user_id, date, description, amount, category, type, account_id, note
  ) values (
    uid, p_effective_date, desc_v, delta_v, category_v, tx_type, acc.id,
    'reconciliation:' || p_mechanism
  ) returning id into tx_id;

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

-- ---------------------------------------------------------------------------
-- reverse: inverse cash delta + lineage
-- ---------------------------------------------------------------------------
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

  insert into public.transactions (
    user_id, date, description, amount, category, type, account_id, note
  ) values (
    uid, (timezone('UTC', now()))::date, desc_v, rev_delta, 'Reconciliation Adjustment', tx_type, acc.id,
    'reconciliation:reverse_adjustment'
  ) returning id into tx_id;

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
