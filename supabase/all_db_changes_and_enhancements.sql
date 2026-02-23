-- Consolidated DB migration pack for the Wealth Governance + Investment enhancements.
-- Safe to run in order. Includes REQUIRED governance changes and OPTIONAL investment analytics upgrades.

begin;

-- =========================================================
-- REQUIRED: Multi-User Wealth Governance (RBAC + approvals)
-- =========================================================

create table if not exists public.users (
  id uuid primary key,
  name text,
  role text not null default 'Restricted' check (role in ('Admin','Restricted')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  monthly_limit numeric not null default 0,
  total_spent numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  user_id uuid not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

create table if not exists public.budget_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_type text not null check (request_type in ('NewCategory','IncreaseLimit')),
  category_id uuid null references public.categories(id) on delete set null,
  category_name text,
  amount numeric not null,
  status text not null default 'Pending' check (status in ('Pending','Finalized','Rejected')),
  created_at timestamptz not null default now()
);

alter table if exists public.transactions
  add column if not exists status text not null default 'Approved' check (status in ('Pending','Approved','Rejected')),
  add column if not exists category_id uuid null references public.categories(id) on delete set null,
  add column if not exists note text,
  add column if not exists rejection_reason text;

create index if not exists idx_permissions_user on public.permissions(user_id);
create index if not exists idx_budget_requests_status on public.budget_requests(status, created_at desc);
create unique index if not exists idx_budget_requests_pending_newcategory_unique
  on public.budget_requests(user_id, lower(trim(category_name)), request_type)
  where status = 'Pending' and request_type = 'NewCategory' and category_name is not null;
create unique index if not exists idx_budget_requests_pending_increaselimit_unique
  on public.budget_requests(user_id, category_id, request_type)
  where status = 'Pending' and request_type = 'IncreaseLimit' and category_id is not null;
create index if not exists idx_transactions_status on public.transactions(status, date desc);
create index if not exists idx_transactions_category_id on public.transactions(category_id);

create or replace function public.apply_approved_transaction_to_category(p_category_name text, p_amount numeric)
returns void
language plpgsql
as $$
begin
  update public.categories
  set total_spent = coalesce(total_spent, 0) + coalesce(p_amount, 0)
  where name = p_category_name;
end;
$$;


create or replace function public.approve_pending_transaction(p_transaction_id uuid)
returns void
language plpgsql
as $$
declare
  tx record;
  tx_json jsonb;
  tx_status text;
  tx_amount numeric;
  budget_category_name text;
begin
  select *
  into tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction % not found', p_transaction_id;
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
end;
$$;


create or replace function public.reject_pending_transaction(p_transaction_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  tx_status text;
begin
  select coalesce(to_jsonb(t)->>'status', 'Approved')
  into tx_status
  from public.transactions t
  where t.id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction % not found', p_transaction_id;
  end if;

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Rejected',
      rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_transaction_id;
end;
$$;

-- =========================================================
-- OPTIONAL: Investment analytics + execution-quality upgrades
-- =========================================================

alter table if exists public.planned_trades
  add column if not exists planned_entry_price numeric,
  add column if not exists planned_exit_price numeric,
  add column if not exists stop_loss_price numeric,
  add column if not exists take_profit_price numeric,
  add column if not exists strategy_tag text,
  add column if not exists confidence_score numeric;

alter table if exists public.planned_trades
  drop constraint if exists planned_trades_confidence_score_check;

alter table if exists public.planned_trades
  add constraint planned_trades_confidence_score_check
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100));

-- Backfill planned_entry_price using whichever naming variant exists.
do $$
declare
  condition_col text;
  target_col text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'conditionType'
  ) then
    condition_col := '"conditionType"';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'condition_type'
  ) then
    condition_col := 'condition_type';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'conditiontype'
  ) then
    condition_col := 'conditiontype';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'targetValue'
  ) then
    target_col := '"targetValue"';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'target_value'
  ) then
    target_col := 'target_value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'targetvalue'
  ) then
    target_col := 'targetvalue';
  end if;

  if condition_col is not null and target_col is not null then
    execute format(
      'update public.planned_trades
       set planned_entry_price = case
         when planned_entry_price is not null then planned_entry_price
         when coalesce(quantity, 0) > 0 and coalesce(amount, 0) > 0 then amount / quantity
         when %s = ''price'' then %s
         else null
       end',
      condition_col,
      target_col
    );
  else
    update public.planned_trades
    set planned_entry_price = case
      when planned_entry_price is not null then planned_entry_price
      when coalesce(quantity, 0) > 0 and coalesce(amount, 0) > 0 then amount / quantity
      else null
    end;
  end if;
end $$;

create table if not exists public.trade_execution_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  planned_trade_id uuid null references public.planned_trades(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  planned_price numeric,
  executed_price numeric not null,
  executed_quantity numeric not null check (executed_quantity > 0),
  executed_at timestamptz not null default now(),
  execution_note text
);

-- Patch old existing table shapes if table was created before this migration.
alter table if exists public.trade_execution_audit
  add column if not exists user_id uuid,
  add column if not exists planned_trade_id uuid,
  add column if not exists symbol text,
  add column if not exists side text,
  add column if not exists planned_price numeric,
  add column if not exists executed_price numeric,
  add column if not exists executed_quantity numeric,
  add column if not exists executed_at timestamptz,
  add column if not exists execution_note text;

update public.trade_execution_audit
set executed_at = now()
where executed_at is null;

alter table if exists public.trade_execution_audit
  alter column executed_at set default now();

alter table if exists public.trade_execution_audit
  alter column executed_at set not null;

create index if not exists idx_planned_trades_user_status
  on public.planned_trades(user_id, status);

create index if not exists idx_planned_trades_user_symbol
  on public.planned_trades(user_id, symbol);

create index if not exists idx_price_alerts_user_symbol_status
  on public.price_alerts(user_id, symbol, status);

create index if not exists idx_execution_audit_user_time
  on public.trade_execution_audit(user_id, executed_at desc);

create or replace view public.v_investment_signal_summary as
select
  pt.user_id,
  count(*) as planned_count,
  count(*) filter (where lower(coalesce(pt.status, '')) = 'executed') as executed_count,
  count(*) filter (where lower(coalesce(pt.status, '')) in ('planned', 'triggered')) as open_count,
  avg(case
    when tea.planned_price is null or tea.planned_price = 0 then null
    else ((tea.executed_price - tea.planned_price) / tea.planned_price) * 100
  end) as avg_slippage_pct
from public.planned_trades pt
left join public.trade_execution_audit tea
  on tea.planned_trade_id = pt.id
group by pt.user_id;

commit;

-- =========================================================
-- Verification (run after migration)
-- =========================================================

-- select table_name, column_name
-- from information_schema.columns
-- where table_schema='public'
--   and table_name in (
--     'users','categories','permissions','budget_requests','transactions',
--     'planned_trades','trade_execution_audit','price_alerts'
--   )
-- order by table_name, ordinal_position;

-- select tablename, indexname
-- from pg_indexes
-- where schemaname='public'
--   and tablename in ('permissions','budget_requests','transactions','planned_trades','price_alerts','trade_execution_audit')
-- order by tablename, indexname;


-- ===== Budget Request Note/Reason Enhancement =====
alter table if exists public.budget_requests
  add column if not exists note text;

alter table if exists public.budget_requests
  add column if not exists request_note text;
